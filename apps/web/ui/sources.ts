import type { Dataset, ScenarioEntry } from "@ostira/core/dataset";
import type { AttackId, BaseId, Resolution, Source } from "./runtime";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  return body as T;
}

/** Talks to the engine behind /api/v1. Every Attack Lab change is a fresh simulation. */
export function liveSource(apiBase = "/api/v1"): Source {
  return {
    mode: "live",
    load: () => call<Dataset>(`${apiBase}/dataset`),
    runLab: (base, attacks) => call<ScenarioEntry>(`${apiBase}/lab`, { method: "POST", body: JSON.stringify({ base, attacks }) }),
    resolve: async (id, action) => {
      const rec = await call<{ resolution: Resolution }>(`${apiBase}/evaluations/${id}/${action === "APPROVE" ? "approve" : "reject"}`, { method: "POST", body: JSON.stringify({ by: "operator" }) });
      return rec.resolution;
    },
  };
}

/** Serves evaluations the engine produced ahead of time, one per Attack Lab combination. */
export function snapshotSource(dataset: Dataset): Source {
  return {
    mode: "snapshot",
    load: async () => dataset,
    runLab: async (base: BaseId, attacks: AttackId[]) => {
      const id = [base, ...[...attacks].sort()].join("+");
      const e = dataset.scenarios[id];
      if (!e) throw new Error(`No result for ${id}`);
      return e;
    },
    resolve: async (_id, action) => ({ action, by: "you", at: new Date().toISOString() }),
  };
}
