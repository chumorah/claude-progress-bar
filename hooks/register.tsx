import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Plan } from '../types'
import {
  APP_PLAN_TOOL,
  STEPS_TOOL,
  addStep,
  chooseTools,
  applyList,
  applyMoves,
  completeAll,
  describeActivity,
  formatDuration,
  formatLeft,
  statusOf,
  summarize,
  textBar,
  turnEnded,
  turnStarted,
  updateStep,
  workOf,
} from './plan'
import type { Item } from './plan'
import { STRIP_HEIGHT, blockBar, stepTrackGlyphs, stepTrackSvg } from './visual'

// The tag declines a plan an earlier version stored with other fields.
const plan = atom({ plugin: 'task-progress', key: 'plan' } as const, null, { shape: 'plan-1' })
const activity = atom({ plugin: 'task-progress', key: 'activity' } as const, null)
const tick = atom({ plugin: 'task-progress', key: 'tick' } as const, 0)
const isListOpen = atom({ plugin: 'task-progress', key: 'isListOpen' } as const, false)

const HISTORY = 'step-history'
/** Stored true when the person wants the desktop app's own task list back (`/progress app-list`). */
const APP_LIST = 'app-task-list'
type History = { sumMs: number; count: number }

type Args = Record<string, unknown>

function isPlanTool(tool: string): boolean {
  return tool === 'TodoWrite' || tool === 'TaskCreate' || tool === 'TaskUpdate' || /^mcp__ccd_turn__(update_plan|wrap_up)$/.test(tool)
}

/** The plan tools whose rows the chat no longer draws (never wrap_up: it draws the next-step box). */
function isHiddenInChat(tool: string): boolean {
  return tool === 'TodoWrite' || tool === 'TaskCreate' || tool === 'TaskUpdate' || tool === APP_PLAN_TOOL || tool === STEPS_TOOL
}

const STEPS_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      description: 'The whole plan, in order; replaces the previous list.',
      minItems: 1,
      maxItems: 12,
      items: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'The step, a short imperative phrase.' },
          status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
        },
        required: ['content', 'status'],
      },
    },
    scope: { type: 'string', enum: ['first_task', 'continuation', 'new_task'] },
    advance: { type: 'boolean', description: 'Completes the step in progress and starts the next pending one.' },
    done: { type: 'array', items: { type: 'number' }, description: 'Steps to mark completed (1-based).' },
    start: { type: 'number', description: 'The step to start (1-based).' },
  },
}

const STEPS_PROMPT = [
  "Step lists: the person uses the task-progress mod, which shows Claude's steps in a progress bar above the prompt and keeps them out of the chat.",
  `The desktop app's own task-list tool (${APP_PLAN_TOOL}) is turned off. Wherever your instructions say to call ${APP_PLAN_TOOL}, call ${STEPS_TOOL} instead, at the same moments and with the same input (items, scope, advance, done, start).`,
  'Keep calling mcp__ccd_turn__wrap_up as your instructions say: it still draws the end-of-turn box.',
].join(' ')

async function keepsAppList($: EngineInterface): Promise<boolean> {
  return (await $.store.get(APP_LIST)) === true
}

async function priorStepMs($: EngineInterface): Promise<number | undefined> {
  const history = (await $.store.get(HISTORY)) as History | undefined
  return history && history.count > 0 ? history.sumMs / history.count : undefined
}

async function remember($: EngineInterface, finished: Plan): Promise<void> {
  if (finished.steps.length === 0 || finished.workMs <= 0) return
  const perStep = finished.workMs / finished.steps.length
  const old = ((await $.store.get(HISTORY)) as History | undefined) ?? { sumMs: 0, count: 0 }
  // Keep roughly the last 20 tasks' worth of weight.
  const keep = old.count >= 20 ? 19 / old.count : 1
  await $.store.set(HISTORY, { sumMs: old.sumMs * keep + perStep, count: old.count * keep + 1 })
}

