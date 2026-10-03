import { promises as fs } from "node:fs";
import path from "node:path";
import type { Tool } from "../reasoning/types.js";
import { resolveWorkspacePath } from "./workspace-path.js";

export const verifyArtifactTool: Tool = {
  name: "verify_artifact",
  description:
    "Verify that an exact workspace file or directory exists and report its type, size, and basic metadata.",

  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Exact workspace-relative path to verify.",
      },
    },
    required: ["path"],
    additionalProperties: false,
  },

  async handler(input) {
    const requestedPath = String(input.path ?? "");
    if (!requestedPath) {
      return {
        toolCallId: "",
        content: "Verification failed: path is required.",
        isError: true,
      };
    }

    try {
      const absolute = await resolveWorkspacePath(requestedPath);
      const stat = await fs.stat(absolute);

      return {
        toolCallId: "",
        content: JSON.stringify({
          verified: true,
          path: requestedPath.replaceAll("\\", "/"),
          type: stat.isFile()
            ? "file"
            : stat.isDirectory()
              ? "directory"
              : "other",
          sizeBytes: stat.size,
          modifiedAt: stat.mtime.toISOString(),
        }),
      };
    } catch (error) {
      return {
        toolCallId: "",
        content: JSON.stringify({
          verified: false,
          path: requestedPath.replaceAll("\\", "/"),
          error: error instanceof Error ? error.message : String(error),
        }),
        isError: true,
      };
    }
  },
};
