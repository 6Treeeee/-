import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { projectTaskState, readDurableTaskState } from "../src/a2a/task-state-mirror.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "artifacts/tree-brain/latest-task-state.json");
const [mode, input, ...extra] = process.argv.slice(2);

try {
  if (!["--task-id", "--snapshot"].includes(mode) || !input || extra.length) {
    throw new Error("Usage: node scripts/export-task-state.mjs --task-id <existing-run-id> | --snapshot <persisted-state.json>");
  }
  let task, source;
  if (mode === "--task-id") {
    const { getRun } = await import("workflow/api");
    ({ task, source } = await readDurableTaskState(input, getRun));
  } else {
    if (path.resolve(input) === output) throw new Error("TASK_MIRROR_CANNOT_READ_ITS_OUTPUT");
    const bytes = await readFile(input);
    const record = JSON.parse(bytes.toString("utf8"));
    task = record.state ?? record;
    source = {
      kind: "persisted-state-file",
      file: path.basename(input),
      sha256: createHash("sha256").update(bytes).digest("hex"),
      pointer: record.state ? "/state" : "",
      scope: record.scope ?? null,
      freshness: "snapshot-only; not a live read",
    };
  }
  const mirror = projectTaskState(task, { source });
  await mkdir(path.dirname(output), { recursive: true });
  const temporary = `${output}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(mirror, null, 2)}\n`, { flag: "wx", flush: true });
    await rename(temporary, output);
  } finally {
    await rm(temporary, { force: true });
  }
  console.log("Generated artifacts/tree-brain/latest-task-state.json (local only)");
} catch (error) {
  // Upstream error messages may include credentials or endpoints.
  console.error(/^(TASK_MIRROR_|Usage:)/.test(error.message) ? error.message : "TASK_MIRROR_EXPORT_FAILED");
  process.exitCode = 1;
}
