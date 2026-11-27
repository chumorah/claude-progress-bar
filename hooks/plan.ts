// Pure plan logic: no `$`, so the tests call it directly.
import type { Plan, Step, StepStatus } from '../types'

export type Item = { title: string; status: StepStatus; phase?: string }

export function statusOf(value: unknown): StepStatus {
  return value === 'completed' || value === 'in_progress' ? value : 'pending'
}

export function workOf(plan: Plan, now: number): number {
  return plan.workMs + (plan.runningSince === undefined ? 0 : Math.max(0, now - plan.runningSince))
}

/** Marks newly done steps against working time, and closes the plan once all are done. */
function settle(before: Plan | null, plan: Plan, now: number): Plan {
  const wasDone = new Set(
    (before?.finishedAt === undefined ? before?.steps ?? [] : [])
      .filter(s => s.status === 'completed')
      .map(s => s.id),
  )
  const newlyDone = plan.steps.filter(s => s.status === 'completed' && !wasDone.has(s.id)).length
  let next = plan
  if (newlyDone > 0) {
    next = { ...next, doneSeen: next.doneSeen + newlyDone, workAtLastDone: workOf(next, now) }
  }
  const isAllDone = next.steps.length > 0 && next.steps.every(s => s.status === 'completed')
  if (isAllDone && next.finishedAt === undefined) {
    next = { ...next, workMs: workOf(next, now), runningSince: undefined, finishedAt: now }
  }
  if (!isAllDone && next.finishedAt !== undefined) {
    next = { ...next, finishedAt: undefined, runningSince: now }
  }
  return next
}

/** A whole list arrived (update_plan items, TodoWrite todos). */
export function applyList(
  before: Plan | null,
  items: readonly Item[],
  now: number,
  priorStepMs: number | undefined,
  isNewTask = false,
): Plan | null {
  if (items.length === 0) return null
  const isFresh = before === null || before.finishedAt !== undefined || isNewTask
  const old = isFresh ? [] : before.steps
  const steps: Step[] = items.map((item, i) => {
    const match = old.find(s => s.title === item.title)
    return {
      id: match?.id ?? `${now}-${i}`,
      title: item.title,
      phase: item.phase,
      status: item.status,
    }
  })
  const plan: Plan =
    isFresh || before === null
      ? {
          steps,
          startedAt: now,
          workMs: 0,
          runningSince: now,
          workAtLastDone: 0,
          doneSeen: 0,
          priorStepMs,
        }
      : { ...before, steps }
  return settle(isFresh ? null : before, plan, now)
}

/** update_plan's { advance } / { done, start } forms. */
export function applyMoves(
  before: Plan | null,
  moves: { advance?: boolean; done?: readonly number[]; start?: number },
  now: number,
): Plan | null {
  if (before === null) return null
  let steps = before.steps.map(s => ({ ...s }))
  if (moves.advance === true) {
    const current = steps.findIndex(s => s.status === 'in_progress')
    if (current >= 0) steps[current]!.status = 'completed'
    const nextPending = steps.findIndex(s => s.status === 'pending')
    if (nextPending >= 0) steps[nextPending]!.status = 'in_progress'
  }
  for (const n of moves.done ?? []) {
    const step = steps[n - 1]
    if (step !== undefined) step.status = 'completed'
  }
  if (typeof moves.start === 'number') {
    const step = steps[moves.start - 1]
    if (step !== undefined) step.status = 'in_progress'
  }
  return settle(before, { ...before, steps }, now)
}

/** Everything checked off (wrap_up). */
export function completeAll(before: Plan | null, now: number): Plan | null {
  if (before === null || before.finishedAt !== undefined) return before
  const steps = before.steps.map(s => ({ ...s, status: 'completed' as const }))
  return settle(before, { ...before, steps }, now)
}

/** TaskCreate adds one step. */
export function addStep(before: Plan | null, id: string, title: string, now: number, priorStepMs?: number): Plan {
  const fresh = before === null || before.finishedAt !== undefined
  const step: Step = { id, title, status: 'pending' }
  if (fresh) {
    return { steps: [step], startedAt: now, workMs: 0, runningSince: now, workAtLastDone: 0, doneSeen: 0, priorStepMs }
  }
  return { ...before, steps: [...before.steps, step] }
}

/** TaskUpdate changes one step. */
export function updateStep(
  before: Plan | null,
  id: string,
  change: { status?: string; title?: string; phase?: string },
  now: number,
): Plan | null {
  if (before === null) return null
  const steps =
    change.status === 'deleted'
      ? before.steps.filter(s => s.id !== id)
      : before.steps.map(s =>
          s.id !== id
            ? s
            : {
                ...s,
                title: change.title ?? s.title,
                phase: change.phase ?? s.phase,
                status: change.status === undefined ? s.status : statusOf(change.status),
              },
        )
  if (steps.length === 0) return null
  return settle(before, { ...before, steps }, now)
}

export function turnStarted(plan: Plan | null, now: number): Plan | null {
  if (plan === null || plan.finishedAt !== undefined || plan.runningSince !== undefined) return plan
  return { ...plan, runningSince: now }
}

