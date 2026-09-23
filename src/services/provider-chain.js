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
    let pathChallenge = null;

    for (const provider of requested) {
      // A challenged browser is closed, never retried or used as a credential
      // source. Only the separately guarded TikHub single-video method may run.
      if (pathChallenge && (provider.id !== "tikhub" ||
          typeof provider.readIndependentPublicVideo !== "function")) continue;
      if (typeof provider[method] !== "function") {
        attempts.push({ provider: provider.id, status: "unsupported" });
        continue;
      }
      try {
        const value = pathChallenge
          ? await provider.readIndependentPublicVideo(context)
          : await provider[method](context);
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
          // Keep the bounded TikHub HTTP summary above nested details so the
          // existing public-error depth limit does not erase the actual cause.
          ...(provider.id === "tikhub" && method === "readVideo" &&
              Array.isArray(error?.details?.attempts) ? {
            upstream_errors: error.details.attempts.slice(0, 2).map((attempt) => {
              const details = attempt.error?.details;
              return sanitizeDiagnostics({
                route: typeof attempt.route === "string" ? attempt.route : null,
                http_status: Number.isInteger(details?.http_status) ? details.http_status : null,
                code: ["string", "number"].includes(typeof details?.code) ? details.code : null,
                message: typeof details?.message === "string" ? details.message : null
              });
            })
          } : {}),
          error: sanitizeDiagnostics({
            code: error?.code ?? "PROVIDER_ERROR",
            message: error?.message ?? "Provider failed.",
            details: error?.details
          })
        };
        attempts.push(diagnostic);

        if (isTerminalAccessError(error)) {
          if (!pathChallenge && method === "readVideo" && context?.awemeId &&
              provider.id === "direct_public_web" &&
              error.code === "DOUYIN_SECURITY_VERIFICATION_REQUIRED" &&
              error.details?.provider === "direct_public_web" &&
              error.details?.reason === "visible_security_challenge" &&
              error.details?.access_scope === "provider_path" &&
              requested.slice(requested.indexOf(provider) + 1).some((next) =>
                next.id === "tikhub" && typeof next.readIndependentPublicVideo === "function")) {
            pathChallenge = error;
            continue;
          }
          if (error instanceof ReaderError) {
            error.details = sanitizeDiagnostics({ ...error.details, provider_attempts: attempts });
          }
          throw error;
        }
      }
    }

    if (pathChallenge) {
      // Preserve the terminal browser boundary for media/caption consumers:
      // a failed independent lookup is not permission to use stale media.
      pathChallenge.details = sanitizeDiagnostics({ ...pathChallenge.details, provider_attempts: attempts });
      throw pathChallenge;
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
