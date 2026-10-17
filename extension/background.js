importScripts("./lib/worklink.js", "./lib/codex-bridge.js");

const {
  createSessionId,
  findCustomSource,
  isDouyinUrl,
  isSupportedWorkbenchUrl,
  normalizeCustomSources,
  normalizeMaxVideos,
  normalizeSettings,
  normalizeVideoMode,
} = WorkLink;

const SETTINGS_KEY = "settings";
const SESSION_KEY = "activeSession";
const LAST_WORKBENCH_KEY = "lastWorkbenchTabId";
const WORK_SOURCES_KEY = "activeWorkSources";
const CUSTOM_SOURCES_KEY = "customSources";
const WORKBENCH_URL_PATTERNS = [
  "https://chatgpt.com/*",
  "https://chat.openai.com/*",
];
const DOUYIN_URL_PATTERNS = [
  "https://douyin.com/*",
  "https://www.douyin.com/*",
  "https://*.douyin.com/*",
];
const VIDEO_HOME_URL = "https://www.douyin.com/?recommend=1";
const DESKTOP_APP_BASE = "http://127.0.0.1:17321/douyin";
const CODEX_ACTIVATE_BASE = "http://127.0.0.1:9229";
const DESKTOP_BRIDGE_URL = "ws://127.0.0.1:17321/ws";
const DESKTOP_SUPPRESS_KEY = "desktopSuppressUntilIdle";
const AVAILABILITY_CACHE_MS = 20000;
const WEB_AVAILABILITY_TIMEOUT_MS = 5000;
const DESKTOP_AVAILABILITY_TIMEOUT_MS = 6000;
const CUSTOM_AI_SCRIPT_FILES = ["lib/worklink.js", "custom-ai.js"];

const sessionArea = chrome.storage.session || chrome.storage.local;
const SESSION_STORAGE_AREA = chrome.storage.session ? "session" : "local";
let startInFlight = null;
let desktopBridge = null;
let desktopLastWorking = null;
let desktopAvailable = null;
let desktopStatusQueue = Promise.resolve();
let desktopUnavailableTimer = null;
let workSourceQueue = Promise.resolve();
let finishInFlight = null;
const videoAvailability = {
  web: {
    available: null,
    checking: false,
    checkedAt: null,
    reason: "正在检测抖音页面",
  },
  desktop: {
    available: null,
    checking: false,
    checkedAt: null,
    reason: "正在检测电脑端抖音",
    bridgeAvailable: null,
    protocolRegistered: null,
    executablePath: "",
    executableExists: null,
    appRunning: null,
    windowFound: null,
  },
};
const availabilityRequests = new Map();

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function queueWorkSourceMutation(task) {
  const queued = workSourceQueue.then(task, task);
  workSourceQueue = queued.catch(() => {});
  return queued;
}

function browserWorkSourceId(tabId) {
  return Number.isInteger(tabId) ? `browser:${tabId}` : null;
}

