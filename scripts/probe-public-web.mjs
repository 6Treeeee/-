import puppeteer from "puppeteer-core";

const executablePath = process.env.CHROME_PATH ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const target = process.argv[2] || "https://www.douyin.com/video/7670118101211453413";
const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
  defaultViewport: { width: 1365, height: 900 }
});

try {
  const page = await browser.newPage();
  const truthfulUa = (await browser.userAgent()).replaceAll("HeadlessChrome", "Chrome");
  await page.setUserAgent(truthfulUa);
  const captures = [];
  page.on("response", async (response) => {
    const url = response.url();
    if (!/\/aweme\/v1\/web\/(?:aweme\/(?:detail|post)|user\/profile\/other)\//.test(url)) return;
    try {
      const data = await response.json();
      captures.push({ url: new URL(url).pathname, status: response.status(), data });
    } catch {
      captures.push({ url: new URL(url).pathname, status: response.status(), data: null });
    }
  });
  await page.goto(target, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await new Promise((resolve) => setTimeout(resolve, 8_000));
  const dom = await page.evaluate(() => {
    const video = document.querySelector("video");
    const inlineStateScripts = [...document.querySelectorAll("script:not([src])")]
      .map((element) => element.textContent ?? "")
      .filter((text) => /(?:aweme_id|__INITIAL_STATE__)/.test(text));
    return {
      title: document.title,
      text: document.body?.innerText?.slice(0, 5_000) ?? "",
      postLinks: [...document.querySelectorAll('[data-e2e="user-post-list"] a[href]')]
        .map((item) => item.getAttribute("href")),
      video: video ? {
        currentSrc: video.currentSrc || null,
        duration: Number.isFinite(video.duration) ? video.duration : null,
        readyState: video.readyState,
        networkState: video.networkState
      } : null,
      inlineStateScriptCount: inlineStateScripts.length,
      inlineStateContainsTarget: inlineStateScripts.some((text) => text.includes(
        location.pathname.match(/\/(?:video|note)\/(\d+)/)?.[1] ?? ""
      ))
    };
  });
  const summarizeObject = (root) => {
    const matches = [];
    const seen = new Set();
    const visit = (value, path, depth) => {
      if (!value || typeof value !== "object" || depth > 8 || seen.has(value)) return;
      seen.add(value);
      for (const [key, child] of Object.entries(value)) {
        const next = path ? `${path}.${key}` : key;
        if (/(?:chapter|caption|subtitle|abstract|bit_rate_audio|cla_info)/i.test(key)) {
          matches.push({ path: next, value: child });
        }
        visit(child, next, depth + 1);
      }
    };
    visit(root, "", 0);
    return matches;
  };
  console.log(JSON.stringify({
    target,
    userAgent: truthfulUa,
    dom,
    captures: captures.map((entry) => ({
      path: entry.url,
      status: entry.status,
      topKeys: Object.keys(entry.data ?? {}),
      awemeCount: entry.data?.aweme_list?.length,
      awemeIds: entry.data?.aweme_list?.map((item) => item.aweme_id),
      profile: entry.data?.user ? {
        nickname: entry.data.user.nickname,
        aweme_count: entry.data.user.aweme_count,
        sec_uid: entry.data.user.sec_uid
      } : null,
      matches: summarizeObject(entry.data).slice(0, 100)
    }))
  }, null, 2));
} finally {
  await browser.close();
}


if (target.startsWith("https://www.douyin.com/video/")) {
  const { DirectPublicWebProvider } = await import("../src/providers/direct-public-web.js");
  const { PublicBrowserService } = await import("../src/services/public-browser.js");
  const id = target.match(/\/(?:video|note)\/(\d+)/)?.[1] ?? null;
  if (id) {
    const provider = new DirectPublicWebProvider({
      browserService: new PublicBrowserService({ executablePath }),
      retries: 2,
      videoContentWaitMs: 22_000,
      settleMs: 700
    });
    const result = await provider.readVideo({
      inputUrl: `https://www.douyin.com/video/${id}`,
      resolvedUrl: `https://www.douyin.com/video/${id}`,
      awemeId: id
    });
    console.log(JSON.stringify({
      content_reader_probe: true,
      aweme_id: result.aweme?.aweme_id ?? null,
      duration: result.aweme?.video?.duration ?? null,
      provider: result.meta?.provider ?? null,
      method: result.meta?.method ?? null,
      browser: result.meta?.browser ?? null,
      attempts: result.meta?.attempts ?? null,
      network_media_count: result.meta?.network_media_count ?? null
    }, null, 2));
  }
}
