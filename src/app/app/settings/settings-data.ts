export interface SettingsData {
  account: { name: string; reportName: string; email: string; image: string | null };
  shares: Array<{ id: string; names: string; path: string; createdAt: string; privacy?: string }>;
  collections: Array<{ id: string; name: string; count: number }>;
}

let cache: SettingsData | null = null;
let request: Promise<SettingsData> | null = null;

export const peekSettingsData = () => cache;
export const storeSettingsData = (data: SettingsData) => { cache = data; };

export function loadSettingsData(): Promise<SettingsData> {
  if (cache) return Promise.resolve(cache);
  if (!request) {
    request = fetch("/api/settings").then(async (response) => {
      if (!response.ok) throw new Error("Settings could not be loaded.");
      const data = await response.json() as SettingsData;
      cache = data;
      return data;
    }).finally(() => { request = null; });
  }
  return request;
}
