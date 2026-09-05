import test from "node:test";
import assert from "node:assert/strict";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import {
  authenticationChallenge,
  createOAuthAuthorizer,
  protectedResourceMetadata,
  readAuthConfig,
  TreeBrainOAuthError,
} from "../src/mcp/auth.js";

const ENV = Object.freeze({
  TREE_BRAIN_MCP_URL: "https://tree.example/mcp",
  TREE_BRAIN_OAUTH_ISSUER: "https://identity.example/",
  TREE_BRAIN_OAUTH_JWKS_URL: "https://identity.example/.well-known/jwks.json",
  TREE_BRAIN_OAUTH_SUBJECTS_JSON: JSON.stringify({
    "provider|owner": ["content-reader", "tree:research"],
    "provider|reviewer": ["tree:research"],
  }),
});
const KEYS = new Map();
for (const algorithm of ["RS256", "ES256", "EdDSA"]) {
  const pair = await generateKeyPair(algorithm);
  const jwk = { ...await exportJWK(pair.publicKey), alg: algorithm, kid: algorithm };
  KEYS.set(algorithm, { ...pair, jwk });
}
const keyResolver = createLocalJWKSet({ keys: [...KEYS.values()].map(({ jwk }) => jwk) });

function authorizer(env = ENV) {
  return createOAuthAuthorizer({ env, keyResolver });
}

async function token(overrides = {}, { algorithm = "RS256", privateKey } = {}) {
  const now = Math.floor(Date.now() / 1_000);
  return new SignJWT({
    iss: ENV.TREE_BRAIN_OAUTH_ISSUER,
    aud: ENV.TREE_BRAIN_MCP_URL,
    sub: "provider|owner",
    exp: now + 300,
    iat: now,
    scope: "treebrain:read treebrain:check",
    ...overrides,
  })
    .setProtectedHeader({ alg: algorithm, kid: algorithm })
    .sign(privateKey || KEYS.get(algorithm).privateKey);
}

function authError(code, status) {
  return (error) => error instanceof TreeBrainOAuthError
    && error.code === code && error.status === status && error.statusCode === status
    && error.message === code;
}

test("MCP auth requires complete HTTPS resource, issuer, key and subject configuration", () => {
  assert.equal(readAuthConfig({}), null);
  const config = readAuthConfig(ENV);
  assert.equal(config.resource, ENV.TREE_BRAIN_MCP_URL);
  assert.equal(config.issuer, ENV.TREE_BRAIN_OAUTH_ISSUER);
  assert.equal(config.jwksUrl, ENV.TREE_BRAIN_OAUTH_JWKS_URL);
  assert.deepEqual(config.subjects.get("provider|owner"), ["content-reader", "tree:research"]);

  const invalid = [
    { TREE_BRAIN_MCP_URL: ENV.TREE_BRAIN_MCP_URL },
    { ...ENV, TREE_BRAIN_MCP_URL: "http://tree.example/mcp" },
    { ...ENV, TREE_BRAIN_MCP_URL: "https://tree.example/api" },
    { ...ENV, TREE_BRAIN_MCP_URL: "https://tree.example/mcp/" },
    { ...ENV, TREE_BRAIN_MCP_URL: "https://tree.example/mcp?" },
    { ...ENV, TREE_BRAIN_MCP_URL: "https://tree.example/mcp#" },
    { ...ENV, TREE_BRAIN_MCP_URL: "https://owner:password@tree.example/mcp" },
    { ...ENV, TREE_BRAIN_MCP_URL: " https://tree.example/mcp" },
    { ...ENV, TREE_BRAIN_MCP_URL: "https://tree.example/\nmcp" },
    { ...ENV, TREE_BRAIN_OAUTH_ISSUER: "http://identity.example/" },
    { ...ENV, TREE_BRAIN_OAUTH_ISSUER: "https://identity.example/?key=value" },
    { ...ENV, TREE_BRAIN_OAUTH_JWKS_URL: "file:///keys.json" },
    { ...ENV, TREE_BRAIN_OAUTH_JWKS_URL: "https://identity.example/keys#fragment" },
    ...["", "null", "[]", "{}", "invalid", '{"subject":[]}', '{"subject":["*"]}',
      '{"subject":["../workspace"]}', '{"subject":[12]}', '{"subject":"workspace"}',
      '{"":["workspace"]}', JSON.stringify({ subject: ["w".repeat(129)] })]
      .map((value) => ({ ...ENV, TREE_BRAIN_OAUTH_SUBJECTS_JSON: value })),
  ];
  for (const env of invalid) {
    assert.throws(() => readAuthConfig(env), authError("TREE_BRAIN_OAUTH_NOT_CONFIGURED", 503));
  }
});

test("public OAuth metadata and challenge publish resource discovery without subject grants", () => {
  const config = readAuthConfig({ ...ENV, TREE_BRAIN_MCP_URL: "https://TREE.example:443/api/mcp" });
  assert.deepEqual(protectedResourceMetadata(config), {
    resource: "https://tree.example/api/mcp",
    authorization_servers: [ENV.TREE_BRAIN_OAUTH_ISSUER],
    scopes_supported: ["treebrain:read", "treebrain:check"],
  });
  assert.equal(authenticationChallenge(config),
    'Bearer resource_metadata="https://tree.example/.well-known/oauth-protected-resource"');
  assert.equal(authenticationChallenge(null), "Bearer");
  assert.throws(() => protectedResourceMetadata(null), authError("TREE_BRAIN_OAUTH_NOT_CONFIGURED", 503));
  assert.doesNotMatch(JSON.stringify(protectedResourceMetadata(config)), /provider|content-reader|jwks/);
});

