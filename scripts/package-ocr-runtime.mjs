import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile, rm, unlink } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

// Build-time packaging only. No runtime downloads and no transcript artifacts.
if (process.platform !== "linux" || process.arch !== "x64") {
  throw new Error("OCR packaging requires the Linux x64 Vercel build environment");
}
const root = path.resolve("assets/ocr");
const url = "https://github.com/astral-sh/python-build-standalone/releases/download/20260901/cpython-3.12.14%2B20260901-x86_64-unknown-linux-gnu-install_only_stripped.tar.gz";
const sha256 = "72748da13197c1fb161e3afeef20a6a385ff24f2165e6e2758e47008e7faba4c";
// Discard only this build's generated runtime, so cached dependencies cannot linger.
if (root !== path.join(process.cwd(), "assets", "ocr")) throw new Error("Invalid OCR build output path");
await rm(root, { recursive: true, force: true });
await mkdir(root, { recursive: true });
const archive = path.join(root, "python.tar.gz");
const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
if (!response.ok) throw new Error(`Python distribution download failed: ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
if (createHash("sha256").update(bytes).digest("hex") !== sha256) throw new Error("Python distribution integrity mismatch");
await writeFile(archive, bytes);
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 180_000, maxBuffer: 8 * 1024 * 1024, ...options });
  if (result.error || result.status !== 0) {
    throw new Error(`OCR package command failed: ${command}\n${result.stderr || result.error}`);
  }
  return result.stdout;
}
run("tar", ["-xzf", archive, "-C", root]);
await unlink(archive);
const python = path.join(root, "python/bin/python3.12");
const localRequirements = await readFile("config/ocr-requirements.txt", "utf8");
const productionRequirements = await readFile("config/ocr-production-requirements.txt", "utf8");
const rapidVersion = localRequirements.match(/^rapidocr-onnxruntime==([^\s]+)$/m)?.[1];
if (!rapidVersion || !productionRequirements.split(/\r?\n/).includes(`rapidocr-onnxruntime==${rapidVersion}`)) throw new Error("Production OCR must retain the accepted RapidOCR version");
console.log(run(python, ["-m", "pip", "install", "--disable-pip-version-check", "--no-cache-dir", "--no-compile", "--only-binary=:all:", "--no-deps", "-r", "config/ocr-production-requirements.txt"]));
const packages = JSON.parse(run(python, ["-m", "pip", "list", "--format=json", "--disable-pip-version-check"]));
const worker = run(python, ["-u", "src/services/hard-subtitle-worker.py"], { input: "", env: { ...process.env, OMP_NUM_THREADS: "2" } });
const engine = JSON.parse(worker.trim());
if (!engine.ready) throw new Error("Packaged OCR worker did not initialize");
const manifest = { python: { version: "3.12.14", url, sha256 }, requirements_sha256: createHash("sha256").update(localRequirements).digest("hex"), production_requirements_sha256: createHash("sha256").update(productionRequirements).digest("hex"), compatibility: "Same-version headless OpenCV wheel; GUI wheel requires absent libxcb.so.1", packages, engine };
await writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({ event: "ocr.package.ready", python: manifest.python.version, packages, engine }));
