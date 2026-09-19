"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const providers = require("../ai-providers.js");

test("内置常用 OpenAI 兼容服务商预设", () => {
  const ids = providers.listProviders().map((provider) => provider.id);

  assert.deepStrictEqual(ids, [
    "deepseek",
    "openai",
    "qwen",
    "moonshot",
    "zhipu",
    "siliconflow",
    "custom",
  ]);
});

test("服务商预设提供可直接调用的 Chat Completions 地址", () => {
  for (const provider of providers.listProviders()) {
    if (provider.id === "custom") continue;
    assert.match(provider.apiUrl, /^https:\/\//u);
    assert.match(provider.apiUrl, /\/chat\/completions$/u);
  }
});

test("可根据已保存的接口地址恢复服务商选择", () => {
  assert.equal(
    providers.findProviderId("https://api.deepseek.com/chat/completions"),
    "deepseek",
  );
  assert.equal(
    providers.findProviderId("https://example.com/v1/chat/completions"),
    "custom",
  );
});
