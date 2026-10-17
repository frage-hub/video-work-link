import assert from "node:assert/strict";
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
  const userDataDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "work-video-link-unavailable-"),
  );
  let context;

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      executablePath: edgePath,
      headless: false,
      viewport: { width: 360, height: 620 },
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        "--no-first-run",
        "--disable-default-apps",
      ],
    });

    const serviceWorker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent("serviceworker", { timeout: 15000 }));
    const extensionId = new URL(serviceWorker.url()).host;
    await context.route(
      "http://127.0.0.1:17321/douyin/status",
      (route) => route.abort("failed"),
    );
    await context.route(
      /^https:\/\/www\.douyin\.com\//,
      (route) => route.abort("failed"),
    );

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await popup.waitForFunction(() => {
      const web = document.querySelector("#video-web-dot");
      const desktop = document.querySelector("#video-desktop-dot");
      return web?.dataset.state === "error" && desktop?.dataset.state === "error";
    });

    assert.equal(
      await popup.isDisabled("#video-mode-web"),
      true,
      "Unavailable web mode must not be selectable",
    );
    assert.equal(
      await popup.isDisabled("#video-mode-desktop"),
      true,
      "Unavailable desktop mode must not be selectable",
    );
    assert.equal(
      await popup.isDisabled("#primary-button"),
      true,
      "Starting must be disabled when the selected mode is unavailable",
    );
    assert.match(
      await popup.locator("#status-title").innerText(),
      /暂不可用/,
      "The status area must explain that the selected mode is unavailable",
    );
    assert.match(
      await popup.locator("#status-meta").innerText(),
      /无法访问抖音页面|连接抖音超时/,
    );

    const metrics = await popup.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
    }));
    assert.ok(metrics.scrollWidth <= metrics.clientWidth);
    assert.ok(metrics.scrollHeight <= metrics.clientHeight);

    const screenshot = path.join(outputDirectory, "popup-unavailable.png");
    await popup.screenshot({ path: screenshot, fullPage: true });

    console.log(
      JSON.stringify(
        {
          ok: true,
          metrics,
          screenshot,
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
