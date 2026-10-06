import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { prisma } from "../lib/db";
import { insertMealSnapshots, snapshotMealEntry, undoMealBatch, withMealBatch } from "../lib/meal-writes";
import {
  completeWeeklyCheckInForUser, deleteMealPresetForUser, getMealLibrary,
  logLibraryMealForUser, proposeSharedMealForUser, respondMealProposalForUser,
  saveMealPresetForUser, setCooperativeCheckInForUser, updateMealPresetForUser,
} from "../lib/meal-library";

// Integration tests must never run against an application or remote database.
const url = new URL(process.env.DATABASE_URL || "file:///missing-fixture-database");
assert.equal(url.protocol, "postgresql:", "Start the private fixture DB with scripts/test-db.mjs run");
assert.equal(url.hostname, "localhost");
assert.equal(url.username, "nt_fixture");
assert.equal(url.pathname, "/nutritracker_test");
assert.match(url.searchParams.get("host") || "", /^\/.*\/nt-fixture-[a-f0-9]{12}\/socket$/);

const userIds: string[] = [];
const foodIds: string[] = [];
const date = "2026-10-05";

before(async () => {
  const [settings] = await prisma.$queryRaw<Array<{ database: string; listen: string }>>`SELECT current_database() AS database, current_setting('listen_addresses') AS listen`;
  assert.equal(settings.database, "nutritracker_test");
  assert.equal(settings.listen, "", "Fixture PostgreSQL must not listen on TCP");
});

after(async () => {
  // Only remove IDs created by this run; never truncate tables or touch other fixtures.
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.food.deleteMany({ where: { id: { in: foodIds } } });
  await prisma.$disconnect();
});

async function fixture() {
  const users = await Promise.all(["sender", "recipient", "outsider"].map(async (role) => {
    const user = await prisma.user.create({ data: {
      username: `fixture-${role}-${randomUUID()}`, passwordHash: "fixture-no-login",
      profile: { create: { allergies: [role], kcalTarget: role === "recipient" ? 1700 : 2200 } },
    } });
    userIds.push(user.id);
    return user;
  }));
  const [sender, recipient, outsider] = users;
  const relationship = await prisma.buddyRelationship.create({ data: { requesterId: sender.id, addresseeId: recipient.id, status: "ACCEPTED" } });
  const legacyFood = await prisma.food.create({ data: {
    name: `Legacy roti ${randomUUID()}`, source: "LLM", createdByUserId: sender.id,
    kcalPer100g: 7800, proteinPer100g: 240, carbsPer100g: 1560, fatPer100g: 70, fiberPer100g: 100,
    nutritionBasis: null,
  } });
  const zeroFood = await prisma.food.create({ data: {
    name: `Sparkling water ${randomUUID()}`, source: "MANUAL", createdByUserId: sender.id,
    kcalPer100g: 0, proteinPer100g: 0, carbsPer100g: 0, fatPer100g: 0, fiberPer100g: 0, nutritionBasis: "GRAMS",
  } });
  foodIds.push(legacyFood.id, zeroFood.id);
  const first = await prisma.logEntry.create({ data: {
    userId: sender.id, foodId: legacyFood.id, date, mealType: "LUNCH", mealName: "Roti and water",
    amount: 2, unit: "GRAM", isEstimated: true, sourceText: "two rotis",
    estimationMeta: { originalUnit: "roti", originalQuantity: 2, confidence: 0.7 },
    snapshotKcal: 156, snapshotProteinG: 4.8, snapshotCarbsG: 31.2, snapshotFatG: 1.4, snapshotFiberG: 2,
  }, include: { food: true } });
  const second = await prisma.logEntry.create({ data: {
    userId: sender.id, foodId: zeroFood.id, date, mealType: "LUNCH", mealName: "Roti and water",
    amount: 250, unit: "GRAM", isEstimated: false,
    snapshotKcal: 0, snapshotProteinG: 0, snapshotCarbsG: 0, snapshotFatG: 0, snapshotFiberG: 0,
  }, include: { food: true } });
  return { sender, recipient, outsider, relationship, legacyFood, zeroFood, entries: [first, second],
    source: { kind: "entries" as const, entryIds: [first.id, second.id] } };
}

