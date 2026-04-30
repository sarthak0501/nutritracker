/**
 * scripts/capture-screenshots.ts
 *
 * Captures README screenshots + demo GIF against a running NutriTracker instance.
 * Intended to be run LOCALLY on Sarthak's Mac, where *.vercel.app and Neon are reachable.
 *
 * Reads credentials from env — nothing is inlined. Safe to commit this file.
 *
 * Usage:
 *   npm i -D playwright
 *   npx playwright install chromium
 *   NT_USERNAME=sarthak NT_PASSWORD='...' npx tsx scripts/capture-screenshots.ts
 *
 * Optional:
 *   NT_BASE_URL=https://nutritracker-two.vercel.app   (default)
 *   NT_SKIP_GIF=1                                     (skip the video → gif step)
 *   NT_KEEP_TEST_MEAL=1                               (don't try to auto-delete the logged meal)
 *
 * Requires ffmpeg on PATH for the GIF step (brew install ffmpeg).
 */

import { chromium, type Page } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, renameSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const OUT_DIR = join(REPO_ROOT, "docs", "screenshots");
const VIDEO_DIR = join(REPO_ROOT, ".playwright-video");

const BASE_URL = (process.env.NT_BASE_URL ?? "https://nutritracker-two.vercel.app").replace(/\/$/, "");
const USERNAME = process.env.NT_USERNAME;
const PASSWORD = process.env.NT_PASSWORD;
const SKIP_GIF = process.env.NT_SKIP_GIF === "1";
const KEEP_MEAL = process.env.NT_KEEP_TEST_MEAL === "1";
const VIEWPORT = { width: 1280, height: 800 };
const AI_TEXT = "2 scrambled eggs, toast, banana";

if (!USERNAME || !PASSWORD) {
  console.error("✗ Set NT_USERNAME and NT_PASSWORD in the environment.");
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(VIDEO_DIR, { recursive: true });

async function login(page: Page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });
  await page.fill('input[name="username"]', USERNAME!);
  await page.fill('input[name="password"]', PASSWORD!);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 }),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForLoadState("networkidle");
}

