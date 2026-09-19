(function initAiProviders(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.OnlineApplicationAiProviders = api;
  }
})(typeof self !== "undefined" ? self : globalThis, function createAiProviders() {
  const PROVIDERS = Object.freeze([
    {
      id: "deepseek",
      name: "DeepSeek",
      apiUrl: "https://api.deepseek.com/chat/completions",
      modelPlaceholder: "选择或填写 DeepSeek 模型",
    },
    {
      id: "openai",
      name: "OpenAI",
      apiUrl: "https://api.openai.com/v1/chat/completions",
      modelPlaceholder: "选择或填写 OpenAI 模型",
    },
    {
      id: "qwen",
      name: "通义千问（阿里云百炼）",
      apiUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
      modelPlaceholder: "例如 qwen-plus",
    },
    {
      id: "moonshot",
      name: "Kimi / Moonshot",
      apiUrl: "https://api.moonshot.cn/v1/chat/completions",
      modelPlaceholder: "选择或填写 Moonshot 模型",
    },
    {
      id: "zhipu",
      name: "智谱 GLM",
      apiUrl: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
      modelPlaceholder: "选择或填写 GLM 模型",
    },
    {
      id: "siliconflow",
      name: "SiliconFlow",
      apiUrl: "https://api.siliconflow.cn/v1/chat/completions",
      modelPlaceholder: "选择或填写模型",
    },
    {
      id: "custom",
      name: "自定义 OpenAI 兼容接口",
      apiUrl: "",
      modelPlaceholder: "填写服务商提供的模型名称",
    },
  ]);

  function listProviders() {
    return PROVIDERS.map((provider) => ({ ...provider }));
  }

  function getProvider(id) {
    return PROVIDERS.find((provider) => provider.id === id) || PROVIDERS.at(-1);
  }

  function normalizeEndpoint(input) {
    return String(input ?? "").trim().replace(/\/+$/u, "").toLowerCase();
  }

  function findProviderId(apiUrl) {
    const target = normalizeEndpoint(apiUrl);
    const matched = PROVIDERS.find((provider) => provider.apiUrl && normalizeEndpoint(provider.apiUrl) === target);
    return matched?.id || "custom";
  }

  return { findProviderId, getProvider, listProviders };
});
