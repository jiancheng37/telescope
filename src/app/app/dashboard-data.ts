import type { DashboardCollection, DashboardConversation } from "./DashboardWorkspace";

export interface DashboardData {
  reports: DashboardConversation[];
  collections: DashboardCollection[];
}

let cache: DashboardData | null = null;
let request: Promise<DashboardData> | null = null;

export function peekDashboardData() {
  return cache;
}

export function storeDashboardData(data: DashboardData) {
  cache = data;
}

export function invalidateDashboardData() {
  cache = null;
}

export function loadDashboardData(): Promise<DashboardData> {
  if (cache) return Promise.resolve(cache);
  if (!request) {
    request = fetch("/api/reports")
      .then(async (response) => {
        if (!response.ok) throw new Error("Dashboard data could not be loaded.");
        const data = (await response.json()) as DashboardData;
        cache = data;
        return data;
      })
      .finally(() => {
        request = null;
      });
  }
  return request;
}
