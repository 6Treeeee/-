import { verifyAcquisitionResult } from "../src/services/acquisition-result.js";
import { readResultZip } from "../src/services/acquisition-github.js";

const repo = "6Treeeee/-", artifactId = 12575305245, runId = 40130743092;
const token = process.env.GITHUB_TOKEN;
if (!token) throw new Error("GITHUB_TOKEN_NOT_CONFIGURED");
const auth = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };
async function get(url) {
  const response = await fetch(url, {headers: auth, redirect: "manual"});
  if (!response.ok) throw new Error(`GITHUB_HTTP_${response.status}`);
  return response.json();
}
const run = await get(`https://api.github.com/repos/${repo}/actions/runs/${runId}`);
const redirect = await fetch(`https://api.github.com/repos/${repo}/actions/artifacts/${artifactId}/zip`, {
  headers: auth, redirect: "manual"
});
if (redirect.status !== 302) throw new Error(`ARTIFACT_REDIRECT_${redirect.status}`);
const url = new URL(redirect.headers.get("location"));
if (url.protocol !== "https:" || !(url.hostname.endsWith(".blob.core.windows.net") || url.hostname.endsWith(".githubusercontent.com"))) {
  throw new Error("INVALID_ARTIFACT_HOST");
}
const download = await fetch(url.href, {redirect: "error"});
if (!download.ok) throw new Error(`STORAGE_HTTP_${download.status}`);
const bytes = Buffer.from(await download.arrayBuffer());
const envelope = readResultZip(bytes);
const expected = {request_id: "7c0b063e-a70f-4637-b9d8-92328870101a", aweme_id:"7699751880649428250"};
const provenance = {
  run_id_match: String(envelope.worker?.run_id) === String(run.id),
  attempt_match: String(envelope.worker?.attempt) === String(run.run_attempt),
  commit_match: envelope.worker?.commit === run.head_sha,
  request_match: envelope.request_id === expected.request_id && envelope.aweme_id === expected.aweme_id
};
let check = "failed", checkCode = null, detail = null;
try {
  verifyAcquisitionResult(envelope, expected);
  check = "passed";
} catch (e) {
  checkCode = e.code || "UNEXPECTED";
  detail = e.details || null;
}
console.log("EXISTING_ARTIFACT_REPLAY", JSON.stringify({
  byte_length:bytes.length,run_status:run.status,run_conclusion:run.conclusion,
  provenance,check,checkCode,detail,
  transcript_length:envelope.result?.content?.readable_content?.text?.length,
  method:envelope.result?.content?.readable_content?.method
}));
if (check !== "passed" || Object.values(provenance).some(x=>!x)) process.exitCode = 2;
