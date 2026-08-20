import type { Metadata } from "next";
import { IBM_Plex_Mono, Instrument_Sans, Instrument_Serif } from "next/font/google";
import { siteUrl } from "@/lib/site-url";
import "./globals.css";

/**
 * Three faces, three jobs: the serif for anything that is a headline or a
 * number you are meant to feel, the sans for prose, the mono for kickers,
 * axis labels and machine output. Loaded through `next/font` so they are
 * self-hosted — a report page that phones Google for a font is not a report
 * page that "never leaves your machine".
 */
const serif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-instrument-serif",
  display: "swap",
});

const sans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument-sans",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Telescope — Telegram Chat Analysis",
    template: "%s · Telescope",
  },
  description:
    "Analyze a Telegram conversation in your browser to reveal its rhythms, silences, private language, and relationship patterns. Your raw chat stays local.",
  applicationName: "Telescope",
  keywords: [
    "Telegram chat analysis",
    "Telegram conversation analyzer",
    "chat statistics",
    "message analysis",
    "conversation insights",
  ],
  authors: [{ name: "Telescope" }],
  creator: "Telescope",
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "Telescope",
    title: "Telescope — See Your Telegram Conversation Differently",
    description:
      "Turn one Telegram chat into a private, local-first report about its rhythms, silences, language, and patterns.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Telescope — Telegram Chat Analysis",
    description:
      "Turn one Telegram chat into a private, local-first report about its rhythms, silences, language, and patterns.",
  },
};

const themeScript = `try{const p=JSON.parse(localStorage.getItem("telescope:preferences")||"{}");document.documentElement.classList.toggle("telescope-dashboard-dark",p.dashboardDark!==false)}catch{document.documentElement.classList.add("telescope-dashboard-dark")}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${serif.variable} ${sans.variable} ${mono.variable}`}>
      <head><script id="telescope-theme" dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body>{children}</body>
    </html>
  );
}
