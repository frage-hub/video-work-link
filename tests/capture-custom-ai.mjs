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
    path.join(os.tmpdir(), "work-video-link-custom-ai-"),
  );
  let context;

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      executablePath: edgePath,
      headless: false,
      viewport: { width: 800, height: 780 },
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
            id: "custom-chatgpt",
            name: "ChatGPT",
            origin: "https://chatgpt.com",
            selector: "button[data-testid='stop-button']",
            enabled: true,
          },
        ],
      });
    });

    const page = await context.newPage();
    await page.setViewportSize({ width: 800, height: 780 });
    await page.goto(
      `chrome-extension://${extensionId}/custom-ai/custom-ai.html?url=${encodeURIComponent(
        "https://chatgpt.com/c/example",
      )}&title=${encodeURIComponent("Example AI Workspace")}`,
    );
    await page.waitForSelector("[data-source-id='custom-chatgpt']");
    await page.waitForFunction(() =>
      document
        .querySelector("[data-source-id='custom-chatgpt'] .status-dot")
        ?.getAttribute("data-state") === "ok",
    );

    assert.equal(await page.locator("[data-source-id]").count(), 1);
    assert.match(await page.locator("#source-count").textContent(), /1 \/ 20/);
    assert.match(
      await page.locator("[data-source-id='custom-chatgpt']").textContent(),
      /button\[data-testid='stop-button'\]/,
    );
    assert.match(
      await page.locator("#api-snippet").textContent(),
      /data-work-video-link-state/,
    );

    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
    }));
    assert.ok(
      metrics.scrollWidth <= metrics.clientWidth,
      "Custom AI window must not overflow horizontally",
    );
    await page.screenshot({
      path: path.join(outputDirectory, "custom-ai-window.png"),
      fullPage: true,
    });

    await page.setViewportSize({ width: 420, height: 800 });
    const mobileMetrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    assert.ok(
      mobileMetrics.scrollWidth <= mobileMetrics.clientWidth,
      "Custom AI window must remain responsive at compact widths",
    );
    await page.screenshot({
      path: path.join(outputDirectory, "custom-ai-window-compact.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 800, height: 780 });

    await page.fill("#source-name", "OpenAI Legacy");
    await page.fill("#source-origin", "https://chat.openai.com");
    await page.fill("#source-selector", "#custom-stop");
    await page.click("#save-source");
    await page.waitForFunction(() => document.querySelectorAll("[data-source-id]").length === 2);
    assert.match(await page.locator("#source-count").textContent(), /2 \/ 20/);

    await page.goto(`chrome-extension://${extensionId}/custom-ai/guide.html`);
    await page.waitForSelector("h1");
    assert.match(await page.locator("h1").textContent(), /自定义 AI 接入协议/);
    assert.match(await page.locator("body").textContent(), /work-video-link:start/);
    await page.screenshot({
      path: path.join(outputDirectory, "custom-ai-guide.png"),
      fullPage: true,
    });

    console.log(
      JSON.stringify(
        {
          ok: true,
          extensionId,
          metrics,
          mobileMetrics,
          screenshots: [
            path.join(outputDirectory, "custom-ai-window.png"),
            path.join(outputDirectory, "custom-ai-window-compact.png"),
            path.join(outputDirectory, "custom-ai-guide.png"),
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
