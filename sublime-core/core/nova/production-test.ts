import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LlmClient, Message, Tool, ToolCall, ToolSpec } from "../ai/reasoning/types.js";

const task = "Make a 15-second faceless AI-tech video explaining what AI video generation is.";

class ProductionModel implements LlmClient {
  agentTurns = 0;

  constructor(
    private readonly outerResult: "produce" | "continue" = "produce",
    private readonly resumeJobId?: string,
  ) {}

  async complete(input: { system: string; messages: Message[]; tools: ToolSpec[] }) {
    if (input.tools.some((tool) => tool.name === "video_production")) {
      const taskMessage = input.messages.find((message) => message.role === "user")?.content ?? "";
      if (/^\s*(?:please\s+)?(?:make|create|produce|build|generate)\b/i.test(taskMessage) && /\b(?:video|clip|film)\b/i.test(taskMessage)) {
        assert.deepEqual(
          input.tools.map((tool) => tool.name).sort(),
          ["task_done", "video_production"],
          "direct video tasks expose the integrated production tool without legacy workflow tools",
        );
      }
      this.agentTurns += 1;
      if (this.agentTurns === 1 && this.outerResult === "produce") {
        const call: ToolCall = {
          id: "production-request",
          name: "video_production",
          arguments: this.resumeJobId ? { jobId: this.resumeJobId } : { idea: task },
        };
        return { text: "I will produce the requested video.", toolCalls: [call] };
      }
      return { text: "The production tool returned an error observation, so the job remains incomplete." };
    }

    if (input.system.includes("extract video-production requirements")) {
      return {
        text: JSON.stringify({
          topic: "AI video generation",
          title: "How AI Video Generation Works",
          targetSeconds: 15,
          aspectRatio: "16:9",
          style: "clean procedural technology graphics",
          audience: "general audience",
          captions: true,
          narration: false,
        }),
      };
    }

    if (input.system.includes("script-writing module")) {
      return {
        text: JSON.stringify({
          title: "How AI Video Generation Works",
          hook: "AI video generation turns a written idea into moving images.",
          sections: [
            {
              heading: "Describe a scene",
              narration: "A prompt names a subject, setting, and motion for a scene.",
              visualDirection: "A prompt card connects to a simple scene outline.",
            },
            {
              heading: "Generate frames",
              narration: "A model creates changing frames that follow those instructions.",
              visualDirection: "Frames appear in sequence as a clean flow diagram.",
            },
            {
              heading: "Review and refine",
              narration: "Creators review the clip, adjust details, and make another version.",
              visualDirection: "A review loop connects a preview back to the prompt.",
            },
          ],
          ending: "The result is a draft video people can keep refining.",
          estimatedSeconds: 15,
        }),
      };
    }

    if (input.system.includes("script repair module")) {
      throw new Error("The deterministic test script should not require repair.");
    }

    if (input.system.includes("visual planner")) {
      const prompt = input.messages.at(-1)?.content ?? "";
      const count = Number(prompt.match(/exactly (\d+) visual scenes/)?.[1] ?? 5);
      return {
        text: JSON.stringify({
          scenes: Array.from({ length: count }, (_, index) => ({
            duration: 15 / count,
            purpose: `Scene ${index + 1} explains one production step.`,
            visual: `Procedural technology diagram for step ${index + 1}.`,
            visual_type: index === 1 ? "flow" : "diagram",
            accent_color: index % 2 ? "7b73ff" : "#26d9c8",
            caption: "A concise explanation of this step.",
          })),
        }),
      };
    }

    throw new Error(`Unexpected deterministic model boundary call: ${input.system.slice(0, 90)}`);
  }
}

function stubTool(name: string, handler: Tool["handler"]): Tool {
  return {
    name,
    description: `Deterministic test boundary for ${name}.`,
    parameters: { type: "object", properties: {}, required: [], additionalProperties: true },
    handler,
  };
}

function researchBoundaries(): { searchTool: Tool; fetchTool: Tool } {
  return {
    searchTool: stubTool("test_search", async () => JSON.stringify({
      results: [{ title: "Model card", url: "https://example.test/model-card", snippet: "AI video model overview." }],
    })),
    fetchTool: stubTool("test_fetch", async () => JSON.stringify({
      title: "Model card",
      finalUrl: "https://example.test/model-card",
      text: "The inspected model card describes generating short video clips from text prompts and image inputs.",
    })),
  };
}

