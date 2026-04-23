export type Anniversary = { month: number; day: number; weddingYear: number };

export type Personalization = {
  sweetheartUsername: string;
  partnerName: string | null;
  anniversary: Anniversary | null;
};

/**
 * Reads partner/anniversary configuration from env.
 * Returns null if SWEETHEART_USERNAME is unset — feature disabled.
 */
export function getPersonalization(): Personalization | null {
  const sweetheartUsername = process.env.SWEETHEART_USERNAME;
  if (!sweetheartUsername) return null;

  const partnerName = process.env.PARTNER_NAME?.trim() || null;

  let anniversary: Anniversary | null = null;
  const dateStr = process.env.ANNIVERSARY_DATE;
  if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [wy, wm, wd] = dateStr.split("-").map(Number);
    anniversary = { weddingYear: wy, month: wm, day: wd };
  }

  return { sweetheartUsername, partnerName, anniversary };
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}
