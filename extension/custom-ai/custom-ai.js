(() => {
  "use strict";

  const ICONS = {
    edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 20 4.5-1 10-10-3.5-3.5-10 10L4 20Zm9.5-13 3.5 3.5M14 6l2-2a2.1 2.1 0 0 1 3 0l1 1a2.1 2.1 0 0 1 0 3l-2 2"></path></svg>',
    open: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M19 14v6H4V5h6"></path></svg>',
    test: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3h8M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3M7.5 15h9"></path></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"></path></svg>',
  };

  const elements = {
    apiSnippet: document.getElementById("api-snippet"),
    cancelEdit: document.getElementById("cancel-edit"),
    closeWindow: document.getElementById("close-window"),
    copyApi: document.getElementById("copy-api"),
    editorMode: document.getElementById("editor-mode"),
    editorTitle: document.getElementById("editor-title"),
    emptyState: document.getElementById("empty-state"),
    form: document.getElementById("source-form"),
    formStatus: document.getElementById("form-status"),
    fullGuideLink: document.getElementById("full-guide-link"),
    saveLabel: document.getElementById("save-label"),
    saveSource: document.getElementById("save-source"),
    sourceCount: document.getElementById("source-count"),
    sourceEnabled: document.getElementById("source-enabled"),
    sourceList: document.getElementById("source-list"),
    sourceName: document.getElementById("source-name"),
    sourceOrigin: document.getElementById("source-origin"),
    sourceSelector: document.getElementById("source-selector"),
    toast: document.getElementById("toast"),
  };

  const view = {
    sources: [],
    permissions: new Map(),
    editingId: null,
    busy: false,
    testResults: new Map(),
    toastTimer: null,
  };

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function showToast(message) {
    clearTimeout(view.toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.add("visible");
    view.toastTimer = setTimeout(() => {
      elements.toast.classList.remove("visible");
    }, 2600);
  }

  function setFormStatus(message, tone = "") {
    elements.formStatus.textContent = message;
    elements.formStatus.dataset.tone = tone;
  }

  function normalizeSourceOrigin(value) {
    let candidate = String(value || "").trim();
    if (!candidate) return null;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) {
      candidate = `https://${candidate}`;
    }
    return WorkLink.normalizeHttpOrigin(candidate);
  }

  function validateSelector(selector) {
    if (!selector) return true;
    try {
      document.createDocumentFragment().querySelector(selector);
      return true;
    } catch (_) {
      return false;
    }
  }

  function cleanPageTitle(value) {
    return String(value || "")
      .replace(/\s*[-|·]\s*(ChatGPT|Claude|Gemini|Copilot).*$/i, "")
      .trim()
      .slice(0, 48);
  }

  function currentSource() {
    return (
      view.sources.find((source) => source.id === view.editingId) || null
    );
  }

  function permissionOrigin(source) {
    return `${source.origin}/*`;
  }

  function sourceStatus(source) {
    if (!source.enabled) return { tone: "off", label: "已停用" };
    if (view.permissions.get(source.origin) !== true) {
      return { tone: "warn", label: "等待授权" };
    }
    return { tone: "ok", label: "已授权" };
  }

  function renderSource(source) {
    const status = sourceStatus(source);
    const result = view.testResults.get(source.id);
    const selectorCopy = source.selector
      ? `选择器 ${source.selector}`
      : "状态接口 / 页面事件";
    const resultCopy = result
      ? `<p class="source-test-result" data-tone="${escapeHtml(
          result.tone || "",
        )}">${escapeHtml(result.text)}</p>`
      : "";
    return `
      <article class="source-item" data-source-id="${escapeHtml(source.id)}">
        <div class="source-main">
          <div class="source-title-row">
            <span class="status-dot" data-state="${status.tone}" title="${status.label}" aria-label="${status.label}"></span>
            <strong title="${escapeHtml(source.name)}">${escapeHtml(source.name)}</strong>
          </div>
          <span class="source-origin" title="${escapeHtml(source.origin)}">${escapeHtml(source.origin)}</span>
          <span class="source-detail" title="${escapeHtml(selectorCopy)}">${escapeHtml(selectorCopy)}</span>
          ${resultCopy}
        </div>
        <div class="source-actions">
          <button class="icon-button" type="button" data-action="test" aria-label="测试 ${escapeHtml(source.name)}" title="测试连接">${ICONS.test}</button>
          <button class="icon-button" type="button" data-action="open" aria-label="打开 ${escapeHtml(source.name)}" title="打开网站">${ICONS.open}</button>
          <button class="icon-button" type="button" data-action="edit" aria-label="编辑 ${escapeHtml(source.name)}" title="编辑规则">${ICONS.edit}</button>
          <button class="icon-button" type="button" data-action="delete" aria-label="删除 ${escapeHtml(source.name)}" title="删除规则">${ICONS.trash}</button>
        </div>
      </article>
    `;
  }

  function render() {
    elements.sourceCount.textContent = `${view.sources.length} / ${WorkLink.CUSTOM_SOURCE_LIMIT}`;
    elements.emptyState.hidden = view.sources.length > 0;
    elements.sourceList.innerHTML = view.sources.map(renderSource).join("");
    elements.saveSource.disabled = view.busy;
    const editing = currentSource();
    elements.cancelEdit.hidden = !editing;
    elements.editorMode.textContent = editing ? "编辑规则" : "新增规则";
    elements.editorTitle.textContent = editing
      ? `编辑 ${editing.name}`
      : "连接一个 AI 网站";
    elements.saveLabel.textContent = view.busy
      ? "正在保存"
      : editing
        ? "保存修改并授权"
        : "保存并授权";
  }

  async function refreshPermissions() {
    const entries = await Promise.all(
      view.sources.map(async (source) => [
        source.origin,
        await chrome.permissions.contains({
          origins: [permissionOrigin(source)],
        }),
      ]),
    );
    view.permissions = new Map(entries);
  }

  async function loadSources() {
    const stored = await chrome.storage.sync.get("customSources");
    view.sources = WorkLink.normalizeCustomSources(stored.customSources);
    if (
      view.editingId &&
      !view.sources.some((source) => source.id === view.editingId)
    ) {
      view.editingId = null;
    }
    await refreshPermissions();
    render();
  }

  function resetForm() {
    view.editingId = null;
    elements.form.reset();
    elements.sourceEnabled.checked = true;
    setFormStatus("");
    render();
  }

  function populateForm(source) {
    view.editingId = source.id;
    elements.sourceName.value = source.name;
    elements.sourceOrigin.value = source.origin;
    elements.sourceSelector.value = source.selector;
    elements.sourceEnabled.checked = source.enabled;
    setFormStatus("正在编辑已有规则。", "");
    render();
    elements.sourceName.focus();
  }

  function applyLaunchContext() {
    const params = new URLSearchParams(location.search);
    const origin = normalizeSourceOrigin(params.get("url"));
    if (!origin || view.sources.some((source) => source.origin === origin)) {
      return;
    }
    elements.sourceOrigin.value = origin;
    elements.sourceName.value =
      cleanPageTitle(params.get("title")) || new URL(origin).hostname;
  }

  async function requestOriginPermission(origin) {
    return chrome.permissions.request({
      origins: [`${origin}/*`],
    });
  }

  async function saveSource(event) {
    event.preventDefault();
    if (view.busy) return;

    const origin = normalizeSourceOrigin(elements.sourceOrigin.value);
    if (!origin) {
      setFormStatus("请输入有效的 http 或 https 网站地址。", "error");
      elements.sourceOrigin.focus();
      return;
    }

    const selector = elements.sourceSelector.value.trim();
    if (!validateSelector(selector)) {
      setFormStatus("元素选择器语法无效，请检查后再保存。", "error");
      elements.sourceSelector.focus();
      return;
    }

    const editing = currentSource();
    const duplicate = view.sources.find(
      (source) => source.origin === origin && source.id !== editing?.id,
    );
    if (duplicate) {
      setFormStatus(`该网站已由“${duplicate.name}”使用。`, "error");
      return;
    }
    if (!editing && view.sources.length >= WorkLink.CUSTOM_SOURCE_LIMIT) {
      setFormStatus(
        `最多保存 ${WorkLink.CUSTOM_SOURCE_LIMIT} 个自定义 AI 网站。`,
        "error",
      );
      return;
    }

    view.busy = true;
    render();
    setFormStatus("正在请求该网站的访问权限。", "");

    let granted = false;
    try {
      granted = await requestOriginPermission(origin);
    } catch (error) {
      setFormStatus(
        error instanceof Error ? error.message : "无法请求网站访问权限。",
        "error",
      );
      view.busy = false;
      render();
      return;
    }

    if (!granted) {
      setFormStatus("未获得网站访问权限，规则没有保存。", "error");
      view.busy = false;
      render();
      return;
    }

    const normalized = WorkLink.normalizeCustomSource({
      id: editing?.id || `custom-${crypto.randomUUID()}`,
      name:
        elements.sourceName.value.trim() ||
        new URL(origin).hostname.replace(/^www\./, ""),
      origin,
      selector,
      enabled: elements.sourceEnabled.checked,
    });

    const nextSources = editing
      ? view.sources.map((source) =>
          source.id === editing.id ? normalized : source,
        )
      : [...view.sources, normalized];
    await chrome.storage.sync.set({
      customSources: WorkLink.normalizeCustomSources(nextSources),
    });
    await loadSources();
    view.busy = false;
    view.editingId = null;
    elements.form.reset();
    elements.sourceEnabled.checked = true;
    setFormStatus("规则已保存并启用。", "ok");
    render();
    showToast("自定义 AI 接入已保存");
  }

  async function testSource(source) {
    view.testResults.set(source.id, { text: "正在连接页面…", tone: "" });
    render();
    let granted = view.permissions.get(source.origin) === true;
    if (!granted) {
      try {
        granted = await requestOriginPermission(source.origin);
      } catch (_) {
        granted = false;
      }
    }
    if (!granted) {
      view.testResults.set(source.id, {
        text: "尚未授权访问该网站。",
        tone: "error",
      });
      render();
      return;
    }

    const response = await chrome.runtime.sendMessage({
      type: "TEST_CUSTOM_SOURCE",
      source,
    });
    if (!response?.ok) {
      view.testResults.set(source.id, {
        text: response?.error || "页面适配脚本未能连接。",
        tone: "error",
      });
    } else if (source.selector && response.selectorMatches === false) {
      view.testResults.set(source.id, {
        text: "脚本已连接；当前页面未匹配“工作中”元素。",
        tone: "",
      });
    } else if (source.selector && response.selectorMatches === true) {
      view.testResults.set(source.id, {
        text: `脚本已连接，并检测到“工作中”元素。${response.title ? ` ${response.title}` : ""}`,
        tone: "ok",
      });
    } else {
      view.testResults.set(source.id, {
        text: `页面适配脚本已连接，当前使用状态接口。${response.title ? ` ${response.title}` : ""}`,
        tone: "ok",
      });
    }
    await refreshPermissions();
    render();
  }

  async function openSource(source) {
    const granted = view.permissions.get(source.origin) === true;
    if (!granted) {
      showToast("请先测试连接并授权该网站");
      return;
    }
    await chrome.tabs.create({ url: source.origin, active: true });
  }

  async function deleteSource(source) {
    const confirmed = window.confirm(`删除“${source.name}”的自定义接入规则？`);
    if (!confirmed) return;
    const nextSources = view.sources.filter((item) => item.id !== source.id);
    await chrome.storage.sync.set({
      customSources: WorkLink.normalizeCustomSources(nextSources),
    });
    if (!nextSources.some((item) => item.origin === source.origin)) {
      await chrome.permissions
        .remove({ origins: [permissionOrigin(source)] })
        .catch(() => false);
    }
    view.testResults.delete(source.id);
    if (view.editingId === source.id) resetForm();
    await loadSources();
    showToast("自定义 AI 接入已删除");
  }

  async function copyApiSnippet() {
    const text = elements.apiSnippet.textContent.trim();
    try {
      await navigator.clipboard.writeText(text);
      showToast("页面接入示例已复制");
    } catch (_) {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.append(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
      showToast("页面接入示例已复制");
    }
  }

  async function handleSourceAction(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const item = button.closest("[data-source-id]");
    const source = view.sources.find(
      (candidate) => candidate.id === item?.dataset.sourceId,
    );
    if (!source) return;
    const action = button.dataset.action;
    if (action === "edit") populateForm(source);
    if (action === "test") await testSource(source);
    if (action === "open") await openSource(source);
    if (action === "delete") await deleteSource(source);
  }

  function bindEvents() {
    elements.form.addEventListener("submit", saveSource);
    elements.cancelEdit.addEventListener("click", resetForm);
    elements.closeWindow.addEventListener("click", () => window.close());
    elements.copyApi.addEventListener("click", copyApiSnippet);
    elements.sourceList.addEventListener("click", handleSourceAction);
    elements.sourceOrigin.addEventListener("input", () => {
      const source = currentSource();
      if (!source) return;
      const changed = normalizeSourceOrigin(elements.sourceOrigin.value);
      if (changed !== source.origin) {
        setFormStatus("更改网站后需要重新授权新域名。", "");
      }
    });
    elements.fullGuideLink.href = "guide.html";

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === "sync" && changes.customSources) {
        void loadSources();
      }
    });

    const refreshPermissionState = () => {
      void refreshPermissions().then(render).catch(() => null);
    };
    chrome.permissions.onAdded.addListener(refreshPermissionState);
    chrome.permissions.onRemoved.addListener(refreshPermissionState);
  }

  async function initialize() {
    bindEvents();
    await loadSources();
    applyLaunchContext();
    render();
  }

  void initialize().catch((error) => {
    setFormStatus(
      error instanceof Error ? error.message : "无法读取自定义 AI 配置。",
      "error",
    );
  });
})();
