export type StepStatus = 'pending' | 'in_progress' | 'completed'

export type Step = {
  id: string
  title: string
  /** The step's "doing" wording, when the plan gives one (TodoWrite's activeForm). */
  phase?: string
  status: StepStatus
}

export type Plan = {
  steps: Step[]
  /** When the plan was first written (ms since the epoch). */
  startedAt: number
  /** Working time banked from turns that have ended (ms). Waiting for the person is not counted. */
  workMs: number
  /** When the running turn started counting, while one runs. */
  runningSince?: number
  /** Working time at the moment the latest step was checked off (ms). */
  workAtLastDone: number
  /** Steps seen going to done while this mod watched. */
  doneSeen: number
  /** Average working time per step from earlier tasks, for an estimate before any step is done. */
  priorStepMs?: number
  /** Set once every step is done. */
  finishedAt?: number
}

declare module 'claude-code' {
  interface PluginState {
    'task-progress': {
      plan: Shaped<Plan | null>
      activity: string | null
      tick: number
      isListOpen: boolean
    }
  }
}
