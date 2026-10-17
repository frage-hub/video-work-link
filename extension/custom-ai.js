(() => {
  "use strict";

  if (globalThis.__workVideoLinkCustomAiLoaded) return;
  globalThis.__workVideoLinkCustomAiLoaded = true;

  const POLL_MS = 220;
  const COMPLETION_STABLE_MS = 1500;
  let config = null;
  let generationSeen = false;
  let completionPendingSince = 0;
  let pollTimer = null;

  function send(message) {
    try {
      return chrome.runtime.sendMessage(message).catch(() => null);
    } catch (_) {
      return Promise.resolve(null);
    }
  }

  function isVisible(element) {
    if (!(element instanceof Element)) return false;
    if (element.disabled) return false;
    const style = getComputedStyle(element);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      Number(style.opacity) === 0
    ) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 4 && rect.height > 4;
  }

  function selectorMatchesWorkingState() {
    if (!config?.selector) return false;
    try {
      return [...document.querySelectorAll(config.selector)].some(isVisible);
    } catch (_) {
      return false;
    }
  }

  function apiMatchesWorkingState() {
    return (
      document.documentElement?.getAttribute(
        WorkLink.CUSTOM_STATE_ATTRIBUTE,
      ) === "working"
    );
  }

  function markGenerationStarted() {
    if (!config?.enabled || generationSeen) return;
    generationSeen = true;
    completionPendingSince = 0;
    void send({
      type: "CUSTOM_AI_GENERATION_STARTED",
      sourceId: config.id,
      origin: location.origin,
    });
  }

  function markGenerationCompleted(immediate = false) {
    if (!generationSeen) return;
    generationSeen = false;
    completionPendingSince = 0;
    void send({
      type: "CUSTOM_AI_GENERATION_COMPLETED",
      sourceId: config?.id || null,
      origin: location.origin,
      immediate,
    });
  }

  function sampleWorkingState() {
    if (!config?.enabled) {
      markGenerationCompleted(true);
      return;
    }

    const now = Date.now();
    const working = apiMatchesWorkingState() || selectorMatchesWorkingState();
    if (working) {
      completionPendingSince = 0;
      markGenerationStarted();
      return;
    }

    if (!generationSeen) return;
    if (!completionPendingSince) {
      completionPendingSince = now;
      return;
    }
    if (now - completionPendingSince >= COMPLETION_STABLE_MS) {
      markGenerationCompleted();
    }
  }

  function applyConfig(nextConfig) {
    const normalized = nextConfig && typeof nextConfig === "object" ? nextConfig : null;
    if (!normalized?.id || !normalized?.origin) {
      markGenerationCompleted(true);
      config = null;
      return;
    }
    if (normalized.origin !== location.origin) {
      markGenerationCompleted(true);
      config = null;
      return;
    }
    config = {
      id: String(normalized.id),
      name: String(normalized.name || location.hostname),
      origin: String(normalized.origin),
      selector: String(normalized.selector || ""),
      enabled: normalized.enabled !== false,
    };
    completionPendingSince = 0;
    sampleWorkingState();
  }

  window.addEventListener(WorkLink.CUSTOM_START_EVENT, () => {
    markGenerationStarted();
  });

  window.addEventListener(WorkLink.CUSTOM_END_EVENT, () => {
    markGenerationCompleted(true);
  });

  window.addEventListener("pagehide", () => {
    markGenerationCompleted(true);
    clearInterval(pollTimer);
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "CUSTOM_AI_PING") {
      sendResponse({
        ok: true,
        origin: location.origin,
        sourceId: config?.id || null,
      });
      return false;
    }
    if (message?.type === "CUSTOM_AI_CONFIG") {
      applyConfig(message.source);
      sendResponse({ ok: true, origin: location.origin });
      return false;
    }
    return false;
  });

  void send({ type: "CUSTOM_AI_READY", origin: location.origin });
  pollTimer = setInterval(sampleWorkingState, POLL_MS);
})();
