import { promises as fs } from "node:fs";
import path from "node:path";
import type { AgentState, LlmClient, Tool, ToolResult } from "../ai/reasoning/types.js";
import { contentQaTool } from "../ai/tools/content-qa.js";
import { readContentArtifact, writeContentArtifact } from "../ai/tools/content-artifacts.js";
import { configuredAssetProviders, resolveVisualAsset, type AssetProvider, type AssetResolution } from "../ai/tools/asset-library.js";
import { editingModuleTool } from "../ai/tools/editing-module.js";
import { discoverMediaCapabilities, type ExecutableFinder } from "../ai/tools/media-environment.js";
import { novaMemoryTool } from "../ai/tools/nova-memory.js";
import { sourceFetchTool } from "../ai/tools/source-fetch.js";
import { videoEngineTool } from "../ai/tools/video-engine.js";
import { visualPlannerTool } from "../ai/tools/visual-planner.js";
import { webSearchTool } from "../ai/tools/web-search.js";
import { resolveWorkspacePath } from "../ai/tools/workspace-path.js";
import { createContentJobRecord, loadContentJobRecord, updateContentJobRecord, type ContentJobStage } from "../ai/tools/content-job.js";
import { generateValidatedScript, type ScriptPipelineResult } from "./script-pipeline.js";
import { understandVideoRequest, type VideoProductionRequest } from "./request-understanding.js";
import { validateScript } from "./script-validator.js";
import type { VideoScript } from "./script-generator.js";
import type { VideoSceneDefinition, VideoTimeline } from "./video-contracts.js";

export interface ProductionDependencies {
  searchTool?: Tool;
  fetchTool?: Tool;
  videoEngine?: Tool;
  /** Optional provider injection keeps asset resolution deterministic in tests. */
  assetProviders?: AssetProvider[];
  executableFinder?: ExecutableFinder;
  jobId?: string;
  now?: () => Date;
}

export interface ProductionResult {
  ok: true;
  jobId: string;
  title: string;
  outputPath: string;
  finalRecordPath: string;
  durationSeconds: number;
  width: number;
  height: number;
  frameRate: number;
  researchStatus: "sourced" | "search_only" | "unavailable";
  narrationGenerated: false;
  validation: Record<string, unknown>;
}

function emptyState(): AgentState {
  return { messages: [], turn: 1, system: "NOVA production stage" };
}

function unwrapToolResult(raw: ToolResult | string): { content: string; isError: boolean } {
  if (typeof raw === "string") return { content: raw, isError: false };
  return { content: raw.content, isError: Boolean(raw.isError) };
}

function parseObject(text: string): Record<string, unknown> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = fenced?.[1]?.trim() ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  if (!source || !source.startsWith("{") || !source.endsWith("}")) {
    throw new Error("The model did not return a JSON object.");
  }
  const value = JSON.parse(source) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The model returned an invalid JSON object.");
  }
  return value as Record<string, unknown>;
}

function safeJobId(topic: string, now: Date): string {
  const slug = topic.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42) || "video";
  const stamp = now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 17);
  return `${slug}-${stamp}`;
}

async function saveJson(jobId: string, kind: Parameters<typeof writeContentArtifact>[1], value: unknown): Promise<string> {
  return writeContentArtifact(jobId, kind, JSON.stringify(value, null, 2));
}

