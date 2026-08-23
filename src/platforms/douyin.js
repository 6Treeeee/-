import { ReaderError } from "../errors.js";
import { normalizeCreator, normalizeVideo } from "../normalizers/douyin.js";
import { DirectPublicWebProvider } from "../providers/direct-public-web.js";
import { TikHubProvider } from "../providers/tikhub.js";
import { VerifiedPublicArtifactProvider } from "../providers/verified-public-artifact.js";
import { CreatorAnalyzer } from "../services/analysis.js";
import { ArtifactStore } from "../services/artifacts.js";
import { ContentProcessor } from "../services/content-processing.js";
import {
  isTerminalAccessError,
  ProviderChain,
  sanitizeDiagnostics
} from "../services/provider-chain.js";

const DOUYIN_HOSTS = ["douyin.com", "iesdouyin.com"];
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
const RESOLUTION_RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const MOBILE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) " +
  "AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1";

function isDouyinHost(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return DOUYIN_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

export function isDouyinUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password &&
      isDouyinHost(url.hostname);
  } catch {
    return false;
  }
}

function validatedDouyinUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new ReaderError("INVALID_URL", "A valid public URL is required.", { status: 400 });
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new ReaderError(
      "INVALID_URL",
      "Only public HTTP(S) URLs without credentials are accepted.",
      { status: 400 }
    );
  }
  if (!isDouyinHost(url.hostname)) {
    throw new ReaderError("UNSUPPORTED_PLATFORM", "Phase 1 currently supports Douyin URLs only.", {
      status: 422,
      details: { detected_host: url.hostname }
    });
  }
  return url;
}

async function closeBody(response) {
  try {
    await response.body?.cancel();
  } catch {
    // Redirect responses can already be bodyless or consumed by the runtime.
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function resolveDouyinUrl(
  value,
  fetchImpl = globalThis.fetch,
  { retries = 2, retryDelayMs = 250, sleepImpl = wait } = {}
) {
  let current = validatedDouyinUrl(value);
  // Stable canonical content URLs already carry the identity needed by the
  // public provider. Fetching the same HTML once here only duplicates the
  // later browser navigation and can consume the transcription time budget.
  if (/^\/(?:video|note)\/\d+\/?$/i.test(current.pathname) ||
      /^\/user\/[^/]+\/?$/i.test(current.pathname)) {
    return { finalUrl: current.href, resolved: false, hops: [] };
  }
  const visited = new Set();
  const hops = [];

  for (let index = 0; index < 6; index += 1) {
    if (visited.has(current.href)) {
      return { finalUrl: current.href, resolved: false, hops, warning: "redirect_loop" };
    }
    visited.add(current.href);
    let lastError = null;
    let advanced = false;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await fetchImpl(current, {
          method: "GET",
          redirect: "manual",
          headers: { "User-Agent": MOBILE_USER_AGENT, Accept: "text/html,*/*" },
          signal: controller.signal
        });
        const location = response.headers.get("location");
        const retryable = RESOLUTION_RETRY_STATUS.has(response.status);
        if (retryable && attempt < retries) {
          await closeBody(response);
          await sleepImpl(retryDelayMs * (attempt + 1));
          continue;
        }
        hops.push({ status: response.status, host: current.hostname, attempts: attempt + 1 });
        await closeBody(response);
        if (!REDIRECT_STATUS.has(response.status) || !location) {
          return {
            finalUrl: current.href,
            resolved: current.href !== value,
            hops,
            ...(retryable ? { warning: "resolution_upstream_unavailable" } : {})
          };
        }
        current = validatedDouyinUrl(new URL(location, current).href);
        advanced = true;
        break;
      } catch (error) {
        if (error instanceof ReaderError) throw error;
        lastError = error;
        if (attempt < retries) {
          await sleepImpl(retryDelayMs * (attempt + 1));
          continue;
        }
      } finally {
        clearTimeout(timer);
      }
    }
    if (!advanced && lastError) {
      return {
        finalUrl: current.href,
        resolved: current.href !== value,
        hops,
        warning: lastError?.name === "AbortError" ? "resolution_timeout" : "resolution_failed"
      };
    }
  }
  return { finalUrl: current.href, resolved: true, hops, warning: "redirect_limit" };
}

