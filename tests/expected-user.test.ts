import test from "node:test";
import assert from "node:assert/strict";
import { assertExpectedUser } from "../lib/expected-user";

test("rendered account must match the current session before a mutation", () => {
  assert.doesNotThrow(() => assertExpectedUser("alice", "alice"));
  for (const expected of ["bob", "", " alice ", undefined, null, 123, {}, ["alice"]]) {
    let writes = 0;
    assert.throws(() => {
      assertExpectedUser("alice", expected);
      writes++;
    }, /account changed/);
    assert.equal(writes, 0);
  }
});

test("a stale same-browser form cannot act after switching accounts without local storage", () => {
  const renderedAccount = "first-account";
  const currentSession = "second-account";
  assert.throws(() => assertExpectedUser(currentSession, renderedAccount), /Refresh this page/);
  assert.doesNotThrow(() => assertExpectedUser(currentSession, "second-account"));
});
