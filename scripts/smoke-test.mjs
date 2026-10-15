/**
 * Fast, credential-free smoke checks for the hackathon prototype's key fallback logic.
 * This validates shipped source structure; it is not a substitute for `npm run typecheck`
 * or a real MongoDB/OpenAI/TinyFish integration run.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const required = [
  "client/src/app/page.tsx",
  "client/src/app/globals.css",
  "client/src/lib/api.ts",
  "server/src/index.ts",
  "server/src/models/index.ts",
  "server/src/services/ai.ts",
  "server/src/services/tinyfish.ts",
  "server/src/services/memoryDemo.ts",
  "server/scripts/demo-logic-test.ts",
  "server/scripts/tinyfish-mock-test.ts",
  "scripts/prototype-flow-test.mjs",
  "server/.env.example",
  "client/.env.example",
  "render.yaml",
];
const missing = required.filter((file) => !fs.existsSync(path.join(root, file)));
if (missing.length) {
  console.error("Missing required prototype files:", missing.join(", "));
  process.exit(1);
}
const server = fs.readFileSync(path.join(root, "server/src/index.ts"), "utf8");
const ai = fs.readFileSync(path.join(root, "server/src/services/ai.ts"), "utf8");
const tinyfish = fs.readFileSync(path.join(root, "server/src/services/tinyfish.ts"), "utf8");
const memoryDemo = fs.readFileSync(path.join(root, "server/src/services/memoryDemo.ts"), "utf8");
const page = fs.readFileSync(path.join(root, "client/src/app/page.tsx"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const checks = [
  ["Six-stage analysis pipeline", ["STAGE 2", "STAGE 3", "STAGE 4", "STAGE 5", "STAGE 6"].every((marker) => server.includes(marker))],
  ["OpenAI no-key heuristic fallback", ai.includes('mode: "demo-fallback"') && ai.includes("heuristicClassification")],
  ["Praise opinion classification", ai.includes("praiseOnly")],
  ["TinyFish Search", tinyfish.includes("api.search.tinyfish.ai")],
  ["TinyFish Fetch", tinyfish.includes("api.fetch.tinyfish.ai")],
  ["Optional in-memory demo API exists for isolated test only", memoryDemo.includes('localDemoRouter.post("/demo/seed"') && memoryDemo.includes('localDemoRouter.post("/projects/:projectId/analyze"')],
  ["Local fallback supports task approvals", memoryDemo.includes('localDemoRouter.post("/tasks/:taskId/approval"') && memoryDemo.includes('localDemoRouter.get("/tasks/:taskId/history"')],
  ["In-memory mode is an explicit opt-in", memoryDemo.includes('process.env.ENABLE_LOCAL_DEMO_MODE === "true"') && fs.readFileSync(path.join(root, "server/.env.example"), "utf8").includes("ENABLE_LOCAL_DEMO_MODE=false")],
  ["Dark/light mode toggle", page.includes("feedbackflow-theme") && page.includes("setTheme")],
  ["Local environment bootstrap", pkg.scripts?.["setup:env"] && pkg.scripts?.predev],
  ["Node 24 local install accepted", pkg.engines?.node?.includes("<25.0.0")],
  ["MongoDB connectivity checker included", fs.existsSync(path.join(root, "server/scripts/check-mongodb.ts")) && pkg.scripts?.["check:db"]],
];
let failed = false;
for (const [label, passed] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"} ${label}`);
  if (!passed) failed = true;
}
if (failed) process.exit(1);
console.log("Prototype smoke checks passed. Configure MongoDB Atlas for database-backed end-to-end use.");