test("database transaction rolls back a new Food, entries, and request key after a partial-write failure", async () => {
  const f = await fixture();
  const requestId = randomUUID();
  const foodName = `rollback-food-${randomUUID()}`;
  await assert.rejects(withMealBatch({ userId: f.sender.id, requestId, kind: "TEST_FAILURE" }, async (tx, batchId) => {
    const food = await tx.food.create({ data: { name: foodName, kcalPer100g: 0, proteinPer100g: 0, carbsPer100g: 0, fatPer100g: 0 } });
    await insertMealSnapshots(tx, { userId: f.sender.id, batchId, date, items: [{ ...snapshotMealEntry(f.entries[1]), foodId: food.id }] });
    throw new Error("fixture interruption after first insert");
  }), /fixture interruption/);
  assert.equal(await prisma.food.count({ where: { name: foodName } }), 0);
  assert.equal(await prisma.logBatch.count({ where: { userId: f.sender.id, requestId } }), 0);
  assert.equal(await prisma.logEntry.count({ where: { userId: f.sender.id } }), 2);
});

test("concurrent duplicate saves produce one batch; Undo is idempotent and its tombstone prevents retry resurrection", async () => {
  const f = await fixture();
  const requestId = randomUUID();
  let writes = 0;
  const save = () => withMealBatch({ userId: f.sender.id, requestId, kind: "TEST_RETRY" }, async (tx, batchId) => {
    writes++;
    return insertMealSnapshots(tx, { userId: f.sender.id, batchId, date, items: f.entries.map((entry) => snapshotMealEntry(entry)) });
  });
  const results = await Promise.all(Array.from({ length: 6 }, save));
  assert.equal(new Set(results.map((result) => result.batchId)).size, 1);
  assert.equal(writes, 1);
  assert.equal(await prisma.logEntry.count({ where: { batchId: results[0].batchId } }), 2);
  assert.ok(results.every((result) => result.entryCount === 2));
  const undone = await Promise.all([undoMealBatch(f.sender.id, results[0].batchId), undoMealBatch(f.sender.id, results[0].batchId)]);
  assert.equal(undone.reduce((sum, result) => sum + result.entryCount, 0), 2);
  assert.equal(await prisma.logEntry.count({ where: { batchId: results[0].batchId } }), 0);
  const retry = await save();
  assert.equal(retry.undone, true);
  assert.equal(retry.alreadySaved, true);
  assert.equal(retry.entryCount, 0);
  assert.equal(writes, 1);
  assert.ok((await prisma.logBatch.findUniqueOrThrow({ where: { id: results[0].batchId } })).undoneAt);
});

test("request keys and Undo are account scoped, with expired Undo preserving entries", async () => {
  const f = await fixture();
  const requestId = randomUUID();
  const results = await Promise.all([f.sender.id, f.recipient.id].map((userId) => withMealBatch({ userId, requestId, kind: "TEST_ACCOUNT" },
    (tx, batchId) => insertMealSnapshots(tx, { userId, batchId, date, items: [snapshotMealEntry(f.entries[0])] }))));
  assert.notEqual(results[0].batchId, results[1].batchId);
  await assert.rejects(undoMealBatch(f.recipient.id, results[0].batchId), /not found/);
  await prisma.logBatch.update({ where: { id: results[0].batchId }, data: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) } });
  await assert.rejects(undoMealBatch(f.sender.id, results[0].batchId), /24 hours/);
  assert.equal(await prisma.logEntry.count({ where: { batchId: results[0].batchId } }), 1);
});

