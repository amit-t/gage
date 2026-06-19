export interface CalDate {
  y: number;
  m: number; // 0-based month
  d: number;
}

export function toCalDate(date: Date): CalDate {
  return { y: date.getFullYear(), m: date.getMonth(), d: date.getDate() };
}

export function calToDate(c: CalDate): Date {
  return new Date(c.y, c.m, c.d, 0, 0, 0, 0);
}

function lastDayOfMonth(y: number, m: number): number {
  return new Date(y, m + 1, 0).getDate();
}

export function addMonthsCal(c: CalDate, months: number): CalDate {
  const idx = c.m + months;
  const y = c.y + Math.floor(idx / 12);
  const m = ((idx % 12) + 12) % 12;
  return { y, m, d: Math.min(c.d, lastDayOfMonth(y, m)) };
}

export function compareCal(a: CalDate, b: CalDate): number {
  return a.y - b.y || a.m - b.m || a.d - b.d;
}

export function monthlyPeriod(anchor: CalDate, today: CalDate): { start: CalDate; endExclusive: CalDate } {
  let cur = anchor;
  while (compareCal(cur, today) > 0) cur = addMonthsCal(cur, -1);
  while (compareCal(addMonthsCal(cur, 1), today) <= 0) cur = addMonthsCal(cur, 1);
  return { start: cur, endExclusive: addMonthsCal(cur, 1) };
}
