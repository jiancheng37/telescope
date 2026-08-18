/**
 * Finds out what actually breaks prompt caching between two calls.
 *
 * The pipeline sends the same ~110k-token payload three times and should pay for it
 * once. It doesn't: the second live run reported 0 cached tokens on all three calls,
 * and the first reported exactly one call's worth — so the aggregate from a real run
 * is not a measurement, it's a rumour. This isolates one variable at a time.
 *
 * Synthetic payload on purpose. The real corpus contains a passport number, and
 * this question has nothing to do with its contents — only its size, which needs to
 * clear the ~1024-token minimum for caching to engage at all.
 *
 *   npx tsx --env-file-if-exists=.env.local scripts/cache-probe.ts
 *
 * Each probe is two sequential calls with an identical leading payload. The second
 * call's `cached_tokens` is the whole result: nonzero means the prefix survived
 * whatever was varied, zero means that variable is part of the cache key.
 */
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import * as z from "zod";
import { MODEL } from "../src/llm/run";

const client = new OpenAI();

/**
 * ~6k tokens of filler shaped like the real payload — short `#seq label: text`
 * lines, since that shape is why the real corpus tokenises at 2.6 chars/token.
 * Deterministic so every call in every probe sends byte-identical text.
 */
const payload = Array.from({ length: 1200 }, (_, i) => {
  const who = i % 2 === 0 ? "alpha" : "beta";
  const words = ["ok", "wait", "im coming", "did u eat", "sian", "later can", "yes", "no lah"];
  return `#${i + 1} ${who}: ${words[i % words.length]} ${i}`;
}).join("\n");

const Small = z.object({ answer: z.string() });
const Other = z.object({ verdict: z.string(), score: z.number().int() });

interface Call {
  label: string;
  schema: z.ZodType;
  maxOutput: number;
  /** the trailing per-call instruction, i.e. everything after the shared payload */
  task: string;
  /** where the shared payload goes; the pipeline currently uses "input" */
  where?: "input" | "instructions";
}

async function once(c: Call, cacheKey: string) {
  const inInstructions = c.where === "instructions";
  const r = await client.responses.create({
    model: MODEL,
    max_output_tokens: c.maxOutput,
    prompt_cache_key: cacheKey,
    ...(inInstructions ? { instructions: payload } : {}),
    input: inInstructions
      ? [{ role: "user" as const, content: c.task }]
      : [
          { role: "user" as const, content: payload },
          { role: "user" as const, content: c.task },
        ],
    text: { format: zodTextFormat(c.schema, c.label) },
  });
  return {
    input: r.usage?.input_tokens ?? 0,
    cached: r.usage?.input_tokens_details?.cached_tokens ?? 0,
  };
}

const base: Call = { label: "small", schema: Small, maxOutput: 2000, task: "Reply with the word ok." };

/**
 * Each probe varies exactly one thing between call 1 and call 2. Probe 1 is the
 * control: if its second call doesn't hit, nothing below means anything.
 */
const probes: Array<{ name: string; first?: Call; second: Call }> = [
  // If even this misses, caching isn't engaging for this model or account and
  // nothing below it is a statement about prefixes.
  { name: "floor — the identical request, twice", second: base },
  { name: "control — only the trailing message differs", second: { ...base, task: "Reply with the word fine." } },
  { name: "different response schema", second: { ...base, schema: Other, label: "other", task: "Reply with the word fine." } },
  { name: "different max_output_tokens", second: { ...base, maxOutput: 4000, task: "Reply with the word fine." } },
  // The candidate fix. If the shared payload sits in `instructions` instead of as
  // the first input message, a varying trailing message may leave it cacheable.
  {
    name: "payload in `instructions`, trailing message differs",
    first: { ...base, where: "instructions" },
    second: { ...base, where: "instructions", task: "Reply with the word fine." },
  },
];

console.log(`model ${MODEL}, payload ~${Math.round(payload.length / 2.6).toLocaleString()} tokens\n`);

for (const [i, probe] of probes.entries()) {
  // A distinct key per probe so probes can't warm each other's cache — the point
  // is to observe one write and one read, not a pool that everything hits.
  const key = `telescope-probe-${i}`;
  const first = await once(probe.first ?? base, key);
  const second = await once(probe.second, key);
  const verdict = second.cached > 0 ? "HIT — prefix survived" : "MISS — this is part of the cache key";
  console.log(`${probe.name}`);
  console.log(`  call 1: ${first.input.toLocaleString()} in, ${first.cached.toLocaleString()} cached`);
  console.log(`  call 2: ${second.input.toLocaleString()} in, ${second.cached.toLocaleString()} cached  → ${verdict}\n`);
}
