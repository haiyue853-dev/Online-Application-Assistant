"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const popupCss = fs.readFileSync(path.join(root, "popup.css"), "utf8");
const contentCss = fs.readFileSync(path.join(root, "content.css"), "utf8");

test("折叠悬浮窗保持品牌和标题横向显示", () => {
  assert.match(contentCss, /\.resume-pro\.is-collapsed\s*\{[^}]*width:\s*220px/isu);
  assert.match(contentCss, /\.resume-pro__eyebrow[^{]*\{[^}]*white-space:\s*nowrap/isu);
  assert.match(contentCss, /\.resume-pro__title[^{]*\{[^}]*white-space:\s*nowrap/isu);
  assert.match(contentCss, /\.resume-pro__window-actions[^{]*\{[^}]*flex-shrink:\s*0/isu);
});

test("窄管理页先排列标题再排列按钮，不把标题挤成竖排", () => {
  assert.match(popupCss, /\.template-toolbar\s*\{[^}]*flex-direction:\s*column/isu);
  assert.match(popupCss, /\.template-toolbar h2,\s*\.template-toolbar p\s*\{[^}]*white-space:\s*nowrap/isu);
  assert.match(popupCss, /\.toolbar-actions\s*\{[^}]*flex-wrap:\s*wrap/isu);
});
