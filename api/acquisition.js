import { GithubAcquisition, secureEqual, workerConfiguration } from "../src/services/acquisition-github.js";
export const config = { maxDuration: 60 };
export function createHandler({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  return async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.method === "GET" && !req.query?.task) {
      return res.status(200).json({ ok: true, ...workerConfiguration(env) });
    }
    if (!["GET", "POST"].includes(req.method)) return res.status(405).json({ error: { code: "METHOD_NOT_ALLOWED" } });
    const key = env.CONTENT_READER_WORKER_API_KEY;
    if (!key || key.length < 32 || !secureEqual(req.headers?.authorization, `Bearer ${key}`)) {
      return res.status(401).json({ ok: false, error: { code: "WORKER_UNAUTHORIZED" } });
    }
    try {
      const worker = new GithubAcquisition({ env, fetchImpl });
      const result = req.method === "POST" ? await worker.trigger(req.body?.aweme_id) : await worker.poll(req.query.task);
      return res.status(result.status === "queued" || result.status === "running" ? 202 : 200).json({ ok: result.status !== "failed", ...result });
    } catch (error) {
      return res.status(error.status ?? 502).json({ ok: false, error: {
        code: error.code ?? "WORKER_UPSTREAM_ERROR", message: error.code ? error.message : "Worker upstream request failed." } });
    }
  };
}
export default createHandler();
