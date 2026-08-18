/**
 * Prints the deck's copy as plain text, straight from a real export.
 *
 * Every card headline and body interpolates numbers, and a sentence that reads fine
 * with one chat's numbers ("47 photos") can read badly with another's ("1 photos")
 * or be flatly wrong ("who went quiet is close to even" on a chat where it isn't).
 * Rendering the React tree to check that is far slower than reading it here.
 *
 *   npm run deck -- path/to/result.json
 */
import { readFileSync } from "node:fs";
import { analyze } from "../src/domain";
import { buildDeck } from "../src/ui/cards";

const path = process.argv[2];
if (!path) {
  console.error("usage: npm run deck -- <result.json>");
  process.exit(1);
}

const { analysis } = analyze(JSON.parse(readFileSync(path, "utf8")));
const deck = buildDeck(analysis);

for (const card of deck) {
  console.log(`\n\x1b[2m─── ${card.kicker.toUpperCase()} [${card.id}]\x1b[0m`);
  console.log(`\x1b[1m${card.headline}\x1b[0m`);
  console.log(card.detail);
  switch (card.kind) {
    case "stat":
      for (const s of card.splits) console.log(`    ${s.label}: ${s.a} / ${s.b}`);
      break;
    case "words":
      console.log(`    ${analysis.chat.participants[0]}: ${card.words.a.map((w) => w.word).join(", ")}`);
      console.log(`    ${analysis.chat.participants[1]}: ${card.words.b.map((w) => w.word).join(", ")}`);
      break;
    case "timeline":
      for (const c of card.chapters) {
        console.log(
          c.kind === "era"
            ? `    era     ${c.messageCount} msgs, ${c.months}mo${c.quiet ? " (lull)" : ""}`
            : `    silence ${c.days.toFixed(0)} days`,
        );
      }
      break;
    case "flat":
      for (const t of card.items) console.log(`    · ${t}`);
      break;
  }
}
console.log(`\n${deck.length} cards.`);
