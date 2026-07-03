// Pure month-grid math for BusinessDayPicker. Built on Date.UTC exclusively
// (never `new Date(isoString)`) so grid layout can't shift a day under a
// browser running in a non-UTC timezone.

function pad2(n) {
  return String(n).padStart(2, '0')
}

// month is 1-indexed (1 = January), matching ISO date strings.
export function isoFromParts(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`
}

export function partsFromIso(iso) {
  const [year, month, day] = iso.split('-').map(Number)
  return { year, month, day }
}

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

// 0 = Sunday .. 6 = Saturday
export function weekdayOfFirst(year, month) {
  return new Date(Date.UTC(year, month - 1, 1)).getUTCDay()
}

export function addMonths(year, month, delta) {
  const total = month - 1 + delta
  const y = year + Math.floor(total / 12)
  const m = ((total % 12) + 12) % 12 + 1
  return { year: y, month: m }
}

// Returns a flat array whose length is a multiple of 7 (padded with null
// leading/trailing cells), one entry per grid cell: null, or {day, iso}.
export function buildMonthGrid(year, month) {
  const total = daysInMonth(year, month)
  const leading = weekdayOfFirst(year, month)
  const cells = []
  for (let i = 0; i < leading; i++) cells.push(null)
  for (let d = 1; d <= total; d++) cells.push({ day: d, iso: isoFromParts(year, month, d) })
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}
