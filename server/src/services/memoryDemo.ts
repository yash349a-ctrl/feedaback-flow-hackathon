import { randomBytes } from "node:crypto";
import express, { type Request, type Response, type NextFunction } from "express";
import { analyzeComments, buildTaskTitle, extractWebFeedbackItems, findConflicts, findDuplicateGroups } from "./ai";
import { fetchWebsiteContext, searchFeedbackSources } from "./tinyfish";
import { HttpError } from "../utils/http";
import { asyncHandler } from "../utils/asyncHandler";

/**
 * Optional in-memory fallback for offline rehearsals only.
 * Normal prototype operation uses MongoDB. Enable this explicitly with
 * ENABLE_LOCAL_DEMO_MODE=true only when you intentionally want non-persistent data.
 */
type Source = "chat" | "email" | "document" | "screenshot" | "web";
type FeedbackType = "unanalyzed" | "actionable" | "question" | "opinion";
type Priority = "low" | "medium" | "high";
type TaskStatus = "todo" | "in_progress" | "in_review" | "approved";
type ProjectRecord = any;
type CommentRecord = any;
type GroupRecord = any;
type ConflictRecord = any;
type TaskRecord = any;
type ApprovalRecord = any;

const state = {
  activated: false,
  projects: [] as ProjectRecord[],
  comments: [] as CommentRecord[],
  groups: [] as GroupRecord[],
  conflicts: [] as ConflictRecord[],
  tasks: [] as TaskRecord[],
  approvals: [] as ApprovalRecord[]
};

const newId = () => randomBytes(12).toString("hex");
const now = () => new Date();
const text = (value: unknown, fallback = "") => typeof value === "string" ? value.trim() : fallback;
const validProjectId = (id: string) => state.projects.find((p) => p._id === id);
const byId = <T extends { _id: string }>(items: T[], id: string) => items.find((item) => item._id === id);
const sortNewest = <T extends { createdAt?: Date }>(items: T[]) => [...items].sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

export function isLocalDemoModeActive(): boolean { return state.activated; }

export function canOfferLocalDemo(databaseConnected: boolean): boolean {
  const devModeAllowed = process.env.NODE_ENV !== "production" && process.env.ENABLE_LOCAL_DEMO_MODE === "true";
  return state.activated || (!databaseConnected && devModeAllowed);
}

export function shouldRouteToLocalDemo(databaseConnected: boolean): boolean {
  if (state.activated) return true;
  return !databaseConnected && process.env.NODE_ENV !== "production" && process.env.ENABLE_LOCAL_DEMO_MODE === "true";
}

