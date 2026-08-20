import { ImageResponse } from "next/og";

export const alt = "Telescope — see your Telegram conversation differently";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 82px",
          background: "#0b1220",
          color: "white",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18, color: "#67d4ff", fontSize: 32 }}>
          <div style={{ width: 38, height: 38, display: "flex", alignItems: "center", justifyContent: "center", border: "2px solid white", borderRadius: "50%" }}>
            <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#67d4ff" }} />
          </div>
          <span style={{ color: "white" }}>Telescope</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ maxWidth: 920, fontSize: 76, lineHeight: 1.02, letterSpacing: "-0.04em" }}>
            See the conversation you were too close to notice.
          </div>
          <div style={{ fontSize: 25, color: "#aab6c8" }}>
            Private, local-first Telegram chat analysis.
          </div>
        </div>
      </div>
    ),
    size,
  );
}
