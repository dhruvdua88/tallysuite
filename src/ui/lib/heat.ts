/**
 * Heatmap cell colours for the YoY grid. Diverging scale: green = increase,
 * red = decrease, intensity by materiality bucket (−3..+3 from heatBucket).
 * Hex stops are drawn from the app's c-green / c-red ramps so light text stays
 * readable; the number is always rendered in-cell (never colour-only encoding).
 */
export interface HeatStyle {
  bg: string
  fg: string
}

const NEUTRAL: HeatStyle = { bg: 'transparent', fg: 'var(--ink-faint, inherit)' }

const UP: Record<number, HeatStyle> = {
  1: { bg: '#EAF3DE', fg: '#27500A' },
  2: { bg: '#C0DD97', fg: '#173404' },
  3: { bg: '#97C459', fg: '#173404' },
}
const DOWN: Record<number, HeatStyle> = {
  1: { bg: '#FCEBEB', fg: '#791F1F' },
  2: { bg: '#F7C1C1', fg: '#791F1F' },
  3: { bg: '#F09595', fg: '#501313' },
}

export function heatStyle(bucket: number): HeatStyle {
  if (bucket > 0) return UP[Math.min(bucket, 3)] ?? NEUTRAL
  if (bucket < 0) return DOWN[Math.min(-bucket, 3)] ?? NEUTRAL
  return NEUTRAL
}

/**
 * Signed −3..+3 bucket from a value's magnitude relative to the largest in the
 * set. Used where there is no prior-period %Δ (e.g. Version Diff V1→V2): the
 * biggest movement glows strongest, sign sets the colour.
 */
export function magnitudeBucket(value: number, max: number): number {
  if (value === 0 || max <= 0) return 0
  const r = Math.abs(value) / max
  const mag = r >= 0.5 ? 3 : r >= 0.15 ? 2 : 1
  return value > 0 ? mag : -mag
}
