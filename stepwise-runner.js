(function (root) {
  function createStepwiseRunner({ items, execute, wait = async () => {}, onUpdate = () => {} }) {
    if (!Array.isArray(items) || typeof execute !== "function") throw new TypeError("逐步填写执行器需要字段列表和执行函数。");
    let index = 0;
    let status = "idle";
    let reason = "";
    let pauseRequested = false;
    const snapshot = () => ({ status, index, total: items.length, reason });
    const update = () => onUpdate(snapshot());
    async function run() {
      status = "running";
      reason = "";
      update();
      while (index < items.length) {
        if (status === "stopped") return snapshot();
        let result;
        try { result = await execute(items[index], index); }
        catch (error) { result = { ok: false, reason: error?.message || "填写执行失败" }; }
        if (status === "stopped") return snapshot();
        if (!result?.ok) {
          status = "paused";
          reason = result?.reason || "字段未确认";
          update();
          return snapshot();
        }
        index += 1;
        update();
        if (pauseRequested) {
          pauseRequested = false;
          status = "paused";
          reason = "用户暂停";
          update();
          return snapshot();
        }
        if (index < items.length) await wait(items[index - 1], index);
      }
      status = "completed";
      update();
      return snapshot();
    }
    return {
      get status() { return status; },
      start() { return status === "idle" ? run() : Promise.resolve(snapshot()); },
      resume() { return status === "paused" ? run() : Promise.resolve(snapshot()); },
      pause() { if (status === "running") pauseRequested = true; return snapshot(); },
      stop() { if (!['completed', 'stopped'].includes(status)) { status = "stopped"; reason = "用户停止"; update(); } return snapshot(); }
    };
  }
  root.ResumeProStepwise = { createStepwiseRunner };
  if (typeof module !== "undefined") module.exports = { createStepwiseRunner };
})(typeof self !== "undefined" ? self : globalThis);
