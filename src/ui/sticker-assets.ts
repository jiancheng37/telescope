import type { Parsed } from "@/domain/parse";

export interface LocalStickerVisual {
  path: string;
  src: string;
  emoji: string;
  count: number;
  video: boolean;
}

export interface LocalStickerVisuals {
  a: LocalStickerVisual[];
  b: LocalStickerVisual[];
}

export const TELESCOPE_STICKER_VISUALS_EVENT = "telescope:sticker-visuals";

// `webkitRelativePath` is populated by an <input webkitdirectory>, but files
// obtained through the drag-and-drop entry API do not retain it. Keep the path
// alongside those File objects so both upload methods behave identically.
const droppedRelativePaths = new WeakMap<File, string>();

const exportPathOf = (file: File): string => file.webkitRelativePath || droppedRelativePaths.get(file) || file.name;

/** Remove the selected export folder's root directory from webkitRelativePath. */
export function filesByExportPath(files: File[]): Map<string, File> {
  const out = new Map<string, File>();
  for (const file of files) {
    const parts = exportPathOf(file).replaceAll("\\", "/").split("/");
    const relative = parts.length > 1 ? parts.slice(1).join("/") : file.name;
    out.set(relative, file);
    // Recursive drag-and-drop yields File objects without webkitRelativePath.
    // Telegram gives every exported sticker a unique basename within its media
    // type, so retain a basename fallback for matching `stickers/foo.webp`.
    if (!out.has(file.name)) out.set(file.name, file);
  }
  return out;
}

const basename = (path: string) => path.replaceAll("\\", "/").split("/").pop() ?? path;

export function resultJsonFrom(files: File[]): File | undefined {
  const candidates = files.filter((file) => {
    const path = exportPathOf(file).replaceAll("\\", "/").toLocaleLowerCase();
    return path === "result.json" || path.endsWith("/result.json");
  });
  // A folder picker reports paths as `Export folder/result.json`. Prefer that
  // root file if a dragged parent directory happens to contain older exports.
  return candidates.sort((a, b) => {
    const depth = (file: File) => exportPathOf(file).replaceAll("\\", "/").split("/").length;
    return depth(a) - depth(b);
  })[0];
}

interface LegacyFileEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  file(success: (file: File) => void, error?: (error: DOMException) => void): void;
  createReader(): { readEntries(success: (entries: LegacyFileEntry[]) => void, error?: (error: DOMException) => void): void };
}

async function filesFromEntry(entry: LegacyFileEntry, relativePath = entry.name): Promise<File[]> {
  if (entry.isFile) {
    return new Promise((resolve, reject) => entry.file((file) => {
      droppedRelativePaths.set(file, relativePath);
      resolve([file]);
    }, reject));
  }
  if (!entry.isDirectory) return [];
  const reader = entry.createReader();
  const children: LegacyFileEntry[] = [];
  // Chromium returns directory entries in batches and an empty batch marks EOF.
  while (true) {
    const batch = await new Promise<LegacyFileEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) break;
    children.push(...batch);
  }
  // Visit direct files before subdirectories. Apart from reducing ambiguity,
  // this puts the export root's result.json ahead of any archived nested copy.
  children.sort((a, b) => Number(b.isFile) - Number(a.isFile));
  return (await Promise.all(children.map((child) => filesFromEntry(child, `${relativePath}/${child.name}`)))).flat();
}

/** Recursively expand dragged directories; DataTransfer.files only exposes their shell. */
export async function filesFromDrop(dataTransfer: DataTransfer): Promise<File[]> {
  const entries = [...dataTransfer.items]
    .map((item): LegacyFileEntry | null => ((item as DataTransferItem & { webkitGetAsEntry?: () => unknown }).webkitGetAsEntry?.() as LegacyFileEntry | null | undefined) ?? null)
    .filter((entry): entry is LegacyFileEntry => Boolean(entry));
  if (!entries.length) return [...dataTransfer.files];
  return (await Promise.all(entries.map((entry) => filesFromEntry(entry)))).flat();
}

function dataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read sticker asset."));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

/** Resolve the five most-sent exact sticker assets for each person. */
export async function buildStickerVisuals(parsed: Parsed, files: File[]): Promise<LocalStickerVisuals | undefined> {
  const assets = filesByExportPath(files);
  const assetFor = (path: string) => assets.get(path) ?? assets.get(basename(path));
  const counts = [new Map<string, { count: number; emoji: string }>(), new Map<string, { count: number; emoji: string }>()] as const;
  for (const message of parsed.messages) {
    if (message.mediaType !== "sticker" || !message.assetPath || !assetFor(message.assetPath)) continue;
    const current = counts[message.who].get(message.assetPath) ?? { count: 0, emoji: message.stickerEmoji ?? "" };
    current.count++;
    counts[message.who].set(message.assetPath, current);
  }
  const encoded = new Map<string, string>();
  let storedBytes = 0;
  const side = async (who: 0 | 1): Promise<LocalStickerVisual[]> => {
    const winners = [...counts[who].entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 5);
    const result: LocalStickerVisual[] = [];
    for (const [path, info] of winners) {
      const file = assetFor(path)!;
      // Avoid filling browser storage with unusually large animation files.
      if (file.size > 1_500_000) continue;
      let src = encoded.get(path);
      if (!src) {
        // Data URLs expand by roughly a third. Stay comfortably below the usual
        // 5 MB localStorage quota alongside the report's other local evidence.
        if (storedBytes + file.size > 2_500_000) continue;
        src = await dataUrl(file);
        encoded.set(path, src);
        storedBytes += file.size;
      }
      result.push({ path, src, emoji: info.emoji, count: info.count, video: /\.webm$/i.test(path) || file.type.startsWith("video/") });
    }
    return result;
  };
  const a = await side(0);
  const b = await side(1);
  return a.length || b.length ? { a, b } : undefined;
}
