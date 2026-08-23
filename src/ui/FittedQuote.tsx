"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";

export function FittedQuote({ text, className = "", minSize = 22, maxSize = 112 }: { text: string; className?: string; minSize?: number; maxSize?: number }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLHeadingElement>(null);
  const [ready, setReady] = useState(false);

  const fit = useCallback(() => {
    const frame = frameRef.current;
    const heading = textRef.current;
    const content = frame?.closest<HTMLElement>(".wrapped-content");
    const screen = frame?.closest<HTMLElement>(".wrapped-screen");
    if (!frame || !heading || !content || !screen) return;

    const screenStyle = window.getComputedStyle(screen);
    const availableHeight = screen.clientHeight
      - Number.parseFloat(screenStyle.paddingTop)
      - Number.parseFloat(screenStyle.paddingBottom);
    frame.style.maxHeight = "none";
    frame.style.overflowY = "visible";

    const fits = () => content.scrollHeight <= availableHeight && content.scrollWidth <= content.clientWidth;
    heading.style.fontSize = `${maxSize}px`;
    if (fits()) {
      setReady(true);
      return;
    }

    let low = minSize;
    let high = maxSize;
    for (let pass = 0; pass < 9; pass += 1) {
      const size = (low + high) / 2;
      heading.style.fontSize = `${size}px`;
      if (fits()) low = size;
      else high = size;
    }
    heading.style.fontSize = `${Math.floor(low)}px`;
    if (!fits()) {
      const heightWithoutQuote = content.scrollHeight - frame.scrollHeight;
      frame.style.maxHeight = `${Math.max(96, availableHeight - heightWithoutQuote)}px`;
      frame.style.overflowY = "auto";
    }
    setReady(true);
  }, [maxSize, minSize]);

  useLayoutEffect(() => {
    fit();
    const frame = frameRef.current;
    const content = frame?.closest<HTMLElement>(".wrapped-content");
    const screen = frame?.closest<HTMLElement>(".wrapped-screen");
    if (!frame || !content || !screen) return;
    const observer = new ResizeObserver(fit);
    observer.observe(screen);
    const mutations = new MutationObserver(fit);
    mutations.observe(content, { childList: true, characterData: true, subtree: true });
    void document.fonts?.ready.then(fit);
    return () => { observer.disconnect(); mutations.disconnect(); };
  }, [fit, text]);

  return (
    <div ref={frameRef} data-report-navigation-lock className="wild-quote-frame overscroll-contain">
      <h2 ref={textRef} className={`break-words font-display leading-[.88] tracking-[-.035em] transition-opacity ${ready ? "opacity-100" : "opacity-0"} ${className}`}>“{text}”</h2>
    </div>
  );
}
