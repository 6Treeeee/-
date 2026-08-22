function textOf(video) {
  const transcript = video?.readable_content?.text ?? video?.transcript?.text ?? "";
  const chapterText = [
    video?.chapters?.abstract,
    ...(video?.chapters?.entries ?? []).flatMap((entry) => [entry.title, entry.detail])
  ].filter(Boolean).join("。 ");
  return [video?.title, video?.description, transcript, chapterText].filter(Boolean).join("。 ");
}

function evidenceFor(video, text = null) {
  return {
    aweme_id: video.aweme_id ?? video.id,
    url: video.canonical_url,
    created_at: video.created_at ?? null,
    ...(text ? { excerpt: text.slice(0, 240) } : {})
  };
}

function sentences(value) {
  return String(value ?? "")
    .split(/[。！？!?；;，,\n]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 8);
}

function postSummary(video) {
  return video?.chapters?.abstract ??
    sentences(video?.readable_content?.text)[0] ??
    video?.description ??
    video?.title ??
    "No readable summary was available.";
}

const TOPIC_RULES = [
  { id: "ai_agents", label: "AI 与智能体产品", terms: ["智能体", "AI", "ai", "人工智能"] },
  { id: "entrepreneurship", label: "创业与商业模式", terms: ["创业", "商业模式", "赚钱", "盈利", "营收"] },
  { id: "local_market", label: "县城与下沉市场", terms: ["县城", "本地", "同城", "下沉市场", "小地方"] },
  { id: "customer_acquisition", label: "获客、流量与销售", terms: ["获客", "客资", "流量", "销售", "成交", "客户"] },
  { id: "delivery", label: "产品验证与交付", terms: ["交付", "产品验证", "标准化", "内测", "自动化", "产品成熟"] },
  { id: "physical_business", label: "实体商家数字化", terms: ["实体", "商家", "老板", "全屋定制", "代运营"] },
  { id: "business_judgment", label: "商业认知与个人判断", terms: ["认知", "商业思维", "信息差", "个人观点", "长期"] }
];

const CLAIM_RULES = [
  {
    id: "ai_reduces_delivery_cost",
    claim: "AI/智能体的主要商业价值在于压缩重复劳动或交付成本，而不是技术本身。",
    terms: ["压缩", "交付成本", "重复劳动", "不懂技术", "AI只能"]
  },
  {
    id: "sales_and_demand_first",
    claim: "销售、获客和真实客户需求应优先于单纯学习或展示 AI 技术。",
    terms: ["销售", "获客", "客户需求", "听懂需求", "前端流量", "离钱最近"]
  },
  {
    id: "local_information_gap",
    claim: "县城或下沉市场仍存在 AI 信息差和本地信任机会。",
    terms: ["县城", "下沉市场", "信息差", "本地信任", "同城"]
  },
  {
    id: "validate_before_scaling",
    claim: "产品应先完成销售与交付验证，再扩大客户或合作规模。",
    terms: ["产品验证", "交付验证", "暂停合作", "产品成熟", "标准化产品", "交付债务"]
  },
  {
    id: "real_cases_drive_product",
    claim: "真实业务问题、案例和代运营反馈会推动产品迭代。",
    terms: ["真实问题", "问题样本", "本地案例", "案例跑通", "代运营"]
  },
  {
    id: "repeatable_growth_system",
    claim: "个人创业应构建可重复的获客、交付和第二收入系统。",
    terms: ["源源不断", "第二套", "持续交付", "自动化", "赚钱系统"]
  }
];

function matchingPosts(posts, terms) {
  return posts.filter((video) => {
    const text = textOf(video);
    return terms.some((term) => text.includes(term));
  });
}