test("MCP authentication fails closed when OAuth is missing or partially configured", async () => {
  for (const env of [{}, { TREE_BRAIN_MCP_URL: ENV.TREE_BRAIN_MCP_URL }]) {
    await assert.rejects(authorizer(env)(undefined, ["treebrain:read"]),
      authError("TREE_BRAIN_OAUTH_NOT_CONFIGURED", 503));
  }
});

test("real RS256, ES256 and EdDSA signatures produce stable bounded scoped principals", async () => {
  const authorize = authorizer();
  let expected;
  for (const algorithm of KEYS.keys()) {
    const principal = await authorize(`Bearer ${await token({}, { algorithm })}`,
      ["treebrain:read", "treebrain:check"]);
    assert.equal(principal.role, "decision");
    assert.match(principal.principal_id, /^oauth:[a-f0-9]{64}$/);
    assert.match(principal.key_id, /^oauth-[a-f0-9]{48}$/);
    assert.deepEqual(principal.workspace_ids, ["content-reader", "tree:research"]);
    assert.doesNotMatch(JSON.stringify(principal), /provider\|owner/);
    if (expected) assert.deepEqual(principal, expected);
    expected = principal;
  }
  expected.workspace_ids.push("unauthorized-workspace");
  const next = await authorize(`Bearer ${await token()}`, ["treebrain:read"]);
  assert.deepEqual(next.workspace_ids, ["content-reader", "tree:research"]);
  const reviewer = await authorize(`Bearer ${await token({ sub: "provider|reviewer" })}`,
    ["treebrain:read"]);
  assert.notEqual(reviewer.principal_id, next.principal_id);
  assert.deepEqual(reviewer.workspace_ids, ["tree:research"]);
});

test("principal identity includes the exact issuer as well as the subject", async () => {
  const otherIssuer = "https://second-identity.example/";
  const first = await authorizer()(`Bearer ${await token()}`, ["treebrain:read"]);
  const second = await authorizer({ ...ENV, TREE_BRAIN_OAUTH_ISSUER: otherIssuer })(
    `Bearer ${await token({ iss: otherIssuer })}`, ["treebrain:read"],
  );
  assert.notEqual(first.principal_id, second.principal_id);
});

test("expired, premature, wrong audience or issuer and missing claims are unauthorized", async () => {
  const now = Math.floor(Date.now() / 1_000);
  for (const claims of [
    { exp: now - 10 }, { exp: undefined }, { exp: "never" }, { nbf: now + 300 },
    { iss: "https://attacker.example/" }, { iss: ENV.TREE_BRAIN_OAUTH_ISSUER.slice(0, -1) },
    { iss: undefined }, { aud: "https://tree.example/another-resource" }, { aud: undefined },
    { sub: undefined }, { sub: "" }, { sub: 123 },
  ]) {
    await assert.rejects(authorizer()(`Bearer ${await token(claims)}`, ["treebrain:read"]),
      authError("TREE_BRAIN_UNAUTHORIZED", 401));
  }
});

test("wrong signatures and non-allowlisted algorithms cannot authenticate", async () => {
  const impostor = await generateKeyPair("RS256");
  const wrongSignature = await token({}, { privateKey: impostor.privateKey });
  const symmetric = await token({}, { algorithm: "HS256", privateKey: new Uint8Array(32).fill(7) });
  for (const jwt of [wrongSignature, symmetric]) {
    await assert.rejects(authorizer()(`Bearer ${jwt}`, ["treebrain:read"]),
      authError("TREE_BRAIN_UNAUTHORIZED", 401));
  }
});

test("missing, malformed and multiple authorization headers are rejected", async () => {
  const jwt = await token();
  for (const header of [undefined, null, [], "", "Basic abc", "Bearer x.y.z", `Bearer ${jwt}, ${jwt}`,
    `Bearer ${jwt}\r\nX-Injected: yes`, `Bearer ${"x".repeat(16_385)}`]) {
    await assert.rejects(authorizer()(header, ["treebrain:read"]),
      authError("TREE_BRAIN_UNAUTHORIZED", 401));
  }
  assert.equal((await authorizer()(`bearer ${jwt}`, ["treebrain:read"])).role, "decision");
});

test("only explicitly allowed subjects can access their configured workspace grants", async () => {
  for (const sub of ["unknown-subject", "toString", "__proto__"]) {
    await assert.rejects(authorizer()(`Bearer ${await token({ sub })}`, ["treebrain:read"]),
      authError("TREE_BRAIN_FORBIDDEN", 403));
  }
});

test("required scopes are exact whitespace-delimited scope or scp values", async () => {
  const authorize = authorizer();
  for (const claims of [
    { scope: "treebrain:read\ttreebrain:check" },
    { scope: undefined, scp: " treebrain:read\n treebrain:check " },
    { scope: "treebrain:read", scp: "treebrain:check" },
  ]) {
    assert.equal((await authorize(`Bearer ${await token(claims)}`,
      ["treebrain:read", "treebrain:check"])).role, "decision");
  }
  for (const claims of [
    { scope: "treebrain:read" }, { scope: "prefix-treebrain:check" },
    { scope: undefined }, { scope: ["treebrain:check"] },
    { scope: undefined, scp: { "treebrain:check": true } },
  ]) {
    await assert.rejects(authorize(`Bearer ${await token(claims)}`, ["treebrain:check"]),
      authError("TREE_BRAIN_FORBIDDEN", 403));
  }
  await assert.rejects(authorize(`Bearer ${await token()}`, ["treebrain:admin"]),
    authError("TREE_BRAIN_FORBIDDEN", 403));
});
