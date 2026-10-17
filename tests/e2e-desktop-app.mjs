import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const repoRoot = path.resolve(import.meta.dirname, "..");
const extensionPath = path.join(repoRoot, "extension");
const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const bridgeBase = "http://127.0.0.1:17321";

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
  const bridgeStatus = await fetch(`${bridgeBase}/douyin/status`, {
    signal: AbortSignal.timeout(5000),
  }).then((response) => response.json());
  if (!bridgeStatus.ok) {
    throw new Error(bridgeStatus.error || "The local bridge is unavailable");
  }
  assert.equal(bridgeStatus.available, true);
  assert.equal(bridgeStatus.protocolRegistered, true);
  assert.equal(bridgeStatus.executableExists, true);

  const userDataDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "work-video-link-desktop-app-"),
  );
  let context;

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      executablePath: edgePath,
      headless: false,
      viewport: { width: 760, height: 640 },
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

    await serviceWorker.evaluate(async () => {
      await chrome.storage.sync.set({
        settings: {
          autoLink: true,
          autoReturn: true,
          desktopLink: false,
          maxVideos: 12,
          videoMode: "web",
        },
      });
      await chrome.storage.session.set({ activeSession: null });
    });

    await extensionPage.click("#video-mode-desktop");
    await extensionPage.waitForFunction(() =>
      document.querySelector("#video-mode-desktop")?.getAttribute("aria-pressed") === "true",
    );
    await extensionPage.click("#primary-button");

    const activeSession = await waitFor(
      async () => {
        const session = await getSession(serviceWorker);
        return session?.active &&
          session.videoMode === "desktop" &&
          session.phase === "active"
          ? session
          : null;
      },
      15000,
      "the desktop app session to start",
    );
    assert.equal(activeSession.douyinTabId, null);
    assert.equal(activeSession.desktopPlaybackState, "playing");
    assert.equal(activeSession.desktopPlaybackVerified, true);

    const appStatus = await fetch(`${bridgeBase}/douyin/status`, {
      signal: AbortSignal.timeout(5000),
    }).then((response) => response.json());
    assert.equal(appStatus.found, true);
    assert.equal(appStatus.available, true);
    assert.equal(appStatus.appRunning, true);
    assert.equal(appStatus.windowFound, true);
    assert.equal(
      context.pages().some((page) => page.url().startsWith("https://www.douyin.com/")),
      false,
      "Desktop app mode must not open a Douyin browser tab",
    );

    await extensionPage.waitForFunction(() =>
      document.querySelector("#primary-label")?.textContent?.includes("结束并返回"),
    );
    await extensionPage.click("#primary-button");

    const stoppedSession = await waitFor(
      async () => {
        const session = await getSession(serviceWorker);
        return session && !session.active ? session : null;
      },
      15000,
      "the desktop app session to stop",
    );
    assert.equal(stoppedSession.desktopPauseFailed, false);
    assert.equal(stoppedSession.desktopPlaybackState, "paused");
    assert.equal(stoppedSession.desktopPlaybackVerified, true);
    assert.equal(stoppedSession.endReason, "manual");

    console.log(
      JSON.stringify(
        {
          ok: true,
          extensionId,
          videoMode: activeSession.videoMode,
          appProcessId: appStatus.processId,
          appWindowHandle: appStatus.windowHandle,
          startedPlayback: activeSession.desktopPlaybackState,
          pausedPlayback: stoppedSession.desktopPlaybackState,
          pauseVerified: stoppedSession.desktopPlaybackVerified,
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
