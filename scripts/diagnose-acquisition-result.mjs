import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { readResultZip } from "../src/services/acquisition-github.js";
import { diagnoseAcquisitionArtifact } from "../src/services/acquisition-result.js";

// Offline only. Accept an already downloaded JSON/ZIP; never acquire video,
// contact a service, rewrite timestamps or change the acceptance contract.
try {
  const args = process.argv.slice(2), options = {};
  const allowed = new Set(["--input", "--output", "--request-id", "--aweme-id", "--sha256"]);
  for (let index = 0; index < args.length; index += 2) {
    if (!allowed.has(args[index]) || !args[index + 1] || options[args[index]]) throw Error("INVALID_ARGUMENT");
    options[args[index]] = args[index + 1];
  }
  if (!options["--input"] || !options["--output"] ||
      !/^[a-f0-9-]{36}$/.test(options["--request-id"] ?? "") ||
      !/^\d{15,22}$/.test(options["--aweme-id"] ?? "") ||
      resolve(options["--input"]) === resolve(options["--output"])) throw Error("INVALID_ARGUMENT");
  const input = await readFile(options["--input"]);
  if (input.length > 4 * 1024 * 1024) throw Error("WORKER_RESULT_TOO_LARGE");
  const digest = createHash("sha256").update(input).digest("hex");
  if (options["--sha256"] && digest !== options["--sha256"]) throw Error("ARTIFACT_DIGEST_MISMATCH");
  const envelope = input.subarray(0, 2).toString() === "PK"
    ? readResultZip(input) : JSON.parse(input.toString("utf8"));
  const diagnostic = diagnoseAcquisitionArtifact(envelope, {
    request_id: options["--request-id"], aweme_id: options["--aweme-id"],
  });
  const report = { schema_version: 1, scope: "offline_content_contract_diagnosis",
    input_sha256: digest, ...diagnostic };
  await mkdir(dirname(options["--output"]), { recursive: true });
  await writeFile(options["--output"], JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ status: report.status, candidate_available: report.candidate_available,
    failed_checks: report.validation?.failed_checks ?? report.failed_checks }));
} catch {
  // Do not print parse errors containing input snippets, paths or arbitrary text.
  console.error(JSON.stringify({ error: "OFFLINE_DIAGNOSTIC_FAILED" }));
  process.exitCode = 1;
}
