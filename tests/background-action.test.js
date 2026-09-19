"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("toolbar click injects the assistant into an already-open page and retries", async () => {
  let clickListener;
  let sendCount = 0;
  const injections = [];
  const context = vm.createContext({
    console,
    setTimeout: (callback) => {
      callback();
      return 1;
    },
    chrome: {
      action: { onClicked: { addListener(listener) { clickListener = listener; } } },
      tabs: {
        async sendMessage(tabId, message) {
          sendCount += 1;
          assert.equal(tabId, 9);
          assert.equal(message.type, "TOGGLE_SIDEBAR_V2");
          if (sendCount === 1) throw new Error("no receiver");
          return { toggled: true, visible: true, protocol: 2 };
        }
      },
      scripting: { async executeScript(options) { injections.push(options); } },
      runtime: {
        getURL: (name) => `chrome-extension://test/${name}`,
        getContexts: async () => [],
        onMessage: { addListener() {} }
      },
      offscreen: { createDocument: async () => {} }
    }
  });

  const source = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
  vm.runInContext(source, context);
  await clickListener({ id: 9 });

  assert.equal(injections.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(injections[0].target)), { tabId: 9 });
  assert.equal(typeof injections[0].func, "function");
  assert.deepEqual(Array.from(injections[1].files), ["ai-client.js", "ai-helpers.js", "profile-fields.js", "form-agent.js", "content.js"]);
  assert.equal(sendCount, 2);
});
