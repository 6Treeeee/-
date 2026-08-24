import {
  createHash,
  createPublicKey,
  timingSafeEqual,
  verify,
} from "node:crypto";

const MAX_CLOCK_SKEW_SECONDS = 300;
const NONCE_RE = /^[A-Za-z0-9_-]{16,128}$/;
const KEY_ID_RE = /^[A-Za-z0-9._-]{3,64}$/;
const PRINCIPAL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ROLES = new Set(["decision", "worker"]);
const seenNonces = new Map();

export class A2AAuthError extends Error {
  constructor(code, statusCode = 401) {
    super(code);
    this.name = "A2AAuthError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function header(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return headers.get(name) || "";
  const value = headers[name.toLowerCase()] ?? headers[name];
  return Array.isArray(value) ? value[0] || "" : String(value || "");
}

export function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalRequest({
  timestamp,
  nonce,
  method,
  pathAndQuery,
  contentSha256,
}) {
  return [
    String(timestamp),
    nonce,
    String(method).toUpperCase(),
    pathAndQuery,
    contentSha256,
  ].join("\n");
}

export function canonicalPathAndQuery(pathname, searchParams = new URLSearchParams()) {
  const safePath = String(pathname || "/");
  if (!safePath.startsWith("/") || safePath.includes("#")) {
    throw new A2AAuthError("A2A_CANONICAL_PATH_INVALID", 400);
  }
  const entries = [...searchParams.entries()]
    .filter(([key]) => key !== "route")
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => (
      leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue)
    ));
  const canonicalSearch = new URLSearchParams();
  for (const [key, value] of entries) canonicalSearch.append(key, value);
  const query = canonicalSearch.toString();
  return query ? `${safePath}?${query}` : safePath;
}

function parseKeyJson(value) {
  if (!value) return [];
  let parsed;
  try {
    parsed = typeof value === "string" ? JSON.parse(value) : value;
  } catch {
    throw new A2AAuthError("A2A_PUBLIC_KEYS_INVALID", 503);
  }
  if (!Array.isArray(parsed) || parsed.length > 16) {
    throw new A2AAuthError("A2A_PUBLIC_KEYS_INVALID", 503);
  }
  return parsed.map((item) => {
    if (
      !item ||
      !KEY_ID_RE.test(String(item.id || "")) ||
      !ROLES.has(item.role) ||
      typeof item.public_key_pem !== "string" ||
      item.public_key_pem.length > 4096 ||
      (item.principal_id != null &&
        !PRINCIPAL_ID_RE.test(String(item.principal_id))) ||
      (item.workspace_ids != null &&
        (!Array.isArray(item.workspace_ids) ||
          item.workspace_ids.length > 50 ||
          item.workspace_ids.some(
            (workspaceId) => !PRINCIPAL_ID_RE.test(String(workspaceId)),
          )))
    ) {
      throw new A2AAuthError("A2A_PUBLIC_KEYS_INVALID", 503);
    }
    return {
      id: item.id,
      role: item.role,
      publicKey: createPublicKey(item.public_key_pem),
      principal_id: item.principal_id || null,
      workspace_ids: item.workspace_ids ? [...item.workspace_ids] : null,
    };
  });
}

function safeEqualHex(actual, expected) {
  if (!/^[a-f0-9]{64}$/i.test(actual) || !/^[a-f0-9]{64}$/i.test(expected)) {
    return false;
  }
  return timingSafeEqual(
    Buffer.from(actual.toLowerCase(), "hex"),
    Buffer.from(expected.toLowerCase(), "hex"),
  );
}

function authorizeBearer(headers, allowedRoles, env) {
  const authorization = header(headers, "authorization");
  if (!authorization.startsWith("Bearer ")) return null;
  const token = authorization.slice(7);
  if (token.length < 32 || token.length > 512) {
    throw new A2AAuthError("A2A_UNAUTHORIZED");
  }
  const digest = sha256Hex(token);
  const hashes = {
    decision: env.A2A_DECISION_TOKEN_HASH,
    worker: env.A2A_WORKER_TOKEN_HASH,
  };
  for (const role of allowedRoles) {
    const configured = String(hashes[role] || "").replace(/^sha256:/, "");
    if (configured && safeEqualHex(digest, configured)) {
      return {
        key_id: `bearer:${role}`,
        role,
        method: "bearer",
        principal_id: null,
        workspace_ids: null,
      };
    }
  }
  throw new A2AAuthError("A2A_UNAUTHORIZED");
}

