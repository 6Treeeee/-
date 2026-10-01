import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { GithubAcquisition, readResultZip } from '../src/services/acquisition-github.js';
import { verifyAcquisitionResult } from '../src/services/acquisition-result.js';
import { createHandler } from '../api/acquisition.js';

const env = { VERCEL_ENV: 'preview', ACQUISITION_GITHUB_TOKEN: 'fake-github-token', CONTENT_READER_WORKER_API_KEY: 'k'.repeat(32) };
const sha = 'a'.repeat(40), id = '7688672103729483058';
function envelope(task) {
  return { request_id: task.request_id, aweme_id: id, pass: true,
    worker: { run_id: '42', attempt: '1', commit: sha },
    result: { content: { aweme_id: id, duration_ms: 440000, readable_content: {
      status: 'complete', method: 'hard_subtitle_ocr', text: 'Fresh complete test content', segments: [{ text: 'Fresh complete test content' }],
      source: { fresh_capture: true, transcript_cache_read: false, coverage: { full_video_scanned: true, end_ms: 440000 } }
    } } } };
}
function zip(value, method = 8) {
  const raw = Buffer.from(JSON.stringify(value)), compressed = method === 8 ? deflateRawSync(raw) : raw;
  const name = Buffer.from('result.json');
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(method, 8);
  local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(name.length, 26);
  const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(method, 10);
  directory.writeUInt32LE(compressed.length, 20); directory.writeUInt32LE(raw.length, 24); directory.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(directory.length + name.length, 12); end.writeUInt32LE(local.length + name.length + compressed.length, 16);
  return Buffer.concat([local, name, compressed, directory, name, end]);
}
test('Preview trigger and poll bind the exact dispatch, artifact and full fresh result', async () => {
  let task, phase = 'queued'; const calls = [];
  const worker = new GithubAcquisition({ env, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/branches/')) return Response.json({ commit: { sha } });
    if (url.endsWith('/dispatches')) {
      task = JSON.parse(options.body).inputs;
      assert.equal(task.aweme_id, id); assert.equal(task.mode, 'acquisition');
      return new Response(null, { status: 204 });
    }
    if (url.includes('/runs?')) return Response.json({ workflow_runs: phase === 'queued' ? [] : [
      { id: 1, display_title: 'unrelated', head_sha: sha, status: 'completed' },
      { id: 42, display_title: `acquisition:${task.request_id}`, head_sha: sha, status: phase, conclusion: 'success', run_attempt: 1 }
    ] });
    if (url.endsWith('/artifacts?per_page=100')) return Response.json({ artifacts: [{ id: 9, name: `acquisition-${task.request_id}`, size_in_bytes: 1000, expired: false }] });
    if (url.endsWith('/zip')) return new Response(null, { status: 302, headers: { location: 'https://results.blob.core.windows.net/test' } });
    assert.equal(options.headers, undefined, 'credential must not reach artifact host');
    return new Response(zip(envelope(task)));
  } });
  const accepted = await worker.trigger(id);
  assert.equal((await worker.poll(accepted.task)).status, 'queued');
  phase = 'in_progress'; assert.equal((await worker.poll(accepted.task)).status, 'running');
  phase = 'completed'; const result = await worker.poll(accepted.task);
  assert.equal(result.status, 'completed'); assert.equal(result.run_id, 42);
  assert.equal(result.result.content.readable_content.text, 'Fresh complete test content');
  assert.equal(calls.filter(c => c.url.endsWith('/dispatches')).length, 1);
  await assert.rejects(worker.poll(accepted.task + 'x'), { code: 'INVALID_TASK' });
});
test('cached, partial and mismatched transcripts are rejected', () => {
  const task = { request_id: 'test', aweme_id: id };
  for (const mutate of [
    e => e.result.content.readable_content.source.transcript_cache_read = true,
    e => e.result.content.readable_content.source.fresh_capture = false,
    e => e.result.content.readable_content.source.coverage.end_ms = 1000,
    e => e.result.content.aweme_id = '1234567890123456',
    e => e.request_id = 'another-task'
  ]) { const e = envelope(task); mutate(e); assert.throws(() => verifyAcquisitionResult(e, task), { code: 'WORKER_RESULT_INVALID' }); }
});
test('ZIP reader supports stored and deflated results and rejects invalid/oversized data', () => {
  for (const method of [0, 8]) assert.deepEqual(readResultZip(zip({ pass: false }, method)), { pass: false });
  assert.throws(() => readResultZip(Buffer.alloc(10)), { code: 'WORKER_ARTIFACT_INVALID' });
  assert.throws(() => readResultZip(Buffer.alloc(4 * 1024 * 1024 + 1)), { code: 'WORKER_RESULT_TOO_LARGE' });
});
test('anonymous requests and production never dispatch GitHub work', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error('must not reach GitHub'); };
  const res = { setHeader() {}, status(s) { this.code = s; return this; }, json(b) { this.body = b; return this; } };
  await createHandler({ env, fetchImpl })({ method: 'POST', body: { aweme_id: id }, headers: {} }, res);
  assert.equal(res.code, 401);
  await createHandler({ env: { ...env, VERCEL_ENV: 'production' }, fetchImpl })(
    { method: 'POST', body: { aweme_id: id }, headers: { authorization: `Bearer ${env.CONTENT_READER_WORKER_API_KEY}` } }, res);
  assert.equal(res.code, 403); assert.equal(calls, 0);
});
test('missing credential and GitHub permission rejection never produce accepted/PASS', async () => {
  await assert.rejects(new GithubAcquisition({ env: { VERCEL_ENV: 'preview' } }).trigger(id), { code: 'WORKER_NOT_CONFIGURED' });
  const worker = new GithubAcquisition({ env, fetchImpl: async url => url.includes('/branches/')
    ? Response.json({ commit: { sha } }) : new Response(null, { status: 403 }) });
  await assert.rejects(worker.trigger(id), { code: 'GITHUB_WORKER_HTTP_ERROR' });
});
test('expired tasks and changed commits cannot consume unrelated results', async () => {
  let now = 100000;
  const worker = new GithubAcquisition({ env, now: () => now, fetchImpl: async () => Response.json({ workflow_runs: [] }) });
  const ticket = worker.ticket({ request_id: 'a'.repeat(36), aweme_id: id, commit: sha, created: now, exp: now + 1000 });
  now += 1001; await assert.rejects(worker.poll(ticket), { code: 'INVALID_TASK' });
});