function getProject(projectId: string): ProjectRecord {
  const project = byId(state.projects, projectId);
  if (!project) throw new HttpError(404, "Project not found.");
  return project;
}
function projectComments(projectId: string): CommentRecord[] {
  return state.comments.filter((comment) => comment.projectId === projectId).sort((a, b) => a.sequence - b.sequence);
}
function projectGroups(projectId: string): GroupRecord[] { return state.groups.filter((group) => group.projectId === projectId); }
function projectConflicts(projectId: string): ConflictRecord[] { return state.conflicts.filter((conflict) => conflict.projectId === projectId); }
function projectTasks(projectId: string): TaskRecord[] { return state.tasks.filter((task) => task.projectId === projectId); }
function commentById(id: string): CommentRecord | undefined { return byId(state.comments, id); }
function projectCounts(projectId: string) {
  return {
    comments: state.comments.filter((c) => c.projectId === projectId).length,
    tasks: state.tasks.filter((t) => t.projectId === projectId).length,
    proposedGroups: state.groups.filter((g) => g.projectId === projectId && g.status === "proposed").length,
    openConflicts: state.conflicts.filter((c) => c.projectId === projectId && c.status === "open").length
  };
}
function normalizeFeedback(value: string) { return value.toLowerCase().replace(/\s+/g, " ").trim(); }
function splitFeedback(raw: string): string[] {
  const normalized = raw.replace(/\r/g, "\n").trim();
  const blocks = normalized.split(/\n\s*\n|^\s*---+\s*$/m).map((part) => part.trim()).filter(Boolean);
  return blocks.length ? blocks : normalized ? [normalized] : [];
}
function pairKey(ids: string[]) { return ids.map(String).sort().join(":"); }
function priorityRank(value: string) { return value === "high" ? 3 : value === "medium" ? 2 : 1; }
function makeProject(input: { name: string; clientName?: string; websiteUrl?: string }, isDemo = false): ProjectRecord {
  const date = now();
  return {
    _id: newId(), name: input.name.trim(), clientName: text(input.clientName, "Client") || "Client",
    websiteUrl: text(input.websiteUrl), createdAt: date, updatedAt: date, isDemo
  };
}
function makeComment(projectId: string, rawText: string, source: Source, sequence: number, extras: Record<string, unknown> = {}): CommentRecord {
  const date = now();
  return {
    _id: newId(), projectId, rawText: rawText.slice(0, 5000), source, sequence, receivedAt: date,
    type: "unanalyzed" as FeedbackType, normalizedRequest: "", priority: "medium" as Priority,
    needsClarification: false, clarificationNote: "", groupId: null, taskId: null,
    createdAt: date, updatedAt: date, ...extras
  };
}
function populatedGroup(group: GroupRecord) { return { ...group, commentIds: group.commentIds.map(commentById).filter(Boolean), taskId: byId(state.tasks, String(group.taskId)) || null }; }
function populatedConflict(conflict: ConflictRecord) { return { ...conflict, commentIds: conflict.commentIds.map(commentById).filter(Boolean) }; }
function populatedTask(task: TaskRecord) {
  return { ...task, sourceCommentIds: task.sourceCommentIds.map(commentById).filter(Boolean), conflictIds: task.conflictIds.map((id: string) => byId(state.conflicts, id)).filter(Boolean) };
}
function updateTaskConflictLinks(projectId: string) {
  for (const task of projectTasks(projectId)) {
    const sources = new Set<string>(task.sourceCommentIds.map(String));
    task.conflictIds = projectConflicts(projectId)
      .filter((conflict) => conflict.commentIds.some((id: string) => sources.has(String(id))))
      .map((conflict) => conflict._id);
    task.updatedAt = now();
  }
}
function createTask(projectId: string, comments: CommentRecord[], title?: string): TaskRecord | null {
  const actionable = comments.filter((comment) => comment.type === "actionable");
  if (!actionable.length) return null;
  const high = actionable.slice().sort((a, b) => priorityRank(b.priority) - priorityRank(a.priority))[0];
  const clarification = actionable.find((comment) => comment.needsClarification);
  const date = now();
  const task: TaskRecord = {
    _id: newId(), projectId,
    title: (title || buildTaskTitle(actionable[0])).trim().slice(0, 180) || "Review client feedback",
    description: actionable.length > 1 ? `Consolidated from ${actionable.length} client comments. Review original source evidence before implementing.` : actionable[0].normalizedRequest || actionable[0].rawText,
    priority: high.priority || "medium", status: "todo" as TaskStatus,
    sourceCommentIds: actionable.map((comment) => comment._id), needsClarification: Boolean(clarification),
    clarificationNote: clarification?.clarificationNote || "", conflictIds: [], createdAt: date, updatedAt: date
  };
  state.tasks.push(task);
  for (const comment of actionable) { comment.taskId = task._id; comment.groupId = null; comment.updatedAt = date; }
  return task;
}
async function ensureProjectFromRequest(req: Request): Promise<ProjectRecord> {
  const id = String(req.params.projectId || "");
  if (!/^[a-f0-9]{24}$/i.test(id)) throw new HttpError(400, "Invalid resource ID.");
  return getProject(id);
}

