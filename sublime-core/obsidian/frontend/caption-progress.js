/* Event-driven single-line caption progress controller. */
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.OBSIDIANCaptionProgress = api;
}(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  var STAGES = [
    "analyzing_footage", "connecting_service", "validating", "preparing", "extracting_audio",
    "loading_model", "transcribing", "processing_results",
    "validating_captions", "reviewing", "completed"
  ];
  var TRANSITION_MS = 170;

  function createController(render, wait) {
    var runId = 0;
    var active = false;
    var currentStage = null;
    var highestStage = -1;
    var queue = Promise.resolve();
    var renderState = typeof render === "function" ? render : function () {};
    var waitForTransition = typeof wait === "function" ? wait : function () {
      return new Promise(function (resolve) { setTimeout(resolve, TRANSITION_MS); });
    };

    function show(state) {
      state.runId = runId;
      renderState(state);
    }

    function enqueue(operation) {
      queue = queue.then(operation, operation);
      return queue;
    }

    function begin(nextRunId) {
      runId = Number.isFinite(nextRunId) ? nextRunId : runId + 1;
      active = true;
      currentStage = null;
      highestStage = -1;
      queue = Promise.resolve();
      show({ mode: "hidden", stage: null });
      return runId;
    }

    function handle(event, expectedRunId) {
      return enqueue(async function () {
        if (!active || expectedRunId !== runId || !event || typeof event !== "object") return;
        if (event.type === "stage" && (event.phase === "start" || event.phase === "complete")) {
          var stageIndex = STAGES.indexOf(event.stage);
          if (stageIndex < 0) return;
          if (event.phase === "complete") {
            if (currentStage !== event.stage) return;
            var completedStage = currentStage;
            currentStage = null;
            show({ mode: "leaving", stage: completedStage });
            await waitForTransition(TRANSITION_MS);
            if (active && expectedRunId === runId) show({ mode: "hidden", stage: null });
            return;
          }

          if (stageIndex < highestStage || currentStage === event.stage) return;
          if (currentStage) {
            var priorStage = currentStage;
            currentStage = null;
            show({ mode: "leaving", stage: priorStage });
            await waitForTransition(TRANSITION_MS);
            if (!active || expectedRunId !== runId) return;
            show({ mode: "hidden", stage: null });
          }
          currentStage = event.stage;
          highestStage = stageIndex;
          show({ mode: "running", stage: currentStage });
          return;
        }

        if (event.type === "progress") {
          if (currentStage !== "transcribing" || !Number.isFinite(event.current) || !Number.isFinite(event.total) || event.total <= 0) return;
          show({ mode: "running", stage: currentStage, current: event.current, total: event.total });
        }
      });
    }

    function fail(stage, message, expectedRunId) {
      return enqueue(async function () {
        if (!active || expectedRunId !== runId) return;
        var failedStage = typeof stage === "string" ? stage : currentStage;
        if (currentStage) {
          var leavingStage = currentStage;
          currentStage = null;
          show({ mode: "leaving", stage: leavingStage });
          await waitForTransition(TRANSITION_MS);
          if (expectedRunId !== runId) return;
        }
        active = false;
        show({ mode: "error", stage: failedStage, message: String(message || "Local caption transcription failed.") });
      });
    }

    function finish(expectedRunId) {
      return enqueue(async function () {
        if (!active || expectedRunId !== runId) return;
        if (currentStage) {
          var leavingStage = currentStage;
          currentStage = null;
          show({ mode: "leaving", stage: leavingStage });
          await waitForTransition(TRANSITION_MS);
          if (expectedRunId !== runId) return;
        }
        active = false;
        show({ mode: "hidden", stage: null });
      });
    }

    function cancel(expectedRunId) {
      if (expectedRunId !== runId) return;
      active = false;
      currentStage = null;
      runId += 1;
      queue = Promise.resolve();
      show({ mode: "hidden", stage: null });
    }

    function flush() { return queue; }
    function getState() {
      return { runId: runId, active: active, currentStage: currentStage, highestStage: highestStage };
    }

    return { begin: begin, handle: handle, fail: fail, finish: finish, cancel: cancel, flush: flush, getState: getState };
  }

  return { STAGES: STAGES.slice(), TRANSITION_MS: TRANSITION_MS, createController: createController };
}));