test("whole-meal presets preserve legacy snapshots and zero nutrients while independently scaling new copies", async () => {
  const f = await fixture();
  const before = await prisma.logEntry.findMany({ where: { id: { in: f.source.entryIds } }, orderBy: { id: "asc" } });
  // A later catalog edit must not rewrite or influence recorded nutrition.
  await prisma.food.update({ where: { id: f.legacyFood.id }, data: { kcalPer100g: 99999, proteinPer100g: 999 } });
  const preset = await saveMealPresetForUser(f.sender.id, { name: "Weekday lunch", source: f.source });
  const result = await logLibraryMealForUser(f.sender.id, { requestId: randomUUID(), source: { kind: "saved", id: preset.id }, date: "2026-10-06", mealType: "DINNER", multiplier: 0.5 });
  const copies = await prisma.logEntry.findMany({ where: { batchId: result.batchId }, orderBy: { foodId: "asc" } });
  const roti = copies.find((entry) => entry.foodId === f.legacyFood.id)!;
  const water = copies.find((entry) => entry.foodId === f.zeroFood.id)!;
  assert.equal(copies.length, 2);
  assert.equal(roti.amount, 1);
  assert.equal(roti.snapshotKcal, 78);
  assert.equal(roti.snapshotProteinG, 2.4);
  assert.equal(roti.sourceText, "two rotis");
  assert.equal(roti.isEstimated, true);
  assert.equal((roti.estimationMeta as { originalUnit: string }).originalUnit, "roti");
  assert.equal(water.snapshotKcal, 0);
  assert.equal(water.snapshotProteinG, 0);
  assert.equal(water.snapshotFiberG, 0);
  assert.ok(copies.every((entry) => entry.date === "2026-10-06" && entry.mealType === "DINNER"));
  assert.deepEqual(await prisma.logEntry.findMany({ where: { id: { in: f.source.entryIds } }, orderBy: { id: "asc" } }), before);
});

test("foreign entries and saved meals cannot be read, logged, renamed, or removed through another account", async () => {
  const f = await fixture();
  const saved = await saveMealPresetForUser(f.sender.id, { name: "Private meal", source: f.source });
  await assert.rejects(saveMealPresetForUser(f.recipient.id, { name: "Stolen", source: f.source }), /does not belong/);
  await assert.rejects(logLibraryMealForUser(f.recipient.id, { requestId: randomUUID(), source: { kind: "saved", id: saved.id }, date, mealType: "LUNCH" }), /not found/);
  await assert.rejects(updateMealPresetForUser(f.recipient.id, { id: saved.id, name: "Changed", pinned: false }), /not found/);
  await deleteMealPresetForUser(f.recipient.id, saved.id);
  assert.equal((await prisma.savedMeal.findUniqueOrThrow({ where: { id: saved.id } })).name, "Private meal");
  const recipientLibrary = await getMealLibrary(f.recipient.id);
  assert.equal(recipientLibrary.saved.length, 0);
  assert.equal(recipientLibrary.recent.length, 0);
  assert.equal(await prisma.logBatch.count({ where: { userId: f.recipient.id } }), 0);
});

test("concurrent preset and proposal retries each create one object without creating recipient log entries", async () => {
  const f = await fixture();
  const requestId = randomUUID();
  const presets = await Promise.all(Array.from({ length: 6 }, () => saveMealPresetForUser(f.sender.id, { requestId, name: "Retry-safe shortcut", source: f.source })));
  assert.equal(new Set(presets.map((preset) => preset.id)).size, 1);
  assert.equal(await prisma.savedMeal.count({ where: { userId: f.sender.id } }), 1);
  const proposals = await Promise.all(Array.from({ length: 6 }, () => proposeSharedMealForUser(f.sender.id, {
    requestId, source: { kind: "saved", id: presets[0].id }, recipientId: f.recipient.id, date, mealType: "LUNCH",
  })));
  assert.equal(new Set(proposals.map((proposal) => proposal.proposalId)).size, 1);
  assert.equal(await prisma.mealProposal.count({ where: { senderId: f.sender.id } }), 1);
  assert.equal(await prisma.logEntry.count({ where: { userId: f.recipient.id } }), 0);
  assert.equal(await prisma.logBatch.count({ where: { userId: f.recipient.id } }), 0);
});

