import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { verifyAcquisitionResult } from "./acquisition-result.js";

const REPO = "6Treeeee/-";
const REF = "codex/a2a-control-loop";
const WORKFLOW = "content-reader-public-browser-probe.yml";
const MAX_BYTES = 4 * 1024 * 1024;
function fail(code, message, status = 503) { return Object.assign(new Error(message), { code, status }); }
export function secureEqual(a, b) {
  const aa = Buffer.from(String(a ?? "")), bb = Buffer.from(String(b ?? ""));
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
export function workerConfiguration(env = process.env) {
  return { preview_only: true, enabled: env.VERCEL_ENV === "preview",
    github_configured: Boolean(env.ACQUISITION_GITHUB_TOKEN || env.GITHUB_TOKEN),
    api_auth_configured: (env.CONTENT_READER_WORKER_API_KEY ?? "").length >= 32,
    repository: REPO, ref: REF, workflow: WORKFLOW };
}
// No files are extracted. Only the bounded result.json member is read.
export function readResultZip(bytes) {
  const b = Buffer.from(bytes);
  if (b.length > MAX_BYTES) throw fail("WORKER_RESULT_TOO_LARGE", "Artifact too large.", 502);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw fail("WORKER_ARTIFACT_INVALID", "Invalid ZIP artifact.", 502);
  const count = b.readUInt16LE(eocd + 10);
  let cursor = b.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > b.length || b.readUInt32LE(cursor) !== 0x02014b50) break;
    const method = b.readUInt16LE(cursor + 10), compressed = b.readUInt32LE(cursor + 20);
    const size = b.readUInt32LE(cursor + 24), nameLength = b.readUInt16LE(cursor + 28);
    const extra = b.readUInt16LE(cursor + 30), comment = b.readUInt16LE(cursor + 32);
    const offset = b.readUInt32LE(cursor + 42);
    const name = b.subarray(cursor + 46, cursor + 46 + nameLength).toString();
    cursor += 46 + nameLength + extra + comment;
    if (name !== "result.json") continue;
    if (size > MAX_BYTES || offset + 30 > b.length || b.readUInt32LE(offset) !== 0x04034b50 || ![0, 8].includes(method)) break;
    const start = offset + 30 + b.readUInt16LE(offset + 26) + b.readUInt16LE(offset + 28);
    if (start + compressed > b.length) break;
    const raw = b.subarray(start, start + compressed);
    const output = method === 8 ? inflateRawSync(raw, { maxOutputLength: MAX_BYTES }) : raw;
    if (output.length !== size) break;
    return JSON.parse(output.toString("utf8"));
  }
  throw fail("WORKER_ARTIFACT_INVALID", "Expected bounded result.json not found.", 502);
}

