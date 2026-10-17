(() => {
  "use strict";

  if (globalThis.__workVideoLinkDouyinLoaded) return;
  globalThis.__workVideoLinkDouyinLoaded = true;

  const POLL_MS = 240;
  const END_BUFFER_SECONDS = 0.45;
  const MIN_ADVANCE_GAP_MS = 900;

  const state = {
    session: null,
    active: false,
    limitReached: false,
    count: 1,
    currentVideo: null,
    currentKey: "",
    advancedKeys: new Set(),
    autoPlayAttempted: new WeakSet(),
    observedVideos: new WeakSet(),
    playPrompt: false,
    lastAdvanceAt: 0,
    recommendAttempts: 0,
    lastRecommendAttemptAt: 0,
    hud: null,
    hudLabel: null,
    hudButton: null,
    hudDot: null,
    hudTimer: null,
    limitSentFor: null,
  };

  const videoIds = new WeakMap();
  let nextVideoId = 1;

  function videoKey(video) {
    if (!videoIds.has(video)) {
      videoIds.set(video, nextVideoId);
      nextVideoId += 1;
    }
    const explicitId =
      video.getAttribute("data-e2e-vid") ||
      video.getAttribute("data-vid") ||
      video.closest("[data-e2e-vid]")?.getAttribute("data-e2e-vid") ||
      "";
    return [
      videoIds.get(video),
      explicitId,
      video.currentSrc || video.src || "",
      Number.isFinite(video.duration) ? video.duration.toFixed(2) : "",
    ].join("|");
  }

  function isVisible(element) {
    if (!(element instanceof HTMLElement)) return false;
    const style = getComputedStyle(element);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      Number(style.opacity) === 0
    ) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 8 && rect.height > 8;
  }

  function getVisibleArea(element) {
    const rect = element.getBoundingClientRect();
    const width = Math.max(
      0,
      Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0),
    );
    const height = Math.max(
      0,
      Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0),
    );
    return { width, height, area: width * height, rect };
  }

  function findVisibleLoginDialog() {
    const candidates = document.querySelectorAll(
      '[role="dialog"], .douyin_login_new_class, [class*="login" i]',
    );
    for (const dialog of candidates) {
      if (
        isVisible(dialog) &&
        /扫码登录|验证码登录|登录后免费畅享/.test(dialog.textContent || "")
      ) {
        return dialog;
      }
    }
    return null;
  }

  function findRecommendControl() {
    const candidates = document.querySelectorAll(
      'a, button, [role="button"], [role="tab"], li, [data-e2e*="recommend"]',
    );
    for (const element of candidates) {
      if (!isVisible(element) || element.disabled) continue;
      if ((element.textContent || "").trim() !== "推荐") continue;
      return (
        element.closest('a, button, [role="button"], [role="tab"], li') ||
        element
      );
    }
    return null;
  }

  function tryOpenRecommend() {
    const now = Date.now();
    if (now - state.lastRecommendAttemptAt < 2000) return true;
    if (state.recommendAttempts >= 4) return false;
    const control = findRecommendControl();
    if (!control) return false;

    state.recommendAttempts += 1;
    state.lastRecommendAttemptAt = now;
    control.click();
    return true;
  }

  function findActiveVideo() {
    let best = null;
    let bestScore = 0;

    for (const video of document.querySelectorAll("video")) {
      observeVideo(video);
      if (!isVisible(video)) continue;
      const visible = getVisibleArea(video);
      const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
      const areaRatio = visible.area / viewportArea;
      if (areaRatio < 0.16) continue;
      const centerDistance = Math.abs(
        visible.rect.top + visible.rect.height / 2 - window.innerHeight / 2,
      );
      const score =
        areaRatio * 5 +
        (video.paused ? 0 : 0.8) +
        Math.max(0, 0.4 - centerDistance / Math.max(1, window.innerHeight));
      if (score > bestScore) {
        best = video;
        bestScore = score;
      }
    }

    return best;
  }

  function observeVideo(video) {
    if (state.observedVideos.has(video)) return;
    state.observedVideos.add(video);

    video.addEventListener("ended", () => {
      if (video === state.currentVideo) maybeAdvance(video);
    });
    video.addEventListener("timeupdate", () => {
      if (video === state.currentVideo) maybeAdvance(video);
    });
  }

  async function tryPlay(video, force = false) {
    if (!video || state.limitReached || !state.active) return;
    if (!video.paused) {
      state.playPrompt = false;
      updateHud();
      return;
    }
    if (state.autoPlayAttempted.has(video) && !force) return;
    state.autoPlayAttempted.add(video);

    try {
      await video.play();
      state.playPrompt = false;
    } catch (_) {
      state.playPrompt = true;
    }
    updateHud();
  }

  function maybeAdvance(video) {
    if (!state.active || state.limitReached || !video) return;
    const key = videoKey(video);
    if (state.advancedKeys.has(key)) return;
    if (Date.now() - state.lastAdvanceAt < MIN_ADVANCE_GAP_MS) return;

    const ended =
      video.ended ||
      (Number.isFinite(video.duration) &&
        video.duration > 1 &&
        video.currentTime >= video.duration - END_BUFFER_SECONDS);

    if (!ended) return;

    if (state.count >= (state.session?.maxVideos || 1)) {
      reachLimit();
      return;
    }

    state.advancedKeys.add(key);
    state.lastAdvanceAt = Date.now();
    state.playPrompt = false;

    const moved = scrollToNextVideo(video);
    if (!moved) {
      updateHud("等待下一个视频");
      return;
    }

    state.count += 1;
    updateHud();
    sendRuntimeMessage({
      type: "VIDEO_ADVANCED",
      sessionId: state.session?.id,
      count: state.count,
    });
  }

  function reachLimit() {
    if (!state.active || state.limitReached) return;
    state.limitReached = true;
    state.playPrompt = false;
    pauseAllVideos();
    updateHud("已达上限");

    if (state.limitSentFor !== state.session?.id) {
      state.limitSentFor = state.session?.id || null;
      sendRuntimeMessage({
        type: "LIMIT_REACHED",
        sessionId: state.session?.id,
        count: state.count,
      });
    }
  }

  function findScrollContainer(video) {
    let node = video.parentElement;
    let best = null;

    while (node && node !== document.documentElement) {
      const style = getComputedStyle(node);
      const canScroll =
        (style.overflowY === "auto" || style.overflowY === "scroll") &&
        node.scrollHeight > node.clientHeight + 40;
      if (canScroll) {
        if (/y|both/.test(style.scrollSnapType || "")) return node;
        if (!best || node.clientHeight > best.clientHeight) best = node;
      }
      node = node.parentElement;
    }

    return best || document.scrollingElement || document.documentElement;
  }

  function findNextControl() {
    const candidates = document.querySelectorAll(
      'button, [role="button"], a[aria-label], a[title]',
    );
    for (const element of candidates) {
      if (!isVisible(element) || element.disabled) continue;
      const values = [
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        (element.textContent || "").trim(),
      ];
      if (values.some((value) => WorkLink.isLikelyNextControl(value))) {
        return element;
      }
    }
    return null;
  }

  function findNextPreloadedVideo(currentVideo) {
    const currentRect = currentVideo.getBoundingClientRect();
    const candidates = [];

    for (const video of document.querySelectorAll("video")) {
      if (video === currentVideo || !isVisible(video)) continue;
      const rect = video.getBoundingClientRect();
      if (rect.top <= currentRect.top + 20) continue;
      if (rect.width < window.innerWidth * 0.3) continue;
      if (rect.height < window.innerHeight * 0.2) continue;
      candidates.push({ video, top: rect.top });
    }

    candidates.sort((left, right) => left.top - right.top);
    return candidates[0]?.video || null;
  }

  function scrollToNextVideo(currentVideo) {
    const nextControl = findNextControl();
    if (nextControl) {
      nextControl.click();
      return true;
    }

    const nextVideo = findNextPreloadedVideo(currentVideo);
    if (nextVideo) {
      nextVideo.scrollIntoView({
        behavior: "smooth",
        block: "start",
        inline: "nearest",
      });
      return true;
    }

    const container = findScrollContainer(currentVideo);
    if (!container) return false;
    const distance = WorkLink.pickScrollDistance(
      currentVideo.getBoundingClientRect().height,
      window.innerHeight,
    );
    container.scrollBy({ top: distance, behavior: "smooth" });
    return true;
  }

  function pauseAllVideos() {
    for (const video of document.querySelectorAll("video")) {
      try {
        video.pause();
      } catch (_) {
        // Ignore detached or protected elements.
      }
    }
  }

  function ensureHud() {
    if (state.hud?.isConnected) return;

    const host = document.createElement("div");
    host.id = "work-video-link-hud";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .wrap {
          position: fixed;
          bottom: 18px;
          left: 18px;
          z-index: 2147483647;
          pointer-events: none;
          color: #f7f7f5;
          font: 600 13px/1.2 "Segoe UI", "Microsoft YaHei", sans-serif;
          letter-spacing: 0;
        }
        .panel {
          display: flex;
          align-items: center;
          gap: 9px;
          min-height: 38px;
          padding: 6px 7px 6px 12px;
          border: 1px solid rgba(255,255,255,.14);
          border-radius: 8px;
          background: rgba(19,21,23,.88);
          box-shadow: 0 8px 28px rgba(0,0,0,.28);
          backdrop-filter: blur(10px);
          pointer-events: auto;
        }
        .dot {
          width: 7px;
          height: 7px;
          flex: 0 0 7px;
          border-radius: 50%;
          background: #36c98f;
          box-shadow: 0 0 0 3px rgba(54,201,143,.14);
        }
        .panel.paused .dot { background: #a9afb5; box-shadow: none; }
        .panel.limit .dot { background: #f2b84b; box-shadow: 0 0 0 3px rgba(242,184,75,.14); }
        .label { white-space: nowrap; }
        button {
          width: 28px;
          height: 28px;
          display: grid;
          place-items: center;
          border: 0;
          border-radius: 6px;
          padding: 0;
          color: #f7f7f5;
          background: rgba(255,255,255,.1);
          cursor: pointer;
        }
        button:hover { background: rgba(255,255,255,.18); }
        button:focus-visible { outline: 2px solid #25f4ee; outline-offset: 2px; }
        svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 2; }
      </style>
      <div class="wrap">
        <div class="panel">
          <span class="dot"></span>
          <span class="label">准备播放</span>
          <button type="button" aria-label="暂停并返回工作台" title="暂停并返回工作台">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 11.5 12 3l9 8.5"></path>
              <path d="M5 10v10h14V10"></path>
              <path d="M9 20v-6h6v6"></path>
            </svg>
          </button>
        </div>
      </div>
    `;

    shadow.querySelector("button").addEventListener("click", () => {
      if (state.playPrompt) {
        state.playPrompt = false;
        updateHud();
        void tryPlay(state.currentVideo, true);
        return;
      }
      updateHud("正在返回");
      sendRuntimeMessage({
        type: "HUD_STOP",
        sessionId: state.session?.id,
        reason: "user",
      });
    });

    document.documentElement.appendChild(host);
    state.hud = host;
    state.hudLabel = shadow.querySelector(".label");
    state.hudButton = shadow.querySelector("button");
    state.hudDot = shadow.querySelector(".dot");
    state.hudPanel = shadow.querySelector(".panel");
  }

  function updateHud(overrideLabel = null) {
    if (!state.active && !overrideLabel) return;
    ensureHud();
    if (!state.hudLabel) return;

    const panel = state.hudPanel;
    panel.classList.toggle("paused", !state.active);
    panel.classList.toggle("limit", state.limitReached);

    let label = overrideLabel;
    if (!label) {
      if (!state.active) label = "已暂停";
      else if (state.limitReached) label = "已达上限";
      else if (state.playPrompt) label = "点击播放";
      else if (!state.currentVideo) label = "等待视频";
      else {
        const max = state.session?.maxVideos || 1;
        const workCount = Math.max(
          1,
          Number(state.session?.workSourceCount) || 1,
        );
        const videoProgress = `${Math.min(state.count, max)}/${max}`;
        label =
          workCount > 1
            ? `联动中 · ${workCount} 个对话 · ${videoProgress}`
            : `联动中 · ${videoProgress}`;
      }
    }

    if (state.hudLabel.textContent !== label) {
      state.hudLabel.textContent = label;
    }

    const buttonLabel = state.playPrompt
      ? "继续播放"
      : state.active
        ? "暂停并返回工作台"
        : "返回工作台";
    state.hudButton.setAttribute("aria-label", buttonLabel);
    state.hudButton.setAttribute("title", buttonLabel);

    if (state.playPrompt) {
      state.hudButton.innerHTML = `
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m8 5 11 7-11 7V5Z"></path>
        </svg>
      `;
    }
  }

  function scheduleHudRemoval(delayMs) {
    clearTimeout(state.hudTimer);
    state.hudTimer = setTimeout(() => {
      state.hud?.remove();
      state.hud = null;
      state.hudLabel = null;
      state.hudButton = null;
      state.hudPanel = null;
    }, delayMs);
  }

  function applySession(session) {
    const wasActive = state.active;
    const previousId = state.session?.id;

    if (session?.active) {
      if (session.id !== previousId) {
        state.advancedKeys = new Set();
        state.autoPlayAttempted = new WeakSet();
        state.currentVideo = null;
        state.currentKey = "";
        state.lastAdvanceAt = 0;
        state.recommendAttempts = 0;
        state.lastRecommendAttemptAt = 0;
        state.limitSentFor = null;
        state.playPrompt = false;
        clearTimeout(state.hudTimer);
      }

      state.session = session;
      state.active = true;
      state.count = Math.max(1, Number(session.count) || 1);
      state.limitReached = Boolean(session.limitReached);
      ensureHud();
      updateHud();

      if (state.limitReached) {
        pauseAllVideos();
      } else {
        tick();
      }
      return;
    }

    state.session = session || state.session;
    if (wasActive) {
      state.active = false;
      state.limitReached = Boolean(session?.limitReached);
      pauseAllVideos();
      updateHud("已暂停");
      scheduleHudRemoval(5000);
    }
  }

  function tick() {
    if (!state.active) return;

    if (findVisibleLoginDialog()) {
      state.currentVideo = null;
      state.currentKey = "";
      pauseAllVideos();
      updateHud("请先登录抖音");
      return;
    }

    if (location.pathname.includes("jingxuan")) {
      state.currentVideo = null;
      state.currentKey = "";
      pauseAllVideos();
      updateHud(tryOpenRecommend() ? "正在打开推荐" : "请打开推荐");
      return;
    }

    const video = findActiveVideo();
    if (!video) {
      state.currentVideo = null;
      state.currentKey = "";
      updateHud("等待视频");
      return;
    }

    const key = videoKey(video);
    if (key !== state.currentKey) {
      state.currentKey = key;
      state.currentVideo = video;
      state.playPrompt = false;
      state.autoPlayAttempted.delete(video);
      void tryPlay(video);
    } else {
      state.currentVideo = video;
      if (!video.paused && state.playPrompt) {
        state.playPrompt = false;
      }
    }

    updateHud();

    if (!state.limitReached) {
      maybeAdvance(video);
    }
  }

  function sendRuntimeMessage(message) {
    try {
      return chrome.runtime.sendMessage(message).catch(() => null);
    } catch (_) {
      return Promise.resolve(null);
    }
  }

  function handleStorageChange(changes, areaName) {
    if (areaName !== "session" || !changes.activeSession) return;
    applySession(changes.activeSession.newValue);
  }

  async function initialize() {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === "SESSION_STATE") {
        applySession(message.session);
        sendResponse({ ok: true });
      } else if (message?.type === "SESSION_STOP") {
        applySession({
          ...(state.session || {}),
          ...(message.sessionId ? { id: message.sessionId } : {}),
          active: false,
          phase: "completed",
        });
        sendResponse({ ok: true });
      }
    });

    chrome.storage.onChanged.addListener(handleStorageChange);

    try {
      const stored = await chrome.storage.session.get("activeSession");
      applySession(stored.activeSession || null);
    } catch (_) {
      const stateResponse = await sendRuntimeMessage({ type: "GET_STATE" });
      applySession(stateResponse?.session || null);
    }

    setInterval(tick, POLL_MS);
  }

  void initialize();
})();
