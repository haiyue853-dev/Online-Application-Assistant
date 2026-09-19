"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "demo", "form.html"), "utf8");

test("本地演示页覆盖 MVP 的核心表单类型", () => {
  assert.match(html, /type="text"/u);
  assert.match(html, /type="tel"/u);
  assert.match(html, /type="date"/u);
  assert.match(html, /type="radio"/u);
  assert.match(html, /<select/u);
  assert.match(html, /<textarea/u);
});

test("本地演示页包含禁止自动填写的敏感字段", () => {
  assert.match(html, /type="password"/u);
  assert.match(html, /type="file"/u);
});
