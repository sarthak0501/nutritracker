/** Bind a rendered form to its account even when browser storage is unavailable. */
export function assertExpectedUser(actualUserId: string, expectedUserId: unknown): void {
  if (typeof expectedUserId !== "string" || !expectedUserId || expectedUserId !== actualUserId) {
    throw new Error("Your account changed. Refresh this page before saving.");
  }
}
