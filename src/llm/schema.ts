/**
 * Structured output shapes for the two LLM passes.
 *
 * Kept deliberately flat — no unions, no optionals, no nested records. Structured
 * outputs constrain generation against this schema, and every degree of freedom
 * here is one more way for a response to be shaped right and still be unusable.
 */
import * as z from "zod";

/**
 * A pointer into the payload. `seq` is the `#n` the model saw; `quote` is the
 * text it believes is there. Both are required because the quote is what makes
 * the citation checkable — a seq alone can't be wrong, and a card whose quote
 * isn't in the message it points at is a card that made something up.
 */
export const Evidence = z.object({
  seq: z.number().int().describe("the #n of the message being cited"),
  quote: z
    .string()
    .describe("text copied verbatim from that message, or a contiguous fragment of it"),
});
export type Evidence = z.infer<typeof Evidence>;

export const SIDE = z.enum(["a", "b", "both", "neither"]);

export const Card = z.object({
  id: z.string().describe("short kebab-case slug, unique across all cards"),
  metric: z
    .string()
    .describe(
      "the metric key of the brief finding this card is about, copied verbatim from the backticked " +
        "word at the start of that line — e.g. 'turn-taking', 'revival', 'register'. Not a description.",
    ),
  headline: z.string().describe("under 60 characters, no trailing period"),
  body: z
    .string()
    .describe("one or two sentences saying what the number means in this specific chat"),
  about: SIDE.describe("which of the two this is about, or both"),
  evidence: z.array(Evidence).min(1).max(3).describe("1 to 3 citations that show it"),
});
export type Card = z.infer<typeof Card>;

export const EraCard = z.object({
  chapterIndex: z.number().int().describe("1-based index of the chapter in the brief's timeline"),
  name: z.string().describe("what to call this era, under 40 characters"),
  body: z.string().describe("two or three sentences on what this stretch was"),
  evidence: z.array(Evidence).min(2).max(3).describe("2 to 3 citations from inside this stretch"),
});
export type EraCard = z.infer<typeof EraCard>;

export const SilenceCard = z.object({
  chapterIndex: z.number().int(),
  body: z
    .string()
    .describe("what the last messages before it and first messages after it show, without speculating on why"),
  evidence: z.array(Evidence).min(2).max(3).describe("2 to 3 citations, ideally from both sides of the gap"),
});
export type SilenceCard = z.infer<typeof SilenceCard>;

export const Naming = z.object({
  aCallsB: z.string().describe("what side a actually calls side b, verbatim; empty string if nothing"),
  bCallsA: z.string().describe("what side b actually calls side a, verbatim; empty string if nothing"),
  evidence: z.array(Evidence),
});

export const Motif = z.object({
  id: z.string().describe("short kebab-case slug"),
  name: z.string().describe("the running joke, shared reference or recurring ritual, under 40 characters"),
  body: z.string().describe("one or two sentences"),
  evidence: z.array(Evidence).min(2).max(4).describe("2 to 4 citations spread across the timeline"),
});
export type Motif = z.infer<typeof Motif>;

export const TOPIC_CATEGORY = z.enum([
  "daily-life", "work-or-school", "planning", "friends-and-family", "entertainment",
  "food", "travel", "health", "money", "emotional-support", "relationship-discussion",
  "conflict", "humour", "reminiscing", "current-events", "other",
]);

export const Topic = z.object({
  id: z.string().describe("short kebab-case slug"),
  category: TOPIC_CATEGORY,
  label: z.string().describe("conversation-specific topic label, under 45 characters"),
  summary: z.string().describe("one sentence describing how this topic appears in this conversation"),
  chapterIndexes: z.array(z.number().int()).describe("1-based chapters where this topic is especially visible"),
  evidence: z.array(Evidence).min(2).max(4).describe("2 to 4 citations spread across its appearances"),
});
export type Topic = z.infer<typeof Topic>;

export const DYNAMIC_CATEGORY = z.enum([
  "conversation-initiation", "topic-expansion", "question-and-response", "vulnerability",
  "emotional-validation", "advice", "practical-support", "humour-and-teasing", "affection",
  "planning-and-decisions", "disagreement", "escalation", "repair", "redirection",
  "boundary-expression", "reconnection",
]);

export const Dynamic = z.object({
  id: z.string().describe("short kebab-case slug"),
  category: DYNAMIC_CATEGORY,
  headline: z.string().describe("specific interaction pattern, under 65 characters"),
  body: z.string().describe("one or two sentences describing what each person does in this interaction"),
  roleA: z.string().describe("side a's observable role in this pattern, under 30 characters"),
  roleB: z.string().describe("side b's observable role in this pattern, under 30 characters"),
  evidence: z.array(Evidence).min(2).max(4).describe("2 to 4 citations showing the repeated pattern"),
  counterEvidence: z.array(Evidence).max(2).describe("0 to 2 citations where the pattern does not hold"),
});
export type Dynamic = z.infer<typeof Dynamic>;

