const CONTENT_SCRIPT_FILES = ["ai-client.js", "ai-helpers.js", "profile-fields.js", "form-agent.js", "content.js"];

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function sendSidebarToggle(tabId) {
  return chrome.tabs.sendMessage(tabId, { type: "TOGGLE_SIDEBAR_V2" });
}

async function toggleSidebar(tabId) {
  try {
    const result = await sendSidebarToggle(tabId);
    if (result?.toggled && result?.protocol === 2) return;
  } catch {
    // No current content script is listening yet.
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => document.getElementById("resume-pro-sidebar")?.remove()
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    files: CONTENT_SCRIPT_FILES
  });

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await wait(100);
    try {
      const result = await sendSidebarToggle(tabId);
      if (result?.toggled && result?.protocol === 2) return;
    } catch {
      // The injected content script may still be initializing.
    }
  }

  throw new Error("页面助手初始化超时。");
}

function canInjectIntoTab(tab) {
  const url = String(tab?.url || "");
  return !/^(?:edge|chrome|about|devtools|view-source):/iu.test(url);
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  if (!canInjectIntoTab(tab)) {
    await chrome.tabs.create({ url: chrome.runtime.getURL("popup.html") });
    return;
  }
  try {
    await toggleSidebar(tab.id);
  } catch {
    console.warn("网申助手无法在当前页面显示；浏览器内部页面不支持注入扩展菜单。");
  }
});

// This service worker only creates the host. It never owns a long AI request.
let creatingHost = null;
async function ensureAiHost() {
  if (creatingHost) return creatingHost;
  creatingHost = (async () => {
    const url = chrome.runtime.getURL("ai-host.html");
    const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [url] });
    if (!contexts.length) {
      await chrome.offscreen.createDocument({
        url: "ai-host.html", reasons: ["WORKERS"],
        justification: "Run user-requested AI network operations in a dedicated worker without service-worker fetch time limits."
      });
    }
  })();
  try { await creatingHost; } finally { creatingHost = null; }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "ENSURE_AI_HOST") {
    ensureAiHost().then(() => sendResponse({ ready: true })).catch(() => {
      sendResponse({ ready: false, error: "无法启动 AI 请求进程，请更新 Chrome / Edge 或重新加载扩展。" });
    });
    return true;
  }
  return false;
});
