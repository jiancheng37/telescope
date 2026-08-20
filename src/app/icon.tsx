import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "transparent",
        }}
      >
        <div
          style={{
            position: "relative",
            width: 27,
            height: 27,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "1.5px solid #17212b",
            borderRadius: "50%",
          }}
        >
          <div style={{ position: "absolute", left: 11.25, top: -3, width: 1.5, height: 7, background: "#17212b" }} />
          <div style={{ position: "absolute", left: 11.25, bottom: -3, width: 1.5, height: 7, background: "#17212b" }} />
          <div style={{ position: "absolute", top: 11.25, left: -3, width: 7, height: 1.5, background: "#17212b" }} />
          <div style={{ position: "absolute", top: 11.25, right: -3, width: 7, height: 1.5, background: "#17212b" }} />
          <div style={{ width: 10, height: 10, border: "1.5px solid #17212b", borderRadius: "50%", background: "#2aabee" }} />
        </div>
      </div>
    ),
    size,
  );
}
