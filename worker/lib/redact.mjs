const SENSITIVE_KEY = /(?:authorization|cookie|password|passwd|secret|token|private[_-]?key|oidc|signature|api[_-]?key)/i;
const PEM_BLOCK = /-----BEGIN [^-]*(?:PRIVATE KEY|CERTIFICATE)-----[\s\S]*?-----END [^-]*(?:PRIVATE KEY|CERTIFICATE)-----/gi;
const BEARER_VALUE = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const QUERY_SECRET = /([?&](?:access_token|api_key|key|token|signature)=)[^&#\s]+/gi;

function redactString(value) {
  return value
    .replace(PEM_BLOCK, "[REDACTED_PEM]")
    .replace(BEARER_VALUE, "Bearer [REDACTED]")
    .replace(QUERY_SECRET, "$1[REDACTED]");
}
export function redact(value, { maxDepth = 8 } = {}, depth = 0, seen = new WeakSet()) {
  if (typeof value === "string") {
    return redactString(value);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (depth >= maxDepth) {
    return "[MAX_DEPTH]";
  }
  if (seen.has(value)) {
    return "[CIRCULAR]";
  }
  seen.add(value);

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      code: typeof value.code === "string" ? value.code : undefined,
    };
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redact(entry, { maxDepth }, depth + 1, seen));
  }

  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = SENSITIVE_KEY.test(key)
      ? "[REDACTED]"
      : redact(entry, { maxDepth }, depth + 1, seen);
  }
  return output;
}

export function createSafeLogger(logger = console) {
  function write(level, message, data) {
    const safeMessage = redactString(String(message));
    if (data === undefined) {
      logger[level]?.(safeMessage);
      return;
    }
    logger[level]?.(safeMessage, redact(data));
  }

  return {
    debug: (message, data) => write("debug", message, data),
    info: (message, data) => write("info", message, data),
    warn: (message, data) => write("warn", message, data),
    error: (message, data) => write("error", message, data),
  };
}
