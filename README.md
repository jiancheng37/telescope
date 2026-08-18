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
- The written half is the exception, and the UI says so before you opt in: it posts
  the export to `/api/wrapped`, which re-parses it server-side and sends a sampled
  corpus to the OpenAI API.
- Saving a report stores the computed analysis and the model's readings — including
  the messages it quotes — in your own Postgres.

Chat exports and anything derived from one are gitignored (`result.json`,
`ChatExport*/`, `*.wrapped.json`). Keep it that way.

## Running it

```sh
npm install
cp .env.example .env.local     # then fill it in
npm run db:migrate
npm run dev
```

`.env.local` needs `DATABASE_URL`, `AUTH_SECRET` (`npx auth secret`), Google OAuth
credentials for sign-in, and `OPENAI_API_KEY` for the written half. The
deterministic report works without the key.

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
