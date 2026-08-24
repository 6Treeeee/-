import {
  createHash,
  createPrivateKey,
  randomBytes,
  randomUUID,
  sign as signBytes,
} from "node:crypto";

import { redact } from "./redact.mjs";

const HEADER_PREFIX = "x-a2a-";

export class A2AHttpError extends Error {
  constructor(message, { status = null, code = null } = {}) {
    super(message);
    this.name = "A2AHttpError";
    this.status = status;
    this.code = code;
  }
}

export function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function createCanonicalRequest({ timestamp, nonce, method, pathAndSearch, bodyHash }) {
  return [timestamp, nonce, method.toUpperCase(), pathAndSearch, bodyHash].join("\n");
}

export function canonicalPathAndSearch(url) {
  const pairs = [...url.searchParams.entries()]
    .filter(([key]) => key !== "route")
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => (
      leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue)
    ));
  const search = new URLSearchParams();
  for (const [key, value] of pairs) search.append(key, value);
  const serialized = search.toString();
  return `${url.pathname}${serialized ? `?${serialized}` : ""}`;
}

export function parsePrivateKey(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("A2A worker private key is missing");
  }
  const normalized = value.includes("\\n") ? value.replaceAll("\\n", "\n") : value;
  if (normalized.startsWith("base64:")) {
    return createPrivateKey({
      key: Buffer.from(normalized.slice("base64:".length), "base64"),
      format: "der",
      type: "pkcs8",
    });
  }
  return createPrivateKey(normalized);
}

function validateBaseUrl(input) {
  const url = new URL(input);
  if (url.username || url.password) {
    throw new Error("control_url must not contain credentials");
  }
  const localHttp = url.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !localHttp) {
    throw new Error("control_url must use HTTPS (HTTP is allowed only for loopback testing)");
  }
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
}

function safeResponseMessage(payload, status) {
  const safe = redact(payload);
  const candidate = safe && typeof safe === "object"
    ? safe.error?.message ?? safe.message ?? safe.error?.code ?? safe.code
    : null;
  const text = candidate ? String(candidate) : `A2A request failed with HTTP ${status}`;
  return text.slice(0, 500);
}

function isRetryable(error) {
  return error instanceof A2AHttpError
    && (error.status === null || [408, 425, 429, 500, 502, 503, 504].includes(error.status));
}