const DEMO_COMMENTS: Array<{ text: string; source: Source }> = [
  { text: "Make the header smaller on all screens.", source: "chat" },
  { text: "The navigation takes up too much space at the top.", source: "email" },
  { text: "Increase the header height on all screens.", source: "chat" },
  { text: "Increase the logo size to improve visibility.", source: "email" },
  { text: "Actually, keep the logo size unchanged.", source: "chat" },
  { text: "Change the button color to green.", source: "email" },
  { text: "Can we make the buttons green?", source: "chat" },
  { text: "Do you think blue works better?", source: "chat" },
  { text: "I love the new layout!", source: "email" },
  { text: "Make it pop.", source: "chat" },
  { text: "Add a contact form to the footer.", source: "email" },
  { text: "Remove the testimonials section from the homepage.", source: "chat" },
  { text: "Actually, keep the testimonials section on the homepage.", source: "email" },
  { text: "Update the Starter plan price to $19 monthly.", source: "email" },
  { text: "The Starter plan should cost $19 per month.", source: "chat" },
  { text: "The homepage hero image is outdated.", source: "document" },
  { text: "Replace the hero image with a product screenshot.", source: "email" },
  { text: "The website takes too long to load.", source: "chat" },
  { text: "Improve the page load speed before launch.", source: "email" },
  { text: "Use a more modern font on the page.", source: "chat" },
  { text: "Make the body font larger for readability.", source: "email" },
  { text: "Can we add customer logos beneath the hero section?", source: "chat" },
  { text: "Need the website ready before launch day.", source: "document" },
  { text: "Nice work, the new footer looks better.", source: "email" },
  { text: "Hide the customer testimonials section on the homepage.", source: "chat" }
];