async function callDesktopBridge(
  path,
  method = "GET",
  timeoutMs = 25000,
) {
  let response;
  try {
    response = await fetch(`${DESKTOP_APP_BASE}${path}`, {
      method,
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const timedOut = ["AbortError", "TimeoutError"].includes(error?.name);
    throw new Error(
      timedOut
        ? "本地桥响应超时，请重启本地桥"
        : "本地桥未连接，请先启动本地桥",
    );
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch (_) {
    // The bridge always returns JSON; keep a useful fallback for older builds.
  }
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error || `电脑端抖音控制失败 (${response.status})`);
  }
  return payload || { ok: true };
}

function cloneAvailabilityStatus(status) {
  return { ...status };
}

function availabilitySnapshot() {
  const web = cloneAvailabilityStatus(videoAvailability.web);
  const desktop = cloneAvailabilityStatus(videoAvailability.desktop);
  const timestamps = [web.checkedAt, desktop.checkedAt].filter(Number.isFinite);
  return {
    checking: web.checking || desktop.checking,
    checkedAt: timestamps.length ? Math.max(...timestamps) : null,
    web,
    desktop,
  };
}

function isAvailabilityFresh(status, maxAgeMs = AVAILABILITY_CACHE_MS) {
  return Boolean(
    status &&
      typeof status.available === "boolean" &&
      Number.isFinite(status.checkedAt) &&
      Date.now() - status.checkedAt < maxAgeMs,
  );
}

async function checkWebAvailability() {
  try {
    const response = await fetch(VIDEO_HOME_URL, {
      cache: "no-store",
      credentials: "omit",
      signal: AbortSignal.timeout(WEB_AVAILABILITY_TIMEOUT_MS),
    });
    if (!response.ok) {
      return {
        available: false,
        reason: `抖音页面返回 HTTP ${response.status}`,
      };
    }

    const existingTabs = await chrome.tabs
      .query({ url: DOUYIN_URL_PATTERNS })
      .catch(() => []);
    return {
      available: true,
      reason: existingTabs.length
        ? "抖音页面可访问，已有打开的标签页"
        : "抖音页面可访问",
    };
  } catch (error) {
    const timedOut = ["AbortError", "TimeoutError"].includes(error?.name);
    return {
      available: false,
      reason: timedOut
        ? "连接抖音超时，请检查网络或代理"
        : "无法访问抖音页面，请检查网络或代理",
    };
  }
}

async function checkDesktopAvailability() {
  try {
    const payload = await callDesktopBridge(
      "/status",
      "GET",
      DESKTOP_AVAILABILITY_TIMEOUT_MS,
    );
    if (typeof payload.available !== "boolean") {
      return {
        available: false,
        reason: "本地桥版本过旧，请重启或重新安装本地桥",
        bridgeAvailable: true,
        protocolRegistered: null,
        executablePath: "",
        executableExists: null,
        appRunning: null,
        windowFound: null,
      };
    }
    return {
      available: payload.available,
      reason:
        payload.reason ||
        (payload.available ? "电脑端抖音可用" : "电脑端抖音不可用"),
      bridgeAvailable: true,
      protocolRegistered: payload.protocolRegistered === true,
      executablePath: payload.executablePath || "",
      executableExists: payload.executableExists === true,
      appRunning: payload.appRunning === true,
      windowFound: payload.windowFound === true,
    };
  } catch (error) {
    return {
      available: false,
      reason: error instanceof Error ? error.message : String(error),
      bridgeAvailable: false,
      protocolRegistered: null,
      executablePath: "",
      executableExists: null,
      appRunning: null,
      windowFound: null,
    };
  }
}

function checkVideoMode(mode, force = false) {
  const status = videoAvailability[mode];
  if (!status) return Promise.reject(new Error("未知视频端"));
  if (!force && isAvailabilityFresh(status)) {
    return Promise.resolve(cloneAvailabilityStatus(status));
  }
  if (availabilityRequests.has(mode)) {
    return availabilityRequests.get(mode);
  }

  status.checking = true;
  if (status.available === null) {
    status.reason =
      mode === "web" ? "正在检测抖音页面" : "正在检测电脑端抖音";
  }

  const request = (mode === "web"
    ? checkWebAvailability()
    : checkDesktopAvailability())
    .then((result) => {
      Object.assign(status, result, {
        checking: false,
        checkedAt: Date.now(),
      });
      return cloneAvailabilityStatus(status);
    })
    .catch((error) => {
      Object.assign(status, {
        available: false,
        checking: false,
        checkedAt: Date.now(),
        reason: error instanceof Error ? error.message : String(error),
      });
      return cloneAvailabilityStatus(status);
    })
    .finally(() => {
      availabilityRequests.delete(mode);
    });

  availabilityRequests.set(mode, request);
  return request;
}

async function getVideoAvailability({
  force = false,
  modes = ["web", "desktop"],
} = {}) {
  const requestedModes = [...new Set(modes)].filter((mode) =>
    Object.hasOwn(videoAvailability, mode),
  );
  await Promise.all(
    requestedModes.map((mode) => checkVideoMode(mode, force)),
  );
  return availabilitySnapshot();
}

function refreshStaleAvailability() {
  const modes = Object.keys(videoAvailability).filter(
    (mode) => !isAvailabilityFresh(videoAvailability[mode]),
  );
  if (!modes.length) return;
  void getVideoAvailability({ modes }).catch((error) => {
    console.warn("Unable to refresh video availability", error);
  });
}

async function configureSessionStorage() {
  if (
    chrome.storage.session &&
    typeof chrome.storage.session.setAccessLevel === "function"
  ) {
    await chrome.storage.session.setAccessLevel({
      accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS",
    });
  }
}

async function getSettings() {
  const stored = await chrome.storage.sync.get(SETTINGS_KEY);
  return normalizeSettings(stored[SETTINGS_KEY]);
}

async function getCustomSources() {
  const stored = await chrome.storage.sync.get(CUSTOM_SOURCES_KEY);
  return normalizeCustomSources(stored[CUSTOM_SOURCES_KEY]);
}

async function ensureSettings() {
  const stored = await chrome.storage.sync.get(SETTINGS_KEY);
  const normalized = normalizeSettings(stored[SETTINGS_KEY]);
  if (
    !stored[SETTINGS_KEY] ||
    JSON.stringify(normalized) !== JSON.stringify(stored[SETTINGS_KEY])
  ) {
    await chrome.storage.sync.set({ [SETTINGS_KEY]: normalized });
  }
}

async function getSession() {
  const stored = await sessionArea.get(SESSION_KEY);
  return stored[SESSION_KEY] || null;
}

async function saveSession(session) {
  await sessionArea.set({ [SESSION_KEY]: session });
}

function normalizeWorkSources(value) {
  if (!Array.isArray(value)) return [];
  const sourcesById = new Map();
  for (const source of value) {
    if (
      !source ||
      typeof source.id !== "string" ||
      !["browser", "desktop"].includes(source.kind)
    ) {
      continue;
    }
    sourcesById.set(source.id, {
      id: source.id,
      kind: source.kind,
      tabId: Number.isInteger(source.tabId) ? source.tabId : null,
      windowId: Number.isInteger(source.windowId)
        ? source.windowId
        : null,
      startedAt: Number.isFinite(source.startedAt)
        ? source.startedAt
        : Date.now(),
    });
  }
  return [...sourcesById.values()];
}

async function readWorkSources() {
  const stored = await sessionArea.get(WORK_SOURCES_KEY);
  return normalizeWorkSources(stored[WORK_SOURCES_KEY]);
}

async function syncSessionWorkSources(sources) {
  const session = await getSession();
  if (!session?.active) return session;

  const browserSources = sources.filter(
    (source) => source.kind === "browser" && Number.isInteger(source.tabId),
  );
  const currentPrimary = browserSources.find(
    (source) => source.tabId === session.workbenchTabId,
  );
  const primarySource = currentPrimary || browserSources.at(-1) || null;
  let workbenchTabId = primarySource?.tabId ?? null;
  if (!workbenchTabId && !sources.length) {
    workbenchTabId = session.workbenchTabId || null;
  }
  const primaryTab = await safeGetTab(workbenchTabId);
  const workSourceIds = sources.map((source) => source.id);
  const updated = {
    ...session,
    workbenchTabId,
    workbenchWindowId:
      primaryTab?.windowId ?? (workbenchTabId ? session.workbenchWindowId : null),
    workSourceIds,
    workSourceCount: workSourceIds.length,
  };
  await saveSession(updated);
  await updateBadge(updated);
  if (Number.isInteger(updated.douyinTabId)) {
    void sendToTab(updated.douyinTabId, {
      type: "SESSION_STATE",
      session: updated,
    }).catch(() => null);
  }
  return updated;
}

async function persistWorkSources(sources) {
  const normalized = normalizeWorkSources(sources);
  await sessionArea.set({ [WORK_SOURCES_KEY]: normalized });
  await syncSessionWorkSources(normalized);
  return normalized;
}

async function getWorkSources() {
  return queueWorkSourceMutation(readWorkSources);
}

async function addWorkSource(source) {
  return queueWorkSourceMutation(async () => {
    const sources = await readWorkSources();
    const existingIndex = sources.findIndex(
      (item) => item.id === source.id,
    );
    const normalizedSource = normalizeWorkSources([source])[0];
    if (!normalizedSource) return sources;
    if (existingIndex >= 0) {
      sources[existingIndex] = {
        ...normalizedSource,
        startedAt: sources[existingIndex].startedAt,
      };
    } else {
      sources.push(normalizedSource);
    }
    return persistWorkSources(sources);
  });
}

async function removeWorkSource(sourceId) {
  return queueWorkSourceMutation(async () => {
    const sources = await readWorkSources();
    return persistWorkSources(
      sources.filter((source) => source.id !== sourceId),
    );
  });
}

async function clearWorkSources() {
  return queueWorkSourceMutation(async () => {
    await sessionArea.set({ [WORK_SOURCES_KEY]: [] });
    return [];
  });
}

async function finishSessionForWorkEnd({
  reason,
  fromTabId = null,
}) {
  const decision = await queueWorkSourceMutation(async () => {
    const sources = await readWorkSources();
    const session = await getSession();
    return { sources, session };
  });
  const { sources, session } = decision;

  if (!session?.active) {
    return { ok: true, session, workSourceCount: sources.length };
  }
  if (!["auto", "desktop"].includes(session.reason)) {
    return { ok: true, session, waitingForManualStop: true };
  }
  return finishSession({
    sessionId: session.id,
    reason,
    fromTabId,
  });
}

async function rememberWorkbench(tabId) {
  if (Number.isInteger(tabId)) {
    await chrome.storage.local.set({ [LAST_WORKBENCH_KEY]: tabId });
  }
}

async function getLastWorkbenchTabId() {
  const stored = await chrome.storage.local.get(LAST_WORKBENCH_KEY);
  return Number.isInteger(stored[LAST_WORKBENCH_KEY])
    ? stored[LAST_WORKBENCH_KEY]
    : null;
}

async function safeGetTab(tabId) {
  if (!Number.isInteger(tabId)) return null;
  try {
    return await chrome.tabs.get(tabId);
  } catch (_) {
    return null;
  }
}

async function resolveWorkbenchTab(tabId, reason) {
  const candidate = await safeGetTab(tabId);
  const customSource = candidate
    ? findCustomSource(candidate.url, await getCustomSources())
    : null;
  if (
    candidate &&
    !isDouyinUrl(candidate.url) &&
    (reason === "manual" ||
      isSupportedWorkbenchUrl(candidate.url) ||
      Boolean(customSource))
  ) {
    return candidate;
  }

  if (reason === "auto") return null;

  const lastId = await getLastWorkbenchTabId();
  const lastTab = await safeGetTab(lastId);
  if (lastTab && !isDouyinUrl(lastTab.url)) return lastTab;

  const workbenchTabs = await chrome.tabs.query({
    url: WORKBENCH_URL_PATTERNS,
  });
  return (
    workbenchTabs.find((tab) => tab.active) ||
    workbenchTabs[0] ||
    null
  );
}

async function updateBadge(session) {
  try {
    if (session?.active) {
      await chrome.action.setBadgeBackgroundColor({ color: "#E5484D" });
      await chrome.action.setBadgeText({
        text: session.limitReached ? "MAX" : "ON",
      });
      await chrome.action.setTitle({
        title: session.limitReached
          ? "视频工作联动：已达上限，等待 AI 完成"
          : session.workSourceCount > 1
            ? `视频工作联动：${session.workSourceCount} 个对话进行中`
            : "视频工作联动：进行中",
      });
      return;
    }

    await chrome.action.setBadgeText({ text: "" });
    await chrome.action.setTitle({ title: "视频工作联动" });
  } catch (error) {
    console.warn("Unable to update extension badge", error);
  }
}

async function focusTab(tabId) {
  if (!Number.isInteger(tabId)) return false;
  try {
    const tab = await chrome.tabs.get(tabId);
    await chrome.tabs.update(tabId, { active: true });
    if (Number.isInteger(tab.windowId)) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    return true;
  } catch (_) {
    return false;
  }
}

async function sendToTab(tabId, message, timeoutMs = 900) {
  if (!Number.isInteger(tabId)) {
    throw new Error("No target tab");
  }

  let timer;
  try {
    return await Promise.race([
      chrome.tabs.sendMessage(tabId, message),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Tab response timed out")), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function syncCustomAiTab(tab, { source = null } = {}) {
  if (!Number.isInteger(tab?.id) || !tab.url) return false;
  const resolvedSource =
    source || findCustomSource(tab.url, await getCustomSources());
  if (!resolvedSource || !findCustomSource(tab.url, [resolvedSource])) {
    return false;
  }

  let connected = false;
  try {
    const response = await sendToTab(
      tab.id,
      { type: "CUSTOM_AI_PING" },
      700,
    );
    connected = response?.ok === true;
  } catch (_) {
    connected = false;
  }

  if (!connected) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: CUSTOM_AI_SCRIPT_FILES,
      });
    } catch (error) {
      console.warn("Unable to inject custom AI adapter", error);
      return false;
    }
  }

  try {
    const configured = await sendToTab(
      tab.id,
      {
        type: "CUSTOM_AI_CONFIG",
        source: resolvedSource,
      },
      1200,
    );
    return configured?.ok === true;
  } catch (_) {
    return false;
  }
}

