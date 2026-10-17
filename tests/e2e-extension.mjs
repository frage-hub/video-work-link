import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const repoRoot = path.resolve(import.meta.dirname, "..");
const extensionPath = process.env.WORK_LINK_EXTENSION_PATH
  ? path.resolve(process.env.WORK_LINK_EXTENSION_PATH)
  : path.join(repoRoot, "extension");
const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

const workbenchHtml = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Workbench Fixture</title>
  <style>
    body { margin: 0; padding: 40px; font: 16px "Segoe UI", sans-serif; background: #f7f7f5; }
    main { max-width: 680px; margin: 0 auto; }
    textarea { width: 100%; height: 120px; box-sizing: border-box; }
    button { min-height: 40px; padding: 0 16px; margin: 8px 8px 8px 0; }
    #stop { background: #e5484d; color: white; border: 1px solid #e5484d; }
  </style>
</head>
<body>
  <main>
    <h1>ChatGPT fixture</h1>
    <textarea id="prompt">Build the feature</textarea>
    <div>
      <button id="start">开始生成</button>
      <button id="finish">结束生成</button>
    </div>
    <button id="stop" data-testid="stop-button" aria-label="Stop generating" style="display:none">Stop generating</button>
    <script>
      const stop = document.querySelector('#stop');
      document.querySelector('#start').addEventListener('click', () => { stop.style.display = 'inline-block'; });
      document.querySelector('#finish').addEventListener('click', () => { stop.style.display = 'none'; });
    </script>
  </main>
</body>
</html>`;

const customAiHtml = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Custom AI Fixture</title>
  <style>
    body { margin: 0; padding: 40px; font: 16px "Segoe UI", sans-serif; background: #f3f4f1; }
    button { min-height: 40px; padding: 0 16px; margin: 8px 8px 8px 0; }
    #custom-working { background: #e5484d; color: white; border: 0; }
  </style>
</head>
<body>
  <h1>Custom AI fixture</h1>
  <button id="custom-start">开始工作</button>
  <button id="custom-finish">结束工作</button>
  <button id="custom-working" type="button" style="display:none">正在生成</button>
  <script>
    const working = document.querySelector('#custom-working');
    document.querySelector('#custom-start').addEventListener('click', () => {
      working.style.display = 'inline-block';
    });
    document.querySelector('#custom-finish').addEventListener('click', () => {
      working.style.display = 'none';
    });
  </script>
</body>
</html>`;

const douyinHtml = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Douyin Fixture</title>
  <style>
    html, body { margin: 0; width: 100%; height: 100%; background: #111; }
    body { scroll-snap-type: y mandatory; overflow-y: auto; }
    .feed-item { width: 100vw; height: 100vh; scroll-snap-align: start; scroll-snap-stop: always; position: relative; }
    video { display: block; width: 100vw; height: 100vh; object-fit: cover; background: #202326; }
    .badge { position: absolute; right: 22px; top: 50%; color: white; font: 700 30px sans-serif; }
  </style>
</head>
<body>
  <main id="feed"></main>
  <script>
    function silentWav(seconds) {
      const sampleRate = 8000;
      const sampleCount = Math.floor(sampleRate * seconds);
      const buffer = new ArrayBuffer(44 + sampleCount * 2);
      const view = new DataView(buffer);
      const write = (offset, value) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
      write(0, 'RIFF');
      view.setUint32(4, 36 + sampleCount * 2, true);
      write(8, 'WAVE');
      write(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      write(36, 'data');
      view.setUint32(40, sampleCount * 2, true);
      return new Blob([buffer], { type: 'audio/wav' });
    }

    const feed = document.querySelector('#feed');
    for (let index = 0; index < 12; index += 1) {
      const item = document.createElement('section');
      item.className = 'feed-item';
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.src = URL.createObjectURL(silentWav(2.2));
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = String(index + 1);
      item.append(video, badge);
      feed.append(item);
    }
  </script>
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

async function hudLabel(page) {
  return page.evaluate(() =>
    document
      .querySelector("#work-video-link-hud")
      ?.shadowRoot?.querySelector(".label")?.textContent?.trim(),
  );
}

async function main() {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "work-video-link-e2e-"));
  let context;

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      executablePath: edgePath,
      headless: false,
      viewport: { width: 1100, height: 800 },
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
    assert.ok(extensionId, "Extension service worker must expose an extension id");

    await sleep(500);

    await serviceWorker.evaluate(async () => {
      await chrome.storage.sync.set({
        settings: {
          autoLink: true,
          autoReturn: true,
          desktopLink: false,
          maxVideos: 6,
        },
      });
    });

    await context.route("https://chatgpt.com/e2e", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: workbenchHtml,
      });
    });
    await context.route("https://chatgpt.com/e2e-second", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: workbenchHtml,
      });
    });
    await context.route("https://chatgpt.com/custom-ai", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: customAiHtml,
      });
    });
    await context.route(/^https:\/\/www\.douyin\.com\/.*/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: douyinHtml,
      });
    });

    const workbench = context.pages()[0] || (await context.newPage());
    await workbench.goto("https://chatgpt.com/e2e");
    await workbench.waitForFunction(() => Boolean(document.querySelector("#start")));
    await sleep(500);

    const douyinOpened = context.waitForEvent("page", {
      predicate: (page) => page.url().startsWith("https://www.douyin.com/"),
      timeout: 15000,
    });
    await workbench.click("#start");
    const douyin = await douyinOpened;
    await douyin.waitForLoadState("domcontentloaded");

    await douyin.waitForFunction(
      () =>
        document
          .querySelector("#work-video-link-hud")
          ?.shadowRoot?.querySelector(".label")?.textContent?.includes("联动中"),
      null,
      { timeout: 15000 },
    );

    await douyin.waitForFunction(() => window.scrollY > 10, null, {
      timeout: 15000,
    });
    const firstSession = await waitFor(
      async () => {
        const session = await getSession(serviceWorker);
        return session?.active && session.count >= 2 ? session : null;
      },
      12000,
      "the first video advance",
    );
    assert.equal(firstSession.reason, "auto");
    assert.equal(firstSession.maxVideos, 6);
    assert.equal(firstSession.workSourceCount, 1);
    assert.match((await hudLabel(douyin)) || "", /联动中 · [2-5]\/6/);

    const secondWorkbench = await context.newPage();
    await secondWorkbench.goto("https://chatgpt.com/e2e-second");
    await secondWorkbench.waitForFunction(() =>
      Boolean(document.querySelector("#start")),
    );
    await sleep(500);
    await secondWorkbench.evaluate(() =>
      document.querySelector("#start").click(),
    );

    const concurrentSession = await waitFor(
      async () => {
        const session = await getSession(serviceWorker);
        return session?.active && session.workSourceCount === 2
          ? session
          : null;
      },
      12000,
      "the second conversation to join the active work set",
    );
    assert.equal(concurrentSession.id, firstSession.id);
    await waitFor(
      async () =>
        ((await hudLabel(douyin)) || "").includes("2 个对话"),
      5000,
      "the HUD to show both working conversations",
    );

    await workbench.evaluate(() => document.querySelector("#finish").click());
    const completed = await waitFor(
      async () => {
        const session = await getSession(serviceWorker);
        return session &&
          !session.active &&
          session.id === firstSession.id
          ? session
          : null;
      },
      12000,
      "the first conversation to pause the shared session",
    );
    assert.equal(completed.endReason, "generation-complete");
    assert.equal(completed.workSourceCount, 0);

    await waitFor(
      async () => {
        try {
          return (await workbench.evaluate(() => document.visibilityState)) === "visible";
        } catch (_) {
          return false;
        }
      },
      10000,
      "the workbench tab to become active",
    );
    assert.equal(
      await douyin.evaluate(() =>
        [...document.querySelectorAll("video")].every((video) => video.paused),
      ),
      true,
      "All videos must pause when generation completes",
    );
    assert.match((await hudLabel(douyin)) || "", /已暂停/);

    assert.equal(
      await secondWorkbench.evaluate(
        () =>
          getComputedStyle(document.querySelector("#stop")).display !== "none",
      ),
      true,
      "The second conversation should still be working after the first one ends",
    );
    await sleep(2500);
    const afterFirstCompletion = await getSession(serviceWorker);
    assert.equal(afterFirstCompletion.active, false);
    assert.equal(afterFirstCompletion.id, firstSession.id);
    assert.equal(
      await douyin.evaluate(() =>
        [...document.querySelectorAll("video")].every((video) => video.paused),
      ),
      true,
      "Playback must stay paused while the other conversation is still working",
    );

    await secondWorkbench.evaluate(() =>
      document.querySelector("#finish").click(),
    );
    await sleep(1000);
    const afterSecondCompletion = await getSession(serviceWorker);
    assert.equal(afterSecondCompletion.active, false);
    assert.equal(afterSecondCompletion.id, firstSession.id);
    await secondWorkbench.close();

    await serviceWorker.evaluate(async () => {
      await chrome.storage.sync.set({
        settings: {
          autoLink: true,
          autoReturn: true,
          desktopLink: false,
          maxVideos: 1,
        },
      });
    });
    await workbench.bringToFront();
    await workbench.click("#start");

    const limited = await waitFor(
      async () => {
        const session = await getSession(serviceWorker);
        return session?.active && session.limitReached ? session : null;
      },
      15000,
      "the video limit to pause playback",
    );
    assert.equal(limited.count, 1);
    assert.equal(
      await douyin.evaluate(() =>
        [...document.querySelectorAll("video")].every((video) => video.paused),
      ),
      true,
      "Videos must pause at the configured limit",
    );
    assert.match((await hudLabel(douyin)) || "", /已达上限/);

    await workbench.evaluate(() => document.querySelector("#finish").click());
    const secondCompleted = await waitFor(
      async () => {
        const session = await getSession(serviceWorker);
        return session && !session.active && session.startedAt !== completed.startedAt
          ? session
          : null;
      },
      15000,
      "the limited session to finish",
    );
    assert.equal(secondCompleted.endReason, "generation-complete");

    await serviceWorker.evaluate(async () => {
      await chrome.storage.sync.set({
        settings: {
          autoLink: true,
          autoReturn: true,
          desktopLink: false,
          maxVideos: 6,
        },
        customSources: [
          {
            id: "custom-e2e",
            name: "Other AI",
            origin: "https://chatgpt.com",
            selector: "#custom-working",
            enabled: true,
          },
        ],
      });
    });

    const customAi = await context.newPage();
    await customAi.goto("https://chatgpt.com/custom-ai");
    await customAi.waitForSelector("#custom-start");
    await customAi.click("#custom-start");
    const customSession = await waitFor(
      async () => {
        const session = await getSession(serviceWorker);
        return session?.active && session.startedAt > secondCompleted.startedAt
          ? session
          : null;
      },
      15000,
      "the custom AI selector to start the session",
    );
    assert.equal(customSession.reason, "auto");
    assert.equal(customSession.workbenchKind, "browser");
    assert.equal(customSession.workSourceCount, 1);

    await customAi.click("#custom-finish");
    const customCompleted = await waitFor(
      async () => {
        const session = await getSession(serviceWorker);
        return session &&
          !session.active &&
          session.id === customSession.id
          ? session
          : null;
      },
      15000,
      "the custom AI selector to pause the session",
    );
    assert.equal(customCompleted.endReason, "generation-complete");
    await waitFor(
      async () =>
        (await customAi.evaluate(() => document.visibilityState)) === "visible",
      10000,
      "the custom AI page to become active after completion",
    );

    await customAi.bringToFront();
    await customAi.evaluate(() => {
      document.documentElement.setAttribute(
        "data-work-video-link-state",
        "working",
      );
    });
    const apiSession = await waitFor(
      async () => {
        const session = await getSession(serviceWorker);
        return session?.active && session.startedAt > customCompleted.startedAt
          ? session
          : null;
      },
      15000,
      "the custom AI state API to start the session",
    );

    await customAi.evaluate(() => {
      document.documentElement.removeAttribute("data-work-video-link-state");
    });
    const apiCompleted = await waitFor(
      async () => {
        const session = await getSession(serviceWorker);
        return session && !session.active && session.id === apiSession.id
          ? session
          : null;
      },
      15000,
      "the custom AI state API to pause the session",
    );
    assert.equal(apiCompleted.endReason, "generation-complete");

    await customAi.bringToFront();
    await customAi.evaluate(() => {
      window.dispatchEvent(new CustomEvent("work-video-link:start"));
    });
    const eventSession = await waitFor(
      async () => {
        const session = await getSession(serviceWorker);
        return session?.active && session.startedAt > apiCompleted.startedAt
          ? session
          : null;
      },
      15000,
      "the custom AI start event to start the session",
    );

    await customAi.evaluate(() => {
      window.dispatchEvent(new CustomEvent("work-video-link:end"));
    });
    const eventCompleted = await waitFor(
      async () => {
        const session = await getSession(serviceWorker);
        return session && !session.active && session.id === eventSession.id
          ? session
          : null;
      },
      15000,
      "the custom AI end event to pause the session",
    );
    assert.equal(eventCompleted.endReason, "generation-complete");

    console.log(
      JSON.stringify(
        {
          ok: true,
          extensionId,
          firstSession: {
            count: firstSession.count,
            endReason: completed.endReason,
            peakWorkSources: concurrentSession.workSourceCount,
            pausedImmediately: completed.workSourceCount === 0,
            stayedPausedWhileOtherWorked: afterFirstCompletion.active === false,
          },
          limitSession: {
            count: limited.count,
            limitReached: limited.limitReached,
            endReason: secondCompleted.endReason,
          },
          customAiSession: {
            selectorStart: customSession.id === customCompleted.id,
            apiStart: apiSession.id === apiCompleted.id,
            eventStart: eventSession.id === eventCompleted.id,
            endReason: customCompleted.endReason,
          },
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
