import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "linex-test-build-"));

function runNode(args, label) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(label + " exited with status " + (result.status ?? "unknown") + ".");
  }
}

try {
  const compiler = path.join(root, "node_modules", "typescript", "bin", "tsc");
  runNode([compiler, "--outDir", outputDirectory, "--sourceMap", "false"], "TypeScript compilation");
  await writeFile(path.join(outputDirectory, "package.json"), '{"type":"module"}\\n', "utf8");
  runNode(["--test", path.join(outputDirectory, "linex", "agent.test.js")], "LINEX agent tests");
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
} finally {
  await rm(outputDirectory, { recursive: true, force: true });
}
