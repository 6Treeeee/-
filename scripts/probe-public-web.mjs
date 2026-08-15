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
  const dom = await page.evaluate(() => ({
    title: document.title,
    text: document.body?.innerText?.slice(0, 5_000) ?? "",
    postLinks: [...document.querySelectorAll('[data-e2e="user-post-list"] a[href]')]
      .map((item) => item.getAttribute("href"))
  }));
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
