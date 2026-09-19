"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const popup = fs.readFileSync(path.join(root, "popup.html"), "utf8");
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
const content = fs.readFileSync(path.join(root, "content.js"), "utf8");

test("轻量版只保留填表所需权限", () => {
  assert.deepStrictEqual(
    new Set(manifest.permissions),
    new Set(["offscreen", "storage", "activeTab", "tabs"]),
  );
  assert.equal(manifest.key, undefined);
  assert.doesNotMatch(background, /native|desktop|link\//iu);
});

test("管理页加载服务商预设且不再加载桌面模块", () => {
  assert.match(popup, /ai-providers\.js/u);
  assert.doesNotMatch(popup, /link\//u);
});

test("扩展以网申助手品牌展示", () => {
  assert.equal(manifest.name, "网申助手");
  assert.match(popup, /网申助手/u);
});

test("侧边栏只保留简历填表功能", () => {
  assert.doesNotMatch(content, /link\//u);
  assert.doesNotMatch(content, /保存岗位到本地|确认已投递|留档到桌面/u);
  assert.doesNotMatch(content, /DESKTOP_[A-Z_]+/u);
});
