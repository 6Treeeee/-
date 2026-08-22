import assert from "node:assert/strict";
import test from "node:test";

import { TranscriptionService } from "../src/services/transcription.js";

function publicMp3Resolver() {
  return {
    async resolve() {
      return {
        url: "https://media.example.test/long.mp3",
        kind: "audio",
        mediaType: "audio/mpeg"
      };
    },
    async fetch() {
      return {
        bytes: new Uint8Array([8, 9]),
        mediaType: "audio/mpeg",
        source: { host: "media.example.test", url_hash: "safe" }
      };
    }
  };
}

test("bounded long videos use one local ASR pass before hosted Gateway", async () => {
  let gatewayCalls = 0;
  let localCalls = 0;
  let directOpenAiCalls = 0;
  const service = new TranscriptionService({
    openAiApiKey: "test-direct-key",
    aiGatewayApiKey: null,
    vercelOidcToken: "test-oidc-token",
    mediaResolver: publicMp3Resolver(),
    fetchImpl: async () => {
      directOpenAiCalls += 1;
      throw new Error("Direct OpenAI must not consume the long-video deadline first");
    },
    gatewayFactory() {
      gatewayCalls += 1;
      throw new Error("Gateway must not consume the long-video deadline first");
    },
    localAsr: async ({ video }) => {
      localCalls += 1;
      assert.equal(video.aweme_id, "7665909560732851961");
      return {
        text: "长视频本地转写成功",
        language: "zh",
        method: "local_whisper_cpp_base_q5_1",
        segments: [
          { start_ms: 0, end_ms: 120_000, text: "长视频" },
          { start_ms: 120_000, end_ms: 273_834, text: "本地转写成功" }
        ],
        engine: { name: "whisper.cpp", release: "b4938" },
        model: { name: "whisper-base-q5_1-multilingual" }
      };
    }
  });

  const result = await service.read({
    aweme_id: "7665909560732851961",
    duration: 273_834,
    music: { duration_ms: 60_000 },
    captions: { tracks: [] }
  });

  assert.equal(localCalls, 1);
  assert.equal(directOpenAiCalls, 0);
  assert.equal(gatewayCalls, 0);
  assert.equal(result.status, "complete");
  assert.equal(result.method, "local_whisper_cpp_base_q5_1");
  assert.deepEqual(result.segments.map(({ start_ms, end_ms }) => ({ start_ms, end_ms })), [
    { start_ms: 0, end_ms: 120_000 },
    { start_ms: 120_000, end_ms: 273_834 }
  ]);
});

test("short videos retain hosted Gateway priority before local fallback", async () => {
  let gatewayCalls = 0;
  let localCalls = 0;
  const service = new TranscriptionService({
    openAiApiKey: null,
    aiGatewayApiKey: null,
    vercelOidcToken: "test-oidc-token",
    mediaResolver: publicMp3Resolver(),
    gatewayFactory() {
      return {
        transcriptionModel() {
          return {
            async doGenerate() {
              gatewayCalls += 1;
              return {
                text: "托管转写成功",
                segments: [{ startSecond: 0, endSecond: 10, text: "托管转写成功" }],
                language: "zh"
              };
            }
          };
        }
      };
    },
    localAsr: async () => {
      localCalls += 1;
      return { text: "不应调用" };
    }
  });

  const result = await service.read({
    aweme_id: "short-video",
    media: { duration_ms: 54_720 },
    captions: { tracks: [] }
  });

  assert.equal(gatewayCalls, 1);
  assert.equal(localCalls, 0);
  assert.match(result.method, /^vercel_ai_gateway_/);
});
