import type { EvaluationResult } from "./types";

export interface ReviewResolution {
  action: "APPROVE" | "REJECT";
  by: string;
  note?: string;
  at: string;
}

export interface EvaluationRecord {
  result: EvaluationResult;
  /** Present only for REVIEW decisions that a human has resolved. The original result is never mutated. */
  resolution?: ReviewResolution;
}

/**
 * Append-only evaluation log. Results are immutable once written; a human review
 * is recorded alongside the result, never by editing it.
 */
export class EvaluationStore {
  private readonly records = new Map<string, EvaluationRecord>();
  private readonly order: string[] = [];

  put(result: EvaluationResult): EvaluationRecord {
    if (this.records.has(result.evaluationId)) return this.records.get(result.evaluationId)!;
    const rec = { result: Object.freeze(result) as EvaluationResult };
    this.records.set(result.evaluationId, rec);
    this.order.unshift(result.evaluationId);
    return rec;
  }

  get(id: string): EvaluationRecord | undefined {
    return this.records.get(id);
  }

  list(limit = 100): EvaluationRecord[] {
    return this.order.slice(0, limit).map((id) => this.records.get(id)!);
  }

  resolve(id: string, action: ReviewResolution["action"], by: string, note?: string): EvaluationRecord {
    const rec = this.records.get(id);
    if (!rec) throw new StoreError(404, `No evaluation ${id}`);
    if (rec.result.decision !== "REVIEW") throw new StoreError(409, `Only REVIEW decisions can be resolved; ${id} is ${rec.result.decision}`);
    if (rec.resolution) throw new StoreError(409, `${id} was already ${rec.resolution.action === "APPROVE" ? "approved" : "rejected"} by ${rec.resolution.by}`);
    rec.resolution = { action, by, note, at: new Date().toISOString() };
    return rec;
  }
}

export class StoreError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** JSON-safe form: bigints become decimal strings. */
export function toJson<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
}
