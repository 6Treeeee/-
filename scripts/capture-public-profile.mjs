import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import puppeteer from "puppeteer-core";

const profileUrl = process.argv[2];
const outputPath = resolve(process.argv[3] ?? "artifacts/douyin/profile.raw.json");
if (!profileUrl) {
  throw new Error("Usage: node scripts/capture-public-profile.mjs PUBLIC_PROFILE_URL [OUTPUT_JSON]");
}

const candidates = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
].filter(Boolean);
const executablePath = candidates[0];
const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
  defaultViewport: { width: 1365, height: 900 }
});

try {
  const page = await browser.newPage();
  const userAgent = (await browser.userAgent()).replaceAll("HeadlessChrome", "Chrome");
  await page.setUserAgent(userAgent);

  const profileResponses = [];
  const postResponses = [];
  page.on("response", async (response) => {
    const pathname = (() => {
      try { return new URL(response.url()).pathname; } catch { return ""; }
    })();
    if (!pathname.includes("/aweme/v1/web/user/profile/other/") &&
        !pathname.includes("/aweme/v1/web/aweme/post/")) return;
    try {
      const body = await response.json();
      if (pathname.includes("/user/profile/other/")) profileResponses.push(body);
      else postResponses.push(body);
    } catch {
      // Empty public bootstrap calls are followed by the actual JSON call.
    }
  });

  await page.goto(profileUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await new Promise((resolveWait) => setTimeout(resolveWait, 8_000));
  const dom = await page.evaluate(() => {
    const bodyText = document.body?.innerText ?? "";
    const links = [...document.querySelectorAll('[data-e2e="user-post-list"] a[href]')]
      .map((node) => node.getAttribute("href"))
      .filter((href) => /^\/(?:video|note)\/\d+$/.test(href ?? ""));
    const visibleText = (needle) => [...document.querySelectorAll("body *")].some((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0 &&
        element.children.length === 0 && element.textContent?.includes(needle);
    });
    return {
      title: document.title,
      post_links: [...new Set(links)],
      explicit_login_more_gate: visibleText("登录后查看更多作品") || bodyText.includes("登录后查看更多作品"),
      visible_security_challenge: Boolean(document.querySelector("#captcha_container")) ||
        visibleText("安全验证") || visibleText("验证后继续")
    };
  });

  if (dom.visible_security_challenge) {
    throw new Error("A visible security challenge was presented; capture stopped without interaction.");
  }

  const profile = [...profileResponses].reverse().find((body) => body?.user?.sec_uid);
  const postPage = [...postResponses].reverse().find((body) => Array.isArray(body?.aweme_list));
  if (!profile?.user || !postPage) throw new Error("The public profile JSON did not become available.");

  const visibleIds = new Set(dom.post_links.map((href) => href.split("/").pop()));
  const publicItems = postPage.aweme_list.filter((item) => visibleIds.has(String(item.aweme_id)));
  const output = {
    captured_at: new Date().toISOString(),
    source_url: profileUrl,
    browser: { engine: "chromium", mode: "ordinary_logged_out", user_agent: userAgent },
    access: {
      scope: "public_unauthenticated",
      explicit_login_more_gate: dom.explicit_login_more_gate,
      public_visible_post_count: visibleIds.size,
      profile_display_post_count: Number(profile.user.aweme_count ?? 0),
      public_gap: Math.max(0, Number(profile.user.aweme_count ?? 0) - visibleIds.size)
    },
    user: profile.user,
    aweme_list: publicItems,
    pagination: {
      has_more: Boolean(postPage.has_more),
      max_cursor: postPage.max_cursor == null ? null : String(postPage.max_cursor),
      returned_item_count: postPage.aweme_list.length,
      accepted_visible_item_count: publicItems.length,
      post_links: dom.post_links
    }
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    output: outputPath,
    creator: output.user.nickname,
    display_count: output.access.profile_display_post_count,
    public_count: output.access.public_visible_post_count,
    gap: output.access.public_gap,
    explicit_gate: output.access.explicit_login_more_gate
  }));
} finally {
  await browser.close();
}
