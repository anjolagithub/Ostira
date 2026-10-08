"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Command } from "cmdk";
import { ArrowRight, CaretLeft, Desktop, MagnifyingGlass, Moon, Play, Sun } from "@phosphor-icons/react";
import type { Decision } from "@ostira/core";
import type { ScenarioEntry } from "@ostira/core/dataset";
import { Logo } from "./brand-art";
import { Chip, Code, CopyButton, EffectDiff, EvaluationDetail, Glyph, Pipeline, Reasons, VerdictBand, Built, SigningGate, Verifying, deciding } from "./parts";
import { FINDING_SHORT, amount, humanize, intentSentence, ms, nameOf, programName, shortAddr, timeOf } from "./format";
import { BASELINE } from "./programs";
import { attackTitle, labelFor } from "./story";
import { Overview, HERO_ID } from "./overview";
import { DocsView } from "./docs";
import { BRAND } from "./brand";
import { NavLink, useNav, useRuntime, type AttackId, type BaseId, type CoreAttackId, type ExtendedAttackId, type Route } from "./runtime";

// ====================================================================== shell

type Theme = "system" | "light" | "dark";
function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>("system");
  useEffect(() => {
    try {
      const t = localStorage.getItem("theme") as Theme | null;
      if (t) setTheme(t);
    } catch {}
  }, []);
  useEffect(() => {
    const el = document.documentElement;
    if (theme === "system") el.removeAttribute("data-theme");
    else el.setAttribute("data-theme", theme);
    try { localStorage.setItem("theme", theme); } catch {}
  }, [theme]);
  return [theme, setTheme];
}

function ThemeIcon({ theme }: { theme: Theme }) {
  return theme === "dark" ? <Moon size={16} /> : theme === "light" ? <Sun size={16} /> : <Desktop size={16} />;
}

const NAV: { to: Route; label: string; page: Route["page"] }[] = [
  { to: { page: "overview" }, label: "Overview", page: "overview" },
  { to: { page: "console" }, label: "Console", page: "console" },
  { to: { page: "lab" }, label: "Attack Lab", page: "lab" },
  { to: { page: "policy" }, label: "Policy", page: "policy" },
  { to: { page: "docs" }, label: "Docs", page: "docs" },
];

/** Known transactions a reviewer can open in one click. They go through the same views as any evaluation. */
const DEMOS: { id: string; label: string }[] = [
  { id: "pay-alice", label: "Clean payment" },
  { id: "pay-alice+hiddenApproval", label: "Hidden approval" },
  { id: "pay-alice+siphon", label: "Siphon transfer" },
  { id: "pay-alice+ownerTakeover", label: "Authority change" },
  { id: "pay-alice+solDrain", label: "SOL drain" },
];

