import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

import { ReaderError } from "../errors.js";

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function localExecutableCandidates(env = process.env, platform = process.platform) {
  const configured = [
    env.PUPPETEER_EXECUTABLE_PATH,
    env.CHROME_PATH,
    env.EDGE_PATH
  ];

  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA;
    const programFiles = env.ProgramFiles ?? "C:\\Program Files";
    const programFilesX86 = env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
    return unique([
      ...configured,
      join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
      join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
      join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
      localAppData && join(localAppData, "Microsoft", "Edge", "Application", "msedge.exe"),
      localAppData && join(localAppData, "Google", "Chrome", "Application", "chrome.exe")
    ]);
  }

  if (platform === "darwin") {
    return unique([
      ...configured,
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      join(homedir(), "Applications", "Google Chrome.app", "Contents", "MacOS", "Google Chrome")
    ]);
  }

  return unique([
    ...configured,
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/microsoft-edge-stable"
  ]);
}

function isVercelRuntime(env = process.env) {
  return Boolean(env.VERCEL || env.VERCEL_ENV);
}

async function loadSparticuzChromium(chromiumImpl) {
  if (chromiumImpl) return chromiumImpl;
  try {
    const module = await import("@sparticuz/chromium");
    return module.default ?? module;
  } catch (cause) {
    throw new ReaderError(
      "DOUYIN_PUBLIC_BROWSER_UNAVAILABLE",
      "The serverless public browser runtime is not installed.",
      {
        status: 503,
        details: { provider: "direct_public_web", runtime: "vercel" },
        cause
      }
    );
  }
}
/**
 * Resolve a real Chrome-family executable without downloading or impersonating a browser.
 * Vercel uses the purpose-built Sparticuz Chromium distribution; local development uses
 * an already-installed Chrome or Edge executable.
 */
export async function resolvePublicBrowserRuntime({
  executablePath,
  chromiumImpl,
  env = process.env,
  platform = process.platform
} = {}) {
  if (isVercelRuntime(env)) {
    const chromium = await loadSparticuzChromium(chromiumImpl);
    let resolvedExecutable;
    try {
      resolvedExecutable = executablePath ?? await chromium.executablePath();
    } catch (cause) {
      throw new ReaderError(
        "DOUYIN_PUBLIC_BROWSER_UNAVAILABLE",
        "The serverless public browser executable could not be prepared.",
        {
          status: 503,
          details: { provider: "direct_public_web", runtime: "vercel" },
          cause
        }
      );
    }

    return {
      executablePath: resolvedExecutable,
      args: [...(chromium.args ?? [])],
      headless: chromium.headless ?? true,
      kind: "sparticuz_chromium"
    };
  }

  const resolvedExecutable = executablePath ??
    localExecutableCandidates(env, platform).find((candidate) => existsSync(candidate));
  if (!resolvedExecutable) {
    throw new ReaderError(
      "DOUYIN_PUBLIC_BROWSER_UNAVAILABLE",
      "No installed Chrome or Edge executable is available for public Douyin retrieval.",
      {
        status: 503,
        details: { provider: "direct_public_web", runtime: "local" }
      }
    );
  }

  return {
    executablePath: resolvedExecutable,
    args: [
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-default-browser-check"
    ],
    headless: true,
    kind: platform === "win32" && /msedge/i.test(resolvedExecutable)
      ? "local_edge"
      : "local_chrome"
  };
}

function publicUserAgent(value) {
  return String(value ?? "").replace(/HeadlessChrome\//g, "Chrome/");
}

export class PublicBrowserService {
  constructor({
    puppeteerImpl = puppeteer,
    chromiumImpl,
    executablePath,
    env = process.env,
    platform = process.platform,
    launchOptions = {},
    navigationTimeoutMs = 35_000,
    protocolTimeoutMs = 45_000,
    viewport = { width: 1280, height: 900, deviceScaleFactor: 1 }
  } = {}) {
    this.puppeteer = puppeteerImpl;
    this.chromiumImpl = chromiumImpl;
    this.executablePath = executablePath;
    this.env = env;
    this.platform = platform;
    this.launchOptions = launchOptions;
    this.navigationTimeoutMs = navigationTimeoutMs;
    this.protocolTimeoutMs = protocolTimeoutMs;
    this.viewport = viewport;
  }

  async withPage(operation) {
    const runtime = await resolvePublicBrowserRuntime({
      executablePath: this.executablePath,
      chromiumImpl: this.chromiumImpl,
      env: this.env,
      platform: this.platform
    });

    let browser;
    let context;
    try {
      browser = await this.puppeteer.launch({
        executablePath: runtime.executablePath,
        args: runtime.args,
        headless: runtime.headless,
        protocolTimeout: this.protocolTimeoutMs,
        ...this.launchOptions
      });

      context = typeof browser.createBrowserContext === "function"
        ? await browser.createBrowserContext()
        : browser.defaultBrowserContext();
      const page = await context.newPage();
      page.setDefaultNavigationTimeout(this.navigationTimeoutMs);
      page.setDefaultTimeout(this.navigationTimeoutMs);
      await page.setViewport(this.viewport);

      const nativeUserAgent = typeof browser.userAgent === "function"
        ? await browser.userAgent()
        : "";
      const userAgent = publicUserAgent(nativeUserAgent);
      if (userAgent) await page.setUserAgent(userAgent);
      await page.setExtraHTTPHeaders({
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"
      });

      return await operation({
        page,
        runtime: {
          kind: runtime.kind,
          userAgentAdjusted: nativeUserAgent !== userAgent
        }
      });
    } catch (error) {
      if (error instanceof ReaderError) throw error;
      throw error;
    } finally {
      try {
        if (context && context !== browser?.defaultBrowserContext?.()) await context.close();
      } catch {
        // Closing a failed browser context is best-effort.
      }
      try {
        await browser?.close();
      } catch {
        // Browser teardown must not replace the retrieval result or error.
      }
    }
  }
}
