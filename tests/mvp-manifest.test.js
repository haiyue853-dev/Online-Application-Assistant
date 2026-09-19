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
    new Set(["offscreen", "storage", "activeTab", "tabs", "scripting"]),
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

test("点击工具栏图标切换网页里的完整悬浮助手", () => {
  assert.equal(manifest.action.default_popup, undefined);
  assert.match(background, /TOGGLE_SIDEBAR/u);
  assert.match(background, /chrome\.scripting\.executeScript/u);
  assert.match(content, /TOGGLE_SIDEBAR/u);
  assert.match(content, /display:\s*"none"/u);
  assert.match(content, /resume-pro__close/u);
  assert.match(content, /aria-label="关闭助手"/u);
});

test("Edge 内部页面点击图标时打开扩展管理页面", () => {
  assert.match(background, /function canInjectIntoTab\(tab\)/u);
  assert.match(background, /chrome\.tabs\.create\(\{ url: chrome\.runtime\.getURL\("popup\.html"\) \}\)/u);
  assert.match(background, /!canInjectIntoTab\(tab\)/u);
});

test("侧边栏只保留简历填表功能", () => {
  assert.doesNotMatch(content, /link\//u);
  assert.doesNotMatch(content, /保存岗位到本地|确认已投递|留档到桌面/u);
  assert.doesNotMatch(content, /DESKTOP_[A-Z_]+/u);
});

test("打开管理面板后仍可拖动悬浮助手", () => {
  assert.match(
    content,
    /managerHeader\?\.addEventListener\("mousedown", startDrag\)/u,
  );
});