test("sharing requires recipient acceptance and preserves their chosen date, meal, portion, and preferences", async () => {
  const f = await fixture();
  const profileBefore = await prisma.profile.findUniqueOrThrow({ where: { userId: f.recipient.id } });
  const senderBefore = await prisma.logEntry.findMany({ where: { userId: f.sender.id }, orderBy: { id: "asc" } });
  const input = { requestId: randomUUID(), source: f.source, recipientId: f.recipient.id, name: "Lunch together", date, mealType: "LUNCH", multiplier: 1 };
  const proposal = await proposeSharedMealForUser(f.sender.id, input);
  const duplicate = await proposeSharedMealForUser(f.sender.id, input);
  assert.equal(proposal.proposalId, duplicate.proposalId);
  assert.equal(await prisma.logEntry.count({ where: { userId: f.recipient.id } }), 0);
  assert.equal(await prisma.logBatch.count({ where: { userId: f.recipient.id } }), 0);
  for (const actor of [f.sender, f.outsider]) {
    await assert.rejects(respondMealProposalForUser(actor.id, { proposalId: proposal.proposalId, action: "accept", date, mealType: "LUNCH" }), /not available/);
  }
  const accepted = await respondMealProposalForUser(f.recipient.id, { proposalId: proposal.proposalId, action: "accept", date: "2026-10-07", mealType: "DINNER", multiplier: 1.5, selectedItemIds: [f.entries[0].id] });
  const entries = await prisma.logEntry.findMany({ where: { batchId: accepted.batchId } });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].userId, f.recipient.id);
  assert.equal(entries[0].date, "2026-10-07");
  assert.equal(entries[0].mealType, "DINNER");
  assert.equal(entries[0].amount, 3);
  assert.equal(entries[0].snapshotKcal, 234);
  assert.deepEqual(await prisma.profile.findUniqueOrThrow({ where: { userId: f.recipient.id } }), profileBefore);
  assert.deepEqual(await prisma.logEntry.findMany({ where: { userId: f.sender.id }, orderBy: { id: "asc" } }), senderBefore);
});

test("incoming meals include all accepted buddies in either direction, with independent acceptance and decline", async () => {
  const first = await fixture();
  const second = await fixture();
  const recipientId = first.recipient.id;
  await prisma.buddyRelationship.create({ data: {
    requesterId: recipientId, addresseeId: second.sender.id, status: "ACCEPTED",
  } });
  const before = await getMealLibrary(recipientId);
  const profileBefore = await prisma.profile.findUniqueOrThrow({ where: { userId: recipientId } });
  const sourceIds = [...first.source.entryIds, ...second.source.entryIds];
  const sourcesBefore = await prisma.logEntry.findMany({ where: { id: { in: sourceIds } }, orderBy: { id: "asc" } });
  const senders = [first, second];
  const proposals = await Promise.all(senders.map((sender) => proposeSharedMealForUser(sender.sender.id, {
    requestId: randomUUID(), source: sender.source, recipientId, date, mealType: "LUNCH",
  })));
  const otherRecipientProposal = await proposeSharedMealForUser(second.sender.id, {
    requestId: randomUUID(), source: second.source, recipientId: second.recipient.id, date, mealType: "LUNCH",
  });
  const library = await getMealLibrary(recipientId);
  assert.deepEqual(new Set(library.pending.map((proposal) => proposal.id)), new Set(proposals.map((proposal) => proposal.proposalId)));
  assert.deepEqual(new Set(library.pending.map((proposal) => proposal.sender.id)), new Set(senders.map((sender) => sender.sender.id)));
  assert.deepEqual(library.buddy, before.buddy, "Incoming proposals do not change the displayed buddy");
  assert.deepEqual(library.sent, before.sent);
  assert.deepEqual(library.checkIn, before.checkIn);
  assert.deepEqual((await getMealLibrary(second.recipient.id)).pending.map((proposal) => proposal.id), [otherRecipientProposal.proposalId]);
  assert.equal((await getMealLibrary(first.outsider.id)).pending.length, 0);

  // Accept the sender not selected as the displayed buddy, which previously
  // stayed hidden even though this relationship could create a valid proposal.
  const acceptedIndex = senders.findIndex((sender) => sender.sender.id !== library.buddy?.id);
  assert.ok(acceptedIndex >= 0);
  const declinedIndex = 1 - acceptedIndex;
  const accepted = await respondMealProposalForUser(recipientId, {
    proposalId: proposals[acceptedIndex].proposalId, action: "accept",
    date: "2026-10-08", mealType: "DINNER", multiplier: 1.5,
    selectedItemIds: [senders[acceptedIndex].entries[0].id],
  });
  await respondMealProposalForUser(recipientId, { proposalId: proposals[declinedIndex].proposalId, action: "decline" });
  const logged = await prisma.logEntry.findMany({ where: { userId: recipientId } });
  assert.equal(logged.length, 1);
  assert.equal(logged[0].batchId, accepted.batchId);
  assert.equal(logged[0].foodId, senders[acceptedIndex].legacyFood.id);
  assert.equal(logged[0].date, "2026-10-08");
  assert.equal(logged[0].mealType, "DINNER");
  assert.equal(logged[0].amount, 3);
  assert.equal(logged[0].snapshotKcal, 234);
  assert.equal(logged[0].sourceText, null);
  assert.equal(await prisma.logBatch.count({ where: { userId: recipientId } }), 1);
  assert.equal((await prisma.mealProposal.findUniqueOrThrow({ where: { id: proposals[declinedIndex].proposalId } })).status, "DECLINED");
  assert.equal((await getMealLibrary(recipientId)).pending.length, 0);
  assert.equal(await prisma.logEntry.count({ where: { userId: second.recipient.id } }), 0);
  assert.deepEqual(await prisma.profile.findUniqueOrThrow({ where: { userId: recipientId } }), profileBefore);
  assert.deepEqual(await prisma.logEntry.findMany({ where: { id: { in: sourceIds } }, orderBy: { id: "asc" } }), sourcesBefore);
});