async function syncCustomAiTabs({ disableMissing = false } = {}) {
  const [sources, tabs] = await Promise.all([
    getCustomSources(),
    chrome.tabs.query({}),
  ]);
  if (!sources.length && !disableMissing) return;
  await Promise.all(
    tabs.map(async (tab) => {
      const source = findCustomSource(tab.url, sources);
      if (source) {
        await syncCustomAiTab(tab, { source });
      } else if (disableMissing) {
        await sendToTab(
          tab.id,
          { type: "CUSTOM_AI_CONFIG", source: null },
          350,
        ).catch(() => null);
      }
    }),
  );
}

async function testCustomSource(rawSource) {
  const source = normalizeCustomSources([rawSource])[0];
  if (!source) {
    return { ok: false, error: "请输入有效的 http 或 https 网站地址" };
  }

  const originPattern = `${source.origin}/*`;
  const granted = await chrome.permissions.contains({
    origins: [originPattern],
  });
  if (!granted) {
    return { ok: false, error: "尚未授权访问该网站" };
  }

  const tabs = await chrome.tabs.query({});
  const matchingTabs = tabs.filter(
    (tab) => findCustomSource(tab.url, [source]) !== null,
  );
  const tab = matchingTabs.find((item) => item.active) || matchingTabs[0];
  if (!tab?.id) {
    return { ok: false, error: "请先在该网站打开一个标签页" };
  }

  const connected = await syncCustomAiTab(tab, { source });
  let selectorMatches = null;
  if (connected && source.selector) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (selector) => {
          try {
            return [...document.querySelectorAll(selector)].some((element) => {
              const style = getComputedStyle(element);
              const rect = element.getBoundingClientRect();
              return (
                style.display !== "none" &&
                style.visibility !== "hidden" &&
                Number(style.opacity) !== 0 &&
                rect.width > 4 &&
                rect.height > 4
              );
            });
          } catch (_) {
            return false;
          }
        },
        args: [source.selector],
      });
      selectorMatches = results[0]?.result === true;
    } catch (_) {
      selectorMatches = false;
    }
  }

  return {
    ok: connected,
    error: connected ? null : "页面适配脚本未能连接，请重新加载页面后重试",
    tabId: tab.id,
    title: tab.title || "",
    url: tab.url || "",
    selectorMatches,
  };
}

