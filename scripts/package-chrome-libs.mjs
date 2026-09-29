import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { basename, join } from "node:path";

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

const ldd = execFileSync("ldd", [chrome], { encoding: "utf8" });
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

for (const name of requiredDynamicLibraries) {
  if (copied.includes(name)) continue;
  const row = ldconfig.split(/\r?\n/).find((line) => line.trim().startsWith(name + " "));
  let source = row?.match(/=>\s+(\/[^\s]+)/)?.[1] ?? null;
  if (!source || !existsSync(source)) {
    try {
      source = execFileSync("find", ["/usr/lib", "/lib", "-type", "f", "-name", name, "-print", "-quit"], {
        encoding: "utf8"
      }).trim() || null;
    } catch {
      source = null;
    }
  }
  if (!source || !existsSync(source)) continue;
  cpSync(source, join(out, name));
  copied.push(name);
}

console.log(JSON.stringify({
  chrome,
  bundled_library_count: copied.length,
  libraries: copied.sort()
}));
