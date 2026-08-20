/**
 * The only endpoint, and the only place the conversation leaves the browser.
 *
 * It re-parses the export server-side rather than accepting a pre-built corpus: the
 * payload sent to the model has to be built from the same code path the CLI uses,
 * and a client that can hand over an arbitrary corpus is a client that can put
 * anything in the prompt.
 */
import { NextResponse } from "next/server";
import { ParseError, analyze } from "@/domain";
import { runWrapped } from "@/llm/run";
import { toWire } from "@/ui/wire";
import type { WrappedStreamEvent } from "@/ui/wire";
import { auth } from "@/auth";
import { completeReport, releaseReport, reserveReport } from "@/lib/reports";

/** The three calls are long. Vercel's default of 10s would kill every one of them. */
export const maxDuration = 800;

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Sign in with Google to use the written analysis." },
      { status: 401 },
    );
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY isn't set on the server, so the written half can't run." },
      { status: 503 },
    );
  }

  let raw: unknown;
  let participantNames: [string, string] | null = null;
  try {
    raw = await request.json();
    if (raw && typeof raw === "object" && "export" in raw) {
      const wrapped = raw as { export: unknown; participants?: unknown };
      raw = wrapped.export;
      if (Array.isArray(wrapped.participants) && wrapped.participants.length === 2 && wrapped.participants.every((name) => typeof name === "string" && name.trim())) {
        participantNames = [wrapped.participants[0].trim().slice(0, 20), wrapped.participants[1].trim().slice(0, 20)];
      }
    }
  } catch {
    return NextResponse.json({ error: "That wasn't valid JSON." }, { status: 400 });
  }

  let parsed, analysis;
  try {
    ({ parsed, analysis } = analyze(raw));
    if (participantNames) {
      parsed.chat.participants = participantNames;
      analysis.chat.participants = participantNames;
    }
  } catch (err) {
    // A ParseError is the user's file being wrong, which is a 400 and worth
    // repeating back verbatim — those messages say which field was missing.
    if (err instanceof ParseError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }

  const savedReportId = request.headers.get("x-report-id") ?? undefined;
  const reportId = await reserveReport(session.user.id, analysis, savedReportId);
  if (!reportId) {
    return NextResponse.json(
      { error: "This saved report already has a model-assisted reading or is currently being processed." },
      { status: 409 },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: WrappedStreamEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // The browser went away. The OpenAI request may still finish, but there
          // is no response stream left to update.
          open = false;
        }
      };

      try {
        send({ type: "progress", note: "Upload received — preparing the conversation" });
        const result = await runWrapped(parsed, analysis, {
          onProgress: (note) => {
            console.log(`[wrapped] ${note}`);
            send({ type: "progress", note });
          },
        });
        const payload = toWire(result);
        await completeReport(reportId, session.user.id, analysis, payload);
        send({ type: "result", payload });
      } catch (err) {
        // Once streaming starts the HTTP status is already 200, so failures are
        // explicit protocol events rather than late JSON error responses.
        const message = err instanceof Error ? err.message : "The reading failed.";
        console.error("[wrapped]", err);
        await releaseReport(reportId, session.user.id).catch((releaseError) => {
          console.error("[wrapped] couldn't release quota reservation", releaseError);
        });
        send({ type: "error", message });
      } finally {
        if (open) controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
