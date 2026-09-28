import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import type { Tool } from "../reasoning/types.js";

const execFileAsync = promisify(execFile);

const WORKSPACE = path.resolve("workspace");

const allowedCommands = new Set([
  "node",
  "node.exe",
  "npm",
  "npm.cmd",
  "npx",
  "npx.cmd",
]);

export const runCommandTool: Tool = {
  name: "run_command",
  description:
    "Run a safe development command inside the Sublime Core workspace.",

  parameters: {
    type: "object",

    properties: {
      command: {
        type: "string",
        description:
          "Command to run. Only node, npm, and npx commands are allowed (including Windows .cmd variants).",
      },

      args: {
        type: "array",
        description: "Arguments passed to the command.",
        items: {
          type: "string",
        },
      },
    },

    required: ["command", "args"],
    additionalProperties: false,
  },

  async handler(input) {
    const command = String(input.command);

    const args = Array.isArray(input.args)
      ? input.args.map(String)
      : [];

    if (!allowedCommands.has(command)) {
      return `Command blocked: ${command}. Allowed commands: node, node.exe, npm, npm.cmd, npx, npx.cmd.`;
    }

    try {
      const result = await execFileAsync(command, args, {
        cwd: WORKSPACE,
        timeout: 30000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      });

      const output = result.stdout.trim();
      const errors = result.stderr.trim();

      if (errors) {
        return `Command completed.\n\nOutput:\n${output}\n\nWarnings:\n${errors}`;
      }

      return output || "Command completed successfully.";
    } catch (error) {
      const err = error as {
        message?: string;
        stdout?: string;
        stderr?: string;
      };

      return {
        toolCallId: "",
        content: [
          "Command failed.",
          err.message ?? "",
          err.stdout ? `Output:\n${err.stdout}` : "",
          err.stderr ? `Error:\n${err.stderr}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
        isError: true,
      };
    }
  },
};