export type MediaKind = "audio" | "image" | "video" | "caption";

export interface MediaAsset {
  id: string;
  kind: MediaKind;
  path: string;
  mimeType?: string;
  source?: string;
  license?: string;
  durationMs?: number;
  width?: number;
  height?: number;
}

export interface TimelineClip {
  assetId: string;
  startMs: number;
  endMs: number;
  track: number;
  text?: string;
}

export interface VideoTimeline {
  width: number;
  height: number;
  fps: number;
  durationMs: number;
  clips: TimelineClip[];
}

export interface MediaAbilities {
  textToSpeech?(text: string, outputPath: string): Promise<MediaAsset>;
  probe?(filePath: string): Promise<MediaAsset>;
  render?(timeline: VideoTimeline, outputPath: string): Promise<MediaAsset>;
  generateCaptions?(audioPath: string, outputPath: string): Promise<MediaAsset>;
}