function itemsOf(list: unknown, titleKey: string, phaseKey?: string): Item[] {
  if (!Array.isArray(list)) return []
  return list.flatMap((raw: unknown) => {
    if (typeof raw !== 'object' || raw === null) return []
    const row = raw as Args
    const title = row[titleKey]
    if (typeof title !== 'string' || title.trim() === '') return []
    const phase = phaseKey ? row[phaseKey] : undefined
    return [{ title: title.trim(), status: statusOf(row.status), phase: typeof phase === 'string' ? phase : undefined }]
  })
}

async function refreshStatus($: EngineInterface): Promise<void> {
  const current = await read($, plan)
  if (current === null) {
    $.ui.status(undefined)
    return
  }
  const s = summarize(current, await $.clock.now())
  $.ui.status(
    s.isFinished
      ? `${textBar(s)} All ${s.total} steps done`
      : `${textBar(s)} Step ${s.stepNumber} of ${s.total} · ${formatLeft(s)}`,
  )
}

/** Applies a change to the plan, then tells the person when it just finished. */
async function change($: EngineInterface, fn: (p: Plan | null, now: number) => Plan | null): Promise<void> {
  const now = await $.clock.now()
  const before = await read($, plan)
  const after = fn(before, now)
  await update($, plan, () => after)
  await refreshStatus($)
  if (after !== null && after.finishedAt !== undefined && before?.finishedAt === undefined) {
    await remember($, after)
    const text = `All ${after.steps.length} steps done in ${formatDuration(after.workMs)}.`
    const sent = await $.ui.notify(text, { title: 'Claude finished the task' })
    if (!sent.isSent) $.ui.toast(text)
  }
}

