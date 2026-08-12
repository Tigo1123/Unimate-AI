# UniMate AI

UniMate AI is a university-independent study workspace that turns a student's private course materials into grounded conversations, summaries, flashcards, quizzes, and platform-based progress insights.

## Architecture

- `apps/web`: React, TypeScript, Vite, Tailwind, React Router, TanStack Query
- `apps/api`: Express REST API, Prisma, JWT sessions, and durable in-process source processing
- `apps/worker`: deprecated standalone source processor retained for a future split deployment
- `packages/ai`: provider-neutral chat, validated structured generation, and embedding adapters
- `packages/contracts`: transport validation and shared API types
- PostgreSQL with pgvector for application data, jobs, and document retrieval
- Provider interfaces for AI and file storage; deterministic mock AI and local private storage are the development defaults

The MVP deploys as a single API process. The API polls durable PostgreSQL jobs for PDF/DOCX/PPTX/TXT/Markdown extraction, semantic chunking, and embeddings. Interrupted jobs use a stale lease and are safely re-queued when the API wakes or restarts. Every user-owned query is constrained by the authenticated user ID.

## Prerequisites

- Node.js 20+
- npm 10+
- PostgreSQL 16 with the `vector` extension (the included Compose service uses pgvector)

## Local setup

1. Copy `.env.example` to `.env` and set secure development secrets.
2. Make the same database/runtime values available to `apps/api/.env`, or export them in your shell.
3. Start PostgreSQL using a Compose implementation:

   ```bash
   docker compose up -d postgres
   ```

4. Install and initialize:

   ```bash
   npm install
   npm run db:generate
   npm run db:migrate
   npm run dev
   ```

The web application runs at `http://localhost:5173`; the API runs at `http://localhost:4000`.

## AI providers

`AI_PROVIDER=mock` provides an offline development adapter. It is deterministic, visibly labels chat as demo output, and does not require paid API access. Provider calls happen only in the API and worker; credentials are never sent to the browser.

For OpenAI, configure:

```dotenv
AI_PROVIDER=openai
AI_API_KEY=your-key
AI_MODEL=gpt-5-mini
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSIONS=1536
```

The provider has configurable timeouts, transient retries, output limits, batch embeddings, and Zod-validated structured output. Existing chunks are retrieved only when their recorded embedding model matches the active model. Reprocess old sources after changing embedding models.

## Document and RAG test flow

1. Start PostgreSQL and run `npm run db:migrate`.
2. Run `npm run dev`, then register or sign in at `http://localhost:5173`.
3. Create a semester and course and upload a supported lecture. The API processes it asynchronously in-process.
4. Wait for the source to move through “Creating study index” and “Processing” to “Ready”. Failed sources remain available and can be retried.
5. Generate a summary, explanation, flashcards, or quiz from the course tabs.
6. Open AI Chat, select all ready sources or an explicit subset, ask a question answered by the lecture, and expand the returned citations to inspect the supporting excerpt.
7. Ask a follow-up such as “make it easier”; recent conversation history is included with the next grounded retrieval.

## Storage

`STORAGE_PROVIDER=local` writes beneath `uploads/`, outside the public web root. `STORAGE_PROVIDER=r2` uses Cloudflare R2 through its S3-compatible API. Downloads always pass through an ownership-checked API endpoint.

## Commands

```bash
npm run dev
# Optional deprecated split topology for development only:
npm run dev:with-worker
npm run typecheck
npm run lint
npm run test
npm run build
npm run db:generate
npm run db:migrate
```

## Security notes

- Replace all development secrets before deployment.
- Serve the API and frontend through HTTPS.
- Configure a production email adapter before enabling password-reset links for users.
- Keep object storage private and use short-lived authorized downloads.
- Define user upload and AI quotas before public launch.
- Retrieved documents are treated as untrusted content and are separated from model instructions.

## Current scope

The implementation covers authentication, onboarding, semesters, courses, private multi-format sources, asynchronous semantic indexing, pgvector retrieval, grounded chat and citations, hierarchical summaries and explanations, flashcards, quizzes with objective and AI-assisted grading, topic mastery, progress, dashboard, search, profile settings, responsive UI, and light/dark styling.

Deferred items include OAuth/SSO, admin screens, OCR for scanned PDFs, advanced reranking, full conversation-summary memory, spaced repetition scheduling, collaboration, payments, native apps, media imports, and LMS integrations.
