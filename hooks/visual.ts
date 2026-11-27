// The pictures: an SVG step strip for desktop, VS Code and phone, and the
// glyphs the terminal draws in its place. Pure: no `$`.
import type { Step } from '../types'
import type { Summary } from './plan'

/** The strip's height in CSS pixels: the drawing's own, and the box the surface gives it. */
export const STRIP_HEIGHT = 18

export const COLORS = {
  done: '#3FA66B',
  doing: '#D97757',
  doingLight: '#EFA27F',
  todo: '#9AA0A6',
} as const

function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, c => `&#${c.charCodeAt(0)};`)
}

/**
 * One short strip, one segment per step: green with a tick for done, orange
 * filling up for the current step (a light sweeps it while Claude works),
 * faint grey for steps still to do. 18px tall, so the band stays compact.
 */
export function stepTrackSvg(steps: readonly Step[], summary: Summary, isWorking: boolean, width = 640): string {
  const W = Math.round(Math.min(1200, Math.max(280, width)))
  const H = STRIP_HEIGHT
  const n = Math.max(1, steps.length)
  const gap = n > 12 ? 2 : 4
  const segW = (W - gap * (n - 1)) / n
  const font = n > 12 ? 8 : 10
  const showLabels = segW >= 16
  const partial = Math.max(0.12, Math.min(1, summary.value - summary.done))
  const parts: string[] = [
    `<defs>`,
    `<linearGradient id="tp-fill" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="${COLORS.doingLight}"/><stop offset="1" stop-color="${COLORS.doing}"/></linearGradient>`,
    `<linearGradient id="tp-shine" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.5"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>`,
    `</defs>`,
  ]
  const label = (cx: number, text: string, fill: string, outline?: string): string =>
    `<text x="${cx.toFixed(1)}" y="${H / 2}" text-anchor="middle" dominant-baseline="central" font-family="system-ui, -apple-system, sans-serif" font-size="${font}" font-weight="700" fill="${fill}"${outline ? ` stroke="${outline}" stroke-width="3" paint-order="stroke"` : ''}>${text}</text>`

  steps.forEach((step, i) => {
    const x = i * (segW + gap)
    const cx = x + segW / 2
    const rect = (w: number, attrs: string): string =>
      `<rect x="${x.toFixed(1)}" y="0" width="${Math.max(0, w).toFixed(1)}" height="${H}" rx="2" ${attrs}/>`
    if (step.status === 'completed') {
      parts.push(rect(segW, `fill="${COLORS.done}"`))
      if (showLabels) {
        parts.push(
          `<path d="M ${(cx - 4).toFixed(1)} ${H / 2} L ${(cx - 1).toFixed(1)} ${H / 2 + 3} L ${(cx + 4.5).toFixed(1)} ${H / 2 - 3.5}" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter"/>`,
        )
      }
    } else if (step.status === 'in_progress') {
      const fillW = segW * partial
      parts.push(rect(segW, `fill="${COLORS.doing}" fill-opacity="0.22"`), rect(fillW, `fill="url(#tp-fill)"`))
      if (isWorking) {
        parts.push(
          `<clipPath id="tp-clip-${i}"><rect x="${x.toFixed(1)}" y="0" width="${segW.toFixed(1)}" height="${H}" rx="2"/></clipPath>`,
          `<g clip-path="url(#tp-clip-${i})"><rect x="${(x - 60).toFixed(1)}" y="0" width="60" height="${H}" fill="url(#tp-shine)">`,
          `<animate attributeName="x" from="${(x - 60).toFixed(1)}" to="${(x + segW).toFixed(1)}" dur="1.8s" repeatCount="indefinite"/>`,
          `</rect></g>`,
        )
      }
      if (showLabels) parts.push(label(cx, String(i + 1), '#fff', COLORS.doing))
    } else {
      parts.push(rect(segW, `fill="${COLORS.todo}" fill-opacity="0.22"`))
      if (showLabels) parts.push(label(cx, String(i + 1), COLORS.todo))
    }
  })

  const alt = escapeXml(
    summary.isFinished
      ? `All ${summary.total} steps done`
      : `Step ${summary.stepNumber} of ${summary.total}, ${summary.percent}% done`,
  )
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${alt}">${parts.join('')}</svg>`
}

export type Glyph = { text: string; color: 'done' | 'doing' | 'todo' }

/** The terminal's step track: ■━━■━━▣━━□━━□ */
export function stepTrackGlyphs(steps: readonly Step[], width: number): Glyph[] {
  const n = steps.length
  if (n === 0) return []
  const link = Math.max(1, Math.min(4, Math.floor((width - n) / Math.max(1, n - 1))))
  const out: Glyph[] = []
  steps.forEach((step, i) => {
    if (i > 0) {
      out.push({ text: '━'.repeat(link), color: steps[i - 1]?.status === 'completed' ? 'done' : 'todo' })
    }
    out.push(
      step.status === 'completed'
        ? { text: '■', color: 'done' }
        : step.status === 'in_progress'
          ? { text: '▣', color: 'doing' }
          : { text: '□', color: 'todo' },
    )
  })
  return out
}

/** The terminal's thick bar: ████████░░░░ */
export function blockBar(summary: Summary, cells: number): { filled: string; empty: string } {
  const fraction = summary.total === 0 ? 0 : Math.min(1, summary.value / summary.total)
  const count = Math.round(fraction * cells)
  return { filled: '█'.repeat(count), empty: '░'.repeat(Math.max(0, cells - count)) }
}
