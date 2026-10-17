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
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "work-video-link-visual-"));
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

    await serviceWorker.evaluate(async () => {
      await chrome.storage.sync.set({
        customSources: [
          {
            id: "visual-custom-ai",
            name: "Claude",
            origin: "https://claude.ai",
            selector: "button[aria-label='Stop response']",
            enabled: true,
          },
        ],
      });
    });

    const popup = await context.newPage();
    await popup.setViewportSize({ width: 360, height: 620 });
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await popup.waitForSelector("#primary-button");
    await popup.waitForFunction(() => {
      const web = document.querySelector("#video-web-dot");
      const desktop = document.querySelector("#video-desktop-dot");
      return web?.dataset.state === "ok" && desktop?.dataset.state === "ok";
    });
    assert.equal(
      await popup.isDisabled("#primary-button"),
      false,
      "An available selected video mode must allow starting",
    );
    assert.equal(await popup.isDisabled("#open-custom-ai"), false);
    assert.match(
      await popup.locator("#custom-ai-hint").textContent(),
      /1 个自定义网站已接入/,
    );

    const metrics = await popup.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
    }));
    assert.ok(metrics.scrollWidth <= metrics.clientWidth, "Popup must not overflow horizontally");
    assert.ok(metrics.scrollHeight <= metrics.clientHeight, "Popup must not overflow vertically");
    await popup.screenshot({
      path: path.join(outputDirectory, "popup-idle.png"),
      fullPage: true,
    });

    await popup.click("#video-mode-desktop");
    await popup.waitForFunction(() =>
      document.querySelector("#video-mode-desktop")?.getAttribute("aria-pressed") === "true",
    );
    await popup.screenshot({
      path: path.join(outputDirectory, "popup-platform-desktop.png"),
      fullPage: true,
    });
    await popup.click("#video-mode-web");
    await popup.waitForFunction(() =>
      document.querySelector("#video-mode-web")?.getAttribute("aria-pressed") === "true",
    );

    await serviceWorker.evaluate(async () => {
      await chrome.storage.session.set({
        activeSession: {
          id: "visual-active",
          active: true,
          phase: "active",
          reason: "auto",
          startedAt: Date.now() - 42000,
          endedAt: null,
          endReason: null,
          workbenchTabId: null,
          workbenchWindowId: null,
          douyinTabId: null,
          douyinWindowId: null,
          workSourceCount: 2,
          count: 3,
          maxVideos: 12,
          limitReached: false,
          lastError: null,
        },
      });
    });
    await popup.waitForFunction(() => document.body.dataset.status === "active");
    assert.match(
      await popup.locator("#status-meta").textContent(),
      /2 个对话同时进行中/,
    );
    assert.match(
      await popup.locator("#status-meta").textContent(),
      /任一对话结束后自动暂停/,
    );
    await popup.screenshot({
      path: path.join(outputDirectory, "popup-active.png"),
      fullPage: true,
    });

    await serviceWorker.evaluate(async () => {
      const stored = await chrome.storage.session.get("activeSession");
      await chrome.storage.session.set({
        activeSession: {
          ...stored.activeSession,
          limitReached: true,
          count: 12,
        },
      });
    });
    await popup.waitForFunction(() => document.body.dataset.status === "limited");
    await popup.screenshot({
      path: path.join(outputDirectory, "popup-limited.png"),
      fullPage: true,
    });

    await serviceWorker.evaluate(async () => {
      await chrome.storage.session.set({
        activeSession: {
          id: "visual-desktop",
          active: true,
          phase: "active",
          reason: "desktop",
          startedAt: Date.now() - 18000,
          endedAt: null,
          endReason: null,
          workbenchTabId: null,
          workbenchWindowId: null,
          douyinTabId: null,
          douyinWindowId: null,
          desktopTargetId: "visual-target",
          workbenchKind: "desktop",
          count: 2,
          maxVideos: 12,
          limitReached: false,
          lastError: null,
        },
      });
    });
    await popup.waitForFunction(() => document.body.dataset.status === "active");
    await popup.screenshot({
      path: path.join(outputDirectory, "popup-desktop.png"),
      fullPage: true,
    });

    console.log(
      JSON.stringify(
        {
          ok: true,
          extensionId,
          metrics,
          screenshots: [
            path.join(outputDirectory, "popup-idle.png"),
            path.join(outputDirectory, "popup-platform-desktop.png"),
            path.join(outputDirectory, "popup-active.png"),
            path.join(outputDirectory, "popup-limited.png"),
            path.join(outputDirectory, "popup-desktop.png"),
          ],
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
