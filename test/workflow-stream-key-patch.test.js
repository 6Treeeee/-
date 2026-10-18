import test, { after } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile, writeFile, mkdtemp, unlink, rmdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { patchWorkflowStreamSource } from "../scripts/patch-workflow-stream-key.mjs";

const require = createRequire(import.meta.url);
const sdkPath = path.join(path.dirname(require.resolve("@workflow/core")), "serialization.js");
const originalSource = await readFile(sdkPath, "utf8");
const patchedSource = patchWorkflowStreamSource(originalSource);
const directory = await mkdtemp(path.join(tmpdir(), "tree-workflow-stream-test-"));
const candidatePath = path.join(directory, "candidate.mjs");
const sdkUrl = pathToFileURL(sdkPath);
const moduleSource = patchedSource.replace(/^\/\/# sourceMappingURL=.*$/gm, "")
  .replace(/\bfrom (['"])([^'"]+)\1/g, (full, quote, specifier) => {
    const resolved = specifier.startsWith(".") ? new URL(specifier, sdkUrl).href
      : specifier.startsWith("node:") ? specifier
        : pathToFileURL(createRequire(sdkPath).resolve(specifier)).href;
    return `from ${quote}${resolved}${quote}`;
  });
await writeFile(candidatePath, moduleSource);
const candidate = await import(pathToFileURL(candidatePath).href);
const sdk = await import(sdkUrl.href);
const key = await webcrypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
const value = { marker: "synthetic-stream-test", version: 1 };
const input = (...values) => new ReadableStream({ start(c) { values.forEach(v => c.enqueue(v)); c.close(); } });
const [plainFrame] = await Array.fromAsync(input(value).pipeThrough(sdk.getSerializeStream({}, undefined)));
const [encryptedFrame] = await Array.fromAsync(input(value).pipeThrough(sdk.getSerializeStream({}, key)));
const read = (stream, resolver) => Array.fromAsync(stream.pipeThrough(candidate.getDeserializeStream({}, resolver)));

after(async () => {
  assert.equal(await readFile(sdkPath, "utf8"), originalSource, "tests must not patch the installed SDK");
  await unlink(candidatePath);
  await rmdir(directory);
});

test("compatibility patch is idempotent and rejects an unknown SDK source", () => {
  assert.equal(patchWorkflowStreamSource(patchedSource), patchedSource);
  assert.throws(() => patchWorkflowStreamSource(originalSource + "\n"), /SOURCE_MISMATCH/);
});

test("plaintext frame reads without consulting an unavailable deployment key", async () => {
  let reads = 0;
  assert.deepEqual(await read(input(plainFrame), () => { reads++; throw new Error("SYNTHETIC_MISSING_KEY"); }), [value]);
  assert.equal(reads, 0);
});

test("incomplete plaintext frame does not consult a key while buffering", async () => {
  let reads = 0;
  assert.deepEqual(await read(input(plainFrame.slice(0, 4), plainFrame.slice(4)), () => { reads++; throw new Error("SYNTHETIC_MISSING_KEY"); }), [value]);
  assert.equal(reads, 0);
});

test("encrypted frames resolve a valid key once and preserve the value", async () => {
  let reads = 0;
  assert.deepEqual(await read(input(encryptedFrame, encryptedFrame), () => { reads++; return key; }), [value, value]);
  assert.equal(reads, 1);
});

test("encrypted frames with a rejected key lookup fail without plaintext fallback", async () => {
  await assert.rejects(read(input(encryptedFrame), () => { throw new Error("SYNTHETIC_MISSING_KEY"); }), /SYNTHETIC_MISSING_KEY/);
});

test("encrypted frames without a key and with tampered ciphertext remain rejected", async () => {
  await assert.rejects(read(input(encryptedFrame), undefined), /no encryption key/);
  const tampered = encryptedFrame.slice();
  tampered[tampered.length - 1] ^= 1;
  await assert.rejects(read(input(tampered), key));
});

test("mixed plaintext and encrypted frames resolve a key only for encrypted data", async () => {
  let reads = 0;
  assert.deepEqual(await read(input(plainFrame, encryptedFrame, plainFrame), () => { reads++; return key; }), [value, value, value]);
  assert.equal(reads, 1);
});
