# Telescope

What a year of one conversation actually looked like.

Telescope reads a Telegram 1:1 chat export and turns it into a deck of full-screen
cards: who talks more, who waits longer, when it went quiet and who broke the
silence, which words are characteristic of each of you rather than merely frequent.
It ends on one line — six-ish words for the dynamic between the two of you.

## The two halves

The split is deliberate, and it runs through the whole codebase.

**The deterministic half** is arithmetic: volume, sessions, reply latency
percentiles, monologue runs, chapter segmentation by rate of change, log-odds
distinctive vocabulary with an informative Dirichlet prior. It lives in
`src/domain/`, which has no external imports at all, and it runs in your browser.

**The written half** is a language model, and it is only allowed to say what the
numbers already show. It gets a brief built from the deterministic output plus a
sampled corpus, and every quote it cites is checked against the real messages
before it renders — unsupported readings are dropped rather than shown. Three
calls over one cached prompt prefix: read, propose, judge.

Two rules the UI keeps everywhere: a number without a per-person version is a
warm-up card, not a finding, and a quote is always shown as the whole message with
the cited fragment marked inside it, never clipped to the fragment.

## Where your data goes

- Parsing and every deterministic metric happen in the browser. The export file is
  not uploaded to run them.
- The written half is the exception, and the UI says so before you opt in: the
  browser uploads the export directly to encrypted private S3. An SQS-driven ECS
  worker re-parses it, sends a sampled corpus to OpenAI, saves the completed
  reading, and deletes the raw export. S3 expires abandoned uploads after one day.
- Saving a report stores the computed analysis and the model's readings — including
  the messages it quotes — in your own Postgres.

Chat exports and anything derived from one are gitignored (`result.json`,
`ChatExport*/`, `*.wrapped.json`). Keep it that way.

## Running it

```sh
npm install
npm run db:local:up
npm run db:migrate
npm run dev          # terminal 1: Next.js
npm run worker:dev   # terminal 2: local analysis worker
```

Local development reads `.env.development.local`. Docker Compose starts both
PostgreSQL and LocalStack; LocalStack provides local S3 and SQS equivalents for
the upload-and-worker flow. During the transition the app can
inherit non-database credentials from the existing `.env.local`; move those to
`.env.development.local` and then remove `.env.local` to make the boundary strict.
Use `.env.development.example` as the local template. Add an `OPENAI_API_KEY` to
run model analysis; the rest of the app works without one.

Production secrets belong in Vercel's Production environment, using
`.env.production.example` as the checklist. Never create or commit a populated
production env file. `OPENAI_API_KEY` belongs only to the ECS worker.
Production analysis endpoints also require Upstash Redis for shared rate
limiting; local development uses an in-memory limiter automatically.

Database commands are environment-specific:

```sh
npm run db:local:up          # start local PostgreSQL + LocalStack
npm run db:migrate           # alias for db:migrate:local
npm run worker:dev           # consume jobs from local SQS in another terminal
npm run db:local:down        # stop services; PostgreSQL data is preserved

# Deliberately guarded; normally run this in deployment CI.
CONFIRM_PRODUCTION_MIGRATION=1 npm run db:migrate:production
```

The deterministic report works without the local AWS services or worker.

The production analysis architecture and AWS deployment sequence are documented
in [`docs/aws-analysis.md`](docs/aws-analysis.md).

To get an export: Telegram Desktop → the chat → ⋮ → Export chat history → JSON.

## Scripts

| Command | What it does |
| --- | --- |
| `npm test` | the suite (`vitest`) |
| `npm run report <export.json>` | the deterministic analysis, in the terminal |
| `npm run deck <export.json>` | the cards the report would build |
| `npm run wrapped <export.json> --out saved.json` | runs the model, saves the payload |
| `npm run render <export.json> <saved.json> --html out.html` | renders the real deck to HTML and checks it |
| `npm run cache-probe` | prompt-cache behaviour, on synthetic data |

`render` is the interesting one: it re-renders the deck from a saved run and fails
on the things a screenshot wouldn't show you — a screen that rendered nothing, a
template hole that filled with `undefined`, a citation whose highlight no longer
resolves, the same message quoted on two cards.

## Stack

Next.js 16 (App Router) · React 19 · Tailwind 4 · Prisma 7 + Postgres · Auth.js ·
TypeScript · Vitest.

Not affiliated with Telegram.
