import { generateKeyPairSync } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const force = process.argv.includes("--force");
const privateDir = path.join(os.homedir(), ".codex", "a2a-control");
const publicConfig = path.join(projectRoot, "config", "a2a-public-keys.js");

const definitions = [
  {
    id: "decision-owner-v1",
    role: "decision",
    principal_id: "gpt-decision-owner",
    workspace_ids: ["content-reader"],
    filename: "decision-private.pem",
  },
  {
    id: "worker-owner-machine-v1",
    role: "worker",
    principal_id: "owner-machine-codex-1",
    workspace_ids: ["content-reader"],
    filename: "worker-private.pem",
  },
];

await mkdir(privateDir, { recursive: true });
await mkdir(path.dirname(publicConfig), { recursive: true });

const publicKeys = [];
for (const definition of definitions) {
  const privatePath = path.join(privateDir, definition.filename);
  let privatePem;
  if (!force) {
    privatePem = await readFile(privatePath, "utf8").catch(() => null);
  }
  let publicPem;
  if (privatePem) {
    const { createPrivateKey, createPublicKey } = await import("node:crypto");
    publicPem = createPublicKey(createPrivateKey(privatePem)).export({
      type: "spki",
      format: "pem",
    });
  } else {
    const pair = generateKeyPairSync("ed25519", {
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    privatePem = pair.privateKey;
    publicPem = pair.publicKey;
    await writeFile(privatePath, privatePem, { encoding: "utf8", mode: 0o600 });
  }
  publicKeys.push({
    id: definition.id,
    role: definition.role,
    principal_id: definition.principal_id,
    workspace_ids: definition.workspace_ids,
    public_key_pem: String(publicPem),
  });
}

const generated = [
  "// Public verification keys only. Private keys are stored outside this repository.",
  `export const a2aPublicKeys = Object.freeze(${JSON.stringify(publicKeys, null, 2)});`,
  "",
].join("\n");
await writeFile(publicConfig, generated, "utf8");

process.stdout.write(
  JSON.stringify({
    public_config: publicConfig,
    private_directory: privateDir,
    key_ids: definitions.map((item) => item.id),
  }) + "\n",
);
