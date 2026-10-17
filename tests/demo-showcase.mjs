import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const repoRoot = path.resolve(import.meta.dirname, "..");
const extensionPath = path.join(repoRoot, "extension");
const artifactsRoot = path.join(repoRoot, "artifacts");
const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

const workbenchHtml = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AI 工作台演示</title>
  <style>
    :root {
      --ink: #202326;
      --muted: #747a7f;
      --line: #dfe3df;
      --paper: #f4f6f2;
      --red: #e5484d;
      --green: #1f8b67;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      color: var(--ink);
      background: var(--paper);
      font: 15px/1.55 "Segoe UI", "Microsoft YaHei", sans-serif;
    }
    header {
      height: 58px;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 0 28px;
      border-bottom: 1px solid var(--line);
      background: #fff;
    }
    .mark {
      width: 30px;
      height: 30px;
      display: grid;
      place-items: center;
      border-radius: 7px;
      background: #202326;
      color: #fff;
      font-size: 13px;
      font-weight: 800;
    }
    .brand { font-weight: 750; }
    .demo-chip {
      margin-left: auto;
      padding: 4px 8px;
      border: 1px solid var(--line);
      border-radius: 5px;
      color: #596066;
      font-size: 12px;
      font-weight: 650;
    }
    main {
      width: min(780px, calc(100vw - 40px));
      margin: 0 auto;
      padding: 44px 0 70px;
    }
    .eyebrow {
      margin: 0 0 10px;
      color: var(--green);
      font-size: 12px;
      font-weight: 750;
    }
    h1 {
      margin: 0 0 12px;
      font-size: 31px;
      line-height: 1.2;
      letter-spacing: 0;
    }
    .lead {
      max-width: 620px;
      margin: 0 0 26px;
      color: var(--muted);
      font-size: 15px;
    }
    .conversation {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
      overflow: hidden;
    }
    .message {
      padding: 24px 25px 19px;
      border-bottom: 1px solid #eceeeb;
    }
    .message-label {
      margin-bottom: 8px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
    }
    .message p { margin: 0; }
    .composer {
      padding: 16px 18px;
      background: #fafbf9;
    }
    .status-row {
      min-height: 28px;
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 11px;
      color: var(--muted);
      font-size: 13px;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #a6aca7;
    }
    body[data-phase="working"] .status-dot {
      background: var(--red);
      box-shadow: 0 0 0 4px rgba(229,72,77,.1);
    }
    body[data-phase="done"] .status-dot {
      background: var(--green);
      box-shadow: 0 0 0 4px rgba(31,139,103,.1);
    }
    .controls { display: flex; align-items: center; gap: 9px; }
    button {
      min-height: 38px;
      border: 1px solid var(--line);
      border-radius: 7px;
      padding: 0 15px;
      background: #fff;
      color: var(--ink);
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }
    button:hover { background: #f0f2ef; }
    #start {
      border-color: #202326;
      background: #202326;
      color: #fff;
    }
    #stop {
      border-color: var(--red);
      background: var(--red);
      color: #fff;
    }
    #finish { color: #555c60; }
    [hidden] { display: none !important; }
    .result {
      margin-top: 18px;
      padding: 18px 20px;
      border: 1px solid #cfe1d8;
      border-radius: 8px;
      background: #eef7f2;
    }
    .result strong {
      display: block;
      margin-bottom: 5px;
      color: #176b50;
    }
    .result p { margin: 0; color: #4d6960; font-size: 13px; }
    .demo-note {
      display: flex;
      gap: 10px;
      margin-top: 18px;
      color: var(--muted);
      font-size: 12px;
    }
    .demo-note span {
      width: 18px;
      height: 18px;
      flex: 0 0 18px;
      display: grid;
      place-items: center;
      border: 1px solid var(--line);
      border-radius: 50%;
      color: #646b66;
      font-size: 11px;
      font-weight: 700;
    }
  </style>
</head>
<body data-phase="idle">
  <header>
    <div class="mark">AI</div>
    <div class="brand">AI 工作台</div>
    <div class="demo-chip">联动演示</div>
  </header>
  <main>
    <p class="eyebrow">WORKFLOW DEMO</p>
    <h1>让等待任务的时间自动播放</h1>
    <p class="lead">这是本地演示页面，不会调用真实 ChatGPT，也不会消耗真实任务额度。启动后扩展会接管标签页联动。</p>

    <section class="conversation">
      <div class="message">
        <div class="message-label">你</div>
        <p>请整理本周项目进度，并给出下一阶段的风险清单。</p>
      </div>
      <div class="composer">
        <div class="status-row">
          <span class="status-dot"></span>
          <span id="status-copy">等待开始演示</span>
        </div>
        <div class="controls">
          <button id="start" type="button">开始工作</button>
          <button id="stop" type="button" data-testid="stop-button" aria-label="Stop generating" hidden>停止生成</button>
          <button id="finish" type="button" hidden>模拟 AI 完成</button>
        </div>
      </div>
    </section>

    <div class="result" id="result" hidden>
      <strong>任务已完成，已自动返回工作台</strong>
      <p>抖音视频已暂停。点击“再次演示”可以重新体验完整流程。</p>
    </div>

    <div class="demo-note">
      <span>i</span>
      <div>扩展会自动切到抖音演示流；每个视频播放结束后只推进一次，并在任务完成时暂停返回。</div>
    </div>
  </main>
  <script>
    const body = document.body;
    const start = document.querySelector("#start");
    const stop = document.querySelector("#stop");
    const finish = document.querySelector("#finish");
    const result = document.querySelector("#result");
    const status = document.querySelector("#status-copy");

    start.addEventListener("click", () => {
      body.dataset.phase = "working";
      start.hidden = true;
      stop.hidden = false;
      finish.hidden = false;
      result.hidden = true;
      status.textContent = "AI 正在工作，已进入抖音";
    });

    finish.addEventListener("click", () => {
      body.dataset.phase = "done";
      stop.hidden = true;
      finish.hidden = true;
      result.hidden = false;
      status.textContent = "AI 已完成，正在返回工作台";
      setTimeout(() => {
        start.textContent = "再次演示";
        start.hidden = false;
        status.textContent = "已完成并返回";
      }, 1900);
    });
  </script>
</body>
</html>`;

const douyinHtml = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>抖音自动联动演示</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      width: 100%;
      height: 100%;
      background: #101214;
      color: #fff;
      font-family: "Segoe UI", "Microsoft YaHei", sans-serif;
      letter-spacing: 0;
    }
    body {
      overflow-y: auto;
      scroll-snap-type: y mandatory;
      scrollbar-width: none;
    }
    body::-webkit-scrollbar { display: none; }
    .feed-item {
      position: relative;
      width: 100vw;
      height: 100vh;
      overflow: hidden;
      scroll-snap-align: start;
      scroll-snap-stop: always;
      isolation: isolate;
      background: #182024;
    }
    video {
      position: absolute;
      inset: 0;
      z-index: -1;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .scene {
      position: absolute;
      inset: 0;
      z-index: 0;
      background:
        linear-gradient(180deg, rgba(5,9,12,.18), rgba(5,9,12,.8)),
        repeating-linear-gradient(120deg, rgba(255,255,255,.035) 0 2px, transparent 2px 18px),
        radial-gradient(circle at 72% 34%, rgba(64,199,177,.42), transparent 24%),
        linear-gradient(145deg, #173b43 0%, #101719 54%, #1d2325 100%);
    }
    .feed-item:nth-child(2) .scene {
      background:
        linear-gradient(180deg, rgba(15,7,4,.12), rgba(10,6,5,.83)),
        repeating-linear-gradient(65deg, rgba(255,255,255,.035) 0 1px, transparent 1px 22px),
        radial-gradient(circle at 28% 28%, rgba(240,156,71,.48), transparent 26%),
        linear-gradient(150deg, #6a321e 0%, #241411 56%, #151719 100%);
    }
    .feed-item:nth-child(3) .scene {
      background:
        linear-gradient(180deg, rgba(5,9,18,.12), rgba(5,7,12,.86)),
        repeating-linear-gradient(148deg, rgba(255,255,255,.028) 0 2px, transparent 2px 20px),
        radial-gradient(circle at 65% 38%, rgba(100,125,218,.44), transparent 25%),
        linear-gradient(150deg, #283355 0%, #141924 55%, #111316 100%);
    }
    .topline {
      position: absolute;
      top: 24px;
      left: 26px;
      right: 26px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      z-index: 2;
      color: rgba(255,255,255,.72);
      font-size: 12px;
      font-weight: 650;
    }
    .live {
      display: inline-flex;
      align-items: center;
      gap: 7px;
    }
    .live::before {
      content: "";
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #f13b5f;
      box-shadow: 0 0 0 4px rgba(241,59,95,.12);
    }
    .demo-badge {
      padding: 5px 8px;
      border: 1px solid rgba(255,255,255,.16);
      border-radius: 5px;
      background: rgba(13,16,18,.38);
    }
    .copy {
      position: absolute;
      left: 48px;
      bottom: 82px;
      z-index: 2;
      width: min(680px, calc(100vw - 180px));
    }
    .number {
      margin-bottom: 8px;
      color: rgba(255,255,255,.5);
      font-size: 12px;
      font-weight: 750;
    }
    .copy h1 {
      margin: 0 0 12px;
      font-size: 38px;
      line-height: 1.15;
      text-shadow: 0 2px 20px rgba(0,0,0,.36);
    }
    .copy p {
      margin: 0;
      color: rgba(255,255,255,.72);
      font-size: 14px;
    }
    .actions {
      position: absolute;
      right: 34px;
      bottom: 94px;
      z-index: 2;
      display: grid;
      gap: 17px;
      justify-items: center;
      color: rgba(255,255,255,.85);
      font-size: 11px;
      font-weight: 700;
    }
    .action {
      width: 48px;
      height: 48px;
      display: grid;
      place-items: center;
      border: 1px solid rgba(255,255,255,.13);
      border-radius: 50%;
      background: rgba(18,21,23,.42);
      backdrop-filter: blur(8px);
      font-size: 17px;
    }
    .progress {
      position: absolute;
      left: 48px;
      right: 112px;
      bottom: 42px;
      z-index: 2;
      height: 3px;
      overflow: hidden;
      border-radius: 2px;
      background: rgba(255,255,255,.18);
    }
    .progress span {
      display: block;
      width: 0;
      height: 100%;
      background: #fff;
    }
    .footer-hint {
      position: absolute;
      right: 34px;
      bottom: 32px;
      z-index: 2;
      color: rgba(255,255,255,.42);
      font-size: 11px;
    }
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
      const write = (offset, value) => {
        [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
      };
      write(0, "RIFF");
      view.setUint32(4, 36 + sampleCount * 2, true);
      write(8, "WAVE");
      write(12, "fmt ");
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      write(36, "data");
      view.setUint32(40, sampleCount * 2, true);
      return new Blob([buffer], { type: "audio/wav" });
    }

    const items = [
      { title: "工作开始时，画面自己切了过来", text: "无需手动打开抖音，任务一开始就进入播放状态。" },
      { title: "视频结束，只向前推进一条", text: "同一个视频不会被重复计数，达到上限会立刻暂停。" },
      { title: "AI 完成后，自动回到工作台", text: "视频暂停、标签页切回，不会继续刷过头。" },
    ];
    const feed = document.querySelector("#feed");

    items.forEach((item, index) => {
      const section = document.createElement("section");
      section.className = "feed-item";
      section.innerHTML = [
        '<video muted playsinline preload="auto"></video>',
        '<div class="scene"></div>',
        '<div class="topline">',
        '  <span class="live">自动联动演示</span>',
        '  <span class="demo-badge">本地模拟流</span>',
        '</div>',
        '<div class="copy">',
        '  <div class="number">演示视频 0' + (index + 1) + ' / 03</div>',
        '  <h1>' + item.title + '</h1>',
        '  <p>' + item.text + '</p>',
        '</div>',
        '<div class="actions">',
        '  <div class="action">♡</div><div class="action">◌</div><div class="action">↗</div>',
        '</div>',
        '<div class="progress"><span></span></div>',
        '<div class="footer-hint">播放结束后自动切换</div>',
      ].join("");

      const video = section.querySelector("video");
      const progress = section.querySelector(".progress span");
      video.src = URL.createObjectURL(silentWav(3.1));
      video.addEventListener("timeupdate", () => {
        const ratio = Number.isFinite(video.duration) && video.duration > 0
          ? Math.min(1, video.currentTime / video.duration)
          : 0;
        progress.style.width = (ratio * 100).toFixed(2) + "%";
      });
      feed.appendChild(section);
    });
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

async function main() {
  await fs.mkdir(artifactsRoot, { recursive: true });
  const userDataDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "work-video-link-demo-"),
  );
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
    context.setDefaultTimeout(20000);

    const serviceWorker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent("serviceworker", { timeout: 15000 }));

    await context.route("https://chatgpt.com/demo", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: workbenchHtml,
      });
    });
    await context.route(/^https:\/\/www\.douyin\.com\/.*/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: douyinHtml,
      });
    });

    await serviceWorker.evaluate(async () => {
      await chrome.storage.sync.set({
        settings: {
          autoLink: true,
          autoReturn: true,
          desktopLink: false,
          maxVideos: 3,
        },
      });
      await chrome.storage.session.set({ activeSession: null });
      await chrome.storage.local.set({
        desktopSuppressUntilIdle: false,
      });
    });

    const workbench = context.pages()[0] || (await context.newPage());
    await workbench.goto("https://chatgpt.com/demo", {
      waitUntil: "domcontentloaded",
    });
    await workbench.bringToFront();
    await sleep(1100);

    const startupState = await workbench.evaluate(() => ({
      contentScriptLoaded: Boolean(globalThis.__workVideoLinkWorkbenchLoaded),
      stopVisible: Boolean(document.querySelector("#stop")?.offsetParent),
      phase: document.body.dataset.phase,
    }));
    const startupSession = await getSession(serviceWorker);
    console.log(JSON.stringify({ startupState, startupSession }, null, 2));


    const douyinOpened = context.waitForEvent("page", {
      timeout: 15000,
    });
    await workbench.click("#start");
    const douyin = await douyinOpened;
    await douyin.waitForURL(/^https:\/\/www\.douyin\.com\//, {
      timeout: 15000,
    });
    await douyin.waitForLoadState("domcontentloaded");

    await douyin.waitForFunction(
      () =>
        document
          .querySelector("#work-video-link-hud")
          ?.shadowRoot?.querySelector(".label")
          ?.textContent?.includes("联动中"),
      null,
      { timeout: 15000 },
    );

    await douyin.waitForFunction(() => window.scrollY > 10, null, {
      timeout: 15000,
    });
    await sleep(1500);

    const advancedSession = await waitFor(
      async () => {
        const session = await getSession(serviceWorker);
        return session?.active && session.count >= 2 ? session : null;
      },
      10000,
      "the second demo video",
    );

    await workbench.evaluate(() => document.querySelector("#finish").click());
    await waitFor(
      async () => (await workbench.evaluate(() => document.body.dataset.phase)) === "done",
      3000,
      "the workbench completion state",
    );
    await waitFor(
      async () => {
        const session = await getSession(serviceWorker);
        return session && !session.active ? session : null;
      },
      15000,
      "the paused demo session",
    );
    await waitFor(
      async () => {
        try {
          return (await workbench.evaluate(() => document.visibilityState)) === "visible";
        } catch (_) {
          return false;
        }
      },
      10000,
      "the workbench to regain focus",
    );

    await sleep(700);
    console.log(
      JSON.stringify(
        {
          ok: true,
          message: "Demo is running. Close the Edge window to stop it.",
          douyinUrl: douyin.url(),
          advancedCount: advancedSession.count,
          maxVideos: advancedSession.maxVideos,
          workbenchVisible: await workbench.evaluate(() => document.visibilityState),
        },
        null,
        2,
      ),
    );

    await new Promise((resolve) => context.once("close", resolve));
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
    const tempRoot = path.resolve(os.tmpdir());
    const resolvedProfile = path.resolve(userDataDir);
    if (resolvedProfile.startsWith(tempRoot + path.sep)) {
      await fs.rm(resolvedProfile, { recursive: true, force: true });
    }
  }
}

await main();