function extractUnverifiable(posts) {
  const moneyOrScale = /(?:\d+(?:\.\d+)?\s*(?:万|亿|元|个|家|倍)|十万|百万|千万).{0,16}(?:营收|盈利|收入|月入|获客|客户|客资|赚钱)|(?:营收|盈利|收入|月入|获客|客户|客资|赚钱).{0,16}(?:\d+(?:\.\d+)?\s*(?:万|亿|元|个|家|倍)|十万|百万|千万)/u;
  const results = [];
  const seen = new Set();
  for (const video of posts) {
    for (const sentence of sentences(textOf(video))) {
      if (!moneyOrScale.test(sentence)) continue;
      const key = `${video.aweme_id}:${sentence}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({
        claim: sentence.slice(0, 300),
        status: "unverified_creator_claim",
        reason: "The public video supplies the assertion but no independent records were available to verify it.",
        evidence: [evidenceFor(video, sentence)]
      });
    }
  }
  return results.slice(0, 30);
}

function detectChanges(posts) {
  const ordered = [...posts].filter((item) => item.created_at)
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const results = [];

  const pause = ordered.find((video) => /暂停合作|停止合作/u.test(textOf(video)));
  const scale = ordered.find((video) =>
    (video.aweme_id ?? video.id) !== (pause?.aweme_id ?? pause?.id) &&
    /扩大|招商|分公司|重新开放合作|规模/u.test(textOf(video)));
  if (pause && scale) {
    results.push({
      type: "delivery_before_scale",
      description: "A delivery-quality pause is followed by a separate video discussing franchise or branch scaling. This suggests a quality gate before growth, not proof that cooperation had already reopened.",
      evidence: [evidenceFor(pause, postSummary(pause)), evidenceFor(scale, postSummary(scale))]
    });
  }

  const noTech = ordered.find((video) => /不懂技术|不懂智能体/u.test(textOf(video)));
  const product = ordered.find((video) => /开发的智能体|产品和技术|产品验证/u.test(textOf(video)));
  if (noTech && product) {
    results.push({
      type: "technical_depth_tension",
      description: "Some videos downplay the need for technical expertise, while others rely on building and validating an AI product. The distinction appears to be between the seller/operator role and the product-team role.",
      evidence: [evidenceFor(noTech, postSummary(noTech)), evidenceFor(product, postSummary(product))]
    });
  }

  return results;
}

export class CreatorAnalyzer {
  analyze({ creator, posts, failures = [], pagination = {}, source = null }) {
    const completed = posts.filter((video) => video?.readable_content?.status === "complete");
    const topics = TOPIC_RULES.map((rule) => {
      const matches = matchingPosts(completed, rule.terms);
      return {
        id: rule.id,
        topic: rule.label,
        video_count: matches.length,
        evidence: matches.slice(0, 8).map((video) => evidenceFor(video, postSummary(video)))
      };
    }).filter((item) => item.video_count > 0)
      .sort((a, b) => b.video_count - a.video_count);

    const recurringClaims = CLAIM_RULES.map((rule) => {
      const matches = matchingPosts(completed, rule.terms);
      return {
        id: rule.id,
        claim: rule.claim,
        supporting_video_count: matches.length,
        evidence: matches.slice(0, 8).map((video) => evidenceFor(video, postSummary(video)))
      };
    }).filter((item) => item.supporting_video_count >= 2)
      .sort((a, b) => b.supporting_video_count - a.supporting_video_count);

    const notableVideos = [...completed]
      .sort((a, b) => {
        const aScore = (a.chapters?.entries?.length ?? 0) + (a.readable_content?.segments?.length ?? 0) / 20;
        const bScore = (b.chapters?.entries?.length ?? 0) + (b.readable_content?.segments?.length ?? 0) / 20;
        return bScore - aScore;
      })
      .slice(0, Math.min(8, completed.length))
      .map((video) => ({
        ...evidenceFor(video),
        title: video.title,
        why_notable: postSummary(video)
      }));

    const timeline = [...completed]
      .sort((a, b) => Date.parse(a.created_at ?? 0) - Date.parse(b.created_at ?? 0))
      .map((video) => ({
        date: video.created_at,
        aweme_id: video.aweme_id,
        url: video.canonical_url,
        title: video.title,
        summary: postSummary(video)
      }));

    return {
      schema_version: "1.0",
      generated_at: new Date().toISOString(),
      basis: "public_video_transcripts_and_douyin_public_metadata",
      creator,
      public_post_count: pagination.unique_posts ?? posts.length,
      profile_display_post_count: pagination.expected_posts ?? creator?.stats?.post_count ?? null,
      analyzed_post_count: completed.length,
      inaccessible_or_failed_posts: failures,
      topics,
      recurring_claims: recurringClaims,
      notable_videos: notableVideos,
      timeline,
      contradictions_or_changes: detectChanges(completed),
      unverifiable_claims: extractUnverifiable(completed),
      per_video: posts.map((video) => ({
        aweme_id: video.aweme_id,
        url: video.canonical_url,
        created_at: video.created_at,
        title: video.title,
        summary: postSummary(video),
        readable_content: video.readable_content ?? { status: "failed" },
        chapters: video.chapters,
        source_evidence: {
          description: video.description,
          hashtags: video.hashtags,
          engagement: video.engagement
        }
      })),
      access: {
        scope: pagination.scope ?? "public_unauthenticated",
        public_feed_exhausted: pagination.upstream_exhausted ?? null,
        limitation: pagination.limitation ?? null,
        source
      }
    };
  }
}
