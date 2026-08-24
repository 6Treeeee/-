import test from "node:test";
import assert from "node:assert/strict";
import {
  generateKeyPairSync,
  sign
} from "node:crypto";

import {
  A2AAuthError,
  canonicalPathAndQuery,
  canonicalRequest,
  createRequestAuthorizer,
  sha256Hex
} from "../src/a2a/auth.js";

const NOW_MS = Date.parse("2026-08-24T00:00:00.000Z");
const NOW_SECONDS = Math.floor(NOW_MS / 1_000);
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const PUBLIC_KEY_PEM = publicKey.export({ type: "spki", format: "pem" });

test("canonical request fixes method, sorted query, body hash, and line order", () => {
  const pathAndQuery = canonicalPathAndQuery(
    "/tasks",
    new URLSearchParams("route=%2Ftasks&z=last&a=two&a=one")
  );
  assert.equal(pathAndQuery, "/tasks?a=one&a=two&z=last");

  const bodyHash = sha256Hex('{"goal":"test"}');
  assert.equal(bodyHash.length, 64);
  assert.equal(canonicalRequest({
    timestamp: String(NOW_SECONDS),
    nonce: "nonce_canonical_0001",
    method: "post",
    pathAndQuery,
    contentSha256: bodyHash
  }), [
    String(NOW_SECONDS),
    "nonce_canonical_0001",
    "POST",
    "/tasks?a=one&a=two&z=last",
    bodyHash
  ].join("\n"));
});

test("valid Ed25519 signature authorizes the configured role and preserves scope", () => {
  const authorize = authorizer([{
    id: "decision-key-1",
    role: "decision",
    principal_id: "gpt-decision-1",
    workspace_ids: ["content-reader"],
    public_key_pem: PUBLIC_KEY_PEM
  }]);
  const request = signedRequest({
    keyId: "decision-key-1",
    nonce: "nonce_valid_role_0001",
    body: '{"goal":"live"}'
  });

  const principal = authorize(request, ["decision"]);
  assert.deepEqual(principal, {
    key_id: "decision-key-1",
    role: "decision",
    method: "ed25519",
    principal_id: "gpt-decision-1",
    workspace_ids: ["content-reader"]
  });
});

test("body hash prevents a signed request body from being changed", () => {
  const authorize = authorizer([keyConfig("decision-key-2", "decision")]);
  const request = signedRequest({
    keyId: "decision-key-2",
    nonce: "nonce_body_hash_0001",
    body: '{"decision":"CONTINUE"}'
  });
  request.body = '{"decision":"STOP"}';

  assertAuthError(
    () => authorize(request, ["decision"]),
    "A2A_BODY_HASH_MISMATCH",
    401
  );
});

test("a decision key cannot authenticate as a worker", () => {
  const authorize = authorizer([keyConfig("decision-key-3", "decision")]);
  const request = signedRequest({
    keyId: "decision-key-3",
    nonce: "nonce_wrong_role_0001",
    body: ""
  });

  assertAuthError(
    () => authorize(request, ["worker"]),
    "A2A_UNAUTHORIZED",
    401
  );
});

test("the same key and nonce cannot be replayed", () => {
  const authorize = authorizer([keyConfig("worker-key-1", "worker")]);
  const request = signedRequest({
    keyId: "worker-key-1",
    nonce: "nonce_replay_test_0001",
    body: '{"event":"heartbeat"}'
  });

  assert.equal(authorize(request, ["worker"]).role, "worker");
  assertAuthError(
    () => authorize(request, ["worker"]),
    "A2A_REPLAY_DETECTED",
    409
  );
});

test("signatures outside the bounded clock window expire", () => {
  const authorize = authorizer([keyConfig("worker-key-2", "worker")]);
  const request = signedRequest({
    keyId: "worker-key-2",
    nonce: "nonce_expired_test_01",
    body: "",
    timestamp: NOW_SECONDS - 301
  });

  assertAuthError(
    () => authorize(request, ["worker"]),
    "A2A_SIGNATURE_EXPIRED",
    401
  );
});

test("canonical path rejects fragments instead of signing an ambiguous target", () => {
  assert.throws(
    () => canonicalPathAndQuery("/tasks#fragment"),
    (error) => error instanceof A2AAuthError
      && error.code === "A2A_CANONICAL_PATH_INVALID"
      && error.statusCode === 400
  );
});

function authorizer(publicKeys) {
  return createRequestAuthorizer({
    publicKeys,
    env: {},
    now: () => NOW_MS
  });
}

function keyConfig(id, role) {
  return {
    id,
    role,
    principal_id: `${role}-principal`,
    workspace_ids: ["content-reader"],
    public_key_pem: PUBLIC_KEY_PEM
  };
}

function signedRequest({
  keyId,
  nonce,
  body,
  timestamp = NOW_SECONDS,
  method = "POST",
  pathAndQuery = "/tasks"
}) {
  const contentSha256 = sha256Hex(body);
  const canonical = canonicalRequest({
    timestamp: String(timestamp),
    nonce,
    method,
    pathAndQuery,
    contentSha256
  });
  return {
    method,
    pathAndQuery,
    body,
    headers: {
      "x-a2a-key-id": keyId,
      "x-a2a-timestamp": String(timestamp),
      "x-a2a-nonce": nonce,
      "x-a2a-content-sha256": contentSha256,
      "x-a2a-signature": sign(null, Buffer.from(canonical), privateKey).toString("base64")
    }
  };
}

function assertAuthError(action, code, statusCode) {
  assert.throws(action, (error) => (
    error instanceof A2AAuthError
      && error.code === code
      && error.statusCode === statusCode
  ));
}
