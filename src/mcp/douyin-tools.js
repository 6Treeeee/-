import { GithubAcquisition } from "../services/acquisition-github.js";
import { resolveDouyinVideoId } from "../services/douyin-video-url.js";

const VIDEO_WORKSPACE = "content-reader";
const URL_MAX = 2_048;
const TICKET_MAX = 4_096;

function requireVideoAccess(principal) {
  if (!Array.isArray(principal?.workspace_ids) || !principal.workspace_ids.includes(VIDEO_WORKSPACE)) {
    throw Object.assign(new Error("CONTENT_READER_FORBIDDEN"), { code: "CONTENT_READER_FORBIDDEN", statusCode: 403 });
  }
}

function toolResult(value, isError = false) {
  return {
    ...(isError ? { isError: true } : {}),
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value,
  };
}

function publicError(error) {
  const code = String(error?.code ?? "CONTENT_READER_ERROR");
  return {
    status: "failed",
    error: {
      code: /^[A-Z][A-Z0-9_]{2,80}$/.test(code) ? code : "CONTENT_READER_ERROR",
      message: typeof error?.message === "string" ? error.message.slice(0, 300) : "Video reading failed.",
    },
  };
}

export function publicDouyinResult(poll) {
  if (poll?.status !== "completed" || poll.pass !== true) {
    throw Object.assign(new Error("A complete verified worker result is required."), { code: "WORKER_RESULT_INVALID" });
  }
  const content = poll.result?.content;
  const readable = content?.readable_content;
  const awemeId = String(poll.aweme_id ?? "");
  const durationMs = Number(content?.duration_ms ?? content?.media?.duration_ms ?? 0);
  if (!/^\d{15,22}$/.test(awemeId) || String(content?.aweme_id ?? content?.id ?? "") !== awemeId ||
      readable?.status !== "complete" || typeof readable.text !== "string" || !readable.text.trim() ||
      !Array.isArray(readable.segments) || readable.segments.length === 0 || durationMs <= 0 ||
      readable.source?.fresh_capture !== true || readable.source?.transcript_cache_read !== false ||
      readable.source?.coverage?.full_video_scanned !== true) {
    throw Object.assign(new Error("Worker result is incomplete or does not match the video."), { code: "WORKER_RESULT_INVALID" });
  }
  return {
    status: "completed",
    aweme_id: awemeId,
    canonical_url: `https://www.douyin.com/video/${awemeId}`,
    title: typeof content.title === "string" ? content.title : "",
    description: typeof content.description === "string" ? content.description : "",
    duration_ms: durationMs,
    readable_content: {
      status: "complete",
      method: readable.method,
      text: readable.text,
      segments: readable.segments.map(segment => ({
        start_ms: segment.start_ms,
        end_ms: segment.end_ms,
        text: segment.text,
        confidence: segment.confidence,
      })),
      confidence: readable.confidence,
      limitations: Array.isArray(readable.limitations) ? readable.limitations : [],
      fresh_capture: true,
      transcript_cache_read: false,
      coverage: {
        full_video_scanned: true,
        start_ms: readable.source.coverage.start_ms,
        end_ms: readable.source.coverage.end_ms,
      },
    },
    worker: {
      run_id: poll.run_id,
      run_url: poll.run_url,
      elapsed_ms: poll.elapsed_ms,
    },
  };
}

/** Register only a trigger and a read-only poller. The worker remains the sole acquisition path. */
export function registerDouyinTools(server, {
  principal,
  z,
  env = process.env,
  fetchImpl = globalThis.fetch,
  workerFactory = options => new GithubAcquisition(options),
  securityMeta = () => ({}),
} = {}) {
  if (!z?.string || !server?.registerTool) throw new TypeError("MCP server and Zod are required.");
  const worker = () => workerFactory({ env, fetchImpl });
  server.registerTool("start_douyin_read", {
    title: "Read a public Douyin video",
    description: "Use when the user sends a public Douyin video link and asks for its actual content. Starts a fresh video acquisition; returns a task ticket. If pending, call get_douyin_read_result with the ticket until completed, then summarize the returned full transcript. Do not infer content from the URL or title.",
    inputSchema: { url: z.string().trim().min(1).max(URL_MAX).describe("Public Douyin single-video or share URL") },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    _meta: securityMeta(["treebrain:check"]),
  }, async ({ url }) => {
    requireVideoAccess(principal);
    try {
      const awemeId = await resolveDouyinVideoId(url, { fetchImpl });
      const started = await worker().trigger(awemeId);
      return toolResult({
        status: started.status,
        aweme_id: awemeId,
        task: started.task,
        request_id: started.request_id,
        poll_after_ms: started.poll_after_ms,
        message: "The video is being read. Keep calling get_douyin_read_result with this task ticket until status is completed or failed.",
      });
    } catch (error) {
      return toolResult(publicError(error), true);
    }
  });

  server.registerTool("get_douyin_read_result", {
    title: "Get Douyin video reading result",
    description: "Poll the task ticket returned by start_douyin_read. If queued or running, continue polling after poll_after_ms without asking the user to relay anything. Summarize only after status is completed and the full video transcript is returned. A failed status means the video could not be read.",
    inputSchema: { task: z.string().trim().min(1).max(TICKET_MAX).describe("Signed task ticket returned by start_douyin_read") },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: securityMeta(["treebrain:read"]),
  }, async ({ task }) => {
    requireVideoAccess(principal);
    try {
      const result = await worker().poll(task);
      if (result.status === "completed") return toolResult(publicDouyinResult(result));
      if (result.status === "failed") return toolResult({ status: "failed", error: result.error, aweme_id: result.aweme_id, run_url: result.run_url }, true);
      return toolResult({ status: result.status, request_id: result.request_id, aweme_id: result.aweme_id,
        task, poll_after_ms: result.poll_after_ms ?? 10_000,
        message: "Reading is still in progress. Call this tool again after poll_after_ms; do not summarize yet." });
    } catch (error) {
      return toolResult(publicError(error), true);
    }
  });
}


