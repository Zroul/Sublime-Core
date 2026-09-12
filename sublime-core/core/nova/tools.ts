export interface NovaTool<Input = unknown, Output = unknown> {
  name: string;
  description: string;
  run(input: Input): Promise<Output>;
}

export class NovaToolRegistry {
  private readonly tools = new Map<string, NovaTool>();

  register<Input, Output>(tool: NovaTool<Input, Output>): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`NOVA tool already registered: ${tool.name}`);
    }

    this.tools.set(tool.name, tool as NovaTool);
  }

  get(name: string): NovaTool | undefined {
    return this.tools.get(name);
  }

  list(): Array<Pick<NovaTool, "name" | "description">> {
    return [...this.tools.values()].map(({ name, description }) => ({
      name,
      description,
    }));
  }
}

export const NOVA_TOOL_NAMES = {
  webSearch: "web_search",
  sourceFetch: "source_fetch",
  textToSpeech: "text_to_speech",
  imageSearch: "image_search",
  mediaProbe: "media_probe",
  videoRender: "video_render",
  captions: "captions",
} as const;
