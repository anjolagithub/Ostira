"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Dataset, ScenarioEntry } from "@ostira/core/dataset";

export type BaseId = keyof Dataset["bases"];
export type CoreAttackId = keyof Dataset["attacks"];
export type ExtendedAttackId = keyof Dataset["extendedAttacks"];
export type AttackId = CoreAttackId | ExtendedAttackId;

export interface Resolution {
  action: "APPROVE" | "REJECT";
  by: string;
  at: string;
}

/** Where evaluations come from: the live engine behind the API, or a precomputed snapshot of it. */
export interface Source {
  mode: "live" | "snapshot";
  load(): Promise<Dataset>;
  runLab(base: BaseId, attacks: AttackId[]): Promise<ScenarioEntry>;
  resolve(evaluationId: string, action: Resolution["action"]): Promise<Resolution>;
}

interface Runtime {
  mode: Source["mode"];
  dataset: Dataset | null;
  error: string | null;
  /** Evaluations created this session (Attack Lab runs), newest first. */
  recent: ScenarioEntry[];
  resolutions: Record<string, Resolution>;
  runLab(base: BaseId, attacks: AttackId[]): Promise<ScenarioEntry>;
  resolve(evaluationId: string, action: Resolution["action"]): Promise<Resolution>;
  entry(id: string): ScenarioEntry | undefined;
  /** Run the same transaction through the engine again (live mode). Returns the fresh evaluation. */
  reevaluate(e: ScenarioEntry): Promise<ScenarioEntry>;
  toast: { id: number; text: string; tone?: string } | null;
  notify(text: string, tone?: string): void;
}

const Ctx = createContext<Runtime | null>(null);

export function RuntimeProvider({ source, children }: { source: Source; children: ReactNode }) {
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<ScenarioEntry[]>([]);
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({});
  const [toast, setToast] = useState<Runtime["toast"]>(null);

  useEffect(() => {
    source.load().then(setDataset, (e) => setError(String(e?.message ?? e)));
  }, [source]);

  const notify = useCallback((text: string, tone?: string) => {
    const id = Date.now();
    setToast({ id, text, tone });
    window.setTimeout(() => setToast((t) => (t?.id === id ? null : t)), 2600);
  }, []);

  const runLab = useCallback(async (base: BaseId, attacks: AttackId[]) => {
    const e = await source.runLab(base, attacks);
    setRecent((r) => [e, ...r.filter((x) => x.result.evaluationId !== e.result.evaluationId)].slice(0, 30));
    return e;
  }, [source]);

  const resolve = useCallback(async (id: string, action: Resolution["action"]) => {
    const r = await source.resolve(id, action);
    setResolutions((m) => ({ ...m, [id]: r }));
    return r;
  }, [source]);

  const entry = useCallback((id: string) => {
    return recent.find((e) => e.result.evaluationId === id || e.id === id) ?? dataset?.scenarios[id];
  }, [recent, dataset]);

  const reevaluate = useCallback((e: ScenarioEntry) => runLab(e.base, e.attacks as AttackId[]), [runLab]);

  const value = useMemo<Runtime>(() => ({ mode: source.mode, dataset, error, recent, resolutions, runLab, resolve, entry, reevaluate, toast, notify }),
    [source.mode, dataset, error, recent, resolutions, runLab, resolve, entry, reevaluate, toast, notify]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRuntime() {
  const v = useContext(Ctx);
  if (!v) throw new Error("RuntimeProvider missing");
  return v;
}

// ---------------------------------------------------------------------------
// Navigation, abstracted so the same views run inside Next.js and in the snapshot build.
// ---------------------------------------------------------------------------

export type Route =
  | { page: "overview" }
  | { page: "console"; id?: string }
  | { page: "lab"; base?: BaseId; attacks?: AttackId[] }
  | { page: "policy" }
  | { page: "docs" };

export interface Nav {
  route: Route;
  go(route: Route, opts?: { replace?: boolean }): void;
  href(route: Route): string;
}

const NavCtx = createContext<Nav | null>(null);
export const NavProvider = NavCtx.Provider;
export function useNav() {
  const v = useContext(NavCtx);
  if (!v) throw new Error("NavProvider missing");
  return v;
}

export function routeToPath(r: Route): string {
  switch (r.page) {
    case "overview": return "/";
    case "policy": return "/policy";
    case "docs": return "/docs";
    case "console": return r.id ? `/console?e=${encodeURIComponent(r.id)}` : "/console";
    case "lab": {
      const q = new URLSearchParams();
      if (r.base) q.set("intent", r.base);
      if (r.attacks?.length) q.set("attacks", r.attacks.join(","));
      const s = q.toString();
      return s ? `/lab?${s}` : "/lab";
    }
  }
}

export function pathToRoute(pathname: string, search: string): Route {
  const q = new URLSearchParams(search);
  if (pathname.startsWith("/console")) return { page: "console", id: q.get("e") ?? undefined };
  if (pathname.startsWith("/lab")) {
    const attacks = (q.get("attacks") ?? "").split(",").filter(Boolean) as AttackId[];
    return { page: "lab", base: (q.get("intent") as BaseId) ?? undefined, attacks };
  }
  if (pathname.startsWith("/policy")) return { page: "policy" };
  if (pathname.startsWith("/docs")) return { page: "docs" };
  return { page: "overview" };
}

export function NavLink({ to, className, children, onClick, ...rest }: { to: Route; className?: string; children: ReactNode; onClick?: () => void } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "onClick">) {
  const nav = useNav();
  return (
    <a
      {...rest}
      href={nav.href(to)}
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        onClick?.();
        nav.go(to);
      }}
    >
      {children}
    </a>
  );
}
