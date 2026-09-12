export type NovaStage =
  | "trend_scout"
  | "research"
  | "rank"
  | "script"
  | "voice"
  | "visuals"
  | "video_build"
  | "captions"
  | "quality_check"
  | "ready_to_review"
  | "failed";

export interface NovaJob {
  id: string;
  topic: string;
  createdAt: string;
  stage: NovaStage;
  outputDir: string;
  status: "queued" | "running" | "completed" | "failed";
  error?: string;
  failedFromStage?: NovaStage;
}

export interface NovaStageResult {
  stage: NovaStage;
  ok: boolean;
  summary: string;
  data?: Record<string, unknown>;
}

export interface LocalBrain {
  complete(input: {
    system: string;
    prompt: string;
  }): Promise<string>;
}