export const CharacterRole = z.object({
  id: z.string().describe("short kebab-case slug, unique across both people"),
  title: z.string().describe("short playful role title grounded in repeated conversational behaviour, under 40 characters"),
  description: z.string().describe("one sentence explaining how this role appears in this specific conversation"),
  evidence: z.array(Evidence).min(2).max(3).describe("2 to 3 citations showing the role on separate occasions"),
});
export type CharacterRole = z.infer<typeof CharacterRole>;

export const CharacterRoles = z.object({
  a: z.array(CharacterRole).min(1).max(2).describe("1 or 2 strongest roles for side a"),
  b: z.array(CharacterRole).min(1).max(2).describe("1 or 2 strongest roles for side b"),
});

export const LanguageInsight = z.object({
  candidateId: z.string().describe("exact candidate id from the language dossier"),
  text: z.string().describe("exact candidate text, copied without alteration"),
  category: z.enum(["signature-word", "signature-phrase", "verbal-crutch", "distinctive-spelling", "shared-expression", "borrowed-language", "recurring-callback"]),
  explanation: z.string().describe("one short sentence explaining its conversational job without inventing intent"),
  evidence: z.array(Evidence).min(1).max(3),
});
export type LanguageInsight = z.infer<typeof LanguageInsight>;

export const LanguageSelection = z.object({
  a: z.array(LanguageInsight).max(5).describe("0 to 5 strong language fingerprints for side a; omit rather than use generic language"),
  b: z.array(LanguageInsight).max(5).describe("0 to 5 strong language fingerprints for side b; omit rather than use generic language"),
  shared: z.array(LanguageInsight).max(3).describe("0 to 3 expressions that became shared language"),
});

export const WildSentence = z.object({
  candidateId: z.string().describe("exact wild-candidate id from the dossier"),
  category: z.enum(["out-of-context-masterpiece", "unreasonable-declaration", "unexpected-question", "sudden-escalation", "suspiciously-specific", "accidental-poetry", "perfect-response"]),
  explanation: z.string().describe("one dry sentence explaining why the line lands in context, under 120 characters"),
  evidence: z.array(Evidence).min(1).max(1).describe("the candidate message itself, quoted verbatim"),
});
export type WildSentence = z.infer<typeof WildSentence>;

export const ReadingOutput = z.object({
  eras: z.array(EraCard),
  silences: z.array(SilenceCard),
  findings: z.array(Card).min(5).max(9).describe("5 to 9 cards, strongest first"),
  motifs: z.array(Motif).max(4).describe("0 to 4; omit rather than reach"),
  topics: z.array(Topic).min(3).max(6).describe("3 to 6 recurring topics, most prominent first"),
  dynamics: z.array(Dynamic).min(3).max(6).describe("3 to 6 repeated interaction patterns, strongest first"),
  roles: CharacterRoles.describe("AI-identified conversational roles, strongest role first for each person"),
  language: LanguageSelection.describe("Curate only from the full-corpus language candidate dossier"),
  wildSentences: z.array(WildSentence).max(8).describe("0 to 8 genuinely wild lines; omit rather than use serious or merely profane messages"),
  naming: Naming,
});
export type ReadingOutput = z.infer<typeof ReadingOutput>;

// ------------------------------------------------------------------- verdict

export const VerdictCandidate = z.object({
  text: z.string().describe("the verdict itself; aim for under 50 characters"),
  derivedFrom: z
    .array(z.string())
    .describe("ids of the findings, motifs or eras this rests on — at least one"),
  rationale: z.string().describe("one sentence: which evidence makes this true"),
});
export type VerdictCandidate = z.infer<typeof VerdictCandidate>;

export const VerdictCandidates = z.object({
  candidates: z.array(VerdictCandidate).describe("8 to 10, genuinely different from each other"),
});

/**
 * The judge's checks. Each is phrased so that `true` is the failure, because a
 * judge asked "is this good?" says yes, and a judge asked "is this transferable,
 * is this aimed at a person, does it flinch at the end" has to look.
 */
export const Judgement = z.object({
  index: z.number().int().describe("0-based index into the candidate list"),
  transferable: z
    .boolean()
    .describe("true if this could describe a different pair of people just as well"),
  aimedAtPerson: z
    .boolean()
    .describe("true if it characterises one of them rather than the pattern between them"),
  redemptiveClause: z
    .boolean()
    .describe("true if it softens itself at the end — 'but they always come back', 'and that's okay'"),
  therapyVocabulary: z
    .boolean()
    .describe("true if it uses words like attachment, avoidant, boundaries, holding space, validation"),
  crossesRedLine: z
    .boolean()
    .describe("true if it touches a breakup, a death, mental health, sexuality, or illness"),
  unsupported: z.boolean().describe("true if the evidence cited does not actually support it"),
  sharpness: z.number().int().describe("1 to 5; 5 is a line they would screenshot"),
  note: z.string().describe("one sentence explaining the lowest-scoring judgement above"),
});
export type Judgement = z.infer<typeof Judgement>;

export const JudgeOutput = z.object({
  judgements: z.array(Judgement).describe("exactly one per candidate, in order"),
  winner: z.number().int().describe("0-based index of the best candidate that fails no check"),
  winnerReason: z.string().describe("one sentence"),
});
export type JudgeOutput = z.infer<typeof JudgeOutput>;
