import assert from "node:assert/strict";
import test from "node:test";

import { DouyinReader } from "../src/platforms/douyin.js";

test("a metadata-only public profile does not report zero attempted posts as processing complete", async () => {
  let processorCalls = 0;
  const provider = {
    id: "direct_public_web",
    available: true,
    async readProfile() {
      return {
        creator: {
          sec_user_id: "public-gated-user",
          display_name: "Public creator",
          stats: { post_count: 27 }
        },
        items: [],
        items_normalized: true,
        pagination: {
          complete: true,
          scope: "public_unauthenticated",
          public_access_exhausted: true,
          upstream_exhausted: false,
          stopped_by_access_boundary: true,
          stop_reason: "login_required_for_posts",
          displayed_post_count: 27,
          unique_items: 0
        },
        limitation: {
          code: "LOGIN_REQUIRED_FOR_MORE_POSTS",
          type: "partial_public_profile",
          message: "Login is required to view the profile's posts.",
          scope: "public_unauthenticated",
          public_items: 0,
          displayed_post_count: 27,
          inaccessible_count: 27
        },
        meta: { provider: "direct_public_web" }
      };
    }
  };
  const reader = new DouyinReader({
    providers: [provider],
    processContent: true,
    processor: {
      async processProfile(posts) {
        processorCalls += 1;
        return { posts: [], failures: [], status: "complete", complete: true };
      }
    }
  });

  const result = await reader.read({
    url: "https://www.douyin.com/user/public-gated-user",
    type: "profile"
  });

  assert.equal(processorCalls, 0);
  assert.equal(result.content.pagination.complete, true);
  assert.equal(result.content.pagination.scope, "public_unauthenticated");
  assert.equal(result.content.pagination.count_consistent, false);
  assert.equal(result.content.pagination.profile_count_gap, 27);
  assert.equal(result.content.processing.status, "not_attempted");
  assert.equal(result.content.processing.complete, false);
  assert.equal(result.content.processing.attempted_posts, 0);
  assert.equal(result.content.processing.successfully_content_read, 0);
  assert.deepEqual(result.content.processing.failed_posts, []);
});