async function forcePauseVideoTab(tabId) {
  if (!Number.isInteger(tabId)) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        document.querySelectorAll("video").forEach((video) => {
          try {
            video.pause();
          } catch (_) {
            // Ignore detached or protected media elements.
          }
        });
      },
    });
  } catch (_) {
    // The tab may already be closed or navigating.
  }
}

async function notifyDouyin(tabId, session) {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    try {
      const response = await sendToTab(tabId, {
        type: "SESSION_STATE",
        session,
      });
      if (response?.ok) return true;
    } catch (_) {
      // The content script may still be loading on a newly created tab.
    }
    await delay(250);
  }
  return false;
}

async function findDouyinTab(workbenchWindowId) {
  const tabs = await chrome.tabs.query({ url: DOUYIN_URL_PATTERNS });
  if (!tabs.length) return null;

  return (
    tabs.find(
      (tab) =>
        tab.windowId === workbenchWindowId && !tab.discarded && !tab.hidden,
    ) ||
    tabs.find((tab) => !tab.discarded) ||
    tabs[0]
  );
}

async function openDouyin(session) {
  const workbench = await safeGetTab(session.workbenchTabId);
  let tab = await findDouyinTab(workbench?.windowId);

  if (tab?.id) {
    await chrome.tabs.update(tab.id, { active: true });
    tab = await chrome.tabs.get(tab.id);
  } else {
    const createProperties = {
      url: VIDEO_HOME_URL,
      active: true,
    };
    if (Number.isInteger(workbench?.windowId)) {
      createProperties.windowId = workbench.windowId;
    }
    tab = await chrome.tabs.create(createProperties);
  }

  if (Number.isInteger(tab.windowId)) {
    await chrome.windows.update(tab.windowId, { focused: true });
  }

  return tab;
}

