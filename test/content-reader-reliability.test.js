import test from "node:test";
import assert from "node:assert/strict";
import { recoverChangedOcrPlayer } from "../src/services/hard-subtitle-ocr.js";
import { MediaResolver } from "../src/services/media.js";

test("rotated public player source is rebound only after access revalidation", async () => {
  let calls = 0, access = 0, rebinds = 0;
  const state = { count: 0 };
  const result = await recoverChangedOcrPlayer({
    capture: async () => {
      calls++;
      if (calls === 1) throw new Error("OCR_PLAYER_CHANGED");
      return { time_ms: 30_000 };
    },
    assertAccess: async () => { access++; },
    rebind: async () => { rebinds++; return true; },
    samePage: true, state
  });
  assert.deepEqual(result, { time_ms: 30_000 });
  assert.deepEqual([calls, access, rebinds, state.count], [2, 1, 1, 1]);
});

test("unbound media player never automatically rebinds on changed source", async () => {
  const state = { count: 0 };
  await assert.rejects(recoverChangedOcrPlayer({
    capture: async () => { throw new Error("OCR_PLAYER_CHANGED"); },
    assertAccess: async () => { throw new Error("should not be called"); },
    rebind: async () => true, samePage: false, state
  }), /OCR_PLAYER_CHANGED/);
  assert.equal(state.count, 0);
});

test("fresh media pages can rebind only through an explicitly identity-checked path", async () => {
  let calls = 0, access = 0, rebinds = 0;
  const state = { count: 0 };
  const result = await recoverChangedOcrPlayer({
    capture: async () => {
      calls++;
      if (calls === 1) throw new Error("OCR_PLAYER_CHANGED");
      return { time_ms: 60_000 };
    },
    assertAccess: async () => { access++; },
    rebind: async () => { rebinds++; return true; },
    samePage: false, allowRebind: true, state
  });
  assert.deepEqual(result, { time_ms: 60_000 });
  assert.deepEqual([calls, access, rebinds, state.count], [2, 1, 1, 1]);
});

test("bounded recovery handles seek timeout only after public identity revalidation", async () => {
  let calls = 0;
  const state = { count: 0 };
  const result = await recoverChangedOcrPlayer({
    capture: async () => {
      calls++;
      if (calls === 1) throw new Error("OCR_SEEK_TIMEOUT");
      return { time_ms: 90_000 };
    },
    assertAccess: async () => {},
    rebind: async () => true,
    samePage: true, state
  });
  assert.deepEqual(result, { time_ms: 90_000 });
  assert.equal(state.count, 1);
});

test("rebind cannot bypass identity revalidation or exhaust retries", async () => {
  const capture = async () => { throw new Error("OCR_PLAYER_CHANGED"); };
  const state = { count: 0 };
  await assert.rejects(recoverChangedOcrPlayer({
    capture, assertAccess: async () => { throw new Error("DOUYIN_PUBLIC_WEB_IDENTITY_MISMATCH"); },
    rebind: async () => true, samePage: true, state
  }), /DOUYIN_PUBLIC_WEB_IDENTITY_MISMATCH/);
  assert.equal(state.count, 0);

  await assert.rejects(recoverChangedOcrPlayer({
    capture, assertAccess: async () => {}, rebind: async () => false,
    samePage: true, state
  }), /OCR_PLAYER_REBIND_INVALID/);
  assert.equal(state.count, 0);

  await assert.rejects(recoverChangedOcrPlayer({
    capture, assertAccess: async () => { throw Error("not called"); },
    rebind: async () => true, samePage: true, state: { count: 3 }, limit: 3
  }), /OCR_PLAYER_CHANGED/);
});

test("unrelated seek errors are never treated as player rotation", async () => {
  await assert.rejects(recoverChangedOcrPlayer({
    capture: async () => { throw new Error("OCR_FRAME_HASH_MISMATCH"); },
    assertAccess: async () => { throw Error("unexpected"); },
    rebind: async () => true, samePage: true, state: { count: 0 }
  }), /OCR_FRAME_HASH_MISMATCH/);
});

async function validateWith(response, maxBytes = 1_048_576) {
  const resolver = new MediaResolver({ fetchImpl: async () => response, maxBytes, retries: 0 });
  return resolver._validate({ url: "https://video.example.net/media.mp4" });
}

test("HTTP 206 with oversized total is diagnosed without downloading its body", async () => {
  const result = await validateWith(new Response(new Uint8Array([0]), {
    status: 206, headers: {
      "content-type": "video/mp4",
      "content-range": "bytes 0-0/262144000"
    }
  }));
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.status, 206);
  assert.equal(result.diagnostic.failure_reason, "oversized");
  assert.equal(result.diagnostic.size, 262144000);
  assert.ok(!JSON.stringify(result.diagnostic).includes("/media.mp4"));
});

