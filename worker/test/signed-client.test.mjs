import assert from "node:assert/strict";
import { generateKeyPairSync, verify as verifyBytes } from "node:crypto";
import test from "node:test";

import {
  canonicalPathAndQuery as serverCanonicalPathAndQuery,
  createRequestAuthorizer,
} from "../../src/a2a/auth.js";
import {
  A2AHttpError,
  canonicalPathAndSearch,
  createCanonicalRequest,
  sha256Hex,
  SignedA2AClient,
} from "../lib/signed-client.mjs";

function createKeys() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privatePem: privateKey.export({ format: "pem", type: "pkcs8" }),
    publicKey,
    publicPem: publicKey.export({ format: "pem", type: "spki" }),
  };
}

test("signs the exact method, path, query, and empty body hash", async () => {
  const { privatePem, publicKey } = createKeys();
  let captured;
  const client = new SignedA2AClient({
    controlUrl: "https://control.example.test/ignored/path",
    keyId: "worker-key-1",
    privateKey: privatePem,
    now: () => 1_700_000_000_123,
    nonceFactory: () => "1234567890abcdef",
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return new Response(JSON.stringify({ tasks: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  await client.listTasks({ workspaceId: "content-reader" });

  assert.equal(captured.url.pathname, "/tasks");
  assert.equal(captured.url.search, "?limit=10&status=submitted%7Crunning%7Creview_required&workspace_id=content-reader");
  assert.equal(captured.options.method, "GET");
  assert.equal(captured.options.body, undefined);
  assert.equal(captured.options.headers["x-a2a-content-sha256"], sha256Hex(""));
  const canonical = createCanonicalRequest({
    timestamp: "1700000000",
    nonce: "1234567890abcdef",
    method: "GET",
    pathAndSearch: `${captured.url.pathname}${captured.url.search}`,
    bodyHash: sha256Hex(""),
  });
  assert.equal(
    verifyBytes(
      null,
      Buffer.from(canonical),
      publicKey,
      Buffer.from(captured.options.headers["x-a2a-signature"], "base64"),
    ),
    true,
  );
});

test("signs the raw JSON executor event body", async () => {
  const { privatePem, publicKey } = createKeys();
  let captured;
  const client = new SignedA2AClient({
    controlUrl: "https://control.example.test",
    keyId: "worker-key-1",
    privateKey: privatePem,
    now: () => 1_700_000_000_000,
    nonceFactory: () => "abcdef1234567890",
    eventIdFactory: (prefix) => `${prefix}_stable_test_id`,
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });

  await client.executorEvent("task-1", {
    kind: "REPORT",
    workerId: "worker-1",
    workspaceId: "content-reader",
    payload: { status: "completed" },
  });

  const bodyHash = sha256Hex(captured.options.body);
  assert.equal(captured.options.headers["content-type"], "application/json");
  assert.equal(JSON.parse(captured.options.body).event.event_id, "event_stable_test_id");
  assert.equal(captured.options.headers["x-a2a-content-sha256"], bodyHash);
  const canonical = createCanonicalRequest({
    timestamp: "1700000000",
    nonce: "abcdef1234567890",
    method: "POST",
    pathAndSearch: "/tasks/task-1/executor",
    bodyHash,
  });
  assert.equal(
    verifyBytes(
      null,
      Buffer.from(canonical),
      publicKey,
      Buffer.from(captured.options.headers["x-a2a-signature"], "base64"),
    ),
    true,
  );
});

test("adds one stable decision id before signing the direct decision body", async () => {
  const { privatePem } = createKeys();
  let submitted;
  const client = new SignedA2AClient({
    controlUrl: "https://control.example.test",
    keyId: "decision-key",
    privateKey: privatePem,
    eventIdFactory: (prefix) => `${prefix}_stable_test_id`,
    nonceFactory: () => "abcdef1234567890",
    fetchImpl: async (_url, options) => {
      submitted = JSON.parse(options.body);
      return new Response(JSON.stringify({ accepted: true }), { status: 200 });
    },
  });
  await client.sendDecision("task-1", {
    task_id: "task-1",
    decision: "CONTINUE",
    reason: "one bounded action remains",
    constraints_update: [],
    next_goal: null,
  });
  assert.equal(submitted.decision_id, "decision_stable_test_id");
});

test("redacts a remote secret from HTTP errors", async () => {
  const { privatePem } = createKeys();
  const client = new SignedA2AClient({
    controlUrl: "https://control.example.test",
    keyId: "worker-key-1",
    privateKey: privatePem,
    nonceFactory: () => "abcdef1234567890",
    fetchImpl: async () => new Response(JSON.stringify({
      error: { message: "Bearer very-secret-token", token: "very-secret-token" },
    }), { status: 401 }),
  });

  await assert.rejects(
    client.getTask("task-1"),
    (error) => {
      assert.equal(error instanceof A2AHttpError, true);
      assert.equal(error.status, 401);
      assert.equal(error.message.includes("very-secret-token"), false);
      return true;
    },
  );
});

test("rejects key ids outside the server authentication format", () => {
  const { privatePem } = createKeys();
  assert.throws(() => new SignedA2AClient({
    controlUrl: "https://control.example.test",
    keyId: "worker:key",
    privateKey: privatePem,
  }), /key_id/);
});

test("canonical query sorting is deterministic and excludes Vercel's rewrite-only route", () => {
  const url = new URL("https://control.example.test/tasks?z=2&route=internal&a=2&a=1");
  assert.equal(canonicalPathAndSearch(url), "/tasks?a=1&a=2&z=2");
});

test("worker signatures are accepted by the control layer authorizer", async () => {
  const { privatePem, publicPem } = createKeys();
  let captured;
  const now = 1_700_000_000_000;
  const client = new SignedA2AClient({
    controlUrl: "https://control.example.test",
    keyId: "worker-key",
    privateKey: privatePem,
    now: () => now,
    nonceFactory: () => "servercontract1234",
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return new Response(JSON.stringify({ tasks: [] }), { status: 200 });
    },
  });
  await client.listTasks({ workspaceId: "content-reader" });
  const authorize = createRequestAuthorizer({
    publicKeys: [{
      id: "worker-key",
      role: "worker",
      principal_id: "worker-1",
      workspace_ids: ["content-reader"],
      public_key_pem: publicPem,
    }],
    now: () => now,
  });
  const principal = authorize({
    method: captured.options.method,
    headers: captured.options.headers,
    body: "",
    pathAndQuery: serverCanonicalPathAndQuery(captured.url.pathname, captured.url.searchParams),
  }, ["worker"]);
  assert.equal(principal.principal_id, "worker-1");
});

test("a transient executor submission retry reuses the same logical event id", async () => {
  const { privatePem } = createKeys();
  const bodies = [];
  let calls = 0;
  const client = new SignedA2AClient({
    controlUrl: "https://control.example.test",
    keyId: "worker-key",
    privateKey: privatePem,
    eventIdFactory: () => "event_retry_stable",
    fetchImpl: async (_url, options) => {
      bodies.push(JSON.parse(options.body));
      calls += 1;
      if (calls === 1) throw new Error("transient connection reset");
      return new Response(JSON.stringify({ accepted: true }), { status: 202 });
    },
  });
  await client.executorEvent("task-1", {
    kind: "REPORT",
    workerId: "worker-1",
    workspaceId: "content-reader",
    payload: { status: "failed" },
  });
  assert.equal(calls, 2);
  assert.equal(bodies[0].event.event_id, "event_retry_stable");
  assert.equal(bodies[1].event.event_id, "event_retry_stable");
});

test("task creation generates one stable request id across a transient retry", async () => {
  const { privatePem } = createKeys();
  const bodies = [];
  const client = new SignedA2AClient({
    controlUrl: "https://control.example.test",
    keyId: "decision-key",
    privateKey: privatePem,
    eventIdFactory: (prefix) => `${prefix}_stable_create`,
    fetchImpl: async (_url, options) => {
      bodies.push(JSON.parse(options.body));
      if (bodies.length === 1) throw new Error("connection reset after apply");
      return new Response(JSON.stringify({ task: { task_id: "task-1" } }), { status: 201 });
    },
  });
  await client.createTask({
    workspace_id: "content-reader",
    goal: "Run the blind task",
    acceptance_criteria: ["live transcript"],
  });
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].request_id, "request_stable_create");
  assert.equal(bodies[1].request_id, "request_stable_create");
});

test("named result and stop methods target the minimal control endpoints", async () => {
  const { privatePem } = createKeys();
  const calls = [];
  const client = new SignedA2AClient({
    controlUrl: "https://control.example.test",
    keyId: "decision-key",
    privateKey: privatePem,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });
  await client.getResult("task-1");
  await client.stopTask("task-1", "owner requested stop", { stopId: "stop-owner-1" });
  assert.equal(calls[0].url.pathname, "/tasks/task-1/result");
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[1].url.pathname, "/tasks/task-1/stop");
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    stop_id: "stop-owner-1",
    reason: "owner requested stop",
  });
});
