import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { verifyAcquisitionResult } from '../src/services/acquisition-result.js';
const endpoint = process.env.ACQUISITION_PREVIEW_URL;
const key = process.env.CONTENT_READER_WORKER_API_KEY;
const aweme_id = process.env.ACQUISITION_AWEME_ID ?? '7688672103729483058';
if (!endpoint || !key) throw new Error('Preview URL and worker API key must be provided securely in the environment.');
const url = new URL('/api/acquisition', endpoint);
if (url.protocol !== 'https:' || !url.hostname.endsWith('.vercel.app')) throw new Error('Expected a Vercel Preview hostname.');
await mkdir('evidence', { recursive: true });
const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const started = Date.now();
const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ aweme_id }), signal: AbortSignal.timeout(60000) });
const trigger = await response.json();
const { task, ...safeTrigger } = trigger;
await writeFile('evidence/preview-trigger.json', JSON.stringify({ tested_at: new Date().toISOString(), endpoint: url.href, http_status: response.status, body: safeTrigger }, null, 2));
if (response.status !== 202 || !task) throw new Error(`Trigger failed: ${response.status} ${trigger.error?.code ?? ''}`);
const polls = [];
for (let i = 0; i < 150; i++) {
  await delay(10000);
  const pollUrl = new URL(url); pollUrl.searchParams.set('task', task);
  const reply = await fetch(pollUrl, { headers, signal: AbortSignal.timeout(60000) });
  const body = await reply.json();
  polls.push({ at: new Date().toISOString(), http_status: reply.status, status: body.status,
    request_id: body.request_id, run_id: body.run_id, run_status: body.run_status, conclusion: body.conclusion, error: body.error });
  await writeFile('evidence/preview-polls.json', JSON.stringify(polls, null, 2));
  if (!reply.ok || body.status === 'failed') throw new Error(`Poll failed: ${reply.status} ${body.error?.code ?? ''}`);
  if (body.status !== 'completed') continue;
  verifyAcquisitionResult({ ...body, aweme_id, request_id: trigger.request_id }, { aweme_id, request_id: trigger.request_id });
  const readable = body.result.content.readable_content;
  if (aweme_id === '7688672103729483058' && (readable.segments.length < 180 || readable.text.length < 2500)) throw new Error('Baseline content quantity regressed.');
  const fullResult = JSON.stringify(body, null, 2);
  await writeFile('evidence/preview-result.json', fullResult);
  const acceptance = { pass: true, tested_at: new Date().toISOString(), endpoint: url.href, request_id: trigger.request_id,
    aweme_id, run_id: body.run_id, run_url: body.run_url, commit: body.commit, artifact_id: body.artifact_id,
    duration_ms: body.result.content.duration_ms ?? body.result.content.media?.duration_ms, segment_count: readable.segments.length, text_length: readable.text.length,
    fresh_capture: readable.source.fresh_capture, transcript_cache_read: readable.source.transcript_cache_read,
    full_video_scanned: readable.source.coverage.full_video_scanned, elapsed_ms: Date.now() - started,
    result_sha256: createHash('sha256').update(fullResult).digest('hex'),
    transcript_sha256: createHash('sha256').update(readable.text).digest('hex') };
  await writeFile('evidence/preview-acceptance.json', JSON.stringify(acceptance, null, 2));
  console.log(JSON.stringify(acceptance, null, 2));
  process.exit(0);
}
throw new Error('Worker acceptance timed out; inspect the recorded run without retriggering.');