async function activateCodexDesktop(targetId) {
  try {
    let resolvedTargetId = targetId;
    if (!resolvedTargetId) {
      const response = await fetch(`${CODEX_ACTIVATE_BASE}/json/list`, {
        cache: "no-store",
      });
      if (!response.ok) return false;
      const targets = await response.json();
      resolvedTargetId = targets.find(
        (target) =>
          target.type === "page" && target.url.startsWith("app://-/"),
      )?.id;
    }
    if (!resolvedTargetId) return false;
    const response = await fetch(
      `${CODEX_ACTIVATE_BASE}/json/activate/${encodeURIComponent(resolvedTargetId)}`,
      { cache: "no-store" },
    );
    return response.ok;
  } catch (_) {
    return false;
  }
}

async function setDesktopSuppressed(value) {
  await chrome.storage.local.set({ [DESKTOP_SUPPRESS_KEY]: Boolean(value) });
}

async function isDesktopSuppressed() {
  const stored = await chrome.storage.local.get(DESKTOP_SUPPRESS_KEY);
  return stored[DESKTOP_SUPPRESS_KEY] === true;
}

function clearDesktopUnavailableTimer() {
  clearTimeout(desktopUnavailableTimer);
  desktopUnavailableTimer = null;
}

function scheduleDesktopUnavailableCompletion() {
  if (desktopUnavailableTimer) return;
  desktopUnavailableTimer = setTimeout(async () => {
    desktopUnavailableTimer = null;
    await removeWorkSource("desktop");
    await finishSessionForWorkEnd({ reason: "desktop-bridge-lost" });
    desktopLastWorking = null;
  }, 10000);
}

async function handleDesktopStatus(status) {
  if (!status || status.type !== "codex-status") return;
  const settings = await getSettings();
  if (!settings.desktopLink) return;

  if (!status.available) {
    desktopAvailable = false;
    scheduleDesktopUnavailableCompletion();
    return;
  }

  desktopAvailable = true;
  clearDesktopUnavailableTimer();
  const working = Boolean(status.working);
  const previousWorking = desktopLastWorking;
  desktopLastWorking = working;

  if (!working) {
    await setDesktopSuppressed(false);
    await removeWorkSource("desktop");
    await finishSessionForWorkEnd({ reason: "desktop-generation-complete" });
    return;
  }

  if (await isDesktopSuppressed()) return;
  await addWorkSource({
    id: "desktop",
    kind: "desktop",
    startedAt: Date.now(),
  });
  if (previousWorking === true) {
    const session = await getSession();
    if (session?.active) return;
  }
  const session = await getSession();
  if (session?.active) return;
  await startSession({
    reason: "desktop",
    desktopTargetId: status.targetId || null,
  });
}

function queueDesktopStatus(status) {
  desktopStatusQueue = desktopStatusQueue
    .then(() => handleDesktopStatus(status))
    .catch((error) => {
      console.warn("Codex desktop status handling failed", error);
    });
}

async function configureDesktopMonitor(settings) {
  if (settings.desktopLink || settings.videoMode === "desktop") {
    if (desktopBridge) return;
    desktopBridge = CodexBridge.createCodexBridge({
      url: DESKTOP_BRIDGE_URL,
      onConnectionChange: (connected) => {
        if (connected) {
          clearDesktopUnavailableTimer();
        } else {
          desktopAvailable = null;
          scheduleDesktopUnavailableCompletion();
        }
      },
      onMessage: queueDesktopStatus,
    });
    desktopBridge.start();
    return;
  }

  clearDesktopUnavailableTimer();
  desktopBridge?.stop();
  desktopBridge = null;
  clearDesktopUnavailableTimer();
  desktopLastWorking = null;
  desktopAvailable = null;
  await setDesktopSuppressed(false);

  await removeWorkSource("desktop");
  await finishSessionForWorkEnd({ reason: "desktop-disabled" });
}

