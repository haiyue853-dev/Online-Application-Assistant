"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const aiProviders = require("../ai-providers.js");
const { loadPopup } = require("./helpers/popup-harness.js");

test("管理页渲染服务商预设并恢复已保存的选择", () => {
  const popup = loadPopup({ globals: { OnlineApplicationAiProviders: aiProviders } });
  const select = popup.element("ai-provider-select");

  popup.api.providers.renderOptions();
  popup.element("api-url-input").value = "https://api.deepseek.com/chat/completions";
  popup.api.providers.syncSelection();

  assert.match(select.innerHTML, /DeepSeek/u);
  assert.match(select.innerHTML, /通义千问/u);
  assert.equal(select.value, "deepseek");
});

test("切换服务商会更新接口地址和模型提示", () => {
  const popup = loadPopup({ globals: { OnlineApplicationAiProviders: aiProviders } });
  const select = popup.element("ai-provider-select");
  const apiUrl = popup.element("api-url-input");
  const model = popup.element("model-input");

  select.value = "siliconflow";
  popup.api.providers.handleChange();

  assert.equal(apiUrl.value, "https://api.siliconflow.cn/v1/chat/completions");
  assert.match(model.placeholder, /模型/u);
});

test("选择自定义接口时保留用户已经填写的地址", () => {
  const popup = loadPopup({ globals: { OnlineApplicationAiProviders: aiProviders } });
  popup.element("api-url-input").value = "https://example.com/v1/chat/completions";
  popup.element("ai-provider-select").value = "custom";

  popup.api.providers.handleChange();

  assert.equal(popup.element("api-url-input").value, "https://example.com/v1/chat/completions");
});

test("切换服务商后没有选择模型时不会误存 OpenAI 默认模型", async () => {
  const popup = loadPopup({ globals: { OnlineApplicationAiProviders: aiProviders } });
  popup.element("ai-provider-select").value = "deepseek";
  popup.api.providers.handleChange();

  await popup.api.providers.saveConfig({ preventDefault() {} });

  assert.equal(popup.store.aiConfig, undefined);
  assert.match(popup.lastStatusFrom("config-status"), /模型/u);
});