test("incoming meals exclude unaccepted or removed buddies and enforce recipient and source isolation", async () => {
  const first = await fixture();
  const second = await fixture();
  const recipientId = first.recipient.id;
  const relationship = await prisma.buddyRelationship.create({ data: {
    requesterId: recipientId, addresseeId: second.sender.id, status: "ACCEPTED",
  } });
  const retained = await proposeSharedMealForUser(first.sender.id, {
    requestId: randomUUID(), source: first.source, recipientId, date, mealType: "LUNCH",
  });
  const hidden = await proposeSharedMealForUser(second.sender.id, {
    requestId: randomUUID(), source: second.source, recipientId, date, mealType: "LUNCH",
  });
  for (const status of ["PENDING", "DECLINED", "REMOVED"] as const) {
    if (status === "REMOVED") await prisma.buddyRelationship.delete({ where: { id: relationship.id } });
    else await prisma.buddyRelationship.update({ where: { id: relationship.id }, data: { status } });
    assert.deepEqual((await getMealLibrary(recipientId)).pending.map((proposal) => proposal.id), [retained.proposalId], status);
    for (const action of ["accept", "decline"] as const) {
      await assert.rejects(respondMealProposalForUser(recipientId, {
        proposalId: hidden.proposalId, action, date, mealType: "LUNCH",
      }), /no longer your connected buddy/);
    }
    await assert.rejects(proposeSharedMealForUser(second.sender.id, {
      requestId: randomUUID(), source: second.source, recipientId, date, mealType: "LUNCH",
    }), /no longer your connected buddy/);
  }
  for (const actor of [first.sender, first.outsider, second.recipient]) {
    for (const action of ["accept", "decline"] as const) {
      await assert.rejects(respondMealProposalForUser(actor.id, {
        proposalId: retained.proposalId, action, date, mealType: "LUNCH",
      }), /not available to your account/);
    }
  }
  await assert.rejects(proposeSharedMealForUser(recipientId, {
    requestId: randomUUID(), source: first.source, recipientId: first.sender.id, date, mealType: "LUNCH",
  }), /does not belong to your account/);
  assert.equal((await prisma.mealProposal.findUniqueOrThrow({ where: { id: hidden.proposalId } })).status, "PENDING");
  assert.equal((await prisma.mealProposal.findUniqueOrThrow({ where: { id: retained.proposalId } })).status, "PENDING");
  assert.equal(await prisma.logEntry.count({ where: { userId: recipientId } }), 0);
  assert.equal(await prisma.logBatch.count({ where: { userId: recipientId } }), 0);
  assert.equal(await prisma.mealProposal.count({ where: { senderId: recipientId } }), 0);
});

