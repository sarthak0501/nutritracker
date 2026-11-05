import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { prisma } from "../lib/db";
import { McpMutationError, withMcpMutation } from "../lib/mcp-mutations";

const database = new URL(process.env.DATABASE_URL || "file:///missing-fixture-database");
assert.equal(database.protocol, "postgresql:", "Use the protected local fixture database only");
assert.equal(database.hostname, "localhost");
assert.equal(database.username, "nt_fixture");
assert.equal(database.pathname, "/nutritracker_test");
assert.match(database.searchParams.get("host") || "", /^\/.*\/nt-fixture-[a-f0-9]{12}\/socket$/);
const users: string[] = [];
before(async () => {
  const [settings] = await prisma.$queryRaw<Array<{ database: string; listen: string }>>`SELECT current_database() AS database, current_setting('listen_addresses') AS listen`;
  assert.equal(settings.database, "nutritracker_test");
  assert.equal(settings.listen, "");
  for (let i = 0; i < 2; i++) users.push((await prisma.user.create({ data: { username: `fixture-mutation-${randomUUID()}`, passwordHash: "fixture-no-login" }, select: { id: true } })).id);
});
after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

test("concurrent identical MCP mutations commit one write and share its durable receipt", async () => {
  const requestId = randomUUID();
  let writes = 0;
  const result = await Promise.all(Array.from({ length: 8 }, () => withMcpMutation(users[0], requestId, "fixture-workout", { sets: 3, reps: 10 }, async tx => {
    writes++;
    const entry = await tx.workoutEntry.create({ data: { userId: users[0], date: "2026-10-01", exerciseName: "Fixture press", sets: 3, reps: 10, caloriesBurned: null } });
    return { id: entry.id, sets: entry.sets, reps: entry.reps };
  })));
  assert.equal(writes, 1);
  for (const receipt of result) assert.deepEqual(receipt, result[0]);
  assert.equal(await prisma.workoutEntry.count({ where: { userId: users[0], date: "2026-10-01" } }), 1);
  assert.equal(await prisma.mcpMutation.count({ where: { userId: users[0], requestId } }), 1);
  // Semantically identical JSON properties in a different order are retries.
  const retry = await withMcpMutation(users[0], requestId, "fixture-workout", { reps: 10, ignored: undefined, sets: 3 }, async () => { throw new Error("A retry must not invoke the writer"); });
  assert.deepEqual(retry, result[0]);
});

test("a reused request key cannot change the operation or immutable input", async () => {
  const requestId = randomUUID();
  await withMcpMutation(users[0], requestId, "fixture-water", { date: "2026-10-02", glasses: 2 }, async tx => {
    const entry = await tx.waterEntry.create({ data: { userId: users[0], date: "2026-10-02", glasses: 2 } });
    return { id: entry.id, glasses: entry.glasses };
  });
  let unintendedWrites = 0;
  for (const [operation, glasses] of [["fixture-water", 3], ["fixture-other", 2]] as const) {
    await assert.rejects(withMcpMutation(users[0], requestId, operation, { date: "2026-10-02", glasses }, async () => { unintendedWrites++; return {}; }), McpMutationError);
  }
  assert.equal(unintendedWrites, 0);
  assert.equal((await prisma.waterEntry.findUnique({ where: { userId_date: { userId: users[0], date: "2026-10-02" } } }))!.glasses, 2);
});

test("failed writes roll back with their receipt and successful retries cannot resurrect deleted data", async () => {
  const requestId = randomUUID();
  const input = { date: "2026-10-03", weightKg: 70 };
  await assert.rejects(withMcpMutation(users[0], requestId, "fixture-weight", input, async tx => {
    await tx.weightEntry.create({ data: { userId: users[0], ...input } });
    throw new Error("fixture failure after write");
  }), /fixture failure after write/);
  assert.equal(await prisma.weightEntry.count({ where: { userId: users[0], date: input.date } }), 0);
  assert.equal(await prisma.mcpMutation.count({ where: { userId: users[0], requestId } }), 0);
  const saved = await withMcpMutation(users[0], requestId, "fixture-weight", input, async tx => {
    const entry = await tx.weightEntry.create({ data: { userId: users[0], ...input } });
    return { id: entry.id, weightKg: entry.weightKg };
  });
  await prisma.weightEntry.delete({ where: { id: saved.id } });
  const delayed = await withMcpMutation(users[0], requestId, "fixture-weight", input, async () => { throw new Error("A delayed retry must not recreate a deleted entry"); });
  assert.deepEqual(delayed, saved);
  assert.equal(await prisma.weightEntry.count({ where: { userId: users[0], date: input.date } }), 0);
});

test("identical request keys are isolated by account and never return another person's receipt", async () => {
  const requestId = randomUUID();
  const input = { date: "2026-10-04", glasses: 3 };
  const results = await Promise.all(users.map(userId => withMcpMutation(userId, requestId, "fixture-water", input, async tx => {
    const entry = await tx.waterEntry.create({ data: { userId, ...input } });
    return { id: entry.id, account: entry.userId };
  })));
  assert.notEqual(results[0].id, results[1].id);
  assert.deepEqual(results.map(value => value.account), users);
  for (let i = 0; i < users.length; i++) {
    const receipt = await withMcpMutation(users[i], requestId, "fixture-water", input, async () => { throw new Error("Account retry must use its own receipt"); });
    assert.deepEqual(receipt, results[i]);
  }
  assert.equal(await prisma.mcpMutation.count({ where: { userId: { in: users }, requestId } }), 2);
});
