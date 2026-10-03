import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import path from "node:path";
import type { LlmClient, Message, ToolCall, ToolSpec } from "../ai/reasoning/types.js";

type ModelStep = (input: {
  system: string;
  messages: Message[];
  tools: ToolSpec[];
}) => Promise<{ text?: string; toolCalls?: ToolCall[] }> | { text?: string; toolCalls?: ToolCall[] };

class ScriptedModel implements LlmClient {
  calls = 0;

  constructor(private readonly steps: ModelStep[]) {}

  async complete(input: {
    system: string;
    messages: Message[];
    tools: ToolSpec[];
  }) {
    const step = this.steps[this.calls++];
    if (!step) throw new Error("Scripted model received an unexpected turn.");
    return step(input);
  }
}

function toolCall(
  id: string,
  name: string,
  args: Record<string, unknown>,
): ToolCall {
  return { id, name, arguments: args };
}

function toolObservation(
  messages: Message[],
  name: string,
  fragment: string,
  isError: boolean,
): Message {
  const observation = [...messages].reverse().find(
    (message) => message.role === "tool" && message.name === name,
  );
  assert.ok(observation, `expected a ${name} tool observation`);
  assert.ok(observation.content.includes(fragment), observation.content);
  assert.equal(Boolean(observation.isError), isError);
  return observation;
}

function checkRegisteredToolSchemas(tools: ToolSpec[]): void {
  assert.ok(tools.length >= 10, "NOVA should register its real tool set");
  assert.equal(new Set(tools.map((tool) => tool.name)).size, tools.length);
  for (const tool of tools) {
    assert.equal(tool.parameters.type, "object", `${tool.name} has an object input schema`);
    const properties = tool.parameters.properties as Record<string, unknown>;
    assert.ok(properties && typeof properties === "object");
    const required = tool.parameters.required as unknown[] | undefined;
    for (const property of required ?? []) {
      assert.ok(typeof property === "string" && property in properties, `${tool.name} has valid required fields`);
    }
  }
}