async function startSession({
  workbenchTabId,
  reason = "manual",
  desktopTargetId = null,
  videoMode = null,
}) {
  if (startInFlight) return startInFlight;

  startInFlight = (async () => {
    const current = await getSession();
    if (current?.active) {
      return { ok: true, session: current, alreadyActive: true };
    }

    const settings = await getSettings();
    if (reason === "auto" && !settings.autoLink) {
      return { ok: false, reason: "auto-disabled" };
    }

    const resolvedVideoMode = normalizeVideoMode(
      videoMode || settings.videoMode,
    );

    const availability = await getVideoAvailability({
      force: true,
      modes: [resolvedVideoMode],
    });
    const selectedAvailability = availability[resolvedVideoMode];
    if (selectedAvailability?.available !== true) {
      const modeLabel = resolvedVideoMode === "desktop" ? "电脑端 App" : "网页版抖音";
      return {
        ok: false,
        reason: "video-unavailable",
        error: `${modeLabel}不可用：${
          selectedAvailability?.reason || "未通过可用性检测"
        }`,
        availability,
      };
    }

    const workbench =
      reason === "desktop" ? null : await resolveWorkbenchTab(workbenchTabId, reason);
    if (workbench?.id) {
      await rememberWorkbench(workbench.id);
    }
    const workSources = await getWorkSources();
    if (["auto", "desktop"].includes(reason) && !workSources.length) {
      return { ok: false, reason: "work-finished-before-start" };
    }

    const session = {
      id: createSessionId(),
      active: true,
      phase: "starting",
      reason,
      videoMode: resolvedVideoMode,
      startedAt: Date.now(),
      endedAt: null,
      endReason: null,
      workSourceIds: workSources.map((source) => source.id),
      workSourceCount: workSources.length,
      workbenchTabId: workbench?.id || null,
      workbenchWindowId: workbench?.windowId ?? null,
      douyinTabId: null,
      douyinWindowId: null,
      desktopAppProcessId: null,
      desktopPauseFailed: false,
      desktopPlaybackState: null,
      desktopPlaybackVerified: false,
      desktopPlaybackControlAttempts: 0,
      desktopTargetId: reason === "desktop" ? desktopTargetId : null,
      workbenchKind: reason === "desktop" ? "desktop" : workbench ? "browser" : "none",
      count: 1,
      maxVideos: normalizeMaxVideos(settings.maxVideos),
      limitReached: false,
      lastError: null,
    };

    await saveSession(session);
    await updateBadge(session);

    try {
      let douyinTab = null;
      let desktopApp = null;

      if (resolvedVideoMode === "desktop") {
        desktopApp = await callDesktopBridge("/open", "POST");
      } else {
        douyinTab = await openDouyin(session);
      }

      const latest = await getSession();
      if (!latest || latest.id !== session.id || !latest.active) {
        if (douyinTab) {
          await sendToTab(
            douyinTab.id,
            {
              type: "SESSION_STOP",
              sessionId: session.id,
              reason: "session-cancelled",
            },
            1200,
          ).catch(() => null);
          await forcePauseVideoTab(douyinTab.id);
        }
        if (desktopApp) {
          await callDesktopBridge("/pause", "POST").catch(() => null);
        }
        if (Number.isInteger(latest?.workbenchTabId)) {
          await focusTab(latest.workbenchTabId);
        }
        return { ok: true, session: latest, alreadyFinished: true };
      }

      session.douyinTabId = douyinTab?.id || null;
      session.douyinWindowId = douyinTab?.windowId ?? null;
      session.desktopAppProcessId = desktopApp?.processId || null;
      session.desktopPlaybackState = desktopApp?.playbackState || null;
      session.desktopPlaybackVerified =
        desktopApp?.playbackVerified === true;
      session.desktopPlaybackControlAttempts =
        desktopApp?.playbackControlAttempts ?? 0;
      session.phase = "active";
      await saveSession(session);
      await updateBadge(session);
      if (douyinTab) await notifyDouyin(douyinTab.id, session);
      return { ok: true, session };
    } catch (error) {
      const failed = {
        ...session,
        active: false,
        phase: "error",
        endedAt: Date.now(),
        endReason: "launch-error",
        workSourceIds: [],
        workSourceCount: 0,
        lastError: error instanceof Error ? error.message : String(error),
      };
      await clearWorkSources();
      await saveSession(failed);
      await updateBadge(failed);
      if (workbench?.id) await focusTab(workbench.id);
      if (reason === "desktop") await activateCodexDesktop(desktopTargetId);
      return { ok: false, error: failed.lastError, session: failed };
    }
  })();

  try {
    return await startInFlight;
  } finally {
    startInFlight = null;
  }
}

async function finishSession(options = {}) {
  if (finishInFlight) return finishInFlight;

  finishInFlight = finishSessionOnce(options);
  try {
    return await finishInFlight;
  } finally {
    finishInFlight = null;
  }
}

