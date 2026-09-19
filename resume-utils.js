(function initResumeProUtils(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.ResumeProUtils = api;
  }
})(typeof self !== "undefined" ? self : globalThis, function createResumeProUtils() {
  function normalizeWhitespace(value) {
    return String(value ?? "")
      .replace(/[\t\f\v]+/g, " ")
      .replace(/ {2,}/g, " ")
      .trim();
  }

  function isCjkCharacter(value) {
    return /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/u.test(value);
  }

  function shouldInsertSpace(previousText, nextText, gap, fontHeight) {
    if (!previousText || !nextText || /\s$/u.test(previousText) || /^\s/u.test(nextText)) {
      return false;
    }

    const previousCharacter = previousText.at(-1);
    const nextCharacter = nextText.at(0);

    if (isCjkCharacter(previousCharacter) || isCjkCharacter(nextCharacter)) {
      return false;
    }

    return Number.isFinite(gap) && gap > Math.max(1, Math.abs(fontHeight || 0) * 0.08);
  }

  function extractPageText(items) {
    const lines = [];
    let line = "";
    let lastY = null;
    let lastEndX = null;
    let lastFontHeight = 0;

    const flushLine = () => {
      const normalized = normalizeWhitespace(line);

      if (normalized) {
        lines.push(normalized);
      }

      line = "";
      lastY = null;
      lastEndX = null;
      lastFontHeight = 0;
    };

    for (const item of Array.isArray(items) ? items : []) {
      const text = String(item?.str ?? "");

      if (!text.trim()) {
        if (item?.hasEOL) {
          flushLine();
        }
        continue;
      }

      const transform = item?.transform && typeof item.transform.length === "number" ? item.transform : [];
      const x = Number(transform[4]);
      const y = Number(transform[5]);
      const fontHeight = Number(item?.height) || Math.abs(Number(transform[3])) || 0;
      const yThreshold = Math.max(2, fontHeight * 0.35, lastFontHeight * 0.35);

      if (line && Number.isFinite(y) && Number.isFinite(lastY) && Math.abs(y - lastY) > yThreshold) {
        flushLine();
      }

      const gap = Number.isFinite(x) && Number.isFinite(lastEndX) ? x - lastEndX : Number.NaN;
      if (line && shouldInsertSpace(line, text, gap, fontHeight)) {
        line += " ";
      }

      line += text;
      lastY = Number.isFinite(y) ? y : lastY;
      lastEndX = Number.isFinite(x) ? x + (Number(item?.width) || 0) : null;
      lastFontHeight = fontHeight;

      if (item?.hasEOL) {
        flushLine();
      }
    }

    flushLine();
    return lines.join("\n").trim();
  }

  async function extractPdfText(pdfjsLib, arrayBuffer, documentOptions = {}) {
    if (!pdfjsLib || typeof pdfjsLib.getDocument !== "function") {
      throw new Error("未找到 PDF 解析库。");
    }

    const data = arrayBuffer instanceof Uint8Array ? arrayBuffer : new Uint8Array(arrayBuffer);
    const loadingTask = pdfjsLib.getDocument({
      ...documentOptions,
      data
    });

    try {
      const document = await loadingTask.promise;
      const pages = [];

      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const textContent = await page.getTextContent({ includeMarkedContent: false });
        const pageText = extractPageText(textContent.items);

        if (pageText) {
          pages.push(pageText);
        }

        page.cleanup?.();
      }

      document.cleanup?.();
      return pages.join("\n\n").trim();
    } finally {
      await loadingTask.destroy?.();
    }
  }

  function getPdfExtractionErrorMessage(error) {
    const name = String(error?.name ?? "");
    const message = String(error?.message ?? "").trim();

    if (name === "PasswordException") {
      return "PDF 已加密，暂时无法读取。请先移除密码，或改用 Word / TXT 简历。";
    }

    if (name === "InvalidPDFException" || name === "MissingPDFException") {
      return "PDF 文件无效或已损坏，请重新导出 PDF，或改用 Word / TXT 简历。";
    }

    if (/worker|dynamically imported module|module script|cmap|fetch/iu.test(message)) {
      return "PDF 解析组件加载失败，请在扩展管理页重新加载后重试。";
    }

    return "PDF 解析失败，请确认文件可以正常打开，或改用 Word / TXT 简历。";
  }

  function formatAiError(status, detail) {
    const suffix = normalizeWhitespace(detail);
    const messages = {
      400: "AI 请求格式或模型配置无效",
      401: "API Key 无效或无权访问该模型",
      402: "AI 账户余额不足",
      404: "AI 接口或模型未找到，请检查 API URL、模型名称或中转服务路由",
      429: "AI 请求过于频繁，请稍后重试"
    };
    const prefix = messages[status] || (status >= 500
      ? "AI 服务暂时不可用，请稍后重试"
      : `AI 请求失败（HTTP ${status}）`);

    return suffix && !suffix.startsWith("HTTP ") ? `${prefix}：${suffix}` : `${prefix}。`;
  }

  return {
    extractPageText,
    extractPdfText,
    formatAiError,
    getPdfExtractionErrorMessage
  };
});
