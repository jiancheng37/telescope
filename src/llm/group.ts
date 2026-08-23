import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import * as z from "zod";
import type { GroupAnalysis, ParsedGroup } from "@/domain/group";
import type { Chapter } from "@/domain/types";
import { MODEL, EFFORT, type Usage } from "./run";
import { buildGroupSemanticEras } from "./eras";

const Evidence = z.object({ seq: z.number().int(), quote: z.string() });
const GroupReading = z.object({
  topics: z.array(z.object({ id: z.string(), label: z.string(), summary: z.string(), evidence: z.array(Evidence).min(2).max(4) })).min(3).max(6),
  roles: z.array(z.object({ participantId: z.string(), title: z.string(), description: z.string(), evidence: z.array(Evidence).min(2).max(4) })).min(2).max(8),
  eras: z.array(z.object({
    chapterIndex: z.number().int().positive(),
    label: z.string().describe("a short, contextual chapter title the group would recognize; never a date or date range"),
    summary: z.string(),
    evidence: z.array(Evidence).min(2).max(4),
  })).max(6),
  lore: z.array(z.object({ id: z.string(), label: z.string(), explanation: z.string(), evidence: z.array(Evidence).min(2).max(4) })).min(2).max(6),
  wildTexts: z.array(z.object({ seq: z.number().int(), quote: z.string(), reason: z.string() })).min(5).max(5),
});

export interface GroupAiPayload {
  kind: "group-ai";
  topics?: Array<{ id: string; label: string; summary: string; evidenceMessageIds: number[] }>;
  /** Kept for group readings generated before Topics replaced Recurring themes. */
  themes?: Array<{ id: string; label: string; summary: string; evidenceMessageIds: number[] }>;
  roles: Array<{ participantId: string; title: string; description: string; evidenceMessageIds: number[] }>;
  /** Kept only so older saved readings remain readable; no new dynamics are generated. */
  dynamics?: Array<{ id: string; headline: string; body: string; participantIds: string[]; evidenceMessageIds: number[] }>;
  eras: Array<{ chapterIndex?: number; id?: string; label: string; summary: string; evidenceMessageIds: number[] }>;
  eraChapters?: Chapter[];
  lore: Array<{ id: string; label: string; explanation: string; evidenceMessageIds: number[] }>;
  wildTexts: Array<{ messageId: number; participantId: string; body: string; reason: string }>;
  droppedCount: number;
  model: string;
  usage: Usage;
}

const normalize = (value: string) => value.toLocaleLowerCase().replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();

function sampledMessages(parsed: ParsedGroup, anchors: ReadonlySet<number> = new Set(), limit = 1_200) {
  const messages = parsed.messages.filter((message) => message.text.trim());
  if (messages.length <= limit) return messages;
  const selected = new Set<number>();
  messages.forEach((message, index) => { if (anchors.has(message.id)) selected.add(index); });
  const edge = Math.min(80, Math.floor(limit / 5));
  for (let index = 0; index < edge; index++) { selected.add(index); selected.add(messages.length - 1 - index); }
  const remaining = limit - selected.size;
  for (let index = 0; index < remaining; index++) selected.add(Math.floor((index / Math.max(1, remaining - 1)) * (messages.length - 1)));
  return [...selected].sort((a, b) => a - b).map((index) => messages[index]);
}

