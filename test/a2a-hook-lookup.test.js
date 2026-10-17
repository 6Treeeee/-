import test from "node:test";
import assert from "node:assert/strict";
import { ensureIndexRun, lookupHook } from "../src/a2a/control-service.js";

test("existing index lookup reads without starting another workflow", async () => {
  assert.equal(await ensureIndexRun({
    lookupHookImpl: async () => ({ runId: "existing-index" }),
    startImpl: async () => assert.fail("must not start"),
  }), "existing-index");
});

test("only an explicitly absent hook permits index bootstrap", async () => {
  let reads = 0;
  let starts = 0;
  const getHook = async () => {
    if (reads++ === 0) throw Object.assign(new Error("Hook not found"), { name: "HookNotFoundError" });
    return { runId: "created-index" };
  };
  assert.equal(await ensureIndexRun({
    lookupHookImpl: (token) => lookupHook(token, getHook),
    startImpl: async () => { starts++; return { runId: "created-index" }; },
  }), "created-index");
  assert.equal(starts, 1);
});

for (const upstream of [
  { status: 401 }, { status: 403 }, { status: 404 }, { status: 500 },
  { name: "TypeError" }, { name: "WorkflowRuntimeError" },
]) {
  test(`index lookup failure ${upstream.status || upstream.name} cannot create a workflow or leak upstream text`, async () => {
    const original = Object.assign(new Error("secret-hook-token Authorization: Bearer private-value"), upstream);
    let reads = 0;
    await assert.rejects(ensureIndexRun({
      lookupHookImpl: (token) => lookupHook(token, async () => { reads++; throw original; }),
      startImpl: async () => assert.fail("lookup failure must not start"),
    }), (error) => {
      assert.equal(error.message, `A2A_WORKFLOW_HOOK_LOOKUP${upstream.status ? `_HTTP_${upstream.status}` : "_FAILED"}`);
      assert.equal(error.statusCode, 503);
      assert.doesNotMatch(JSON.stringify(error) + String(error), /secret-hook|private-value|Authorization/);
      return true;
    });
    assert.equal(reads, 1);
  });
}