function DemoMenu() {
  const nav = useNav();
  const { dataset } = useRuntime();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("mousedown", onDown); };
  }, [open]);
  if (!dataset) return null;
  return (
    <div className="demo" ref={ref}>
      <button className="icon-btn demo-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Play size={13} weight="fill" aria-hidden="true" /><span>Demo</span>
      </button>
      {open && (
        <div className="demo-menu" role="menu" aria-label="Open a known transaction">
          <p>Open a known transaction in the console</p>
          {DEMOS.map((m, i) => {
            const e = dataset.scenarios[m.id];
            if (!e) return null;
            return (
              <button role="menuitem" key={m.id} onClick={() => { setOpen(false); nav.go({ page: "console", id: m.id }); }} autoFocus={i === 0}>
                <span className="n">{i + 1}</span>{m.label}<Chip d={e.result.decision} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Shell() {
  const nav = useNav();
  const { dataset, error, toast, mode } = useRuntime();
  const [theme, setTheme] = useTheme();
  const [cmdOpen, setCmdOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setCmdOpen((o) => !o); }
      else if (e.key === "/" && !isTyping(e)) { e.preventDefault(); setCmdOpen(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => { window.scrollTo({ top: 0 }); }, [nav.route.page]);

  const nextTheme: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
  return (
    <div className="shell">
      <a href="#main" className="skip">Skip to content</a>
      <header className="topbar">
        <NavLink to={{ page: "overview" }} className="brand" aria-label={`${BRAND.name} home`}><Logo height={22} /></NavLink>
        <nav className="nav" aria-label="Main">
          {NAV.map((n) => (
            <NavLink key={n.page} to={n.to} aria-current={nav.route.page === n.page ? "page" : undefined}>{n.label}</NavLink>
          ))}
        </nav>
        <div className="topbar-actions">
          <span className="mode-pill hide-sm" data-mode={mode} title={mode === "live" ? "Evaluations run on the engine as you click" : "Every evaluation was produced by the engine and saved into this page"}>
            <i />{mode === "live" ? "Engine: live" : "Engine: snapshot"}
          </span>
          <DemoMenu />
          <button className="icon-btn" onClick={() => setCmdOpen(true)} aria-label="Search and jump (Command K)">
            <MagnifyingGlass size={15} aria-hidden="true" />
            <span className="kbd hide-sm">⌘K</span>
          </button>
          <button className="icon-btn" onClick={() => setTheme(nextTheme[theme])} aria-label={`Theme: ${theme}. Switch to ${nextTheme[theme]}`} title={`Theme: ${theme}`}>
            <ThemeIcon theme={theme} />
          </button>
        </div>
      </header>
      {error ? (
        <div className="page"><div className="empty-state" data-decision="BLOCK"><strong>Engine unreachable</strong><p>Evaluations could not be loaded: {error}. Nothing can be verified until the API responds. Check that it is running, then reload.</p></div></div>
      ) : !dataset ? (
        <div className="loading"><Verifying /></div>
      ) : (
        <main id="main">
          {nav.route.page === "overview" && <Overview />}
          {nav.route.page === "console" && <ConsoleView id={nav.route.id} />}
          {nav.route.page === "lab" && <LabView base={nav.route.base} attacks={nav.route.attacks} />}
          {nav.route.page === "policy" && <PolicyView />}
          {nav.route.page === "docs" && <DocsView />}
        </main>
      )}
      {cmdOpen && dataset && <CommandMenu onClose={() => setCmdOpen(false)} setTheme={setTheme} />}
      {toast && <div className="toast" role="status" key={toast.id}>{toast.text}</div>}
    </div>
  );
}

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
}

// ====================================================================== command menu

function CommandMenu({ onClose, setTheme }: { onClose: () => void; setTheme: (t: Theme) => void }) {
  const nav = useNav();
  const { dataset, recent } = useRuntime();
  const d = dataset!;
  const go = (r: Route) => { onClose(); nav.go(r); };
  const items = [...recent, ...d.showcase.map((id) => d.scenarios[id])];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="cmdk-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <Command className="cmdk" label={`Search ${BRAND.name}`} loop>
        <Command.Input autoFocus placeholder="Search evaluations, attacks, codes and pages" />
        <Command.List>
          <Command.Empty>Nothing matches. Try an attack name, a verdict, a finding code, or a page.</Command.Empty>
          <Command.Group heading="Evaluations">
            {items.map((e) => (
              <Command.Item key={e.result.evaluationId} value={`${e.result.decision} ${labelFor(d, e)} ${e.result.reasons.map((f) => f.code).join(" ")} ${e.result.evaluationId}`} onSelect={() => go({ page: "console", id: recent.includes(e) ? e.result.evaluationId : e.id })}>
                <Glyph d={e.result.decision} />{labelFor(d, e)}<em>{e.result.decision}</em>
              </Command.Item>
            ))}
          </Command.Group>
          <Command.Group heading="Try an attack in the lab">
            {[...Object.entries(d.attacks), ...Object.entries(d.extendedAttacks)].map(([a, v]) => (
              <Command.Item key={a} value={`attack ${v.title} ${v.detail}`} onSelect={() => go({ page: "lab", base: "pay-alice", attacks: [a as AttackId] })}>
                {v.title}<em>{v.detail}</em>
              </Command.Item>
            ))}
          </Command.Group>
          <Command.Group heading="Go to">
            {NAV.map((n) => <Command.Item key={n.page} value={`page ${n.label}`} onSelect={() => go(n.to)}>{n.label}</Command.Item>)}
          </Command.Group>
          <Command.Group heading="Appearance">
            {(["system", "light", "dark"] as Theme[]).map((t) => (
              <Command.Item key={t} value={`theme ${t}`} onSelect={() => { setTheme(t); onClose(); }}>Use {t} theme</Command.Item>
            ))}
          </Command.Group>
        </Command.List>
      </Command>
    </div>
  );
}

// ====================================================================== console

const FILTERS: Decision[] = ["BLOCK", "REVIEW", "ALLOW"];

/** What a feed row needs to say so the operator can pick it. */
function rowSummary(e: ScenarioEntry) {
  if (e.result.decision === "ALLOW") return "No undeclared effects";
  const top = deciding(e.result)[0];
  return top ? FINDING_SHORT[top.code] ?? top.code : "";
}

function ConsoleView({ id }: { id?: string }) {
  const nav = useNav();
  const { dataset, recent, entry } = useRuntime();
  const [filter, setFilter] = useState<Decision | null>(null);
  const showcase = dataset!.showcase.map((s) => dataset!.scenarios[s]);
  const extra = id && !recent.some((e) => e.result.evaluationId === id || e.id === id) && !dataset!.showcase.includes(id) ? entry(id) : undefined;
  const all = [...recent, ...(extra ? [extra] : []), ...showcase];
  const visible = (list: ScenarioEntry[]) => list.filter((e) => !filter || e.result.decision === filter);
  const keyOf = (e: ScenarioEntry) => (recent.includes(e) ? e.result.evaluationId : e.id);
  const selected = (id && entry(id)) || all[0];
  const listRef = useRef<HTMLDivElement>(null);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of all) c[e.result.decision] = (c[e.result.decision] ?? 0) + 1;
    return c;
  }, [all]);

  const move = useCallback((dir: 1 | -1) => {
    const list = visible(all);
    const i = list.findIndex((e) => e === selected);
    const next = list[Math.min(list.length - 1, Math.max(0, i + dir))];
    if (next) nav.go({ page: "console", id: keyOf(next) }, { replace: true });
  }, [all, selected, filter]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || document.querySelector(".cmdk-overlay")) return;
      if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); move(1); }
      if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); move(-1); }
      if (e.key === "Enter" && selected && !id) { e.preventDefault(); nav.go({ page: "console", id: keyOf(selected) }); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move, selected, id]);

  useEffect(() => {
    listRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const item = (e: ScenarioEntry) => (
    <NavLink key={keyOf(e)} to={{ page: "console", id: keyOf(e) }} className="feed-item" aria-current={e === selected ? "true" : undefined} data-decision={e.result.decision}>
      <span className="d"><Glyph d={e.result.decision} />{e.result.decision}</span>
      <span className="t">{intentSentence(e.result.intent as never, dataset!.actors)}</span>
      <span className="s" data-undeclared={rowSummary(e).startsWith("+") || undefined}>{rowSummary(e)}</span>
      <span className="w">{recent.includes(e) ? timeOf(e.result.evaluatedAt) : e.attacks.length ? "attacked" : "honest"}</span>
    </NavLink>
  );

  const top = selected ? deciding(selected.result)[0] : undefined;

  return (
    <div className="page">
      <div className="console" data-has-selection={id ? "true" : "false"}>
        <aside className="feed" aria-label="Evaluations">
          <div className="feed-head">
            <h1>Evaluations</h1>
            <span className="faint hide-sm" style={{ fontSize: "var(--t-12)" }}><span className="kbd">j</span> <span className="kbd">k</span> to move</span>
          </div>
          <div className="filters" role="group" aria-label="Filter by verdict">
            {FILTERS.map((f) => (
              <button key={f} className="filter" data-decision={filter === f ? f : undefined} aria-pressed={filter === f} onClick={() => setFilter(filter === f ? null : f)}>
                <Glyph d={f} />{f.charAt(0) + f.slice(1).toLowerCase()}<span className="faint num">{counts[f] ?? 0}</span>
              </button>
            ))}
          </div>
          <div className="feed-list" ref={listRef}>
            {visible(recent).length > 0 && <div className="feed-group">This session</div>}
            {visible(recent).map(item)}
            {extra && visible([extra]).length > 0 && <><div className="feed-group">Opened</div>{item(extra)}</>}
            <div className="feed-group">Demo agent: treasury-agent</div>
            {visible(showcase).map(item)}
            {visible(all).length === 0 && <p className="empty-note">No {filter?.toLowerCase()} evaluations yet. Clear the filter or run one in the Attack Lab.</p>}
          </div>
        </aside>
        <section aria-label="Evaluation detail" style={{ minWidth: 0 }} className="detail-wrap">
          <NavLink to={{ page: "console" }} className="back-link" style={{ marginBottom: 14 }}>
            <CaretLeft size={14} aria-hidden="true" />All evaluations
          </NavLink>
          {selected && (
            <EvaluationDetail
              entry={selected}
              key={selected.result.evaluationId}
              onReevaluated={(e) => nav.go({ page: "console", id: e.result.evaluationId }, { replace: true })}
            />
          )}
        </section>
      </div>
      {selected && id && (
        <div className="verdict-dock" data-decision={selected.result.decision}>
          <Chip d={selected.result.decision} />
          <span className="dock-msg mono">{top?.code ?? "No findings"}</span>
          <button className="btn btn-sm" onClick={() => document.getElementById("why")?.scrollIntoView({ behavior: "smooth", block: "start" })}>See why<ArrowRight size={12} aria-hidden="true" /></button>
        </div>
      )}
    </div>
  );
}

// ====================================================================== attack lab

const BASE_NOTE: Record<string, string> = {
  "pay-alice": "Approved recipient, under every limit",
  "pay-supplier": "First payment to this wallet",
  "pay-alice-large": "Above the 5,000 USDC autonomous limit",
  "approve-router": "Approved spender, within the allowance cap",
  "approve-unlimited": "Honest, but policy forbids unlimited allowances",
  "approve-unknown": "Spender is not on the allowlist",
};

function LabView({ base: baseIn, attacks: attacksIn }: { base?: BaseId; attacks?: AttackId[] }) {
  const nav = useNav();
  const { dataset, runLab, mode } = useRuntime();
  const d = dataset!;
  const base: BaseId = baseIn && d.bases[baseIn] ? baseIn : "pay-alice";
  const kind = d.bases[base].kind;
  const isExt = (a: string): a is ExtendedAttackId => a in d.extendedAttacks;
  const applies = (a: string) => !(kind === "APPROVE" && (a === "skim" || a === "redirect"));
  let attacks = (attacksIn ?? []).filter((a) => (a in d.attacks || isExt(a)) && applies(a));
  // Token-level attacks run one at a time; they are not combined with others.
  const ext = attacks.find(isExt);
  if (ext) attacks = [ext];
  const [entry, setEntry] = useState<ScenarioEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const reqRef = useRef(0);
  const sig = `${base}|${attacks.join(",")}`;

  const run = useCallback(() => {
    const n = ++reqRef.current;
    setBusy(true);
    setErr(null);
    const t = performance.now();
    runLab(base, attacks).then(
      (e) => { if (n === reqRef.current) { setEntry(e); setElapsed(performance.now() - t); setBusy(false); } },
      (e) => { if (n === reqRef.current) { setErr(String(e?.message ?? e)); setBusy(false); } },
    );
  }, [sig]);
  useEffect(run, [run]);

  const set = (b: BaseId, a: AttackId[]) => nav.go({ page: "lab", base: b, attacks: a }, { replace: true });
  const toggle = (a: AttackId) => {
    if (isExt(a)) return set(base, attacks.includes(a) ? [] : [a]);
    const core = attacks.filter((x) => !isExt(x));
    set(base, core.includes(a) ? core.filter((x) => x !== a) : [...core, a]);
  };

  const toggleRow = (a: AttackId, title: string, detail: string) => {
    const disabled = !applies(a);
    const on = attacks.includes(a);
    return (
      <div
        key={a}
        className="toggle-row"
        role="switch"
        tabIndex={disabled ? -1 : 0}
        aria-checked={on}
        aria-disabled={disabled}
        data-on={on}
        onClick={() => !disabled && toggle(a)}
        onKeyDown={(e) => { if (!disabled && (e.key === " " || e.key === "Enter")) { e.preventDefault(); toggle(a); } }}
      >
        <span className="t">{title}</span>
        <span className="switch" aria-hidden="true" />
        <span className="s">{disabled ? "Applies to payments only" : detail}</span>
      </div>
    );
  };

  const detected = entry ? [...new Set(entry.result.reasons.map((f) => f.code))] : [];

  return (
    <div className="page">
      <div className="lab">
        <div className="lab-controls">
          <div className="lab-title">
            <h1>Attack Lab</h1>
            <p>Can you get a transaction past {BRAND.name}? Pick what the agent declares, then slip something into the transaction it builds. Every change is a fresh evaluation by the engine.</p>
          </div>
          <fieldset className="fieldset">
            <legend>Declared intent</legend>
            {(Object.keys(d.bases) as BaseId[]).map((b) => (
              <label className="option" key={b}>
                <input type="radio" name="lab-intent" id={`lab-intent-${b}`} checked={base === b} onChange={() => set(b, attacks)} />
                <span className="radio" aria-hidden="true" />
                <span className="t">{d.bases[b].title}</span>
                <span className="s">{BASE_NOTE[b]}</span>
              </label>
            ))}
          </fieldset>
          <fieldset className="fieldset">
            <legend>Attacks, combine any</legend>
            {(Object.keys(d.attacks) as CoreAttackId[]).map((a) => toggleRow(a, d.attacks[a].title, d.attacks[a].detail))}
          </fieldset>
          <fieldset className="fieldset">
            <legend>Token-level attacks, one at a time</legend>
            {(Object.keys(d.extendedAttacks) as ExtendedAttackId[]).map((a) => toggleRow(a, d.extendedAttacks[a].title, d.extendedAttacks[a].detail))}
          </fieldset>
          {attacks.length > 0 && <button className="btn" onClick={() => set(base, [])}>Remove all attacks</button>}
        </div>

        {entry && (
          <div className="lab-dock" data-decision={entry.result.decision}>
            <Chip d={entry.result.decision} />
            <span className="dock-msg">{busy ? "Verifying" : entry.result.reasons.length ? humanize(entry.result.reasons[0].message, d.actors) : "Effect matches intent and policy"}</span>
            <button className="btn btn-sm" onClick={() => document.getElementById("lab-result")?.scrollIntoView({ behavior: "smooth" })}>See why</button>
          </div>
        )}
        <div className="lab-result" id="lab-result" aria-live="polite" data-busy={busy}>
          <div className="lab-status">
            <span className="lab-live">Live verdict</span>
            {busy ? <span>Verifying</span> : err ? <span className="err">The engine refused the request: {err}</span> : entry ? (
              <>
                <span>{mode === "live" ? `Simulated and judged in ${ms(elapsed ?? 0)}` : "Engine output for exactly this combination"}</span>
                <NavLink to={{ page: "console", id: mode === "live" ? entry.result.evaluationId : entry.id }} className="text-link">Open in console</NavLink>
              </>
            ) : null}
          </div>
          {busy && !entry && <Verifying />}
          {entry && (
            <>
              <VerdictBand entry={entry} animate key={entry.result.evaluationId} />
              {entry.attacks.length > 0 && (
                <div className="detected">
                  <span>{entry.result.decision === "ALLOW" ? "Got past: nothing detected" : `${attacks.length} ${attacks.length === 1 ? "attack" : "attacks"} slipped in, ${detected.length} ${detected.length === 1 ? "finding" : "findings"}`}</span>
                  <div>{detected.map((c) => <Code key={c} code={c} />)}</div>
                </div>
              )}
              <div className="sect">
                <div className="sect-head"><h3>Effect Diff</h3><p>Declared intent against what simulation observed</p></div>
                <EffectDiff entry={entry} />
              </div>
              <div className="sect" id="why">
                <div className="sect-head"><h3>Why</h3><p>{entry.result.reasons.length} {entry.result.reasons.length === 1 ? "finding" : "findings"}</p></div>
                <Reasons result={entry.result} />
              </div>
              <Built entry={entry} />
              <SigningGate entry={entry} onReevaluated={setEntry} />
              <Pipeline result={entry.result} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ====================================================================== policy

function PolicyView() {
  const { dataset } = useRuntime();
  const d = dataset!;
  const p = d.policy as Record<string, any>;
  const usdc = "USDC";
  const sol = Number(p.maxSolSpendLamports) / 1e9;
  const groups: { title: string; rules: { text: string; key: string; d: Decision }[] }[] = [
    {
      title: "Payments",
      rules: [
        { text: `An agent may pay an approved recipient up to ${amount(p.reviewAbove)} ${usdc} per transaction on its own.`, key: `reviewAbove = ${p.reviewAbove}`, d: "ALLOW" },
        { text: `Payments above ${amount(p.reviewAbove)} ${usdc} need a human.`, key: `reviewAbove = ${p.reviewAbove}`, d: "REVIEW" },
        { text: `Payments above ${amount(p.maxPayAmount)} ${usdc} always need a human, even to an approved recipient. The limit is returned as advice; the transaction is never rewritten.`, key: `maxPayAmount = ${p.maxPayAmount}`, d: "REVIEW" },
        { text: "A first payment to a new recipient needs a human.", key: `newRecipientAction = ${p.newRecipientAction}`, d: p.newRecipientAction },
      ],
    },
    {
      title: "Allowances",
      rules: [
        { text: `Allowances above ${amount(p.maxApprovalAmount)} ${usdc} need a human.`, key: `maxApprovalAmount = ${p.maxApprovalAmount}`, d: "REVIEW" },
        { text: "Unlimited allowances are never granted.", key: `allowUnlimitedApprovals = ${p.allowUnlimitedApprovals}`, d: p.allowUnlimitedApprovals ? "ALLOW" : "BLOCK" },
        { text: "Spenders must be explicitly approved.", key: `unknownSpenderAction = ${p.unknownSpenderAction}`, d: p.unknownSpenderAction },
      ],
    },
    {
      title: "Execution",
      rules: [
        { text: "Programs outside the allowlist are refused, including ones reached through CPI.", key: `unknownProgramAction = ${p.unknownProgramAction}`, d: p.unknownProgramAction },
        { text: `The agent may spend at most ${sol} SOL per transaction on fees and rent.`, key: `maxSolSpendLamports = ${p.maxSolSpendLamports}`, d: "BLOCK" },
        { text: "Any effect the agent didn't declare is refused, whatever the amount.", key: "built in, cannot be disabled", d: "BLOCK" },
        { text: "Token-2022, lookup tables, and anything that cannot be simulated are refused.", key: "built in, fails closed", d: "BLOCK" },
      ],
    },
  ];
  return (
    <div className="page">
      <div className="policy">
        <header className="policy-head">
          <div>
            <h1>Policy</h1>
            <p className="muted">Rules for <span className="mono">{String(p.agentId)}</span>, applied exactly, in code.</p>
          </div>
          <div className="policy-version">
            <span className="faint">Version, a content hash of these rules</span>
            <span className="pv"><span className="mono">{d.policyVersion}</span><CopyButton value={d.policyVersion} label="Copy policy hash" /></span>
            <span className="faint">Every evaluation records the version it used.</span>
          </div>
        </header>
        {groups.map((g) => (
          <div className="sect" key={g.title}>
            <div className="sect-head"><h3>{g.title}</h3></div>
            <div className="rules">
              {g.rules.map((r, i) => (
                <div className="rule" key={i}>
                  <p>{r.text}</p>
                  <small className="mono">{r.key}</small>
                  <Chip d={r.d} />
                </div>
              ))}
            </div>
          </div>
        ))}
        <div className="sect">
          <div className="sect-head"><h3>Allowlists</h3><p>Who and what this agent may deal with</p></div>
          <div className="rules">
            {(p.approvedRecipients as string[]).map((a) => (
              <div className="rule" key={a}><p>{nameOf(a, d.actors)}, approved recipient</p><small className="mono">{a}</small></div>
            ))}
            {(p.approvedSpenders as string[]).map((a) => (
              <div className="rule" key={a}><p>{nameOf(a, d.actors)}, approved spender</p><small className="mono">{a}</small></div>
            ))}
            {[...BASELINE, ...(p.approvedPrograms as string[])].map((a) => (
              <div className="rule" key={a}><p>{programName(a)}, allowed program</p><small className="mono">{shortAddr(a, 8)}</small></div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export { HERO_ID, attackTitle };
