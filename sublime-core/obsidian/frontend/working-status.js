/* One replace-only label for the operation that is active right now. */
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.OBSIDIANWorkingStatus = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var LABELS = {
    initializing: "INITIALIZING",
    connecting_to_core: "CONNECTING TO CORE",
    connecting_to_service: "CONNECTING TO SERVICE",
    connecting_service: "CONNECTING TO SERVICE",
    thinking: "THINKING",
    analyzing: "ANALYZING",
    analyzing_footage: "ANALYZING",
    planning: "PLANNING",
    scripting: "SCRIPTING",
    generating: "GENERATING",
    transcribing: "TRANSCRIBING",
    processing: "PROCESSING",
    processing_results: "PROCESSING",
    validating: "VALIDATING",
    validating_captions: "VALIDATING",
    preparing: "PREPARING",
    extracting_audio: "PREPARING",
    loading_model: "PREPARING",
    implementing: "IMPLEMENTING",
    verifying: "VERIFYING",
    reviewing: "REVIEWING",
    finalizing: "FINALIZING",
    recording: "RECORDING",
    completed: "COMPLETED",
    failed: "FAILED"
  };

  function createController(render) {
    var onChange = typeof render === "function" ? render : function () {};
    var current = null;

    function set(stage) {
      var key = String(stage || "").toLowerCase();
      if (!Object.prototype.hasOwnProperty.call(LABELS, key)) return false;
      current = { stage: key, label: LABELS[key] };
      onChange(current);
      return true;
    }

    function clear() {
      if (!current) return;
      current = null;
      onChange(null);
    }

    return {
      set: set,
      clear: clear,
      getState: function () { return current && { stage: current.stage, label: current.label }; }
    };
  }

  return { LABELS: Object.assign({}, LABELS), createController: createController };
}));
