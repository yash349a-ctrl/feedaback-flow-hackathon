# FeedbackFlow AI — The AI Revision Resolver

<p align="center">
  <img src="client/public/feedbackflow-logo-banner.jpg" alt="FeedbackFlow AI logo" width="820" />
</p>

**FeedbackFlow AI** turns scattered client revision comments into a prioritized, traceable queue. It classifies feedback, suggests duplicate groups, flags conflicting instructions, keeps source comments attached to each task, and records approval decisions. TinyFish Fetch retrieves public website content so the analysis can consider the site's current context.

> AI outputs are suggestions. Users confirm duplicate merges and resolve conflicts. Normal application code—not the LLM—enforces task status transitions and writes approval events.

## Features in this implementation

- **Persistent dark/light mode** with an ambient navy, cyan, violet, and teal dark theme.
- **Project workspaces** with client name and website URL.
- **Bulk feedback import** from pasted chat, email, or meeting notes. Separate comments with blank lines or `---`; repeated text imports are skipped.
- **AI classification and extraction**: actionable request, question, opinion, priority, normalized wording, and clarification note. OpenAI uses schema-constrained responses + Zod validation when configured.
- **Duplicate detection**: `text-embedding-3-small` candidate retrieval where available, pair-level LLM confirmation, and a deterministic demo fallback. Suggested groups are never merged without a user decision. Group creation avoids transitive over-merging by requiring pairwise compatibility.
- **Conflict and change-of-mind review** with source comments, explanation, Follow A / Follow B / Ask client actions.
- **Revision board** with To Do, In Progress, In Review, and Approved states. Open linked conflicts block moving a task to In Review.
- **Approval history** records approved / changes-requested decisions with notes.
- **TinyFish Search + Fetch integration** via server-side calls to `https://api.search.tinyfish.ai` and `https://api.fetch.tinyfish.ai`. The Feedback inbox includes a Web Source Identification panel: search for public review/comment sources, open the original result, fetch a selected page, normalize distinct review excerpts, and import each with its original source URL/title (plus author/rating when present). The separate Live website context card fetches a client website as context; Analyze refreshes missing or stale context (15 minutes or older) before request extraction.
- **Demo seed endpoint** with 25 representative comments and sample page context, so the app can be explored before API credentials are configured.
- Rate limiting, security headers, CORS allowlist, input validation, basic URL checks, and no API secrets in client code.

## Stack

- Frontend: Next.js App Router + React + TypeScript + Tailwind CSS utilities (with the existing custom design system retained)
- Backend: Node.js + Express + TypeScript
- Database: MongoDB + Mongoose
- LLM: OpenAI Responses API with Structured Outputs and Zod
- Website source discovery and content extraction: TinyFish Search API + TinyFish Fetch API

## Requirements

- Node.js 20.11+
- npm 10+
- MongoDB (Atlas or local)
- Optional but recommended: OpenAI API key and TinyFish API key

