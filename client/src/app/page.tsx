"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  Activity, AlertCircle, AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, BookOpen,
  Check, CheckCheck, CheckCircle2, ChevronDown, CircleHelp, ClipboardCheck, Clock3, Code2,
  ExternalLink, FileText, Filter, Globe2, GitMerge, History, Inbox, Layers3, LayoutDashboard,
  LoaderCircle, Menu, MessageSquareText, Plus, RefreshCw, Search, ShieldCheck, Sparkles,
  Target, TrendingUp, Users, WandSparkles, X, Zap, Moon, Sun
} from "lucide-react";
import { api } from "@/lib/api";

type View = "overview" | "inbox" | "tasks" | "groups" | "conflicts" | "approvals";
type Theme = "dark" | "light";
type Notice = { message: string; tone: "success" | "error" | "info" } | null;
type Source = "chat" | "email" | "document" | "screenshot" | "web";
type Project = {
  _id: string; name: string; clientName: string; websiteUrl?: string; createdAt?: string;
  websiteContext?: { url: string; finalUrl?: string; title: string; description: string; text: string; source: "tinyfish" | "demo"; fetchedAt: string };
  counts?: { comments: number; tasks: number; openConflicts: number; proposedGroups: number };
};
type Comment = {
  _id: string; projectId: string; rawText: string; source: Source; sourceUrl?: string; sourceTitle?: string; sourceAuthor?: string; sourceRating?: string; sourceContext?: string; sequence: number; type: "unanalyzed" | "actionable" | "question" | "opinion";
  normalizedRequest: string; priority: "low" | "medium" | "high"; needsClarification: boolean; clarificationNote: string; groupId?: string | { _id: string }; taskId?: string | { _id: string };
};
type Conflict = { _id: string; projectId: string; commentIds: Array<Comment | string>; explanation: string; kind: "contradiction" | "change_of_mind"; status: "open" | "resolved"; resolution?: string; createdAt?: string };
type Group = { _id: string; projectId: string; commentIds: Array<Comment | string>; reason: string; status: "proposed" | "merged" | "rejected"; taskId?: string | { _id: string } };
type Task = { _id: string; projectId: string; title: string; description: string; priority: "low" | "medium" | "high"; status: "todo" | "in_progress" | "in_review" | "approved"; sourceCommentIds: Array<Comment | string>; needsClarification: boolean; clarificationNote: string; conflictIds: Array<Conflict | string>; createdAt?: string; updatedAt?: string };
type ApprovalEvent = { _id: string; taskId: string; decision: "approved" | "changes_requested"; note: string; createdAt: string };
type ApiStatus = { openaiConfigured: boolean; tinyfishConfigured: boolean; databaseConnected: boolean; demoSeedEnabled: boolean };
type SourceSearchResult = { position: number; siteName: string; title: string; snippet: string; url: string; domain: string };

const VIEWS: Array<{ id: View; label: string; icon: typeof LayoutDashboard }> = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "inbox", label: "Feedback inbox", icon: Inbox },
  { id: "tasks", label: "Revision queue", icon: Layers3 },
  { id: "groups", label: "Duplicate suggestions", icon: GitMerge },
  { id: "conflicts", label: "Conflicts & decisions", icon: AlertTriangle },
  { id: "approvals", label: "Approval history", icon: ClipboardCheck },
];
const STATUSES = [
  { id: "todo", label: "To do", color: "pill-gray" },
  { id: "in_progress", label: "In progress", color: "pill-blue" },
  { id: "in_review", label: "In review", color: "pill-amber" },
  { id: "approved", label: "Approved", color: "pill-green" },
] as const;

function idOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "_id" in value) return String((value as { _id: unknown })._id);
  return "";
}
function asComment(value: Comment | string): Comment | null { return typeof value === "object" && value !== null ? value : null; }
function dateLabel(value?: string) { if (!value) return "Just now"; const d = new Date(value); return Number.isNaN(d.getTime()) ? "Recently" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
function statusLabel(status: Task["status"]) { return STATUSES.find((s) => s.id === status)?.label || status; }
function sourceName(source: Source) { return ({ chat: "Chat", email: "Email", document: "Document", screenshot: "Screenshot", web: "Web review" })[source]; }

export default function HomePage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState("");
  const [project, setProject] = useState<Project | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [history, setHistory] = useState<ApprovalEvent[]>([]);
  const [apiStatus, setApiStatus] = useState<ApiStatus | null>(null);
  const [theme, setTheme] = useState<Theme>("dark");
  const [themeReady, setThemeReady] = useState(false);
  const [activeView, setActiveView] = useState<View>("overview");
  const [startupLoading, setStartupLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("Website Redesign");
  const [newClientName, setNewClientName] = useState("Acme Studio");
  const [newWebsiteUrl, setNewWebsiteUrl] = useState("");
  const [importText, setImportText] = useState("");
  const [importSource, setImportSource] = useState<Source>("chat");
  const [commentSearch, setCommentSearch] = useState("");
  const [commentFilter, setCommentFilter] = useState("all");
  const [showWebsiteContent, setShowWebsiteContent] = useState(false);
  const [screenshotFile, setScreenshotFile] = useState<File | null>(null);
  const [sourceQuery, setSourceQuery] = useState("");
  const [sourceResults, setSourceResults] = useState<SourceSearchResult[]>([]);
  const screenshotInputRef = useRef<HTMLInputElement>(null);

  const notify = useCallback((message: string, tone: "success" | "error" | "info" = "success") => {
    setNotice({ message, tone });
    window.setTimeout(() => setNotice((current) => current?.message === message ? null : current), 4800);
  }, []);

  const loadProjects = useCallback(async () => {
    const result = await api<{ projects: Project[] }>("/api/projects");
    setProjects(result.projects);
    return result.projects;
  }, []);

  const loadProjectData = useCallback(async (projectId: string, quiet = false) => {
    if (!projectId) return;
    if (!quiet) setDataLoading(true);
    try {
      const [projectResult, commentResult, groupResult, conflictResult, taskResult] = await Promise.all([
        api<{ project: Project }>(`/api/projects/${projectId}`),
        api<{ comments: Comment[] }>(`/api/projects/${projectId}/comments`),
        api<{ groups: Group[] }>(`/api/projects/${projectId}/groups`),
        api<{ conflicts: Conflict[] }>(`/api/projects/${projectId}/conflicts`),
        api<{ tasks: Task[] }>(`/api/projects/${projectId}/tasks`),
      ]);
      setProject(projectResult.project);
      setComments(commentResult.comments);
      setGroups(groupResult.groups);
      setConflicts(conflictResult.conflicts);
      setTasks(taskResult.tasks);
      const historyLists = await Promise.all(taskResult.tasks.map(async (task) => {
        try { return (await api<{ history: ApprovalEvent[] }>(`/api/tasks/${task._id}/history`)).history; } catch { return []; }
      }));
      setHistory(historyLists.flat().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
    } finally {
      if (!quiet) setDataLoading(false);
    }
  }, []);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("feedbackflow-theme");
    if (savedTheme === "light" || savedTheme === "dark") setTheme(savedTheme);
    setThemeReady(true);
  }, []);

  useEffect(() => {
    if (!themeReady) return;
    window.localStorage.setItem("feedbackflow-theme", theme);
    document.documentElement.style.colorScheme = theme;
  }, [theme, themeReady]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [status, result] = await Promise.all([
          api<ApiStatus>("/api/status"), api<{ projects: Project[] }>("/api/projects")
        ]);
        if (cancelled) return;
        setApiStatus(status); setProjects(result.projects);
        if (result.projects.length) setActiveProjectId(result.projects[0]._id);
      } catch (error) {
        if (!cancelled) notify(error instanceof Error ? error.message : "Could not connect to FeedbackFlow API.", "error");
      } finally { if (!cancelled) setStartupLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [notify]);

  useEffect(() => {
    setSourceResults([]);
    setSourceQuery("");
  }, [activeProjectId]);

  useEffect(() => {
    if (!activeProjectId) { setProject(null); return; }
    let cancelled = false;
    loadProjectData(activeProjectId).catch((error) => { if (!cancelled) notify(error instanceof Error ? error.message : "Could not load project.", "error"); }).finally(() => { if (!cancelled) setDataLoading(false); });
    return () => { cancelled = true; };
  }, [activeProjectId, reloadTick, loadProjectData, notify]);

  const refresh = useCallback(async () => {
    await loadProjects();
    if (activeProjectId) await loadProjectData(activeProjectId, true);
  }, [activeProjectId, loadProjects, loadProjectData]);

  const currentProjectInList = projects.find((p) => p._id === activeProjectId);
  const proposedGroups = groups.filter((g) => g.status === "proposed");
  const openConflicts = conflicts.filter((c) => c.status === "open");
  const actionableComments = comments.filter((c) => c.type === "actionable");
  const questions = comments.filter((c) => c.type === "question").length;
  const opinions = comments.filter((c) => c.type === "opinion").length;
  const unclearTasks = tasks.filter((t) => t.needsClarification).length;
  const filteredComments = useMemo(() => comments.filter((c) => {
    const q = commentSearch.trim().toLowerCase();
    const matchesQuery = !q || c.rawText.toLowerCase().includes(q) || c.normalizedRequest.toLowerCase().includes(q);
    const matchesFilter = commentFilter === "all" || (commentFilter === "needs_clarification" ? c.needsClarification : c.type === commentFilter);
    return matchesQuery && matchesFilter;
  }), [comments, commentSearch, commentFilter]);

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setActionLoading("create-project");
    try {
      const result = await api<{ project: Project }>("/api/projects", { method: "POST", body: JSON.stringify({ name: newProjectName, clientName: newClientName, websiteUrl: newWebsiteUrl }) });
      await loadProjects(); setActiveProjectId(result.project._id); setActiveView("overview"); setNewProjectOpen(false);
      notify("Project created. Import client feedback to get started.");
    } catch (error) { notify(error instanceof Error ? error.message : "Project creation failed.", "error"); }
    finally { setActionLoading(""); }
  }

  async function loadDemo() {
    setActionLoading("demo");
    try {
      const result = await api<{ project: Project; message: string }>("/api/demo/seed", { method: "POST", body: JSON.stringify({}) });
      await loadProjects(); setActiveProjectId(result.project._id); setActiveView("overview");
      notify("Demo project added with 25 realistic feedback comments.");
    } catch (error) { notify(error instanceof Error ? error.message : "Could not load demo data.", "error"); }
    finally { setActionLoading(""); }
  }

  async function importFeedback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!activeProjectId || !importText.trim()) return;
    setActionLoading("import");
    try {
      const result = await api<{ imported: number; skipped: number }>(`/api/projects/${activeProjectId}/comments`, { method: "POST", body: JSON.stringify({ text: importText, source: importSource }) });
      setImportText(""); await refresh(); setActiveView("inbox");
      notify(`${result.imported} comments imported${result.skipped ? ` · ${result.skipped} duplicate${result.skipped === 1 ? "" : "s"} skipped` : ""}.`);
    } catch (error) { notify(error instanceof Error ? error.message : "Could not import feedback.", "error"); }
    finally { setActionLoading(""); }
  }

  async function uploadScreenshot() {
    if (!activeProjectId || !screenshotFile) return;
    setActionLoading("screenshot");
    try {
      const form = new FormData(); form.append("image", screenshotFile);
      const result = await api<{ extractedText: string }>(`/api/projects/${activeProjectId}/screenshots`, { method: "POST", body: form });
      setScreenshotFile(null); if (screenshotInputRef.current) screenshotInputRef.current.value = "";
      await refresh();
      notify("Screenshot feedback extracted and added to the inbox. Run analysis to classify it.");
    } catch (error) { notify(error instanceof Error ? error.message : "Could not extract screenshot feedback.", "error"); }
    finally { setActionLoading(""); }
  }

  async function saveWebsiteUrl(url: string) {
    if (!activeProjectId) return;
    setActionLoading("save-url");
    try {
      const result = await api<{ project: Project }>(`/api/projects/${activeProjectId}`, { method: "PATCH", body: JSON.stringify({ websiteUrl: url.trim() }) });
      setProject(result.project); await loadProjects(); notify("Project website URL saved.");
    } catch (error) { notify(error instanceof Error ? error.message : "Could not save website URL.", "error"); }
    finally { setActionLoading(""); }
  }

  async function analyzeFeedback() {
    if (!activeProjectId) return;
    setActionLoading("analyze");
    try {
      const result = await api<{ mode: "openai" | "demo-fallback"; warning?: string | null; tinyfishWarning?: string | null; tinyfishStatus?: "refreshed" | "reused" | "demo" | "unavailable" | "not_configured" | "not_applicable"; websiteContextUsed?: boolean; analyzed: number; groupsCreated: number; tasksCreated: number }>(`/api/projects/${activeProjectId}/analyze`, { method: "POST", body: JSON.stringify({}) });
      await refresh();
      const summary = `Analysis complete: ${result.analyzed} comments analyzed, ${result.groupsCreated} duplicate group(s) suggested, ${result.tasksCreated} task(s) created${result.mode === "demo-fallback" ? " with demo rules" : " with OpenAI"}.`;
      const tinyfishNote = result.tinyfishStatus === "refreshed" ? "TinyFish fetched fresh website context for this analysis."
        : result.tinyfishStatus === "reused" ? "Recent TinyFish website context was reused."
        : result.tinyfishStatus === "demo" ? "Demo website context was used; this is not live TinyFish data."
        : result.tinyfishStatus === "not_configured" ? "Live TinyFish is not configured on the backend."
        : result.tinyfishStatus === "unavailable" ? "No live website context was available."
        : result.tinyfishStatus === "not_applicable" ? "No website URL is configured for this project."
        : "";
      const notices = [summary, tinyfishNote, result.warning || "", result.tinyfishWarning || ""].filter(Boolean);
      notify(notices.join(" "), result.warning || result.tinyfishWarning ? "info" : "success");
      setActiveView("inbox");
    } catch (error) { notify(error instanceof Error ? error.message : "Analysis failed.", "error"); }
    finally { setActionLoading(""); }
  }

  async function fetchWebsite() {
    if (!activeProjectId) return;
    setActionLoading("website");
    try {
      const result = await api<{ context: Project["websiteContext"] }>(`/api/projects/${activeProjectId}/website-context`, { method: "POST", body: JSON.stringify({ url: project?.websiteUrl || "" }) });
      await refresh(); setShowWebsiteContent(true);
      notify(`TinyFish fetched ${result.context?.title || "website context"}. It can now ground feedback analysis.`);
    } catch (error) { notify(error instanceof Error ? error.message : "Website fetch failed.", "error"); }
    finally { setActionLoading(""); }
  }

  async function searchWebSources(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!activeProjectId) return;
    const query = sourceQuery.trim() || `${project?.clientName || "client"} customer reviews feedback`;
    setActionLoading("source-search");
    setSourceResults([]);
    try {
      const result = await api<{ query: string; results: SourceSearchResult[]; count: number }>(`/api/projects/${activeProjectId}/sources/search`, {
        method: "POST", body: JSON.stringify({ query, location: "IN", language: "en" })
      });
      setSourceResults(result.results);
      notify(result.results.length ? `TinyFish found ${result.results.length} public source(s). Choose a page to extract feedback from.` : "TinyFish Search returned no suitable public sources. Try a more specific query.", result.results.length ? "success" : "info");
    } catch (error) { notify(error instanceof Error ? error.message : "Could not find public feedback sources.", "error"); }
    finally { setActionLoading(""); }
  }

  async function importWebSource(source: SourceSearchResult) {
    if (!activeProjectId) return;
    setActionLoading(`source-import:${source.url}`);
    try {
      const result = await api<{ sourceTitle: string; imported: number; skipped: number; itemsFound: number; mode: "openai" | "heuristic"; warning?: string | null }>(`/api/projects/${activeProjectId}/sources/import`, {
        method: "POST", body: JSON.stringify({ url: source.url })
      });
      await refresh();
      const msg = `${result.sourceTitle || source.title}: imported ${result.imported} feedback item(s), skipped ${result.skipped} duplicate(s). Source URLs are preserved.`;
      notify([msg, result.warning || ""].filter(Boolean).join(" "), result.warning ? "info" : "success");
    } catch (error) { notify(error instanceof Error ? error.message : "Could not extract feedback from this source.", "error"); }
    finally { setActionLoading(""); }
  }

  async function decideGroup(groupId: string, action: "merge" | "keep_separate") {
    setActionLoading(`group-${groupId}`);
    try {
      await api(`/api/projects/${activeProjectId}/groups/${groupId}/decision`, { method: "POST", body: JSON.stringify({ action }) });
      await refresh(); notify(action === "merge" ? "Duplicate comments merged into one task." : "Group rejected. Separate tasks created where appropriate.");
    } catch (error) { notify(error instanceof Error ? error.message : "Could not update group.", "error"); }
    finally { setActionLoading(""); }
  }

  async function resolveConflict(conflictId: string, action: "follow_a" | "follow_b" | "ask_client") {
    setActionLoading(`conflict-${conflictId}`);
    try {
      await api(`/api/conflicts/${conflictId}/resolve`, { method: "PATCH", body: JSON.stringify({ action }) });
      await refresh(); notify(action === "ask_client" ? "Conflict marked for client clarification; it remains open until a decision is recorded." : "Conflict resolution saved.");
    } catch (error) { notify(error instanceof Error ? error.message : "Could not resolve conflict.", "error"); }
    finally { setActionLoading(""); }
  }

  async function changeTaskStatus(task: Task, status: Task["status"]) {
    setActionLoading(`task-${task._id}`);
    try {
      if (status === "approved") {
        if (task.status !== "in_review") throw new Error("Move the task to In Review before recording approval.");
        await api(`/api/tasks/${task._id}/approval`, { method: "POST", body: JSON.stringify({ decision: "approved", note: "Approved in FeedbackFlow." }) });
      } else {
        await api(`/api/tasks/${task._id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
      }
      await refresh(); notify(`Task moved to ${statusLabel(status)}.`);
    } catch (error) { notify(error instanceof Error ? error.message : "Could not update task.", "error"); }
    finally { setActionLoading(""); }
  }

  async function requestChanges(task: Task) {
    const note = window.prompt("What needs to change? This note will be recorded in the approval history.", "Please revise the requested details.");
    if (note === null) return;
    setActionLoading(`task-${task._id}`);
    try {
      await api(`/api/tasks/${task._id}/approval`, { method: "POST", body: JSON.stringify({ decision: "changes_requested", note }) });
      await refresh(); notify("Changes requested. Task moved back to In Progress.");
    } catch (error) { notify(error instanceof Error ? error.message : "Could not record feedback.", "error"); }
    finally { setActionLoading(""); }
  }

  const taskGroups = useMemo(() => Object.fromEntries(STATUSES.map((s) => [s.id, tasks.filter((t) => t.status === s.id)])) as Record<Task["status"], Task[]>, [tasks]);

  if (startupLoading) return <div className="empty-project"><div className="empty-project-card"><div className="empty-icon"><LoaderCircle size={26} className="spinner" /></div><h1>Starting FeedbackFlow</h1><p>Connecting to your workspace and loading projects…</p></div></div>;

  return (
    <div className="app-shell" data-theme={theme}>
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><WandSparkles size={21} /></div><div className="brand-text"><div className="brand-name">FeedbackFlow</div><div className="brand-sub">AI revision resolver</div></div></div>
        <div className="side-label">Workspace</div>
        <nav className="nav-list" aria-label="Main navigation">
          {VIEWS.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${activeView === id ? "active" : ""}`} onClick={() => setActiveView(id)}><Icon size={17} strokeWidth={1.8} /><span>{label}</span>{id === "groups" && proposedGroups.length > 0 && <span className="nav-count">{proposedGroups.length}</span>}{id === "conflicts" && openConflicts.length > 0 && <span className="nav-count">{openConflicts.length}</span>}</button>)}
        </nav>
        <div className="sidebar-bottom">
          <div className="side-label">Your projects</div>
          {projects.length ? projects.slice(0, 4).map((p) => <div key={p._id} className={`project-mini ${p._id === activeProjectId ? "active" : ""}`} onClick={() => { setActiveProjectId(p._id); setActiveView("overview"); }} title={p.name}><span className="project-dot" /><span>{p.name}</span></div>) : <div style={{ color: "#7e85a1", fontSize: 11, padding: "8px 12px" }}>No projects yet</div>}
          <button className="nav-item" style={{ marginTop: 7, width: "100%" }} onClick={() => setNewProjectOpen(true)}><Plus size={17} /><span>New project</span></button>
          <div className="side-footer"><div className="avatar">FF</div><div className="side-user"><div className="side-user-name">Project workspace</div><div className="side-user-role">Hackathon edition</div></div></div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="crumb"><span>Workspace</span><ArrowRight size={12} /><strong>{project?.name || "Getting started"}</strong></div>
          <div className="top-actions">
            <button
              className="button button-secondary theme-toggle"
              onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")}
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              aria-pressed={theme === "dark"}
            >
              {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
              <span className="theme-toggle-label">{theme === "dark" ? "Light mode" : "Dark mode"}</span>
            </button>
            <div className="status-indicator" title="Backend connectivity"><span style={{ background: apiStatus?.databaseConnected ? "#26b785" : "#d9a441" }} />{apiStatus?.databaseConnected ? "Connected" : "Checking API"}</div>
            {apiStatus?.openaiConfigured ? <span className="status-pill pill-green"><Sparkles size={11} /> OpenAI enabled</span> : <span className="status-pill pill-amber"><Zap size={11} /> Demo AI</span>}
            <button className="button button-primary" onClick={() => setNewProjectOpen(true)}><Plus size={15} /> New project</button>
          </div>
        </header>

        {!projects.length ? <div className="empty-project"><div className="empty-project-card"><div className="empty-icon"><WandSparkles size={27} /></div><div className="eyebrow" style={{ justifyContent: "center" }}>AI-assisted revision management</div><h1>Good feedback deserves a better workflow.</h1><p>Start a project, import client comments, and turn them into a prioritized and traceable revision queue. You can use the demo data before adding API keys.</p><div className="empty-project-actions"><button className="button button-primary" onClick={() => setNewProjectOpen(true)}><Plus size={15} /> Create a project</button><button className="button button-secondary" disabled={actionLoading === "demo" || apiStatus?.demoSeedEnabled === false} onClick={loadDemo}>{actionLoading === "demo" ? <span className="spinner" /> : <Sparkles size={15} />} Load demo data</button></div><p style={{ fontSize: 10, marginTop: 18, marginBottom: 0 }}>Need live website context? Configure TINYFISH_API_KEY in the backend environment.</p></div></div> : !project ? <div className="empty-project"><div className="empty-project-card"><LoaderCircle className="spinner" size={28} /><h1>Loading project…</h1></div></div> : <div className="page-content">
          <div className="page-heading">
            <div><div className="eyebrow"><Sparkles size={12} /> The AI revision resolver</div><h1>{activeView === "overview" ? "Feedback workspace" : VIEWS.find((v) => v.id === activeView)?.label}</h1><p>{activeView === "overview" ? `A clearer view of client feedback for ${project.clientName || "your client"}.` : viewDescription(activeView)}</p></div>
            <div className="heading-buttons">
              {projects.length > 1 && <select aria-label="Choose project" className="project-selector" value={activeProjectId} onChange={(e) => setActiveProjectId(e.target.value)}>{projects.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}</select>}
              {activeView === "inbox" && <button className="button button-primary" onClick={analyzeFeedback} disabled={!comments.length || actionLoading === "analyze"}>{actionLoading === "analyze" ? <span className="spinner" /> : <Sparkles size={14} />} Analyze feedback</button>}
              {activeView === "tasks" && <button className="button button-secondary" onClick={() => setActiveView("inbox")}><Plus size={14} /> Add feedback</button>}
            </div>
          </div>

          {activeView === "overview" && <>
            <section className="hero-card"><div className="hero-content"><div className="hero-tag"><Sparkles size={12} /> CLIENT FEEDBACK, MADE ACTIONABLE</div><h2>From scattered comments to focused work.</h2><p>Analyze feedback, suggest duplicates, surface conflicting requests, and keep every task connected to its source. Your team approves every important decision.</p></div><div className="hero-actions"><button className="button button-primary" onClick={() => setActiveView("inbox")}><Inbox size={14} /> Open feedback inbox</button><button className="button button-secondary" onClick={analyzeFeedback} disabled={!comments.length || actionLoading === "analyze"}>{actionLoading === "analyze" ? <span className="spinner" /> : <Sparkles size={14} />} Run analysis</button></div></section>
            <section className="stats-grid">
              <StatCard label="Feedback comments" value={comments.length} foot={`${actionableComments.length} actionable · ${questions} questions · ${opinions} opinions`} icon={<MessageSquareText size={17} />} color="icon-purple" />
              <StatCard label="Revision tasks" value={tasks.length} foot={`${tasks.filter((t) => t.status === "approved").length} approved so far`} icon={<CheckCheck size={17} />} color="icon-blue" />
              <StatCard label="Duplicate suggestions" value={proposedGroups.length} foot="Waiting for your confirmation" icon={<GitMerge size={17} />} color="icon-amber" />
              <StatCard label="Open conflicts" value={openConflicts.length} foot={unclearTasks ? `${unclearTasks} task(s) need clarification` : "Keep contradictory requests visible"} icon={<AlertTriangle size={17} />} color="icon-green" />
            </section>
            <div className="section-grid">
              <section className="panel"><div className="panel-header"><div><h3 className="panel-title">Latest revision tasks</h3><div className="panel-subtitle">Actionable requests created from client feedback</div></div><button className="link-button" onClick={() => setActiveView("tasks")}>View revision queue <ArrowRight size={12} style={{ verticalAlign: "middle", marginLeft: 3 }} /></button></div><div className="panel-body">{tasks.length ? tasks.slice(0, 5).map((task) => <TaskSummary key={task._id} task={task} onOpen={() => setActiveView("tasks")} />) : <EmptyInline icon={<Layers3 size={19} />} title="No revision tasks yet" detail="Import client comments and run analysis to generate actionable tasks." action={<button className="button button-secondary button-small" onClick={() => setActiveView("inbox")}>Import feedback <ArrowRight size={12} /></button>} />}</div></section>
              <div style={{ display: "grid", gap: 17 }}>
                <WebsiteContextCard project={project} actionLoading={actionLoading} showContent={showWebsiteContent} onToggle={() => setShowWebsiteContent((v) => !v)} onFetch={fetchWebsite} onSaveUrl={saveWebsiteUrl} tinyfishEnabled={Boolean(apiStatus?.tinyfishConfigured)} />
                <section className="panel"><div className="panel-header"><div><h3 className="panel-title">Needs attention</h3><div className="panel-subtitle">Items that may block implementation</div></div><AlertCircle size={17} color="#c18a24" /></div><div className="panel-body">{openConflicts.length ? <button className="list-item" style={{ width: "100%", textAlign: "left", border: 0, background: "transparent" }} onClick={() => setActiveView("conflicts")}><div className="list-icon" style={{ background: "var(--red-soft)", color: "var(--red)" }}><AlertTriangle size={15} /></div><div className="list-copy"><div className="list-name">{openConflicts.length} unresolved conflict{openConflicts.length === 1 ? "" : "s"}</div><div className="list-detail">Resolve contradictory instructions before review.</div></div><ArrowRight size={14} color="#9aa4b3" /></button> : <div className="list-item"><div className="list-icon" style={{ background: "var(--green-soft)", color: "var(--green)" }}><CheckCircle2 size={15} /></div><div className="list-copy"><div className="list-name">No open conflicts</div><div className="list-detail">Any detected conflicts will appear here.</div></div></div>}{proposedGroups.length > 0 && <button className="list-item" style={{ width: "100%", textAlign: "left", border: 0, background: "transparent" }} onClick={() => setActiveView("groups")}><div className="list-icon" style={{ background: "var(--purple-soft)", color: "var(--purple)" }}><GitMerge size={15} /></div><div className="list-copy"><div className="list-name">Review {proposedGroups.length} duplicate suggestion{proposedGroups.length === 1 ? "" : "s"}</div><div className="list-detail">Merge related requests or keep them separate.</div></div><ArrowRight size={14} color="#9aa4b3" /></button>}</div></section>
              </div>
            </div>
            <section className="panel" style={{ marginTop: 18 }}><div className="panel-header"><div><h3 className="panel-title">Recent feedback</h3><div className="panel-subtitle">Original comments remain available for traceability</div></div><button className="link-button" onClick={() => setActiveView("inbox")}>Open inbox <ArrowRight size={12} style={{ verticalAlign: "middle", marginLeft: 3 }} /></button></div><div className="comment-list">{comments.slice(0, 4).map((comment) => <CommentRow key={comment._id} comment={comment} />)}{comments.length === 0 && <div className="no-results">No comments imported yet.</div>}</div></section>
          </>}

          {activeView === "inbox" && <div className="section-grid">
            <section className="panel"><div className="panel-header"><div><h3 className="panel-title">Import client feedback</h3><div className="panel-subtitle">Paste comments separated by a blank line or a line containing ---</div></div><Inbox size={18} color="#6e61e9" /></div><div className="panel-body"><form onSubmit={importFeedback}><div className="field-wrap"><label className="field-label" htmlFor="feedback-source">Source channel</label><select className="field" id="feedback-source" value={importSource} onChange={(e) => setImportSource(e.target.value as Source)}><option value="chat">Chat / messaging</option><option value="email">Email</option><option value="document">Document / meeting notes</option><option value="screenshot">Screenshot annotation (transcribed)</option></select></div><div className="field-wrap"><label className="field-label" htmlFor="feedback-text">Client comments</label><textarea id="feedback-text" className="field textarea" placeholder={'Make the header smaller.\n\nCan we make the buttons green?\n\nActually, keep the logo size unchanged.'} value={importText} onChange={(e) => setImportText(e.target.value)} required maxLength={100000} /></div><div className="source-row"><button className="button button-primary" type="submit" disabled={actionLoading === "import" || !importText.trim()}>{actionLoading === "import" ? <span className="spinner" /> : <Plus size={14} />} Import feedback</button><button className="button button-secondary" type="button" onClick={loadDemo} disabled={actionLoading === "demo"}>{actionLoading === "demo" ? <span className="spinner" /> : <Sparkles size={14} />} Load sample project</button></div><p className="helper-text" style={{ marginTop: 13, marginBottom: 0 }}>Duplicate imports are skipped within this project. For best results, separate each original message with a blank line.</p></form><div className="divider" /><div className="field-wrap"><label className="field-label" htmlFor="screenshot-upload">Or upload an annotated screenshot</label><input ref={screenshotInputRef} id="screenshot-upload" type="file" accept="image/png,image/jpeg,image/webp" className="field" style={{ padding: 9 }} onChange={(e) => setScreenshotFile(e.target.files?.[0] || null)} disabled={!apiStatus?.openaiConfigured || actionLoading === "screenshot"} /><div className="helper-text" style={{ marginTop: 7 }}>PNG, JPG, or WebP · 5 MB max · requires an OpenAI API key. The extracted text is added as source evidence; it is not analyzed until you run the pipeline.</div><div style={{ marginTop: 10 }}><button className="button button-secondary" type="button" onClick={uploadScreenshot} disabled={!screenshotFile || !apiStatus?.openaiConfigured || actionLoading === "screenshot"}>{actionLoading === "screenshot" ? <span className="spinner" /> : <FileText size={13} />} Extract feedback from screenshot</button></div></div></div></section>
            <section className="panel"><div className="panel-header"><div><h3 className="panel-title">Analysis pipeline</h3><div className="panel-subtitle">Review what the AI will do</div></div><Sparkles size={17} color="#6e61e9" /></div><div className="panel-body">{[{n:"01",title:"Feedback input",detail:"Import chat, email, documents, or screenshot text; or discover public review pages with TinyFish Search and extract selected sources with TinyFish Fetch."},{n:"02",title:"Request extraction",detail:"Classify actionable requests, questions, and opinions; normalize requests and flag unclear instructions using available site context."},{n:"03",title:"Duplicate detection",detail:"Find semantically similar requests and verify candidate pairs. Groups stay as suggestions until you confirm them."},{n:"04",title:"Conflict detection",detail:"After duplicate candidates are identified, detect contradictions and possible changes of mind for human resolution."},{n:"05",title:"Revision queue",detail:"Create traceable tasks for standalone requests; confirmed duplicate groups become consolidated tasks."},{n:"06",title:"Review & approval",detail:"Move tasks through To Do, In Progress, In Review, and Approved. Open conflicts block review and decisions are recorded."}].map((s) => <div className="list-item flex items-start gap-3" key={s.n}><div className="list-icon" style={{ background: "var(--purple-soft)", color: "var(--purple)", fontWeight: 800, fontSize: 11 }}>{s.n}</div><div className="list-copy"><div className="list-name">{s.title}</div><div className="list-detail">{s.detail}</div></div></div>)}{comments.length > 0 && <button className="button button-primary" style={{ width: "100%", marginTop: 13 }} onClick={analyzeFeedback} disabled={actionLoading === "analyze"}>{actionLoading === "analyze" ? <span className="spinner" /> : <Sparkles size={14} />} Analyze {comments.length} comments</button>}</div></section>
            <section className="panel source-discovery-panel" style={{ gridColumn: "1 / -1" }}>
              <div className="panel-header">
                <div><h3 className="panel-title">Find public feedback sources</h3><div className="panel-subtitle">TinyFish Search → TinyFish Fetch → structured feedback normalization</div></div>
                <div className="website-symbol"><Search size={17} /></div>
              </div>
              <div className="panel-body">
                <p className="helper-text" style={{ marginTop: 0 }}>Find public review/comment pages, inspect a selected source, then import distinct excerpts with their original source URL preserved. Only import content you have permission to use.</p>
                <form onSubmit={searchWebSources} className="source-discovery-form">
                  <div className="field-wrap" style={{ flex: 1, marginBottom: 0, minWidth: 220 }}>
                    <label className="field-label" htmlFor="source-query">Web source query</label>
                    <input id="source-query" className="field" value={sourceQuery} onChange={(e) => setSourceQuery(e.target.value)} placeholder={`${project.clientName || "Client"} customer reviews feedback`} maxLength={300} />
                  </div>
                  <button className="button button-primary" type="submit" disabled={!apiStatus?.tinyfishConfigured || actionLoading === "source-search"}>
                    {actionLoading === "source-search" ? <span className="spinner" /> : <Search size={14} />} Find sources with TinyFish
                  </button>
                </form>
                {!apiStatus?.tinyfishConfigured && <div className="context-note">Set TINYFISH_API_KEY in the backend environment and restart the server to enable live web source discovery.</div>}
                {sourceResults.length > 0 && <div className="source-discovery-list">
                  {sourceResults.map((source) => <div className="source-result-card" key={source.url}>
                    <div className="source-result-content">
                      <div className="source-result-meta"><span className="status-pill pill-purple">Source {source.position}</span><span className="source-domain">{source.domain}</span></div>
                      <strong>{source.title}</strong>
                      <p>{source.snippet || `Public page discovered on ${source.domain}.`}</p>
                      <a className="source-link" href={source.url} target="_blank" rel="noreferrer"><ExternalLink size={11} /> Open original source</a>
                    </div>
                    <button className="button button-secondary button-small" onClick={() => importWebSource(source)} disabled={Boolean(actionLoading) && actionLoading.startsWith("source-import:") || !apiStatus?.tinyfishConfigured}>
                      {actionLoading === `source-import:${source.url}` ? <span className="spinner" /> : <FileText size={12} />} Extract & import
                    </button>
                  </div>)}
                </div>}
              </div>
            </section>
            <section className="panel" style={{ gridColumn: "1 / -1" }}><div className="panel-header"><div><h3 className="panel-title">Feedback inbox <span className="status-pill pill-gray" style={{ marginLeft: 6 }}>{comments.length}</span></h3><div className="panel-subtitle">Raw source evidence and AI classification</div></div><button className="button button-secondary button-small" onClick={() => { setCommentSearch(""); setCommentFilter("all"); }}><RefreshCw size={12} /> Reset filters</button></div><div className="content-toolbar"><div className="search-field"><Search size={14} /><input value={commentSearch} onChange={(e) => setCommentSearch(e.target.value)} placeholder="Search original feedback…" /></div><select className="field" style={{ width: "auto", minWidth: 150, padding: "8px 10px", fontSize: 11 }} value={commentFilter} onChange={(e) => setCommentFilter(e.target.value)}><option value="all">All feedback</option><option value="actionable">Actionable</option><option value="question">Questions</option><option value="opinion">Opinions</option><option value="needs_clarification">Needs clarification</option><option value="unanalyzed">Not analyzed yet</option></select><span className="helper-text">{filteredComments.length} shown</span></div><div className="comment-list">{filteredComments.map((comment, i) => <CommentRow key={comment._id} comment={comment} index={i + 1} />)}{!filteredComments.length && <div className="no-results">No feedback matches those filters.</div>}</div></section>
          </div>}

          {activeView === "tasks" && <section className="panel"><div className="panel-header"><div><h3 className="panel-title">Revision queue</h3><div className="panel-subtitle">Move tasks through the review workflow. Open conflicts block review.</div></div><div className="status-pill pill-purple"><Layers3 size={12} /> {tasks.length} tasks</div></div>{unclearTasks > 0 && <div className="warning-banner" style={{ marginBottom: 0 }}><CircleHelp size={16} /> {unclearTasks} task(s) have unclear client instructions. Check the clarification note before implementation.</div>}<div className="task-columns">{STATUSES.map((s) => <div className="task-column" key={s.id}><div className="column-heading"><span>{s.label}</span><span className="column-count">{taskGroups[s.id].length}</span></div>{taskGroups[s.id].map((task) => <TaskCard key={task._id} task={task} busy={actionLoading === `task-${task._id}`} onStatus={(status) => changeTaskStatus(task, status)} onRequestChanges={() => requestChanges(task)} />)}{!taskGroups[s.id].length && <div className="no-results" style={{ padding: "28px 7px", fontSize: 10 }}>No tasks here</div>}</div>)}</div><div style={{ padding: "0 17px 17px" }}><div className="helper-text">Tip: tasks cannot move to In Review until all linked conflicts are resolved. Use source evidence on each card to retain context.</div></div></section>}

          {activeView === "groups" && <section className="panel"><div className="panel-header"><div><h3 className="panel-title">Suggested duplicate groups</h3><div className="panel-subtitle">AI proposes likely duplicates; you decide whether to merge them.</div></div><span className="status-pill pill-purple">{proposedGroups.length} awaiting review</span></div><div className="panel-body" style={{ paddingTop: 2 }}>{proposedGroups.map((group) => { const sourceComments = group.commentIds.map(asComment).filter((c): c is Comment => Boolean(c)); return <div className="group-card" key={group._id}><div className="conflict-header"><div><h3 className="conflict-title">These comments may describe the same change</h3><div className="list-detail">{sourceComments.length} source comments · Human confirmation required</div></div><span className="status-pill pill-purple"><GitMerge size={11} /> Proposed</span></div><div className="group-pair">{sourceComments.map((comment) => <div className="group-comment" key={comment._id}><div className="quote-label">{sourceName(comment.source)} · #{comment.sequence}</div>{comment.rawText}</div>)}</div><div className="group-reason"><strong>Why grouped:</strong> {group.reason}</div><div className="card-actions"><button className="button button-primary button-small" disabled={actionLoading === `group-${group._id}`} onClick={() => decideGroup(group._id, "merge")}>{actionLoading === `group-${group._id}` ? <span className="spinner" /> : <GitMerge size={12} />} Merge into one task</button><button className="button button-secondary button-small" disabled={actionLoading === `group-${group._id}`} onClick={() => decideGroup(group._id, "keep_separate")}><X size={12} /> Keep separate</button></div></div>; })}{!proposedGroups.length && <EmptyInline icon={<CheckCircle2 size={20} />} title="You're all caught up" detail="No duplicate suggestions are waiting for a decision. Import and analyze feedback to find more." action={<button className="button button-secondary button-small" onClick={() => setActiveView("inbox")}>Go to feedback inbox <ArrowRight size={12} /></button>} />}</div></section>}

          {activeView === "conflicts" && <section className="panel"><div className="panel-header"><div><h3 className="panel-title">Conflicts & changes of mind</h3><div className="panel-subtitle">Review opposing requests before work moves into review.</div></div><span className={`status-pill ${openConflicts.length ? "pill-red" : "pill-green"}`}>{openConflicts.length} open</span></div><div className="panel-body" style={{ paddingTop: 2 }}>{conflicts.map((conflict) => { const pair = conflict.commentIds.map(asComment).filter((c): c is Comment => Boolean(c)); return <div key={conflict._id} className="conflict-card" style={conflict.status === "resolved" ? { borderColor: "#d9efe5", background: "#fcfffd" } : {}}><div className="conflict-header"><div><h3 className="conflict-title">{conflict.kind === "change_of_mind" ? "Possible change of mind" : "Contradictory instructions"}</h3><div className="list-detail">{conflict.status === "resolved" ? `Resolved · ${conflict.resolution?.replaceAll("_", " ") || "decision recorded"}` : "Open · A human decision is required"}</div></div><span className={`status-pill ${conflict.status === "resolved" ? "pill-green" : "pill-red"}`}>{conflict.status}</span></div><p className="conflict-desc">{conflict.explanation}</p><div className="conflict-sides"><div className="quote-box"><div className="quote-label">Instruction A</div><div className="quote-text">{pair[0]?.rawText || "Source comment unavailable"}</div></div><div className="quote-box"><div className="quote-label">Instruction B</div><div className="quote-text">{pair[1]?.rawText || "Source comment unavailable"}</div></div></div>{conflict.status === "open" && <div className="card-actions"><button className="button button-primary button-small" disabled={actionLoading === `conflict-${conflict._id}`} onClick={() => resolveConflict(conflict._id, "follow_a")}><Check size={12} /> Follow A</button><button className="button button-secondary button-small" disabled={actionLoading === `conflict-${conflict._id}`} onClick={() => resolveConflict(conflict._id, "follow_b")}><Check size={12} /> Follow B</button><button className="button button-secondary button-small" disabled={actionLoading === `conflict-${conflict._id}`} onClick={() => resolveConflict(conflict._id, "ask_client")}><MessageSquareText size={12} /> Ask client</button></div>}</div>; })}{!conflicts.length && <EmptyInline icon={<ShieldCheck size={20} />} title="No conflicts detected" detail="When analysis identifies potentially incompatible requests, review the evidence here." action={<button className="button button-secondary button-small" onClick={analyzeFeedback}>Run analysis <Sparkles size={12} /></button>} />}</div></section>}

          {activeView === "approvals" && <div className="section-grid"><section className="panel"><div className="panel-header"><div><h3 className="panel-title">Approval activity</h3><div className="panel-subtitle">Every decision is tied to a task and stored in the database.</div></div><History size={18} color="#6e61e9" /></div><div className="activity-list">{history.map((event) => { const task = tasks.find((t) => t._id === idOf(event.taskId)); return <div className="activity-event" key={event._id}><div className="activity-dot">{event.decision === "approved" ? <CheckCheck size={14} /> : <RefreshCw size={14} />}</div><div className="activity-copy"><strong>{event.decision === "approved" ? "Task approved" : "Changes requested"}</strong>{task ? ` · ${task.title}` : ""}{event.note && <div className="list-detail">{event.note}</div>}<div className="activity-time">{new Date(event.createdAt).toLocaleString()}</div></div></div>; })}{!history.length && <EmptyInline icon={<ClipboardCheck size={20} />} title="No approval events yet" detail="Move a task to In Review in the revision queue, then approve it or request changes to create an audit entry." action={<button className="button button-secondary button-small" onClick={() => setActiveView("tasks")}>Open revision queue <ArrowRight size={12} /></button>} />}</div></section><section className="panel"><div className="panel-header"><div><h3 className="panel-title">Ready for client decision</h3><div className="panel-subtitle">Tasks currently waiting in review</div></div><span className="status-pill pill-amber">{tasks.filter((t) => t.status === "in_review").length} in review</span></div><div className="panel-body">{tasks.filter((t) => t.status === "in_review").map((task) => <div className="list-item" key={task._id}><div className="list-icon" style={{ background: "var(--amber-soft)", color: "var(--amber)" }}><ClipboardCheck size={15} /></div><div className="list-copy"><div className="list-name">{task.title}</div><div className="list-detail">{task.sourceCommentIds.length} source comment(s)</div><div className="card-actions" style={{ marginTop: 9 }}><button className="button button-success button-small" onClick={() => changeTaskStatus(task, "approved")} disabled={actionLoading === `task-${task._id}`}><Check size={11} /> Approve</button><button className="button button-secondary button-small" onClick={() => requestChanges(task)} disabled={actionLoading === `task-${task._id}`}>Request changes</button></div></div></div>)}{!tasks.some((t) => t.status === "in_review") && <EmptyInline icon={<Clock3 size={19} />} title="Nothing waiting for approval" detail="Tasks will appear here after they are moved to In Review." action={<button className="button button-secondary button-small" onClick={() => setActiveView("tasks")}>Open revision queue <ArrowRight size={12} /></button>} />}</div></section></div>}
        </div>}
      </main>

      {newProjectOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setNewProjectOpen(false); }}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="create-project-title"><div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}><div><div className="eyebrow"><Plus size={12} /> NEW WORKSPACE</div><h2 id="create-project-title">Create a project</h2><p className="modal-sub">Keep one client's feedback, website context, tasks, and approvals together.</p></div><button className="button button-quiet" aria-label="Close modal" onClick={() => setNewProjectOpen(false)}><X size={17} /></button></div><form onSubmit={createProject}><div className="field-wrap"><label className="field-label" htmlFor="project-name">Project name</label><input id="project-name" className="field" value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} required minLength={2} maxLength={120} /></div><div className="field-wrap"><label className="field-label" htmlFor="client-name">Client / organization</label><input id="client-name" className="field" value={newClientName} onChange={(e) => setNewClientName(e.target.value)} maxLength={120} /></div><div className="field-wrap"><label className="field-label" htmlFor="website-url">Website URL <span className="muted" style={{ fontWeight: 400 }}>(optional)</span></label><input id="website-url" className="field" type="url" placeholder="https://your-client-site.com" value={newWebsiteUrl} onChange={(e) => setNewWebsiteUrl(e.target.value)} /></div><p className="helper-text">You can fetch public website context using TinyFish after creating the project. Keep API credentials in the backend environment only.</p><div className="modal-actions"><button className="button button-secondary" type="button" onClick={() => setNewProjectOpen(false)}>Cancel</button><button className="button button-primary" type="submit" disabled={actionLoading === "create-project"}>{actionLoading === "create-project" ? <span className="spinner" /> : <Plus size={14} />} Create project</button></div></form></div></div>}
      {notice && <div className={`notice ${notice.tone}`} role="status"><div>{notice.tone === "error" ? <AlertCircle size={16} /> : notice.tone === "success" ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}</div><div style={{ flex: 1 }}>{notice.message}</div><button onClick={() => setNotice(null)} aria-label="Dismiss notification"><X size={14} /></button></div>}
    </div>
  );
}

function viewDescription(view: View) {
  const descriptions: Record<View, string> = {
    overview: "A single source of truth for client feedback and revisions.",
    inbox: "Import original comments, classify them, and keep source context intact.",
    tasks: "Track actionable revisions from To Do through client approval.",
    groups: "Review AI-suggested duplicate groups before anything is merged.",
    conflicts: "Surface competing instructions and record a human resolution.",
    approvals: "Review decisions and change requests recorded against each task."
  };
  return descriptions[view];
}

function StatCard({ label, value, foot, icon, color }: { label: string; value: number; foot: string; icon: ReactNode; color: string }) {
  return <div className="stat-card"><div className="stat-top"><span>{label}</span><div className={`stat-icon ${color}`}>{icon}</div></div><div className="stat-number">{value}</div><div className="stat-foot">{foot}</div></div>;
}
function EmptyInline({ icon, title, detail, action }: { icon: ReactNode; title: string; detail: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon">{icon}</div><strong>{title}</strong>{detail}{action && <div style={{ marginTop: 14 }}>{action}</div>}</div>;
}
function CommentRow({ comment, index }: { comment: Comment; index?: number }) {
  const typeStyle = comment.type === "actionable" ? "pill-green" : comment.type === "question" ? "pill-blue" : comment.type === "opinion" ? "pill-gray" : "pill-amber";
  const group = idOf(comment.groupId);
  const task = idOf(comment.taskId);
  return <div className="comment-row"><div className="comment-index">{index || comment.sequence || "•"}</div><div className="comment-main"><p className="comment-text">{comment.rawText}</p><div className="comment-meta"><span className="source-pill pill-gray">{sourceName(comment.source)}</span><span className={`status-pill ${typeStyle}`}>{comment.type === "unanalyzed" ? "Not analyzed" : comment.type}</span>{comment.needsClarification && <span className="status-pill pill-amber"><CircleHelp size={10} /> Needs clarification</span>}{group && <span className="status-pill pill-purple"><GitMerge size={10} /> Grouped</span>}{task && <span className="status-pill pill-blue"><Layers3 size={10} /> Task linked</span>}{comment.sourceRating && <span className="status-pill pill-amber">Rating: {comment.sourceRating}</span>}</div>{comment.sourceUrl && <div className="source-origin"><span>{comment.sourceTitle || "Original web source"}{comment.sourceAuthor ? ` · ${comment.sourceAuthor}` : ""}</span><a className="source-link" href={comment.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink size={10} /> Original URL</a></div>}{comment.normalizedRequest && comment.normalizedRequest !== comment.rawText && <div className="list-detail" style={{ marginTop: 8 }}><strong>Normalized:</strong> {comment.normalizedRequest}</div>}{comment.needsClarification && comment.clarificationNote && <div className="list-detail" style={{ color: "#a46d10", marginTop: 5 }}><strong>Clarify:</strong> {comment.clarificationNote}</div>}</div></div>;
}
function TaskSummary({ task, onOpen }: { task: Task; onOpen: () => void }) {
  const status = STATUSES.find((s) => s.id === task.status)!;
  return <button className="list-item" style={{ width: "100%", textAlign: "left", border: 0, background: "transparent", cursor: "pointer" }} onClick={onOpen}><div className="list-icon" style={{ background: task.status === "approved" ? "var(--green-soft)" : "var(--purple-soft)", color: task.status === "approved" ? "var(--green)" : "var(--purple)" }}><Layers3 size={15} /></div><div className="list-copy"><div className="list-name">{task.title}</div><div className="list-detail">{task.sourceCommentIds.length} source comment(s) · {dateLabel(task.updatedAt)}</div></div><span className={`status-pill ${status.color}`}>{status.label}</span></button>;
}
function TaskCard({ task, busy, onStatus, onRequestChanges }: { task: Task; busy: boolean; onStatus: (status: Task["status"]) => void; onRequestChanges: () => void }) {
  const sources = task.sourceCommentIds.filter((c) => typeof c === "object").length;
  const status = STATUSES.find((s) => s.id === task.status)!;
  return <div className="task-card"><div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}><span className={`priority-pill ${task.priority === "high" ? "pill-red" : task.priority === "medium" ? "pill-amber" : "pill-gray"}`}>{task.priority} priority</span>{task.needsClarification && <span title={task.clarificationNote} style={{ color: "#b8801b", display: "inline-flex" }}><CircleHelp size={14} /></span>}</div><h4>{task.title}</h4><p className="task-desc">{task.description}</p>{task.needsClarification && <div className="list-detail" style={{ color: "#a46d10", marginBottom: 9 }}>Needs clarification: {task.clarificationNote}</div>}{idOf(task.conflictIds[0]) && <div className="status-pill pill-red" style={{ marginBottom: 8 }}><AlertTriangle size={10} /> Conflict linked</div>}<div className="task-card-footer"><span className="task-source-count"><FileText size={11} /> {sources || task.sourceCommentIds.length} source</span><span className={`status-pill ${status.color}`}>{status.label}</span></div>{task.status !== "approved" && <select className="task-select" aria-label={`Change status for ${task.title}`} value={task.status} onChange={(e) => onStatus(e.target.value as Task["status"])} disabled={busy}><option value="todo">Move to To Do</option><option value="in_progress">Move to In Progress</option><option value="in_review">Move to In Review</option></select>}{task.status === "in_review" && <div className="card-actions" style={{ marginTop: 8 }}><button className="button button-success button-small" style={{ flex: 1 }} disabled={busy} onClick={() => onStatus("approved")}><Check size={11} /> Approve</button><button className="button button-secondary button-small" style={{ flex: 1 }} disabled={busy} onClick={onRequestChanges}>Request changes</button></div>}</div>;
}
function WebsiteContextCard({ project, actionLoading, showContent, onToggle, onFetch, onSaveUrl, tinyfishEnabled }: { project: Project; actionLoading: string; showContent: boolean; onToggle: () => void; onFetch: () => void; onSaveUrl: (url: string) => void; tinyfishEnabled: boolean }) {
  const context = project.websiteContext;
  const [urlDraft, setUrlDraft] = useState(project.websiteUrl || "");
  useEffect(() => setUrlDraft(project.websiteUrl || ""), [project.websiteUrl]);
  return <section className="panel"><div className="panel-header"><div><h3 className="panel-title">Live website context</h3><div className="panel-subtitle">TinyFish Fetch + live site context for request extraction</div></div><div className="website-symbol"><Globe2 size={17} /></div></div><div className="panel-body"><div className="website-card"><div className="website-row"><div className="website-symbol"><Globe2 size={17} /></div><div style={{ minWidth: 0, flex: 1 }}><h3>{context?.title || "Connect the client's website"}</h3><div className="website-url">{project.websiteUrl || "No website URL configured"}</div></div></div><div style={{ display: "flex", gap: 7, marginTop: 12 }}><input aria-label="Client website URL" type="url" className="field" style={{ minWidth: 0, padding: "8px 9px", fontSize: 10 }} placeholder="https://client-site.com" value={urlDraft} onChange={(e) => setUrlDraft(e.target.value)} /><button className="button button-secondary button-small" onClick={() => onSaveUrl(urlDraft)} disabled={!urlDraft.trim() || urlDraft === (project.websiteUrl || "") || actionLoading === "save-url"}>{actionLoading === "save-url" ? <span className="spinner" /> : <Check size={11} />} Save</button></div><p className="website-copy">{context ? context.description || "Page content was saved and can ground AI feedback analysis." : "Fetch the live page so FeedbackFlow can ground request extraction in the site as it exists now. Analysis refreshes stale context automatically when TinyFish is configured."}</p><div className="source-row"><button className="button button-primary button-small" onClick={onFetch} disabled={!project.websiteUrl || actionLoading === "website" || !tinyfishEnabled}>{actionLoading === "website" ? <span className="spinner" /> : <Globe2 size={12} />} {context?.source === "tinyfish" ? "Refresh with TinyFish" : "Fetch with TinyFish"}</button>{context && <button className="button button-secondary button-small" onClick={onToggle}>{showContent ? "Hide context" : "View context"}</button>}{project.websiteUrl && <a className="button button-secondary button-small" style={{ textDecoration: "none" }} href={project.websiteUrl} target="_blank" rel="noreferrer"><ExternalLink size={11} /> Open site</a>}</div>{context && <div className="context-note">{context.source === "tinyfish" ? `Fetched by TinyFish · ${dateLabel(context.fetchedAt)}` : "Demo context — not fetched from the live website."}</div>}{!tinyfishEnabled && <div className="context-note">Add TINYFISH_API_KEY to server environment to enable live website fetching.</div>}{showContent && context && <div className="context-content">{context.text}</div>}</div></div></section>;
}
