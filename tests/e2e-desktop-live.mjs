import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const repoRoot = path.resolve(import.meta.dirname, "..");
const extensionPath = path.join(repoRoot, "extension");
const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

const douyinHtml = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Douyin Desktop Fixture</title>
  <style>
    html, body { margin: 0; min-height: 100%; background: #121416; }
    video { width: 100vw; height: 100vh; object-fit: cover; background: #202326; }
  </style>
</head>
<body>
  <video muted playsinline loop></video>
</body>
</html>`;

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(predicate, timeoutMs, description) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = await predicate();
    if (result) return result;
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function getSession(serviceWorker) {
  return serviceWorker.evaluate(async () => {
    const stored = await chrome.storage.session.get("activeSession");
    return stored.activeSession || null;
  });
}

async function main() {
  let bridgeStatus = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      bridgeStatus = await fetch("http://127.0.0.1:17321/status", {
        signal: AbortSignal.timeout(1500),
      }).then((response) => response.json());
      if (bridgeStatus.available) break;
    } catch (_) {
      bridgeStatus = null;
    }
    await sleep(250);
  }

  if (!bridgeStatus?.available || !bridgeStatus.working) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          skipped: true,
          reason: "Codex desktop must be available and working",
          bridgeStatus,
        },
        null,
        2,
      ),
    );
    return;
  }

  const userDataDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "work-video-link-desktop-"),
  );
  let context;

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      executablePath: edgePath,
      headless: false,
      viewport: { width: 1080, height: 760 },
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        "--no-first-run",
        "--disable-default-apps",
      ],
    });
    context.setDefaultTimeout(15000);

    const serviceWorker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent("serviceworker", { timeout: 15000 }));
    const extensionId = new URL(serviceWorker.url()).host;
    const extensionPage = await context.newPage();
    await extensionPage.goto(
      `chrome-extension://${extensionId}/popup/popup.html`,
    );

    await context.route(/^https:\/\/www\.douyin\.com\/.*/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: douyinHtml,
      });
    });

    const douyinOpened = context.waitForEvent("page", {
      predicate: (page) => page.url().startsWith("https://www.douyin.com/"),
      timeout: 15000,
    });

    await serviceWorker.evaluate(async () => {
      await chrome.storage.sync.set({
        settings: {
          autoLink: false,
          autoReturn: true,
          desktopLink: true,
          maxVideos: 2,
        },
      });
    });

    const douyin = await douyinOpened;
    await douyin.waitForLoadState("domcontentloaded");

    const activeSession = await waitFor(
      async () => {
        const session = await getSession(serviceWorker);
        return session?.active && session.reason === "desktop" ? session : null;
      },
      15000,
      "the Codex desktop session to start",
    );

    assert.equal(activeSession.workbenchKind, "desktop");
    assert.equal(activeSession.desktopTargetId, bridgeStatus.targetId);
    assert.equal(activeSession.maxVideos, 2);
    assert.equal(activeSession.workSourceCount, 1);
    assert.equal(activeSession.workSourceIds.includes("desktop"), true);

    await extensionPage.waitForFunction(() => {
      const toggle = document.querySelector("#desktop-link");
      const hint = document.querySelector("#desktop-hint");
      return toggle?.checked && hint?.textContent?.includes("Codex");
    });

    await douyin.waitForFunction(
      () =>
        Boolean(document.querySelector("#work-video-link-hud")),
      null,
      { timeout: 15000 },
    );

    const stopResponse = await extensionPage.evaluate(async () =>
      chrome.runtime.sendMessage({
        type: "STOP_SESSION",
        reason: "manual",
      }),
    );
    assert.equal(stopResponse.ok, true);

    const stoppedSession = await waitFor(
      async () => {
        const session = await getSession(serviceWorker);
        return session && !session.active ? session : null;
      },
      10000,
      "the desktop session to stop manually",
    );
    assert.equal(stoppedSession.endReason, "manual");
    assert.equal(
      await douyin.evaluate(() =>
        [...document.querySelectorAll("video")].every((video) => video.paused),
      ),
      true,
      "Videos must pause after a manual desktop stop",
    );

    const suppressed = await serviceWorker.evaluate(async () => {
      const stored = await chrome.storage.local.get(
        "desktopSuppressUntilIdle",
      );
      return stored.desktopSuppressUntilIdle;
    });
    assert.equal(suppressed, true);

    await sleep(3500);
    const sessionAfterWait = await getSession(serviceWorker);
    assert.equal(sessionAfterWait.active, false);
    assert.equal(sessionAfterWait.startedAt, stoppedSession.startedAt);

    await serviceWorker.evaluate(async () => {
      await chrome.storage.sync.set({
        settings: {
          autoLink: false,
          autoReturn: true,
          desktopLink: false,
          maxVideos: 2,
        },
      });
    });
    await sleep(500);
    await serviceWorker.evaluate(async () => {
      await chrome.storage.sync.set({
        settings: {
          autoLink: false,
          autoReturn: true,
          desktopLink: true,
          maxVideos: 2,
        },
      });
    });

    const completionSession = await waitFor(
      async () => {
        const session = await getSession(serviceWorker);
        return session?.active && session.startedAt > stoppedSession.startedAt
          ? session
          : null;
      },
      15000,
      "the desktop session to restart after reconnecting",
    );
    assert.equal(completionSession.reason, "desktop");

    await serviceWorker.evaluate(() => {
      globalThis.__activationCalls = [];
      globalThis.fetch = async (input) => {
        const url = typeof input === "string" ? input : input.url;
        if (url.startsWith("http://127.0.0.1:9229/")) {
          globalThis.__activationCalls.push(url);
          return { ok: true };
        }
        throw new Error(`Unexpected fetch during test: ${url}`);
      };
    });

    const completionResponse = await extensionPage.evaluate(async () =>
      chrome.runtime.sendMessage({
        type: "STOP_SESSION",
        reason: "desktop-generation-complete",
      }),
    );
    assert.equal(completionResponse.ok, true);

    const completedDesktopSession = await waitFor(
      async () => {
        const session = await getSession(serviceWorker);
        return session && !session.active && session.id === completionSession.id
          ? session
          : null;
      },
      10000,
      "the desktop completion to finish the session",
    );
    assert.equal(
      completedDesktopSession.endReason,
      "desktop-generation-complete",
    );

    const activationCalls = await serviceWorker.evaluate(
      () => globalThis.__activationCalls,
    );
    assert.equal(
      activationCalls.some((url) =>
        url.includes(`/json/activate/${bridgeStatus.targetId}`),
      ),
      true,
      "Completion must activate the Codex desktop target",
    );

    const suppressionAfterCompletion = await serviceWorker.evaluate(async () => {
      const stored = await chrome.storage.local.get(
        "desktopSuppressUntilIdle",
      );
      return stored.desktopSuppressUntilIdle;
    });
    assert.equal(suppressionAfterCompletion, false);

    console.log(
      JSON.stringify(
        {
          ok: true,
          extensionId,
          desktopTargetId: bridgeStatus.targetId,
          started: activeSession.startedAt,
          stoppedReason: stoppedSession.endReason,
          suppressed: true,
          completionReason: completedDesktopSession.endReason,
          activationCalls: activationCalls.length,
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
