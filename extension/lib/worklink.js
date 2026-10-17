(function attachWorkLink(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.WorkLink = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createWorkLinkApi() {
  "use strict";

  const DEFAULT_SETTINGS = Object.freeze({
    autoLink: true,
    autoReturn: true,
    desktopLink: false,
    maxVideos: 12,
    videoMode: "web",
  });

  const WORKBENCH_HOSTS = new Set(["chatgpt.com", "chat.openai.com"]);
  const DOUYIN_HOSTS = new Set(["douyin.com", "www.douyin.com"]);
  const VIDEO_MODES = new Set(["web", "desktop"]);
  const CUSTOM_SOURCE_LIMIT = 20;
  const CUSTOM_STATE_ATTRIBUTE = "data-work-video-link-state";
  const CUSTOM_START_EVENT = "work-video-link:start";
  const CUSTOM_END_EVENT = "work-video-link:end";

  function normalizeMaxVideos(value, fallback = DEFAULT_SETTINGS.maxVideos) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(50, Math.max(1, Math.round(parsed)));
  }

  function normalizeVideoMode(value) {
    return VIDEO_MODES.has(value) ? value : DEFAULT_SETTINGS.videoMode;
  }

  function normalizeHttpOrigin(value, baseUrl = undefined) {
    try {
      const url = new URL(String(value || "").trim(), baseUrl);
      if (!["http:", "https:"].includes(url.protocol)) return null;
      return url.origin;
    } catch (_) {
      return null;
    }
  }

  function hashText(value) {
    let hash = 2166136261;
    for (const character of String(value)) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function normalizeCustomSource(value, index = 0) {
    const input = value && typeof value === "object" ? value : {};
    const origin = normalizeHttpOrigin(input.origin || input.url);
    if (!origin) return null;

    const hostname = new URL(origin).hostname.replace(/^www\./, "");
    const name =
      String(input.name || "").trim().slice(0, 48) || hostname || `AI ${index + 1}`;
    const selector = String(input.selector || "").trim().slice(0, 1000);
    const rawId = String(input.id || "").trim();
    const id = /^[a-zA-Z0-9_-]{1,80}$/.test(rawId)
      ? rawId
      : `custom-${hashText(origin)}`;

    return {
      id,
      name,
      origin,
      selector,
      enabled: input.enabled !== false,
    };
  }

  function normalizeCustomSources(value) {
    if (!Array.isArray(value)) return [];
    const sources = [];
    const seenOrigins = new Set();
    for (const [index, item] of value.entries()) {
      const source = normalizeCustomSource(item, index);
      if (!source || seenOrigins.has(source.origin)) continue;
      seenOrigins.add(source.origin);
      sources.push(source);
      if (sources.length >= CUSTOM_SOURCE_LIMIT) break;
    }
    return sources;
  }

  function findCustomSource(value, sources) {
    const origin = normalizeHttpOrigin(value);
    if (!origin) return null;
    return (
      normalizeCustomSources(sources).find(
        (source) => source.enabled && source.origin === origin,
      ) || null
    );
  }

  function isCustomSourceUrl(value, sources) {
    return Boolean(findCustomSource(value, sources));
  }

  function normalizeSettings(value) {
    const input = value && typeof value === "object" ? value : {};
    return {
      autoLink: input.autoLink !== false,
      autoReturn: input.autoReturn !== false,
      desktopLink: input.desktopLink === true,
      maxVideos: normalizeMaxVideos(input.maxVideos),
      videoMode: normalizeVideoMode(input.videoMode),
    };
  }

  function isSupportedWorkbenchUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && WORKBENCH_HOSTS.has(url.hostname);
    } catch (_) {
      return false;
    }
  }

  function isDouyinUrl(value) {
    try {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        (DOUYIN_HOSTS.has(url.hostname) || url.hostname.endsWith(".douyin.com"))
      );
    } catch (_) {
      return false;
    }
  }

  function isLikelyStopControl(value) {
    const input = value && typeof value === "object" ? value : {};
    const haystack = [input.label, input.title, input.text, input.testId]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    if (!haystack) return false;
    if (/stop listening|停止收听|stop audio/.test(haystack)) return false;

    return /(^|[\s_-])stop(?:\s+(?:generating|streaming|response))?($|[\s_-])/.test(
      haystack,
    ) || /停止(?:生成|回答|回复|输出)?/.test(haystack);
  }

  function isLikelyNextControl(value) {
    const text = String(value || "").trim().toLowerCase();
    if (!text) return false;
    return /^(next(?:\s+(?:video|short))?|下一(?:个|条)(?:视频)?|下一个视频)$/.test(
      text,
    );
  }

  function pickScrollDistance(videoHeight, viewportHeight) {
    const height = Number(videoHeight);
    const viewport = Number(viewportHeight);
    const safeViewport = Number.isFinite(viewport) && viewport > 0 ? viewport : 800;
    if (!Number.isFinite(height) || height <= 0) return safeViewport * 0.9;
    return Math.max(240, Math.min(safeViewport * 0.95, height * 0.94));
  }

  function createSessionId() {
    if (
      typeof globalThis.crypto !== "undefined" &&
      typeof globalThis.crypto.randomUUID === "function"
    ) {
      return globalThis.crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  return {
    DEFAULT_SETTINGS,
    CUSTOM_END_EVENT,
    CUSTOM_SOURCE_LIMIT,
    CUSTOM_START_EVENT,
    CUSTOM_STATE_ATTRIBUTE,
    createSessionId,
    findCustomSource,
    isCustomSourceUrl,
    isDouyinUrl,
    isLikelyNextControl,
    isLikelyStopControl,
    isSupportedWorkbenchUrl,
    normalizeCustomSource,
    normalizeCustomSources,
    normalizeHttpOrigin,
    normalizeMaxVideos,
    normalizeSettings,
    normalizeVideoMode,
    pickScrollDistance,
  };
});
