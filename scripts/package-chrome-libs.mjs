import { cpSync, existsSync, mkdirSync, readdirSync, statSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";

function findChrome(root) {
  const queue = [root];
  while (queue.length) {
    const current = queue.shift();
    for (const name of readdirSync(current)) {
      const candidate = join(current, name);
      const stats = statSync(candidate);
      if (stats.isDirectory()) queue.push(candidate);
      else if (name === "chrome" && /chrome-linux64[\\/]chrome$/.test(candidate)) return candidate;
    }
  }
  return null;
}

const root = join(process.cwd(), "assets", "chrome");
const chrome = existsSync(root) ? findChrome(root) : null;
if (!chrome) throw new Error("Bundled Chrome executable not found");

const out = join(process.cwd(), "assets", "chrome-libs");
mkdirSync(out, { recursive: true });

const runtimeLibDir = join(tmpdir(), "al2023", "lib");

async function ensureSparticuzRuntimeExtracted() {
  try {
    const imported = await import("@sparticuz/chromium");
    const inflate = imported.inflate;
    const archive = join(
      process.cwd(),
      "node_modules",
      "@sparticuz",
      "chromium",
      "bin",
      "al2023.tar.br"
    );
    if (typeof inflate === "function" && existsSync(archive)) {
      await inflate(archive);
      return true;
    }
    const chromium = imported.default ?? imported;
    const previousVercel = process.env.VERCEL;
    process.env.VERCEL = "1";
    try {
      await chromium.executablePath();
    } finally {
      if (previousVercel === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = previousVercel;
    }
    return existsSync(runtimeLibDir);
  } catch {
    return false;
  }
}

const sparticuzRuntimeExtracted = await ensureSparticuzRuntimeExtracted();
const lddEnv = {
  ...process.env,
  LD_LIBRARY_PATH: [runtimeLibDir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":")
};
const ldd = execFileSync("ldd", [chrome], { encoding: "utf8", env: lddEnv });
const copied = [];
for (const line of ldd.split(/\r?\n/)) {
  const match = line.match(/=>\s+(\/[^\s]+)\s+\(0x[0-9a-f]+\)/i);
  if (!match) continue;
  const source = match[1];
  if (!existsSync(source)) continue;
  const name = basename(source);
  if (/^(?:libc\.so|libm\.so|libdl\.so|libpthread\.so|librt\.so|libresolv\.so)/.test(name)) continue;
  cpSync(source, join(out, name));
  copied.push(name);
}

const requiredDynamicLibraries = [
  "libnspr4.so",
  "libplc4.so",
  "libplds4.so",
  "libnss3.so",
  "libnssutil3.so",
  "libsmime3.so",
  "libsoftokn3.so",
  "libfreebl3.so"
];

let ldconfig = "";
try {
  ldconfig = execFileSync("ldconfig", ["-p"], { encoding: "utf8" });
} catch {
  ldconfig = "";
}

const searchRoots = ["/usr/lib", "/lib", join(tmpdir(), "al2023", "lib")];

async function locateLibrary(name) {
  const row = ldconfig.split(/\r?\n/).find((line) => line.trim().startsWith(name + " "));
  const ldconfigSource = row?.match(/=>\s+(\/[^\s]+)/)?.[1] ?? null;
  if (ldconfigSource && existsSync(ldconfigSource)) return ldconfigSource;

  for (const root of searchRoots) {
    if (!existsSync(root)) continue;
    try {
      const found = execFileSync("find", [root, "-name", name, "-print", "-quit"], {
        encoding: "utf8"
      }).trim();
      if (found && existsSync(found)) return found;
    } catch {
      // Continue through the remaining roots.
    }
  }
  return null;
}

let extractedSparticuz = false;
for (const name of requiredDynamicLibraries) {
  if (copied.includes(name)) continue;
  let source = await locateLibrary(name);
  if (!source && !extractedSparticuz) {
    await ensureSparticuzRuntimeExtracted();
    extractedSparticuz = true;
    source = await locateLibrary(name);
  }
  if (!source || !existsSync(source)) continue;
  const resolved = realpathSync(source);
  cpSync(resolved, join(out, name));
  copied.push(name);
}

const missing = requiredDynamicLibraries.filter((name) => !existsSync(join(out, name)));

const verifyEnv = {
  ...process.env,
  LD_LIBRARY_PATH: [out, runtimeLibDir, process.env.LD_LIBRARY_PATH]
    .filter(Boolean)
    .join(":")
};
const verifiedLdd = execFileSync("ldd", [chrome], { encoding: "utf8", env: verifyEnv });
const unresolved = verifiedLdd.split(/\r?\n/).filter((line) => /=>\s+not found/.test(line));

console.log(JSON.stringify({
  chrome,
  bundled_library_count: copied.length,
  libraries: copied.sort(),
  sparticuz_runtime_extracted: sparticuzRuntimeExtracted,
  runtime_library_dir: runtimeLibDir,
  missing_required_libraries: missing,
  unresolved_libraries: unresolved
}));