export async function runGroupReading(parsed: ParsedGroup, analysis: GroupAnalysis, options: { apiKey?: string; model?: string; onProgress?: (note: string) => void } = {}): Promise<GroupAiPayload> {
  const client = new OpenAI({ apiKey: options.apiKey ?? process.env.OPENAI_API_KEY });
  const model = options.model ?? MODEL;
  const note = options.onProgress ?? (() => {});
  const eraResult = await buildGroupSemanticEras(parsed, client, note);
  const sample = sampledMessages(parsed, new Set(eraResult.representativeMessageIds));
  const bySeq = new Map(sample.map((message, index) => [index + 1, message]));
  const participantList = analysis.participants.map((person) => `${person.id}: ${person.name} (${person.messages.toLocaleString()} messages, ${(person.share * 100).toFixed(1)}%)`).join("\n");
  const corpus = sample.map((message, index) => `#${index + 1} [${new Date(message.ts * 1000).toISOString()}] <${message.participantId}> ${message.text}`).join("\n");
  const numeric = `Group: ${analysis.chat.name}\nMessages: ${analysis.totalMessages}\nActive days: ${analysis.span.activeDays}\nParticipants:\n${participantList}\nTop reply links:\n${analysis.replyPairs.slice(0, 12).map((pair) => `${pair.fromId} -> ${pair.toId}: ${pair.count}`).join("\n")}`;
  const eraCandidates = eraResult.chapters.map((chapter, index) => ({ chapter, index: index + 1 })).filter((item): item is { chapter: Extract<Chapter, { kind: "era" }>; index: number } => item.chapter.kind === "era" && !item.chapter.quiet);
  const eraBrief = eraCandidates.map(({ chapter, index }) => `Era ${index}: ${new Date(chapter.startTs * 1000).toISOString()} to ${new Date(chapter.endTs * 1000).toISOString()} · ${chapter.messageCount} messages`).join("\n");
  note(`reading representative group sample: ${sample.length.toLocaleString()}/${parsed.messages.length.toLocaleString()} messages with ${model}`);
  const response = await client.responses.parse({
    model,
    reasoning: { effort: EFFORT },
    max_output_tokens: 12_000,
    input: [
      { role: "developer", content: "You analyze one Telegram group conversation. Describe observable patterns in this group only. Do not diagnose, infer private traits, rank human worth, or use therapy vocabulary. Roles are conversational roles, not personalities. Use participantId values exactly as supplied. Every claim requires verbatim evidence copied from the numbered corpus. Era boundaries are fixed by weekly behavioral and semantic change detection: never move, merge or invent them. Name every supplied era like a contextual chapter title the people in this group would recognize from what actually happened or changed. An era name must not be a date, date range, numbered era, or generic life phase; dates are already shown separately in the report. Prefer omission to weak or generic claims." },
      { role: "user", content: `# Numerical brief\n${numeric}\n\n# Fixed era candidates\n${eraBrief || "No era candidates cleared the detector."}\n\n# Representative messages\n${corpus}\n\nProduce the strongest recurring topics, participant-specific conversational roles, names and summaries for the fixed eras, recurring group lore, and exactly five surprising self-contained wild texts for a guess-who-said-it game.` },
    ],
    text: { format: zodTextFormat(GroupReading, "group_reading") },
  });
  const parsedOutput = response.output_parsed;
  if (!parsedOutput) throw new Error("The group reading returned nothing parseable.");
  const participantIds = new Set(analysis.participants.map((person) => person.id));
  let droppedCount = 0;
  const evidenceIds = (items: Array<z.infer<typeof Evidence>>) => {
    const ids = items.flatMap((item) => {
      const message = bySeq.get(item.seq);
      return message && normalize(message.text).includes(normalize(item.quote)) && normalize(item.quote).length >= 3 ? [message.id] : [];
    });
    return [...new Set(ids)];
  };
  const topics = parsedOutput.topics.flatMap((item) => { const ids = evidenceIds(item.evidence); if (ids.length < 2) { droppedCount++; return []; } return [{ id: item.id, label: item.label, summary: item.summary, evidenceMessageIds: ids }]; });
  const roles = parsedOutput.roles.flatMap((item) => { const ids = evidenceIds(item.evidence); if (!participantIds.has(item.participantId) || ids.length < 2) { droppedCount++; return []; } return [{ participantId: item.participantId, title: item.title, description: item.description, evidenceMessageIds: ids }]; });
  const eraByIndex = new Map(eraCandidates.map((item) => [item.index, item.chapter]));
  const messageById = new Map(parsed.messages.map((message) => [message.id, message]));
  const eras = parsedOutput.eras.flatMap((item) => { const chapter = eraByIndex.get(item.chapterIndex); const ids = evidenceIds(item.evidence); const inside = chapter && ids.filter((id) => { const message = messageById.get(id); return message && message.ts >= chapter.startTs && message.ts <= chapter.endTs; }); if (!chapter || !inside || inside.length < 2) { droppedCount++; return []; } return [{ chapterIndex: item.chapterIndex, label: item.label, summary: item.summary, evidenceMessageIds: inside }]; });
  const lore = parsedOutput.lore.flatMap((item) => { const ids = evidenceIds(item.evidence); if (ids.length < 2) { droppedCount++; return []; } return [{ id: item.id, label: item.label, explanation: item.explanation, evidenceMessageIds: ids }]; });
  const wildTexts = parsedOutput.wildTexts.flatMap((item) => { const message = bySeq.get(item.seq); if (!message || !participantIds.has(message.participantId) || !normalize(message.text).includes(normalize(item.quote))) { droppedCount++; return []; } return [{ messageId: message.id, participantId: message.participantId, body: message.text, reason: item.reason }]; }).slice(0, 5);
  if (!topics.length && !roles.length) throw new Error("The group reading had no claims with verifiable evidence.");
  const usage: Usage = { inputTokens: eraResult.inputTokens, cachedTokens: 0, outputTokens: 0, reasoningTokens: 0, calls: 1 + eraResult.calls };
  if (response.usage) {
    const cached = response.usage.input_tokens_details?.cached_tokens ?? 0;
    usage.inputTokens += Math.max(0, response.usage.input_tokens - cached);
    usage.cachedTokens = cached;
    usage.outputTokens = response.usage.output_tokens;
    usage.reasoningTokens = response.usage.output_tokens_details?.reasoning_tokens ?? 0;
  }
  note(`group reading: ${topics.length} topics, ${roles.length} roles, ${eras.length} eras, ${droppedCount} dropped`);
  return { kind: "group-ai", topics, roles, eras, eraChapters: eraResult.chapters, lore, wildTexts, droppedCount, model, usage };
}
