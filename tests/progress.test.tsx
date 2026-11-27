import { expect, mock, test } from 'claude-code/testing'

import { applyList, applyMoves, chooseTools, completeAll, formatLeft, summarize, turnEnded } from '../hooks/plan'

const MIN = 60_000

test('the plan math: step count, current step, time left', async () => {
  let p = applyList(
    null,
    [
      { title: 'Read the brief', status: 'in_progress' },
      { title: 'Cut the video', status: 'pending' },
      { title: 'Add captions', status: 'pending' },
      { title: 'Export', status: 'pending' },
    ],
    0,
    undefined,
  )
  let s = summarize(p!, 1 * MIN)
  expect(s.total).toBe(4)
  expect(s.stepNumber).toBe(1)
  expect(s.current?.title).toBe('Read the brief')
  expect(formatLeft(s)).toBe('estimating time left…')

  // Step 1 took 2 minutes: 3 steps left at about 2 minutes each.
  p = applyMoves(p, { advance: true }, 2 * MIN)
  s = summarize(p!, 2 * MIN)
  expect(s.stepNumber).toBe(2)
  expect(s.done).toBe(1)
  expect(formatLeft(s)).toBe('about 6 min left')

  // Waiting for the person does not count as work.
  p = turnEnded(p, 3 * MIN)
  s = summarize(p!, 30 * MIN)
  expect(formatLeft(s)).toBe('about 5 min left')

  p = completeAll(p, 31 * MIN)
  s = summarize(p!, 31 * MIN)
  expect(s.isFinished).toBe(true)
  expect(s.percent).toBe(100)
})

test('a new list keeps the steps it already knew', async () => {
  const first = applyList(null, [{ title: 'A', status: 'in_progress' }, { title: 'B', status: 'pending' }], 0, undefined)
  const second = applyList(
    first,
    [{ title: 'A', status: 'completed' }, { title: 'B', status: 'in_progress' }, { title: 'C', status: 'pending' }],
    MIN,
    undefined,
  )
  expect(second!.steps[0]!.id).toBe(first!.steps[0]!.id)
  expect(second!.doneSeen).toBe(1)
  expect(summarize(second!, MIN).stepNumber).toBe(2)
})

const BAND = {
  plugin: 'task-progress',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: true,
    maxRows: 12,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 11 },
    view: {},
  },
} as const

test('the bar shows step N of M and the phase on every surface', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('command.register', () => ({ value: { command: 'progress' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__task-progress__steps' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
  on('ui.status', () => ({ value: undefined }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  // Loosely typed: the union of every connected MCP tool is too deep for tsc here.
  const call = $.tool.call as unknown as (input: Record<string, unknown>) => Promise<unknown>
  await call({
    tool: 'TodoWrite',
    todos: [
      { content: 'Cut silences', status: 'completed', activeForm: 'Cutting silences' },
      { content: 'Add captions', status: 'in_progress', activeForm: 'Adding captions' },
      { content: 'Export', status: 'pending', activeForm: 'Exporting' },
    ],
  })
  await call({ tool: 'Bash', command: 'ffmpeg -i a.mov b.mp4', description: 'Rendering the captions' })

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: /Step 2 of 3/ }))?.text).toMatch(/Step 2 of 3/)
    expect((await ui.find({ type: 'Text', text: /Add captions/ }))?.text).toMatch(/Add captions/)
    if (surface === 'terminal') {
      // The terminal's step track: done, current, to do.
      expect((await ui.find({ type: 'Text', text: /■━+▣━+□/ }))?.text).toMatch(/■━+▣━+□/)
    } else {
      expect(await ui.find({ type: 'Svg' })).toBeDefined()
    }
    const now = await ui.find({ type: 'Text', text: /Now:/ })
    expect(now?.text).toMatch(/Rendering the captions/)
    await ui.unmount()
  }
})

test('rows of the step tools leave the chat', async ($, on) => {
  const row = (tool: string, isErrored = false) =>
    ({
      plugin: 'task-progress',
      component: 'ToolUse',
      requestId: `t-${tool}`,
      props: { tool_use_id: `t-${tool}`, tool, input: {}, isRunning: false, isErrored, isInterrupted: false, isExpanded: false },
    }) as const
  for (const surface of ['terminal', 'desktop'] as const) {
    const hidden = await $.ui.mount({ ...row('mcp__ccd_turn__update_plan'), surface })
    expect(await hidden.find({ type: 'Box' })).toBeDefined()
    expect(await hidden.find({ type: 'Text' })).toBeUndefined()
    await hidden.unmount()
  }
})

test("the app's task list call stops at the mod and fills the bar", async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  const reached: string[] = []
  on('command.register', () => ({ value: { command: 'progress' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__task-progress__steps' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', (_, e) => {
    reached.push(String(e.tool))
    return { result: {} }
  })
  on('ui.status', () => ({ value: undefined }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const call = $.tool.call as unknown as (input: Record<string, unknown>) => Promise<{ result?: unknown }>
  const ran = await call({
    tool: 'mcp__ccd_turn__update_plan',
    scope: 'first_task',
    items: [
      { content: 'Cut silences', status: 'in_progress' },
      { content: 'Export', status: 'pending' },
    ],
  })
  expect(reached).not.toContain('mcp__ccd_turn__update_plan')
  expect(JSON.stringify(ran.result)).toMatch(/progress bar \(2 steps\)/)

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Step 1 of 2/ }))?.text).toMatch(/Step 1 of 2/)
  await ui.unmount()
})

const TOOLS = [
  { name: 'Bash', description: 'Runs a command', mcp: false },
  { name: 'mcp__ccd_turn__update_plan', description: 'Task list', mcp: true },
  { name: 'mcp__task-progress__steps', description: 'Steps', mcp: true },
]
const names = (list: readonly { name: string }[]) => list.map(t => t.name)

test("in the desktop app the mod's step tool stands in for the app's task list", async () => {
  expect(names(chooseTools(TOOLS, false))).toEqual(['Bash', 'mcp__task-progress__steps'])
  // `/progress app-list` brings the app's tool back and drops the mod's.
  expect(names(chooseTools(TOOLS, true))).toEqual(['Bash', 'mcp__ccd_turn__update_plan'])
  // Away from the desktop app there is no task-list tool to stand in for.
  expect(names(chooseTools(TOOLS.filter(t => !t.name.startsWith('mcp__ccd')), false))).toEqual(['Bash'])
})

test('the step tool fills the bar, and the prompt says to use it', async ($, on) => {
  mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('command.register', () => ({ value: { command: 'progress' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__task-progress__steps' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.status', () => ({ value: undefined }))
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'Hello', scope: 'shared' as const }] }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const compose = (tools: string[]) =>
    $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: ['desktop'], tools, outputStyle: null, traits: [] })
  expect((await compose(['Bash', 'mcp__task-progress__steps'])).sections.map(x => x.id)).toContain('task-progress:steps')
  expect((await compose(['Bash'])).sections.map(x => x.id)).not.toContain('task-progress:steps')

  const call = $.tool.call as unknown as (input: Record<string, unknown>) => Promise<{ result?: unknown }>
  const ran = await call({
    tool: 'mcp__task-progress__steps',
    scope: 'first_task',
    items: [
      { content: 'Cut silences', status: 'completed' },
      { content: 'Add captions', status: 'in_progress' },
      { content: 'Export', status: 'pending' },
    ],
  })
  expect(String(ran.result)).toMatch(/progress bar \(3 steps\)/)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /Step 2 of 3/ }))?.text).toMatch(/Step 2 of 3/)
  await ui.unmount()
})
