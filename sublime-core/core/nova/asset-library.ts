import { constants as fsConstants, promises as fs } from "node:fs";
import path from "node:path";
import type { Tool } from "../reasoning/types.js";
import { resolveWorkspacePath } from "../ai/tools/workspace-path.js";

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".mkv", ".webm", ".m4v"]);
const SOURCE_FOLDERS = new Set(["Clips", "Memes"]);

async function collectVideos(root: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(directory: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else if (entry.isFile() && VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        found.push(fullPath);
      }
    }
  }
  await walk(root);
  return found.sort((a, b) => a.localeCompare(b));
}

/**
 * Copies user-owned local clips from the repository's Assets/Clips and
 * Assets/Memes folders into workspace/assets/INBOX without modifying originals.
 */
export function createLocalAssetImportTool(): Tool {
  return {
    name: "import_local_assets",
    description: "Copy video clips from the local repository Assets/Clips and/or Assets/Memes folders into workspace/assets/INBOX for NOVA to categorize or use in edits. Originals are never moved or deleted. Existing destination files are skipped. Does not upload files or access the internet.",
    parameters: {
      type: "object",
      properties: {
        source_folders: {
          type: "array",
          items: { type: "string", enum: ["Clips", "Memes"] },
          minItems: 1,
          maxItems: 2,
          uniqueItems: true,
        },
        max_files: { type: "integer", minimum: 1, maximum: 200 },
      },
      required: [],
      additionalProperties: false,
    },
    async handler(args) {
      try {
        const requested = args.source_folders === undefined ? ["Clips", "Memes"] : args.source_folders;
        if (!Array.isArray(requested) || requested.length < 1 || requested.length > 2 ||
            requested.some((item) => typeof item !== "string" || !SOURCE_FOLDERS.has(item)) ||
            new Set(requested).size !== requested.length) {
          throw new Error("source_folders must contain Clips and/or Memes.");
        }
        const maxFiles = args.max_files === undefined ? 100 : Number(args.max_files);
        if (!Number.isInteger(maxFiles) || maxFiles < 1 || maxFiles > 200) {
          throw new Error("max_files must be an integer from 1 to 200.");
        }

        // The source is intentionally fixed to the repository's Assets folder;
        // model-supplied arbitrary filesystem paths are never accepted.
        const repositoryAssets = path.resolve(process.cwd(), "Assets");
        const inbox = await resolveWorkspacePath("assets/INBOX");
        await fs.mkdir(inbox, { recursive: true });
        const results: Array<{ source: string; destination: string; status: "copied" | "skipped_existing" }> = [];
        let scanned = 0;

        for (const folder of requested as string[]) {
          const sourceRoot = path.join(repositoryAssets, folder);
          let stat;
          try {
            stat = await fs.stat(sourceRoot);
          } catch {
            throw new Error("Local source folder not found: Assets/" + folder + ". Run NOVA from the repository root and check that the folder exists.");
          }
          if (!stat.isDirectory()) throw new Error("Assets/" + folder + " is not a directory.");
          const files = await collectVideos(sourceRoot);
          for (const sourceFile of files) {
            scanned += 1;
            if (scanned > maxFiles) {
              throw new Error("More than " + maxFiles + " clips were found. Import a smaller source_folders selection or raise max_files (maximum 200).");
            }
            const relative = path.relative(repositoryAssets, sourceFile);
            const destination = path.join(inbox, relative);
            await fs.mkdir(path.dirname(destination), { recursive: true });
            const relativeSource = path.relative(process.cwd(), sourceFile).replaceAll("\\\\", "/");
            const relativeDestination = path.relative(await resolveWorkspacePath("."), destination).replaceAll("\\\\", "/");
            try {
              await fs.copyFile(sourceFile, destination, fsConstants.COPYFILE_EXCL);
              results.push({ source: relativeSource, destination: relativeDestination, status: "copied" });
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code === "EEXIST") {
                results.push({ source: relativeSource, destination: relativeDestination, status: "skipped_existing" });
              } else {
                throw error;
              }
            }
          }
        }

        return JSON.stringify({
          ok: true,
          sourceFolders: requested,
          inbox: "workspace/assets/INBOX",
          scanned: results.length,
          copied: results.filter((item) => item.status === "copied").length,
          skippedExisting: results.filter((item) => item.status === "skipped_existing").length,
          originalsPreserved: true,
          results,
        });
      } catch (error) {
        return {
          toolCallId: "",
          content: JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }),
          isError: true,
        };
      }
    },
  };
}