async function finishSessionOnce({
  sessionId = null,
  reason = "manual",
  fromTabId = null,
} = {}) {
  const session = await getSession();
  if (!session?.active) return { ok: true, session, alreadyFinished: true };
  if (sessionId && session.id !== sessionId) {
    return { ok: false, reason: "session-mismatch" };
  }

  await clearWorkSources();

  await sendToTab(
    session.douyinTabId,
    {
      type: "SESSION_STOP",
      sessionId: session.id,
      reason,
    },
    1200,
  ).catch(() => null);

  await forcePauseVideoTab(session.douyinTabId);

  let pauseError = null;
  let pauseResult = null;
  if (session.videoMode === "desktop") {
    try {
      pauseResult = await callDesktopBridge("/pause", "POST");
    } catch (error) {
      pauseError =
        error instanceof Error ? error.message : String(error);
    }
  }

  const finished = {
    ...session,
    active: false,
    phase: "completed",
    endedAt: Date.now(),
    endReason: reason,
    workSourceIds: [],
    workSourceCount: 0,
    desktopPauseFailed: Boolean(pauseError),
    desktopPlaybackState:
      session.videoMode === "desktop"
        ? pauseResult?.playbackState || "unknown"
        : session.desktopPlaybackState,
    desktopPlaybackVerified:
      session.videoMode === "desktop"
        ? pauseResult?.playbackVerified === true
        : session.desktopPlaybackVerified === true,
    desktopPlaybackControlAttempts:
      session.videoMode === "desktop"
        ? pauseResult?.playbackControlAttempts || 0
        : session.desktopPlaybackControlAttempts || 0,
    lastError: pauseError || session.lastError,
  };
  await saveSession(finished);
  await updateBadge(finished);

  const settings = await getSettings();
  const shouldReturn =
    !["generation-complete", "desktop-generation-complete"].includes(reason) ||
    settings.autoReturn === true;
  if (shouldReturn) {
    const endedTab = await safeGetTab(fromTabId);
    if (endedTab && !isDouyinUrl(endedTab.url)) {
      await focusTab(fromTabId);
    } else if (
      finished.workbenchKind === "desktop" ||
      finished.desktopTargetId
    ) {
      const activated = await activateCodexDesktop(finished.desktopTargetId);
      if (!activated && Number.isInteger(finished.workbenchTabId)) {
        await focusTab(finished.workbenchTabId);
      }
    } else if (Number.isInteger(finished.workbenchTabId)) {
      await focusTab(finished.workbenchTabId);
    }
  }

  if (
    desktopLastWorking === true &&
    reason !== "desktop-generation-complete"
  ) {
    await setDesktopSuppressed(true);
  }

  return { ok: true, session: finished };
}

async function recordAdvance(message) {
  const session = await getSession();
  if (
    !session?.active ||
    (message.sessionId && message.sessionId !== session.id)
  ) {
    return { ok: false, reason: "no-active-session" };
  }

  const count = Math.max(
    session.count || 1,
    normalizeMaxVideos(message.count, (session.count || 1) + 1),
  );
  const limitReached = count >= session.maxVideos;
  const updated = {
    ...session,
    count,
    limitReached,
  };
  await saveSession(updated);
  await updateBadge(updated);
  return { ok: true, session: updated, limitReached };
}

async function rememberTabIfWorkbench(tab) {
  if (
    tab?.id &&
    (isSupportedWorkbenchUrl(tab.url) ||
      findCustomSource(tab.url, await getCustomSources()))
  ) {
    await rememberWorkbench(tab.id);
  }
}

async function registerBrowserGenerationStarted(tab) {
  const settings = await getSettings();
  if (!settings.autoLink) {
    return { ok: false, reason: "auto-disabled" };
  }
  const sourceId = browserWorkSourceId(tab?.id);
  if (!sourceId) return { ok: false, reason: "missing-workbench-tab" };

  await addWorkSource({
    id: sourceId,
    kind: "browser",
    tabId: tab.id,
    windowId: tab.windowId,
    startedAt: Date.now(),
  });

  const session = await getSession();
  if (session?.active) {
    return { ok: true, session, alreadyActive: true };
  }

  return startSession({
    workbenchTabId: tab.id,
    reason: "auto",
  });
}

async function registerBrowserGenerationCompleted(tabId) {
  const sourceId = browserWorkSourceId(tabId);
  if (!sourceId) return { ok: false, reason: "missing-workbench-tab" };
  await removeWorkSource(sourceId);
  return finishSessionForWorkEnd({
    reason: "generation-complete",
    fromTabId: tabId,
  });
}

async function registerCustomAiGenerationStarted(tab) {
  const source = findCustomSource(tab?.url, await getCustomSources());
  if (!source) return { ok: false, reason: "custom-source-not-configured" };
  return registerBrowserGenerationStarted(tab);
}

