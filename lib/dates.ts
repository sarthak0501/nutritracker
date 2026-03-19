export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function isoDaysBack(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export function lastIsoDates(count: number): string[] {
  const dates: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    dates.push(isoDaysBack(i));
  }
  return dates;
}
