import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const repoRoot = path.resolve(import.meta.dirname, "..");
const extensionPath = path.join(repoRoot, "extension");
const outputDirectory = path.join(repoRoot, "artifacts");
const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

async function snapshot(page, label) {
  return page.evaluate((snapshotLabel) => {
    const videos = [...document.querySelectorAll("video")].map((video, index) => {
      const rect = video.getBoundingClientRect();
      return {
        index,
        paused: video.paused,
        muted: video.muted,
        duration: Number.isFinite(video.duration) ? video.duration : String(video.duration),
        currentTime: video.currentTime,
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        source: (video.currentSrc || video.src || "").slice(0, 120),
        parent: video.parentElement?.outerHTML.slice(0, 300) || "",
      };
    });
    const dataE2e = [...new Set(
      [...document.querySelectorAll("[data-e2e]")]
        .map((element) => element.getAttribute("data-e2e"))
        .filter(Boolean),
    )].slice(0, 120);
    const visibleButtons = [...document.querySelectorAll("button, [role=button], a")]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 4 && rect.height > 4;
      })
      .map((element) => ({
        text: (element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60),
        label: element.getAttribute("aria-label") || "",
        title: element.getAttribute("title") || "",
        href: element.getAttribute("href") || "",
      }))
      .filter((item) => /推荐|精选|下一条|下一个|next|关闭/.test(`${item.text} ${item.label} ${item.title} ${item.href}`))
      .slice(0, 80);
    return {
      label: snapshotLabel,
      url: location.href,
      title: document.title,
      videos,
      dataE2e,
      visibleButtons,
      scrollY: window.scrollY,
    };
  }, label);
}

async function main() {
  await fs.mkdir(outputDirectory, { recursive: true });
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "work-video-link-probe-"));
  let context;

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      executablePath: edgePath,
      headless: false,
      viewport: { width: 1280, height: 800 },
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        "--no-first-run",
        "--disable-default-apps",
        "--mute-audio",
      ],
    });
    const page = context.pages()[0] || (await context.newPage());
    await page.goto("https://www.douyin.com/", {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    await page.waitForTimeout(5000);
    const before = await snapshot(page, "before");

    const closeButton = page.locator(
      'button[aria-label*="关闭"], [role="dialog"] button[aria-label*="关闭"], [role="dialog"] .semi-modal-close, [role="dialog"] [class*="close"]',
    ).first();
    if (await closeButton.count()) {
      await closeButton.click({ force: true }).catch(() => {});
      await page.waitForTimeout(700);
    }

    const recommend = page.getByText("推荐", { exact: true }).first();
    if (await recommend.count()) {
      await recommend.click({ force: true }).catch(() => {});
      await page.waitForTimeout(7000);
    }

    const afterRecommend = await snapshot(page, "after-recommend");
    await page.screenshot({
      path: path.join(outputDirectory, "live-douyin-probe.png"),
      fullPage: false,
    });

    console.log(JSON.stringify({ ok: true, before, afterRecommend }, null, 2));
  } finally {
    if (context) await context.close();
    const tempRoot = path.resolve(os.tmpdir());
    const resolvedProfile = path.resolve(userDataDir);
    if (resolvedProfile.startsWith(tempRoot + path.sep)) {
      await fs.rm(resolvedProfile, { recursive: true, force: true });
    }
  }
}

await main();