export class GithubAcquisition {
  constructor({ env = process.env, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
    this.env = env; this.fetch = fetchImpl; this.now = now;
    this.token = env.ACQUISITION_GITHUB_TOKEN || env.GITHUB_TOKEN;
    this.key = env.CONTENT_READER_WORKER_API_KEY;
  }
  configured() {
    const c = workerConfiguration(this.env);
    if (!c.enabled) throw fail("PREVIEW_ONLY", "Worker prototype only runs in Preview.", 403);
    if (!c.github_configured || !c.api_auth_configured) throw fail("WORKER_NOT_CONFIGURED", "Preview requires GitHub Actions write credential and a separate worker API key.");
  }
  signature(body) { return createHmac("sha256", this.key).update(body).digest("base64url"); }
  ticket(task) { const b = Buffer.from(JSON.stringify(task)).toString("base64url"); return `${b}.${this.signature(b)}`; }
  parseTicket(ticket) {
    if (typeof ticket !== "string" || ticket.length > 4096) throw fail("INVALID_TASK", "Invalid task ticket.", 400);
    const [body, signature, extra] = ticket.split(".");
    if (extra || !body || !secureEqual(signature, this.signature(body))) throw fail("INVALID_TASK", "Invalid task signature.", 400);
    let task;
    try { task = JSON.parse(Buffer.from(body, "base64url").toString()); } catch { throw fail("INVALID_TASK", "Invalid task ticket.", 400); }
    if (!/^[a-f0-9-]{36}$/.test(task.request_id ?? "") || !/^\d{15,22}$/.test(task.aweme_id ?? "") ||
        task.exp < this.now() || task.created > this.now() || !/^[a-f0-9]{40}$/.test(task.commit ?? "")) {
      throw fail("INVALID_TASK", "Invalid or expired task.", 400);
    }
    return task;
  }
  async api(path, { method = "GET", body, anonymous = false } = {}) {
    const response = await this.fetch(`https://api.github.com/repos/${REPO}/${path}`, {
      method, headers: { Accept: "application/vnd.github+json", ...(anonymous ? {} : { Authorization: `Bearer ${this.token}` }),
        "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}), redirect: "manual", signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) throw fail("GITHUB_WORKER_HTTP_ERROR", `GitHub worker API returned HTTP ${response.status}.`, response.status === 401 || response.status === 403 ? 503 : 502);
    if (response.status === 204) return null;
    return response.json();
  }
  async trigger(aweme_id) {
    this.configured();
    if (!/^\d{15,22}$/.test(aweme_id ?? "")) throw fail("INVALID_AWEME_ID", "A numeric public Douyin video ID is required.", 400);
    // This fixed repository is public; public branch metadata needs no Contents grant.
    const branch = await this.api(`branches/${encodeURIComponent(REF)}`, { anonymous: true });
    const created = this.now(), request_id = randomUUID();
    const task = { request_id, aweme_id, commit: branch.commit.sha, created, exp: created + 24 * 60 * 60 * 1000 };
    await this.api(`actions/workflows/${WORKFLOW}/dispatches`, { method: "POST", body: {
      ref: REF, inputs: { mode: "acquisition", aweme_id, request_id }
    } });
    return { status: "queued", request_id, aweme_id, task: this.ticket(task), poll_after_ms: 10_000 };
  }
  async poll(ticket) {
    this.configured();
    const task = this.parseTicket(ticket);
    const list = await this.api(`actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&branch=${encodeURIComponent(REF)}&created=${encodeURIComponent(">=" + new Date(task.created - 60_000).toISOString())}&per_page=100`);
    const run = list.workflow_runs?.find(r => r.display_title === `acquisition:${task.request_id}` && r.head_sha === task.commit);
    if (!run) {
      if (this.now() - task.created > 120_000) throw fail("WORKER_RUN_NOT_FOUND", "Dispatch accepted but matching run was not found; check workflow registration and branch changes.", 502);
      return { status: "queued", request_id: task.request_id, poll_after_ms: 10_000 };
    }
    const evidence = { request_id: task.request_id, aweme_id: task.aweme_id, run_id: run.id,
      run_url: run.html_url, commit: run.head_sha, run_status: run.status, conclusion: run.conclusion };
    if (run.status !== "completed") return { status: "running", ...evidence, poll_after_ms: 10_000 };
    const artifacts = await this.api(`actions/runs/${run.id}/artifacts?per_page=100`);
    const artifact = artifacts.artifacts?.find(a => a.name === `acquisition-${task.request_id}` && !a.expired);
    if (!artifact) return { status: "failed", ...evidence, error: { code: "WORKER_RESULT_MISSING", message: "Run completed without a result artifact." } };
    if (artifact.size_in_bytes > MAX_BYTES) throw fail("WORKER_RESULT_TOO_LARGE", "Artifact too large.", 502);
    const redirect = await this.fetch(`https://api.github.com/repos/${REPO}/actions/artifacts/${artifact.id}/zip`, {
      headers: { Authorization: `Bearer ${this.token}`, Accept: "application/vnd.github+json" },
      redirect: "manual", signal: AbortSignal.timeout(15_000)
    });
    if (redirect.status !== 302) throw fail("WORKER_ARTIFACT_HTTP_ERROR", `Artifact API returned HTTP ${redirect.status}.`, 502);
    const location = new URL(redirect.headers.get("location"));
    if (location.protocol !== "https:" || !(location.hostname.endsWith(".blob.core.windows.net") || location.hostname.endsWith(".githubusercontent.com"))) {
      throw fail("WORKER_ARTIFACT_REDIRECT_INVALID", "Unexpected artifact download host.", 502);
    }
    // The GitHub credential is never forwarded to artifact storage.
    const download = await this.fetch(location.href, { redirect: "error", signal: AbortSignal.timeout(15_000) });
    if (!download.ok) throw fail("WORKER_ARTIFACT_HTTP_ERROR", `Artifact storage returned HTTP ${download.status}.`, 502);
    const chunks = []; let length = 0;
    for await (const chunk of download.body) {
      length += chunk.length;
      if (length > MAX_BYTES) { await download.body.cancel?.().catch(() => {}); throw fail("WORKER_RESULT_TOO_LARGE", "Artifact too large.", 502); }
      chunks.push(chunk);
    }
    const envelope = readResultZip(Buffer.concat(chunks));
    if (String(envelope.worker?.run_id) !== String(run.id) || String(envelope.worker?.attempt) !== String(run.run_attempt) ||
        envelope.worker?.commit !== task.commit || envelope.request_id !== task.request_id || envelope.aweme_id !== task.aweme_id) {
      throw fail("WORKER_RESULT_INVALID", "Result provenance mismatch.", 502);
    }
    if (run.conclusion !== "success" || envelope.pass !== true) return { status: "failed", ...evidence,
      error: envelope.error ?? { code: "WORKER_FAILED", message: "Worker run failed." } };
    verifyAcquisitionResult(envelope, task);
    return { status: "completed", ...evidence, artifact_id: artifact.id, elapsed_ms: envelope.elapsed_ms,
      pass: true, result: envelope.result };
  }
}
