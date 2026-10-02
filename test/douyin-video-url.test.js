import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDouyinVideoUrl, resolveDouyinVideoId } from '../src/services/douyin-video-url.js';

const id = '7688672103729483058';

test('canonical video and numeric share URLs yield only the video ID without network access', async () => {
  const noFetch = () => { throw new Error('A direct video URL must not be fetched.'); };
  assert.deepEqual(parseDouyinVideoUrl(`https://www.douyin.com/video/${id}?utm_source=share#x`),
    { kind: 'video', aweme_id: id });
  assert.equal(await resolveDouyinVideoId(`https://douyin.com/video/${id}/`, { fetchImpl: noFetch }), id);
  assert.equal(await resolveDouyinVideoId(`https://www.iesdouyin.com/share/video/${id}/?foo=bar`,
    { fetchImpl: noFetch }), id);
});

test('a public short link follows only manual HTTPS Douyin redirects', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return new Response(null, { status: calls.length === 1 ? 302 : 301,
      headers: { location: calls.length === 1 ? '/second/' : `https://www.douyin.com/video/${id}?share_token=ignored` } });
  };
  assert.equal(await resolveDouyinVideoId('https://v.douyin.com/AbC123/?tracking=1', { fetchImpl }), id);
  assert.deepEqual(calls.map(call => call.url), ['https://v.douyin.com/AbC123/', 'https://v.douyin.com/second/']);
  assert(calls.every(call => call.options.redirect === 'manual' && call.options.method === 'GET'));
});

test('host lookalikes, HTTP, credentials, ports and non-video pages are rejected', async () => {
  for (const url of [
    `https://www.douyin.com.evil.example/video/${id}`,
    `http://www.douyin.com/video/${id}`,
    `https://name@www.douyin.com/video/${id}`,
    `https://www.douyin.com:8443/video/${id}`,
    'https://www.douyin.com/user/example',
    'https://v.douyin.com/a/b'
  ]) {
    await assert.rejects(resolveDouyinVideoId(url), { status: 400 });
  }
});

test('a short-link redirect to another host or HTTP is never fetched', async () => {
  for (const target of [`https://douyin.com.evil.example/video/${id}`, `http://www.douyin.com/video/${id}`]) {
    const calls = [];
    const fetchImpl = async url => {
      calls.push(url);
      return new Response(null, { status: 302, headers: { location: target } });
    };
    await assert.rejects(resolveDouyinVideoId('https://v.douyin.com/AbC123/', { fetchImpl }), { status: 400 });
    assert.deepEqual(calls, ['https://v.douyin.com/AbC123/']);
  }
});

test('non-redirect landing pages and redirect loops fail without inventing an ID', async () => {
  await assert.rejects(resolveDouyinVideoId('https://v.douyin.com/AbC123/',
    { fetchImpl: async () => new Response('<html>Verification required</html>') }),
  { code: 'DOUYIN_SHORT_LINK_UNRESOLVED' });
  await assert.rejects(resolveDouyinVideoId('https://v.douyin.com/AbC123/',
    { fetchImpl: async () => new Response(null, { status: 302, headers: { location: '/AbC123/' } }) }),
  { code: 'DOUYIN_SHORT_LINK_LOOP' });
});

