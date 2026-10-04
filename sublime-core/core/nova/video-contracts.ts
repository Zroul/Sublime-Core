/** Small shared contracts for NOVA's existing planning and render boundary. */
export interface VideoAssetReference {
  id: string;
  location: string;
  sourceUrl?: string;
  rightsNote?: string;
}

export interface VideoAssetRequirement {
  query: string;
  mediaType?: string;
}

export interface VideoPlanScene {
  index: number;
  duration: number;
  purpose: string;
  visual: string;
  visual_type?: "card" | "flow" | "network" | "diagram";
  accent_color?: string;
  source_query?: string;
  narration?: string;
  caption?: string;
}

export interface VideoVisualPlan {
  type: "nova_visual_plan_v1";
  scenes: VideoPlanScene[];
}

export interface VideoSceneDefinition {
  index: number;
  duration: number;
  visual?: string;
  visual_type?: "card" | "flow" | "network" | "diagram";
  accent_color?: string;
  caption?: string;
  caption_segments?: Array<{
    text: string;
    start: number;
    end: number;
  }>;
  source_query?: string;
  /** A validated workspace-relative asset selected by the asset resolver. */
  asset_path?: string;
  asset_media_type?: "image" | "video";
  asset_fit?: "cover" | "contain";
  /** The visual primitive used when no permitted media asset is available. */
  procedural_kind?: "generic" | "ai_video" | "sky_scattering" | "cpu_architecture";
  asset_references?: VideoAssetReference[];
  background?: string;
  text?: string;
  text_size?: number;
  text_position?: "top" | "center" | "bottom";
  text_max_width?: number;
}

export interface VideoTimeline {
  type: "nova_timeline_v2";
  aspect_ratio: "16:9" | "9:16" | "1:1";
  scenes: VideoSceneDefinition[];
  total_duration: number;
  width: number;
  height: number;
  frame_rate: number;
}

export interface VideoEditingResult {
  ok: true;
  action: "build_timeline";
  aspect_ratio: VideoTimeline["aspect_ratio"];
  scene_count: number;
  total_duration: number;
  timeline: VideoTimeline;
  next_step: string;
}

export interface VideoSpecification {
  width: number;
  height: number;
  frameRate: number;
  durationSeconds: number;
  outputPath: string;
}

export interface VideoRenderResult {
  ok: boolean;
  outputPath?: string;
  sceneCount?: number;
  specification?: VideoSpecification;
  error?: string;
}

export interface VideoProbeMetadata {
  formatName: string;
  durationSeconds: number;
  sizeBytes?: number;
  streams: Array<{
    type?: string;
    codec?: string;
    width?: number;
    height?: number;
    frameRate?: string;
  }>;
}

export interface VideoProbeResult {
  ok: boolean;
  valid: boolean;
  outputPath: string;
  metadata?: VideoProbeMetadata;
  error?: string;
}
