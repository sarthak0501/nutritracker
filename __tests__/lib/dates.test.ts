import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { todayIsoDate, isoDaysBack, lastIsoDates } from "@/lib/dates";

// Pin time to 2024-06-15 noon UTC = 2024-06-15 in PST (UTC-7)
const FIXED_DATE_UTC = new Date("2024-06-15T19:00:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_DATE_UTC);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("todayIsoDate", () => {
  it("returns current date in PST/PDT as YYYY-MM-DD", () => {
    // 2024-06-15T19:00 UTC = 2024-06-15T12:00 PDT (UTC-7)
    expect(todayIsoDate()).toBe("2024-06-15");
  });

  it("formats date correctly as YYYY-MM-DD", () => {
    const result = todayIsoDate();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("isoDaysBack", () => {
  it("returns today for n=0", () => {
    expect(isoDaysBack(0)).toBe("2024-06-15");
  });

  it("returns yesterday for n=1", () => {
    expect(isoDaysBack(1)).toBe("2024-06-14");
  });

  it("returns correct date for n=7", () => {
    expect(isoDaysBack(7)).toBe("2024-06-08");
  });

  it("crosses month boundaries correctly", () => {
    // 15 days back from June 15 = June 0 = May 31
    expect(isoDaysBack(15)).toBe("2024-05-31");
  });

  it("returns YYYY-MM-DD formatted string", () => {
    expect(isoDaysBack(3)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("lastIsoDates", () => {
  it("returns array of length equal to count", () => {
    expect(lastIsoDates(7)).toHaveLength(7);
    expect(lastIsoDates(1)).toHaveLength(1);
    expect(lastIsoDates(30)).toHaveLength(30);
  });

  it("returns dates in ascending order (oldest first)", () => {
    const dates = lastIsoDates(3);
    expect(dates[0]).toBe("2024-06-13"); // 2 days ago
    expect(dates[1]).toBe("2024-06-14"); // 1 day ago
    expect(dates[2]).toBe("2024-06-15"); // today
  });

  it("last element is today", () => {
    const dates = lastIsoDates(5);
    expect(dates[dates.length - 1]).toBe("2024-06-15");
  });

  it("first element is count-1 days ago", () => {
    const dates = lastIsoDates(7);
    expect(dates[0]).toBe("2024-06-09");
  });

  it("returns empty array for count=0", () => {
    expect(lastIsoDates(0)).toHaveLength(0);
  });

  it("all elements match YYYY-MM-DD format", () => {
    const dates = lastIsoDates(10);
    for (const d of dates) {
      expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("dates are consecutive with no gaps", () => {
    const dates = lastIsoDates(5);
    for (let i = 1; i < dates.length; i++) {
      const prev = new Date(dates[i - 1]);
      const curr = new Date(dates[i]);
      const diffMs = curr.getTime() - prev.getTime();
      expect(diffMs).toBe(24 * 60 * 60 * 1000);
    }
  });
});
