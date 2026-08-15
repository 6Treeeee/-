import { createHash } from "node:crypto";

function hashValue(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
}

function safeUrlString(value) {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname}#${hashValue(value)}`;
  } catch {
    return `[url:${hashValue(value)}]`;
  }
}

function safeString(value) {
  return String(value)
    // Provider and network errors often embed signed URLs inside prose rather
    // than returning the URL as a standalone field. Redact every URL substring.
    .replace(/https?:\/\/[^\s<>"'`]+/gi, (url) => safeUrlString(url))
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, "Bearer [redacted]")
    .replace(/((?:api[_-]?key|token|authorization|cookie)=)[^\s&,]+/gi, "$1[redacted]")
    .slice(0, 500);
}

export function sanitizeDiagnostics(value, depth = 0) {
  if (depth > 8) return "[truncated]";
  if (value === null || value === undefined || typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (typeof value === "string") return safeString(value);
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeDiagnostics(item, depth + 1));
  if (typeof value !== "object") return safeString(value);

  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (/(?:authorization|api[_-]?key|secret|cookie|set-cookie|token)$/i.test(key)) {
      output[key] = "[redacted]";
      continue;
    }
    output[key] = sanitizeDiagnostics(item, depth + 1);
  }
  return output;
}

export class ReaderError extends Error {
  constructor(code, message, { status = 500, details, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "ReaderError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function publicError(error) {
  if (error instanceof ReaderError) {
    return {
      code: error.code,
      message: safeString(error.message),
      status: error.status,
      ...(error.details ? { details: sanitizeDiagnostics(error.details) } : {})
    };
  }

  return {
    code: "INTERNAL_ERROR",
    message: "The content reader failed unexpectedly.",
    status: 500
  };
}

export function errorSummary(error) {
  const safe = publicError(error);
  return {
    code: safe.code,
    message: safe.message,
    ...(safe.details ? { details: safe.details } : {})
  };
}