async function gotoAndSettle(page: Page, path: string) {
  await page.goto(`${BASE_URL}${path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
}

async function shot(page: Page, name: string, opts: { fullPage?: boolean } = {}) {
  const out = join(OUT_DIR, name);
  await page.screenshot({ path: out, fullPage: opts.fullPage ?? false });
  console.log(`  ✓ ${name}`);
}

async function captureStills() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();

  console.log("→ logging in");
  await login(page);

  console.log("→ capturing stills");
  // 1. today.png — home after login
  await gotoAndSettle(page, "/");
  await shot(page, "today.png");

  // 2. ai-logging.png — composer filled, estimate visible, NOT saved
  await page.fill("textarea", AI_TEXT);
  // Click the primary CTA whose text is exactly the single-meal estimator label
  await page.getByRole("button", { name: /estimate nutrition/i }).click();
  // Wait for the result card (contains "Save meal" button) but don't click it
  await page.getByRole("button", { name: /save meal/i }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(400);
  await shot(page, "ai-logging.png");

  // 3. buddy.png — scroll to the buddy feed on Today (fall back to /buddy if not present)
  await gotoAndSettle(page, "/");
  let buddyAnchor = page.getByRole("heading", { name: /buddy|friends|feed/i }).first();
  if (await buddyAnchor.count().catch(() => 0)) {
    await buddyAnchor.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await shot(page, "buddy.png");
  } else {
    await gotoAndSettle(page, "/buddy");
    await shot(page, "buddy.png");
  }

  // 4. trends.png
  await gotoAndSettle(page, "/trends");
  // Recharts SVGs need a tick to render
  await page.waitForTimeout(1200);
  await shot(page, "trends.png");

  // 5. history.png
  await gotoAndSettle(page, "/history");
  await page.waitForTimeout(800);
  await shot(page, "history.png");

  // 6. profile.png — scroll so the health profile section is visible
  await gotoAndSettle(page, "/profile");
  const health = page.getByText(/allerg|conditions|dietary/i).first();
  if (await health.count().catch(() => 0)) {
    await health.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
  }
  await shot(page, "profile.png");

  await context.close();
  await browser.close();
}

async function captureGif() {
  if (SKIP_GIF) {
    console.log("→ skipping GIF (NT_SKIP_GIF=1)");
    return null;
  }

  // Verify ffmpeg up-front so we don't waste the recording
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
  } catch {
    console.warn("⚠ ffmpeg not found on PATH — skipping GIF. `brew install ffmpeg` and re-run with NT_SKIP_GIF unset.");
    return null;
  }

  console.log("→ recording demo flow");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: { dir: VIDEO_DIR, size: VIEWPORT },
  });
  const page = await context.newPage();

  await login(page);
  await gotoAndSettle(page, "/");

  // Small pause so the video opens on the clean Today page
  await page.waitForTimeout(800);

  // Type the meal, slowly, so it's legible in the GIF
  await page.locator("textarea").first().click();
  await page.keyboard.type(AI_TEXT, { delay: 60 });
  await page.waitForTimeout(300);

  await page.getByRole("button", { name: /estimate nutrition/i }).click();
  await page.getByRole("button", { name: /save meal/i }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(800); // let user read the preview

  await page.getByRole("button", { name: /save meal/i }).click();
  // Wait for the save to complete — macro bars update when the page revalidates
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1200);

  // Close context to finalize the video file
  await context.close();
  await browser.close();

  // Find the most recently created webm
  const files = readdirSync(VIDEO_DIR).filter((f) => f.endsWith(".webm"));
  if (files.length === 0) {
    console.warn("⚠ No .webm produced — skipping GIF.");
    return null;
  }
  files.sort();
  const webm = join(VIDEO_DIR, files[files.length - 1]);
  const gif = join(OUT_DIR, "ai-logging.gif");

  console.log("→ converting to gif");
  // fps=15, max width 900, quality-preserving palette
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-i", webm,
      "-vf", "fps=15,scale=900:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse",
      "-loop", "0",
      gif,
    ],
    { stdio: "inherit" },
  );
  console.log(`  ✓ ai-logging.gif`);

  // Cleanup video dir
  try { rmSync(VIDEO_DIR, { recursive: true, force: true }); } catch {}
  return gif;
}

async function cleanupTestMeal() {
  if (KEEP_MEAL) {
    console.log("→ skipping meal cleanup (NT_KEEP_TEST_MEAL=1)");
    return;
  }
  console.log("→ deleting test meal via UI");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  try {
    await login(page);
    await gotoAndSettle(page, "/");

    // Strategy: find any LogEntryCard whose card text contains one of the test tokens.
    // LogEntryCard renders a delete button with title="Delete" (or aria-label).
    // We click up to 3 matches to be safe.
    const tokens = ["scrambled eggs", "Scrambled eggs", "banana", "toast"];
    let deleted = 0;
    for (let i = 0; i < 5; i++) {
      let matched = false;
      for (const token of tokens) {
        const card = page.locator("div").filter({ hasText: token }).first();
        if (!(await card.count().catch(() => 0))) continue;
        const del = card.locator('button[title="Delete" i], button[aria-label*="delete" i]').first();
        if (!(await del.count().catch(() => 0))) continue;
        await del.click().catch(() => {});
        await page.waitForTimeout(600);
        deleted++;
        matched = true;
        break;
      }
      if (!matched) break;
    }
    if (deleted === 0) {
      console.warn("⚠ Could not auto-locate the test meal card. Delete it manually in the UI.");
    } else {
      console.log(`  ✓ clicked delete on ${deleted} matching card(s)`);
    }
  } finally {
    await context.close();
    await browser.close();
  }
}

(async () => {
  console.log(`\nCapture target: ${BASE_URL}\nOut dir: ${OUT_DIR}\n`);
  await captureStills();
  await captureGif();
  await cleanupTestMeal();

  // Clean the empty video dir if it's still around
  if (existsSync(VIDEO_DIR)) {
    try { rmSync(VIDEO_DIR, { recursive: true, force: true }); } catch {}
  }

  console.log("\nDone. Files in docs/screenshots/:");
  for (const f of readdirSync(OUT_DIR).sort()) console.log("  " + f);
})().catch((err) => {
  console.error("✗", err);
  process.exit(1);
});
