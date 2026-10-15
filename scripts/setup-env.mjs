import { copyFile, access, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const entries = [
  { example: "server/.env.example", target: "server/.env", label: "Backend environment" },
  { example: "client/.env.example", target: "client/.env.local", label: "Frontend environment" },
];

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

let created = false;
for (const entry of entries) {
  const target = path.join(root, entry.target);
  if (await exists(target)) continue;
  const source = path.join(root, entry.example);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(source, target);
  console.log(`Created ${entry.target} from ${entry.example}.`);
  created = true;
}
if (created) {
  console.log("Next: set MONGODB_URI in server/.env to your MongoDB Atlas connection string.");
  console.log("Optional live AI features: add OPENAI_API_KEY and TINYFISH_API_KEY in server/.env.");
} else {
  console.log("Environment files already exist; left them unchanged.");
}
