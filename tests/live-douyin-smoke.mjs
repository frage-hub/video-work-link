import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const repoRoot = path.resolve(import.meta.dirname, "..");
const extensionPath = path.join(repoRoot, "extension");
const outputDirectory = path.join(repoRoot, "artifacts");
const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

async function main() {
  await fs.mkdir(outputDirectory, { recursive: true });
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "work-video-link-live-"));
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

    const serviceWorker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent("serviceworker", { timeout: 15000 }));
    const page = context.pages()[0] || (await context.newPage());
    await page.goto("https://www.douyin.com/", {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    await page.waitForTimeout(8000);

    const initial = await page.evaluate(() => ({
      url: location.href,
      title: document.title,
      videoCount: document.querySelectorAll("video").length,
      hasExtensionGlobal: Boolean(globalThis.__workVideoLinkDouyinLoaded),
      bodyText: (document.body?.innerText || "").slice(0, 300),
    }));

    const loginMarkup = await page.evaluate(() =>
      [...document.querySelectorAll("body *")]
        .filter((element) =>
          (element.textContent || "").includes("登录后免费畅享高清视频"),
        )
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            tag: element.tagName.toLowerCase(),
            role: element.getAttribute("role") || "",
            className:
              typeof element.className === "string" ? element.className : "",
            area: Math.round(rect.width * rect.height),
            text: (element.textContent || "").trim().slice(0, 80),
          };
        })
        .sort((left, right) => left.area - right.area)
        .slice(0, 8),
    );

    await page.evaluate(() => {
      document.querySelectorAll("video").forEach((video) => {
        video.muted = true;
      });
    });

    await serviceWorker.evaluate(async () => {
      await chrome.storage.session.set({
        activeSession: {
          id: "live-smoke",
          active: true,
          phase: "active",
          reason: "manual",
          startedAt: Date.now(),
          endedAt: null,
          endReason: null,
          workbenchTabId: null,
          workbenchWindowId: null,
          douyinTabId: null,
          douyinWindowId: null,
          count: 1,
          maxVideos: 2,
          limitReached: false,
          lastError: null,
        },
      });
    });

    await page.waitForTimeout(2500);
    const afterStart = await page.evaluate(() => {
      const videos = [...document.querySelectorAll("video")];
      const hud = document.querySelector("#work-video-link-hud");
      return {
        videoCount: videos.length,
        playingCount: videos.filter((video) => !video.paused).length,
        hudPresent: Boolean(hud),
        hudLabel: hud?.shadowRoot?.querySelector(".label")?.textContent?.trim() || "",
        scrollY: window.scrollY,
        loginElements: [...document.querySelectorAll("body *")]
          .filter((element) =>
            (element.textContent || "").includes("登录后免费畅享高清视频"),
          )
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              tag: element.tagName.toLowerCase(),
              role: element.getAttribute("role") || "",
              className:
                typeof element.className === "string" ? element.className : "",
              area: Math.round(rect.width * rect.height),
              text: (element.textContent || "").trim().slice(0, 80),
            };
          })
          .sort((left, right) => left.area - right.area)
          .slice(0, 8),
      };
    });

    await page.screenshot({
      path: path.join(outputDirectory, "live-douyin.png"),
      fullPage: false,
    });
    await serviceWorker.evaluate(async () => {
      await chrome.storage.session.set({ activeSession: null });
    });

    console.log(
      JSON.stringify(
        {
          ok: true,
          initial,
          loginMarkup,
          afterStart,
          screenshot: path.join(outputDirectory, "live-douyin.png"),
        },
        null,
        2,
      ),
    );
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
