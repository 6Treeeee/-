import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const inputPath = resolve(process.argv[2] ?? "artifacts/douyin/profile.raw.json");
const outputDir = resolve(process.argv[3] ?? "artifacts/douyin/media");
const profile = JSON.parse(await readFile(inputPath, "utf8"));
await mkdir(outputDir, { recursive: true });

function sourceFor(aweme) {
  const audio = aweme?.video?.bit_rate_audio?.[0]?.audio_meta;
  const url = audio?.url_list?.main_url ?? audio?.url_list?.backup_url ??
    aweme?.video?.play_addr?.url_list?.[0];
  if (!url) throw new Error(`No public media URL for ${aweme?.aweme_id}`);
  return {
    url,
    expectedBytes: Number(audio?.size ?? aweme?.video?.play_addr?.data_size ?? 0) || null,
    mediaType: audio ? "audio" : "video",
    extension: ".mp4"
  };
}

async function download(aweme) {
  const source = sourceFor(aweme);
  const response = await fetch(source.url, {
    headers: {
      Accept: "video/mp4,audio/mp4,*/*",
      Referer: "https://www.douyin.com/"
    },
    redirect: "follow"
  });
  if (!response.ok) throw new Error(`${aweme.aweme_id}: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength < 1_000) throw new Error(`${aweme.aweme_id}: media body too small`);
  if (source.expectedBytes && bytes.byteLength !== source.expectedBytes) {
    throw new Error(`${aweme.aweme_id}: expected ${source.expectedBytes}, received ${bytes.byteLength}`);
  }
  const path = join(outputDir, `${aweme.aweme_id}${source.extension}`);
  await writeFile(path, bytes);
  return {
    aweme_id: String(aweme.aweme_id),
    path,
    media_type: source.mediaType,
    content_type: response.headers.get("content-type"),
    bytes: bytes.byteLength
  };
}

const queue = [...profile.aweme_list];
const results = [];
const failures = [];
const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
  while (queue.length) {
    const aweme = queue.shift();
    try {
      const result = await download(aweme);
      results.push(result);
      console.log(JSON.stringify({ status: "downloaded", ...result }));
    } catch (error) {
      failures.push({ aweme_id: String(aweme?.aweme_id), error: error.message });
      console.error(JSON.stringify({ status: "failed", aweme_id: aweme?.aweme_id, error: error.message }));
    }
  }
});
await Promise.all(workers);

const manifest = {
  captured_at: profile.captured_at,
  downloaded_at: new Date().toISOString(),
  source_profile: profile.source_url,
  results: results.sort((a, b) => a.aweme_id.localeCompare(b.aweme_id)),
  failures
};
await writeFile(join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
if (failures.length) process.exitCode = 1;