async function onPlanCall($: EngineInterface, tool: string, args: Args, result: unknown): Promise<void> {
  const prior = await priorStepMs($)
  if (tool === 'TodoWrite') {
    const items = itemsOf(args.todos, 'content', 'activeForm')
    await change($, (p, now) => applyList(p, items, now, prior))
    return
  }
  if (tool === 'TaskCreate') {
    const task = (result as { task?: { id?: unknown; subject?: unknown } } | undefined)?.task
    const id = typeof task?.id === 'string' ? task.id : undefined
    const title = typeof args.subject === 'string' ? args.subject : undefined
    if (id !== undefined && title !== undefined) await change($, (p, now) => addStep(p, id, title, now, prior))
    return
  }
  if (tool === 'TaskUpdate') {
    const id = typeof args.taskId === 'string' ? args.taskId : undefined
    if (id === undefined) return
    await change($, (p, now) =>
      updateStep(
        p,
        id,
        {
          status: typeof args.status === 'string' ? args.status : undefined,
          title: typeof args.subject === 'string' ? args.subject : undefined,
          phase: typeof args.activeForm === 'string' ? args.activeForm : undefined,
        },
        now,
      ),
    )
    return
  }
  if (tool.endsWith('__wrap_up')) {
    await change($, (p, now) => completeAll(p, now))
    return
  }
  // mcp__ccd_turn__update_plan: a whole list, or a move.
  if (Array.isArray(args.items)) {
    const items = itemsOf(args.items, 'content')
    await change($, (p, now) => applyList(p, items, now, prior, args.scope === 'new_task'))
    return
  }
  const done = Array.isArray(args.done) ? args.done.filter((n): n is number => typeof n === 'number') : undefined
  await change($, (p, now) =>
    applyMoves(
      p,
      { advance: args.advance === true, done, start: typeof args.start === 'number' ? args.start : undefined },
      now,
    ),
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // A turn cut off by a restart never reported its end.
    await change($, (p, now) => turnEnded(p, now))
    await update($, activity, () => null)
    await $.tool.register({
      name: 'steps',
      description:
        "Keep the task's step list in the progress bar above the prompt: the whole plan with `items`, then `advance` (or `done`/`start`) as steps finish. Takes the same input as the desktop app's task-list tool and replaces it.",
      inputSchema: STEPS_SCHEMA,
      isDeferred: false,
    })
    await $.command.register({
      name: 'progress',
      description: 'Show or hide the step list under the progress bar ("clear" removes the bar, "app-list" brings back the app\'s own task list)',
    })
    // Count the time left down while Claude works.
    $.clock.every(15_000, () => {
      void (async () => {
        const current = await read($, plan)
        if (current === null || current.finishedAt !== undefined || current.runningSince === undefined) return
        const now = await $.clock.now()
        await update($, tick, () => now)
        await refreshStatus($)
      })()
    })
    return next(e)
  })

  on('command.run', { command: 'progress' }, async ($, e) => {
    const args = typeof e.args === 'string' ? e.args.trim() : ''
    if (args === 'app-list') {
      const keeps = !(await keepsAppList($))
      await $.store.set(APP_LIST, keeps)
      await $.ui.invalidate('tool.list')
      return {
        text: keeps
          ? "The desktop app's own task list is back under Claude's messages."
          : "The desktop app's own task list is off again: the steps show only in the progress bar.",
      }
    }
    if (args === 'clear') {
      await update($, plan, () => null)
      await refreshStatus($)
      return { text: 'Progress bar cleared.' }
    }
    const isOpen = await update($, isListOpen, open => !open)
    return { text: isOpen ? 'Showing every step under the progress bar.' : 'Step list hidden.' }
  })

  on('prompt.submit', async ($, e, next) => {
    // A finished task's bar goes away when the next request starts.
    const current = await read($, plan)
    if (current?.finishedAt !== undefined) {
      await update($, plan, () => null)
      await refreshStatus($)
    }
    return next(e)
  }).catch(($, e, next) => next(e)) // never hold up a prompt over the bar

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) await change($, (p, now) => turnStarted(p, now))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await change($, (p, now) => turnEnded(p, now))
      await update($, activity, () => null)
    }
    return next(e)
  })

  // With the app's list off, its tool goes and the mod's step tool stands in,
  // so no message carries a list for the app to draw. Away from the desktop
  // app (no task-list tool), the step tool goes instead.
  on('tool.list', async ($, e, next) => {
    const listed = await next(e)
    if (listed.value === undefined) return listed
    return { value: chooseTools(listed.value, await keepsAppList($)) }
  }).catch(($, e, next) => next(e)) // a failure leaves the tools as built

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!e.tools.includes(STEPS_TOOL)) return composed
    return { sections: [...composed.sections, { id: 'task-progress:steps', text: STEPS_PROMPT, scope: 'session' as const }] }
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const args = e as unknown as Args
    if (tool === STEPS_TOOL) {
      await onPlanCall($, APP_PLAN_TOOL, args, undefined)
      const n = (await read($, plan))?.steps.length ?? 0
      return { result: `Steps shown in the progress bar (${n} steps).` }
    }
    if (e.agentId !== undefined) return next(e)
    if (tool === APP_PLAN_TOOL && !(await keepsAppList($))) {
      // The desktop app draws its own task list from this call. The bar shows
      // the same steps, so the call stops here and the app never sees it.
      await onPlanCall($, tool, args, undefined)
      const n = (await read($, plan))?.steps.length ?? 0
      // An MCP tool's answer is its text (or content blocks), not a result object.
      return { result: `Plan shown in the progress bar (${n} steps).` }
    }
    if (isPlanTool(tool)) {
      const ran = await next(e)
      if (!('deny' in ran && ran.deny) && ran.isError !== true) {
        await onPlanCall($, tool, args, ran.result)
      }
      return ran
    }
    const doing = describeActivity(tool, args)
    if (doing !== null) await update($, activity, () => doing)
    return next(e)
  }).catch(($, e, next) => next(e)) // a failure here lets the tool run (or replays its result)

  // The steps live in the bar, so their tool rows leave the chat. Errored
  // calls and the full transcript (ctrl+o) still show them.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (!isHiddenInChat(e.props.tool) || e.props.isErrored || e.props.isExpanded === true) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box display="none" />
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (!isHiddenInChat(e.props.tool)) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box display="none" />
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, plan)
    if (e.props.hasSurvey || current === null) return next(e)
    await read($, tick) // redraws as the clock ticks
    const doing = await read($, activity)
    const isOpen = await read($, isListOpen)
    const now = await $.clock.now()
    const s = summarize(current, now)
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const Svg = e.surface !== 'terminal' && 'Svg' in ui ? ui.Svg : undefined
    const isWorking = e.props.isWorking

    const title = s.isFinished ? 'Everything is checked off' : s.current?.title ?? 'Wrapping up'
    const stepText = s.isFinished
      ? `All ${s.total} steps done`
      : `Step ${s.stepNumber} of ${s.total}${s.running > 1 ? ` (${s.running} at once)` : ''}`
    const accent = s.isFinished ? 'success' : 'claude'
    const chip = s.isFinished
      ? `✓ took ${formatDuration(s.elapsedMs)}`
      : !isWorking
        ? '⏸ paused'
        : `⏱ ${formatLeft(s)}`

    let nowLine: string
    if (s.isFinished) {
      nowLine = `Finished · ${formatDuration(current.workMs)} of work`
    } else if (!e.props.isWorking) {
      nowLine = `Paused at step ${s.stepNumber} · waiting for you`
    } else {
      const phase = doing ?? s.current?.phase ?? 'Thinking'
      nowLine = `Now: ${phase} · ${s.done} of ${s.total} done · ${formatDuration(workOf(current, now))} in`
    }

    const cells = Math.max(10, (e.props.bodyColumns ?? 60) - 4)
    const bar = blockBar(s, cells)
    const glyphColor = { done: 'success', doing: 'claude', todo: 'inactive' } as const

    return (
      // Three short rows, inset from the band's edges.
      <Box flexDirection="column" rowGap={Svg ? 'xs' : 0} paddingX={Svg ? 'md' : 1} paddingY={Svg ? 'xs' : 0}>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={2}>
          <Text wrap="truncate-end">
            <Text bold weight="bold" color={accent} tabular>
              {s.percent}%
            </Text>
            {'  '}
            <Text bold weight="semibold">
              {stepText}
            </Text>
            <Text dimColor> · {title}</Text>
          </Text>
          <Text color={accent} weight="medium">
            {chip}
          </Text>
        </Box>
        {Svg ? (
          <Svg
            // About 8px a cell; the surface shrinks it to fit when that guess runs wide.
            source={stepTrackSvg(current.steps, s, isWorking, (e.props.bodyColumns ?? 80) * 8 - 32)}
            alt={`${stepText}: ${title}, ${s.percent}% done`}
            // Its own height: an interactive frame with none falls back to ~150px of empty space.
            height={STRIP_HEIGHT}
          />
        ) : (
          <Box flexDirection="column">
            <Text>
              <Text color={accent}>{bar.filled}</Text>
              <Text dimColor>{bar.empty}</Text>
            </Text>
            <Text wrap="truncate-end">
              {stepTrackGlyphs(current.steps, cells).map(g => (
                <Text color={glyphColor[g.color]} bold={g.color === 'doing'}>
                  {g.text}
                </Text>
              ))}
            </Text>
          </Box>
        )}
        <Box flexDirection="row" justifyContent="space-between" gap={1}>
          <Text dimColor wrap="truncate-end">
            {nowLine}
          </Text>
          <Box flexDirection="row" gap={1}>
            <Button
              key="steps"
              plain
              label={isOpen ? 'Hide steps' : 'Show steps'}
              onPress={() => update($, isListOpen, open => !open)}
            />
            {s.isFinished && (
              <Button
                key="dismiss"
                plain
                label="Dismiss"
                onPress={async () => {
                  await update($, plan, () => null)
                  await refreshStatus($)
                }}
              />
            )}
          </Box>
        </Box>
        {isOpen && (
          <Box flexDirection="column">
            {current.steps.map((step, i) => (
              <Text wrap="truncate-end" dimColor={step.status === 'pending'} bold={step.status === 'in_progress'}>
                <Text color={step.status === 'completed' ? 'success' : step.status === 'in_progress' ? 'claude' : 'inactive'}>
                  {step.status === 'completed' ? '✓' : step.status === 'in_progress' ? '▸' : '□'}
                </Text>{' '}
                {i + 1}. {step.title}
                {step.status === 'in_progress' && step.phase ? <Text dimColor> · {step.phase}</Text> : null}
              </Text>
            ))}
          </Box>
        )}
      </Box>
    )
  })
}
