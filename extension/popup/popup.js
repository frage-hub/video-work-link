(() => {
  "use strict";

  const ICONS = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7V5Z"></path></svg>',
    return:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11.5 12 3l9 8.5"></path><path d="M5 10v10h14V10"></path><path d="M9 20v-6h6v6"></path></svg>',
    pause:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1"></rect><rect x="14" y="4" width="4" height="16" rx="1"></rect></svg>',
    loader:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9"></path></svg>',
  };

  const elements = {
    autoLink: document.getElementById("auto-link"),
    autoReturn: document.getElementById("auto-return"),
    customAiHint: document.getElementById("custom-ai-hint"),
    decreaseLimit: document.getElementById("decrease-limit"),
    desktopHint: document.getElementById("desktop-hint"),
    desktopLink: document.getElementById("desktop-link"),
    increaseLimit: document.getElementById("increase-limit"),
    limitHint: document.getElementById("limit-hint"),
    limitSettingHint: document.getElementById("limit-setting-hint"),
    maxVideos: document.getElementById("max-videos"),
    openCustomAi: document.getElementById("open-custom-ai"),
    pageChip: document.getElementById("page-chip"),
    pageKind: document.getElementById("page-kind"),
    platformHint: document.getElementById("platform-hint"),
    primaryButton: document.getElementById("primary-button"),
    primaryIcon: document.getElementById("primary-icon"),
    primaryLabel: document.getElementById("primary-label"),
    statusBadge: document.getElementById("status-badge"),
    statusKicker: document.getElementById("status-kicker"),
    statusMeta: document.getElementById("status-meta"),
    statusTitle: document.getElementById("status-title"),
    toast: document.getElementById("toast"),
    videoDesktopDot: document.getElementById("video-desktop-dot"),
    videoModeDesktop: document.getElementById("video-mode-desktop"),
    videoWebDot: document.getElementById("video-web-dot"),
    videoModeWeb: document.getElementById("video-mode-web"),
  };

  const view = {
    tab: null,
    session: null,
    customSources: [],
    settings: { ...WorkLink.DEFAULT_SETTINGS },
    desktop: { connected: false, available: null, working: null },
    availability: {
      web: {
        available: null,
        checking: true,
        reason: "正在检测抖音页面",
      },
      desktop: {
        available: null,
        checking: true,
        reason: "正在检测电脑端抖音",
      },
    },
    availabilityLoading: false,
    busy: false,
    action: "start",
    toastTimer: null,
  };

  function currentPageKind() {
    if (WorkLink.isSupportedWorkbenchUrl(view.tab?.url)) return "workbench";
    if (WorkLink.isDouyinUrl(view.tab?.url)) return "douyin";
    if (WorkLink.isCustomSourceUrl(view.tab?.url, view.customSources)) {
      return "custom-ai";
    }
    return "other";
  }

  function pageCopy(kind) {
    if (kind === "workbench") {
      return { header: "ChatGPT 工作台", chip: "工作台" };
    }
    if (kind === "douyin") {
      return { header: "抖音视频页", chip: "抖音" };
    }
    if (kind === "custom-ai") {
      const source = WorkLink.findCustomSource(
        view.tab?.url,
        view.customSources,
      );
      return {
        header: `${source?.name || "自定义 AI"} 工作台`,
        chip: "自定义 AI",
      };
    }
    return { header: "当前页面", chip: "普通网页" };
  }

  function videoModeLabel(mode) {
    return mode === "desktop" ? "电脑端 App" : "网页版";
  }

  function getModeAvailability(mode) {
    return view.availability?.[mode] || {
      available: null,
      checking: true,
      reason: "正在检测可用性",
    };
  }

  function modeAvailabilityCopy(mode) {
    const status = getModeAvailability(mode);
    if (status.available === false) {
      return {
        tone: "error",
        text: status.reason || "当前不可用",
      };
    }
    if (status.available === true) {
      return {
        tone: "ok",
        text: status.reason || "可用",
      };
    }
    return {
      tone: "checking",
      text: status.reason || "正在检测可用性",
    };
  }

  function renderAvailabilityButton(button, dot, mode, activityDisabled) {
    const status = getModeAvailability(mode);
    const copy = modeAvailabilityCopy(mode);
    const label = videoModeLabel(mode);
    dot.dataset.state = copy.tone;
    button.disabled = activityDisabled || status.available !== true;
    button.title = `${label}：${copy.text}`;
    button.setAttribute("aria-label", `${label}，${copy.text}`);
  }

  function formatTime(timestamp) {
    if (!timestamp) return "";
    return new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(timestamp));
  }

  function setPrimaryButton(icon, label, action) {
    view.action = action;
    elements.primaryIcon.innerHTML = ICONS[icon];
    elements.primaryLabel.textContent = label;
    const selectedStatus = getModeAvailability(view.settings.videoMode);
    const availabilityBlocked = action === "start" && selectedStatus.available !== true;
    elements.primaryButton.disabled = view.busy || availabilityBlocked;
    elements.primaryButton.dataset.disabledReason = view.busy
      ? "busy"
      : availabilityBlocked
        ? "availability"
        : "";
    if (availabilityBlocked) {
      elements.primaryButton.title = selectedStatus.reason || "视频端不可用";
    } else {
      elements.primaryButton.removeAttribute("title");
    }
  }

  function render() {
    const kind = currentPageKind();
    const copy = pageCopy(kind);
    const session = view.session;
    const active = Boolean(session?.active);
    const sessionVideoMode = session?.videoMode || view.settings.videoMode;
    const limited = active && Boolean(session?.limitReached);
    const completed = Boolean(
      session && !active && ["completed", "error"].includes(session.phase),
    );

    elements.pageKind.textContent = copy.header;
    elements.pageChip.textContent = copy.chip;
    elements.autoLink.checked = view.settings.autoLink;
    elements.autoReturn.checked = view.settings.autoReturn;
    elements.desktopLink.checked = view.settings.desktopLink;
    elements.customAiHint.textContent = view.customSources.length
      ? `${view.customSources.length} 个自定义网站已接入`
      : "ChatGPT 与自定义网站";
    const desktopVideoMode = view.settings.videoMode === "desktop";
    elements.videoModeWeb.setAttribute(
      "aria-pressed",
      String(!desktopVideoMode),
    );
    elements.videoModeDesktop.setAttribute(
      "aria-pressed",
      String(desktopVideoMode),
    );
    const modeControlsDisabled = active || view.busy;
    renderAvailabilityButton(
      elements.videoModeWeb,
      elements.videoWebDot,
      "web",
      modeControlsDisabled,
    );
    renderAvailabilityButton(
      elements.videoModeDesktop,
      elements.videoDesktopDot,
      "desktop",
      modeControlsDisabled,
    );
    const selectedAvailability = getModeAvailability(view.settings.videoMode);
    const selectedAvailabilityCopy = modeAvailabilityCopy(view.settings.videoMode);
    elements.platformHint.textContent = selectedAvailabilityCopy.text;
    elements.platformHint.dataset.tone = selectedAvailabilityCopy.tone;
    if (!view.settings.desktopLink) {
      elements.desktopHint.textContent = "需要启动本地桥";
    } else if (!view.desktop.connected) {
      elements.desktopHint.textContent = "本地桥未连接";
    } else if (view.desktop.available === false) {
      elements.desktopHint.textContent = "等待 Codex 桌面";
    } else if (view.desktop.available === true) {
      elements.desktopHint.textContent = view.desktop.working
        ? "Codex 正在工作"
        : "已连接 Codex";
    } else {
      elements.desktopHint.textContent = "正在连接本地桥";
    }
    elements.maxVideos.value = String(view.settings.maxVideos);
    elements.maxVideos.disabled = active || desktopVideoMode;
    elements.decreaseLimit.disabled =
      active || desktopVideoMode || view.settings.maxVideos <= 1;
    elements.increaseLimit.disabled =
      active || desktopVideoMode || view.settings.maxVideos >= 50;
    elements.limitSettingHint.textContent = desktopVideoMode
      ? "仅网页版按视频条数限制"
      : "达到后暂停，不继续推进";
    elements.limitHint.textContent = active
      ? sessionVideoMode === "desktop"
        ? "电脑端连播"
        : `本轮 ${session.count || 1} / ${session.maxVideos || view.settings.maxVideos}`
      : view.settings.videoMode === "desktop"
        ? "电脑端 App"
        : `最多 ${view.settings.maxVideos} 个`;

    const availabilityUnavailable =
      !active && !completed && selectedAvailability.available === false;
    const availabilityChecking =
      !active && !completed && selectedAvailability.available === null;
    document.body.dataset.status = limited
      ? "limited"
      : active
        ? "active"
        : completed
          ? "completed"
          : availabilityUnavailable
            ? "unavailable"
            : availabilityChecking
              ? "checking"
              : "idle";

    if (view.busy) {
      elements.statusKicker.textContent = "处理中";
      elements.statusBadge.textContent = "处理";
      elements.statusTitle.textContent =
        view.action === "start" ? "正在检测并启动" : "正在暂停并返回";
      elements.statusMeta.textContent =
        view.action === "start" ? "正在确认视频端可用性" : "请稍候";
      setPrimaryButton("loader", "处理中", view.action);
      return;
    }

    if (limited) {
      elements.statusKicker.textContent = "已暂停";
      elements.statusBadge.textContent = "上限";
      elements.statusTitle.textContent = "已达到视频上限";
      elements.statusMeta.textContent =
        session.reason === "desktop"
          ? "视频已暂停，Codex 完成后仍会返回"
          : "视频已暂停，AI 完成后仍会返回";
      setPrimaryButton("return", "返回工作台", "stop");
      return;
    }

    if (active) {
      elements.statusKicker.textContent = "联动中";
      elements.statusBadge.textContent =
        session.reason === "desktop"
          ? "桌面"
          : session.reason === "auto"
            ? "自动"
            : "手动";
      elements.statusTitle.textContent =
        sessionVideoMode === "desktop"
          ? "电脑端抖音播放中"
          : `正在看第 ${session.count || 1} 个视频`;
      const taskCopy =
        session.reason === "desktop"
          ? "Codex 桌面任务进行中"
          : session.reason === "auto"
            ? "ChatGPT 正在生成"
            : "手动联动中";
      const workingConversationCount = Math.max(
        1,
        Number(session.workSourceCount) || 1,
      );
      const activeTaskCopy =
        workingConversationCount > 1
          ? `${workingConversationCount} 个对话同时进行中`
          : taskCopy;
      elements.statusMeta.textContent =
        sessionVideoMode === "desktop"
          ? `${activeTaskCopy}，任一对话结束后暂停 App 并返回`
          : workingConversationCount > 1
            ? `${activeTaskCopy}，任一对话结束后自动暂停并返回`
            : `${activeTaskCopy}，完成后自动返回`;
      setPrimaryButton("pause", "结束并返回", "stop");
      return;
    }

    if (completed) {
      const isError = session.phase === "error";
      elements.statusKicker.textContent = isError ? "启动失败" : "已完成";
      elements.statusBadge.textContent = isError ? "检查" : "返回";
      elements.statusTitle.textContent = isError ? "无法打开抖音" : "视频已暂停";
      elements.statusMeta.textContent = isError
        ? session.lastError || "请检查抖音页面后重试"
        : session.desktopPauseFailed
          ? session.lastError || "电脑端抖音未能自动暂停，请手动点击视频暂停"
          : `${
            session.endReason === "generation-complete"
              ? "AI 已完成"
              : session.endReason === "desktop-generation-complete"
                ? "Codex 已完成"
                : session.endReason === "desktop-bridge-lost"
                  ? "桌面连接中断，已安全暂停"
                  : session.endReason === "desktop-disabled"
                    ? "桌面联动已关闭"
                    : "联动已结束"
          } · ${formatTime(session.endedAt)}`;
      if (session.desktopPauseFailed) {
        elements.statusKicker.textContent = "暂停失败";
        elements.statusBadge.textContent = "检查";
        elements.statusTitle.textContent = "电脑端抖音未暂停";
      }
      setPrimaryButton("play", "再次开始", "start");
      return;
    }

    if (availabilityUnavailable) {
      elements.statusKicker.textContent = "不可用";
      elements.statusBadge.textContent = "检查";
      elements.statusTitle.textContent = `${videoModeLabel(
        view.settings.videoMode,
      )}暂不可用`;
      elements.statusMeta.textContent = selectedAvailability.reason || "可用性检测未通过";
      setPrimaryButton("play", "暂不可用", "start");
      return;
    }

    if (availabilityChecking) {
      elements.statusKicker.textContent = "检测中";
      elements.statusBadge.textContent = "检测";
      elements.statusTitle.textContent = `正在检测${videoModeLabel(
        view.settings.videoMode,
      )}`;
      elements.statusMeta.textContent = selectedAvailability.reason || "正在确认可用性";
      setPrimaryButton("loader", "检测可用性", "start");
      return;
    }

    elements.statusKicker.textContent = "待机";
    const desktopReady = view.settings.desktopLink;
    elements.statusBadge.textContent =
      view.settings.autoLink || desktopReady ? "就绪" : "手动";
    elements.statusTitle.textContent =
      kind === "workbench"
        ? "工作台已连接"
        : desktopReady
          ? "等待 Codex 工作"
          : "随时可以开始";
    const idleCopy = view.settings.autoLink
      ? view.settings.desktopLink
        ? "AI 页面或 Codex 桌面任务开始时自动进入"
        : kind === "workbench"
          ? "等待 ChatGPT 开始生成"
          : kind === "custom-ai"
            ? "等待当前自定义 AI 开始工作"
            : "ChatGPT 或自定义 AI 工作时会自动进入抖音"
      : view.settings.desktopLink
        ? "Codex 桌面任务开始时自动进入"
        : "自动联动已关闭";
    const modeLabel = videoModeLabel(view.settings.videoMode);
    elements.statusMeta.textContent = `${idleCopy} · ${modeLabel}`;
    setPrimaryButton("play", "开始联动", "start");
  }

  function showToast(message) {
    clearTimeout(view.toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.add("visible");
    view.toastTimer = setTimeout(() => {
      elements.toast.classList.remove("visible");
    }, 2600);
  }

  async function sendMessage(message) {
    try {
      return await chrome.runtime.sendMessage(message);
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async function refreshState() {
    const response = await sendMessage({ type: "GET_STATE" });
    if (response?.ok) {
      view.session = response.session;
      view.settings = WorkLink.normalizeSettings(response.settings);
      view.customSources = WorkLink.normalizeCustomSources(
        response.customSources,
      );
      view.desktop = response.desktop || view.desktop;
      if (response.availability) {
        view.availability = response.availability;
      }
      render();
    }
  }

  async function refreshAvailability(force = false) {
    const selectedStatus = getModeAvailability(view.settings.videoMode);
    if (selectedStatus.available === null) {
      view.availabilityLoading = true;
      render();
    }
    const response = await sendMessage({
      type: "CHECK_AVAILABILITY",
      force,
    });
    if (response?.ok && response.availability) {
      view.availability = response.availability;
    }
    view.availabilityLoading = false;
    render();
  }

  async function saveSettings(patch) {
    view.settings = WorkLink.normalizeSettings({
      ...view.settings,
      ...patch,
    });
    render();
    await chrome.storage.sync.set({ settings: view.settings });
  }

  async function updateLimit(nextValue) {
    const normalized = WorkLink.normalizeMaxVideos(nextValue, view.settings.maxVideos);
    await saveSettings({ maxVideos: normalized });
  }

  async function openCustomAiWindow() {
    const baseUrl = chrome.runtime.getURL("custom-ai/custom-ai.html");
    const params = new URLSearchParams();
    if (
      /^https?:\/\//.test(view.tab?.url || "") &&
      !WorkLink.isDouyinUrl(view.tab.url)
    ) {
      params.set("url", view.tab.url);
      if (view.tab.title) params.set("title", view.tab.title);
    }
    const targetUrl = params.size ? `${baseUrl}?${params}` : baseUrl;
    const tabs = await chrome.tabs.query({});
    const existing = tabs.find((tab) => tab.url?.startsWith(baseUrl));
    if (existing?.id) {
      await chrome.tabs.update(existing.id, { active: true });
      if (Number.isInteger(existing.windowId)) {
        await chrome.windows.update(existing.windowId, { focused: true });
      }
      return;
    }
    await chrome.windows.create({
      url: targetUrl,
      type: "popup",
      width: 800,
      height: 780,
      focused: true,
    });
  }

  async function performPrimaryAction() {
    if (view.busy) return;
    if (
      view.action === "start" &&
      getModeAvailability(view.settings.videoMode).available !== true
    ) {
      return;
    }
    view.busy = true;
    render();

    const response =
      view.action === "stop"
        ? await sendMessage({ type: "STOP_SESSION", reason: "manual" })
        : await sendMessage({
            type: "START_SESSION",
            workbenchTabId: view.tab?.id,
            videoMode: view.settings.videoMode,
          });

    view.busy = false;
    if (response?.availability) {
      view.availability = response.availability;
    }
    if (response?.session) {
      view.session = response.session;
    } else if (!response?.ok) {
      showToast(response?.error || "操作没有完成，请重试");
    }
    await refreshState();
  }

  async function initialize() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    view.tab = tab || null;

    elements.primaryButton.addEventListener("click", performPrimaryAction);
    elements.openCustomAi.addEventListener("click", () => {
      void openCustomAiWindow().catch((error) => {
        showToast(error instanceof Error ? error.message : String(error));
      });
    });
    elements.videoModeWeb.addEventListener("click", () => {
      if (getModeAvailability("web").available !== true) return;
      void saveSettings({ videoMode: "web" });
    });
    elements.videoModeDesktop.addEventListener("click", () => {
      if (getModeAvailability("desktop").available !== true) return;
      void saveSettings({ videoMode: "desktop" });
    });
    elements.autoLink.addEventListener("change", () => {
      void saveSettings({ autoLink: elements.autoLink.checked });
    });
    elements.desktopLink.addEventListener("change", () => {
      void saveSettings({ desktopLink: elements.desktopLink.checked });
    });
    elements.autoReturn.addEventListener("change", () => {
      void saveSettings({ autoReturn: elements.autoReturn.checked });
    });
    elements.maxVideos.addEventListener("change", () => {
      void updateLimit(elements.maxVideos.value);
    });
    elements.decreaseLimit.addEventListener("click", () => {
      void updateLimit(view.settings.maxVideos - 1);
    });
    elements.increaseLimit.addEventListener("click", () => {
      void updateLimit(view.settings.maxVideos + 1);
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
      const sessionArea = chrome.storage.session ? "session" : "local";
      if (areaName === sessionArea && changes.activeSession) {
        view.session = changes.activeSession.newValue;
        render();
      }
      if (areaName === "sync" && changes.settings) {
        view.settings = WorkLink.normalizeSettings(changes.settings.newValue);
        render();
      }
      if (areaName === "sync" && changes.customSources) {
        view.customSources = WorkLink.normalizeCustomSources(
          changes.customSources.newValue,
        );
        render();
      }
    });

    await refreshState();
    void refreshAvailability(false);
    const stateTimer = setInterval(() => {
      void refreshState();
    }, 2000);
    window.addEventListener(
      "pagehide",
      () => clearInterval(stateTimer),
      { once: true },
    );
  }

  void initialize().catch((error) => {
    showToast(error instanceof Error ? error.message : String(error));
  });
})();
