(function () {
  const SIDEBAR_ID = "resume-pro-sidebar";
  const STORAGE_KEYS = ["templates", "activeTemplateId", "aiConfig", "profile"];
  const FIELD_HIGHLIGHT_CLASS = "resume-pro__field-highlight";
  const FIELD_HIGHLIGHT_STYLE_ID = "resume-pro-field-highlight-styles";
  const FIELD_HIGHLIGHT_STYLE_TEXT = `
.${FIELD_HIGHLIGHT_CLASS} {
  animation: resume-pro-field-highlight 2.6s ease-out forwards !important;
  outline: 2px solid rgba(34, 197, 94, 0.95) !important;
  outline-offset: 2px !important;
  box-shadow: 0 0 0 4px rgba(34, 197, 94, 0.14), 0 0 12px rgba(34, 197, 94, 0.5) !important;
  background-color: rgba(34, 197, 94, 0.1) !important;
}

@keyframes resume-pro-field-highlight {
  0% {
    outline-color: rgba(34, 197, 94, 0.95);
    box-shadow: 0 0 0 4px rgba(34, 197, 94, 0.14), 0 0 12px rgba(34, 197, 94, 0.5);
    background-color: rgba(34, 197, 94, 0.1);
  }

  70% {
    outline-color: rgba(34, 197, 94, 0.8);
    box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.09), 0 0 8px rgba(34, 197, 94, 0.28);
    background-color: rgba(34, 197, 94, 0.06);
  }

  100% {
    outline-color: rgba(34, 197, 94, 0);
    box-shadow: 0 0 0 0 rgba(34, 197, 94, 0);
    background-color: transparent;
  }
}
  `;
  const fieldHighlightTimers = new WeakMap();
  const chipSelectionIdsByTarget = new WeakMap();
  const chipWriteTargets = new WeakSet();
  let shadowRoot = null;
  const state = {
    dragOffsetX: 0,
    dragOffsetY: 0,
    dragging: false,
    currentStore: null,
    statusTimer: null,
    lastFocusedField: null,
    chipAction: null,
    stepwiseContinue: null
  };

  const StorageService = {
    // 只读。每个网页加载都会跑一次，在这里写回会用这一刻的快照盖掉设置页刚存的内容；
    // 缺省值由设置页补。
    async ensureDefaults() {
      const current = await chrome.storage.local.get(STORAGE_KEYS);
      return normalizeStore(current);
    },

    async getState() {
      const current = await chrome.storage.local.get(STORAGE_KEYS);
      return normalizeStore(current);
    },

    async setActiveTemplate(templateId) {
      await chrome.storage.local.set({ activeTemplateId: templateId });
    }
  };

  if (window.top !== window) {
    return;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "TOGGLE_SIDEBAR_V2") return false;
    const host = document.getElementById(SIDEBAR_ID);
    if (!host) {
      sendResponse({ started: false, error: "页面助手尚未就绪，请刷新页面后重试。" });
      return false;
    }
    const visible = host.style.display === "none";
    host.style.display = visible ? "block" : "none";
    sendResponse({ toggled: true, visible, protocol: 2 });
    return false;
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }

  async function init() {
    if (document.getElementById(SIDEBAR_ID)) {
      return;
    }

    state.currentStore = await StorageService.ensureDefaults();
    const cssText = await fetch(chrome.runtime.getURL("content.css")).then((r) => r.text());
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(cssText);
    injectFieldHighlightStyles();
    createSidebar(sheet);
    renderSidebar();
    bindStorageSync();
    bindFocusTracking();
  }

  function createSidebar(sheet) {
    const host = document.createElement("div");
    host.id = SIDEBAR_ID;
    Object.assign(host.style, {
      position: "fixed",
      top: "96px",
      right: "24px",
      zIndex: "2147483647",
      display: "none"
    });

    document.body.appendChild(host);
    shadowRoot = host.attachShadow({ mode: "closed" });
    shadowRoot.adoptedStyleSheets = [sheet];

    const sidebar = document.createElement("aside");
    sidebar.className = "resume-pro";
    sidebar.innerHTML = `
      <div class="resume-pro__header" data-drag-handle="true">
        <div class="resume-pro__title-wrap">
          <p class="resume-pro__eyebrow">网申助手</p>
          <strong class="resume-pro__title">自动填表</strong>
        </div>
        <div class="resume-pro__window-actions">
          <button class="resume-pro__collapse" type="button" aria-label="折叠助手">−</button>
          <button class="resume-pro__close" type="button" aria-label="关闭助手" title="关闭">×</button>
        </div>
      </div>
      <div class="resume-pro__body">
        <label class="resume-pro__field">
          <span>当前模板</span>
          <select class="resume-pro__select" id="resume-pro-template-select"></select>
        </label>
        <div class="resume-pro__quick-actions">
          <button class="resume-pro__manager-button" id="resume-pro-open-manager" type="button">打开管理面板</button>
          <button class="resume-pro__manager-button" id="resume-pro-open-profile" type="button">编辑我的信息</button>
        </div>
        <button class="resume-pro__ai-button" id="resume-pro-ai-fill" type="button">一键 AI 填写</button>
        <button class="resume-pro__manager-button" id="resume-pro-stepwise-fill" type="button">自动逐步填写</button>
        <button class="resume-pro__manager-button" id="resume-pro-repeat-fill" type="button">AI 辅助新增条目（先预览）</button>
        <button class="resume-pro__manager-button" id="resume-pro-cancel-fill" type="button" hidden>取消 AI 等待（保留本地匹配）</button>
        <p id="resume-pro-wait-hint" role="status" hidden></p>
        <div class="resume-pro__status" id="resume-pro-status" aria-live="polite"></div>
        <div class="resume-pro__fill-record" id="resume-pro-profile-offer" hidden>
          <p class="resume-pro__save-note" id="resume-pro-profile-offer-text"></p>
          <div class="resume-pro__save-actions">
            <button class="resume-pro__ai-button" type="button" id="resume-pro-profile-offer-add">加到我的信息</button>
            <button class="resume-pro__manager-button" type="button" id="resume-pro-profile-offer-skip">不用</button>
          </div>
        </div>
        <details class="resume-pro__diagnostics" id="resume-pro-diagnostics" hidden>
          <summary>填写诊断（不含简历内容）</summary>
          <textarea id="resume-pro-diagnostics-text" readonly aria-label="填写诊断摘要，可选择复制" rows="14"></textarea>
        </details>
        <div class="resume-pro__divider"></div>
        <div class="resume-pro__preview-heading">
          <strong>信息预览</strong>
          <span>点击字段可复制或填入网页</span>
        </div>
        <div class="resume-pro__groups" id="resume-pro-groups"></div>
      </div>
    `;

    shadowRoot.appendChild(sidebar);
    const managerPanel = document.createElement("section");
    managerPanel.className = "resume-pro__manager-panel";
    managerPanel.id = "resume-pro-manager-panel";
    managerPanel.hidden = true;
    managerPanel.innerHTML = `
      <div class="resume-pro__manager-header">
        <div>
          <p>网申助手</p>
          <strong>管理面板</strong>
        </div>
        <button type="button" id="resume-pro-close-manager" aria-label="关闭管理面板">×</button>
      </div>
      <iframe id="resume-pro-manager-frame" title="网申助手管理面板"></iframe>
    `;
    sidebar.appendChild(managerPanel);
    const chipActions = document.createElement("div");
    chipActions.id = "resume-pro-chip-actions";
    chipActions.className = "resume-pro__chip-actions";
    chipActions.hidden = true;
    chipActions.setAttribute("role", "menu");
    chipActions.setAttribute("aria-label", "字段填写方式");
    chipActions.innerHTML = `
      <button type="button" role="menuitem" data-chip-mode="add">添加</button>
      <button type="button" role="menuitem" data-chip-mode="replace">替换</button>
    `;
    shadowRoot.appendChild(chipActions);
    bindSidebarEvents(sidebar);
    managerPanel.querySelector("#resume-pro-close-manager")?.addEventListener("click", closeManager);
  }

  function bindSidebarEvents(sidebar) {
    const header = sidebar.querySelector(".resume-pro__header");
    const managerHeader = sidebar.querySelector(".resume-pro__manager-header");
    const collapseButton = sidebar.querySelector(".resume-pro__collapse");
    const closeButton = sidebar.querySelector(".resume-pro__close");
    const templateSelect = sidebar.querySelector("#resume-pro-template-select");
    const aiFillButton = sidebar.querySelector("#resume-pro-ai-fill");
    const openManagerButton = sidebar.querySelector("#resume-pro-open-manager");
    const openProfileButton = sidebar.querySelector("#resume-pro-open-profile");
    header.addEventListener("mousedown", startDrag);
    managerHeader?.addEventListener("mousedown", startDrag);
    document.addEventListener("mousemove", onDrag);
    document.addEventListener("mouseup", stopDrag);

    collapseButton.addEventListener("click", () => {
      sidebar.classList.toggle("is-collapsed");
      collapseButton.textContent = sidebar.classList.contains("is-collapsed") ? "+" : "−";
    });

    closeButton.addEventListener("click", () => {
      document.getElementById(SIDEBAR_ID).style.display = "none";
      closeManager();
      closeChipActionMenu();
    });

    templateSelect.addEventListener("change", async (event) => {
      await StorageService.setActiveTemplate(event.target.value);
      showStatus("模板已切换。", "success");
    });

    aiFillButton.addEventListener("click", handleAiFillClick);
    sidebar.querySelector("#resume-pro-stepwise-fill").addEventListener("click", (event) => {
      if (state.stepwiseContinue) {
        const continueFill = state.stepwiseContinue;
        state.stepwiseContinue = null;
        continueFill();
        return;
      }
      handleAiFillClick(event, { stepwise: true });
    });
    sidebar.querySelector("#resume-pro-repeat-fill").addEventListener("click", handleRepeatFillClick);
    openManagerButton?.addEventListener("click", () => openManager());
    openProfileButton?.addEventListener("click", () => openManager("profile"));
    sidebar.querySelector("#resume-pro-profile-offer-add")?.addEventListener("click", addUnansweredToProfile);
    sidebar.querySelector("#resume-pro-profile-offer-skip")?.addEventListener("click", closeProfileOffer);

    const chipActions = shadowRoot.querySelector("#resume-pro-chip-actions");
    chipActions?.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    chipActions?.querySelectorAll("[data-chip-mode]").forEach((actionButton) => {
      actionButton.addEventListener("click", () => handleChipAction(actionButton.dataset.chipMode));
    });
    document.addEventListener("mousedown", () => closeChipActionMenu());
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeManager();
        closeChipActionMenu();
      }
    });
  }

  function bindStorageSync() {
    chrome.storage.onChanged.addListener(async (changes, areaName) => {
      if (areaName !== "local") {
        return;
      }

      if (changes.templates || changes.activeTemplateId || changes.aiConfig || changes.profile) {
        state.currentStore = await StorageService.getState();
        renderSidebar();
      }
    });
  }

  function renderSidebar() {
    if (!shadowRoot) {
      return;
    }

    const templateSelect = shadowRoot.querySelector("#resume-pro-template-select");
    const groupsContainer = shadowRoot.querySelector("#resume-pro-groups");
    const activeTemplate = getActiveTemplate(state.currentStore);
    const templates = state.currentStore?.templates || [];

    templateSelect.innerHTML = templates.length
      ? templates.map((template) => `
          <option value="${escapeHtml(template.id)}" ${template.id === state.currentStore.activeTemplateId ? "selected" : ""}>
            ${escapeHtml(template.name)}
          </option>
        `).join("")
      : '<option value="">暂无模板</option>';

    templateSelect.disabled = !templates.length;

    const profileFields = profileResumeFields();
    const visibleProfileFields = activeTemplate && self.ResumeProProfile
      ? self.ResumeProProfile.excludeTemplateDuplicateFields(flattenTemplateFields(activeTemplate), profileFields)
      : profileFields;

    if (!activeTemplate && !visibleProfileFields.length) {
      groupsContainer.innerHTML = `
        <div class="resume-pro__empty">
          <p>还没有简历数据。</p>
          <button class="resume-pro__setup-button" id="resume-pro-setup-button" type="button">上传简历 / 导入模板</button>
        </div>
      `;
    } else {
      groupsContainer.innerHTML = (activeTemplate ? activeTemplate.groups : []).map((group, groupIndex) => `
      <section class="resume-pro__group">
        <div class="resume-pro__group-name">${escapeHtml(group.name)}</div>
        <div class="resume-pro__chips">
          ${group.fields.map((field, fieldIndex) => `
            <button
              class="resume-pro__chip"
              type="button"
              data-chip-id="${escapeHtml(`${activeTemplate.id}:${groupIndex}:${fieldIndex}`)}"
              data-value="${escapeHtml(field.value)}"
              title="${escapeHtml(field.value)}"
            >
              ${escapeHtml(field.key)}
            </button>
          `).join("")}
        </div>
      </section>
    `).join("") + buildProfileChipsHtml(visibleProfileFields);

      groupsContainer.querySelectorAll(".resume-pro__chip").forEach((button) => {
        button.addEventListener("mousedown", (event) => {
          event.preventDefault();
        });
        button.addEventListener("click", () => handleFieldChipClick(button));
      });
    }

    const setupButton = groupsContainer.querySelector("#resume-pro-setup-button");
    if (setupButton) {
      setupButton.addEventListener("click", () => openManager());
    }

    closeChipActionMenu();
    syncChipSelectionState();
  }

  async function handleFieldChipClick(button) {
    const value = button.dataset.value || "";
    const target = getLastFocusedFillTarget();

    closeChipActionMenu();
    if (!value) {
      return;
    }

    if (!target) {
      await copyText(value);
      return;
    }

    if (!isComposableTextTarget(target)) {
      await copyText(value);
      const filled = await Promise.resolve(setElementValue(target, value));
      if (filled) {
        target.focus?.();
        state.lastFocusedField = target;
      }
      return;
    }

    const selection = captureTextSelection(target);
    const currentValue = getComposableTargetValue(target);
    syncChipSelectionState();
    if (button.classList.contains("is-in-field")) {
      await applyChipValue(target, value, "remove", selection, button.dataset.chipId);
      return;
    }

    if (!currentValue) {
      await copyText(value);
      await applyChipValue(target, value, "add", selection, button.dataset.chipId);
      return;
    }

    showChipActionMenu(button, target, value, selection);
  }

  async function handleChipAction(mode) {
    const action = state.chipAction;
    closeChipActionMenu();
    if (!action || !["add", "replace"].includes(mode)) {
      return;
    }

    await copyText(action.value);
    const filled = await applyChipValue(action.target, action.value, mode, action.selection, action.button.dataset.chipId);
    if (!filled) {
      return;
    }
  }

  function showChipActionMenu(button, target, value, selection) {
    const menu = shadowRoot?.querySelector("#resume-pro-chip-actions");
    if (!menu) {
      return;
    }

    state.chipAction = { button, target, value, selection };
    menu.hidden = false;
    const buttonRect = button.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const left = Math.max(8, Math.min(buttonRect.left, window.innerWidth - menuRect.width - 8));
    const fitsBelow = buttonRect.bottom + menuRect.height + 8 <= window.innerHeight;
    const top = fitsBelow ? buttonRect.bottom + 6 : Math.max(8, buttonRect.top - menuRect.height - 6);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  function closeChipActionMenu() {
    const menu = shadowRoot?.querySelector?.("#resume-pro-chip-actions");
    if (menu) {
      menu.hidden = true;
    }
    state.chipAction = null;
  }

  function captureTextSelection(target) {
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      const fallback = target.value.length;
      return {
        start: Number.isInteger(target.selectionStart) ? target.selectionStart : fallback,
        end: Number.isInteger(target.selectionEnd) ? target.selectionEnd : fallback
      };
    }

    const selection = window.getSelection?.();
    if (!selection?.rangeCount) {
      const fallback = target.textContent?.length || 0;
      return { start: fallback, end: fallback };
    }

    const range = selection.getRangeAt(0);
    if (!target.contains(range.commonAncestorContainer)) {
      const fallback = target.textContent?.length || 0;
      return { start: fallback, end: fallback };
    }

    const beforeStart = range.cloneRange();
    beforeStart.selectNodeContents(target);
    beforeStart.setEnd(range.startContainer, range.startOffset);
    const beforeEnd = range.cloneRange();
    beforeEnd.selectNodeContents(target);
    beforeEnd.setEnd(range.endContainer, range.endOffset);
    return { start: beforeStart.toString().length, end: beforeEnd.toString().length };
  }

  function composeChipText(currentValue, chipValue, mode, selection = {}) {
    const current = String(currentValue || "");
    const chip = String(chipValue || "");
    const rawStart = Number.isInteger(selection.start) ? selection.start : current.length;
    const start = Math.min(Math.max(0, rawStart), current.length);

    if (!chip) {
      return { value: current, caret: start, changed: false };
    }

    if (mode === "replace") {
      return { value: chip, caret: chip.length, changed: current !== chip };
    }

    if (mode === "remove") {
      const index = findNearestChipOccurrence(current, chip, start);
      if (index < 0) {
        return { value: current, caret: start, changed: false };
      }
      return {
        value: current.slice(0, index) + current.slice(index + chip.length),
        caret: index,
        changed: true
      };
    }

    return {
      value: current.slice(0, start) + chip + current.slice(start),
      caret: start + chip.length,
      changed: true
    };
  }

  function findNearestChipOccurrence(current, chip, caret) {
    let nearestIndex = -1;
    let nearestDistance = Number.POSITIVE_INFINITY;
    let index = current.indexOf(chip);
    while (index >= 0) {
      const distance = caret < index ? index - caret : caret > index + chip.length ? caret - (index + chip.length) : 0;
      if (distance < nearestDistance) {
        nearestIndex = index;
        nearestDistance = distance;
      }
      index = current.indexOf(chip, index + Math.max(1, chip.length));
    }
    return nearestIndex;
  }

  async function applyChipValue(target, chipValue, mode, selection, chipId = "") {
    if (!isComposableTextTarget(target) || !document.contains(target)) {
      return false;
    }

    const composed = composeChipText(getComposableTargetValue(target), chipValue, mode, selection);
    if (!composed.changed) {
      if (mode === "replace" && chipId) {
        updateTrackedChipSelection(target, chipId, mode);
        syncChipSelectionState();
        return true;
      }
      return false;
    }

    const hadTrackedSelection = chipSelectionIdsByTarget.has(target);
    const previousSelection = new Set(chipSelectionIdsByTarget.get(target) || []);
    updateTrackedChipSelection(target, chipId, mode);
    chipWriteTargets.add(target);
    let filled;
    try {
      filled = await Promise.resolve(setElementValue(target, composed.value));
    } finally {
      chipWriteTargets.delete(target);
    }
    if (!filled) {
      if (chipId) {
        if (hadTrackedSelection) {
          chipSelectionIdsByTarget.set(target, previousSelection);
        } else {
          chipSelectionIdsByTarget.delete(target);
        }
      }
      return false;
    }

    target.focus?.();
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      target.setSelectionRange?.(composed.caret, composed.caret);
    } else {
      setContentEditableCaret(target, composed.caret);
    }
    state.lastFocusedField = target;
    syncChipSelectionState();
    return true;
  }

  function getComposableTargetValue(target) {
    return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
      ? String(target.value || "")
      : String(target.textContent || "");
  }

  function setContentEditableCaret(target, caret) {
    const selection = window.getSelection?.();
    const range = document.createRange?.();
    if (!selection || !range) {
      return;
    }
    const textNode = target.firstChild || target;
    const offset = textNode === target ? 0 : Math.min(caret, textNode.textContent?.length || 0);
    range.setStart(textNode, offset);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function isComposableTextTarget(target) {
    if (target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable)) {
      return true;
    }
    return target instanceof HTMLInputElement && ["text", "search", "tel", "url", "email", "password"].includes(target.type || "text");
  }

  function syncChipSelectionState() {
    if (!shadowRoot?.querySelectorAll) {
      return;
    }
    const target = getLastFocusedFillTarget();
    const currentValue = target && isComposableTextTarget(target) ? getComposableTargetValue(target) : "";
    const buttons = Array.from(shadowRoot.querySelectorAll(".resume-pro__chip"));
    const selectedIds = target && isComposableTextTarget(target)
      ? resolveSelectedChipIds(target, buttons, currentValue)
      : new Set();
    buttons.forEach((button) => {
      const selected = selectedIds.has(button.dataset.chipId);
      button.classList.toggle("is-in-field", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
  }

  function updateTrackedChipSelection(target, chipId, mode) {
    if (!chipId) {
      return;
    }
    const selectedIds = new Set(chipSelectionIdsByTarget.get(target) || []);
    if (mode === "replace") {
      selectedIds.clear();
    }
    if (mode === "remove") {
      selectedIds.delete(chipId);
    } else {
      selectedIds.add(chipId);
    }
    chipSelectionIdsByTarget.set(target, selectedIds);
  }

  function resolveSelectedChipIds(target, buttons, currentValue) {
    const hasTrackedSelection = chipSelectionIdsByTarget.has(target);
    const previousIds = chipSelectionIdsByTarget.get(target) || new Set();
    const nextIds = new Set();
    const buttonsByValue = new Map();

    buttons.forEach((button, index) => {
      if (!button.dataset.chipId) {
        button.dataset.chipId = `rendered-chip-${index}`;
      }
      const value = button.dataset.value || "";
      if (!value) {
        return;
      }
      if (!buttonsByValue.has(value)) {
        buttonsByValue.set(value, []);
      }
      buttonsByValue.get(value).push(button);
    });

    buttonsByValue.forEach((sameValueButtons, value) => {
      let remaining = countTextOccurrences(currentValue, value);
      const preferred = sameValueButtons.filter((button) => previousIds.has(button.dataset.chipId));
      const candidates = hasTrackedSelection
        ? preferred
        : sameValueButtons;
      candidates.forEach((button) => {
        if (remaining > 0) {
          nextIds.add(button.dataset.chipId);
          remaining -= 1;
        }
      });
    });

    chipSelectionIdsByTarget.set(target, nextIds);
    return nextIds;
  }

  function countTextOccurrences(text, value) {
    if (!value) {
      return 0;
    }
    let count = 0;
    let index = String(text || "").indexOf(value);
    while (index >= 0) {
      count += 1;
      index = String(text || "").indexOf(value, index + value.length);
    }
    return count;
  }

  function newRequestId() {
    return crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16)).join("-");
  }

  async function handleRepeatFillClick(event) {
    const button = event.currentTarget;
    const fillButton = shadowRoot.querySelector("#resume-pro-ai-fill");
    if (button.disabled || fillButton.disabled) return;
    const template = getActiveTemplate(state.currentStore);
    const config = state.currentStore?.aiConfig;
    if (!template || !config?.apiKey || !config?.apiUrl || !config?.model) {
      showStatus("请先准备简历模板和 AI 接口。", "error");
      return;
    }
    const agent = self.ResumeProFormAgent;
    const snapshot = agent.collect(document, flattenTemplateFields(template));
    if (!snapshot.candidates.length) {
      showStatus("未识别到可安全新增的分组，请先手动新增条目，再一键填写。", "error");
      return;
    }
    button.disabled = true;
    fillButton.disabled = true;
    const cancel = shadowRoot.querySelector("#resume-pro-cancel-fill");
    const hint = shadowRoot.querySelector("#resume-pro-wait-hint");
    const requestId = newRequestId();
    let stopped = false;
    let planning = true;
    let expanded;
    cancel.hidden = false;
    cancel.disabled = false;
    cancel.textContent = "停止辅助新增";
    cancel.onclick = () => {
      stopped = true;
      cancel.disabled = true;
      if (planning) self.ResumeProAIClient.cancel(requestId).catch(() => {});
    };
    const start = performance.now();
    const progress = () => {
      const seconds = Math.floor((performance.now() - start) / 1000);
      button.textContent = `AI 规划中... ${seconds}s`;
      if (seconds >= 90) {
        hint.hidden = false;
        hint.textContent = "正在等待 AI 规划，上游模型、中转或网络可能较慢；不会自动取消，可手动停止。";
      }
    };
    progress();
    const timer = window.setInterval(progress, 1000);
    try {
      const reply = await self.ResumeProAIClient.send({ type: "AI_PLAN_REPEAT", requestId, aiConfig: config, candidates: snapshot.candidates });
      planning = false;
      window.clearInterval(timer);
      if (stopped) throw new Error("已停止，未执行新增。");
      if (!reply?.success) throw new Error("AI 规划失败，未执行新增。可稍后重试或手动新增。");
      const plan = agent.validatePlan(reply.plan, snapshot.candidates);
      if (!plan.length) throw new Error("AI 未给出可确认的新增操作，请手动处理。");
      const preview = plan.map(action => `${snapshot.candidates.find(c => c.id === action.id).label}：${action.count} 条`).join("\n");
      if (!window.confirm(`允许以下操作吗？\n${preview}\n\n确认后将点击网页新增按钮，再用 AI 填写这些分组的空字段。不会提交、删除或覆盖已有内容。网页自身可能保存新条目；停止后不自动删除。`)) return;
      if (getActiveTemplate(state.currentStore) !== template) throw new Error("当前模板已变化，请重新预览。");
      button.textContent = "正在新增并检查网页...";
      hint.hidden = true;
      expanded = await agent.execute(plan, snapshot, () => stopped || getActiveTemplate(state.currentStore) !== template);
    } catch (error) {
      showStatus(error.message || "辅助新增失败，请手动核对网页。", "error");
    } finally {
      window.clearInterval(timer);
      cancel.hidden = true;
      cancel.onclick = null;
      cancel.textContent = "取消 AI 等待（保留本地匹配）";
      hint.hidden = true;
      button.disabled = false;
      fillButton.disabled = false;
      button.textContent = "AI 辅助新增条目（先预览）";
    }
    if (expanded && !stopped && getActiveTemplate(state.currentStore) === template) await handleAiFillClick({ currentTarget: fillButton }, { scopes: expanded.scopes });
  }

  function isAssistedTextField(entry) {
    const el = entry.element;
    return !el.disabled && !el.readOnly && (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && ["text", "email", "tel", "url", "search"].includes(el.type)));
  }

  function hasExistingValue(entry) {
    if (entry.kind === "radio") return entry.elements.some(el => el.checked);
    const el = entry.element;
    if (!el?.isConnected) return true;
    if (el.type === "checkbox" || el.type === "radio") return el.checked;
    return Boolean(String(el.value ?? el.textContent ?? "").trim());
  }

  async function handleAiFillClick(event, assisted = null) {
    const button = event.currentTarget;
    const stepwise = assisted?.stepwise === true;
    const scopedAssisted = Boolean(assisted?.scopes?.length);
    if (button.disabled) return;
    const activeTemplate = getActiveTemplate(state.currentStore);
    const aiConfig = state.currentStore?.aiConfig;

    const profileFields = profileResumeFields();

    if (!activeTemplate && !profileFields.length) {
      showStatus("请先导入简历模板，或在「我的信息」里填写内容。", "error");
      return;
    }

    button.disabled = true;
    const repeatButton = shadowRoot?.querySelector("#resume-pro-repeat-fill");
    if (repeatButton) repeatButton.disabled = true;
    button.textContent = "正在扫描网页...";
    const totalStart = performance.now();
    const timing = { scanMs: null, roundTripMs: null, fillMs: null };
    let phaseStart = totalStart;
    let phase = "scanMs";
    let timer = null;
    let diagnostics = {};
    let fieldCount = 0;
    let filledCount = 0;
    let unconfirmedCount = 0;
    const unfilledLabels = [];
    let outcome = "failed";
    const requestId = newRequestId();
    const cancelButton = shadowRoot?.querySelector("#resume-pro-cancel-fill");
    const waitHint = shadowRoot?.querySelector("#resume-pro-wait-hint");
    let cancelRequested = false;

    try {
      const scanned = scanFillableFields();
      const fieldMap = scanned.fieldMap;
      const fields = scopedAssisted ? scanned.fields.filter(field => {
        const entry = fieldMap.get(field.fieldId);
        return entry?.kind === "element" && isAssistedTextField(entry) && assisted.scopes.some(scope => scope.contains(entry.element)) && !hasExistingValue(entry);
      }) : scanned.fields;
      fieldCount = fields.length;
      timing.scanMs = performance.now() - phaseStart;
      phase = null;
      if (!fields.length) throw new Error("当前页面没有可填写的表单字段。");
      if (!scopedAssisted) closeProfileOffer();
      // 模板字段在前并且优先；「我的信息」只补模板里没有的字段名。
      const templateFields = activeTemplate ? flattenTemplateFields(activeTemplate) : [];
      const resumeFields = self.ResumeProProfile
        ? self.ResumeProProfile.mergeResumeFields(templateFields, profileFields)
        : templateFields;
      phase = "roundTripMs";
      phaseStart = performance.now();
      if (cancelButton) {
        cancelButton.hidden = false;
        cancelButton.disabled = false;
        cancelButton.onclick = async () => {
          if (phase !== "roundTripMs") return;
          cancelButton.disabled = true;
          try {
            const reply = await self.ResumeProAIClient.cancel(requestId);
            if (reply?.cancelled) cancelRequested = true;
            if (waitHint && phase === "roundTripMs") {
              waitHint.hidden = false;
              waitHint.textContent = reply?.cancelled ? "正在取消 AI 等待，保留本地匹配结果。" : "请求已结束或无法取消，正在等待结果。";
            }
          } catch {
            if (phase === "roundTripMs") {
              cancelButton.disabled = false;
              if (waitHint) {
                waitHint.hidden = false;
                waitHint.textContent = "取消请求未送达，请重试；当前请求可能仍在等待。";
              }
            }
          }
        };
      }
      const updateProgress = () => {
        const seconds = Math.floor((performance.now() - phaseStart) / 1000);
        button.textContent = `AI 匹配中... ${seconds}s`;
        if (seconds >= 90 && waitHint && !cancelRequested) {
          waitHint.hidden = false;
          waitHint.textContent = "AI 匹配尚未返回，等待通常与上游模型处理、中转服务或网络有关，输入量也会影响耗时。插件不会因等待较久自动取消；你可以继续等待或手动取消。";
        }
      };
      updateProgress();
      timer = window.setInterval(updateProgress, 1000);
      const response = await self.ResumeProAIClient.send({
        type: "AI_FILL",
        requestId,
        formFields: fields,
        resumeFields,
        aiConfig
      });
      timing.roundTripMs = performance.now() - phaseStart;
      phase = null;
      window.clearInterval(timer);
      timer = null;
      if (cancelButton) cancelButton.hidden = true;
      if (waitHint) waitHint.hidden = true;
      diagnostics = response?.diagnostics || {};

      if (!response?.success) {
        throw new Error(response?.error || "AI 填写失败。");
      }

      button.textContent = "正在填写网页...";
      phase = "fillMs";
      phaseStart = performance.now();

      const fieldMetaMap = new Map(fields.map((f) => [f.fieldId, f]));
      const domOrderMap = new Map(fields.map((field, index) => [field.fieldId, index]));
      const sortedMatches = [...response.matches].sort((a, b) => {
        const ma = fieldMetaMap.get(a.fieldId);
        const mb = fieldMetaMap.get(b.fieldId);
        if (ma?.cascadeGroup !== undefined && ma.cascadeGroup === mb?.cascadeGroup) {
          return (ma.cascadeLevel ?? 0) - (mb.cascadeLevel ?? 0);
        }
        // 其余按页面顺序从上往下填：没被识别成联动组的省/市/县也能等上一级先选好。
        return (domOrderMap.get(a.fieldId) ?? 0) - (domOrderMap.get(b.fieldId) ?? 0);
      });

      const processMatch = async (match) => {
        if (scopedAssisted && getActiveTemplate(state.currentStore) !== activeTemplate) return { ok: false, reason: "模板已变化，请核对网页。" };
        const element = fieldMap.get(match.fieldId);
        if (!element) return { ok: true };
        if (scopedAssisted && (!isAssistedTextField(element) || hasExistingValue(element) || !assisted.scopes.some(scope => scope.isConnected && scope.contains(element.element)))) return { ok: true };

        let filled = setElementValue(element, match.value);
        if (filled instanceof Promise) filled = await filled;
        if (filled && (stepwise || scopedAssisted)) {
          await new Promise(resolve => window.setTimeout(resolve, stepwise ? 100 : 50));
          if (element.kind === "element") filled = element.element.isConnected && element.element.value === match.value;
        }

        const fieldMeta = fieldMetaMap.get(match.fieldId);
        if (!filled && element.kind === "element" && element.element instanceof HTMLSelectElement
          && (fieldMeta?.cascadeGroup !== undefined || !hasRealSelectOptions(element.element))) {
          for (let retry = 0; retry < 3; retry++) {
            await new Promise((resolve) => setTimeout(resolve, 150));
            filled = setElementValue(element, match.value);
            if (filled || (fieldMeta?.cascadeGroup === undefined && hasRealSelectOptions(element.element))) break;
          }
        }
        if (filled) {
          filledCount += 1;
          highlightFilledField(element, match.value);
        } else if (scopedAssisted) {
          unconfirmedCount += 1;
        } else {
          unfilledLabels.push(fieldMeta?.label || fieldMeta?.placeholder || fieldMeta?.name || "未命名字段");
        }
        if (filled && fieldMeta?.cascadeGroup !== undefined) {
          const groupFields = fields.filter((f) => f.cascadeGroup === fieldMeta.cascadeGroup);
          const maxLevelInGroup = Math.max(...groupFields.map((f) => f.cascadeLevel));
          if (fieldMeta.cascadeLevel < maxLevelInGroup) await new Promise((resolve) => setTimeout(resolve, 250));
        }
        if (stepwise && !filled) return { ok: false, reason: `「${fieldMeta?.label || fieldMeta?.placeholder || fieldMeta?.name || "未命名字段"}」未确认，请手动处理后继续。` };
        return { ok: true };
      };

      if (stepwise) {
        const runner = self.ResumeProStepwise.createStepwiseRunner({
          items: sortedMatches,
          execute: processMatch,
          wait: async () => new Promise(resolve => setTimeout(resolve, 120)),
          onUpdate: (progress) => {
            if (progress.status === "running") button.textContent = `逐步填写中 ${Math.min(progress.index + 1, progress.total)}/${progress.total}`;
          }
        });
        const continueButton = shadowRoot?.querySelector("#resume-pro-stepwise-fill");
        const stopStepwise = () => {
          runner.stop();
          const continueFill = state.stepwiseContinue;
          state.stepwiseContinue = null;
          continueFill?.();
        };
        if (cancelButton) {
          cancelButton.hidden = false;
          cancelButton.disabled = false;
          cancelButton.textContent = "停止逐步填写";
          cancelButton.onclick = stopStepwise;
        }
        let result = await runner.start();
        while (result.status === "paused") {
          button.disabled = false;
          if (continueButton) continueButton.textContent = "继续逐步填写";
          showStatus(result.reason || "逐步填写已暂停。", "error", true);
          await new Promise(resolve => { state.stepwiseContinue = resolve; });
          button.disabled = true;
          if (continueButton) continueButton.textContent = "自动逐步填写";
          result = await runner.resume();
        }
        if (result.status === "stopped") throw new Error("逐步填写已停止，已填写内容请核对。");
      } else {
        for (const match of sortedMatches) await processMatch(match);
      }

      outcome = response.warning || unconfirmedCount || unfilledLabels.length ? "partial" : "success";
      const unfilledNote = unfilledLabels.length
        ? `${unfilledLabels.length} 项没填上：${summarizeLabels(unfilledLabels)}，请手动补上。`
        : "";
      if (scopedAssisted) {
        showStatus(`辅助填写：已验证 ${filledCount} 项。${unconfirmedCount ? `${unconfirmedCount} 项未确认，请核对网页。` : ""}${response.warning || ""}`, outcome === "partial" ? "error" : "success");
      } else if (response.warning) {
        showStatus(`本地已填写 ${filledCount} 项；${unfilledNote}${response.warning}`, "error", Boolean(unfilledNote));
      } else if (unfilledNote) {
        // 没填上的字段要用户自己去补，提示不自动消失。
        showStatus(`已填写 ${filledCount} 个字段。${unfilledNote}`, "error", true);
      } else {
        showStatus(`已填写 ${filledCount} 个字段。`, "success");
      }

      if (!scopedAssisted) {
        const matchedIds = new Set(response.matches.map((match) => match.fieldId));
        offerUnansweredFields(fields.map((field) => ({
          label: field.label || field.placeholder || field.name,
          inputType: field.inputType,
          matched: matchedIds.has(field.fieldId),
          hasValue: hasExistingValue(fieldMap.get(field.fieldId)),
          entry: fieldMap.get(field.fieldId)
        })), resumeFields);
      }
    } catch (error) {
      showStatus(error.message || "AI 填写失败。", "error");
    } finally {
      state.stepwiseContinue = null;
      if (cancelButton) {
        cancelButton.hidden = true;
        cancelButton.onclick = null;
      }
      if (waitHint) waitHint.hidden = true;
      if (timer !== null) window.clearInterval(timer);
      if (phase) timing[phase] = performance.now() - phaseStart;
      const totalMs = performance.now() - totalStart;
      const summary = formatFillDiagnostics({ ...timing, totalMs,
        fieldCount, filledCount, unfilledCount: unfilledLabels.length, outcome, diagnostics });
      const panel = shadowRoot?.querySelector("#resume-pro-diagnostics");
      const text = shadowRoot?.querySelector("#resume-pro-diagnostics-text");
      if (panel && text) {
        text.value = summary;
        panel.hidden = false;
        panel.open = true;
      }
      button.disabled = false;
      if (repeatButton) repeatButton.disabled = false;
      button.textContent = "一键 AI 填写";
      if (stepwise) button.textContent = "自动逐步填写";
    }
  }

  function summarizeLabels(labels, limit = 5) {
    const unique = [...new Set(labels.map((label) => String(label ?? "").trim()).filter(Boolean))];
    const shown = unique.slice(0, limit).join("、");
    return unique.length > limit ? `${shown} 等` : shown;
  }

  function formatFillDiagnostics(result) {
    const seconds = (value) => typeof value === "number" && Number.isFinite(value) ? `${(value / 1000).toFixed(2)} s` : "未执行 / 未取得";
    const count = (value) => Number.isInteger(value) && value >= 0 ? value : "未取得";
    const d = result.diagnostics;
    // Explicit allowlist: never copy provider messages, URL, keys or field values.
    const code = /^(none|cancelled|network|format|http_\d{3})$/.test(d.errorCode) ? d.errorCode : "unknown";
    return [
      `网申助手 v${chrome.runtime.getManifest().version}`,
      `结果：${({ success: "完成", partial: "部分完成", failed: "失败" })[result.outcome] || "未知"}；错误类别：${code}`,
      `网页字段：${count(result.fieldCount)}；成功填写：${count(result.filledCount)}；没填上：${count(result.unfilledCount)}`,
      `本地匹配：${count(d.ruleMatches)}；AI 匹配：${count(d.aiMatches)}`,
      `送 AI 字段：${count(d.aiFields)}`,
      `候选 / 简历字段：${count(d.candidateFields)} / ${count(d.resumeFields)}`,
      `用户 prompt：${count(d.promptBytes)} bytes`,
      `扫描：${seconds(result.scanMs)}`,
      `匹配往返（含后台处理）：${seconds(result.roundTripMs)}`,
      `API（含响应读取）：${seconds(d.apiMs)}`,
      `填写：${seconds(result.fillMs)}；总计：${seconds(result.totalMs)}`
    ].join("\n");
  }

  function scanFillableFields() {
    const selector = "input:not([type='hidden']):not([type='file']):not([type='button']):not([type='submit']):not([type='reset']):not([disabled]), textarea:not([disabled]), select:not([disabled])";
    const documents = [document];
    for (const frame of Array.from(document.querySelectorAll("iframe"))) {
      try {
        if (frame.contentDocument && !documents.includes(frame.contentDocument)) documents.push(frame.contentDocument);
      } catch (_) {
        // Cross-origin frames are scanned by their own all_frames content script.
      }
    }
    const candidates = [...new Set(documents.flatMap((rootDocument) => Array.from(rootDocument.querySelectorAll(selector))))]
      .filter((element) => isVisible(element) && !element.closest(`#${SIDEBAR_ID}`));

    const fieldMap = new Map();
    const fields = [];
    const radioGroups = new Set();
    const radioScopeIds = new WeakMap();
    let radioScopeSequence = 0;
    const radioGroupKey = (radio) => {
      const name = radio.name || "";
      const scope = name
        ? (radio.form || radio.closest("form") || document)
        : (radio.closest("[role='radiogroup'], fieldset, .ant-radio-group, .el-radio-group, .arco-radio-group, .semi-radioGroup") || radio);
      if (!radioScopeIds.has(scope)) radioScopeIds.set(scope, radioScopeSequence++);
      return `${radioScopeIds.get(scope)}:${name || "__unnamed__"}`;
    };

    candidates.forEach((element) => {
      if (element instanceof HTMLInputElement && element.type === "radio") {
        const groupName = element.name || "";
        const groupKey = radioGroupKey(element);

        if (radioGroups.has(groupKey)) {
          return;
        }

        radioGroups.add(groupKey);
        const radioElements = candidates.filter((candidate) => candidate instanceof HTMLInputElement
          && candidate.type === "radio"
          && radioGroupKey(candidate) === groupKey);
        const fieldId = `field-radio-${fields.length}`;
        fieldMap.set(fieldId, { kind: "radio", elements: radioElements });
        fields.push({
          fieldId,
          label: getFieldLabel(element),
          placeholder: "",
          name: groupName,
          idAttr: "",
          ariaLabel: element.getAttribute("aria-label") || "",
          tagName: "input",
          inputType: "radio",
          options: radioElements.map((radio) => getRadioOptionLabel(radio)).filter(Boolean),
          group: findNearestGroupLabel(element)
        });
        return;
      }

      const fieldId = `field-${fields.length}`;
      fieldMap.set(fieldId, { kind: "element", element });
      fields.push({
        fieldId,
        label: getFieldLabel(element),
        placeholder: element.getAttribute("placeholder") || "",
        name: element.getAttribute("name") || "",
        idAttr: element.id || "",
        ariaLabel: element.getAttribute("aria-label") || "",
        tagName: element.tagName.toLowerCase(),
        inputType: element instanceof HTMLInputElement ? element.type || "text" : element.tagName.toLowerCase(),
        options: element instanceof HTMLSelectElement
          ? Array.from(element.options).map((option) => option.text.trim()).filter(Boolean)
          : [],
        group: findNearestGroupLabel(element)
      });
    });

    const pickerSelectors = [
      { selector: ".ant-picker", pickerType: "antd" },
      { selector: ".el-date-editor", pickerType: "element" },
      { selector: ".arco-picker", pickerType: "arco" },
      { selector: ".semi-picker", pickerType: "semi" },
      { selector: ".phoenix-date-picker", pickerType: "phoenix" },
      { selector: "[class*='date-picker']", pickerType: "generic" },
      { selector: "[class*='datepicker']", pickerType: "generic" },
      { selector: "[class*='DatePicker']", pickerType: "generic" }
    ];

    pickerSelectors.forEach(({ selector, pickerType }) => {
      document.querySelectorAll(selector).forEach((container) => {
        if (container.closest(`#${SIDEBAR_ID}`)) return;
        if (!isVisible(container)) return;

        Array.from(container.querySelectorAll("input:not([type='hidden']):not([disabled])"))
          .filter((inner) => isVisible(inner))
          .forEach((inner) => {
          const pickerInputType = inferPickerInputType(container, inner);

          const existingEntry = Array.from(fieldMap.entries()).find(([, v]) => v.element === inner);
          if (existingEntry) {
            const [existingId, entryValue] = existingEntry;
            entryValue.pickerType = pickerType;
            entryValue.pickerInputType = pickerInputType;
            const existingField = fields.find((f) => f.fieldId === existingId);
            if (existingField) {
              existingField.inputType = "date-picker";
              existingField.pickerType = pickerType;
              existingField.pickerInputType = pickerInputType;
            }
            return;
          }

          const fieldId = `field-${fields.length}`;
          fieldMap.set(fieldId, { kind: "element", element: inner, pickerType, pickerInputType });
          fields.push({
            fieldId,
            label: getFieldLabel(inner),
            placeholder: inner.getAttribute("placeholder") || "",
            name: inner.getAttribute("name") || "",
            idAttr: inner.id || "",
            ariaLabel: inner.getAttribute("aria-label") || "",
            tagName: "input",
            inputType: "date-picker",
            pickerType,
            pickerInputType,
            options: [],
            group: findNearestGroupLabel(inner)
          });
        });
      });
    });

    // 自定义下拉组件扫描 (Custom Select/Combobox Detection)
    // 许多现代 Web 应用使用自定义下拉组件（如 Ant Design、Element UI 等），而不是原生 <select>
    const customSelectSelectors = [
      { selector: ".ant-select", type: "ant" },
      { selector: ".el-select", type: "element" },
      { selector: ".arco-select", type: "arco" },
      { selector: ".semi-select", type: "semi" },
      { selector: ".phoenix-select", type: "phoenix" },
      { selector: "[class*='phoenix-select']", type: "phoenix" },
      { selector: ".t-select", type: "tdesign" },
      { selector: ".next-select", type: "fusion" },
      { selector: "[role='combobox']", type: "generic" }
    ];

    customSelectSelectors.forEach(({ selector, type }) => {
      document.querySelectorAll(selector).forEach((container) => {
        if (container.closest(`#${SIDEBAR_ID}`)) return;
        if (!isVisible(container)) return;

        // 找到实际的输入元素
        let inputElement = null;
        if (type === "generic") {
          // role="combobox" 本身就是输入元素
          inputElement = container instanceof HTMLInputElement ? container : container.querySelector("input");
        } else {
          // 自定义组件容器内查找输入框
          inputElement = container.querySelector("input:not([type='hidden']):not([disabled])");
        }

        // 没有可见输入框时，用容器本身作为交互目标（部分框架的下拉不暴露 input）
        const interactiveElement = (inputElement && isVisible(inputElement)) ? inputElement : container;

        // 检查是否已被扫描过
        const existingEntry = Array.from(fieldMap.entries()).find(([, v]) => v.element === interactiveElement);
        if (existingEntry) return;

        // 不在扫描阶段收集选项：框架下拉（Ant Design 等）常用虚拟化渲染，
        // 选项只有在弹出层打开后才出现在 DOM 里。扫描时从整个 document 收集会把别的下拉的选项也混进来。
        // 选项在填写时由 selectComboboxOption 打开弹窗后动态查找。
        const fieldId = `field-${fields.length}`;
        fieldMap.set(fieldId, { kind: "element", element: interactiveElement, customSelectType: type, selectContainer: container });
        fields.push({
          fieldId,
          label: getFieldLabel(interactiveElement),
          placeholder: (inputElement?.getAttribute("placeholder")) || container.getAttribute("placeholder") || "",
          name: inputElement?.getAttribute("name") || "",
          idAttr: (interactiveElement instanceof HTMLElement ? interactiveElement.id : "") || "",
          ariaLabel: interactiveElement.getAttribute("aria-label") || "",
          tagName: interactiveElement.tagName.toLowerCase(),
          inputType: "combobox",
          customSelectType: type,
          options: [],
          group: findNearestGroupLabel(inputElement)
        });
      });
    });

    // 类名混淆平台的兜底扫描（北森 phoenix、Moka 用 styled-components/CSS Modules，类名不可靠）：
    // 只读输入框 + 占位符语义来判断这是日期控件还是下拉
    document.querySelectorAll("input[readonly]").forEach((inner) => {
      if (inner.closest(`#${SIDEBAR_ID}`)) return;
      if (!isVisible(inner)) return;

      const placeholder = (inner.getAttribute("placeholder") || "").trim();
      if (!placeholder) return;

      const existingEntry = Array.from(fieldMap.entries()).find(([, v]) => v.kind === "element" && v.element === inner);
      const looksLikeDate = /日期|年份|月份|时间|\d{4}[-/.]\d{1,2}/.test(placeholder);
      if (!looksLikeDate && !/请选择|选择|Select|Choose/i.test(placeholder)) return;

      const wrapper = inner.closest("[class*='select'], [class*='Select'], [class*='picker'], [class*='Picker'], [class*='date'], [class*='Date'], [class*='dropdown']")
        || inner.parentElement;
      if (!wrapper) return;

      if (looksLikeDate) {
        const pickerInputType = inferPickerInputType(wrapper, inner);
        // 之前被当成普通下拉登记过（比如日期控件上也挂了 role="combobox"），改判为日期控件
        if (existingEntry) {
          const [existingId, entryValue] = existingEntry;
          if (entryValue.pickerType) return;
          entryValue.pickerType = "generic";
          entryValue.pickerInputType = pickerInputType;
          delete entryValue.customSelectType;
          delete entryValue.selectContainer;
          const existingField = fields.find((f) => f.fieldId === existingId);
          if (existingField) {
            existingField.inputType = "date-picker";
            existingField.pickerType = "generic";
            existingField.pickerInputType = pickerInputType;
            delete existingField.customSelectType;
          }
          return;
        }

        const fieldId = `field-${fields.length}`;
        fieldMap.set(fieldId, { kind: "element", element: inner, pickerType: "generic", pickerInputType });
        fields.push({
          fieldId,
          label: getFieldLabel(inner),
          placeholder,
          name: inner.getAttribute("name") || "",
          idAttr: inner.id || "",
          ariaLabel: inner.getAttribute("aria-label") || "",
          tagName: "input",
          inputType: "date-picker",
          pickerType: "generic",
          pickerInputType,
          options: [],
          group: findNearestGroupLabel(inner)
        });
        return;
      }

      if (existingEntry) return;

      const fieldId = `field-${fields.length}`;
      fieldMap.set(fieldId, { kind: "element", element: inner, customSelectType: "generic", selectContainer: wrapper });
      fields.push({
        fieldId,
        label: getFieldLabel(inner),
        placeholder,
        name: inner.getAttribute("name") || "",
        idAttr: inner.id || "",
        ariaLabel: inner.getAttribute("aria-label") || "",
        tagName: "input",
        inputType: "combobox",
        customSelectType: "generic",
        options: [],
        group: findNearestGroupLabel(inner)
      });
    });

    // 级联判断 (Cascade Detection)
    if (self.ResumeProAIHelpers?.detectCascadeGroups) {
      self.ResumeProAIHelpers.detectCascadeGroups(fields, fieldMap);
    }

    return { fields, fieldMap };
  }

  function getFieldLabel(element) {
    const cleanedElementLabel = sanitizeLabelText(element.getAttribute("data-label"));
    if (cleanedElementLabel) return cleanedElementLabel;

    // 1. 标准 label 关联
    if (element.labels?.length) {
      const labelText = sanitizeLabelText(Array.from(element.labels).map((label) => label.textContent?.trim() || "").join(" / "));
      if (labelText) return labelText;
    }

    // 2. label[for] 关联
    if (element.id) {
      const linked = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
      const linkedText = sanitizeLabelText(linked?.textContent);
      if (linkedText) return linkedText;
    }

    // 3. 包裹在 label 里
    const wrappingLabel = element.closest("label");
    const wrappingText = sanitizeLabelText(wrappingLabel?.textContent);
    if (wrappingText) return wrappingText;

    // 4. aria-labelledby
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = sanitizeLabelText(labelledBy.split(" ").map(id => document.getElementById(id)?.textContent?.trim()).filter(Boolean).join(" "));
      if (text) return text;
    }

    // 5. 同一行的前一个兄弟元素文本（td/th/span/div/p）
    let sibling = element.previousElementSibling;
    while (sibling) {
      const text = sanitizeLabelText(sibling.textContent);
      if (text && text.length < 30) return text;
      sibling = sibling.previousElementSibling;
    }

    // 6. 父容器内、input 之前的文本节点或标签元素（常见于 td 布局）
    const parent = element.parentElement;
    if (parent) {
      // 找父容器的前一个兄弟（如 th/td）
      let parentSibling = parent.previousElementSibling;
      while (parentSibling) {
        const text = sanitizeLabelText(parentSibling.textContent);
        if (text && text.length < 30) return text;
        parentSibling = parentSibling.previousElementSibling;
      }

      // 父容器本身的直接文本（排除 input 本身的内容）
      const clone = parent.cloneNode(true);
      clone.querySelectorAll("input, select, textarea, button").forEach(el => el.remove());
      const text = sanitizeLabelText(clone.textContent);
      if (text && text.length < 30) return text;
    }

    // 7. 向上追溯祖先容器的前序单元格/标签，适配表格或复杂布局
    let current = parent;
    let depth = 0;
    while (current && depth < 5) {
      let previous = current.previousElementSibling;
      while (previous) {
        const text = sanitizeLabelText(previous.textContent);
        if (text && text.length < 40) return text;
        previous = previous.previousElementSibling;
      }

      const scopedLabel = current.querySelector("label, th, .label, .form-label, .ant-form-item-label");
      const scopedText = sanitizeLabelText(scopedLabel?.textContent);
      if (scopedText && scopedText.length < 40) return scopedText;

      current = current.parentElement;
      depth += 1;
    }

    // 8. placeholder 兜底
    return element.getAttribute("placeholder")?.trim() || "";
  }

  function bindFocusTracking() {
    document.addEventListener("focusin", (event) => {
      const target = event.target;

      if (!(target instanceof HTMLElement)) {
        return;
      }

      if (target.closest(`#${SIDEBAR_ID}`)) {
        return;
      }

      if (isFillTarget(target)) {
        state.lastFocusedField = target;
        closeChipActionMenu();
        syncChipSelectionState();
      }
    }, true);
    document.addEventListener("input", (event) => {
      if (event.target === state.lastFocusedField) {
        closeChipActionMenu();
        if (!chipWriteTargets.has(event.target)) {
          chipSelectionIdsByTarget.delete(event.target);
        }
        syncChipSelectionState();
      }
    }, true);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      const helper = document.createElement("textarea");
      helper.value = text;
      helper.setAttribute("readonly", "readonly");
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      document.body.appendChild(helper);
      helper.select();
      const success = document.execCommand("copy");
      helper.remove();
      return success;
    }
  }

  function getLastFocusedFillTarget() {
    const candidates = [state.lastFocusedField, document.activeElement];

    for (const candidate of candidates) {
      if (candidate instanceof HTMLElement && isFillTarget(candidate) && document.contains(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  function hasRealSelectOptions(select) {
    const isPlaceholder = self.ResumeProAIHelpers?.isPlaceholderOption;
    return Array.from(select.options || []).some((option) => String(option.text ?? "").trim()
      && !(isPlaceholder && isPlaceholder({ value: option.value, text: option.text, disabled: option.disabled })));
  }

  // 在一组候选弹出层里挑最合适的：可见 → 含选项 → 与触发器相关 → 文档顺序最后（刚打开的那个）
  function pickBestPopup(candidates, element) {
    const visible = candidates.filter((el) => el instanceof HTMLElement
      && isVisible(el)
      && !el.closest(`#${SIDEBAR_ID}`));
    if (!visible.length) return null;

    const withOptions = visible.filter((el) => el.querySelector("[role='option'], [class*='option'], [class*='item'], li"));
    const pool = withOptions.length ? withOptions : visible;

    const related = pool.find((el) => el.contains(element));
    if (related) return related;

    return pool[pool.length - 1];
  }

  function findComboboxPopupContainer(element) {
    // 1. aria-controls → 直接指向弹出层 id（Ant Design 5 等）
    const controlsId = element.getAttribute("aria-controls");
    if (controlsId) {
      const controlled = document.getElementById(controlsId);
      if (controlled) return controlled;
    }

    // 2. aria-owns → 指向弹出层 id
    const ownsId = element.getAttribute("aria-owns");
    if (ownsId) {
      const owned = document.getElementById(ownsId);
      if (owned) return owned;
    }

    // 3. 框架特定的弹出层容器（通常挂载在 body 下）
    const frameworkPopupSelectors = [
      ".ant-select-dropdown",
      ".el-select-dropdown",
      ".arco-select-dropdown",
      ".semi-select-dropdown",
      ".phoenix-select-dropdown",
      ".t-select-dropdown",
      ".next-select-menu-wrapper",
      "[class*='phoenix'][class*='dropdown']",
      "[class*='select-dropdown']:not([style*='display: none'])",
      "[class*='select-popup']:not([style*='display: none'])"
    ];
    for (const selector of frameworkPopupSelectors) {
      const popup = pickBestPopup(Array.from(document.querySelectorAll(selector)), element);
      if (popup) return popup;
    }

    // 4. role="listbox" 可见弹出层
    const listbox = pickBestPopup(Array.from(document.querySelectorAll("[role='listbox']")), element);
    if (listbox) return listbox;

    // 5. 兜底：查找任何可见的下拉/弹出容器（含选项类元素）
    const genericPopup = pickBestPopup(Array.from(document.querySelectorAll(
      "[class*='dropdown']:not(input):not(select):not(button), [class*='popup']:not(input):not(select):not(button), [class*='options']:not(input)"
    )), element);
    if (genericPopup) return genericPopup;

    return null;
  }

  // 按单元格文本识别日期/月份/年份面板：类名混淆时（北森 phoenix、Moka）比选择器可靠
  function looksLikeDateGrid(el) {
    const texts = Array.from(el.querySelectorAll("td, div, span, li, button")).slice(0, 150)
      .map((cell) => (cell.textContent || "").trim());
    const monthCells = texts.filter((t) => /^\d{1,2}\s*月$/.test(t)
      || /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*$/i.test(t)).length;
    const dayCells = texts.filter((t) => /^([1-9]|[12]\d|3[01])$/.test(t)).length;
    const yearCells = texts.filter((t) => /^(19|20)\d{2}$/.test(t)).length;
    return monthCells >= 6 || dayCells >= 14 || yearCells >= 4;
  }

  async function findPickerPanel() {
    // 常见框架日期选择器面板类名
    const panelSelectors = [
      ".ant-picker-dropdown:not([style*='display: none']):not(.ant-picker-dropdown-hidden)",
      ".el-picker-panel",
      ".arco-picker-popup:not([style*='display: none'])",
      ".semi-datepicker-popover:not([style*='display: none'])",
      ".phoenix-calendar:not([style*='display: none'])",
      ".phoenix-date-picker_wrap",
      "[class*='DatePickerPopup']:not([style*='display: none'])",
      "[class*='date-picker__panel']:not([style*='display: none'])"
    ];
    for (const selector of panelSelectors) {
      const panels = Array.from(document.querySelectorAll(selector));
      const visible = panels.find(isVisible);
      if (visible) return visible;
    }
    // 兜底：按单元格文本判断，不依赖类名（北森/Moka 的类名常被混淆）
    const candidates = Array.from(document.querySelectorAll(
      "[class*='picker']:not(input):not(select):not(button), [class*='calendar'], [class*='DatePicker'], [class*='panel'], [class*='popup'], [class*='overlay']"
    )).filter((el) => el instanceof HTMLElement
      && isVisible(el)
      && !el.closest(`#${SIDEBAR_ID}`)
      && looksLikeDateGrid(el));
    // 文档顺序最后的是刚打开的面板（也通常是只包住日期格子的那层）
    return candidates[candidates.length - 1] || null;
  }

  function clickPanelCell(cell) {
    if (!cell || typeof cell.click !== "function") return false;
    const canDispatch = typeof cell.dispatchEvent === "function";
    if (canDispatch) {
      cell.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      cell.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    }
    cell.click();
    if (canDispatch) {
      cell.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    }
    return true;
  }

  // 未知日历组件兜底：面板主体内找文本完全一致的单元格（北森/Moka 等类名混淆时可用）
  function findPanelCellByText(panel, targetText) {
    const candidates = Array.from(panel.querySelectorAll("td, th, div, span, li, button, label, a"))
      .filter((el) => isVisible(el)
        && !el.closest(`#${SIDEBAR_ID}`)
        && !el.closest("[class*='header'], [class*='Header'], [class*='footer'], [class*='Footer']"));
    const exact = candidates.filter((el) => (el.textContent || "").trim() === targetText);
    if (!exact.length) return null;
    // 取面积最小的节点，避免整块面板容器被误点
    return exact.reduce((best, el) => {
      const a = el.getBoundingClientRect();
      const b = best.getBoundingClientRect();
      return a.width * a.height < b.width * b.height ? el : best;
    });
  }

  async function clickPickerPanelElement(panel, targetText) {
    // 月份选择器：查找 "1月"-"12月"、"Jan"-"Dec" 等
    const monthPatterns = [
      `[data-month]`,
      `.ant-picker-cell-inner`,
      `.el-date-table td`,
      `.arco-picker-cell-inner`,
      `.semi-datepicker-month-grid-item`,
      ".phoenix-calendar-month-panel-body div",
      "[role='gridcell']"
    ];
    for (const selector of monthPatterns) {
      const cells = Array.from(panel.querySelectorAll(selector)).filter(isVisible);
      const match = cells.find((cell) => {
        const text = cell.textContent?.trim() || "";
        const ariaLabel = cell.getAttribute("aria-label") || "";
        // 文本匹配
        if (text === targetText || ariaLabel.includes(targetText) || text.includes(targetText)) {
          return true;
        }
        // data-month 属性数字匹配（如 targetText="9月" 匹配 data-month="8"，因为 data-month 从 0 开始）
        const dataMonth = cell.getAttribute("data-month");
        if (dataMonth !== null) {
          const monthNum = parseInt(dataMonth, 10) + 1; // data-month 从 0 开始
          const targetMonthMatch = targetText.match(/(\d{1,2})/);
          if (targetMonthMatch && parseInt(targetMonthMatch[1], 10) === monthNum) {
            return true;
          }
        }
        return false;
      });
      if (match) {
        return clickPanelCell(match);
      }
    }
    // 年份选择器：查找四位年份（面板标题里的年份不算，交给 navigatePanelYear 处理）
    if (/^\d{4}$/.test(targetText)) {
      const yearCells = Array.from(panel.querySelectorAll(
        ".ant-picker-cell-inner, .el-year-table td, .arco-picker-cell-inner, [role='gridcell']"
      )).filter((cell) => isVisible(cell)
        && !cell.closest("[class*='header'], [class*='Header'], [class*='footer'], [class*='Footer']"));
      const match = yearCells.find((cell) => (cell.textContent?.trim() || "") === targetText);
      if (match) {
        return clickPanelCell(match);
      }
    }
    // 日期选择器：查找 1-31 的日期
    if (/^\d{1,2}$/.test(targetText)) {
      const dayCells = Array.from(panel.querySelectorAll(
        ".ant-picker-cell-inner, .el-date-table td, .arco-picker-cell-inner, .phoenix-calendar-date-panel div, [role='gridcell']"
      )).filter(isVisible);
      const match = dayCells.find((cell) => (cell.textContent?.trim() || "") === targetText);
      if (match) {
        return clickPanelCell(match);
      }
    }
    // 通用兜底：按文本在面板内找单元格
    return clickPanelCell(findPanelCellByText(panel, targetText));
  }

  // 通过面板头部的上/下年按钮翻到目标年份（北森 phoenix、Moka 等只有标题年份、没有年份格子的组件）
  async function navigatePanelYear(panel, targetYear) {
    let header = panel.querySelector("[class*='header'], [class*='Header']");
    let yearLabel = null;
    if (!header) {
      // 类名混淆时：把第一个"纯四位年份"文本的父节点当作标题栏
      yearLabel = Array.from(panel.querySelectorAll("span, div, button, a, td"))
        .find((el) => el.children.length === 0 && /^(19|20)\d{2}$/.test((el.textContent || "").trim()));
      header = yearLabel?.parentElement || null;
    }
    if (!header) return;

    const MAX_CLICKS = 60;
    for (let i = 0; i < MAX_CLICKS; i += 1) {
      const years = ((header.textContent || "").match(/(19|20)\d{2}/g) || []).map((t) => parseInt(t, 10));
      if (!years.length) return;

      const low = Math.min(...years);
      const high = Math.max(...years);
      if (targetYear >= low && targetYear <= high) return;

      const navButtons = Array.from(header.querySelectorAll("button, [role='button'], i, span, [class*='btn'], [class*='icon'], [class*='arrow']"))
        .filter((el) => el !== yearLabel && isVisible(el) && typeof el.click === "function");
      if (navButtons.length < 2) return;

      const hintsOf = (el) => `${typeof el.className === "string" ? el.className : el.getAttribute?.("class") || ""} ${el.getAttribute?.("aria-label") || ""} ${el.getAttribute?.("title") || ""}`;
      const prev = navButtons.find((el) => /prev|left|before|上/i.test(hintsOf(el))) || navButtons[0];
      const next = navButtons.find((el) => /next|right|after|下/i.test(hintsOf(el))) || navButtons[navButtons.length - 1];
      if (prev === next) return;

      (targetYear < low ? prev : next).click();
      await new Promise((r) => window.setTimeout(r, 80));
    }
  }

  async function selectComboboxOption(element, value, container) {
    // 有些框架需要点击容器（而非输入框本身）才能打开下拉
    const clickTarget = container || element;
    // 同时触发 mousedown 和 click，部分框架只响应 mousedown
    clickTarget.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    clickTarget.click();
    element.focus();

    const target = String(value ?? "").trim();
    if (!target) return false;

    // 如果触发器本身是搜索输入框（Ant Design showSearch 等），先在其中输入目标值以过滤选项
    const containerCls = container?.className || "";
    const inputPlaceholder = (element instanceof HTMLInputElement ? element.getAttribute("placeholder") || "" : "").toLowerCase();
    const isTriggerSearchInput = (element instanceof HTMLInputElement)
      && (container?.classList?.contains("ant-select-show-search")
        || container?.classList?.contains("el-select-filterable")
        || container?.classList?.contains("arco-select-with-search")
        || container?.classList?.contains("semi-select-filterable")
        || /search|filter|可搜索/.test(containerCls)
        || element.type === "search"
        || /搜索|search|筛选|filter/.test(inputPlaceholder));
    if (isTriggerSearchInput && element instanceof HTMLInputElement) {
      const inputDescriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
      if (inputDescriptor?.set) {
        inputDescriptor.set.call(element, target);
      } else {
        element.value = target;
      }
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => window.setTimeout(resolve, 200));
    }

    // 部分平台（北森/Moka）只响应箭头图标的点击，输入框本身点不开下拉
    const iconTargets = container && typeof container.querySelectorAll === "function"
      ? Array.from(container.querySelectorAll("[class*='arrow'], [class*='suffix'], [class*='icon'], [role='img'], svg"))
        .filter((el) => isVisible(el) && typeof el.click === "function")
      : [];

    let sawPopup = false;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (attempt > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, 50));
      }

      // 先尝试定位到当前触发器对应的弹出层，避免多个下拉同时存在时选错
      const popup = findComboboxPopupContainer(element);
      if (popup) sawPopup = true;
      if (!popup && iconTargets.length && attempt < 4) {
        const retryTarget = attempt % 2 === 1 ? iconTargets[0] : iconTargets[iconTargets.length - 1];
        retryTarget.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        retryTarget.click();
        continue;
      }

      // 无弹出层时优先在容器内查找（部分框架把选项渲染在容器内部），再兜底到整个 document
      const searchRoot = popup || (container && container.querySelector("[role='option'], [class*='option'], [class*='dropdown-item']") ? container : document);

      // 如果弹出层内有搜索输入框（Ant Design showSearch 等），先输入关键词过滤选项
      if (popup) {
        const dropdownSearchInput = popup.querySelector(
          "input[type='text'], input[type='search'], input:not([type])"
        );
        if (dropdownSearchInput && isVisible(dropdownSearchInput) && !dropdownSearchInput.closest(`#${SIDEBAR_ID}`)) {
          if (dropdownSearchInput.value !== target) {
            dropdownSearchInput.focus();
            const inputDescriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
            if (inputDescriptor?.set) {
              inputDescriptor.set.call(dropdownSearchInput, "");
            } else {
              dropdownSearchInput.value = "";
            }
            dropdownSearchInput.dispatchEvent(new Event("input", { bubbles: true }));
            dropdownSearchInput.dispatchEvent(new Event("change", { bubbles: true }));
            for (const char of target) {
              dropdownSearchInput.dispatchEvent(new KeyboardEvent("keydown", { key: char, bubbles: true }));
              if (inputDescriptor?.set) {
                inputDescriptor.set.call(dropdownSearchInput, dropdownSearchInput.value + char);
              } else {
                dropdownSearchInput.value += char;
              }
              dropdownSearchInput.dispatchEvent(new Event("input", { bubbles: true }));
              dropdownSearchInput.dispatchEvent(new KeyboardEvent("keyup", { key: char, bubbles: true }));
            }
            dropdownSearchInput.dispatchEvent(new Event("change", { bubbles: true }));
            await new Promise((resolve) => window.setTimeout(resolve, 200));
          }
        }
      }

      let optionElements = Array.from(searchRoot.querySelectorAll(
        "[role='option'], .ant-select-item-option, .el-select-dropdown__item, .arco-select-option, .semi-select-option, .phoenix-select-option, .t-select-option, .next-menu-item, [class*='select-option'], [class*='dropdown-item']"
      )).filter((option) => isVisible(option)
        && !option.closest(`#${SIDEBAR_ID}`)
        && option.getAttribute("aria-disabled") !== "true"
        && !option.disabled);

      // 类名混淆的平台（Moka/北森用 styled-components）没有可辨认的选项类名，退回弹出层内的文本叶子节点
      if (!optionElements.length && searchRoot !== document) {
        optionElements = Array.from(searchRoot.querySelectorAll("li, div, span, label, button, a"))
          .filter((el) => el.children.length === 0
            && (el.textContent || "").trim()
            && isVisible(el)
            && !el.closest(`#${SIDEBAR_ID}`)
            && !el.closest("[class*='header'], [class*='Header'], [class*='footer'], [class*='Footer']"));
      }

      const optionIndex = self.ResumeProAIHelpers?.findSelectOptionIndex?.(
        optionElements.map((option) => ({
          value: option.getAttribute("data-value") || option.getAttribute("value") || "",
          text: option.getAttribute("aria-label") || option.getAttribute("data-label") || option.getAttribute("title") || option.textContent?.trim() || "",
          disabled: false
        })),
        value
      ) ?? -1;

      if (optionIndex >= 0) {
        return clickPanelCell(optionElements[optionIndex]);
      }
    }

    // 兜底：用键盘在下拉里选（部分框架拦截了 click 但响应键盘事件）
    // 下拉压根没打开时别再空转 50 次按键，直接失败，把时间留给后面的字段
    if (!sawPopup) return false;

    // 键盘事件要发到输入框上，不是容器 div
    const keyTarget = (element instanceof HTMLInputElement)
      ? element
      : (container?.querySelector("input:not([type='hidden']):not([disabled])") || element);

    for (let i = 0; i < 50; i += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 30));
      const popup = findComboboxPopupContainer(element);
      const highlighted = popup?.querySelector("[role='option'][aria-selected='true'], .ant-select-item-option-selected, .el-select-dropdown__item.hover, .arco-select-option-selected, .semi-select-option-selected, [class*='select-option'][class*='active'], [class*='select-option'][class*='selected'], [class*='dropdown-item'][class*='active'], [class*='dropdown-item'][class*='selected']");
      const highlightedText = highlighted?.textContent?.trim() || "";
      if (highlightedText && self.ResumeProAIHelpers?.findSelectOptionIndex?.([
        { value: "", text: highlightedText }
      ], target) >= 0) {
        keyTarget.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
        return true;
      }
      keyTarget.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", bubbles: true }));
    }

    return false;
  }

  function setElementValue(element, value) {
    if (element && typeof element === "object" && element.kind === "radio") {
      const radioOptions = element.elements.map((radio) => ({ value: radio.value, text: getRadioOptionLabel(radio), disabled: radio.disabled }));
      const radioIndex = self.ResumeProAIHelpers?.findSelectOptionIndex?.(radioOptions, value) ?? -1;
      const matchedRadio = radioIndex >= 0 ? element.elements[radioIndex] : null;

      if (!matchedRadio) {
        return false;
      }

      matchedRadio.checked = true;
      matchedRadio.dispatchEvent(new Event("input", { bubbles: true }));
      matchedRadio.dispatchEvent(new Event("change", { bubbles: true }));
      matchedRadio.click();
      return true;
    }

    const pickerType = (element && typeof element === "object" && element.kind === "element") ? element.pickerType : null;
    const pickerInputType = (element && typeof element === "object" && element.kind === "element") ? (element.pickerInputType || "date") : "date";
    const customSelectType = (element && typeof element === "object" && element.kind === "element") ? element.customSelectType : null;
    const selectContainer = (element && typeof element === "object" && element.kind === "element") ? element.selectContainer : null;

    if (element && typeof element === "object" && element.kind === "element") {
      element = element.element;
    }

    // 处理自定义下拉组件（Ant Design、Element UI 等）
    if (customSelectType && element instanceof HTMLElement) {
      return selectComboboxOption(element, value, selectContainer);
    }

    // 日期控件也经常挂 role="combobox"（北森、Ant Design 都这样），已经认出是日期面板的就别当下拉框点
    if (element instanceof HTMLInputElement
      && element.readOnly
      && element.getAttribute("role") === "combobox"
      && !pickerType) {
      return selectComboboxOption(element, value, selectContainer);
    }

    if (element instanceof HTMLInputElement && ["date", "month", "datetime-local", "time"].includes(element.type)) {
      const normalized = self.ResumeProAIHelpers?.normalizeDateValue?.(value, element.type) ?? value;
      const descriptor = Object.getOwnPropertyDescriptor(element.constructor.prototype, "value");
      element.dispatchEvent(new FocusEvent("focus", { bubbles: true }));
      if (descriptor?.set) {
        descriptor.set.call(element, normalized);
      } else {
        element.value = normalized;
      }
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      element.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
      return element.value === normalized;
    }

    if (element instanceof HTMLInputElement && (pickerType === "antd" || pickerType === "element" || pickerType === "generic" || pickerType === "arco" || pickerType === "semi" || pickerType === "phoenix")) {
      const normalized = self.ResumeProAIHelpers?.normalizeDateValue?.(value, pickerInputType) ?? value;
      // 同时触发 mousedown 和 click，部分框架只响应 mousedown
      element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      element.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      return new Promise((resolve) => {
        window.setTimeout(async () => {
          try {
            // 优先尝试通过面板交互填写（月份/年份/日期选择器等需要点击面板内元素）
            const panel = await findPickerPanel();
            if (panel) {
              // 提取目标文本：月份用 "9月"，年份用 "2026"，日期再点几号
              const panelTarget = (() => {
                const monthFormats = (monthNum) => [`${monthNum}月`, `${String(monthNum).padStart(2, "0")}月`];
                const full = normalized.match(/^(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
                if (full && pickerInputType !== "month") {
                  const monthNum = parseInt(full[2], 10);
                  return { num: monthNum, formats: monthFormats(monthNum), day: parseInt(full[3], 10), year: full[1] };
                }
                // 必须按 "年-月" 取月份，直接抓前两位数字会把 2005 里的 "20" 当成月份
                const ym = normalized.match(/(\d{4})\D+(\d{1,2})/);
                if (ym) {
                  const monthNum = parseInt(ym[2], 10);
                  if (monthNum >= 1 && monthNum <= 12) {
                    return { num: monthNum, formats: monthFormats(monthNum), year: ym[1] };
                  }
                }
                const monthOnly = normalized.match(/(\d{1,2})\s*月/);
                if (monthOnly) {
                  const monthNum = parseInt(monthOnly[1], 10);
                  if (monthNum >= 1 && monthNum <= 12) {
                    return { num: monthNum, formats: monthFormats(monthNum) };
                  }
                }
                return { num: null, formats: [normalized] };
              })();

              // 先把面板翻到目标年份：优先点年份格子，没有年份格子就翻标题年份（北森/Moka）
              if (panelTarget.year && /^\d{4}$/.test(panelTarget.year)) {
                const clickedYear = await clickPickerPanelElement(panel, panelTarget.year);
                if (!clickedYear) {
                  await navigatePanelYear(panel, parseInt(panelTarget.year, 10));
                }
                await new Promise((r) => window.setTimeout(r, 300));
              }

              // 点击月份
              if (panelTarget.formats) {
                let monthClicked = false;
                for (const fmt of panelTarget.formats) {
                  if (await clickPickerPanelElement(panel, fmt)) {
                    monthClicked = true;
                    break;
                  }
                }
                // 如果标准格式没匹配，尝试中文数字
                if (!monthClicked && panelTarget.num) {
                  const chineseMonths = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二"];
                  const cnMonth = chineseMonths[panelTarget.num - 1];
                  if (cnMonth) {
                    await clickPickerPanelElement(panel, `${cnMonth}月`);
                  }
                }
                await new Promise((r) => window.setTimeout(r, 300));

                // 选了年月后面板通常会换成日期网格，再点几号
                if (panelTarget.day) {
                  const dayText = `${panelTarget.day}`;
                  await clickPickerPanelElement(panel, dayText);
                }
              } else if (typeof panelTarget === "string") {
                await clickPickerPanelElement(panel, panelTarget);
              }

              // 等待面板关闭（选择完成后面板会自动关闭）
              await new Promise((r) => window.setTimeout(r, 200));
              const panelStillVisible = await findPickerPanel();
              if (!panelStillVisible || element.value) {
                resolve(true);
                return;
              }
            }

            // 面板交互失败，回退到直接设置输入框值
            const wasReadOnly = element.readOnly;
            if (wasReadOnly) element.readOnly = false;

            const descriptor = Object.getOwnPropertyDescriptor(element.constructor.prototype, "value");
            if (descriptor?.set) {
              descriptor.set.call(element, normalized);
            } else {
              element.value = normalized;
            }
            element.dispatchEvent(new Event("input", { bubbles: true }));
            element.dispatchEvent(new Event("change", { bubbles: true }));
            element.dispatchEvent(new FocusEvent("blur", { bubbles: true }));

            if (wasReadOnly) element.readOnly = true;

            if (element.value === normalized) {
              resolve(true);
              return;
            }

            // 逐字符输入兜底
            element.value = "";
            element.dispatchEvent(new Event("input", { bubbles: true }));
            for (const char of normalized) {
              element.dispatchEvent(new KeyboardEvent("keydown", { key: char, bubbles: true }));
              element.dispatchEvent(new KeyboardEvent("keypress", { key: char, bubbles: true }));
              element.value += char;
              element.dispatchEvent(new Event("input", { bubbles: true }));
              element.dispatchEvent(new KeyboardEvent("keyup", { key: char, bubbles: true }));
            }
            element.dispatchEvent(new Event("change", { bubbles: true }));
            element.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
            resolve(element.value === normalized || element.value.length > 0);
          } catch (_) {
            resolve(false);
          }
        }, 200);
      });
    }

    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      const descriptor = Object.getOwnPropertyDescriptor(element.constructor.prototype, "value");
      if (descriptor?.set) {
        descriptor.set.call(element, value);
      } else {
        element.value = value;
      }
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }

    if (element instanceof HTMLSelectElement) {
      const selectOptions = Array.from(element.options).map((option) => ({ value: option.value, text: option.text, disabled: option.disabled }));
      const optionIndex = self.ResumeProAIHelpers?.findSelectOptionIndex?.(selectOptions, value) ?? -1;
      const matchedOption = optionIndex >= 0 ? element.options[optionIndex] : null;

      if (!matchedOption) {
        return false;
      }

      // 走原型上的 setter：有些框架在实例上拦了 value，直接赋值会被吞掉。
      const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
      if (descriptor?.set) {
        descriptor.set.call(element, matchedOption.value);
      } else {
        element.value = matchedOption.value;
      }
      // 几个选项 value 相同时（常见的是一串空值），按 value 赋值会落到第一个，按下标补一次。
      if (element.selectedIndex !== optionIndex) {
        element.selectedIndex = optionIndex;
      }
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return element.selectedIndex === optionIndex;
    }

    if (element instanceof HTMLElement && element.isContentEditable) {
      element.textContent = value;
      element.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }

    return false;
  }

  function highlightFilledField(fieldEntry, value) {
    getHighlightTargets(fieldEntry, value).forEach((target) => {
      if (!(target instanceof HTMLElement)) {
        return;
      }

      if (!isInViewport(target)) {
        target.scrollIntoView({ block: "center", behavior: "smooth" });
        queueFieldHighlightWhenVisible(target);
        return;
      }

      applyFieldHighlight(target);
    });
  }

  function queueFieldHighlightWhenVisible(target, attempt = 0) {
    clearFieldHighlightTimer(target);
    const timer = window.setTimeout(() => {
      if (isInViewport(target) || attempt >= 18) {
        applyFieldHighlight(target);
        return;
      }

      queueFieldHighlightWhenVisible(target, attempt + 1);
    }, 100);
    fieldHighlightTimers.set(target, timer);
  }

  function applyFieldHighlight(target) {
    clearFieldHighlightTimer(target);
    target.classList.remove(FIELD_HIGHLIGHT_CLASS);
    void target.offsetWidth;
    target.classList.add(FIELD_HIGHLIGHT_CLASS);

    const timer = window.setTimeout(() => {
      target.classList.remove(FIELD_HIGHLIGHT_CLASS);
      fieldHighlightTimers.delete(target);
    }, 2800);
    fieldHighlightTimers.set(target, timer);
  }

  function clearFieldHighlightTimer(target) {
    if (!fieldHighlightTimers.has(target)) {
      return;
    }

    window.clearTimeout(fieldHighlightTimers.get(target));
    fieldHighlightTimers.delete(target);
  }

  function getHighlightTargets(fieldEntry, value) {
    if (fieldEntry?.kind === "radio") {
      const trimmedValue = String(value || "").trim();
      const matchedRadio = fieldEntry.elements.find((radio) => {
        const optionText = getRadioOptionLabel(radio);
        return optionText === trimmedValue || radio.value === trimmedValue;
      });

      if (!matchedRadio) {
        return [];
      }

      return [matchedRadio.labels?.[0] || matchedRadio.closest("label") || matchedRadio];
    }

    const element = fieldEntry?.kind === "element" ? fieldEntry.element : fieldEntry;

    if (!(element instanceof HTMLElement)) {
      return [];
    }

    if (fieldEntry?.pickerType) {
      return [element.closest(".ant-picker, .el-date-editor, .arco-picker, .semi-picker, [class*='date-picker'], [class*='datepicker'], [class*='DatePicker']") || element];
    }

    return [element];
  }

  function isInViewport(element) {
    const rect = element.getBoundingClientRect();
    return rect.top >= 0
      && rect.left >= 0
      && rect.bottom <= (window.innerHeight || document.documentElement.clientHeight)
      && rect.right <= (window.innerWidth || document.documentElement.clientWidth);
  }

  function injectFieldHighlightStyles() {
    if (document.getElementById(FIELD_HIGHLIGHT_STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = FIELD_HIGHLIGHT_STYLE_ID;
    style.textContent = FIELD_HIGHLIGHT_STYLE_TEXT;
    (document.head || document.documentElement).appendChild(style);
  }

  function profileResumeFields() {
    return self.ResumeProProfile?.profileToResumeFields(state.currentStore?.profile) || [];
  }

  function buildProfileChipsHtml(profileFields) {
    const groups = new Map();

    profileFields.forEach((field) => {
      if (!groups.has(field.group)) groups.set(field.group, []);
      groups.get(field.group).push(field);
    });

    return Array.from(groups, ([name, groupFields]) => `
      <section class="resume-pro__group">
        <div class="resume-pro__group-name">我的信息 · ${escapeHtml(name)}</div>
        <div class="resume-pro__chips">
          ${groupFields.map((field) => `
            <button
              class="resume-pro__chip"
              type="button"
              data-chip-id="${escapeHtml(`profile:${name}:${field.key}`)}"
              data-value="${escapeHtml(field.value)}"
              title="${escapeHtml(field.value)}"
            >
              ${escapeHtml(field.key)}
            </button>
          `).join("")}
        </div>
      </section>
    `).join("");
  }

  // 填完之后，网页上没匹配上、也还空着的字段，问一句要不要加进「我的信息」。
  // 这样档案里的字段来自真实表单，用户补一次内容，下次同样的字段就能自动填。
  function offerUnansweredFields(candidates, resumeFields) {
    const api = self.ResumeProProfile;
    const card = shadowRoot?.querySelector("#resume-pro-profile-offer");
    if (!api || !card) return;

    const labels = api.pickUnansweredLabels(candidates, api.knownFieldKeys(state.currentStore?.profile, resumeFields));

    if (!labels.length) {
      closeProfileOffer();
      return;
    }

    state.profileOfferLabels = labels;
    state.profileOfferFields = resumeFields;
    state.profileOfferCandidates = candidates;
    const shown = labels.slice(0, 5).join("、");
    card.querySelector("#resume-pro-profile-offer-text").textContent =
      `网页上还有 ${labels.length} 个字段空着：${shown}${labels.length > 5 ? " 等" : ""}。加到「我的信息」并补上内容，下次就能自动填。`;
    card.hidden = false;
  }

  function closeProfileOffer() {
    const card = shadowRoot?.querySelector("#resume-pro-profile-offer");
    if (card) card.hidden = true;
    state.profileOfferLabels = [];
    state.profileOfferFields = [];
    state.profileOfferCandidates = [];
  }

  async function addUnansweredToProfile() {
    // 卡片出来之后用户可能已经手动填了几个，点的时候按网页现在的样子再挑一遍。
    const candidates = state.profileOfferCandidates || [];
    const labels = (state.profileOfferLabels || []).filter((label) => candidates.some((candidate) =>
      String(candidate.label ?? "").trim() === label && candidate.entry && !hasExistingValue(candidate.entry)));
    const resumeFields = state.profileOfferFields;

    if (!labels.length) {
      closeProfileOffer();
      showStatus("这些字段已经在网页上填好了。", "success");
      return;
    }

    try {
      // 用户点了才写，并且只读写 profile 这一个键，不碰模板和 AI 配置。
      const stored = await chrome.storage.local.get("profile");
      const { profile, added, full } = self.ResumeProProfile.addPendingFields(stored.profile, labels, resumeFields);

      if (!added) {
        if (!full) closeProfileOffer();
        showStatus(full ? "补充字段已经满了，先在管理面板里删掉用不上的。" : "这些字段「我的信息」里已经有了。", full ? "error" : "success");
        return;
      }

      await chrome.storage.local.set({ profile });
      // 写成功才收起卡片；写失败时卡片留着，可以直接再点一次。
      closeProfileOffer();
      showStatus(`已把 ${added} 个字段加到「我的信息」，在管理面板里补上内容。`, "success", true);
      await openManager("profile");
    } catch (error) {
      showStatus(`没有加进去：${error.message || "写入失败"}`, "error");
    }
  }

  function flattenTemplateFields(template) {
    return template.groups.flatMap((group) => group.fields.map((field) => ({
      group: group.name,
      key: field.key,
      value: field.value
    })));
  }

  function getRadioOptionLabel(radio) {
    const directLabel = radio.labels?.[0]?.textContent?.trim();

    if (directLabel) {
      return directLabel;
    }

    const wrappingLabel = radio.closest("label")?.textContent?.trim();
    if (wrappingLabel) {
      return wrappingLabel;
    }

    return radio.value?.trim() || "";
  }

  function findNearestGroupLabel(element) {
    const sectionSelectors = ["fieldset", "[role='group']", ".form-item", ".ant-form-item", "tr", "li", "section", "td"];

    for (const selector of sectionSelectors) {
      const container = element.closest(selector);

      if (!container) {
        continue;
      }

      const labelCandidate = container.querySelector("legend, label, th, .label, .form-label, .ant-form-item-label");
      const text = labelCandidate?.textContent?.trim().replace(/[*\s]+$/g, "").trim();

      if (text && text.length < 40) {
        return text;
      }
    }

    return "";
  }

  function sanitizeLabelText(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .replace(/^\*+/, "")
      .replace(/\*+$/g, "")
      .trim();
  }

  function openManager(tab = "") {
    const managerPanel = shadowRoot?.querySelector("#resume-pro-manager-panel");
    const managerFrame = shadowRoot?.querySelector("#resume-pro-manager-frame");
    if (!managerPanel || !managerFrame) return;

    managerPanel.hidden = false;
    shadowRoot.querySelector(".resume-pro")?.classList.add("is-managing");
    const hash = tab === "profile" ? "#profile" : "";
    const targetUrl = `${chrome.runtime.getURL("popup.html")}${hash}`;
    if (managerFrame.src !== targetUrl) managerFrame.src = targetUrl;
  }

  function closeManager() {
    const managerPanel = shadowRoot?.querySelector("#resume-pro-manager-panel");
    if (managerPanel) managerPanel.hidden = true;
    shadowRoot?.querySelector(".resume-pro")?.classList.remove("is-managing");
  }

  function isFillTarget(target) {
    return (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    );
  }

  function getActiveTemplate(store) {
    if (!store?.templates?.length) {
      return null;
    }

    return store.templates.find((template) => template.id === store.activeTemplateId) || store.templates[0];
  }

  function showStatus(message, variant, persist = false) {
    const statusElement = shadowRoot?.querySelector("#resume-pro-status");

    if (!statusElement) {
      return;
    }

    statusElement.textContent = message;
    statusElement.className = `resume-pro__status is-visible is-${variant}`;

    if (state.statusTimer) {
      clearTimeout(state.statusTimer);
      state.statusTimer = null;
    }

    if (persist) {
      return;
    }

    state.statusTimer = window.setTimeout(() => {
      statusElement.className = "resume-pro__status";
      statusElement.textContent = "";
    }, 2400);
  }

  function startDrag(event) {
    if (event.target.closest("button, select, input")) {
      return;
    }

    const host = document.getElementById(SIDEBAR_ID);
    const rect = host.getBoundingClientRect();
    state.dragging = true;
    state.dragOffsetX = event.clientX - rect.left;
    state.dragOffsetY = event.clientY - rect.top;
    shadowRoot?.querySelector(".resume-pro")?.classList.add("is-dragging");
  }

  function onDrag(event) {
    if (!state.dragging) {
      return;
    }

    const sidebar = document.getElementById(SIDEBAR_ID);
    const width = sidebar.offsetWidth;
    const height = sidebar.offsetHeight;
    const nextLeft = clamp(event.clientX - state.dragOffsetX, 12, window.innerWidth - width - 12);
    const nextTop = clamp(event.clientY - state.dragOffsetY, 12, window.innerHeight - height - 12);

    sidebar.style.left = `${nextLeft}px`;
    sidebar.style.top = `${nextTop}px`;
    sidebar.style.right = "auto";
  }

  function stopDrag() {
    if (!state.dragging) {
      return;
    }

    state.dragging = false;
    shadowRoot?.querySelector(".resume-pro")?.classList.remove("is-dragging");
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), Math.max(min, max));
  }

  function inferPickerInputType(container, inner) {
    const cls = container.className || "";
    const placeholder = (inner.getAttribute("placeholder") || "").toLowerCase();
    if (/time/i.test(cls) || /时间|hh:mm/.test(placeholder)) return "time";
    if (/month/i.test(cls) || /年月|月份|month/.test(placeholder)) return "month";
    if (/datetime/i.test(cls) || /日期.*时间|datetime/.test(placeholder)) return "datetime-local";
    return "date";
  }

  function isVisible(element) {
    const styles = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();

    return styles.display !== "none"
      && styles.visibility !== "hidden"
      && rect.width > 0
      && rect.height > 0;
  }

  function normalizeStore(rawState) {
    const templates = Array.isArray(rawState.templates)
      ? rawState.templates.map(normalizeTemplate).filter(Boolean)
      : [];

    const activeTemplateId = typeof rawState.activeTemplateId === "string"
      ? rawState.activeTemplateId
      : "";

    return {
      templates,
      activeTemplateId: templates.some((template) => template.id === activeTemplateId)
        ? activeTemplateId
        : templates[0]?.id || "",
      aiConfig: {
        apiUrl: String(rawState.aiConfig?.apiUrl ?? "https://api.openai.com/v1/chat/completions").trim(),
        model: String(rawState.aiConfig?.model ?? "gpt-4o-mini").trim(),
        apiKey: String(rawState.aiConfig?.apiKey ?? "")
      },
      profile: self.ResumeProProfile
        ? self.ResumeProProfile.normalizeProfile(rawState.profile)
        : { values: {}, family: [], custom: [] }
    };
  }

  function normalizeTemplate(template) {
    if (!template || typeof template !== "object") {
      return null;
    }

    const groups = Array.isArray(template.groups)
      ? template.groups
          .map((group) => {
            if (!group || typeof group !== "object") {
              return null;
            }

            const fields = Array.isArray(group.fields)
              ? group.fields
                  .map((field) => {
                    if (!field || typeof field !== "object") {
                      return null;
                    }

                    return {
                      key: String(field.key ?? "").trim(),
                      value: String(field.value ?? "")
                    };
                  })
                  .filter((field) => field && field.key)
              : [];

            return {
              name: String(group.name ?? "").trim() || "未分类",
              fields
            };
          })
          .filter((group) => group && group.fields.length)
      : [];

    return {
      id: typeof template.id === "string" && template.id.trim() ? template.id : crypto.randomUUID(),
      name: String(template.name ?? "").trim() || "未命名模板",
      groups
    };
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  if (self.__RESUME_PRO_TEST__) {
    self.ResumeProHighlightTest = {
      handleRepeatFillClick,
      formatFillDiagnostics,
      getHighlightTargets,
      handleAiFillClick,
      handleChipAction,
      handleFieldChipClick,
      highlightFilledField,
      injectFieldHighlightStyles,
      openManager,
      closeManager,
      isInViewport,
      applyChipValue,
      composeChipText,
      syncChipSelectionState,
      setElementValue,
      setCurrentStore(store) {
        state.currentStore = store;
      },
      setLastFocusedField(field) {
        state.lastFocusedField = field;
      },
      setShadowRoot(root) {
        shadowRoot = root;
      }
    };
  }
})();
