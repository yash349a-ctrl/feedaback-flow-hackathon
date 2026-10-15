/** End-to-end, credential-free smoke test of the local in-memory hackathon workflow. */
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  return port;
}

async function main() {
  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(npmCommand, ["run", "dev", "-w", "server"], {
    cwd: root,
    env: { ...process.env, NODE_ENV: "development", PORT: String(port), MONGODB_URI: "", OPENAI_API_KEY: "", TINYFISH_API_KEY: "", ENABLE_LOCAL_DEMO_MODE: "true", ENABLE_DEMO_SEED: "true", CLIENT_ORIGIN: "http://localhost:3000" },
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32"
  });
  let logs = "";
  child.stdout.on("data", (chunk) => { logs += chunk.toString(); });
  child.stderr.on("data", (chunk) => { logs += chunk.toString(); });
  const originalFetch = globalThis.fetch;

  async function request(route, options = {}) {
    const response = await fetch(`${baseUrl}${route}`, { ...options, headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`${options.method || "GET"} ${route} failed (${response.status}): ${data.error || response.statusText}`);
    return data;
  }

  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (child.exitCode !== null) throw new Error(`Backend exited before ready.\n${logs}`);
      try { const response = await fetch(`${baseUrl}/health`); if (response.ok) { ready = true; break; } } catch { /* wait */ }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert(ready, `Backend did not become ready.\n${logs}`);
    const status = await request("/api/status");
    assert(status.localDemoModeAvailable, "Local demo mode should be available without MongoDB in development.");
    const seeded = await request("/api/demo/seed", { method: "POST", body: JSON.stringify({}) });
    const projectId = seeded.project?._id;
    assert(projectId, "Demo seed should return a project id.");
    const comments = await request(`/api/projects/${projectId}/comments`);
    assert(comments.comments.length >= 20, "The demo should contain at least 20 representative comments.");
    const analysis = await request(`/api/projects/${projectId}/analyze`, { method: "POST", body: JSON.stringify({}) });
    assert(analysis.mode === "demo-fallback", "The no-key analysis path should use the deterministic demo fallback.");
    assert(analysis.comments.length >= 20 && analysis.tasksCreated > 0, "Analysis should classify comments and create revision tasks.");
    assert(analysis.groups.length > 0, "Analysis should suggest at least one duplicate group.");
    assert(analysis.conflicts.some((conflict) => conflict.kind === "contradiction"), "Analysis should find a planted contradiction.");

    const firstGroup = analysis.groups.find((group) => group.status === "proposed");
    assert(firstGroup, "There should be a proposed duplicate group to review.");
    await request(`/api/projects/${projectId}/groups/${firstGroup._id}/decision`, { method: "POST", body: JSON.stringify({ action: "merge" }) });

    const conflicts = await request(`/api/projects/${projectId}/conflicts`);
    for (const conflict of conflicts.conflicts.filter((item) => item.status === "open")) {
      await request(`/api/conflicts/${conflict._id}/resolve`, { method: "PATCH", body: JSON.stringify({ action: "follow_a" }) });
    }

    const tasksResponse = await request(`/api/projects/${projectId}/tasks`);
    const task = tasksResponse.tasks.find((item) => item.status === "todo");
    assert(task, "There should be a task to move through the approval workflow.");
    await request(`/api/tasks/${task._id}/status`, { method: "PATCH", body: JSON.stringify({ status: "in_review" }) });
    await request(`/api/tasks/${task._id}/approval`, { method: "POST", body: JSON.stringify({ decision: "approved", note: "Prototype smoke-test approval." }) });
    const history = await request(`/api/tasks/${task._id}/history`);
    assert(history.history.some((event) => event.decision === "approved"), "Approval should be persisted in in-memory history.");

    const importProject = await request("/api/projects", { method: "POST", body: JSON.stringify({ name: "Smoke Test Project", clientName: "Test Client" }) });
    const imported = await request(`/api/projects/${importProject.project._id}/comments`, { method: "POST", body: JSON.stringify({ source: "chat", text: "Reduce the header height.\n\nReduce the header height." }) });
    assert(imported.imported === 1 && imported.skipped === 1, "Bulk import should skip repeated comments.");

    console.log("PASS: API starts in local prototype mode without MongoDB credentials");
    console.log("PASS: seed project + feedback import + deterministic analysis");
    console.log("PASS: duplicate suggestion + conflict resolution");
    console.log("PASS: revision task status + approval history");
    console.log("PASS: duplicate import prevention");
  } finally {
    globalThis.fetch = originalFetch;
    if (child.exitCode === null) child.kill("SIGTERM");
    await new Promise((resolve) => { if (child.exitCode !== null) resolve(); else { child.once("exit", resolve); setTimeout(resolve, 3000).unref(); } });
    if (logs.includes("Could not connect to MongoDB")) { /* expected: this test deliberately runs without a URI */ }
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