test("simultaneous accept retries create one recipient batch and Undo cannot be resurrected by another accept", async () => {
  const f = await fixture();
  const proposal = await proposeSharedMealForUser(f.sender.id, { requestId: randomUUID(), source: f.source, recipientId: f.recipient.id, date, mealType: "LUNCH" });
  const input = { proposalId: proposal.proposalId, action: "accept" as const, date, mealType: "DINNER", multiplier: 0.5 };
  const results = await Promise.all(Array.from({ length: 6 }, () => respondMealProposalForUser(f.recipient.id, input)));
  assert.equal(new Set(results.map((result) => result.batchId)).size, 1);
  assert.equal(await prisma.logEntry.count({ where: { userId: f.recipient.id } }), 2);
  assert.equal(await prisma.logBatch.count({ where: { userId: f.recipient.id } }), 1);
  await undoMealBatch(f.recipient.id, results[0].batchId!);
  const retry = await respondMealProposalForUser(f.recipient.id, input);
  assert.equal(retry.entryCount, 0);
  assert.equal(retry.undone, true);
  assert.equal(await prisma.logEntry.count({ where: { userId: f.recipient.id } }), 0);
});

test("a failed acceptance leaves proposal pending and writes nothing; a disconnected buddy cannot accept", async () => {
  const f = await fixture();
  const proposal = await proposeSharedMealForUser(f.sender.id, { requestId: randomUUID(), source: f.source, recipientId: f.recipient.id, date, mealType: "LUNCH" });
  await assert.rejects(respondMealProposalForUser(f.recipient.id, { proposalId: proposal.proposalId, action: "accept", date, mealType: "LUNCH", selectedItemIds: ["foreign-item"] }), /no longer available/);
  assert.equal((await prisma.mealProposal.findUniqueOrThrow({ where: { id: proposal.proposalId } })).status, "PENDING");
  assert.equal(await prisma.logBatch.count({ where: { userId: f.recipient.id } }), 0);
  await prisma.buddyRelationship.delete({ where: { id: f.relationship.id } });
  await assert.rejects(respondMealProposalForUser(f.recipient.id, { proposalId: proposal.proposalId, action: "accept", date, mealType: "LUNCH" }), /no longer your connected buddy/);
  assert.equal(await prisma.logEntry.count({ where: { userId: f.recipient.id } }), 0);
});

test("accept racing decline produces one final decision without a partial or contradictory meal", async () => {
  const f = await fixture();
  const proposal = await proposeSharedMealForUser(f.sender.id, { requestId: randomUUID(), source: f.source, recipientId: f.recipient.id, date, mealType: "LUNCH" });
  const results = await Promise.allSettled([
    respondMealProposalForUser(f.recipient.id, { proposalId: proposal.proposalId, action: "accept", date, mealType: "LUNCH" }),
    respondMealProposalForUser(f.recipient.id, { proposalId: proposal.proposalId, action: "decline" }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const final = await prisma.mealProposal.findUniqueOrThrow({ where: { id: proposal.proposalId } });
  const entries = await prisma.logEntry.count({ where: { userId: f.recipient.id } });
  assert.equal(entries, final.status === "ACCEPTED" ? 2 : 0);
  assert.equal(await prisma.logBatch.count({ where: { userId: f.recipient.id } }), final.status === "ACCEPTED" ? 1 : 0);
});

test("weekly cooperation is independently enabled and partner participation stays private until both opt in", async () => {
  const f = await fixture();
  await assert.rejects(completeWeeklyCheckInForUser(f.sender.id), /Enable your weekly check-in/);
  await setCooperativeCheckInForUser(f.sender.id, true);
  await completeWeeklyCheckInForUser(f.sender.id);
  await completeWeeklyCheckInForUser(f.sender.id);
  assert.equal(await prisma.weeklyCheckIn.count({ where: { userId: f.sender.id } }), 1);
  assert.equal((await prisma.profile.findUniqueOrThrow({ where: { userId: f.recipient.id } })).cooperativeCheckInEnabled, false);
  const recipientBefore = (await getMealLibrary(f.recipient.id)).checkIn;
  assert.equal(recipientBefore.buddyEnabled, false);
  assert.equal(recipientBefore.buddyCompleted, null);
  await setCooperativeCheckInForUser(f.recipient.id, true);
  const recipientAfter = (await getMealLibrary(f.recipient.id)).checkIn;
  assert.equal(recipientAfter.buddyEnabled, true);
  assert.equal(recipientAfter.buddyCompleted, true);
  await setCooperativeCheckInForUser(f.sender.id, false);
  const hidden = (await getMealLibrary(f.recipient.id)).checkIn;
  assert.equal(hidden.buddyEnabled, false);
  assert.equal(hidden.buddyCompleted, null);
});
