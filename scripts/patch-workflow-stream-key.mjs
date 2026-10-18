import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const ORIGINAL_SHA = "d185f557baceb96c2bdfbfa4514715ce075adeed6f187b053228cc944bf77c25";
const PATCHED_SHA = "520bdd14a9596c7b2ab5a8826a759daffa26253d399ad6ca9f252319dc97b58f";
const digest = (source) => createHash("sha256").update(source).digest("hex");

export function patchWorkflowStreamSource(source) {
  const hash = digest(source);
  if (hash === PATCHED_SHA) return source;
  if (hash !== ORIGINAL_SHA) throw new Error("WORKFLOW_STREAM_PATCH_SOURCE_MISMATCH");
  const start = source.indexOf("export function getDeserializeStream(");
  const end = source.indexOf("// Byte-stream wire framing", start);
  if (start < 0 || end <= start) throw new Error("WORKFLOW_STREAM_PATCH_SHAPE_MISMATCH");
  const eager = "        // Resolve the key input once on first use and cache the result\n"
    + "        if (!keyState.resolved) {\n"
    + "            keyState.key = await resolveEncryptionKey(cryptoKey);\n"
    + "            keyState.resolved = true;\n"
    + "        }\n";
  const encrypted = "            if (format === SerializationFormat.ENCRYPTED) {\n";
  const part = source.slice(start, end);
  if (part.split(eager).length !== 2 || part.split(encrypted).length !== 2) {
    throw new Error("WORKFLOW_STREAM_PATCH_SHAPE_MISMATCH");
  }
  // Read the format first. Encrypted frames retain the original key lookup,
  // AES-GCM decryption and authentication failures; plaintext needs no key.
  const patched = part.replace(eager, "").replace(encrypted, encrypted
    + "                if (!keyState.resolved) {\n"
    + "                    keyState.key = await resolveEncryptionKey(cryptoKey);\n"
    + "                    keyState.resolved = true;\n"
    + "                }\n");
  return source.slice(0, start) + patched + source.slice(end);
}

export async function applyWorkflowStreamKeyPatch() {
  const require = createRequire(import.meta.url);
  const dist = path.dirname(require.resolve("@workflow/core"));
  const pkg = JSON.parse(await readFile(path.join(dist, "..", "package.json"), "utf8"));
  if (pkg.version !== "4.8.4") throw new Error("WORKFLOW_STREAM_PATCH_VERSION_MISMATCH");
  const target = path.join(dist, "serialization.js");
  const source = await readFile(target, "utf8");
  const patched = patchWorkflowStreamSource(source);
  if (digest(patched) !== PATCHED_SHA) throw new Error("WORKFLOW_STREAM_PATCH_OUTPUT_MISMATCH");
  if (source !== patched) await writeFile(target, patched);
  console.log(`workflow 4.8.4 stream key compatibility patch: ${source === patched ? "already applied" : "applied"}`);
}
