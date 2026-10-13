import test from 'node:test';
import assert from 'node:assert/strict';
import { createProxyHandler } from '../src/proxy.js';

const key = 'k'.repeat(64);
const oidc = 'test.payload.signature';
const target = 'https://git-codex-a2a-control-loop-1790063688-9925s-projects.vercel.app/api/acquisition';
function response() {
  return { headers: {}, setHeader(k,v) { this.headers[k]=v; }, status(v) { this.code=v; return this; }, json(v) { this.body=v; return this; } };
}
const env = { VERCEL_ENV: 'production', CONTENT_READER_WORKER_API_KEY: key };
test('poll reaches the current Preview branch alias with existing authentication and no redirects', async () => {
  let count = 0;
  const handler = createProxyHandler({ env, tokenResolver: async()=>oidc, fetchImpl: async(url,options)=>{
    count++;
    assert.equal(url, target+'?task=diagnostic.invalid');
    assert.equal(options.method,'GET');
    assert.equal(options.redirect,'manual');
    assert.equal(options.headers.authorization, 'Bearer '+key);
    assert.equal(options.headers['x-vercel-trusted-oidc-idp-token'],oidc);
    return Response.json({ok:false,error:{code:'INVALID_TASK'}},{status:400});
  }});
  const res=response();
  await handler({method:'GET',url:'/api/acquisition?task=diagnostic.invalid',headers:{authorization:'Bearer '+key}},res);
  assert.equal(count,1); assert.equal(res.code,400); assert.equal(res.body.error.code,'INVALID_TASK');
});
test('start forwards only a video id to the fixed branch alias', async()=>{
  const handler=createProxyHandler({env,tokenResolver:async()=>oidc,fetchImpl:async(url,options)=>{
    assert.equal(url,target); assert.deepEqual(JSON.parse(options.body),{aweme_id:'7690725127385894198'});
    return Response.json({status:'queued'},{status:202});
  }});
  const res=response();
  await handler({method:'POST',url:'/api/acquisition',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:{aweme_id:'7690725127385894198'}},res);
  assert.equal(res.code,202);
});
test('unauthorized requests never reach the upstream',async()=>{
  const handler=createProxyHandler({env,tokenResolver:async()=>oidc,fetchImpl:()=>{throw Error('must not fetch');}});
  const res=response(); await handler({method:'GET',url:'/api/acquisition?task=diagnostic.invalid',headers:{}},res);
  assert.equal(res.code,401); assert.equal(res.body.error.code,'WORKER_UNAUTHORIZED');
});
