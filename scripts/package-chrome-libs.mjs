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
  // Keep the runtime loader and glibc from the Lambda host; bundle the
  // browser-facing shared libraries from the build image.
  if (/^(?:libc\.so|libm\.so|libdl\.so|libpthread\.so|librt\.so|libresolv\.so)/.test(name)) continue;
  cpSync(source, join(out, name));
  copied.push(name);
}
\nconst requiredDynamicLibraries = [\n  "libnspr4.so",\n  "libplc4.so",\n  "libplds4.so",\n  "libnss3.so",\n  "libnssutil3.so",\n  "libsmime3.so",\n  "libsoftokn3.so",\n  "libfreebl3.so"\n];\nlet ldconfig = "";\ntry {\n  ldconfig = execFileSync("ldconfig", ["-p"], { encoding: "utf8" });\n} catch {\n  ldconfig = "";\n}\nfor (const name of requiredDynamicLibraries) {\n  if (copied.includes(name)) continue;\n  const rows = ldconfig.split(/\\r?\\n/);\n  const row = rows.find((line) => line.trim().startsWith(name + " "));\n  const source = row?.match(/=>\\s+(\\/[^\\s]+)/)?.[1];\n  if (!source || !existsSync(source)) continue;\n  cpSync(source, join(out, name));\n  copied.push(name);\n}\n\nconsole.log(JSON.stringify({ chrome, bundled_library_count: copied.length, libraries: copied.sort() }));