async function handleMessage(message, sender) {
  switch (message?.type) {
    case "WORKBENCH_SEEN":
      if (sender.tab?.id) await rememberWorkbench(sender.tab.id);
      return { ok: true };

    case "WORKBENCH_GENERATION_STARTED":
      return registerBrowserGenerationStarted(sender.tab);

    case "WORKBENCH_GENERATION_COMPLETED":
      return registerBrowserGenerationCompleted(sender.tab?.id);

    case "CUSTOM_AI_READY":
      if (sender.tab) await syncCustomAiTab(sender.tab);
      return { ok: true };

    case "CUSTOM_AI_GENERATION_STARTED":
      return registerCustomAiGenerationStarted(sender.tab);

    case "CUSTOM_AI_GENERATION_COMPLETED":
      return registerBrowserGenerationCompleted(sender.tab?.id);

    case "TEST_CUSTOM_SOURCE":
      return testCustomSource(message.source);

    case "START_SESSION":
      return startSession({
        workbenchTabId: message.workbenchTabId,
        reason: "manual",
        videoMode: message.videoMode,
      });

    case "STOP_SESSION":
      return finishSession({ reason: message.reason || "manual" });

    case "HUD_STOP":
      return finishSession({ reason: message.reason || "user" });

    case "VIDEO_ADVANCED":
      return recordAdvance(message);

    case "LIMIT_REACHED":
      return recordAdvance(message);

    case "CHECK_AVAILABILITY": {
      const modes = Array.isArray(message.modes)
        ? message.modes
        : undefined;
      const availability = await getVideoAvailability({
        force: message.force === true,
        ...(modes ? { modes } : {}),
      });
      return { ok: true, availability };
    }

    case "GET_STATE": {
      const [session, settings, customSources] = await Promise.all([
        getSession(),
        getSettings(),
        getCustomSources(),
      ]);
      refreshStaleAvailability();
      return {
        ok: true,
        session,
        settings,
        customSources,
        availability: availabilitySnapshot(),
        desktop: {
          connected: Boolean(desktopBridge?.isConnected()),
          available: desktopAvailable,
          working: desktopLastWorking,
        },
      };
    }

    default:
      return { ok: false, reason: "unknown-message" };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type) return false;

  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => {
      console.error("Video work link message failed", error);
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    });

  return true;
});

chrome.runtime.onInstalled.addListener(async () => {
  await configureSessionStorage();
  await ensureSettings();
  await updateBadge(await getSession());
  await configureDesktopMonitor(await getSettings());
  await syncCustomAiTabs();
});

chrome.runtime.onStartup.addListener(async () => {
  await configureSessionStorage();
  await updateBadge(await getSession());
  await configureDesktopMonitor(await getSettings());
  await syncCustomAiTabs();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === SESSION_STORAGE_AREA && changes[SESSION_KEY]) {
    void updateBadge(changes[SESSION_KEY].newValue);
  }

  if (areaName === "sync" && changes[SETTINGS_KEY]) {
    const settings = normalizeSettings(changes[SETTINGS_KEY].newValue);
    void configureDesktopMonitor(settings).catch((error) => {
      console.warn("Unable to reconfigure Codex desktop link", error);
    });
  }

  if (areaName === "sync" && changes[CUSTOM_SOURCES_KEY]) {
    void syncCustomAiTabs({ disableMissing: true }).catch((error) => {
      console.warn("Unable to refresh custom AI adapters", error);
    });
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await safeGetTab(tabId);
  await rememberTabIfWorkbench(tab);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === "complete") {
    await rememberTabIfWorkbench(tab);
  }
  if (changeInfo.status === "complete") {
    await syncCustomAiTab(tab);
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const session = await getSession();
  const sourceId = browserWorkSourceId(tabId);
  if (!sourceId) return;

  if (session?.active && tabId === session.douyinTabId) {
    await finishSession({
      sessionId: session.id,
      reason: "video-closed",
    });
    return;
  }

  const workSources = await getWorkSources();
  const wasTracked = workSources.some((source) => source.id === sourceId);
  await removeWorkSource(sourceId);
  const updatedSession = await getSession();
  if (!updatedSession?.active) return;

  if (
    wasTracked &&
    ["auto", "desktop"].includes(updatedSession.reason)
  ) {
    await finishSessionForWorkEnd({
      reason: "workbench-closed",
      fromTabId: tabId,
    });
    return;
  }

  if (
    tabId === session?.workbenchTabId &&
    !Number.isInteger(updatedSession.workbenchTabId)
  ) {
    await saveSession({
      ...updatedSession,
      workbenchTabId: null,
      workbenchWindowId: null,
    });
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "finish-session") {
    await finishSession({ reason: "shortcut" });
    return;
  }

  if (command === "toggle-session") {
    const session = await getSession();
    if (session?.active) {
      await finishSession({ reason: "shortcut" });
      return;
    }

    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    await startSession({
      workbenchTabId: activeTab?.id,
      reason: "manual",
    });
  }
});

void (async () => {
  await configureSessionStorage();
  await ensureSettings();
  await updateBadge(await getSession());
  await configureDesktopMonitor(await getSettings());
  await syncCustomAiTabs();
})().catch((error) => {
  console.error("Video work link initialization failed", error);
});
