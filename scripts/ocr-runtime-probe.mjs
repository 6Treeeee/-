// Copy to api/ocr-runtime-probe.js only for a protected Preview feasibility probe.
// Not exposed by the production deployment; never a transcript acceptance fixture.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { statfs, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { PublicBrowserService } from "../src/services/public-browser.js";
import { DirectPublicWebProvider } from "../src/providers/direct-public-web.js";

const exec = promisify(execFile);
export const config = { maxDuration: 120 };
export default async function handler(req, res) {
  if (process.env.VERCEL_ENV !== "preview") return res.status(404).end();
  const start = Date.now();
  const result = { kind: "runtime_probe_not_video_acceptance", platform: process.platform,
    arch: process.arch, node: process.version, python: [], browser: null };
  for (const binary of ["assets/ocr/python/bin/python3.12"]) {
    try {
      const { stdout } = await exec(binary, ["-c", "import sys,json,importlib.util,platform;print(json.dumps({'version':sys.version.split()[0],'libc':platform.libc_ver(),'packages':{n:importlib.util.find_spec(n) is not None for n in ['numpy','cv2','onnxruntime','rapidocr_onnxruntime']}}))"], { timeout: 5000, maxBuffer: 8192 });
      result.python.push({ binary, ok: true, ...JSON.parse(stdout) });
    } catch (error) { result.python.push({ binary, ok: false, code: String(error.code) }); }
  }
  try {
    const { stdout } = await exec("assets/ocr/python/bin/python3.12", ["-c", "import cv2,numpy,onnxruntime;from rapidocr_onnxruntime import RapidOCR;import json;engine=RapidOCR(use_cls=False,intra_op_num_threads=2,inter_op_num_threads=1);print(json.dumps({'ready':True,'cv2':cv2.__version__,'numpy':numpy.__version__,'onnxruntime':onnxruntime.__version__}))"], { timeout: 25000, maxBuffer: 8192 });
    result.ocr = JSON.parse(stdout);
    result.manifest = JSON.parse(await readFile("assets/ocr/manifest.json", "utf8"));
  } catch(error) { result.ocr = { ready: false, code: String(error.code), detail: String(error.stderr || "").trim().split("\n").at(-1) }; }
  try {
    result.browser = await new PublicBrowserService().withPage(async ({ page, runtime }) => {
      await page.setContent('<html><body style="background:black;color:white;font-size:48px">Runtime screenshot probe</body></html>');
      const frame = await page.screenshot({ type: "jpeg", quality: 95 });
      return { ok: true, kind: runtime.kind, screenshot_bytes: frame.length,
        screenshot_sha256: createHash("sha256").update(frame).digest("hex"),
        h264: await page.evaluate(() => document.createElement("video").canPlayType('video/mp4; codecs="avc1.42E01E"')) };
    });
  } catch(error) { result.browser = { ok: false, code: error.code || error.name }; }
  const disk = await statfs("/tmp");
  result.tmp = { total_bytes: disk.bsize * disk.blocks, available_bytes: disk.bsize * disk.bavail };
  result.duration_ms = Date.now() - start;
  if (req.query?.player === "1") {
    const awemeId = "7421538381705907475";
    try {
      const provider = new DirectPublicWebProvider({ retries: 0, videoNavigationTimeoutMs: 20000, videoContentWaitMs: 15000 });
      const video = await provider.readVideo({ awemeId, consumeVideo: async ({ page, aweme, assertAccess }) => {
        const durationMs = Number(aweme.video?.duration || aweme.duration);
        await page.waitForFunction((duration) => [...document.querySelectorAll("video")].some(v => v.videoWidth > 0 && v.readyState >= 2 && Math.abs(v.duration * 1000 - duration) < Math.max(3000, duration * .02)), { timeout: 15000 }, durationMs);
        await assertAccess();
        const playback = await page.evaluate(duration => {
          const v = [...document.querySelectorAll("video")].find(v => v.videoWidth > 0 && Math.abs(v.duration * 1000 - duration) < Math.max(3000, duration * .02));
          v.muted = true; v.pause();
          return { duration_ms: Math.round(v.duration * 1000), width: v.videoWidth, height: v.videoHeight, ready_state: v.readyState, media_error: v.error?.code || null };
        }, durationMs);
        const frame = await page.screenshot({ type: "jpeg", quality: 95, clip: { x: 0, y: 0, width: 1280, height: 720 }, captureBeyondViewport: false });
        return { expected_duration_ms: durationMs, playback, frame_bytes: frame.length, frame_sha256: createHash("sha256").update(frame).digest("hex") };
      }});
      result.player = { ok: true, identity: video.meta.identity, ...video.consumed };
    } catch (error) { result.player = { ok: false, expected_aweme_id: awemeId, code: error.code || error.name }; }
    result.duration_ms = Date.now() - start;
  }
  res.setHeader("cache-control", "no-store");
  return res.status(200).json(result);
}