function renderedMediaBoundary(options: { firstDuration?: string; formatName?: string } = {}) {
  const calls: string[] = [];
  let probeCount = 0;
  const run = async (command: string, args: string[]) => {
    calls.push(command);
    const output = args.at(-1)!;
    if (command === "ffmpeg") {
      await mkdir(path.dirname(output), { recursive: true });
      await writeFile(output, Buffer.from("test-owned-render-output"));
      return { stdout: "", stderr: "" };
    }
    assert.equal(command, "ffprobe");
    probeCount += 1;
    const duration = probeCount === 1 && options.firstDuration
      ? options.firstDuration
      : "15.000";
    return {
      stdout: JSON.stringify({
        format: { format_name: options.formatName ?? "mov,mp4,m4a,3gp,3g2,mj2", duration, size: "128" },
        streams: [{ codec_type: "video", codec_name: "h264", width: 1280, height: 720, r_frame_rate: "30/1" }],
      }),
      stderr: "",
    };
  };
  return { run, calls };
}

async function main(): Promise<void> {
  const originalCwd = process.cwd();
  const temporaryRoot = await mkdtemp(path.join(originalCwd, ".nova-production-test-"));

  try {
    process.chdir(temporaryRoot);
    const { runTask } = await import("./run.js");
    const { createVideoEngineTool } = await import("../ai/tools/video-engine.js");
    const { resumeVideoProduction } = await import("./production-pipeline.js");
    const { discoverMediaCapabilities, mediaCapabilitiesTool } = await import("../ai/tools/media-environment.js");
    const { listNovaRunStates } = await import("./run-state.js");
    const { runCommandTool } = await import("../ai/tools/command-tools.js");
    const oldLog = console.log;
    const oldWarn = console.warn;
    console.log = () => undefined;
    console.warn = () => undefined;

    try {
      // Request, script, QA, visual plan, asset, audio, timeline, real renderer logic,
      // render/probe repair, job artifacts, and final state all run through runTask.
      const boundaries = researchBoundaries();
      const media = renderedMediaBoundary({ firstDuration: "12.000" });
      const videoEngine = createVideoEngineTool(media.run);
      const successModel = new ProductionModel();
      await runTask(task, successModel, {
        maxTurns: 3,
        videoEngine,
        productionDependencies: {
          ...boundaries,
          executableFinder: async (name) => `C:\\test-tools\\${name}.exe`,
          jobId: "deterministic-production-success",
        },
      });
      const successfulRun = (await listNovaRunStates()).find((state) => state.task === task);
      assert.equal(successModel.agentTurns, 1, `the successful production tool stops the shared run loop: ${JSON.stringify(successfulRun?.messages.slice(-5))}`);
      assert.deepEqual(media.calls, ["ffmpeg", "ffprobe", "ffmpeg", "ffprobe"], "one duration repair is bounded to one rerender");
      assert.ok(successfulRun);
      assert.equal(successfulRun.status, "completed");
      assert.equal(successfulRun.stopped, "shouldStop");
      const workspace = path.join(temporaryRoot, "workspace");
      const jobId = "deterministic-production-success";
      const jobDirectory = path.join(workspace, "nova", "jobs", jobId);
      const finalPath = path.join(jobDirectory, "final.mp4");
      const finalRecord = JSON.parse(await readFile(path.join(jobDirectory, "final.json"), "utf8")) as Record<string, unknown>;
      const jobRecord = JSON.parse(await readFile(path.join(workspace, "nova", "jobs", jobId + ".json"), "utf8")) as Record<string, unknown>;
      assert.equal(finalRecord.valid, true);
      assert.equal(jobRecord.status, "completed");
      assert.equal(jobRecord.currentStage, "validation");
      assert.equal(await readFile(finalPath, "utf8"), "test-owned-render-output");
      assert.equal(JSON.parse(await readFile(path.join(jobDirectory, "script_data.json"), "utf8")).script.title, "How AI Video Generation Works");
      const savedTimeline = JSON.parse(await readFile(path.join(jobDirectory, "timeline.json"), "utf8"));
      assert.equal(savedTimeline.width, 1280);
      assert.equal(savedTimeline.scenes[0].accent_color, "26d9c8", "hash-prefixed planner colors normalize at the timeline boundary");
      assert.equal(JSON.parse(await readFile(path.join(jobDirectory, "audio.json"), "utf8")).narrationGenerated, false);
      assert.equal(JSON.parse(await readFile(path.join(jobDirectory, "render.json"), "utf8")).attempt, 2);

      const discovered = await discoverMediaCapabilities(async (name) => name === "ffmpeg" ? "C:\\ffmpeg.exe" : undefined);
      assert.equal(discovered.ffmpegAvailable, true);
      assert.equal(discovered.ffprobeAvailable, false);
      const missing = await discoverMediaCapabilities(async () => undefined);
      assert.equal(missing.ffmpegAvailable, false);
      assert.equal(missing.ffprobeAvailable, false);
      const liveCapabilities = await mediaCapabilitiesTool.handler({}, { messages: [], turn: 1, system: "test" });
      assert.ok(typeof liveCapabilities === "string" && JSON.parse(liveCapabilities).platform === process.platform);

      const blockedCommand = await runCommandTool.handler({ command: "powershell", args: ["-NoProfile"] }, { messages: [], turn: 1, system: "test" });
      assert.equal(typeof blockedCommand === "object" && blockedCommand.isError, true, "the command allowlist remains enforced");

      // Invalid probe metadata fails the job and must not trigger a repeated render.
      const invalidMedia = renderedMediaBoundary({ formatName: "matroska" });
      await runTask("Create a 15-second video about video QA.", new ProductionModel(), {
        maxTurns: 2,
        videoEngine: createVideoEngineTool(invalidMedia.run),
        productionDependencies: {
          ...boundaries,
          executableFinder: async (name) => `C:\\test-tools\\${name}.exe`,
          jobId: "deterministic-production-invalid-probe",
        },
      });
      assert.deepEqual(invalidMedia.calls, ["ffmpeg", "ffprobe"], "invalid container metadata is not retried identically");
      const invalidRecord = JSON.parse(await readFile(path.join(workspace, "nova", "jobs", "deterministic-production-invalid-probe", "final.json"), "utf8")) as Record<string, unknown>;
      const invalidJob = JSON.parse(await readFile(path.join(workspace, "nova", "jobs", "deterministic-production-invalid-probe.json"), "utf8")) as Record<string, unknown>;
      assert.equal(invalidRecord.valid, false);
      assert.equal(invalidJob.status, "failed");

      // A saved timeline can resume after a validation failure and complete via the real run loop.
      const resumeMedia = renderedMediaBoundary();
      const resumeJobId = "deterministic-production-invalid-probe";
      const resumeModel = new ProductionModel("produce", resumeJobId);
      await runTask("Resume the saved AI video production job.", resumeModel, {
        maxTurns: 3,
        videoEngine: createVideoEngineTool(resumeMedia.run),
        productionDependencies: {
          executableFinder: async (name) => `C:\\test-tools\\${name}.exe`,
        },
      });
      assert.equal(resumeModel.agentTurns, 1);
      assert.deepEqual(resumeMedia.calls, ["ffmpeg", "ffprobe"]);
      const resumedRun = (await listNovaRunStates()).find((state) => state.task === "Resume the saved AI video production job.");
      assert.ok(resumedRun);
      assert.equal(resumedRun.status, "completed");
      assert.equal(resumedRun.stopped, "shouldStop");
      const resumedRecord = JSON.parse(await readFile(path.join(workspace, "nova", "jobs", resumeJobId, "final.json"), "utf8")) as Record<string, unknown>;
      const resumedJob = JSON.parse(await readFile(path.join(workspace, "nova", "jobs", resumeJobId + ".json"), "utf8")) as Record<string, unknown>;
      assert.equal(resumedRecord.valid, true);
      assert.equal(resumedRecord.resumed, true);
      assert.equal(resumedJob.status, "completed");
      await assert.rejects(
        () => resumeVideoProduction(resumeJobId),
        /already completed/,
        "completed jobs cannot be accidentally rendered a second time",
      );
      assert.equal(resumedJob.outputPath, `nova/jobs/${resumeJobId}/final.mp4`);

      // Missing FFmpeg is an environment failure; it is reported before render and never retried.
      const unavailable = renderedMediaBoundary();
      await runTask("Create a 15-second video about local rendering.", new ProductionModel(), {
        maxTurns: 2,
        videoEngine: createVideoEngineTool(unavailable.run),
        productionDependencies: {
          ...boundaries,
          executableFinder: async () => undefined,
          jobId: "deterministic-production-no-ffmpeg",
        },
      });
      assert.deepEqual(unavailable.calls, []);
      const unavailableRecord = JSON.parse(await readFile(path.join(workspace, "nova", "jobs", "deterministic-production-no-ffmpeg", "final.json"), "utf8")) as Record<string, unknown>;
      assert.match(String(unavailableRecord.error), /ffmpeg.*unavailable/i);

    } finally {
      console.log = oldLog;
      console.warn = oldWarn;
    }

    process.chdir(originalCwd);
    console.log("NOVA production tests passed: real runner, job artifacts, QA, visual plan, timeline, captions, capability checks, bounded repair, probe failure, and command allowlist.");
  } finally {
    process.chdir(originalCwd);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
