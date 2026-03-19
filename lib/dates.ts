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
