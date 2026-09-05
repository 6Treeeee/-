import { createHash } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";

const CONFIG_KEYS = [
  "TREE_BRAIN_MCP_URL",
  "TREE_BRAIN_OAUTH_ISSUER",
  "TREE_BRAIN_OAUTH_JWKS_URL",
  "TREE_BRAIN_OAUTH_SUBJECTS_JSON",
];
const WORKSPACE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SUPPORTED_SCOPES = Object.freeze(["treebrain:read", "treebrain:check"]);
const ALGORITHMS = Object.freeze(["RS256", "ES256", "EdDSA"]);

export class TreeBrainOAuthError extends Error {
  constructor(code, status = 401) {
    super(code);
    this.name = "TreeBrainOAuthError";
    this.code = code;
    this.status = status;
    this.statusCode = status;
  }
}

function configurationError() {
  return new TreeBrainOAuthError("TREE_BRAIN_OAUTH_NOT_CONFIGURED", 503);
}

function httpsUrl(value, { allowQuery = false } = {}) {
  if (typeof value !== "string" || !value || value !== value.trim()) {
    throw configurationError();
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw configurationError();
  }
  if (
    url.protocol !== "https:" ||
    !url.hostname ||
    url.username ||
    url.password ||
    value.includes("#") ||
    (!allowQuery && value.includes("?")) ||
    /[\u0000-\u0020\u007f\\]/.test(value)
  ) {
    throw configurationError();
  }
  return url;
}

/** Read only resource-server settings; never create or publish an OAuth issuer. */
export function readAuthConfig(env = process.env) {
  if (CONFIG_KEYS.every((key) => env[key] == null)) return null;
  const resourceUrl = httpsUrl(env.TREE_BRAIN_MCP_URL);
  if (!resourceUrl.pathname.endsWith("/mcp")) throw configurationError();
  httpsUrl(env.TREE_BRAIN_OAUTH_ISSUER);
  const jwksUrl = httpsUrl(env.TREE_BRAIN_OAUTH_JWKS_URL, { allowQuery: true });

  let subjectEntries;
  try {
    if (typeof env.TREE_BRAIN_OAUTH_SUBJECTS_JSON !== "string") {
      throw configurationError();
    }
    const parsed = JSON.parse(env.TREE_BRAIN_OAUTH_SUBJECTS_JSON);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      throw configurationError();
    }
    subjectEntries = Object.entries(parsed);
  } catch {
    throw configurationError();
  }
  if (subjectEntries.length === 0 || subjectEntries.length > 1_000) {
    throw configurationError();
  }
  const subjects = new Map();
  for (const [subject, workspaceIds] of subjectEntries) {
    if (
      !subject ||
      subject.length > 1_024 ||
      !Array.isArray(workspaceIds) ||
      workspaceIds.length === 0 ||
      workspaceIds.length > 50 ||
      workspaceIds.some((id) => typeof id !== "string" || !WORKSPACE_ID_RE.test(id))
    ) {
      throw configurationError();
    }
    subjects.set(subject, Object.freeze([...new Set(workspaceIds)]));
  }
  return Object.freeze({
    resource: resourceUrl.href,
    // Issuer comparison is exact, including the provider's trailing slash.
    issuer: env.TREE_BRAIN_OAUTH_ISSUER,
    jwksUrl: jwksUrl.href,
    subjects,
  });
}

export function protectedResourceMetadata(config) {
  if (!config) throw configurationError();
  return {
    resource: config.resource,
    authorization_servers: [config.issuer],
    scopes_supported: [...SUPPORTED_SCOPES],
  };
}

export function authenticationChallenge(config) {
  if (!config) return "Bearer";
  const metadataUrl = new URL("/.well-known/oauth-protected-resource", config.resource);
  return `Bearer resource_metadata="${metadataUrl.href}"`;
}

function unauthorized() {
  return new TreeBrainOAuthError("TREE_BRAIN_UNAUTHORIZED", 401);
}

function forbidden() {
  return new TreeBrainOAuthError("TREE_BRAIN_FORBIDDEN", 403);
}

export function createOAuthAuthorizer({ env = process.env, keyResolver } = {}) {
  let config;
  let resolveKey;
  return async function authorize(authorizationHeader, requiredScopes = []) {
    config ||= readAuthConfig(env);
    if (!config) throw configurationError();
    if (
      !Array.isArray(requiredScopes) ||
      requiredScopes.some((scope) => !SUPPORTED_SCOPES.includes(scope))
    ) {
      throw forbidden();
    }
    if (typeof authorizationHeader !== "string" || authorizationHeader.length > 16_384) {
      throw unauthorized();
    }
    const match = /^Bearer[ \t]+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(
      authorizationHeader,
    );
    if (!match) throw unauthorized();

    let payload;
    try {
      // Keys come only from configured discovery, never from token jku/x5u headers.
      resolveKey ||= keyResolver || createRemoteJWKSet(new URL(config.jwksUrl));
      ({ payload } = await jwtVerify(match[1], resolveKey, {
        issuer: config.issuer,
        audience: config.resource,
        algorithms: ALGORITHMS,
        requiredClaims: ["iss", "aud", "exp", "sub"],
      }));
      if (typeof payload.sub !== "string" || !payload.sub || payload.sub.length > 1_024) {
        throw unauthorized();
      }
    } catch {
      // Verification errors may contain provider details; expose only a stable code.
      throw unauthorized();
    }

    const workspaceIds = config.subjects.get(payload.sub);
    if (!workspaceIds) throw forbidden();
    const scopes = new Set(
      [payload.scope, payload.scp]
        .filter((value) => typeof value === "string")
        .flatMap((value) => value.split(/\s+/).filter(Boolean)),
    );
    if (requiredScopes.some((scope) => !scopes.has(scope))) throw forbidden();

    const identityHash = createHash("sha256")
      .update(JSON.stringify([config.issuer, payload.sub]))
      .digest("hex");
    return {
      key_id: `oauth-${identityHash.slice(0, 48)}`,
      principal_id: `oauth:${identityHash}`,
      role: "decision",
      workspace_ids: [...workspaceIds],
    };
  };
}
