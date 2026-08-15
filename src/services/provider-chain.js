import { ReaderError, sanitizeDiagnostics } from "../errors.js";

export { sanitizeDiagnostics } from "../errors.js";

const TERMINAL_ACCESS_CODES = new Set([
  "DOUYIN_LOGIN_REQUIRED",
  "DOUYIN_CAPTCHA_REQUIRED",
  "DOUYIN_SECURITY_VERIFICATION_REQUIRED",
  "DOUYIN_PRIVATE_CONTENT",
  "DOUYIN_PAID_CONTENT",
  "DOUYIN_DRM_RESTRICTED",
  "DOUYIN_ACCESS_RESTRICTED",
  "DOUYIN_VIDEO_RESTRICTED",
  "DOUYIN_PROFILE_RESTRICTED",
  "DOUYIN_CONTENT_UNAVAILABLE"
]);

export function isTerminalAccessError(error) {
  return TERMINAL_ACCESS_CODES.has(error?.code);
}

export class ProviderChain {
  constructor(providers = []) {
    this.providers = providers.filter((provider) => provider?.available !== false);
  }

  get(id) {
    return this.providers.find((provider) => provider.id === id) ?? null;
  }

  async run(method, context, { order = null, usable = (value) => Boolean(value) } = {}) {
    const requested = order
      ? order.map((id) => this.get(id)).filter(Boolean)
      : this.providers;
    const attempts = [];
    let lastError = null;

    for (const provider of requested) {
      if (typeof provider[method] !== "function") {
        attempts.push({ provider: provider.id, status: "unsupported" });
        continue;
      }
      try {
        const value = await provider[method](context);
        if (!usable(value)) {
          attempts.push({ provider: provider.id, status: "unusable_result" });
          continue;
        }
        attempts.push({ provider: provider.id, status: "success" });
        return { value, provider, attempts };
      } catch (error) {
        lastError = error;
        const diagnostic = {
          provider: provider.id,
          status: isTerminalAccessError(error) ? "access_restricted" : "failed",
          error: sanitizeDiagnostics({
            code: error?.code ?? "PROVIDER_ERROR",
            message: error?.message ?? "Provider failed.",
            details: error?.details
          })
        };
        attempts.push(diagnostic);

        if (isTerminalAccessError(error)) {
          if (error instanceof ReaderError) {
            error.details = sanitizeDiagnostics({ ...error.details, provider_attempts: attempts });
          }
          throw error;
        }
      }
    }

    if (requested.length === 1 && lastError instanceof ReaderError) {
      lastError.details = sanitizeDiagnostics({ ...lastError.details, provider_attempts: attempts });
      throw lastError;
    }

    throw new ReaderError("DOUYIN_PROVIDER_CHAIN_FAILED", "No public Douyin provider returned a usable result.", {
      status: 502,
      details: { method, attempts },
      cause: lastError
    });
  }
}