test("streamable media accepts large assets only when HTTP byte ranges are verified", async () => {
  const video = {
    aweme_id: "7693868342775532850",
    acquired_at: new Date().toISOString(),
    media: { playback: [{ url: "https://video.example.net/large.mp4", media_type: "video/mp4" }] }
  };
  const resolver = new MediaResolver({
    maxBytes: 1_048_576,
    maxStreamBytes: 512 * 1024 * 1024,
    retries: 0,
    fetchImpl: async (_url, options) => {
      assert.equal(options.headers.Range, "bytes=0-0");
      return new Response(new Uint8Array([0]), {
        status: 206,
        headers: {
          "content-type": "video/mp4",
          "content-range": "bytes 0-0/262144000"
        }
      });
    }
  });
  const source = await resolver.resolveStreamable(video);
  assert.equal(source.size, 262144000);
  assert.equal(source.diagnostics.status, 206);
  assert.equal(source.url, "https://video.example.net/large.mp4");
});

test("streamable media rejects servers that ignore byte-range requests", async () => {
  const video = {
    aweme_id: "7693868342775532850",
    acquired_at: new Date().toISOString(),
    media: { playback: [{ url: "https://video.example.net/no-range.mp4", media_type: "video/mp4" }] }
  };
  const resolver = new MediaResolver({
    maxBytes: 1_048_576,
    maxStreamBytes: 512 * 1024 * 1024,
    retries: 0,
    fetchImpl: async () => new Response(new Uint8Array([0]), {
      status: 200,
      headers: { "content-type": "video/mp4", "content-length": "262144000" }
    })
  });
  await assert.rejects(resolver.resolveStreamable(video), (error) => {
    assert.equal(error.code, "MEDIA_STREAM_UNAVAILABLE");
    assert.equal(error.details.attempts[0].failure_reason, "range_unsupported");
    return true;
  });
});

test("non-media and rejected HTTP sources report distinct bounded diagnoses", async () => {
  const nonMedia = await validateWith(new Response("login", {
    status: 206, headers: { "content-type": "text/html", "content-range": "bytes 0-0/5" }
  }));
  assert.equal(nonMedia.diagnostic.failure_reason, "non_media");

  const denied = await validateWith(new Response("", { status: 403 }));
  assert.equal(denied.diagnostic.failure_reason, "http_status");
  assert.equal(denied.diagnostic.status, 403);
});

test("streamable media skips insecure HTTP candidates and selects a verified HTTPS source", async () => {
  const video = {
    aweme_id: "7693868342775532850",
    acquired_at: new Date().toISOString(),
    media: { playback: [
      { url: "http://video.example.net/insecure.mp4", media_type: "video/mp4" },
      { url: "https://video.example.net/secure.mp4", media_type: "video/mp4" }
    ] }
  };
  const requested = [];
  const resolver = new MediaResolver({
    maxBytes: 1_048_576,
    maxStreamBytes: 512 * 1024 * 1024,
    retries: 0,
    fetchImpl: async (url, options) => {
      requested.push(url);
      assert.equal(options.headers.Range, "bytes=0-0");
      return new Response(new Uint8Array([0]), {
        status: 206,
        headers: { "content-type": "video/mp4", "content-range": "bytes 0-0/262144000" }
      });
    }
  });
  const resolved = await resolver.resolveStreamable(video);
  assert.equal(resolved.url, "https://video.example.net/secure.mp4");
  assert.deepEqual(requested, ["https://video.example.net/secure.mp4"]);
});

test("streamable media candidate search is bounded and reports skipped candidates safely", async () => {
  const video = {
    aweme_id: "7693868342775532850",
    acquired_at: new Date().toISOString(),
    media: {
      playback: Array.from({ length: 70 }, (_, index) => ({
        url: "https://video.example.net/candidate-" + index + ".mp4",
        media_type: "video/mp4"
      }))
    }
  };
  let fetchCount = 0;
  const resolver = new MediaResolver({
    maxBytes: 1_048_576,
    maxStreamBytes: 512 * 1024 * 1024,
    timeoutMs: 4_000,
    retries: 0,
    fetchImpl: async () => {
      fetchCount++;
      return new Response(new Uint8Array([0]), {
        status: 200,
        headers: { "content-type": "video/mp4", "content-length": "262144000" }
      });
    }
  });
  await assert.rejects(resolver.resolveStreamable(video), (error) => {
    assert.equal(error.code, "MEDIA_STREAM_UNAVAILABLE");
    assert.equal(error.details.candidate_search_truncated, true, JSON.stringify({
      fetchCount, skipped: error.details.candidates_skipped, attempts: error.details.attempts.length,
      lastAttempt: error.details.attempts.at(-1)
    }));
    assert.ok(error.details.candidates_skipped > 0);
    assert.ok(error.details.attempts.some((item) => item?.candidate_search_truncated === true));
    assert.doesNotMatch(JSON.stringify(error.details), /https:\/\/video\.example\.net\/candidate-\d+\.mp4/);
    return true;
  });
});
