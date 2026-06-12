const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** '2026-03-31' → '31 Mar 2026'. Falls back to the raw string. */
export function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  const month = MONTHS[Number(m[2]) - 1] ?? m[2]
  return `${m[3]} ${month} ${m[1]}`
}

/** Indian financial-year label from a period end, e.g. 2026-03-31 → 'FY 2025-26'. */
export function fyLabel(periodFrom: string | null, periodTo: string | null): string {
  if (periodFrom && periodTo) {
    const y1 = periodFrom.slice(0, 4)
    const y2 = periodTo.slice(2, 4)
    return `FY ${y1}-${y2}`
  }
  return ''
}
