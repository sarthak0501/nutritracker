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

const ANNIVERSARY_MONTH = 4;
const ANNIVERSARY_DAY = 25;

export function isAnniversaryToday(): boolean {
  const [, m, d] = todayIsoDate().split("-").map(Number);
  return m === ANNIVERSARY_MONTH && d === ANNIVERSARY_DAY;
}

/** Days until the next April 25. 0 means today. */
export function daysUntilAnniversary(): number {
  const todayStr = todayIsoDate();
  const [y, m, d] = todayStr.split("-").map(Number);
  const todayMD = m * 100 + d;
  const annivMD = ANNIVERSARY_MONTH * 100 + ANNIVERSARY_DAY;
  const targetYear = todayMD > annivMD ? y + 1 : y;
  const todayDt = Date.UTC(y, m - 1, d);
  const targetDt = Date.UTC(targetYear, ANNIVERSARY_MONTH - 1, ANNIVERSARY_DAY);
  return Math.round((targetDt - todayDt) / 86_400_000);
}
