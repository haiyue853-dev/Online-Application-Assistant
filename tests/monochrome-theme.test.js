const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("管理页和网页侧边栏只使用黑白灰颜色", () => {
  const popup = fs.readFileSync(path.join(__dirname, "..", "popup.css"), "utf8");
  const sidebar = fs.readFileSync(path.join(__dirname, "..", "content.css"), "utf8");

  assert.match(popup, /--primary:\s*#111111/u);
  assert.match(popup, /\.primary-button[^}]*background:\s*#111111/su);
  assert.match(sidebar, /resume-pro__header[^}]*background:\s*#111111/su);
  assert.match(sidebar, /resume-pro__chip-actions[^}]*border-color:\s*#cccccc/su);
});
