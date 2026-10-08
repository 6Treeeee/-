import assert from "node:assert/strict";
import test from "node:test";

import {
  parsePublicProfileProbeUrl,
  publicProfileProbeReceipt
} from "../src/services/public-profile-probe.js";

const SEC_USER_ID = "MS4wLjABAAAAGaSl5rjFKPevBaPQ3w4pXPvwhmUICqn6kC43GjxGick";

function profile(items = [{ aweme_id: "7688672103729483058", video: {}, author: { sec_uid: SEC_USER_ID } }]) {
  return {
    creator: { sec_uid: SEC_USER_ID },
    items,
    meta: {
      method: "public_unauthenticated_browser",
      acquired_at: "2026-10-07T00:00:00.000Z",
      browser: { kind: "local_chrome" }
    },
    pagination: {
      scope: "public_unauthenticated",
      complete: true,
      public_access_exhausted: true,
      stopped_by_access_boundary: true,
      upstream_exhausted: false,
      stop_reason: "login_required_for_more",
      pages_captured: 1,
      displayed_post_count: 3,
      profile_count_gap: 2
    },
    limitation: { code: "LOGIN_REQUIRED_FOR_MORE_POSTS" }
  };
}

test("probe accepts only canonical public Douyin profile URLs", () => {
  const target = parsePublicProfileProbeUrl(`https://www.douyin.com/user/${SEC_USER_ID}`);
  assert.equal(target.secUserId, SEC_USER_ID);
  for (const value of [
    `http://www.douyin.com/user/${SEC_USER_ID}`,
    `https://www.douyin.com.evil.example/user/${SEC_USER_ID}`,
    `https://name:secret@www.douyin.com/user/${SEC_USER_ID}`,
    `https://www.douyin.com:444/user/${SEC_USER_ID}`,
    `https://www.douyin.com/user/${SEC_USER_ID}?modal_id=7688672103729483058`,
    "https://www.douyin.com/user/not valid"
  ]) {
    assert.throws(() => parsePublicProfileProbeUrl(value));
  }
});

test("probe receipt records the visible public boundary without claiming the entire profile", () => {
  const receipt = publicProfileProbeReceipt(profile(), SEC_USER_ID);
  assert.equal(receipt.pass, true);
  assert.deepEqual(receipt.posts, [{
    aweme_id: "7688672103729483058",
    kind: "video",
    url: "https://www.douyin.com/video/7688672103729483058"
  }]);
  assert.equal(receipt.public_boundary.profile_count_gap, 2);
  assert.equal(receipt.public_boundary.limitation_code, "LOGIN_REQUIRED_FOR_MORE_POSTS");
  assert.equal(receipt.browser_kind, "local_chrome");
});

test("probe receipt rejects mismatched creator or post identities and incomplete pagination", () => {
  assert.throws(() => publicProfileProbeReceipt(profile(), "MS4wLjABAAAA_another_creator"));
  assert.throws(() => publicProfileProbeReceipt(profile([
    { aweme_id: "7688672103729483058", author: { sec_uid: "MS4wLjABAAAA_another_creator" } }
  ]), SEC_USER_ID));
  const incomplete = profile();
  incomplete.pagination.complete = false;
  assert.throws(() => publicProfileProbeReceipt(incomplete, SEC_USER_ID));
});

test("probe receipt reports a zero-visible-post access boundary as unproven", () => {
  const receipt = publicProfileProbeReceipt(profile([]), SEC_USER_ID);
  assert.equal(receipt.pass, false);
  assert.equal(receipt.public_post_count, 0);
  assert.equal(receipt.public_boundary.stopped_by_access_boundary, true);
});

test("probe does not claim video listing success when public posts are notes only", () => {
  const receipt = publicProfileProbeReceipt(profile([{
    aweme_id: "7688672103729483058",
    public_post_kind: "note",
    author: { sec_uid: SEC_USER_ID }
  }]), SEC_USER_ID);
  assert.equal(receipt.pass, false);
  assert.equal(receipt.public_post_count, 1);
  assert.equal(receipt.public_video_count, 0);
});

test("probe receipt preserves the verified DOM path for a post without API metadata", () => {
  const receipt = publicProfileProbeReceipt(profile([{
    aweme_id: "7688672103729483058",
    public_post_kind: "video",
    author: { sec_uid: SEC_USER_ID }
  }]), SEC_USER_ID);
  assert.equal(receipt.posts[0].kind, "video");
  assert.equal(receipt.posts[0].url, "https://www.douyin.com/video/7688672103729483058");
});

test("an empty images list does not turn a video into a note", () => {
  const receipt = publicProfileProbeReceipt(profile([{
    aweme_id: "7688672103729483058",
    images: [],
    video: {},
    author: { sec_uid: SEC_USER_ID }
  }]), SEC_USER_ID);
  assert.equal(receipt.posts[0].kind, "video");
});
