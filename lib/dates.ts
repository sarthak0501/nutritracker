const TZ = "America/Los_Angeles";

/** Current date in PST/PDT as YYYY-MM-DD */
export function todayIsoDate(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ });
}

/** Date N days ago in PST/PDT as YYYY-MM-DD */
export function isoDaysBack(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString("en-CA", { timeZone: TZ });
}

export function lastIsoDates(count: number): string[] {
  const dates: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    dates.push(isoDaysBack(i));
  }
  return dates;
}

export function isAnniversaryToday(month: number, day: number): boolean {
  const [, m, d] = todayIsoDate().split("-").map(Number);
  return m === month && d === day;
}

/** Days until the next {month}/{day}. 0 means today. */
export function daysUntilAnniversary(month: number, day: number): number {
  const todayStr = todayIsoDate();
  const [y, m, d] = todayStr.split("-").map(Number);
  const todayMD = m * 100 + d;
  const annivMD = month * 100 + day;
  const targetYear = todayMD > annivMD ? y + 1 : y;
  const todayDt = Date.UTC(y, m - 1, d);
  const targetDt = Date.UTC(targetYear, month - 1, day);
  return Math.round((targetDt - todayDt) / 86_400_000);
}

/** Year count for an anniversary as of today (e.g. wedding 2025 + today 2026-04-25 = 1) */
export function anniversaryYearCount(weddingYear: number, month: number, day: number): number {
  const [ty, tm, td] = todayIsoDate().split("-").map(Number);
  const hasPassedThisYear = tm * 100 + td >= month * 100 + day;
  return ty - weddingYear - (hasPassedThisYear ? 0 : 1);
}

/** Calendar days between wedding date and today. */
export function daysSinceWedding(weddingYear: number, month: number, day: number): number {
  const [ty, tm, td] = todayIsoDate().split("-").map(Number);
  const start = Date.UTC(weddingYear, month - 1, day);
  const today = Date.UTC(ty, tm - 1, td);
  return Math.round((today - start) / 86_400_000);
}
