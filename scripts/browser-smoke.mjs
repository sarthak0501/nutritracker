#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { fixtureClient, verifyFixture } from "./seed-ui-fixture.mjs";

const base = new URL(process.env.UI_TEST_URL || "http://localhost:3091");
assert.ok(["localhost", "127.0.0.1"].includes(base.hostname));
assert.equal(base.protocol, "http:");
assert.equal(base.port, "3091", "Use the isolated local fixture app server");
const fixture = JSON.parse(readFileSync(".test-state/ui-fixture.json", "utf8"));
assert.equal(fixture.fixtureOnly, true);
assert.equal(fixture.alex.username, "qa_alex");
assert.equal(fixture.jamie.username, "qa_jamie");
const db = fixtureClient();
await verifyFixture(db);
const dir = ".test-state/browser";
mkdirSync(dir, { recursive: true, mode: 0o700 });
const report = { fixtureOnly: true, url: base.origin, startedAt: new Date().toISOString(), steps: [], pageErrors: [], estimateRequests: [], externalRequests: [] };
const browser = await chromium.launch({ headless: true });
const alexContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 1 });
const jamieContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 1 });
let currentPage;
function observe(context) {
  context.on("page", (page) => {
    page.on("pageerror", (error) => report.pageErrors.push(error.message));
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith("/api/estimate")) report.estimateRequests.push(url.pathname);
      if (!['127.0.0.1', 'localhost'].includes(url.hostname) && /^https?:/.test(url.protocol)) report.externalRequests.push(url.origin);
    });
  });
}
observe(alexContext); observe(jamieContext);
const alex = await alexContext.newPage();
const jamie = await jamieContext.newPage();
currentPage = alex;
alex.setDefaultTimeout(15000); jamie.setDefaultTimeout(15000);
const region = (page, heading) => page.locator("section").filter({ has: page.getByRole("heading", { name: heading, exact: true }) });
const library = (page) => region(page, "Your meal shortcuts");
const checkIn = (page) => region(page, "A small weekly win, together");
async function login(page, user) {
  await page.goto(`${base.origin}/login`);
  await page.getByLabel("Username", { exact: true }).fill(user.username);
  await page.getByLabel("Password", { exact: true }).fill(fixture.password);
  await page.getByRole("button", { name: "Get started", exact: true }).click();
  await page.waitForURL(`${base.origin}/`);
  await page.getByRole("heading", { name: "Your meal shortcuts", exact: true }).waitFor();
}
async function poll(check, message) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}
async function step(name, fn) {
  const started = Date.now();
  try { await fn(); report.steps.push({ name, status: "passed", elapsedMs: Date.now() - started }); console.log(`PASS ${name}`); }
  catch (error) { report.steps.push({ name, status: "failed", error: error.message }); throw error; }
}
const entryCount = (userId) => db.logEntry.count({ where: { userId } });
const nutrientTotal = (entries) => entries.reduce((sum, row) => sum + row.snapshotKcal, 0);
const prefix = "nutritracker:meal-draft:v1:";
try {
  await step("mobile real login and install metadata", async () => {
    await login(alex, fixture.alex);
    const viewport = await alex.locator('meta[name="viewport"]').getAttribute("content");
    assert.ok(!/user-scalable=no|maximum-scale=1(?:,|$)/.test(viewport || ""));
    const manifestUrl = await alex.locator('link[rel="manifest"]').getAttribute("href");
    assert.ok(manifestUrl);
    const response = await alex.request.get(new URL(manifestUrl, base.origin).href);
    assert.equal(response.status(), 200);
    const manifest = await response.json();
    assert.equal(manifest.display, "standalone");
    assert.ok(manifest.icons.length > 0);
    assert.ok(await alex.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await alex.screenshot({ path: `${dir}/01-home-mobile-390.png`, fullPage: true });
  });

  await step("manual zero macros save atomically and Undo removes just that addition", async () => {
    const count = await entryCount(fixture.alex.id);
    await alex.getByRole("button", { name: "Create food from a nutrition label" }).click();
    const form = alex.locator("form").filter({ has: alex.getByLabel("Food name", { exact: true }) });
    await form.getByLabel("Food name", { exact: true }).fill("QA Zero nutrition");
    await form.getByLabel("Amount eaten (g)", { exact: true }).fill("250");
    for (const name of ["Calories", "Protein (g)", "Carbs (g)", "Fat (g)", "Fiber (g, optional)"]) await form.getByLabel(name, { exact: true }).fill("0");
    await form.getByRole("button", { name: "Save entry", exact: true }).click();
    await poll(async () => await entryCount(fixture.alex.id) === count + 1, "Manual zero save did not add exactly one entry");
    const entry = await db.logEntry.findFirstOrThrow({ where: { userId: fixture.alex.id, food: { name: "QA Zero nutrition" } } });
    assert.deepEqual([entry.snapshotKcal, entry.snapshotProteinG, entry.snapshotCarbsG, entry.snapshotFatG, entry.snapshotFiberG], [0, 0, 0, 0, 0]);
    await alex.getByRole("button", { name: "Undo", exact: true }).click();
    await poll(async () => await entryCount(fixture.alex.id) === count, "Manual Undo did not restore the prior count");
  });

  await step("repeat half of a legacy meal uses snapshots, then save a named pinned preset", async () => {
    await library(alex).getByRole("button", { name: /Repeat last meal/ }).click();
    await library(alex).getByLabel("Your portion ×", { exact: true }).fill("0.5");
    await library(alex).getByRole("button", { name: "Save to my log", exact: true }).click();
    await library(alex).getByText("✓ Saved. Choose another meal above when you’re ready.", { exact: true }).waitFor();
    const batch = await db.logBatch.findFirstOrThrow({ where: { userId: fixture.alex.id, kind: "REPEAT_MEAL" }, orderBy: { createdAt: "desc" }, include: { entries: true } });
    assert.equal(batch.entries.length, 2);
    assert.equal(nutrientTotal(batch.entries), 78);
    assert.equal((await db.logEntry.findUniqueOrThrow({ where: { id: fixture.entryIds[0] } })).snapshotKcal, 156);
    await library(alex).getByText("Save a shortcut or share this meal", { exact: true }).click();
    await library(alex).getByLabel("Meal name", { exact: true }).fill("QA Half usual lunch");
    await library(alex).getByRole("button", { name: "★ Save as pinned meal", exact: true }).click();
    await library(alex).getByRole("button", { name: "✓ Shortcut saved", exact: true }).waitFor();
    const saved = await db.savedMeal.findFirstOrThrow({ where: { userId: fixture.alex.id, name: "QA Half usual lunch" } });
    assert.equal(saved.pinned, true);
    assert.equal(saved.items.reduce((sum, item) => sum + item.snapshotKcal, 0), 78);
  });

  await step("pinned whole meal repeats without estimating again", async () => {
    await library(alex).getByRole("button", { name: "Close meal review", exact: true }).click();
    await library(alex).getByRole("button", { name: /★ QA Half usual lunch/ }).click();
    const count = await entryCount(fixture.alex.id);
    await library(alex).getByRole("button", { name: "Save to my log", exact: true }).click();
    await poll(async () => await entryCount(fixture.alex.id) === count + 2, "Pinned meal did not add exactly two entries");
    const batch = await db.logBatch.findFirstOrThrow({ where: { userId: fixture.alex.id, kind: "REPEAT_MEAL" }, orderBy: { createdAt: "desc" }, include: { entries: true } });
    assert.equal(nutrientTotal(batch.entries), 78);
    assert.equal(report.estimateRequests.length, 0);
  });

  await step("sharing creates only a pending proposal and recipient chooses independent date and portion", async () => {
    await library(alex).getByText("Save a shortcut or share this meal", { exact: true }).click();
    const count = await entryCount(fixture.jamie.id);
    await library(alex).getByRole("button", { name: "Propose to qa_jamie", exact: true }).click();
    await library(alex).getByRole("button", { name: "✓ Proposed to qa_jamie", exact: true }).waitFor();
    assert.equal(await entryCount(fixture.jamie.id), count);
    const proposal = await db.mealProposal.findFirstOrThrow({ where: { senderId: fixture.alex.id, recipientId: fixture.jamie.id }, orderBy: { createdAt: "desc" } });
    assert.equal(proposal.status, "PENDING");
    currentPage = jamie;
    await login(jamie, fixture.jamie);
    const shared = region(jamie, "Shared meals");
    await shared.getByLabel("Your portion ×", { exact: true }).fill("0.5");
    const nextDate = new Date(`${fixture.date}T12:00:00Z`);
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);
    const date = nextDate.toISOString().slice(0, 10);
    await shared.getByLabel("Your log date", { exact: true }).fill(date);
    await shared.locator("select").selectOption("DINNER");
    await shared.getByRole("button", { name: "Accept & save to my log", exact: true }).click();
    await poll(async () => await entryCount(fixture.jamie.id) === count + 2, "Accepting did not add the selected two items");
    const accepted = await db.mealProposal.findUniqueOrThrow({ where: { id: proposal.id } });
    assert.equal(accepted.status, "ACCEPTED");
    const entries = await db.logEntry.findMany({ where: { batchId: accepted.acceptedBatchId } });
    assert.equal(nutrientTotal(entries), 39);
    assert.ok(entries.every((entry) => entry.date === date && entry.mealType === "DINNER" && entry.sourceText === null));
    await jamie.screenshot({ path: `${dir}/02-recipient-after-accept.png`, fullPage: true });
    currentPage = alex;
  });

  await step("weekly check-in opt-in leaves the buddy's preference unchanged", async () => {
    await checkIn(alex).getByRole("button", { name: "Try weekly check-ins", exact: true }).click();
    await checkIn(alex).getByRole("button", { name: "I’ve checked in this week", exact: true }).click();
    assert.equal((await db.profile.findUniqueOrThrow({ where: { userId: fixture.alex.id } })).cooperativeCheckInEnabled, true);
    assert.equal((await db.profile.findUniqueOrThrow({ where: { userId: fixture.jamie.id } })).cooperativeCheckInEnabled, false);
    await jamie.reload();
    await checkIn(jamie).getByRole("button", { name: "Try weekly check-ins", exact: true }).waitFor();
    assert.equal(await checkIn(jamie).getByText(/qa_alex:.*checked in/).count(), 0);
  });

  await step("draft survives reload, expired and malformed drafts are discarded", async () => {
    await alex.getByRole("button", { name: "Describe meal", exact: true }).click();
    await alex.getByLabel(/What did you eat\?/ ).fill("QA draft: beans and rice, not yet logged");
    await poll(() => alex.evaluate((prefix) => Object.keys(localStorage).some((key) => key.startsWith(prefix)), prefix), "Draft was not persisted");
    await alex.reload();
    await alex.getByRole("button", { name: "Describe meal", exact: true }).click();
    assert.equal(await alex.getByLabel(/What did you eat\?/ ).inputValue(), "QA draft: beans and rice, not yet logged");
    await alex.evaluate((prefix) => {
      for (const key of Object.keys(localStorage).filter((key) => key.startsWith(prefix))) {
        const value = JSON.parse(localStorage.getItem(key)); value.savedAt = Date.now() - 25 * 60 * 60 * 1000; localStorage.setItem(key, JSON.stringify(value));
      }
    }, prefix);
    await alex.reload();
    await alex.getByRole("button", { name: "Describe meal", exact: true }).click();
    assert.equal(await alex.getByLabel(/What did you eat\?/ ).inputValue(), "");
    await alex.evaluate(({ prefix, id, date }) => localStorage.setItem(`${prefix}${id}:${date}:single`, "invalid JSON"), { prefix, id: fixture.alex.id, date: fixture.date });
    await alex.reload();
    await alex.getByRole("button", { name: "Describe meal", exact: true }).click();
    assert.equal(await alex.getByLabel(/What did you eat\?/ ).inputValue(), "");
  });

  await step("mobile 316px layout, History and Buddy render without horizontal overflow", async () => {
    await alex.setViewportSize({ width: 316, height: 844 });
    for (const path of ["/", "/history", "/buddy"]) {
      await alex.goto(`${base.origin}${path}`);
      await alex.locator("#main-content").waitFor();
      assert.ok(await alex.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `Horizontal overflow on ${path}`);
      await alex.screenshot({ path: `${dir}/03-${path === "/" ? "home" : path.slice(1)}-316.png`, fullPage: true });
    }
    await alex.goto(base.origin);
  });

  await step("logout clears drafts across tabs and hides stale account content", async () => {
    await alex.getByRole("button", { name: "Describe meal", exact: true }).click();
    await alex.getByLabel(/What did you eat\?/ ).fill("QA private draft for Alex only");
    const otherTab = await alexContext.newPage();
    await otherTab.goto(base.origin);
    await otherTab.getByRole("button", { name: "Log out qa_alex", exact: true }).click();
    await otherTab.waitForURL(`${base.origin}/login`);
    await alex.getByRole("alertdialog").waitFor();
    assert.equal(await alex.locator("#main-content").evaluate((el) => el.inert && getComputedStyle(el).visibility === "hidden"), true);
    assert.equal(await alex.evaluate((prefix) => Object.keys(localStorage).filter((key) => key.startsWith(prefix)).length, prefix), 0);
    await login(otherTab, fixture.jamie);
    await alex.getByRole("button", { name: "Reload securely", exact: true }).click();
    await alex.getByRole("heading", { name: "Your meal shortcuts", exact: true }).waitFor();
    await alex.getByRole("button", { name: "Describe meal", exact: true }).click();
    assert.equal(await alex.getByLabel(/What did you eat\?/ ).inputValue(), "");
    await otherTab.close();
  });

  await step("server rejects stale-account save even when local storage is unavailable", async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    observe(context);
    await context.addInitScript(() => { Object.defineProperty(window, "localStorage", { get() { throw new DOMException("Disabled for fixture test", "SecurityError"); } }); });
    const stale = await context.newPage();
    const switched = await context.newPage();
    currentPage = stale;
    await login(stale, fixture.alex);
    await library(stale).getByRole("button", { name: /Repeat last meal/ }).click();
    await context.clearCookies();
    await login(switched, fixture.jamie);
    const counts = [await entryCount(fixture.alex.id), await entryCount(fixture.jamie.id)];
    await library(stale).getByRole("button", { name: "Save to my log", exact: true }).click();
    await library(stale).getByRole("alert").waitFor();
    assert.deepEqual([await entryCount(fixture.alex.id), await entryCount(fixture.jamie.id)], counts);
    await stale.screenshot({ path: `${dir}/04-stale-account-rejected.png`, fullPage: true });
    await context.close();
    currentPage = alex;
  });

  await step("known-meal flows made no estimate requests or page exceptions", async () => {
    assert.deepEqual(report.estimateRequests, []);
    assert.deepEqual(report.pageErrors, []);
  });
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error.stack;
  console.error(error.message);
  if (currentPage && !currentPage.isClosed()) {
    await currentPage.screenshot({ path: `${dir}/failure.png`, fullPage: true }).catch(() => {});
    writeFileSync(`${dir}/failure.html`, await currentPage.content().catch(() => ""), { mode: 0o600 });
  }
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  writeFileSync(`${dir}/report.json`, JSON.stringify(report, null, 2), { mode: 0o600 });
  await browser.close();
  await db.$disconnect();
}
