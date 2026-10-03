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

test("本地演示页覆盖网申常见板块", () => {
  for (const section of ["基本信息", "居住地与通讯", "紧急联系人（亲属）", "求职意向", "教育经历", "实习经历", "项目经历", "技能与证书", "校园经历与自我评价", "必须跳过"]) {
    assert.ok(html.includes(`<legend>${section}</legend>`), `演示页缺少「${section}」板块`);
  }
  assert.match(html, /主要工作内容概述/u, "实习和项目都要有工作内容概述");
});

test("本地演示页覆盖下拉与月份等控件类型", () => {
  assert.match(html, /type="month"/u);
  assert.match(html, /<select name="preferredCities" multiple/u, "要多选下拉");
  assert.match(html, /type="number"/u);
  assert.match(html, /type="checkbox"/u);
});

test("本地演示页的表单字段 name 不重复", () => {
  const names = [...html.matchAll(/<\w+[^>]*\bname="([^"]+)"/gu)].map(([, name]) => name);
  const repeated = names.filter((name, index) => names.indexOf(name) !== index);
  // 单选/多选按钮同组复用 name 是有意为之
  const allowed = new Set(["politicalStatus", "acceptTransfer", "techStack"]);
  assert.deepEqual([...new Set(repeated)].filter((name) => !allowed.has(name)), []);
});