ChatGPT plans and OpenAI API billing are separate. Create an API key at [OpenAI API keys](https://platform.openai.com/api-keys). Create a TinyFish key at [TinyFish API keys](https://agent.tinyfish.ai/api-keys). See the [OpenAI Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs) and [TinyFish Fetch documentation](https://docs.tinyfish.ai/fetch-api).

## Run locally

1. Clone / download this repository and open the `feedbackflow-ai` folder in a terminal.
2. Install dependencies:

   ```bash
   npm install
   ```

3. Create `server/.env` by copying `server/.env.example`. Fill in `MONGODB_URI`; add `OPENAI_API_KEY` and `TINYFISH_API_KEY` if available. Do not commit this file.
4. Create `client/.env.local` by copying `client/.env.example`, then set `NEXT_PUBLIC_API_URL=http://localhost:5000`.
5. Start both apps from the repository root:

   ```bash
   npm run dev
   ```

6. Open [http://localhost:3000](http://localhost:3000). The API health endpoint is [http://localhost:5000/health](http://localhost:5000/health).
7. Click **Load demo data**, then **Analyze feedback**. Without an OpenAI key, a deterministic fallback demonstrates the workflow. Without a TinyFish key, demo website context is shown and live fetching is disabled.

### Run the apps separately

```bash
npm run dev -w server
npm run dev -w client
```

### Build / type-check

```bash
npm run typecheck
npm run build
```

## Environment variables

### Backend (`server/.env`)

| Name | Required | Description |
|---|---|---|
| `MONGODB_URI` | Yes | MongoDB connection string |
| `PORT` | No | Defaults to `5000`; deployment providers may supply it |
| `CLIENT_ORIGIN` | Yes in deployed app | Comma-separated exact frontend origin(s), e.g. `https://feedbackflow.vercel.app` |
| `OPENAI_API_KEY` | No for demo | Enables OpenAI extraction, embeddings, duplicate confirmation, and conflict classification |
| `OPENAI_MODEL` | No | Defaults to `gpt-4o-mini`; set to a model available to your account that supports Structured Outputs |
| `OPENAI_VISION_MODEL` | No | Screenshot extraction model; defaults to `OPENAI_MODEL` or `gpt-4o-mini` |
| `EMBEDDING_MODEL` | No | Defaults to `text-embedding-3-small` |
| `TINYFISH_API_KEY` | No for demo | Enables live source discovery with TinyFish Search and live page extraction with TinyFish Fetch |
| `DUPLICATE_SIMILARITY_THRESHOLD` | No | Defaults to `0.76`; tune against your labeled sample comments |
| `ENABLE_DEMO_SEED` | No | Defaults to `true`; set to `false` to disable the demo seed route |

### Frontend (`client/.env.local`)

| Name | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | Yes | Base URL for Express, without a trailing slash |

Only the public backend URL belongs in a `NEXT_PUBLIC_*` variable. **Never put OpenAI or TinyFish keys in the frontend environment.**

## End-to-end workflow (matches the presentation)

The application runs these six stages in order:

1. **Feedback Input** — create a project, paste chat/email/document feedback, extract text from a screenshot, or use TinyFish Search to identify public reviews/comments pages. TinyFish Fetch retrieves a selected page; its original source URL is stored with each imported excerpt. The separate website-context fetch can enrich analysis with the client's own current website.
2. **Request Extraction** — OpenAI classifies each comment as actionable, question, or opinion; normalizes actionable requests; assigns priority; and flags vague instructions. Retrieved TinyFish website content is sent as context, not as trusted instructions.
3. **Duplicate Detection** — semantic embeddings and pair-level checks identify candidate duplicates. Groups remain suggestions until a user confirms the merge.
4. **Conflict Detection** — the conflict pass flags contradictions and possible changes of mind. Any proposed duplicate group that contains a pair detected as conflicting is discarded before the group is saved.
5. **Revision Queue** — standalone actionable comments become tasks; a suggested duplicate group becomes a consolidated task only after a user confirms it. Every task retains its source comment IDs.
6. **Review & Approval** — users move tasks through To Do, In Progress, In Review, and Approved. Open conflicts block review, and approval/change-request decisions are stored in history.

The order is intentional: extract requests first, detect duplicate candidates second, detect conflicts third, then persist safe duplicate suggestions and build/update the revision queue.

## TinyFish integration

TinyFish is integrated as real backend calls, not just a UI label. In the Feedback inbox, **Find public feedback sources** calls TinyFish Search to discover source URLs from a query (default: the client name plus customer reviews/feedback). Selecting **Extract & import** calls TinyFish Fetch for that public page, then OpenAI Structured Outputs extracts distinct user-authored review/comment excerpts. Each imported comment stores `sourceUrl`, `sourceTitle`, and optional `sourceAuthor` / `sourceRating`; the Inbox exposes an **Original URL** link for traceability. When OpenAI is unavailable or normalization fails, a cautious heuristic fallback is used and the UI reports a warning. This fallback is less accurate, so review extracted content manually.

The user can also fetch site context from **Live website context**. During **Analyze feedback**, the server also refreshes context if the project has a website URL, `TINYFISH_API_KEY` is set, and there is no matching TinyFish context fetched in the last 15 minutes. If the fetch fails, the pipeline reports a warning and continues using cached context where available (or proceeds without site context); it does not discard the user's feedback.

The Express server calls the documented Search and Fetch REST endpoints using the server-only `X-API-Key` header:

```http
GET https://api.search.tinyfish.ai?query=Acme+Studio+customer+reviews&location=IN&language=en
X-API-Key: <server-side key>
```

The selected search-result URL is then fetched and normalized:

```http
POST https://api.fetch.tinyfish.ai
X-API-Key: <server-side key>
Content-Type: application/json
```

```json
{
  "urls": ["https://your-client-site.example/reviews"],
  "format": "markdown",
  "links": true,
  "purpose": "Extract public user-authored reviews and feedback for a client revision workflow."
}
```

The extracted text is limited before storing/prompting. The implementation rejects non-HTTP(S), localhost, and obvious private/reserved IP addresses; TinyFish applies its own URL restrictions as well. Fetching may fail on pages that block extraction or contain no readable text. Use public pages you have permission to access.

## API overview

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/health` | Server / database health |
| GET | `/api/status` | Reports database, OpenAI, TinyFish, and demo configuration |
| GET / POST | `/api/projects` | List / create projects |
| PATCH | `/api/projects/:projectId` | Update project name, client, or website URL |
| GET | `/api/projects/:projectId` | Project details and counts |
| GET / POST | `/api/projects/:projectId/comments` | List / bulk import feedback |
| POST | `/api/projects/:projectId/analyze` | Classification, duplicate suggestions, conflict detection, task creation |
| POST | `/api/projects/:projectId/sources/search` | Search the public web for feedback/review source URLs with TinyFish Search |
| POST | `/api/projects/:projectId/sources/import` | Fetch a selected source with TinyFish Fetch, normalize excerpts, and import comments with source URLs |
| POST | `/api/projects/:projectId/website-context` | Fetch the client's website context via TinyFish Fetch |
| POST | `/api/projects/:projectId/screenshots` | Extract visible revision feedback from a PNG/JPG/WebP using a vision-capable OpenAI model |
| GET | `/api/projects/:projectId/groups` | List duplicate suggestions and decisions |
| POST | `/api/projects/:projectId/groups/:groupId/decision` | Merge group or keep comments separate |
| GET | `/api/projects/:projectId/conflicts` | List conflicts |
| PATCH | `/api/conflicts/:conflictId/resolve` | Follow A / Follow B / Ask client |
| GET | `/api/projects/:projectId/tasks` | List the revision queue |
| PATCH | `/api/tasks/:taskId/status` | Move task through allowed statuses |
| POST | `/api/tasks/:taskId/approval` | Record approval or requested changes |
| GET | `/api/tasks/:taskId/history` | List approval history events |
| POST | `/api/demo/seed` | Create sample project (disable with `ENABLE_DEMO_SEED=false`) |

## Deployment

### 1. MongoDB Atlas

1. Create a MongoDB cluster and a dedicated database user with least-privilege access to the application database.
2. Copy the connection URI from **Connect → Drivers**; replace the password placeholder and URL-encode special characters in the password.
3. Configure Atlas network access as narrowly as your hosting setup allows. Render outbound IPs may vary by service/plan; check the service's outbound IP information and Atlas connectivity options. Use `0.0.0.0/0` only as a temporary hackathon fallback if necessary, then restrict access before using real client data.

### 2. Deploy the Express API (Render or Railway)

Create a Node web service from this repository.

- **Root directory:** `server`
- **Build command:** `npm install --include=dev && npm run build`
- **Node version:** `22.23.3` (pinned through `NODE_VERSION` and `.node-version` for repeatable builds)
- **Start command:** `npm start`
- **Environment variables:** `MONGODB_URI`, `CLIENT_ORIGIN`, optional `OPENAI_API_KEY`, `OPENAI_MODEL`, `EMBEDDING_MODEL`, `TINYFISH_API_KEY`, `ENABLE_DEMO_SEED=true`

After deployment, open `https://YOUR-API/health` and ensure it returns `{ "ok": true, "database": "connected" }`.

If your host cannot install the server with `server` as its root directory because it expects workspace metadata at the repo root, set root directory to the repo root, use `npm install --include=dev && npm run build -w server`, and start with `npm run start -w server`.

### 3. Deploy Next.js (Vercel)

Import the repository into Vercel. Configure the `client` folder as the Next.js application root. Set:

```env
NEXT_PUBLIC_API_URL=https://YOUR-API-DOMAIN
```

Set the exact frontend URL in the backend's `CLIENT_ORIGIN` environment variable, redeploy the backend if needed, then redeploy the frontend. Do not add API keys to Vercel's client environment.

### 4. Test the deployed end-to-end path

- Open `/health` on the API host.
- Create a new project and import comments.
- Run analysis and verify duplicate groups, conflict prompts, and task creation.
- Search for public review/comment pages with TinyFish Search, then fetch and import a selected source with TinyFish Fetch. Verify each imported comment links back to its original source URL.
- Fetch the project website via TinyFish for separate site-context grounding.
- Merge / reject a duplicate suggestion.
- Resolve a conflict and move the relevant task to In Review.
- Approve a task or request changes and verify approval history.
- Test the workflow on a second browser/device and keep a recording + demo dataset ready.

## Known MVP limitations (please read)

This is a hackathon-ready implementation, not a fully hardened multi-tenant commercial product. It intentionally does **not** include user authentication, role-based access, invitations, audit access controls, background queues, billing, integrations with WhatsApp/Gmail/Slack. Screenshot text extraction from an uploaded image is implemented, but automatic visual layout understanding beyond extraction is limited. Before using with real client or confidential data, add authentication and authorization to every project-scoped endpoint, keep MongoDB network access restricted, set conservative API spend limits, and review provider data policies.

No AI-based classification or semantic matching is perfectly reliable. Review duplicates and conflicts manually. The fallback mode is heuristic/demo mode—not equivalent to OpenAI analysis. Demo website context is explicitly labeled as demo context, not live TinyFish evidence.

## Local environment tips

- Keep `server/.env` and `client/.env.local` untracked. The committed `.env.example` files contain only safe defaults/placeholders.
- The Next.js config pins the Turbopack root to this repository to avoid incorrectly inferring a parent directory from unrelated lockfiles. If Next.js still warns about a `package-lock.json` outside this repository, inspect that file before deleting it; do not remove a lockfile unless you know it is unrelated.
- For fewer Windows file-watcher and `node_modules` syncing issues, keep the repo outside OneDrive, for example `C:\dev\feedbackflow-ai`. Copy the source there, then run `npm install` from the repository root.

## Before pushing to GitHub

- Add screenshots from the running application and the deployed app URL once available.
- Document the live TinyFish data path and note which features were tested with real API credentials.
- Include the `.env.example` templates; never commit a real `.env` or API key.
- Keep the project README accurate: label any demo fallback as heuristic output, not live LLM output.
