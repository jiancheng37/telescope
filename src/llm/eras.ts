import OpenAI from "openai";
import type { Analysis, Chapter, Message } from "../domain/types";
import type { Parsed } from "../domain/parse";
import { buildChapters, SESSION_GAP_MIN, weekStart, type WeekSemantics } from "../domain/sessions";

const EMBEDDING_MODEL = process.env.TELESCOPE_EMBEDDING_MODEL ?? "text-embedding-3-small";
const MAX_SESSION_CHARS = 6_000;
const BATCH_SIZE = 128;

interface EmbeddedSession {
  startTs: number;
  endTs: number;
  firstMessageId: number;
  lastMessageId: number;
  weight: number;
  embedding: number[];
}

export interface SemanticEraResult {
  chapters: Chapter[];
  representativeMessageIds: number[];
  inputTokens: number;
  calls: number;
  model: string;
}

function sessionGroups(messages: Message[]): Message[][] {
  if (!messages.length) return [];
  const groups: Message[][] = [[messages[0]]];
  for (const message of messages.slice(1)) {
    const current = groups[groups.length - 1];
    if (message.ts - current[current.length - 1].ts > SESSION_GAP_MIN * 60) groups.push([message]);
    else current.push(message);
  }
  return groups;
}

function sessionText(messages: Message[], names: [string, string]): string {
  const rendered = messages
    .map((message) => {
      const body = message.text.trim() ||
        (message.attachment === "photo" ? "[photo]" : message.mediaType === "sticker" ? `[sticker ${message.stickerEmoji ?? ""}]` : "[media]");
      return `${names[message.who]}: ${body.replace(/\s+/g, " ")}`;
    })
    .join("\n");
  if (rendered.length <= MAX_SESSION_CHARS) return rendered;
  const half = Math.floor((MAX_SESSION_CHARS - 30) / 2);
  return `${rendered.slice(0, half)}\n[session shortened]\n${rendered.slice(-half)}`;
}

function weightedMean(items: Array<{ embedding: number[]; weight: number }>): number[] {
  if (!items.length) return [];
  const total = items.reduce((n, item) => n + item.weight, 0) || 1;
  return items[0].embedding.map((_, dimension) =>
    items.reduce((n, item) => n + (item.embedding[dimension] ?? 0) * item.weight, 0) / total,
  );
}

function cosineDistance(a: number[], b: number[]): number {
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
  return aa && bb ? 1 - dot / Math.sqrt(aa * bb) : 1;
}

/**
 * Embed conversation sessions, aggregate them into weekly semantic vectors, and
 * rerun the deterministic detector with that extra channel. Raw text and vectors
 * live only for this request; the report stores boundaries and evidence ids.
 */
export async function buildSemanticEras(
  parsed: Parsed,
  analysis: Analysis,
  client: OpenAI,
  onProgress: (note: string) => void,
): Promise<SemanticEraResult> {
  const groups = sessionGroups(parsed.messages);
  const prepared = groups
    .map((messages) => ({ messages, text: sessionText(messages, analysis.chat.participants) }))
    .filter((item) => item.text.trim().length > 0);
  const embedded: EmbeddedSession[] = [];
  let inputTokens = 0;
  let calls = 0;

  onProgress(`mapping ${prepared.length.toLocaleString()} conversation sessions into weekly themes`);
  for (let offset = 0; offset < prepared.length; offset += BATCH_SIZE) {
    const batch = prepared.slice(offset, offset + BATCH_SIZE);
    const response = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: batch.map((item) => item.text),
      encoding_format: "float",
      dimensions: 256,
    });
    calls++;
    inputTokens += response.usage?.prompt_tokens ?? response.usage?.total_tokens ?? 0;
    response.data.forEach((datum, index) => {
      const source = batch[index];
      if (!source) return;
      const messages = source.messages;
      embedded.push({
        startTs: messages[0].ts,
        endTs: messages[messages.length - 1].ts,
        firstMessageId: messages[0].id,
        lastMessageId: messages[messages.length - 1].id,
        weight: Math.max(1, Math.min(source.text.length, MAX_SESSION_CHARS)),
        embedding: datum.embedding,
      });
    });
  }

  const byWeek = new Map<number, EmbeddedSession[]>();
  for (const session of embedded) {
    const key = weekStart(session.startTs);
    const found = byWeek.get(key);
    if (found) found.push(session); else byWeek.set(key, [session]);
  }
  const semantics: WeekSemantics[] = [...byWeek].map(([weekTs, sessions]) => ({
    weekTs,
    embedding: weightedMean(sessions),
  }));
  const chapters = buildChapters(parsed.messages, semantics);

  // Typical sessions explain what an era contained. Boundary windows are added
  // separately by the corpus sampler, so these anchors cover both typicality and change.
  const representativeMessageIds = new Set<number>();
  for (const chapter of chapters) {
    if (chapter.kind !== "era" || chapter.quiet) continue;
    const candidates = embedded.filter((session) => session.startTs <= chapter.endTs && session.endTs >= chapter.startTs);
    const centroid = weightedMean(candidates);
    candidates
      .map((session) => ({ session, distance: cosineDistance(session.embedding, centroid) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 5)
      .forEach(({ session }) => {
        representativeMessageIds.add(session.firstMessageId);
        representativeMessageIds.add(session.lastMessageId);
      });
  }

  onProgress(`semantic timeline: ${chapters.filter((chapter) => chapter.kind === "era" && !chapter.quiet).length} eras from ${semantics.length} active weeks`);
  return { chapters, representativeMessageIds: [...representativeMessageIds], inputTokens, calls, model: EMBEDDING_MODEL };
}