function publicSourceUrl(value) {
  const url = validatedDouyinUrl(value);
  url.hash = "";
  const pathIdentifiesContent = /\/(?:share\/)?(?:user|video)\//i.test(url.pathname) ||
    /\/note\//i.test(url.pathname);
  if (pathIdentifiesContent) {
    url.search = "";
  } else {
    const secUid = url.searchParams.get("sec_uid");
    const modalId = url.searchParams.get("modal_id");
    url.search = "";
    if (secUid) url.searchParams.set("sec_uid", secUid);
    if (modalId) url.searchParams.set("modal_id", modalId);
  }
  return url.href;
}

export function detectDouyinContentType(value) {
  const url = validatedDouyinUrl(value);
  const path = decodeURIComponent(url.pathname);
  if (/\/(?:share\/)?user\//i.test(path) || url.searchParams.has("sec_uid")) return "profile";
  if (/\/(?:share\/)?video\/\d+/i.test(path) || /\/note\/\d+/i.test(path) ||
      url.searchParams.has("modal_id")) return "video";
  return "unknown";
}

function secUserIdFromUrl(value) {
  const url = validatedDouyinUrl(value);
  const match = decodeURIComponent(url.pathname).match(/\/(?:share\/)?user\/([^/?#]+)/i);
  return match?.[1] ?? url.searchParams.get("sec_uid") ?? null;
}

function awemeIdFromUrl(value) {
  const url = validatedDouyinUrl(value);
  return decodeURIComponent(url.pathname).match(/\/(?:share\/)?(?:video|note)\/(\d+)/i)?.[1] ??
    url.searchParams.get("modal_id")?.match(/^\d+$/)?.[0] ?? null;
}

function canonicalPagination(pagination = {}, creator, itemCount, limitation) {
  const expectedPosts = pagination.expected_posts ?? pagination.displayed_post_count ??
    creator?.stats?.post_count ?? null;
  const uniquePosts = pagination.unique_posts ?? pagination.unique_items ?? itemCount;
  const publicExhausted = pagination.public_access_exhausted ?? pagination.complete ??
    pagination.upstream_exhausted ?? false;
  return {
    ...pagination,
    complete: Boolean(publicExhausted),
    scope: pagination.scope ?? "public_unauthenticated",
    public_access_exhausted: Boolean(publicExhausted),
    upstream_exhausted: pagination.upstream_exhausted ?? false,
    count_consistent: expectedPosts === null || uniquePosts >= expectedPosts,
    expected_posts: expectedPosts,
    profile_count_gap: expectedPosts === null ? null : Math.max(0, expectedPosts - uniquePosts),
    unique_posts: uniquePosts,
    duplicates_removed: pagination.duplicates_removed ?? 0,
    pages_fetched: pagination.pages_fetched ?? pagination.pages_captured ?? 0,
    limitation: limitation ?? null
  };
}

function accessFailureRecord(limitation) {
  if (!limitation) return [];
  return [{
    aweme_id: null,
    count: limitation.inaccessible_count ?? null,
    reason: {
      code: limitation.code ?? "PUBLIC_ACCESS_LIMITATION",
      type: limitation.type ?? "access_limited",
      message: limitation.message ?? "The public profile exposed an access boundary."
    }
  }];
}

export class DouyinReader {
  constructor({
    apiKey,
    fetchImpl = globalThis.fetch,
    client,
    providers,
    tikhubProvider,
    directProvider,
    processor,
    analyzer = new CreatorAnalyzer(),
    artifactStore = new ArtifactStore(),
    openAiApiKey = process.env.OPENAI_API_KEY,
    aiGatewayApiKey = process.env.AI_GATEWAY_API_KEY,
    vercelOidcToken = process.env.VERCEL_OIDC_TOKEN,
    localAsr = null,
    requestDeadlineAt = null,
    processContent,
    profileConcurrency = 3
  } = {}) {
    this.fetchImpl = fetchImpl;
    this.explicitProviders = Boolean(providers);
    this.artifactStore = artifactStore;
    this.hasLocalFallback = typeof localAsr === "function";

    let configuredProviders = providers;
    if (!configuredProviders) {
      const hasLocalFallback = typeof localAsr === "function";
      const tikhub = tikhubProvider ?? new TikHubProvider({
        apiKey,
        fetchImpl,
        client,
        ...(hasLocalFallback ? { clientOptions: { timeoutMs: 6_000, retries: 0 } } : {})
      });
      configuredProviders = [];
      if (tikhub.available) configuredProviders.push(tikhub);
      if (directProvider) configuredProviders.push(directProvider);
      else if (!client) configuredProviders.push(new DirectPublicWebProvider(
        hasLocalFallback ? {
          videoNavigationTimeoutMs: 15_000,
          videoContentWaitMs: 15_000,
          retries: 2,
          retryDelayMs: 200
        } : {}
      ));
      if (!client) {
        configuredProviders.push(new VerifiedPublicArtifactProvider({ artifactStore }));
      }
    }
    this.chain = new ProviderChain(configuredProviders);
    this.processContent = processContent ?? !client;
    this.processor = processor ?? new ContentProcessor({
      fetchImpl,
      artifactStore,
      openAiApiKey,
      aiGatewayApiKey,
      vercelOidcToken,
      localAsr,
      requestDeadlineAt,
      profileConcurrency
    });
    this.analyzer = analyzer;
  }

  orderFor(contentType) {
    const ids = this.chain.providers.map((provider) => provider.id);
    if (this.explicitProviders) return ids;
    if (contentType === "profile") {
      // The rendered public grid is authoritative. A recent verified capture
      // of that same logged-out grid may recover transient live-browser
      // failures; TikHub must never enumerate beyond the visible boundary.
      const preferred = ["direct_public_web", "verified_public_artifact"];
      const publicGridProviders = [
        ...preferred.filter((id) => ids.includes(id)),
        ...ids.filter((id) => !preferred.includes(id) && id !== "tikhub")
      ];
      // Preserve compatibility with an explicitly injected legacy provider
      // when no public-grid provider exists.
      return publicGridProviders.length ? publicGridProviders : ids;
    }
    // Local transcription needs the same media an ordinary logged-out viewer
    // receives. Prefer Douyin's canonical public page when that path is
    // available, while retaining TikHub as a bounded transient fallback.
    const preferred = this.hasLocalFallback
      ? ["direct_public_web", "tikhub"]
      : ["tikhub", "direct_public_web"];
    return [...preferred.filter((id) => ids.includes(id)), ...ids.filter((id) => !preferred.includes(id))];
  }

  async retrieveVideo(context, order = this.orderFor("video")) {
    // On a cold serverless instance Chromium extraction dominates this path.
    // Start preparing the ordinary logged-out browser while the optional
    // TikHub provider is attempted, so fallback setup is not serialized.
    if (this.hasLocalFallback && order.includes("direct_public_web")) {
      const direct = this.chain.get("direct_public_web");
      if (typeof direct?.prepare === "function") void direct.prepare().catch(() => null);
    }
    try {
      return await this.chain.run("readVideo", context, {
        order,
        usable: (result) => Boolean(result?.aweme)
      });
    } catch (error) {
      if (isTerminalAccessError(error)) throw error;
      if (["DOUYIN_PROVIDER_CHAIN_FAILED", "DOUYIN_PROVIDER_UNAVAILABLE"].includes(error?.code)) {
        throw new ReaderError(
          "DOUYIN_VIDEO_RETRIEVAL_FAILED",
          "Douyin's public retrieval providers could not return this video.",
          { status: 502, details: sanitizeDiagnostics(error.details), cause: error }
        );
      }
      throw error;
    }
  }

  normalizeRetrievedVideo(retrieval, context) {
    const raw = retrieval.value;
    return normalizeVideo(raw.aweme, {
      inputUrl: context.inputUrl,
      resolvedUrl: context.resolvedUrl,
      acquiredAt: raw.meta?.acquired_at ?? new Date().toISOString(),
      networkMediaUrls: raw.networkMediaUrls ?? []
    });
  }

  async readVideo({ inputUrl, resolvedUrl, resolution }) {
    const context = {
      inputUrl,
      resolvedUrl,
      awemeId: awemeIdFromUrl(resolvedUrl) ?? awemeIdFromUrl(inputUrl)
    };
    const retrieval = await this.retrieveVideo(context);
    let content = this.normalizeRetrievedVideo(retrieval, context);

    if (this.processContent) {
      content = await this.processor.processVideo(content, {
        refreshVideo: async (awemeId) => {
          const canonicalUrl = `https://www.douyin.com/video/${awemeId}`;
          const refreshed = await this.retrieveVideo({
            inputUrl: canonicalUrl,
            resolvedUrl: canonicalUrl,
            awemeId
          }, this.orderFor("video"));
          return this.normalizeRetrievedVideo(refreshed, {
            inputUrl: canonicalUrl,
            resolvedUrl: canonicalUrl
          });
        }
      });
    }

    return {
      schema_version: "2.0",
      platform: "douyin",
      content_type: "video",
      source: {
        input_url: inputUrl,
        resolved_url: resolvedUrl,
        resolution,
        retrieval: sanitizeDiagnostics(retrieval.value.meta),
        provider_attempts: retrieval.attempts
      },
      content
    };
  }

  async resolveSecUserId(inputUrl, resolvedUrl) {
    const direct = secUserIdFromUrl(resolvedUrl) ?? secUserIdFromUrl(inputUrl);
    if (direct) return { secUserId: direct, meta: { method: "public_redirect" } };
    const providers = this.chain.providers.filter((provider) =>
      typeof provider.resolveSecUserId === "function");
    for (const provider of providers) {
      try {
        return await provider.resolveSecUserId(inputUrl);
      } catch (error) {
        if (isTerminalAccessError(error)) throw error;
      }
    }
    return { secUserId: null, meta: { method: "public_page" } };
  }

  async readProfile({ inputUrl, resolvedUrl, resolution, knownSecUserId = null }) {
    const identity = knownSecUserId
      ? { secUserId: knownSecUserId, meta: { method: "content_detection" } }
      : await this.resolveSecUserId(inputUrl, resolvedUrl);
    const context = { inputUrl, resolvedUrl, secUserId: identity.secUserId };
    let retrieval;
    try {
      retrieval = await this.chain.run("readProfile", context, {
        order: this.orderFor("profile"),
        usable: (result) => Boolean(result?.creator && Array.isArray(result?.items))
      });
    } catch (error) {
      if (isTerminalAccessError(error)) throw error;
      if (["DOUYIN_PROVIDER_CHAIN_FAILED", "DOUYIN_PROVIDER_UNAVAILABLE"].includes(error?.code)) {
        throw new ReaderError(
          "DOUYIN_PROFILE_RETRIEVAL_FAILED",
          "Douyin's public retrieval providers could not return this creator profile.",
          { status: 502, details: sanitizeDiagnostics(error.details), cause: error }
        );
      }
      throw error;
    }

    const raw = retrieval.value;
    let creator = raw.items_normalized ? raw.creator : normalizeCreator(raw.creator);
    const secUserId = creator.sec_user_id ?? identity.secUserId;
    if (secUserId && !creator.sec_user_id) creator = { ...creator, sec_user_id: secUserId };
    const acquiredAt = raw.meta?.acquired_at ?? new Date().toISOString();
    let posts = raw.items_normalized
      ? raw.items.map((item) => ({ ...item }))
      : raw.items.map((item) => normalizeVideo(item, { acquiredAt }));
    const pagination = canonicalPagination(raw.pagination, creator, posts.length, raw.limitation);
    const warnings = [...(raw.warnings ?? [])];
    if (raw.limitation) {
      warnings.push({
        code: raw.limitation.code ?? "PARTIAL_PUBLIC_PROFILE",
        message: raw.limitation.message,
        inaccessible_count: raw.limitation.inaccessible_count ?? pagination.profile_count_gap
      });
    } else if (!pagination.count_consistent) {
      warnings.push({
        code: "POST_COUNT_MISMATCH",
        expected_posts: pagination.expected_posts,
        accessible_unique_posts: pagination.unique_posts,
        message: "The public unauthenticated feed ended before the profile display count was reached."
      });
    }

    let processingFailures = raw.content_preprocessed
      ? posts.filter((post) => post?.readable_content?.status !== "complete").map((post) => ({
          aweme_id: post.aweme_id ?? post.id,
          url: post.canonical_url,
          reason: post.readable_content?.error ?? { code: "CONTENT_READING_FAILED" }
        }))
      : [];
    let processingPolicy = null;
    if (this.processContent && !raw.content_preprocessed && posts.length > 0) {
      const processed = await this.processor.processProfile(posts, {
        refreshVideo: async (awemeId) => {
          const canonicalUrl = `https://www.douyin.com/video/${awemeId}`;
          const refreshed = await this.retrieveVideo({
            inputUrl: canonicalUrl,
            resolvedUrl: canonicalUrl,
            awemeId
          }, this.orderFor("video"));
          return this.normalizeRetrievedVideo(refreshed, {
            inputUrl: canonicalUrl,
            resolvedUrl: canonicalUrl
          });
        }
      });
      posts = processed.posts;
      processingFailures = processed.failures;
      processingPolicy = processed.policy ?? null;
    }

    const processingEnabled = Boolean(raw.content_preprocessed || this.processContent);
    const attemptedPosts = processingEnabled ? posts.length : 0;
    // An enabled processor did not actually process content when the public
    // unauthenticated boundary exposed no posts. Keep access-scope completion
    // in pagination and report content processing as not attempted.
    const processingPerformed = processingEnabled && attemptedPosts > 0;
    const successfullyContentRead = processingPerformed
      ? Math.max(0, posts.length - processingFailures.length)
      : 0;
    const processingComplete = processingPerformed && processingFailures.length === 0;
    const processingStatus = !processingPerformed
      ? "not_attempted"
      : processingComplete
        ? "complete"
        : successfullyContentRead > 0
          ? "partial"
          : "failed";

    const accessFailures = accessFailureRecord(raw.limitation);
    const analysis = this.analyzer.analyze({
      creator,
      posts,
      failures: [...processingFailures, ...accessFailures],
      pagination,
      source: {
        provider: retrieval.provider.id,
        retrieval: sanitizeDiagnostics(raw.meta)
      }
    });

    return {
      schema_version: "2.0",
      platform: "douyin",
      content_type: "profile",
      source: {
        input_url: inputUrl,
        resolved_url: resolvedUrl,
        resolution,
        identity_retrieval: identity.meta,
        retrieval: sanitizeDiagnostics(raw.meta),
        provider_attempts: retrieval.attempts
      },
      content: {
        creator,
        posts,
        pagination,
        limitation: raw.limitation ?? null,
        warnings,
        processing: {
          status: processingStatus,
          complete: processingComplete,
          attempted_posts: attemptedPosts,
          successfully_content_read: successfullyContentRead,
          failed_posts: processingFailures,
          ...(processingPolicy ? { policy: processingPolicy } : {})
        },
        analysis
      }
    };
  }

  async read({ url, type = "auto" }) {
    const inputUrl = validatedDouyinUrl(url).href;
    const resolution = await resolveDouyinUrl(inputUrl, this.fetchImpl);
    const resolvedUrl = publicSourceUrl(resolution.finalUrl);
    const sourceResolution = { ...resolution, finalUrl: resolvedUrl };
    const requestedType = String(type).toLowerCase();
    if (!["auto", "video", "profile"].includes(requestedType)) {
      throw new ReaderError("INVALID_CONTENT_TYPE", "type must be auto, video, or profile.", { status: 400 });
    }

    const detectedType = requestedType === "auto" ? detectDouyinContentType(resolvedUrl) : requestedType;
    if (detectedType === "profile") {
      return this.readProfile({ inputUrl, resolvedUrl, resolution: sourceResolution });
    }
    if (detectedType === "video") {
      return this.readVideo({ inputUrl, resolvedUrl, resolution: sourceResolution });
    }

    // A short-link fetch can fail transiently even though an ordinary public
    // browser can still follow it. Probe only the same logged-out public page;
    // no login, cookie import, challenge handling, or alternate access is used.
    const direct = this.chain.get("direct_public_web");
    if (typeof direct?.resolveContent === "function") {
      try {
        const browserResolution = await direct.resolveContent({ inputUrl, resolvedUrl });
        const browserResolvedUrl = publicSourceUrl(browserResolution.finalUrl);
        const browserDetectedType = browserResolution.contentType ??
          detectDouyinContentType(browserResolvedUrl);
        const browserSourceResolution = {
          ...sourceResolution,
          finalUrl: browserResolvedUrl,
          browser_fallback: sanitizeDiagnostics(browserResolution.meta)
        };
        if (browserDetectedType === "profile") {
          return this.readProfile({
            inputUrl,
            resolvedUrl: browserResolvedUrl,
            resolution: browserSourceResolution
          });
        }
        if (browserDetectedType === "video") {
          return this.readVideo({
            inputUrl,
            resolvedUrl: browserResolvedUrl,
            resolution: browserSourceResolution
          });
        }
      } catch (error) {
        if (isTerminalAccessError(error)) throw error;
        // Provider diagnostics are returned only if all identity paths fail.
        sourceResolution.browser_fallback_error = sanitizeDiagnostics({
          code: error?.code ?? "DOUYIN_PUBLIC_BROWSER_RESOLUTION_FAILED",
          details: error?.details
        });
      }
    }

    const identity = await this.resolveSecUserId(inputUrl, resolvedUrl);
    if (identity.secUserId) {
      return this.readProfile({
        inputUrl,
        resolvedUrl,
        resolution: sourceResolution,
        knownSecUserId: identity.secUserId
      });
    }
    const awemeId = awemeIdFromUrl(resolvedUrl) ?? awemeIdFromUrl(inputUrl);
    if (awemeId) {
      return this.readVideo({ inputUrl, resolvedUrl, resolution: sourceResolution });
    }
    throw new ReaderError(
      "DOUYIN_CONTENT_NOT_RESOLVED",
      "The URL was neither a readable public profile nor video.",
      { status: 422 }
    );
  }
}
