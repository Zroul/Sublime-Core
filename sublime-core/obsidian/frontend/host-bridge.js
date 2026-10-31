(function (root, factory) {
  "use strict";

  var bridge = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = bridge;
  if (root) root.OBSIDIANHostBridge = bridge;
}(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  var DEFAULT_TIMEOUT_MS = 30000;
  var MAX_CAPTION_PAYLOAD_LENGTH = 1000000;

  function buildExpression(action, value) {
    var valueArgument;
    if (value === null || value === undefined) {
      valueArgument = "null";
    } else {
      if (action === "create_captions" &&
          (typeof value !== "object" || Object.prototype.toString.call(value) === "[object Array]")) {
        throw new Error("Caption data must be transferred as a structured object.");
      }
      valueArgument = JSON.stringify(value);
      if (typeof valueArgument !== "string") {
        throw new Error("The After Effects request could not be serialized safely.");
      }
      if (action === "create_captions" && valueArgument.length > MAX_CAPTION_PAYLOAD_LENGTH) {
        throw new Error("Caption data exceeds the 1,000,000-character safe transport limit.");
      }
      // ExtendScript parses the JSON subset as an object literal. Escape the two
      // JavaScript line-separator characters for older host-engine parsers.
      valueArgument = valueArgument.replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
    }
    return "OBSIDIAN_executePlan(" + JSON.stringify(action) + "," + valueArgument + ",\"\",null)";
  }

  function execute(evalScript, expression, timeoutMs) {
    if (typeof evalScript !== "function") {
      return Promise.resolve({ status: "failed", message: "After Effects bridge is unavailable." });
    }

    var limit = Number(timeoutMs);
    if (!isFinite(limit) || limit <= 0) limit = DEFAULT_TIMEOUT_MS;

    return new Promise(function (resolve) {
      var settled = false;
      var timeout = setTimeout(function () {
        finish({ status: "timed_out", message: "After Effects did not return a result before the timeout." });
      }, limit);

      function finish(result) {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(result);
      }

      try {
        evalScript(expression, function (response) {
          if (typeof response !== "string") {
            finish({ status: "failed", message: "After Effects returned a malformed result." });
            return;
          }

          if (response.indexOf("OK|") === 0 && response.slice(3).trim()) {
            finish({ status: "verified", message: response.slice(3).trim(), raw: response });
            return;
          }

          if (response.indexOf("REJECTED|") === 0 && response.slice(9).trim()) {
            finish({ status: "rejected", message: response.slice(9).trim(), raw: response });
            return;
          }

          if (response.indexOf("ERROR|") === 0 && response.slice(6).trim()) {
            finish({ status: "failed", message: response.slice(6).trim(), raw: response });
            return;
          }

          if (response === "EvalScript error.") {
            finish({ status: "failed", message: "After Effects could not execute the host script.", raw: response });
            return;
          }

          finish({ status: "failed", message: "After Effects returned an unrecognized result.", raw: response });
        });
      } catch (error) {
        finish({
          status: "failed",
          message: error && error.message ? error.message : String(error)
        });
      }
    });
  }

  return { buildExpression: buildExpression, execute: execute };
}));