export function turnEnded(plan: Plan | null, now: number): Plan | null {
  if (plan === null || plan.runningSince === undefined) return plan
  return { ...plan, workMs: workOf(plan, now), runningSince: undefined }
}

export type Summary = {
  total: number
  done: number
  /** 1-based number of the step being worked on. */
  stepNumber: number
  /** How many steps are in progress at once. */
  running: number
  current: Step | undefined
  /** 0..total, with a share of the current step filled in. */
  value: number
  percent: number
  /** Estimated working time left (ms), or undefined while there is nothing to go on. */
  leftMs: number | undefined
  elapsedMs: number
  isFinished: boolean
}

export function summarize(plan: Plan, now: number): Summary {
  const total = plan.steps.length
  const done = plan.steps.filter(s => s.status === 'completed').length
  const inProgress = plan.steps.filter(s => s.status === 'in_progress')
  const current = inProgress[0] ?? plan.steps.find(s => s.status === 'pending')
  const stepNumber = current === undefined ? total : plan.steps.indexOf(current) + 1
  const work = workOf(plan, now)
  const isFinished = plan.finishedAt !== undefined

  const perStep =
    plan.doneSeen > 0 && plan.workAtLastDone > 0 ? plan.workAtLastDone / plan.doneSeen : plan.priorStepMs
  const spentOnCurrent = work - plan.workAtLastDone
  const remaining = total - done

  let value = done
  let leftMs: number | undefined
  if (isFinished) {
    value = total
    leftMs = 0
  } else if (perStep !== undefined && perStep > 0) {
    if (inProgress.length > 0) value += Math.min(0.9, spentOnCurrent / perStep)
    leftMs = Math.max(remaining * perStep - spentOnCurrent, Math.min(perStep * 0.25, 60_000))
  }
  const percent = total === 0 ? 0 : Math.round((value / total) * 100)

  return {
    total,
    done,
    stepNumber,
    running: inProgress.length,
    current,
    value,
    percent,
    leftMs,
    elapsedMs: work,
    isFinished,
  }
}

export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 1) return 'under a minute'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
}

export function formatLeft(summary: Summary): string {
  if (summary.isFinished) return 'done'
  if (summary.leftMs === undefined) return 'estimating time left…'
  if (summary.leftMs < 60_000) return 'almost done'
  return `about ${formatDuration(summary.leftMs)} left`
}

/** A short text bar for the status line, e.g. ▰▰▰▱▱. */
export function textBar(summary: Summary, cells = 10): string {
  const filled = summary.total === 0 ? 0 : Math.round((summary.value / summary.total) * cells)
  return '▰'.repeat(filled) + '▱'.repeat(Math.max(0, cells - filled))
}

/** What Claude is doing right now, in plain words, from a tool call. */
export function describeActivity(tool: string, args: Record<string, unknown>): string | null {
  const text = (key: string): string | undefined => {
    const value = args[key]
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
  }
  switch (tool) {
    case 'Bash':
      return text('description') ?? 'Running a command'
    case 'Read':
      return 'Reading files'
    case 'Edit':
    case 'Write':
    case 'NotebookEdit':
      return 'Editing files'
    case 'Grep':
    case 'Glob':
      return 'Searching files'
    case 'WebSearch':
    case 'WebFetch':
      return 'Researching online'
    case 'Agent':
    case 'Task':
      return text('description') ? `Helper agent: ${text('description')}` : 'Working with a helper agent'
    case 'Skill':
      return text('skill') ? `Loading the ${text('skill')} skill` : 'Loading a skill'
    case 'ToolSearch':
      return 'Loading tools'
    case 'AskUserQuestion':
      return 'Asking you a question'
    case 'SendUserFile':
      return 'Sending you a file'
    case 'Artifact':
      return 'Publishing a page'
    case 'Monitor':
    case 'TaskStop':
    case 'ScheduleWakeup':
      return 'Keeping an eye on a background job'
    case 'EnterPlanMode':
    case 'ExitPlanMode':
      return 'Planning'
  }
  if (tool.startsWith('mcp__')) {
    const server = tool.split('__')[1] ?? ''
    if (server === 'ccd_turn' || server === 'ccd_session') return null
    if (/browser/i.test(server)) return 'Using the browser'
    if (/notion/i.test(server) || tool.includes('notion-')) return 'Working in Notion'
    if (/computer-use/i.test(server)) return 'Using an app on your Mac'
    return 'Using a connected tool'
  }
  return `Using ${tool}`
}

/** The desktop app's task-list tool: the app draws its box from any message that calls it. */
export const APP_PLAN_TOOL = 'mcp__ccd_turn__update_plan'
/** The mod's own step tool, which stands in for the app's while the app's list is off. */
export const STEPS_TOOL = 'mcp__task-progress__steps'

/**
 * The session's tools with the step tools sorted out: where the desktop app's
 * task-list tool is offered and its list is off, that tool goes and the mod's
 * stands in; anywhere else the mod's step tool goes.
 */
export function chooseTools<T extends { name: string }>(tools: readonly T[], keepsAppList: boolean): T[] {
  const swap = tools.some(t => t.name === APP_PLAN_TOOL) && !keepsAppList
  const drop = swap ? APP_PLAN_TOOL : STEPS_TOOL
  return tools.filter(t => t.name !== drop)
}
