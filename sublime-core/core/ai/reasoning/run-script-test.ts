import { promises as fs } from "fs";
import path from "path";
import { generateScript } from "../nova/script-generator.js";

const researchPath = path.resolve("workspace", "research", "latest-gaming-research.md");
const research = await fs.readFile(researchPath, "utf8");
const result = await generateScript(research, "Latest major gaming news");

const outputPath = path.resolve("workspace", "scripts", "latest-gaming-news-script.json");
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, JSON.stringify(result, null, 2), "utf8");

console.log("\n===== NOVA RESEARCH -> SCRIPT =====\n");
console.log(JSON.stringify(result, null, 2));
console.log(`\nSaved: ${outputPath}`);