function retryDelay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class SignedA2AClient {
  constructor({
    controlUrl,
    keyId,
    privateKey,
    fetchImpl = globalThis.fetch,
    now = () => Date.now(),
    nonceFactory = () => randomBytes(16).toString("hex"),
    eventIdFactory = (prefix) => `${prefix}_${randomUUID()}`,
    timeoutMs = 30_000,
  }) {
    if (typeof fetchImpl !== "function") {
      throw new Error("fetch is unavailable");
    }
    if (!/^[A-Za-z0-9._-]{3,64}$/.test(keyId ?? "")) {
      throw new Error("key_id contains unsupported characters");
    }
    this.baseUrl = validateBaseUrl(controlUrl);
    this.keyId = keyId;
    this.privateKey = parsePrivateKey(privateKey);
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.nonceFactory = nonceFactory;
    this.eventIdFactory = eventIdFactory;
    this.timeoutMs = timeoutMs;
  }

  logicalEventId(prefix, supplied) {
    const value = supplied ?? this.eventIdFactory(prefix);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value ?? "")) {
      throw new Error(`${prefix} id is invalid`);
    }
    return value;
  }

  async request(method, pathname, { query, body } = {}) {
    const url = new URL(pathname, this.baseUrl);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null && value !== "") {
          url.searchParams.set(key, String(value));
        }
      }
    }
    url.searchParams.sort();

    const bodyText = body === undefined ? "" : JSON.stringify(body);
    const bodyHash = sha256Hex(bodyText);
    const timestamp = String(Math.floor(this.now() / 1000));
    const nonce = this.nonceFactory();
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) {
      throw new Error("nonceFactory returned an invalid nonce");
    }
    const canonical = createCanonicalRequest({
      timestamp,
      nonce,
      method,
      pathAndSearch: canonicalPathAndSearch(url),
      bodyHash,
    });
    const signature = signBytes(null, Buffer.from(canonical, "utf8"), this.privateKey).toString("base64");
    const headers = {
      accept: "application/json",
      [`${HEADER_PREFIX}key-id`]: this.keyId,
      [`${HEADER_PREFIX}timestamp`]: timestamp,
      [`${HEADER_PREFIX}nonce`]: nonce,
      [`${HEADER_PREFIX}content-sha256`]: bodyHash,
      [`${HEADER_PREFIX}signature`]: signature,
    };
    if (body !== undefined) {
      headers["content-type"] = "application/json";
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("A2A request timed out")), this.timeoutMs);
    timeout.unref?.();
    let response;
    let responseText;
    try {
      response = await this.fetchImpl(url, {
        method: method.toUpperCase(),
        headers,
        body: body === undefined ? undefined : bodyText,
        signal: controller.signal,
      });
      responseText = await response.text();
    } catch (error) {
      const safe = redact(error);
      throw new A2AHttpError(safe.message ?? "A2A request failed", { code: safe.code ?? null });
    } finally {
      clearTimeout(timeout);
    }

    let payload = null;
    if (responseText !== "") {
      try {
        payload = JSON.parse(responseText);
      } catch {
        throw new A2AHttpError(`A2A returned non-JSON HTTP ${response.status}`, { status: response.status });
      }
    }
    if (!response.ok) {
      throw new A2AHttpError(safeResponseMessage(payload, response.status), {
        status: response.status,
        code: payload?.error?.code ?? payload?.code ?? null,
      });
    }
    return payload;
  }

  async requestLogicalEvent(method, pathname, body) {
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.request(method, pathname, { body });
      } catch (error) {
        lastError = error;
        if (attempt === 1 || !isRetryable(error)) throw error;
        await retryDelay(200);
      }
    }
    throw lastError;
  }

  async listTasks({ workspaceId, statuses = "submitted|running|review_required", limit = 10 } = {}) {
    const payload = await this.request("GET", "/tasks", {
      query: { status: statuses, workspace_id: workspaceId, limit },
    });
    if (Array.isArray(payload)) {
      return payload;
    }
    return Array.isArray(payload?.tasks) ? payload.tasks : [];
  }

  createTask(task) {
    if (!task || typeof task !== "object" || Array.isArray(task)) {
      throw new Error("task must be an object");
    }
    const requestId = this.logicalEventId("request", task.request_id);
    return this.requestLogicalEvent("POST", "/tasks", {
      ...task,
      request_id: requestId,
    });
  }

  getTask(taskId) {
    return this.request("GET", `/tasks/${encodeURIComponent(taskId)}`);
  }

  getResult(taskId) {
    return this.request("GET", `/tasks/${encodeURIComponent(taskId)}/result`);
  }

  sendDecision(taskId, decision) {
    const decisionId = this.logicalEventId("decision", decision.decision_id);
    return this.requestLogicalEvent(
      "POST",
      `/tasks/${encodeURIComponent(taskId)}/decision`,
      { ...decision, decision_id: decisionId },
    );
  }

  stopTask(taskId, reason, { stopId: suppliedStopId } = {}) {
    const normalized = String(reason ?? "").trim();
    if (normalized === "" || normalized.length > 2_000) {
      throw new Error("stop reason must contain 1 to 2000 characters");
    }
    const stopId = this.logicalEventId("stop", suppliedStopId);
    return this.requestLogicalEvent(
      "POST",
      `/tasks/${encodeURIComponent(taskId)}/stop`,
      { stop_id: stopId, reason: normalized },
    );
  }

  executorEvent(taskId, { kind, workerId, workspaceId, payload = {} }) {
    if (!new Set(["CLAIM", "HEARTBEAT", "REPORT"]).has(kind)) {
      throw new Error(`Unsupported executor event: ${kind}`);
    }
    const eventId = this.logicalEventId("event");
    return this.requestLogicalEvent(
      "POST",
      `/tasks/${encodeURIComponent(taskId)}/executor`,
      {
        event: {
          event_id: eventId,
          kind,
          worker_id: workerId,
          workspace_id: workspaceId,
          at: new Date(this.now()).toISOString(),
          payload,
        },
      },
    );
  }
}