export const localDemoRouter = express.Router();
localDemoRouter.use((req: Request, _res: Response, next: NextFunction) => {
  if (["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) state.activated = true;
  next();
});

localDemoRouter.get("/projects", (_req, res) => {
  const projects = [...state.projects].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).map((project) => ({ ...project, counts: projectCounts(project._id) }));
  res.json({ projects, storage: "memory-demo" });
});

localDemoRouter.post("/projects", (req, res) => {
  const name = text(req.body?.name);
  if (name.length < 2 || name.length > 120) throw new HttpError(400, "Project name must be between 2 and 120 characters.");
  const websiteUrl = text(req.body?.websiteUrl);
  if (websiteUrl && !/^https?:\/\//i.test(websiteUrl)) throw new HttpError(400, "Website URL must start with http:// or https://.");
  const project = makeProject({ name, clientName: text(req.body?.clientName, "Client"), websiteUrl });
  state.projects.push(project);
  res.status(201).json({ project });
});

localDemoRouter.get("/projects/:projectId", asyncHandler(async (req, res) => {
  const project = await ensureProjectFromRequest(req);
  res.json({ project, counts: projectCounts(project._id), storage: "memory-demo" });
}));

localDemoRouter.patch("/projects/:projectId", asyncHandler(async (req, res) => {
  const project = await ensureProjectFromRequest(req);
  const oldUrl = project.websiteUrl || "";
  if (req.body?.name !== undefined) {
    const name = text(req.body.name);
    if (name.length < 2 || name.length > 120) throw new HttpError(400, "Project name must be between 2 and 120 characters.");
    project.name = name;
  }
  if (req.body?.clientName !== undefined) project.clientName = text(req.body.clientName, "Client").slice(0, 120);
  if (req.body?.websiteUrl !== undefined) {
    const url = text(req.body.websiteUrl);
    if (url && !/^https?:\/\//i.test(url)) throw new HttpError(400, "Website URL must start with http:// or https://.");
    project.websiteUrl = url;
    if (oldUrl.replace(/\/$/, "") !== url.replace(/\/$/, "")) delete project.websiteContext;
  }
  project.updatedAt = now();
  res.json({ project });
}));

localDemoRouter.post("/projects/:projectId/comments", asyncHandler(async (req, res) => {
  const project = await ensureProjectFromRequest(req);
  const raw = text(req.body?.text);
  if (!raw || raw.length > 100_000) throw new HttpError(400, "Paste feedback (up to 100,000 characters) first.");
  const source: Source = ["chat", "email", "document", "screenshot"].includes(req.body?.source) ? req.body.source : "chat";
  const parts = splitFeedback(raw);
  if (parts.length > 60) throw new HttpError(400, "Import up to 60 comments at a time.");
  const comments = projectComments(project._id);
  const existing = new Set(comments.map((c) => normalizeFeedback(c.rawText)));
  let sequence = comments.reduce((n, c) => Math.max(n, Number(c.sequence || 0)), 0);
  let imported = 0, skipped = 0;
  for (const part of parts) {
    const normalized = normalizeFeedback(part);
    if (!normalized || existing.has(normalized)) { skipped++; continue; }
    existing.add(normalized);
    state.comments.push(makeComment(project._id, part, source, ++sequence)); imported++;
  }
  project.updatedAt = now();
  res.status(201).json({ imported, skipped, comments: projectComments(project._id), storage: "memory-demo" });
}));

localDemoRouter.get("/projects/:projectId/comments", asyncHandler(async (req, res) => {
  const project = await ensureProjectFromRequest(req);
  res.json({ comments: projectComments(project._id) });
}));

localDemoRouter.post("/projects/:projectId/sources/search", asyncHandler(async (req, res) => {
  const project = await ensureProjectFromRequest(req);
  const query = text(req.body?.query) || `${project.clientName} customer reviews feedback`;
  const results = await searchFeedbackSources(query, text(req.body?.location, "IN"), text(req.body?.language, "en"));
  res.json({ query, results, provider: "tinyfish-search", count: results.length, storage: "memory-demo" });
}));

localDemoRouter.post("/projects/:projectId/sources/import", asyncHandler(async (req, res) => {
  const project = await ensureProjectFromRequest(req);
  const url = text(req.body?.url);
  if (!url || !/^https?:\/\//i.test(url)) throw new HttpError(400, "Choose a valid public feedback source URL.");
  const fetched = await fetchWebsiteContext(url);
  const normalized = await extractWebFeedbackItems({ title: fetched.title, url, text: fetched.text });
  if (!normalized.items.length) throw new HttpError(422, "TinyFish fetched the page, but no distinct feedback excerpts were found. Try a direct reviews page.");
  const comments = projectComments(project._id);
  const existing = new Set(comments.map((c) => normalizeFeedback(c.rawText)));
  let sequence = comments.reduce((n, c) => Math.max(n, Number(c.sequence || 0)), 0);
  let imported = 0, skipped = 0;
  for (const item of normalized.items) {
    const key = normalizeFeedback(item.text);
    if (!key || existing.has(key)) { skipped++; continue; }
    existing.add(key);
    const comment = makeComment(project._id, item.text, "web", ++sequence, {
      sourceUrl: url, sourceTitle: fetched.title, sourceAuthor: item.author, sourceRating: item.rating, sourceContext: item.context
    });
    comment.receivedAt = fetched.fetchedAt;
    state.comments.push(comment); imported++;
  }
  project.updatedAt = now();
  res.status(201).json({ sourceUrl: url, finalUrl: fetched.finalUrl, sourceTitle: fetched.title, itemsFound: normalized.items.length, imported, skipped, mode: normalized.mode, warning: normalized.warning || null, comments: projectComments(project._id), storage: "memory-demo" });
}));

localDemoRouter.post("/projects/:projectId/website-context", asyncHandler(async (req, res) => {
  const project = await ensureProjectFromRequest(req);
  const url = text(req.body?.url, project.websiteUrl || "");
  if (!url) throw new HttpError(400, "Add a website URL to this project first.");
  const fetched = await fetchWebsiteContext(url);
  project.websiteUrl = fetched.url;
  project.websiteContext = { ...fetched, source: "tinyfish" };
  project.updatedAt = now();
  res.json({ context: project.websiteContext, project });
}));

localDemoRouter.post("/projects/:projectId/screenshots", (_req, res) => {
  res.status(503).json({ error: "Screenshot extraction needs a live OpenAI API key. Add OPENAI_API_KEY and use the MongoDB-backed server, or paste the screenshot text for the local demo." });
});

localDemoRouter.post("/projects/:projectId/analyze", asyncHandler(async (req, res) => {
  const project = await ensureProjectFromRequest(req);
  let comments = projectComments(project._id);
  if (!comments.length) throw new HttpError(400, "Import feedback before running analysis.");
  if (comments.length > 60) throw new HttpError(400, "Analyze up to 60 comments at a time.");

  // Stage 1: fetch live site context when configured; a failed fetch is a warning, not a blocker.
  let tinyfishWarning: string | null = null;
  let tinyfishStatus: string = "not_applicable";
  const websiteUrl = text(project.websiteUrl);
  const cached = project.websiteContext;
  if (websiteUrl && process.env.TINYFISH_API_KEY?.trim()) {
    const fresh = cached?.source === "tinyfish" && cached?.text && String(cached.url).replace(/\/$/, "") === websiteUrl.replace(/\/$/, "") && (Date.now() - new Date(cached.fetchedAt).getTime() < 15 * 60 * 1000);
    if (fresh) tinyfishStatus = "reused";
    else {
      try {
        project.websiteContext = { ...await fetchWebsiteContext(websiteUrl), source: "tinyfish" };
        project.updatedAt = now();
        tinyfishStatus = "refreshed";
      } catch (error) {
        tinyfishWarning = error instanceof Error ? `TinyFish could not refresh the website; analysis continued without blocking. ${error.message}` : "TinyFish could not refresh website context.";
        tinyfishStatus = cached?.text ? "reused" : "unavailable";
      }
    }
  } else if (websiteUrl && !process.env.TINYFISH_API_KEY?.trim()) {
    tinyfishWarning = "TINYFISH_API_KEY is not configured; analysis continued without live website context.";
    tinyfishStatus = cached?.source === "demo" ? "demo" : "not_configured";
  } else if (cached?.source === "demo") tinyfishStatus = "demo";

  // Stage 2: request extraction/classification.
  const pending = comments.filter((comment) => comment.type === "unanalyzed");
  const extraction = pending.length ? await analyzeComments(pending as any, String(project.websiteContext?.text || "")) : { results: [], mode: process.env.OPENAI_API_KEY ? "openai" as const : "demo-fallback" as const };
  const results = new Map(extraction.results.map((item) => [item.commentId, item]));
  for (const comment of pending) {
    const result = results.get(comment._id);
    if (result) Object.assign(comment, result, { updatedAt: now() });
  }
  comments = projectComments(project._id);

  // Stage 3: duplicate candidate generation.
  const existingPairKeys = new Set(projectConflicts(project._id).map((c) => pairKey(c.commentIds)));
  const duplicateCandidates = await findDuplicateGroups(comments as any, existingPairKeys);

  // Stage 4: identify contradictions/change-of-mind and persist new conflict records.
  const detected = await findConflicts(comments as any);
  const newConflictKeys = new Set<string>();
  for (const item of detected) {
    const key = pairKey(item.commentIds);
    if (existingPairKeys.has(key) || newConflictKeys.has(key)) continue;
    const date = now();
    state.conflicts.push({ _id: newId(), projectId: project._id, commentIds: item.commentIds, explanation: item.explanation, kind: item.kind, status: "open", resolution: "", resolvedAt: null, createdAt: date, updatedAt: date });
    newConflictKeys.add(key);
  }
  const allConflictKeys = new Set([...existingPairKeys, ...newConflictKeys]);
  const safeCandidates = duplicateCandidates.filter((candidate) => {
    for (let i = 0; i < candidate.commentIds.length; i++) for (let j = i + 1; j < candidate.commentIds.length; j++) if (allConflictKeys.has(pairKey([candidate.commentIds[i], candidate.commentIds[j]]))) return false;
    return true;
  });

  // Stage 5: persist reviewable duplicate groups and create standalone actionable tasks.
  const assignedToGroup = new Set<string>();
  let groupsCreated = 0;
  for (const candidate of safeCandidates) {
    const ids = candidate.commentIds;
    if (ids.length < 2 || ids.some((id) => assignedToGroup.has(id))) continue;
    const selected = comments.filter((comment) => ids.includes(comment._id));
    if (selected.length !== ids.length || selected.some((comment) => comment.taskId || comment.groupId)) continue;
    const date = now();
    const group: GroupRecord = { _id: newId(), projectId: project._id, commentIds: ids, reason: candidate.reason, status: "proposed", taskId: null, createdAt: date, updatedAt: date };
    state.groups.push(group);
    selected.forEach((comment) => { comment.groupId = group._id; comment.updatedAt = date; assignedToGroup.add(comment._id); });
    groupsCreated++;
  }
  comments = projectComments(project._id);
  let tasksCreated = 0;
  for (const comment of comments.filter((item) => item.type === "actionable" && !item.taskId && !item.groupId)) if (createTask(project._id, [comment])) tasksCreated++;

  // Stage 6: ensure open conflicts are linked to affected tasks before review.
  updateTaskConflictLinks(project._id);
  project.updatedAt = now();
  res.json({
    mode: extraction.mode, warning: extraction.warning || null, tinyfishWarning, tinyfishStatus,
    websiteContextUsed: Boolean(project.websiteContext?.text), analyzed: pending.length, groupsCreated, tasksCreated,
    comments: projectComments(project._id), groups: sortNewest(projectGroups(project._id).filter((g) => g.status === "proposed")).map(populatedGroup),
    conflicts: sortNewest(projectConflicts(project._id)).map(populatedConflict), tasks: sortNewest(projectTasks(project._id)).map(populatedTask), storage: "memory-demo"
  });
}));

localDemoRouter.get("/projects/:projectId/groups", asyncHandler(async (req, res) => {
  const project = await ensureProjectFromRequest(req);
  res.json({ groups: sortNewest(projectGroups(project._id)).map(populatedGroup) });
}));

localDemoRouter.post("/projects/:projectId/groups/:groupId/decision", asyncHandler(async (req, res) => {
  const project = await ensureProjectFromRequest(req);
  const group = projectGroups(project._id).find((g) => g._id === req.params.groupId && g.status === "proposed");
  if (!group) throw new HttpError(404, "Proposed group not found or already decided.");
  const action = req.body?.action;
  if (action !== "merge" && action !== "keep_separate") throw new HttpError(400, "Choose merge or keep separate.");
  const comments = projectComments(project._id).filter((comment) => group.commentIds.includes(comment._id));
  let task: TaskRecord | null = null;
  if (action === "merge") {
    const title = comments.find((comment) => comment.type === "actionable")?.normalizedRequest || "Consolidated revision request";
    task = createTask(project._id, comments, title);
    group.status = "merged"; group.taskId = task?._id || null;
  } else {
    group.status = "rejected";
    for (const comment of comments) comment.groupId = null;
    for (const comment of comments) if (comment.type === "actionable" && !comment.taskId) { const created = createTask(project._id, [comment]); if (!task) task = created; }
  }
  group.updatedAt = now(); updateTaskConflictLinks(project._id);
  res.json({ group: populatedGroup(group), task: task ? populatedTask(task) : null });
}));

localDemoRouter.get("/projects/:projectId/conflicts", asyncHandler(async (req, res) => {
  const project = await ensureProjectFromRequest(req);
  res.json({ conflicts: sortNewest(projectConflicts(project._id)).map(populatedConflict) });
}));

localDemoRouter.patch("/conflicts/:conflictId/resolve", (req, res) => {
  const conflict = byId(state.conflicts, req.params.conflictId);
  if (!conflict) throw new HttpError(404, "Conflict not found.");
  const action = req.body?.action;
  if (!["follow_a", "follow_b", "ask_client"].includes(action)) throw new HttpError(400, "Choose Follow A, Follow B, or Ask client.");
  conflict.resolution = action;
  if (action === "ask_client") { conflict.status = "open"; conflict.resolvedAt = null; }
  else { conflict.status = "resolved"; conflict.resolvedAt = now(); }
  conflict.updatedAt = now(); updateTaskConflictLinks(conflict.projectId);
  res.json({ conflict: populatedConflict(conflict) });
});

localDemoRouter.get("/projects/:projectId/tasks", asyncHandler(async (req, res) => {
  const project = await ensureProjectFromRequest(req);
  res.json({ tasks: sortNewest(projectTasks(project._id)).map(populatedTask) });
}));

localDemoRouter.patch("/tasks/:taskId/status", (req, res) => {
  const task = byId(state.tasks, req.params.taskId);
  if (!task) throw new HttpError(404, "Task not found.");
  const status = req.body?.status as TaskStatus;
  if (!["todo", "in_progress", "in_review", "approved"].includes(status)) throw new HttpError(400, "Invalid task status.");
  if (status === "approved") throw new HttpError(400, "Use the approval action endpoint to record approval history.");
  if (status === "in_review" && state.conflicts.some((conflict) => conflict.projectId === task.projectId && conflict.status === "open" && conflict.commentIds.some((id: string) => task.sourceCommentIds.includes(id)))) {
    throw new HttpError(409, "Resolve open conflicts before moving this task to In Review.");
  }
  task.status = status; task.updatedAt = now();
  res.json({ task: populatedTask(task) });
});

localDemoRouter.post("/tasks/:taskId/approval", (req, res) => {
  const task = byId(state.tasks, req.params.taskId);
  if (!task) throw new HttpError(404, "Task not found.");
  if (task.status !== "in_review") throw new HttpError(400, "A decision can only be recorded while a task is In Review.");
  if (state.conflicts.some((conflict) => conflict.projectId === task.projectId && conflict.status === "open" && conflict.commentIds.some((id: string) => task.sourceCommentIds.includes(id)))) {
    throw new HttpError(409, "Resolve open conflicts before recording approval.");
  }
  const decision = req.body?.decision;
  if (decision !== "approved" && decision !== "changes_requested") throw new HttpError(400, "Invalid approval decision.");
  const note = text(req.body?.note).slice(0, 2000);
  task.status = decision === "approved" ? "approved" : "in_progress"; task.updatedAt = now();
  const event: ApprovalRecord = { _id: newId(), taskId: task._id, decision, note, createdAt: now(), updatedAt: now() };
  state.approvals.push(event);
  res.status(201).json({ task: populatedTask(task), event });
});

localDemoRouter.get("/tasks/:taskId/history", (req, res) => {
  if (!byId(state.tasks, req.params.taskId)) throw new HttpError(404, "Task not found.");
  res.json({ history: sortNewest(state.approvals.filter((event) => event.taskId === req.params.taskId)) });
});

localDemoRouter.post("/demo/seed", (req, res) => {
  if (process.env.ENABLE_DEMO_SEED === "false") throw new HttpError(403, "Demo data is disabled on this deployment.");
  const existing = state.projects.find((project) => project.isDemo === true);
  if (existing) { res.status(200).json({ project: existing, message: "The in-memory demo project is already loaded." }); return; }
  const project = makeProject({ name: "Website Redesign", clientName: "Northstar Studio", websiteUrl: "https://example.com" }, true);
  project.websiteContext = {
    url: "https://example.com", finalUrl: "https://example.com", title: "Northstar Studio — Demo Website",
    description: "Sample website context for a local prototype run; it was not fetched from TinyFish.",
    text: "DEMO CONTEXT (not live TinyFish data): A marketing site with header/navigation, logo, hero image, pricing page with a Starter plan, green/blue buttons, testimonials, footer contact form, customer logos, typography and page-speed concerns.",
    source: "demo", fetchedAt: now()
  };
  state.projects.push(project);
  DEMO_COMMENTS.forEach((item, index) => state.comments.push(makeComment(project._id, item.text, item.source, index + 1)));
  res.status(201).json({ project, message: "Demo project loaded into temporary in-memory storage. Analyze the 25 sample comments to see the complete workflow." });
});

// Unknown routes continue to the regular MongoDB gate / 404 handler.
