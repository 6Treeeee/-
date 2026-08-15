function get(object, path) {
  return path.split(".").reduce((value, key) => value?.[key], object);
}

function firstDefined(object, paths) {
  for (const path of paths) {
    const value = get(object, path);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function stringValue(value) {
  return value === undefined || value === null || value === "" ? null : String(value);
}

function numberValue(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function booleanValue(value) {
  if (value === true || value === 1 || value === "1" || value === "true") return true;
  if (value === false || value === 0 || value === "0" || value === "false") return false;
  return null;
}

function isoTime(value) {
  const number = numberValue(value);
  if (number === null) return null;
  const milliseconds = number > 10_000_000_000 ? number : number * 1000;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function compact(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== null && value !== undefined)
  );
}

function collectUrls(value, output = []) {
  if (!value) return output;
  if (typeof value === "string") {
    if (/^https?:\/\//i.test(value)) output.push(value);
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectUrls(item, output);
    return output;
  }
  if (typeof value === "object") {
    for (const key of ["url_list", "urls", "url", "uri", "download_url", "caption_url"]) {
      if (Object.prototype.hasOwnProperty.call(value, key)) collectUrls(value[key], output);
    }
  }
  return output;
}

function uniqueUrls(...values) {
  return [...new Set(values.flatMap((value) => collectUrls(value)))];
}

function findObject(root, predicate, maxDepth = 5) {
  const queue = [{ value: root, depth: 0 }];
  const seen = new Set();

  while (queue.length) {
    const { value, depth } = queue.shift();
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    if (predicate(value)) return value;
    if (depth >= maxDepth) continue;
    for (const child of Object.values(value)) {
      if (child && typeof child === "object") queue.push({ value: child, depth: depth + 1 });
    }
  }
  return null;
}

export function extractAweme(payload) {
  const known = [
    payload?.aweme_detail,
    payload?.aweme,
    payload?.item,
    payload?.data?.aweme_detail,
    payload?.data?.aweme,
    payload?.data?.item,
    payload?.aweme_list?.[0],
    payload?.item_list?.[0],
    payload?.data?.aweme_list?.[0],
    payload?.data?.item_list?.[0],
    payload
  ];
  const direct = known.find((value) => value && typeof value === "object" &&
    (value.aweme_id || value.group_id || value.video || value.images));
  return direct ?? findObject(payload, (value) => Boolean(value.aweme_id && (value.video || value.images)));
}

export function extractUser(payload) {
  const known = [
    payload?.user,
    payload?.user_info,
    payload?.data?.user,
    payload?.data?.user_info,
    payload
  ];
  const direct = known.find((value) => value && typeof value === "object" &&
    (value.sec_uid || value.sec_user_id || value.nickname));
  return direct ?? findObject(payload, (value) => Boolean(
    (value.sec_uid || value.sec_user_id) && (value.nickname || value.unique_id)
  ));
}

export function extractSecUserId(payload) {
  if (typeof payload === "string" && payload.startsWith("MS4")) return payload;
  const object = findObject(payload, (value) => Boolean(
    value.sec_user_id || value.sec_uid || value.secUserId
  ));
  return stringValue(object?.sec_user_id ?? object?.sec_uid ?? object?.secUserId);
}

export function extractPostPage(payload) {
  const container = findObject(payload, (value) =>
    Array.isArray(value.aweme_list) ||
    Array.isArray(value.item_list) ||
    Array.isArray(value.post_list) ||
    Array.isArray(value.items) ||
    Array.isArray(value.list)
  );

  if (!container) {
    return { recognized: false, items: [], hasMore: null, maxCursor: null };
  }

  const items = container.aweme_list ?? container.item_list ?? container.post_list ??
    container.items ?? container.list;
  return {
    recognized: true,
    items,
    hasMore: booleanValue(
      container.has_more ?? container.hasMore ?? payload?.has_more ?? payload?.data?.has_more
    ),
    maxCursor: stringValue(
      container.max_cursor ?? container.next_cursor ?? container.cursor ??
      payload?.max_cursor ?? payload?.data?.max_cursor
    )
  };
}

function normalizeCreatorFromObject(user = {}) {
  const secUserId = stringValue(user.sec_uid ?? user.sec_user_id ?? user.secUserId);
  return compact({
    id: stringValue(user.uid ?? user.user_id),
    sec_user_id: secUserId,
    unique_id: stringValue(user.unique_id ?? user.short_id),
    display_name: stringValue(user.nickname ?? user.name),
    signature: stringValue(user.signature ?? user.desc),
    profile_url: secUserId ? `https://www.douyin.com/user/${secUserId}` : null,
    avatar_urls: uniqueUrls(user.avatar_larger, user.avatar_medium, user.avatar_thumb, user.avatar_url),
    verified: booleanValue(user.verification_type > 0 || user.custom_verify || user.enterprise_verify_reason),
    verification: stringValue(user.custom_verify ?? user.enterprise_verify_reason),
    stats: compact({
      followers: numberValue(user.follower_count),
      following: numberValue(user.following_count),
      likes_received: numberValue(user.total_favorited ?? user.total_favourite),
      post_count: numberValue(user.aweme_count ?? user.video_count),
      favoriting_count: numberValue(user.favoriting_count)
    })
  });
}

export function normalizeCreator(user) {
  return normalizeCreatorFromObject(user ?? {});
}

function normalizeCaptions(aweme) {
  const candidates = [
    aweme?.video?.cla_info?.caption_infos,
    aweme?.video?.cla_info?.captions,
    aweme?.video?.caption_infos,
    aweme?.video?.subtitle_infos,
    aweme?.caption_infos,
    aweme?.subtitle_list
  ];
  const list = candidates.find(Array.isArray) ?? [];
  const tracks = list.map((track, index) => compact({
    id: stringValue(track.sub_id ?? track.id ?? index),
    language: stringValue(track.language ?? track.language_name),
    language_code: stringValue(track.language_code ?? track.lang),
    format: stringValue(track.format ?? track.caption_format),
    url: uniqueUrls(track.url, track.url_list, track.caption_url)[0] ?? null,
    source: "douyin"
  })).filter((track) => track.url || track.id);

  return { available: tracks.some((track) => Boolean(track.url)), tracks };
}

function normalizePlayback(video = {}) {
  const playback = [];
  const downloads = [];

  function add(target, label, address, extra = {}) {
    for (const url of uniqueUrls(address)) {
      target.push(compact({ url, source: label, ...extra }));
    }
  }

  add(playback, "play_addr", video.play_addr, { codec: "h264" });
  add(playback, "play_addr_h264", video.play_addr_h264, { codec: "h264" });
  add(playback, "play_addr_265", video.play_addr_265, { codec: "h265" });
  add(playback, "play_addr_bytevc1", video.play_addr_bytevc1, { codec: "bytevc1" });
  add(downloads, "download_addr", video.download_addr);
  add(downloads, "download_suffix_logo_addr", video.download_suffix_logo_addr);

  for (const rate of video.bit_rate ?? video.bit_rate_audio ?? []) {
    const extra = {
      quality: stringValue(rate.gear_name ?? rate.quality_type),
      bitrate: numberValue(rate.bit_rate),
      codec: stringValue(rate.codec_type ?? rate.codec),
      format: stringValue(rate.format),
      fps: numberValue(rate.FPS ?? rate.fps)
    };
    add(playback, "bit_rate", rate.play_addr ?? rate.play_addr_265 ?? rate, extra);
  }

  const dedupe = (items) => [...new Map(items.map((item) => [item.url, item])).values()];
  return { playback: dedupe(playback), downloads: dedupe(downloads) };
}

function normalizeImages(aweme) {
  const images = aweme.images ?? aweme.image_post_info?.images ?? [];
  return images.map((image, index) => compact({
    index,
    width: numberValue(image.width ?? image.display_image?.width),
    height: numberValue(image.height ?? image.display_image?.height),
    urls: uniqueUrls(image.url_list, image.display_image, image.download_url_list, image)
  }));
}

function normalizeHashtags(aweme) {
  const tags = [];
  for (const item of aweme.text_extra ?? []) {
    const name = stringValue(item.hashtag_name ?? item.tag_name);
    if (name) tags.push(name);
  }
  for (const item of aweme.cha_list ?? []) {
    const name = stringValue(item.cha_name ?? item.hashtag_name);
    if (name) tags.push(name);
  }
  return [...new Set(tags)];
}

export function postIdentity(aweme) {
  return stringValue(aweme?.aweme_id ?? aweme?.group_id ?? aweme?.item_id);
}

export function normalizeVideo(aweme, { inputUrl = null, resolvedUrl = null } = {}) {
  const id = postIdentity(aweme);
  const video = aweme?.video ?? {};
  const author = normalizeCreatorFromObject(aweme?.author ?? {});
  const captions = normalizeCaptions(aweme);
  const media = normalizePlayback(video);
  const images = normalizeImages(aweme);
  const contentKind = images.length > 0 ? "image_post" : video && Object.keys(video).length ? "video" : "unknown";
  const canonicalUrl = id ? `https://www.douyin.com/video/${id}` : resolvedUrl ?? inputUrl;
  const description = stringValue(aweme?.desc ?? aweme?.description ?? aweme?.preview_title);
  const title = stringValue(aweme?.item_title ?? aweme?.preview_title ?? description);
  const transcriptionInput = captions.available
    ? { strategy: "captions", caption_tracks: captions.tracks.filter((track) => track.url) }
    : media.playback[0]?.url
      ? { strategy: "media", media_url: media.playback[0].url, media_type: "video" }
      : { strategy: "unavailable" };

  return compact({
    id,
    aweme_id: id,
    canonical_url: canonicalUrl,
    content_kind: contentKind,
    title,
    description,
    created_at: isoTime(aweme?.create_time),
    author,
    hashtags: normalizeHashtags(aweme),
    media: {
      duration_ms: numberValue(video.duration ?? aweme?.duration),
      width: numberValue(video.width),
      height: numberValue(video.height),
      ratio: stringValue(video.ratio),
      cover_urls: uniqueUrls(video.cover, video.origin_cover, video.dynamic_cover),
      playback: media.playback,
      downloads: media.downloads,
      images
    },
    captions,
    transcription_input: transcriptionInput,
    music: aweme?.music ? compact({
      id: stringValue(aweme.music.id_str ?? aweme.music.id),
      title: stringValue(aweme.music.title),
      artist: stringValue(aweme.music.author),
      album: stringValue(aweme.music.album),
      duration_ms: numberValue(aweme.music.duration ? aweme.music.duration * 1000 : null),
      play_urls: uniqueUrls(aweme.music.play_url)
    }) : null,
    engagement: compact({
      plays: numberValue(aweme?.statistics?.play_count),
      likes: numberValue(aweme?.statistics?.digg_count),
      comments: numberValue(aweme?.statistics?.comment_count),
      shares: numberValue(aweme?.statistics?.share_count),
      collects: numberValue(aweme?.statistics?.collect_count)
    }),
    platform_fields: compact({
      aweme_type: numberValue(aweme?.aweme_type),
      region: stringValue(aweme?.region),
      is_top: booleanValue(aweme?.is_top)
    })
  });
}

export function restrictionReason(payload) {
  const filter = findObject(payload, (value) => Array.isArray(value.filter_list));
  const reason = numberValue(filter?.filter_list?.[0]?.reason);
  if (reason === null) return null;
  const meanings = {
    5: "private_content",
    8: "unavailable_or_restricted",
    10: "partially_visible"
  };
  return { reason, meaning: meanings[reason] ?? "upstream_filtered" };
}