async function searchResearch(
  topic: string,
  jobId: string,
  searchTool: Tool,
  fetchTool: Tool,
): Promise<{ status: ProductionResult["researchStatus"]; context: string; sourceCount: number }> {
  const report: {
    status: ProductionResult["researchStatus"];
    query: string;
    searchedAt: string;
    searchResults: Array<{ title: string; url: string; snippet: string }>;
    inspectedSources: Array<{ title?: string; url: string; publishedAt?: string; excerpt: string }>;
    failures: string[];
    factsBoundary: string;
  } = {
    status: "unavailable",
    query: topic,
    searchedAt: new Date().toISOString(),
    searchResults: [],
    inspectedSources: [],
    failures: [],
    factsBoundary: "Only inspected source excerpts below may support specific factual claims. Generated script and visual choices are creative material.",
  };

  try {
    const raw = unwrapToolResult(await searchTool.handler({ query: `${topic} how it works official documentation` }, emptyState()));
    if (raw.isError) throw new Error(raw.content);
    const response = parseObject(raw.content);
    const results = Array.isArray(response.results) ? response.results : [];
    report.searchResults = results.slice(0, 5).flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const item = value as Record<string, unknown>;
      if (typeof item.url !== "string" || !/^https?:\/\//i.test(item.url)) return [];
      return [{
        title: typeof item.title === "string" ? item.title : item.url,
        url: item.url,
        snippet: typeof item.snippet === "string" ? item.snippet.slice(0, 800) : "",
      }];
    });
  } catch (error) {
    report.failures.push(`Search unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }

  for (const result of report.searchResults.slice(0, 2)) {
    try {
      const raw = unwrapToolResult(await fetchTool.handler({ url: result.url }, emptyState()));
      if (raw.isError) throw new Error(raw.content);
      const source = parseObject(raw.content);
      if (source.failed === true || typeof source.text !== "string" || !source.text.trim()) {
        throw new Error(typeof source.error === "string" ? source.error : "The source returned no readable text.");
      }
      report.inspectedSources.push({
        title: typeof source.title === "string" ? source.title : result.title,
        url: typeof source.finalUrl === "string" ? source.finalUrl : result.url,
        ...(typeof source.publishedAt === "string" ? { publishedAt: source.publishedAt } : {}),
        excerpt: source.text.slice(0, 5000),
      });
    } catch (error) {
      report.failures.push(`Source fetch failed for ${result.url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  report.status = report.inspectedSources.length > 0
    ? "sourced"
    : report.searchResults.length > 0
      ? "search_only"
      : "unavailable";
  if (report.status === "unavailable") {
    report.factsBoundary = "External research was unavailable. No source-backed claims or statistics are included; the script must stay at a cautious introductory level.";
  } else if (report.status === "search_only") {
    report.factsBoundary = "Search returned results, but no source page could be inspected. Snippets are leads only and must not be presented as verified facts.";
  }

  const lines = [
    `# Research dossier: ${topic}`,
    "",
    `- Status: ${report.status}`,
    `- Searched: ${report.searchedAt}`,
    `- Query: ${report.query}`,
    "",
    "## Evidence boundary",
    report.factsBoundary,
    "",
    "## Inspected sources",
  ];
  if (report.inspectedSources.length === 0) lines.push("No source pages were successfully inspected.");
  for (const source of report.inspectedSources) {
    lines.push(`### ${source.title}`, `URL: ${source.url}`, source.publishedAt ? `Published: ${source.publishedAt}` : "", "", source.excerpt, "");
  }
  lines.push("## Search leads");
  for (const result of report.searchResults) lines.push(`- [${result.title}](${result.url}) — ${result.snippet}`);
  if (report.failures.length) lines.push("", "## Provider errors", ...report.failures.map((failure) => `- ${failure}`));

  await writeContentArtifact(jobId, "research", lines.join("\n"));
  const context = report.inspectedSources.length > 0
    ? report.inspectedSources.map((source) => `${source.title} (${source.url})\n${source.excerpt}`).join("\n\n").slice(0, 10000)
    : report.factsBoundary;
  return { status: report.status, context, sourceCount: report.inspectedSources.length };
}

function scriptMarkdown(script: VideoScript): string {
  const lines = [`# ${script.title}`, "", `## Hook\n\n${script.hook}`];
  for (const section of script.sections) {
    lines.push(`## ${section.heading}`, "", section.narration, "", `Visual direction: ${section.visualDirection}`);
  }
  lines.push("", `## Ending\n\n${script.ending}`, "", `Estimated duration: ${script.estimatedSeconds}s`);
  return lines.join("\n");
}

async function repairScriptForQa(
  llm: LlmClient,
  script: VideoScript,
  findings: string[],
  request: VideoProductionRequest,
  researchContext: string,
): Promise<VideoScript> {
  const response = await llm.complete({
    system: "Repair this video script using only the supplied evidence. Return only a JSON object with title, hook, sections, ending, estimatedSeconds. Do not add unsupported facts.",
    messages: [{
      role: "user",
      content: `Fix these deterministic QA findings: ${findings.join("; ")}\nTarget duration: ${request.targetSeconds}s\nEvidence boundary: ${researchContext}\nCurrent script: ${JSON.stringify(script)}`,
    }],
    tools: [],
  });
  return parseObject(response.text ?? "") as unknown as VideoScript;
}

interface SceneCue {
  heading: string;
  narration: string;
  visualDirection: string;
}

function scriptCues(script: VideoScript, topic: string): SceneCue[] {
  const sections = script.sections.slice(0, 10);
  const subject = topic.toLowerCase();
  const opening = /\b(ai|artificial intelligence|generative|prompt)\b/.test(subject)
    ? "Prompt becomes video"
    : /\b(sky|atmosphere|scattering|blue)\b/.test(subject)
      ? "Sunlight enters the atmosphere"
      : /\b(cpu|processor|chip)\b/.test(subject)
        ? "Instructions enter the chip"
        : script.title.slice(0, 80);
  const closing = /\b(ai|artificial intelligence|generative|prompt)\b/.test(subject)
    ? "Frames form a moving video"
    : /\b(sky|atmosphere|scattering|blue)\b/.test(subject)
      ? "Blue light reaches the observer"
      : /\b(cpu|processor|chip)\b/.test(subject)
        ? "Processed data becomes output"
        : "The core idea";
  return [
    { heading: opening, narration: script.hook, visualDirection: sections[0]?.visualDirection || "A clear topic-specific opening visual." },
    ...sections.map((section) => ({
      heading: section.heading,
      narration: section.narration,
      visualDirection: section.visualDirection,
    })),
    { heading: closing, narration: script.ending, visualDirection: "A concise, topic-specific closing visual that reinforces the explanation." },
  ].filter((cue) => cue.narration.trim()).slice(0, 12);
}

function visualTypeFor(description: string, index: number): "card" | "flow" | "network" | "diagram" {
  const text = description.toLowerCase();
  if (/connect|network|many|nodes|web|data/.test(text)) return "network";
  if (/step|process|prompt|input|output|sequence|then/.test(text)) return "flow";
  if (/compare|layer|model|system|inside|architecture/.test(text)) return "diagram";
  return index === 0 ? "card" : "flow";
}

function captionChunks(text: string): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (current && (next.length > 74 || current.split(" ").length >= 9)) {
      chunks.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks.slice(0, 8);
}

function buildTimelineDraft(
  request: VideoProductionRequest,
  script: VideoScript,
  planned: Array<Record<string, unknown>>,
  resolutions: AssetResolution[],
): Record<string, unknown> {
  const cues = scriptCues(script, request.topic);
  const baseDuration = request.targetSeconds / cues.length;
  let elapsed = 0;
  const scenes = cues.map((cue, index) => {
    const duration = index === cues.length - 1
      ? Number((request.targetSeconds - elapsed).toFixed(3))
      : Number(baseDuration.toFixed(3));
    elapsed += duration;
    const plan = planned[index] ?? {};
    const resolution = resolutions[index];
    const visual = typeof plan.visual === "string" && plan.visual.trim()
      ? plan.visual.trim().slice(0, 500)
      : cue.visualDirection;
    const visualType = ["card", "flow", "network", "diagram"].includes(String(plan.visual_type))
      ? String(plan.visual_type) as "card" | "flow" | "network" | "diagram"
      : visualTypeFor(visual, index);
    const captions = request.captions ? captionChunks(cue.narration) : [];
    const captionSegments = captions.map((text, chunkIndex) => ({
      text,
      start: Number((duration * chunkIndex / captions.length).toFixed(3)),
      end: Number((duration * (chunkIndex + 1) / captions.length).toFixed(3)),
    })).filter((caption) => caption.end > caption.start);
    const accentColors = ["26d9c8", "7b73ff", "ffb84d", "38c7ff"];
    return {
      duration,
      visual,
      visual_type: visualType,
      accent_color: typeof plan.accent_color === "string" ? plan.accent_color : accentColors[index % accentColors.length],
      background: index % 2 === 0 ? "08111f" : "10182b",
      text: cue.heading.slice(0, 80),
      text_size: request.aspectRatio === "9:16" ? 48 : 56,
      text_position: "center",
      text_max_width: request.aspectRatio === "9:16" ? 610 : 1120,
      caption_segments: captionSegments,
      ...(resolution?.asset ? {
        asset_path: resolution.asset.location,
        asset_media_type: resolution.asset.mediaType,
        asset_fit: "cover",
      } : {}),
      ...(resolution ? { procedural_kind: resolution.proceduralKind } : {}),
      ...(typeof plan.source_query === "string" && plan.source_query.trim()
        ? { source_query: plan.source_query.trim() }
        : {}),
    };
  });
  return { action: "build_timeline", aspect_ratio: request.aspectRatio, scenes };
}

function validateProbe(
  probe: Record<string, unknown>,
  request: VideoProductionRequest,
  width: number,
  height: number,
): { valid: boolean; reasons: string[]; actualDuration?: number; metadata?: Record<string, unknown> } {
  const reasons: string[] = [];
  const metadata = probe.metadata && typeof probe.metadata === "object"
    ? probe.metadata as Record<string, unknown>
    : undefined;
  const duration = Number(metadata?.durationSeconds);
  const streams = Array.isArray(metadata?.streams) ? metadata.streams as Array<Record<string, unknown>> : [];
  const video = streams.find((stream) => stream.type === "video");
  if (probe.ok !== true || probe.valid !== true || !metadata) reasons.push("ffprobe did not validate the output container.");
  if (!video) reasons.push("The output has no readable video stream.");
  if (Number(video?.width) !== width || Number(video?.height) !== height) reasons.push(`Expected ${width}x${height} video dimensions.`);
  if (!Number.isFinite(duration) || duration <= 0) reasons.push("The output duration is missing or invalid.");
  else if (Math.abs(duration - request.targetSeconds) > Math.max(0.45, request.targetSeconds * 0.025)) {
    reasons.push(`Rendered duration ${duration}s does not match requested ${request.targetSeconds}s.`);
  }
  const formatName = String(metadata?.formatName ?? "").toLowerCase();
  if (!formatName.includes("mp4")) reasons.push("The probed container is not identified as MP4.");
  return {
    valid: reasons.length === 0,
    reasons,
    ...(Number.isFinite(duration) ? { actualDuration: duration } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

async function invokeVideoTool(tool: Tool, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const raw = unwrapToolResult(await tool.handler(input, emptyState()));
  try {
    const parsed = parseObject(raw.content);
    return raw.isError ? { ...parsed, toolError: true } : parsed;
  } catch (error) {
    if (raw.isError) throw new Error(raw.content);
    throw error;
  }
}

export async function runVideoProduction(
  llm: LlmClient,
  task: string,
  dependencies: ProductionDependencies = {},
): Promise<ProductionResult> {
  const now = dependencies.now ?? (() => new Date());
  const request = await understandVideoRequest(llm, task);
  const jobId = dependencies.jobId ?? safeJobId(request.topic, now());
  await createContentJobRecord(jobId, request.title ?? request.topic);
  await updateContentJobRecord(jobId, { currentStage: "planning" });

  const jobRoot = await resolveWorkspacePath(path.join("nova", "jobs", jobId));
  const finalPath = path.join("nova", "jobs", jobId, "final.mp4").replaceAll("\\", "/");
  let currentStage: string = "planning";

  try {
    await saveJson(jobId, "request", request);
    currentStage = "research";
    await updateContentJobRecord(jobId, { currentStage: "research" });
    const research = await searchResearch(
      request.topic,
      jobId,
      dependencies.searchTool ?? webSearchTool,
      dependencies.fetchTool ?? sourceFetchTool,
    );

    currentStage = "scripting";
    await updateContentJobRecord(jobId, { currentStage: "scripting" });
    const scriptResult: ScriptPipelineResult = await generateValidatedScript(
      llm,
      {
        topic: request.topic,
        targetSeconds: request.targetSeconds,
        tone: request.style,
        audience: request.audience,
        researchContext: research.context,
      },
      3,
    );
    if (!validateScript(scriptResult.script, request.targetSeconds).valid) {
      throw new Error("Generated script contains invalid or unsupported claims after bounded repair.");
    }
    await saveJson(jobId, "script_data", scriptResult);
    await writeContentArtifact(jobId, "script", scriptMarkdown(scriptResult.script));

    currentStage = "qa";
    await updateContentJobRecord(jobId, { currentStage: "qa" });
    let qaRaw = unwrapToolResult(await contentQaTool.handler({
      path: `nova/jobs/${jobId}/script.md`,
      kind: "script",
    }, emptyState()));
    let qa = parseObject(qaRaw.content);
    if (qaRaw.isError || qa.passed !== true) {
      const findings = Array.isArray(qa.findings) ? qa.findings.map(String) : [qaRaw.content];
      const repaired = await repairScriptForQa(llm, scriptResult.script, findings, request, research.context);
      const validation = validateScript(repaired, request.targetSeconds);
      if (!validation.valid) throw new Error(`Script QA repair failed: ${validation.errors.join("; ")}`);
      scriptResult.script = repaired;
      scriptResult.validation = validation;
      await saveJson(jobId, "script_data", scriptResult);
      await writeContentArtifact(jobId, "script", scriptMarkdown(repaired));
      qaRaw = unwrapToolResult(await contentQaTool.handler({
        path: `nova/jobs/${jobId}/script.md`,
        kind: "script",
      }, emptyState()));
      qa = parseObject(qaRaw.content);
      if (qaRaw.isError || qa.passed !== true) throw new Error("Script failed deterministic QA after one repair.");
    }
    const scriptQa = { ...qa, attempts: scriptResult.attempts, status: "PASS" };
    await writeContentArtifact(jobId, "script_qa", `PASS\n\n${JSON.stringify(scriptQa, null, 2)}`);

    currentStage = "visual_planning";
    await updateContentJobRecord(jobId, { currentStage: "visual_planning" });
    const cues = scriptCues(scriptResult.script, request.topic);
    let planMethod = "local_model";
    let rawPlanScenes: Array<Record<string, unknown>> = [];
    try {
      const visualResponse = await llm.complete({
        system: "You are NOVA's visual planner. Make practical, faceless educational scenes. Describe a useful visual and an optional concise source_query for an asset resolver; do not claim an asset already exists. Return JSON only: {\"scenes\":[{\"duration\":number,\"purpose\":string,\"visual\":string,\"source_query\":string,\"visual_type\":\"card\"|\"flow\"|\"network\"|\"diagram\",\"accent_color\":\"6-digit hex\",\"caption\":string}]}.",
        messages: [{
          role: "user",
          content: `Create exactly ${cues.length} visual scenes in script order. Target runtime ${request.targetSeconds}s, style ${request.style}, audience ${request.audience}.\nScript cues:\n${JSON.stringify(cues)}`,
        }],
        tools: [],
      });
      const output = parseObject(visualResponse.text ?? "");
      if (!Array.isArray(output.scenes)) throw new Error("Visual plan has no scenes array.");
      rawPlanScenes = output.scenes.slice(0, cues.length).filter((scene): scene is Record<string, unknown> => Boolean(scene && typeof scene === "object" && !Array.isArray(scene)));
      if (rawPlanScenes.length !== cues.length) throw new Error("Visual plan scene count does not match the script.");
    } catch {
      planMethod = "script_direction_fallback";
      rawPlanScenes = cues.map((cue, index) => ({
        duration: request.targetSeconds / cues.length,
        purpose: cue.heading,
        visual: cue.visualDirection,
        visual_type: visualTypeFor(cue.visualDirection, index),
      }));
    }
    const visualPlanToolResult = unwrapToolResult(await visualPlannerTool.handler({
      action: "build_visual_plan",
      scenes: rawPlanScenes.map((scene, index) => ({
        duration: Number(scene.duration) > 0 ? Number(scene.duration) : request.targetSeconds / cues.length,
        purpose: typeof scene.purpose === "string" ? scene.purpose : cues[index].heading,
        visual: typeof scene.visual === "string" ? scene.visual : cues[index].visualDirection,
        visual_type: scene.visual_type,
        accent_color: scene.accent_color,
        source_query: typeof scene.source_query === "string" ? scene.source_query : undefined,
        caption: typeof scene.caption === "string" ? scene.caption : cues[index].narration,
        narration: cues[index].narration,
      })),
    }, emptyState()));
    if (visualPlanToolResult.isError) throw new Error(`Visual plan validation failed: ${visualPlanToolResult.content}`);
    const visualPlan = parseObject(visualPlanToolResult.content);
    await saveJson(jobId, "visual_plan", { ...visualPlan, generatedBy: planMethod });

    currentStage = "asset_resolution";
    await updateContentJobRecord(jobId, { currentStage: "asset_resolution" });
    const planScenes = Array.isArray((visualPlan.visual_plan as Record<string, unknown>)?.scenes)
      ? (visualPlan.visual_plan as { scenes: Array<Record<string, unknown>> }).scenes
      : [];
    const assetProviders = dependencies.assetProviders ?? configuredAssetProviders();
    const assetResolutions = await Promise.all(planScenes.map((scene, index) => resolveVisualAsset({
      sceneDescription: typeof scene.visual === "string" ? scene.visual : cues[index]?.visualDirection ?? request.topic,
      topic: request.topic,
      keywords: [
        typeof scene.purpose === "string" ? scene.purpose : "",
        typeof scene.source_query === "string" ? scene.source_query : "",
      ].filter(Boolean),
      preferredMediaType: "image",
      durationSeconds: Number(scene.duration) || request.targetSeconds / Math.max(planScenes.length, 1),
      visualRole: typeof scene.purpose === "string" ? scene.purpose : undefined,
    }, { providers: assetProviders, now })));
    const assetManifest = {
      status: assetResolutions.every((resolution) => resolution.status === "procedural")
        ? "resolved_procedurally"
        : "resolved",
      providerConfigured: assetProviders.some((provider) => provider.isConfigured()),
      assets: assetResolutions.map((resolution, index) => ({
        scene: index + 1,
        resolved: true,
        strategy: resolution.status,
        description: planScenes[index]?.visual,
        proceduralKind: resolution.proceduralKind,
        reason: resolution.reason,
        attempts: resolution.attempts,
        ...(resolution.asset ? { asset: resolution.asset, externalMediaUsed: resolution.asset.source === "online" } : {
          type: "procedural_graphic",
          source: "Generated locally by NOVA's topic-aware FFmpeg renderer.",
          externalMediaUsed: false,
        }),
      })),
    };
    await saveJson(jobId, "asset_manifest", assetManifest);

    currentStage = "audio";
    await updateContentJobRecord(jobId, { currentStage: "audio" });
    const audioRecord = {
      status: request.narration ? "provider_unavailable" : "not_requested",
      narrationRequested: request.narration,
      narrationGenerated: false,
      musicGenerated: false,
      audioTrackPresent: false,
      fallback: request.captions ? "On-screen captions are included." : "The result is a silent visual video.",
    };
    await saveJson(jobId, "audio", audioRecord);

    currentStage = "timeline";
    await updateContentJobRecord(jobId, { currentStage: "timeline" });
    const timelineDraft = buildTimelineDraft(request, scriptResult.script, planScenes, assetResolutions);
    const timelineRaw = unwrapToolResult(await editingModuleTool.handler(timelineDraft, emptyState()));
    if (timelineRaw.isError) throw new Error(`Timeline validation failed: ${timelineRaw.content}`);
    const timelineResult = parseObject(timelineRaw.content);
    const timeline = timelineResult.timeline as VideoTimeline;
    await saveJson(jobId, "timeline", timeline);

    const capabilities = await discoverMediaCapabilities(dependencies.executableFinder);
    await writeContentArtifact(jobId, "request", JSON.stringify({ request, mediaCapabilities: capabilities }, null, 2));
    if (!capabilities.ffmpegAvailable || !capabilities.ffprobeAvailable) {
      const missing = [
        ...(!capabilities.ffmpegAvailable ? ["ffmpeg"] : []),
        ...(!capabilities.ffprobeAvailable ? ["ffprobe"] : []),
      ].join(" and ");
      throw new Error(`Dependency failure: ${missing} is unavailable on ${capabilities.platform}. Install the Windows build or configure FFMPEG_PATH/FFPROBE_PATH.`);
    }

    currentStage = "rendering";
    await updateContentJobRecord(jobId, { currentStage: "rendering" });
    const engine = dependencies.videoEngine ?? videoEngineTool;
    const renderInput = {
      action: "render",
      id: jobId,
      output: finalPath,
      aspect_ratio: timeline.aspect_ratio,
      scenes: timeline.scenes,
    };
    const renderResult = await invokeVideoTool(engine, renderInput);
    const outputPath = typeof renderResult.outputPath === "string" ? renderResult.outputPath : finalPath;
    const absoluteOutput = await resolveWorkspacePath(outputPath);
    const outputStat = await fs.stat(absoluteOutput);
    if (!outputStat.isFile() || outputStat.size <= 0) throw new Error("Render failed: FFmpeg returned without producing a non-empty MP4 file.");
    await saveJson(jobId, "render", { ...renderResult, fileBytes: outputStat.size, attempt: 1 });

    currentStage = "validation";
    await updateContentJobRecord(jobId, { currentStage: "validation" });
    let probe = await invokeVideoTool(engine, { action: "probe", path: outputPath });
    let checked = validateProbe(probe, request, timeline.width, timeline.height);
    let renderAttempts = 1;
    if (!checked.valid && checked.actualDuration && checked.actualDuration > 0 &&
        checked.reasons.every((reason) => reason.startsWith("Rendered duration"))) {
      currentStage = "repair";
      await updateContentJobRecord(jobId, { currentStage: "repair", note: "Adjusted scene timing to match probed duration; bounded retry 1 of 1." });
      const factor = request.targetSeconds / checked.actualDuration;
      const scaledDurations = timeline.scenes.map((scene) => Number((scene.duration * factor).toFixed(3)));
      if (scaledDurations.some((duration) => duration < 0.1 || duration > 120)) {
        throw new Error("The measured duration mismatch cannot be repaired within scene timing limits.");
      }
      const repairedScenes: VideoSceneDefinition[] = timeline.scenes.map((scene, index) => ({
        ...scene,
        duration: scaledDurations[index],
      }));
      const repairedTotal = Number(scaledDurations.reduce((sum, duration) => sum + duration, 0).toFixed(3));
      const repairedTimeline = { ...timeline, scenes: repairedScenes, total_duration: repairedTotal };
      renderAttempts += 1;
      const retryResult = await invokeVideoTool(engine, {
        ...renderInput,
        scenes: repairedTimeline.scenes,
      });
      const retryStat = await fs.stat(absoluteOutput);
      probe = await invokeVideoTool(engine, { action: "probe", path: outputPath });
      checked = validateProbe(probe, request, timeline.width, timeline.height);
      await saveJson(jobId, "render", { ...retryResult, fileBytes: retryStat.size, attempt: renderAttempts, repairedDuration: true });
      await saveJson(jobId, "timeline", repairedTimeline);
    }

    const validation = {
      valid: checked.valid,
      reasons: checked.reasons,
      requested: {
        durationSeconds: request.targetSeconds,
        aspectRatio: request.aspectRatio,
        width: timeline.width,
        height: timeline.height,
        frameRate: timeline.frame_rate,
        container: "mp4",
      },
      discovered: checked.metadata,
      fileBytes: (await fs.stat(absoluteOutput)).size,
      renderAttempts,
      validatedAt: now().toISOString(),
    };
    await saveJson(jobId, "validation", validation);
    if (!checked.valid) throw new Error(`Video validation failed: ${checked.reasons.join("; ")}`);

    currentStage = "validation";
    const finalRecord = {
      valid: true,
      jobId,
      topic: request.topic,
      title: request.title ?? scriptResult.script.title,
      outputPath,
      artifactDirectory: path.relative(path.resolve("workspace"), jobRoot).replaceAll("\\", "/"),
      completedAt: now().toISOString(),
      researchStatus: research.status,
      inspectedSourceCount: research.sourceCount,
      scriptValidation: scriptResult.validation,
      scriptQa,
      visualPlanMethod: planMethod,
      assetManifest,
      audio: audioRecord,
      validation,
      narrationGenerated: false as const,
    };
    await saveJson(jobId, "final", finalRecord);
    const recordPath = `nova/jobs/${jobId}/final.json`;
    await updateContentJobRecord(jobId, {
      status: "completed",
      currentStage: "validation",
      outputPath,
      note: `Validated ${outputPath}.`,
    });

    const memory = unwrapToolResult(await novaMemoryTool.handler({
      action: "append",
      entry: `Completed a validated ${request.targetSeconds}s ${request.aspectRatio} video job for "${request.topic}" using ${assetResolutions.filter((item) => item.status === "local").length} local, ${assetResolutions.filter((item) => item.status === "online").length} provider, and ${assetResolutions.filter((item) => item.status === "procedural").length} procedural visuals; artifact: ${outputPath}. TTS provider unavailable, so narration was not generated.`,
    }, emptyState()));
    if (memory.isError) console.warn(`[NOVA] Memory entry was not saved: ${memory.content}`);

    return {
      ok: true,
      jobId,
      title: request.title ?? scriptResult.script.title,
      outputPath,
      finalRecordPath: recordPath,
      durationSeconds: Number(checked.metadata?.durationSeconds),
      width: timeline.width,
      height: timeline.height,
      frameRate: timeline.frame_rate,
      researchStatus: research.status,
      narrationGenerated: false,
      validation,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateContentJobRecord(jobId, {
      status: "failed",
      currentStage: currentStage === "rendering" || currentStage === "validation" ? "repair" : currentStage as ContentJobStage,
      error: message,
      note: `Failed during ${currentStage}: ${message}`,
    }).catch(() => undefined);
    await saveJson(jobId, "final", {
      valid: false,
      jobId,
      failedStage: currentStage,
      error: message,
      failedAt: now().toISOString(),
    }).catch(() => undefined);
    throw new Error(`Video production failed during ${currentStage}: ${message}`);
  }
}

export async function resumeVideoProduction(
  requestedJobId: string,
  dependencies: ProductionDependencies = {},
): Promise<ProductionResult> {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(requestedJobId)) {
    throw new Error("Cannot resume: jobId must contain only letters, numbers, underscores, or hyphens.");
  }
  const job = await loadContentJobRecord(requestedJobId);
  if (!job) throw new Error(`Cannot resume: content job ${requestedJobId} does not exist.`);
  // Use the ID stored in the job record for every artifact/output path.
  const jobId = job.id;
  if (job.status === "completed") {
    throw new Error("Cannot resume " + jobId + ": this content job is already completed.");
  }
  const allowedStages = new Set(["rendering", "validation", "repair"]);
  if (!allowedStages.has(job.currentStage)) {
    throw new Error(`Cannot resume ${jobId} from ${job.currentStage}; this build resumes saved timelines at rendering or validation.`);
  }

  const requestArtifact = parseObject(await readContentArtifact(jobId, "request"));
  const requestValue = requestArtifact.request && typeof requestArtifact.request === "object"
    ? requestArtifact.request as Record<string, unknown>
    : requestArtifact;
  const request = requestValue as unknown as VideoProductionRequest;
  if (typeof request.topic !== "string" || typeof request.targetSeconds !== "number" ||
      !["16:9", "9:16", "1:1"].includes(request.aspectRatio)) {
    throw new Error(`Cannot resume ${jobId}: saved request requirements are invalid.`);
  }
  const timeline = parseObject(await readContentArtifact(jobId, "timeline")) as unknown as VideoTimeline;
  if (!Array.isArray(timeline.scenes) || timeline.scenes.length === 0) {
    throw new Error(`Cannot resume ${jobId}: the saved timeline is missing or invalid.`);
  }

  const capabilities = await discoverMediaCapabilities(dependencies.executableFinder);
  if (!capabilities.ffmpegAvailable || !capabilities.ffprobeAvailable) {
    throw new Error(`Dependency failure while resuming on ${capabilities.platform}: ffmpeg and ffprobe must both be available.`);
  }

  const outputPath = `nova/jobs/${jobId}/final.mp4`;
  const absoluteOutput = await resolveWorkspacePath(outputPath);
  const engine = dependencies.videoEngine ?? videoEngineTool;
  try {
    await updateContentJobRecord(jobId, {
      status: "active",
      currentStage: "rendering",
      error: "",
      note: "Resuming from the saved validated timeline.",
    });
    const render = await invokeVideoTool(engine, {
      action: "render",
      id: jobId,
      output: outputPath,
      aspect_ratio: timeline.aspect_ratio,
      scenes: timeline.scenes,
    });
    const outputStat = await fs.stat(absoluteOutput);
    if (!outputStat.isFile() || outputStat.size <= 0) throw new Error("Resumed render produced no non-empty file.");
    await saveJson(jobId, "render", { ...render, attempt: 1, fileBytes: outputStat.size, resumed: true });

    await updateContentJobRecord(jobId, { currentStage: "validation" });
    const probe = await invokeVideoTool(engine, { action: "probe", path: outputPath });
    const checked = validateProbe(probe, request, timeline.width, timeline.height);
    const validation = {
      valid: checked.valid,
      reasons: checked.reasons,
      requested: {
        durationSeconds: request.targetSeconds,
        aspectRatio: request.aspectRatio,
        width: timeline.width,
        height: timeline.height,
        frameRate: timeline.frame_rate,
        container: "mp4",
      },
      discovered: checked.metadata,
      fileBytes: outputStat.size,
      renderAttempts: 1,
      resumed: true,
      validatedAt: (dependencies.now?.() ?? new Date()).toISOString(),
    };
    await saveJson(jobId, "validation", validation);
    if (!checked.valid) throw new Error(`Resumed video validation failed: ${checked.reasons.join("; ")}`);

    const researchText = await readContentArtifact(jobId, "research").catch(() => "");
    const researchStatus = researchText.match(/^- Status: (sourced|search_only|unavailable)$/m)?.[1] as ProductionResult["researchStatus"] | undefined;
    const finalRecord = {
      valid: true,
      jobId,
      topic: request.topic,
      title: job.title,
      outputPath,
      completedAt: (dependencies.now?.() ?? new Date()).toISOString(),
      researchStatus: researchStatus ?? "unavailable",
      validation,
      narrationGenerated: false,
      resumed: true,
    };
    await saveJson(jobId, "final", finalRecord);
    await updateContentJobRecord(jobId, {
      status: "completed",
      currentStage: "validation",
      outputPath,
      error: "",
      note: `Resumed and validated ${outputPath}.`,
    });
    return {
      ok: true,
      jobId,
      title: job.title,
      outputPath,
      finalRecordPath: `nova/jobs/${jobId}/final.json`,
      durationSeconds: Number(checked.metadata?.durationSeconds),
      width: timeline.width,
      height: timeline.height,
      frameRate: timeline.frame_rate,
      researchStatus: researchStatus ?? "unavailable",
      narrationGenerated: false,
      validation,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateContentJobRecord(jobId, {
      status: "failed",
      currentStage: "repair",
      error: message,
      note: `Resume failed: ${message}`,
    }).catch(() => undefined);
    await saveJson(jobId, "final", { valid: false, jobId, resumed: true, error: message }).catch(() => undefined);
    throw new Error(`Video job resume failed: ${message}`);
  }
}

export function createVideoProductionTool(
  llm: LlmClient,
  dependencies: ProductionDependencies = {},
): Tool {
  return {
    name: "video_production",
    description: "Run NOVA's complete local faceless-video production pipeline or resume a saved timeline after a render/validation failure. The pipeline saves research, script, QA, visual plan, procedural asset manifest, audio status, timeline, render and validation records. No image-generation or TTS provider is assumed.",
    parameters: {
      type: "object",
      properties: {
        idea: { type: "string", minLength: 8, maxLength: 2000 },
        jobId: { type: "string", minLength: 1, maxLength: 100, description: "Existing failed NOVA production job to resume from its saved timeline." },
      },
      required: [],
      additionalProperties: false,
    },
    async handler(input, state) {
      const lastUserMessage = [...state.messages].reverse().find((message) => message.role === "user");
      const jobId = typeof input.jobId === "string" ? input.jobId.trim() : "";
      const idea = typeof input.idea === "string" && input.idea.trim()
        ? input.idea.trim()
        : lastUserMessage?.content ?? "";
      if (!jobId && idea.length < 8) return { toolCallId: "", content: "A specific video idea is required.", isError: true };
      try {
        const result = jobId
          ? await resumeVideoProduction(jobId, dependencies)
          : await runVideoProduction(llm, idea, dependencies);
        state.finalSummary = `Created and validated ${result.outputPath} (${result.durationSeconds}s, ${result.width}x${result.height}, ${result.frameRate} fps). Research: ${result.researchStatus}. Narration generated: no.`;
        state.successfulStop = true;
        return JSON.stringify(result);
      } catch (error) {
        return {
          toolCallId: "",
          content: error instanceof Error ? error.message : String(error),
          isError: true,
        };
      }
    },
  };
}
