import { ATTACKS, BASES, EXTENDED_ATTACKS, SHOWCASE, buildScenario, createWorld, type AnyAttackId, type AttackId, type BaseId, type ExtendedAttackId, type World } from "./fixtures";
import { readFileSync } from "node:fs";
import { policyVersion } from "./policy";
import { toJson } from "./store";
import type { EvaluationResult } from "./types";

export interface ScenarioEntry {
  id: string;
  title: string;
  base: BaseId;
  attacks: AnyAttackId[];
  instructions: string[];
  /** Instruction indexes added or altered by an attack. */
  injected: number[];
  result: EvaluationResult;
}

export interface Dataset {
  generatedAt: string;
  simulator: string;
  actors: Record<string, { label: string; address: string }>;
  policy: Record<string, unknown>;
  policyVersion: string;
  bases: typeof BASES;
  attacks: typeof ATTACKS;
  extendedAttacks: typeof EXTENDED_ATTACKS;
  showcase: string[];
  scenarios: Record<string, ScenarioEntry>;
  /** The seven core attacks in every combination, on every applicable intent. */
  sweep: { total: number; allowed: number; blocked: number };
  /** Each extended token-level attack on its own, on every intent. */
  extendedSweep: { total: number; allowed: number; blocked: number };
  /** The latest live-cluster smoke run (scripts/devnet-smoke.ts), if one has been recorded. */
  liveRun: LiveRun | null;
}

export interface LiveRun {
  /** full: the run created its own mint and sent the allowed transaction. observe: read-only against existing holders. */
  mode?: "full" | "observe";
  cluster: string;
  solanaCore: string;
  ranAt: string;
  passed: number;
  total: number;
  results: { name: string; decision: string; codes: string[]; slot: string | null; ms: number; pass: boolean; cpi?: number }[];
  sent: { signature?: string; simulationMatchedExecution?: boolean; aliceDelta?: string; simulatedDelta?: string; skipped?: boolean };
}

function readLiveRun(): LiveRun | null {
  // Module-relative when run directly (tests, tsx); cwd-relative when bundled (Next.js runs from apps/web).
  const candidates: (string | URL)[] = [
    ...(process.env.OSTIRA_LIVE_REPORT ? [process.env.OSTIRA_LIVE_REPORT] : []),
    new URL("../scripts/devnet-report.json", import.meta.url),
    `${process.cwd()}/../../packages/core/scripts/devnet-report.json`,
    `${process.cwd()}/packages/core/scripts/devnet-report.json`,
  ];
  for (const c of candidates) {
    try {
      return JSON.parse(readFileSync(c, "utf8")) as LiveRun;
    } catch {}
  }
  return null;
}

export function labApplicable(base: BaseId, attacks: AnyAttackId[]) {
  return !(BASES[base].kind === "APPROVE" && (attacks.includes("skim" as AnyAttackId) || attacks.includes("redirect" as AnyAttackId)));
}

export async function evaluateScenario(world: World, base: BaseId, attacks: AnyAttackId[], keepLogs = true): Promise<ScenarioEntry> {
  const sc = await buildScenario(world, base, attacks);
  const result = await world.verifier.evaluate(sc.request);
  if (!keepLogs) (result as { logs: string[] }).logs = [];
  return { id: sc.id, title: sc.title, base, attacks: sc.attacks, instructions: sc.instructionsSummary, injected: sc.injected, result };
}

/** Every evaluation the console and Attack Lab can show, computed by the real engine. */
export async function buildDataset(opts: { allCombinations?: boolean; world?: World } = {}): Promise<Dataset> {
  const world = opts.world ?? (await createWorld());
  const scenarios: Record<string, ScenarioEntry> = {};
  const showcase: string[] = [];

  for (const s of SHOWCASE) {
    const e = await evaluateScenario(world, s.base, s.attacks, true);
    scenarios[e.id] = e;
    showcase.push(e.id);
  }

  let total = 0, allowed = 0, blocked = 0;
  const attackIds = Object.keys(ATTACKS) as AttackId[];
  for (const base of Object.keys(BASES) as BaseId[]) {
    for (let mask = 0; mask < 1 << attackIds.length; mask++) {
      const attacks = attackIds.filter((_, i) => mask & (1 << i));
      if (!labApplicable(base, attacks)) continue;
      const needed = opts.allCombinations || attacks.length <= 1;
      const id = [base, ...[...attacks].sort()].join("+");
      let entry = scenarios[id];
      if (!entry && (needed || attacks.length > 0)) {
        const e = await evaluateScenario(world, base, attacks, false);
        if (needed) scenarios[id] = e;
        entry = e;
      }
      if (attacks.length > 0 && entry) {
        total++;
        if (entry.result.decision === "ALLOW") allowed++;
        if (entry.result.decision === "BLOCK") blocked++;
      }
    }
  }

  const ext = { total: 0, allowed: 0, blocked: 0 };
  for (const base of Object.keys(BASES) as BaseId[]) {
    for (const a of Object.keys(EXTENDED_ATTACKS) as ExtendedAttackId[]) {
      const e = await evaluateScenario(world, base, [a], true);
      scenarios[e.id] = e;
      ext.total++;
      if (e.result.decision === "ALLOW") ext.allowed++;
      if (e.result.decision === "BLOCK") ext.blocked++;
    }
  }

  const policy = world.verifier.getPolicy("treasury-agent")!;
  return toJson({
    generatedAt: new Date().toISOString(),
    simulator: world.simulator.name,
    actors: world.actors,
    policy,
    policyVersion: policyVersion(policy),
    bases: BASES,
    attacks: ATTACKS,
    extendedAttacks: EXTENDED_ATTACKS,
    showcase,
    scenarios,
    sweep: { total, allowed, blocked },
    extendedSweep: ext,
    liveRun: readLiveRun(),
  }) as Dataset;
}