function pruneNonces(nowSeconds) {
  for (const [key, expiresAt] of seenNonces) {
    if (expiresAt <= nowSeconds) seenNonces.delete(key);
  }
  if (seenNonces.size > 10_000) seenNonces.clear();
}

function authorizeSignature(request, allowedRoles, keys, nowSeconds) {
  const keyId = header(request.headers, "x-a2a-key-id");
  const timestampRaw = header(request.headers, "x-a2a-timestamp");
  const nonce = header(request.headers, "x-a2a-nonce");
  const contentSha256 = header(request.headers, "x-a2a-content-sha256");
  const signature = header(request.headers, "x-a2a-signature");
  if (!keyId || !timestampRaw || !nonce || !contentSha256 || !signature) {
    throw new A2AAuthError("A2A_SIGNATURE_REQUIRED");
  }
  if (!KEY_ID_RE.test(keyId) || !NONCE_RE.test(nonce)) {
    throw new A2AAuthError("A2A_SIGNATURE_INVALID");
  }
  const timestamp = Number(timestampRaw);
  if (
    !Number.isInteger(timestamp) ||
    Math.abs(nowSeconds - timestamp) > MAX_CLOCK_SKEW_SECONDS
  ) {
    throw new A2AAuthError("A2A_SIGNATURE_EXPIRED");
  }
  const actualBodyHash = sha256Hex(request.body);
  if (!safeEqualHex(actualBodyHash, contentSha256)) {
    throw new A2AAuthError("A2A_BODY_HASH_MISMATCH");
  }
  const key = keys.find(
    (candidate) =>
      candidate.id === keyId && allowedRoles.includes(candidate.role),
  );
  if (!key) throw new A2AAuthError("A2A_UNAUTHORIZED");

  let signatureBytes;
  try {
    signatureBytes = Buffer.from(signature, "base64");
  } catch {
    throw new A2AAuthError("A2A_SIGNATURE_INVALID");
  }
  if (signatureBytes.length !== 64) {
    throw new A2AAuthError("A2A_SIGNATURE_INVALID");
  }
  const canonical = canonicalRequest({
    timestamp: timestampRaw,
    nonce,
    method: request.method,
    pathAndQuery: request.pathAndQuery,
    contentSha256,
  });
  if (!verify(null, Buffer.from(canonical), key.publicKey, signatureBytes)) {
    throw new A2AAuthError("A2A_SIGNATURE_INVALID");
  }

  pruneNonces(nowSeconds);
  const replayKey = `${keyId}:${nonce}`;
  if (seenNonces.has(replayKey)) throw new A2AAuthError("A2A_REPLAY_DETECTED", 409);
  seenNonces.set(replayKey, nowSeconds + MAX_CLOCK_SKEW_SECONDS);
  return {
    key_id: key.id,
    role: key.role,
    method: "ed25519",
    principal_id: key.principal_id,
    workspace_ids: key.workspace_ids,
  };
}

export function createRequestAuthorizer({
  publicKeys = [],
  env = process.env,
  now = () => Date.now(),
} = {}) {
  let parsedKeys;
  return function authorize(request, allowedRoles) {
    if (!Array.isArray(allowedRoles) || allowedRoles.length === 0) {
      throw new A2AAuthError("A2A_AUTH_CONFIGURATION_INVALID", 500);
    }
    const bearer = authorizeBearer(request.headers, allowedRoles, env);
    if (bearer) return bearer;
    parsedKeys ||= parseKeyJson(env.A2A_PUBLIC_KEYS_JSON || publicKeys);
    if (parsedKeys.length === 0) {
      throw new A2AAuthError("A2A_AUTH_NOT_CONFIGURED", 503);
    }
    return authorizeSignature(
      request,
      allowedRoles,
      parsedKeys,
      Math.floor(now() / 1000),
    );
  };
}
