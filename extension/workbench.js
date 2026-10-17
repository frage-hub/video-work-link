(() => {
  "use strict";

  if (globalThis.__workVideoLinkWorkbenchLoaded) return;
  globalThis.__workVideoLinkWorkbenchLoaded = true;

  const STOP_SELECTORS = [
    'button[data-testid="stop-button"]',
    'button[data-testid="composer-stop-button"]',
    'button[data-testid*="stop-button"]',
    'button[aria-label="Stop generating"]',
    'button[aria-label="Stop streaming"]',
    'button[aria-label="停止生成"]',
    'button[aria-label="停止回答"]',
  ].join(",");
  const COMPOSER_SELECTOR =
    'form, [data-testid*="composer"], [class*="composer"], [data-testid*="thread-bottom"]';
  const COMPLETION_STABLE_MS = WorkLink.COMPLETION_STABLE_MS;
  const POLL_MS = WorkLink.WORK_STATE_POLL_MS;

  let generationSeen = false;
  let completionPendingSince = 0;
  let pollTimer = null;
  let mutationTimer = null;

  function isVisible(element) {
    if (!(element instanceof Element)) return false;
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

  function belongsToComposer(element) {
    return Boolean(element.closest(COMPOSER_SELECTOR));
  }

  function describeControl(element) {
    return {
      label: element.getAttribute("aria-label") || "",
      title: element.getAttribute("title") || "",
      text: (element.textContent || "").trim().slice(0, 120),
      testId: element.getAttribute("data-testid") || "",
    };
  }

  function findWorkingControl() {
    for (const element of document.querySelectorAll(STOP_SELECTORS)) {
      if (isVisible(element) && !element.disabled) return element;
    }

    const composerButtons = document.querySelectorAll(
      `${COMPOSER_SELECTOR} button, ${COMPOSER_SELECTOR} [role="button"]`,
    );
    for (const element of composerButtons) {
      if (
        isVisible(element) &&
        !element.disabled &&
        WorkLink.isLikelyStopControl(describeControl(element))
      ) {
        return element;
      }
    }

    const genericStopButtons = document.querySelectorAll(
      'button[aria-label*="stop" i], button[aria-label*="停止"]',
    );
    for (const element of genericStopButtons) {
      if (
        isVisible(element) &&
        !element.disabled &&
        belongsToComposer(element) &&
        WorkLink.isLikelyStopControl(describeControl(element))
      ) {
        return element;
      }
    }

    return null;
  }

  function send(message) {
    try {
      return chrome.runtime.sendMessage(message).catch(() => null);
    } catch (_) {
      return Promise.resolve(null);
    }
  }

  function markGenerationStarted() {
    if (generationSeen) return;
    generationSeen = true;
    completionPendingSince = 0;
    void send({ type: "WORKBENCH_GENERATION_STARTED" });
  }

  function markGenerationCompleted() {
    if (!generationSeen) return;
    generationSeen = false;
    completionPendingSince = 0;
    void send({ type: "WORKBENCH_GENERATION_COMPLETED" });
  }

  function sampleGenerationState() {
    const working = Boolean(findWorkingControl());
    const now = Date.now();

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

  function scheduleSample() {
    if (mutationTimer) return;
    mutationTimer = setTimeout(() => {
      mutationTimer = null;
      sampleGenerationState();
    }, 40);
  }

  function startObserver() {
    const observer = new MutationObserver(scheduleSample);
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        "aria-label",
        "class",
        "data-testid",
        "disabled",
        "style",
        "title",
      ],
    });
  }

  function start() {
    sampleGenerationState();
    startObserver();
    pollTimer = setInterval(sampleGenerationState, POLL_MS);
    void send({ type: "WORKBENCH_SEEN" });
  }

  window.addEventListener("pagehide", () => {
    if (!generationSeen) return;
    generationSeen = false;
    void send({ type: "WORKBENCH_GENERATION_COMPLETED" });
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }

  globalThis.addEventListener("pagehide", () => {
    clearInterval(pollTimer);
  });
})();