async function main(): Promise<void> {
  const originalCwd = process.cwd();
  const temporaryRoot = await mkdtemp(path.join(originalCwd, ".nova-foundation-test-"));
  const originalLog = console.log;

  try {
    process.chdir(temporaryRoot);
    const { runTask } = await import("./run.js");
    const { createVideoEngineTool } = await import("../ai/tools/video-engine.js");
    const { finalizeRunState, listNovaRunStates, loadNovaRunState } = await import("./run-state.js");
    console.log = () => undefined;

    const workspace = path.join(temporaryRoot, "workspace");

    // TEST A: real runner -> real file tool -> observation -> task_done -> checkpoint read.
    const taskA = "Create e2e-result.txt and report completion.";
    const modelA = new ScriptedModel([
      (input) => {
        assert.ok(input.messages.some((message) => message.role === "user" && message.content === taskA));
        checkRegisteredToolSchemas(input.tools);
        assert.ok(input.tools.some((tool) => tool.name === "create_file"));
        return {
          text: "I will create the requested file.",
          toolCalls: [toolCall("a-create", "create_file", {
            path: "e2e-result.txt",
            content: "Created by the NOVA run-loop test.",
          })],
        };
      },
      (input) => {
        toolObservation(input.messages, "create_file", "Created e2e-result.txt successfully.", false);
        assert.ok(input.tools.some((tool) => tool.name === "task_done"));
        return {
          text: "The requested file is complete.",
          toolCalls: [toolCall("a-done", "task_done", {
            summary: "Created e2e-result.txt.",
          })],
        };
      },
    ]);
    await runTask(taskA, modelA);
    assert.equal(modelA.calls, 2);
    assert.equal(await readFile(path.join(workspace, "e2e-result.txt"), "utf8"), "Created by the NOVA run-loop test.");
    const stateA = (await listNovaRunStates()).find((state) => state.task === taskA);
    assert.ok(stateA);
    assert.equal(stateA.status, "completed");
    assert.equal(stateA.stopped, "task_done");
    assert.ok(stateA.messages.some((message) => message.role === "tool" && message.name === "create_file"));
    assert.deepEqual(await loadNovaRunState(stateA.runId), stateA, "checkpoint load must preserve the completed conversation");

    // TEST B: unknown tool and invalid arguments become observations; an empty read is explicit;
    // the model uses those observations, recovers, and then completes.
    const taskB = "Create output.txt after recovering from a failed tool attempt.";
    const modelB = new ScriptedModel([
      (input) => {
        assert.ok(input.messages.some((message) => message.role === "user" && message.content === taskB));
        return {
          toolCalls: [
            toolCall("b-unknown", "missing_tool", {}),
            toolCall("b-invalid-args", "create_file", { path: 123, content: "must not write" }),
          ],
        };
      },
      (input) => {
        toolObservation(input.messages, "missing_tool", "Unknown tool", true);
        toolObservation(input.messages, "create_file", "Tool arguments rejected: args.path must be string", true);
        return {
          toolCalls: [toolCall("b-empty-file", "create_file", { path: "output.txt", content: "" })],
        };
      },
      (input) => {
        toolObservation(input.messages, "create_file", "Created output.txt successfully.", false);
        return { toolCalls: [toolCall("b-read-empty", "read_file", { path: "output.txt" })] };
      },
      (input) => {
        toolObservation(input.messages, "read_file", "Tool returned an empty observation.", true);
        return {
          toolCalls: [toolCall("b-recover", "edit_file", {
            path: "output.txt",
            content: "Recovered after observing the empty file.",
          })],
        };
      },
      (input) => {
        toolObservation(input.messages, "edit_file", "Edited output.txt successfully.", false);
        return {
          toolCalls: [toolCall("b-done", "task_done", { summary: "Recovered and created output.txt." })],
        };
      },
    ]);
    await runTask(taskB, modelB);
    assert.equal(modelB.calls, 5);
    assert.equal(await readFile(path.join(workspace, "output.txt"), "utf8"), "Recovered after observing the empty file.");
    const stateB = (await listNovaRunStates()).find((state) => state.task === taskB);
    assert.ok(stateB);
    assert.equal(stateB.status, "completed");
    assert.equal(stateB.stopped, "task_done");

    // TEST C: actual editor and video-engine tool logic; only the FFmpeg/ffprobe process boundary is mocked.
    const taskC = "Render and probe a one-scene MP4 video with the word NOVA.";
    const videoPath = "nova/videos/foundation-test.mp4";
    const modelC = new ScriptedModel([
      () => ({
        toolCalls: [toolCall("c-timeline", "editing_module", {
          action: "build_timeline",
          aspect_ratio: "16:9",
          scenes: [{ duration: 1, background: "black", text: "NOVA" }],
        })],
      }),
      (input) => {
        const timelineObservation = toolObservation(input.messages, "editing_module", "nova_timeline_v2", false);
        const timeline = JSON.parse(timelineObservation.content);
        assert.equal(timeline.timeline.scenes[0].index, 1);
        return {
          toolCalls: [toolCall("c-render", "video_engine", {
            action: "render",
            id: "foundation-test",
            scenes: timeline.timeline.scenes,
          })],
        };
      },
      (input) => {
        const renderObservation = toolObservation(input.messages, "video_engine", "foundation-test.mp4", false);
        const rendered = JSON.parse(renderObservation.content);
        assert.equal(rendered.ok, true);
        return {
          toolCalls: [toolCall("c-premature-done", "task_done", {
            summary: "Premature completion should be blocked.",
          })],
        };
      },
      (input) => {
        toolObservation(input.messages, "task_done", "must probe the exact successfully rendered output", true);
        const renderObservation = toolObservation(input.messages, "video_engine", "foundation-test.mp4", false);
        const rendered = JSON.parse(renderObservation.content);
        return {
          toolCalls: [toolCall("c-probe", "video_engine", {
            action: "probe",
            path: rendered.outputPath,
          })],
        };
      },
    ]);
    const processCalls: string[] = [];
    const videoTool = createVideoEngineTool(async (command, args) => {
      processCalls.push(command);
      if (command === "ffmpeg") {
        assert.ok(args.includes(path.join(workspace, videoPath)));
        return { stdout: "", stderr: "" };
      }
      assert.equal(command, "ffprobe");
      assert.ok(args.includes(path.join(workspace, videoPath)));
      return {
        stdout: JSON.stringify({
          format: { format_name: "mp4", duration: "1.0", size: "42" },
          streams: [{ codec_type: "video", codec_name: "h264", width: 1280, height: 720, r_frame_rate: "30/1" }],
        }),
        stderr: "",
      };
    });
    await runTask(taskC, modelC, { maxTurns: 5, videoEngine: videoTool });
    assert.equal(modelC.calls, 4);
    assert.deepEqual(processCalls, ["ffmpeg", "ffprobe"]);
    const stateC = (await listNovaRunStates()).find((state) => state.task === taskC);
    assert.ok(stateC);
    assert.equal(stateC.status, "completed");
    assert.equal(stateC.stopped, "shouldStop");
    assert.ok(stateC.finalSummary?.includes(videoPath));
    const probeObservation = toolObservation(stateC.messages, "video_engine", '"valid":true', false);
    const probed = JSON.parse(probeObservation.content);
    assert.equal(probed.outputPath, videoPath);
    assert.equal(probed.metadata.streams[0].width, 1280);

    const failedStop = finalizeRunState(
      {
        runId: "failed-stop-test",
        task: "Probe a video.",
        status: "running",
        startedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        turn: 1,
        messages: [],
      },
      {
        stopped: "shouldStop",
        turns: 1,
        messages: [],
        finalSummary: "Stopped after an unsuccessful probe.",
      },
    );
    assert.equal(failedStop.status, "failed", "a summary alone must not make shouldStop successful");

    // TEST D: unsafe lexical and symlink paths must not let the real file tool write outside workspace.
    const outside = path.join(temporaryRoot, "outside");
    await mkdir(outside, { recursive: true });
    await symlink(outside, path.join(workspace, "escape"), process.platform === "win32" ? "junction" : "dir");
    const absoluteEscape = path.join(outside, "absolute.txt");
    const attemptedWrites = [
      toolCall("d-junction", "create_file", {
        path: "escape/blocked.txt",
        content: "must not escape",
      }),
      toolCall("d-traversal", "create_file", {
        path: "../outside/traversal.txt",
        content: "must not escape",
      }),
      toolCall("d-absolute", "create_file", {
        path: absoluteEscape,
        content: "must not escape",
      }),
    ];
    if (process.platform === "win32") {
      attemptedWrites.push(toolCall("d-drive", "create_file", {
        path: path.win32.join("Z:\\", "nova-escape.txt"),
        content: "must not escape",
      }));
    }

    const taskD = "Create escape/blocked.txt inside the workspace.";
    const modelD = new ScriptedModel([
      () => ({ toolCalls: attemptedWrites }),
      (input) => {
        for (const call of attemptedWrites) {
          const observation = input.messages.find(
            (message) => message.role === "tool" && message.toolCallId === call.id,
          );
          assert.ok(observation, `expected an observation for ${call.id}`);
          assert.equal(observation.isError, true, `${call.id} must be reported as an error`);
          assert.match(observation.content, /outside/i, `${call.id} must explain the boundary rejection`);
        }
        return { text: "All unsafe writes were rejected." };
      },
    ]);
    await runTask(taskD, modelD, { maxTurns: 2 });
    assert.equal(modelD.calls, 2);
    await assert.rejects(readFile(path.join(outside, "blocked.txt")));
    await assert.rejects(readFile(path.join(outside, "traversal.txt")));
    await assert.rejects(readFile(absoluteEscape));
    const stateD = (await listNovaRunStates()).find((state) => state.task === taskD);
    assert.ok(stateD);
    assert.equal(stateD.status, "failed");
    assert.equal(stateD.stopped, "maxTurns");

    // Malformed model output and provider failures produce persisted failure results.
    const malformedModel = new ScriptedModel([
      () => ({ text: 42 as unknown as string }),
    ]);
    const malformedTask = "Inspect the workspace.";
    await runTask(malformedTask, malformedModel);
    const malformedState = (await listNovaRunStates()).find((state) => state.task === malformedTask);
    assert.ok(malformedState);
    assert.equal(malformedState.status, "failed");
    assert.equal(malformedState.stopped, "invalid_response");
    assert.ok(malformedState.messages.at(-1)?.content.includes("Malformed model response"));

    const failingModel: LlmClient = {
      async complete() {
        throw new Error("deterministic model boundary failure");
      },
    };
    const modelErrorTask = "Inspect the workspace after a model failure.";
    await runTask(modelErrorTask, failingModel);
    const modelErrorState = (await listNovaRunStates()).find((state) => state.task === modelErrorTask);
    assert.ok(modelErrorState);
    assert.equal(modelErrorState.status, "failed");
    assert.equal(modelErrorState.stopped, "model_error");
    assert.ok(modelErrorState.messages.at(-1)?.content.includes("deterministic model boundary failure"));

    console.log = originalLog;
    console.log("NOVA deterministic tests A–D and model-error checks passed.");
  } finally {
    console.log = originalLog;
    process.chdir(originalCwd);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
