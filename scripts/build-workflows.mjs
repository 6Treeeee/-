import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflowCli = path.join(projectRoot, "node_modules", "workflow", "bin", "run.js");
const generatedRoot = path.join(projectRoot, ".well-known", "workflow", "v1");

const build = spawnSync(
  process.execPath,
  [workflowCli, "build", "--target", "standalone"],
  {
    cwd: projectRoot,
    env: { ...process.env, WORKFLOW_SOURCEMAP: "false" },
    stdio: "inherit",
  },
);
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status || 1);

const manifest = JSON.parse(
  await readFile(path.join(generatedRoot, "manifest.json"), "utf8"),
);
const workflowIds = Object.values(manifest.workflows || {})
  .flatMap((file) => Object.values(file))
  .map((entry) => entry.workflowId);
for (const expected of [
  "workflow//./workflows/a2a-control//a2aControlWorkflow",
  "workflow//./workflows/a2a-control//a2aTaskIndexWorkflow",
]) {
  if (!workflowIds.includes(expected)) {
    throw new Error(`Generated Workflow manifest is missing ${expected}`);
  }
}

await mkdir(generatedRoot, { recursive: true });
await Promise.all([
  copyFile(path.join(generatedRoot, "flow.js"), path.join(generatedRoot, "flow.cjs")),
  copyFile(path.join(generatedRoot, "step.js"), path.join(generatedRoot, "step.cjs")),
]);
