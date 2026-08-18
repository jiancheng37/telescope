/**
 * Flags message bodies that look like they carry an identity document, a number
 * someone can be charged on, or an address.
 *
 * Deliberately noisy — this is a review aid before the payload leaves the machine,
 * and a false positive costs a glance while a false negative costs a passport
 * number sitting in someone's logs. Prints seq handles so a hit can be found again.
 */
import { readFileSync } from "node:fs";
import { parseExport } from "../src/domain";
import { buildCorpus } from "../src/llm/corpus";

const PATTERNS: Array<[string, RegExp]> = [
  ["passport-like", /\b[A-Z]{1,2}\d{6,9}[A-Z]?\b/],
  ["nric/fin-like", /\b[STFGM]\d{7}[A-Z]\b/i],
  ["long digit run", /\b\d{8,}\b/],
  ["card-like", /\b(?:\d[ -]?){13,19}\b/],
  ["phone", /(?:\+\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?){2,4}\d{3,4}\b/],
  ["email", /[\w.+-]+@[\w-]+\.[\w.]{2,}/],
  ["postal/address", /\b(?:blk|block|unit|#\d{2}-\d{2,4})\b/i],
  ["iban/acct", /\b(?:acct|account|iban|swift)\b[^\n]{0,30}\d{5,}/i],
  ["otp/password", /\b(?:otp|password|passcode|pin)\b[^\n]{0,24}\d{4,}/i],
];

const path = process.argv[2];
if (!path) {
  console.error("usage: npm run scan -- <result.json>");
  process.exit(1);
}

const corpus = buildCorpus(parseExport(JSON.parse(readFileSync(path, "utf8"))));
const hits = new Map<string, number>();
let flagged = 0;

for (const line of corpus.lines) {
  const matched = PATTERNS.filter(([, re]) => re.test(line.body)).map(([name]) => name);
  if (!matched.length) continue;
  flagged++;
  for (const m of matched) hits.set(m, (hits.get(m) ?? 0) + 1);
  console.log(`#${line.seq} [${matched.join(", ")}] ${line.who === 0 ? corpus.labels[0] : corpus.labels[1]}`);
  console.log(`   ${line.body.slice(0, 220)}`);
}

console.log(`\n${flagged} of ${corpus.lines.length} lines flagged`);
for (const [k, n] of [...hits].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${n}`);
