import test from "node:test";
import assert from "node:assert/strict";
import { ensureIndexRun, lookupHook, readHookRecord } from "../src/a2a/control-service.js";

test("run ID lookup uses authenticated hook storage without hydrating unused metadata or keys", async () => {
  const calls = [];
  const world = {
    hooks: { getByToken: async (token) => {
      calls.push(token);
      return { runId: "original-index", get metadata() { assert.fail("must not hydrate metadata"); } };
    } },
    runs: { get: async () => assert.fail("must not fetch owning run") },
    getEncryptionKeyForRun: async () => assert.fail("must not read a key for a metadata-only lookup"),
  };
  assert.deepEqual(await readHookRecord("existing-hook", world), { runId: "original-index" });
  assert.deepEqual(calls, ["existing-hook"]);
  const denied = Object.assign(new Error("denied"), { status: 403 });
  await assert.rejects(readHookRecord("existing-hook", {
    hooks: { getByToken: async () => { throw denied; } },
  }), (error) => error === denied);
});

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

for (const [name, category] of [
  ["RunExpiredError", "RUN_EXPIRED"],
  ["RuntimeDecryptionError", "DECRYPTION_FAILED"],
  ["WorkflowRunNotFoundError", "RUN_NOT_FOUND"],
  ["ZodError", "RESPONSE_INVALID"],
]) {
  test(`known SDK error ${name} is classified without its payload`, async () => {
    await assert.rejects(lookupHook("private-hook", async () => {
      throw Object.assign(new Error("private-response-body"), { name });
    }), { message: `A2A_WORKFLOW_HOOK_LOOKUP_${category}_FAILED`, statusCode: 503 });
  });
}

test("cross-deployment key failure exposes only the SDK operation and HTTP status", async () => {
  await assert.rejects(lookupHook("private-hook", async () => {
    throw new Error("Failed to fetch run key for private-run (deployment private-deployment): HTTP 403 Forbidden — private-response-body");
  }), { message: "A2A_WORKFLOW_HOOK_LOOKUP_KEY_READ_HTTP_403", statusCode: 503 });
});
