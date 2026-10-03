import { promises as fs } from "node:fs";
import path from "node:path";

const WORKSPACE = path.resolve("workspace");

interface PhysicalPath {
  resolved: string;
  missing: string[];
}

async function resolveThroughExistingAncestor(target: string): Promise<PhysicalPath> {
  let current = target;
  const missing: string[] = [];

  while (true) {
    try {
      return {
        resolved: await fs.realpath(current),
        missing,
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;

      const parent = path.dirname(current);
      if (parent === current) throw error;
      missing.unshift(path.basename(current));
      current = parent;
    }
  }
}

function isWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

/** Resolve a workspace-relative path and reject lexical or symlink escapes. */
export async function resolveWorkspacePath(input: string): Promise<string> {
  if (typeof input !== "string" || !input.trim()) {
    throw new Error("A non-empty workspace-relative path is required.");
  }

  const target = path.resolve(WORKSPACE, input);
  const lexicalRelative = path.relative(WORKSPACE, target);
  if (
    lexicalRelative === ".." ||
    lexicalRelative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(lexicalRelative)
  ) {
    throw new Error("Path is outside the Sublime Core workspace.");
  }

  const [physicalWorkspace, physicalTarget] = await Promise.all([
    resolveThroughExistingAncestor(WORKSPACE),
    resolveThroughExistingAncestor(target),
  ]);
  const workspaceRoot = path.resolve(
    physicalWorkspace.resolved,
    ...physicalWorkspace.missing,
  );
  const resolvedTarget = path.resolve(
    physicalTarget.resolved,
    ...physicalTarget.missing,
  );

  if (!isWithin(workspaceRoot, resolvedTarget)) {
    throw new Error("Path resolves outside the Sublime Core workspace.");
  }

  return target;
}
