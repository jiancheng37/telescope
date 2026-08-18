import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Logo } from "@/ui/primitives";
import { signOutCurrentUser } from "@/app/actions/auth";
import { PendingReportSaver } from "./PendingReportSaver";
import { Prisma } from "@/generated/prisma/client";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");

  const reports = await prisma.report.findMany({
      where: { userId: session.user.id, status: { in: ["COMPLETE", "PROCESSING"] }, analysis: { not: Prisma.DbNull } },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, participantA: true, participantB: true, createdAt: true, status: true },
    });

  return (
    <main className="min-h-dvh bg-surface text-ink lg:grid lg:grid-cols-[240px_1fr]">
      <PendingReportSaver />
      <aside className="flex items-center justify-between border-b border-ink/12 px-5 py-5 lg:sticky lg:top-0 lg:h-dvh lg:flex-col lg:items-stretch lg:border-b-0 lg:border-r lg:px-7 lg:py-7">
        <div>
          <Link href="/app" className="flex items-center gap-2.5"><Logo /><span className="font-display text-2xl">Telescope</span></Link>
          <nav className="mt-12 hidden border-t border-ink/12 pt-5 font-mono text-[10px] uppercase tracking-[0.15em] lg:block">
            <span className="block py-2 text-accent">Dashboard</span>
            <Link href="/app/new" className="block py-2 text-ink/42 transition hover:text-ink">New analysis</Link>
          </nav>
        </div>
        <div className="flex items-center gap-4 lg:block">
          <p className="hidden truncate text-sm font-medium lg:block">{session.user.name ?? session.user.email ?? "Your account"}</p>
          <form action={signOutCurrentUser}><button className="font-mono text-[10px] uppercase tracking-[0.15em] text-ink/40 transition hover:text-ink lg:mt-3">Sign out</button></form>
        </div>
      </aside>

      <section className="px-5 py-10 sm:px-10 lg:px-14 lg:py-14 xl:px-20">
        <header className="flex flex-wrap items-end justify-between gap-6 border-b border-ink/14 pb-9">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.17em] text-accent">Workspace</p>
            <h1 className="mt-3 font-display text-[48px] leading-none sm:text-[66px]">Your analyses</h1>
          </div>
          <Link href="/app/new" className="rounded-full bg-night px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-accent">Analyze a conversation</Link>
        </header>

        <div className="grid border-b border-ink/14 py-7 sm:grid-cols-2">
          <div>
            <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-ink/38">Model-assisted readings</p>
            <p className="mt-2 font-display text-[40px] leading-none">Available</p>
          </div>
          <p className="mt-5 max-w-[42ch] text-sm leading-relaxed text-ink/50 sm:mt-0 sm:self-end">Completed model-assisted readings are saved here. Numerical analysis remains free and runs locally.</p>
        </div>

        <section className="pt-10">
          <div className="flex items-baseline justify-between">
            <h2 className="font-display text-[30px]">Saved reports</h2>
            <span className="font-mono text-[10px] text-ink/35">{reports.length} total</span>
          </div>
          {reports.length ? (
            <ol className="mt-5 border-t border-ink/14">
              {reports.map((report, index) => (
                <li key={report.id}>
                  <Link href={`/reports/${report.id}`} className="group grid gap-3 border-b border-ink/14 py-7 transition-colors hover:border-accent sm:grid-cols-[48px_1fr_auto] sm:items-center">
                    <span className="font-mono text-[10px] text-ink/30">{String(index + 1).padStart(2, "0")}</span>
                    <div><h3 className="font-display text-[28px] leading-tight transition duration-300 group-hover:translate-x-1 group-hover:text-accent sm:text-[34px]">{report.participantA} &amp; {report.participantB}</h3>{report.status === "PROCESSING" && <p className="mt-1.5 flex items-center gap-2 font-mono text-[8px] uppercase tracking-[.14em] text-accent"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" /> AI reading in progress</p>}</div>
                    <time className="font-mono text-[10px] uppercase tracking-wide text-ink/35">{report.createdAt.toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" })} →</time>
                  </Link>
                </li>
              ))}
            </ol>
          ) : (
            <div className="mt-5 border-y border-ink/14 py-16">
              <p className="font-display text-3xl">No saved reports yet.</p>
              <p className="mt-3 text-sm text-ink/50">Your first analysis will appear here as soon as it is ready.</p>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
