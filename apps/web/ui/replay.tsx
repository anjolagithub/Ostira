"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowCounterClockwise, Pause, Play } from "@phosphor-icons/react";
import type { ScenarioEntry } from "@ostira/core/dataset";
import { Code, DiffRows, Glyph, deciding, STAGE_LABEL } from "./parts";
import { story } from "./story";
import { intentSentence, ms } from "./format";
import { useRuntime } from "./runtime";

/**
 * The landing hero: one real evaluation replayed as a story.
 * Everything on screen is the engine's own output for that transaction; only the pacing is staged.
 * The whole timeline derives from a single elapsed clock, so it can be paused, scrubbed and replayed.
 */

const STEPS = [
  { id: "declare", label: "Declare" },
  { id: "build", label: "Build" },
  { id: "simulate", label: "Simulate" },
  { id: "compare", label: "Compare" },
  { id: "decide", label: "Decide" },
] as const;

const SHORT: Record<string, string> = { validate: "Validate", decode: "Inspect", simulate: "Simulate", extract: "Extract", match: "Compare", policy: "Policy", decide: "Decide" };

const TYPE_MS = 26;
const IX_MS = 380;
const STAGE_MS = 170;
const ROW_MS = 420;

interface Timeline {
  starts: number[]; // start of each step
  typeEnd: number;
  ixAt: number[];
  stageAt: number[];
  rowAt: number[];
  decideAt: number;
  end: number;
}

function buildTimeline(entry: ScenarioEntry, sentence: string, rows: number): Timeline {
  const t0 = 300;
  const typeEnd = t0 + sentence.length * TYPE_MS;
  const buildStart = typeEnd + 380;
  const ixAt = entry.instructions.map((_, i) => buildStart + i * IX_MS);
  const simStart = buildStart + entry.instructions.length * IX_MS + 260;
  const stageAt = entry.result.pipeline.slice(0, 6).map((_, i) => simStart + i * STAGE_MS);
  const cmpStart = simStart + 6 * STAGE_MS + 260;
  const rowAt = Array.from({ length: rows }, (_, i) => cmpStart + i * ROW_MS);
  const decideAt = cmpStart + rows * ROW_MS + 280;
  return { starts: [0, buildStart, simStart, cmpStart, decideAt], typeEnd, ixAt, stageAt, rowAt, decideAt, end: decideAt + 400 };
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(m.matches);
    const on = () => setReduced(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return reduced;
}

export function HeroReplay({ attacked, honest }: { attacked: ScenarioEntry; honest: ScenarioEntry }) {
  const { dataset } = useRuntime();
  const actors = dataset!.actors;
  const [which, setWhich] = useState<"attacked" | "honest">("attacked");
  const entry = which === "attacked" ? attacked : honest;
  const r = entry.result;
  const sentence = intentSentence(r.intent as never, actors);
  const lines = useMemo(() => r.diff.filter((l) => l.op !== "~"), [r]);
  const tl = useMemo(() => buildTimeline(entry, sentence, lines.length), [entry, sentence, lines.length]);
  const reduced = useReducedMotion();

  // single clock
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(true);
  const base = useRef(0); // performance.now() at elapsed 0
  const raf = useRef(0);

  const seek = useCallback((t: number, play = true) => {
    base.current = performance.now() - t;
    setElapsed(t);
    setPlaying(play);
  }, []);

  useEffect(() => { seek(reduced ? tl.end : 0, !reduced); }, [which, reduced, tl.end, seek]);

  useEffect(() => {
    if (!playing) return;
    const tick = () => {
      const t = performance.now() - base.current;
      if (t >= tl.end) { setElapsed(tl.end); setPlaying(false); return; }
      setElapsed(t);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, tl.end]);

  const done = elapsed >= tl.end;
  const step = tl.starts.reduce((s, start, i) => (elapsed >= start ? i : s), 0);
  const typed = sentence.slice(0, Math.max(0, Math.floor((elapsed - 300) / TYPE_MS)));
  const ixShown = tl.ixAt.filter((t) => elapsed >= t).length;
  const stagesDone = tl.stageAt.filter((t) => elapsed >= t).length;
  const rowsShown = tl.rowAt.filter((t) => elapsed >= t).length;
  const decided = elapsed >= tl.decideAt;
  const undeclaredShown = (done ? lines : lines.slice(0, rowsShown)).some((l) => l.op === "+" || l.op === "-");
  const sectionState = (i: number) => (step === i && !done ? "active" : step > i || done ? "done" : "pending");

  const toggle = () => {
    if (done) seek(0);
    else if (playing) { setPlaying(false); }
    else seek(elapsed);
  };

  return (
    <div className="replay" data-decision={r.decision} data-which={which}>
      <div className="replay-top">
        <div className="seg" role="tablist" aria-label="Transaction to replay">
          <button role="tab" aria-selected={which === "attacked"} onClick={() => setWhich("attacked")}>With a hidden approval</button>
          <button role="tab" aria-selected={which === "honest"} onClick={() => setWhich("honest")}>Honest</button>
        </div>
        <button className="icon-btn" onClick={toggle} aria-label={done ? "Replay" : playing ? "Pause" : "Play"} title={done ? "Replay" : playing ? "Pause" : "Play"}>
          {done ? <ArrowCounterClockwise size={15} /> : playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
      </div>

      <ol className="rail" aria-label="Verification steps">
        {STEPS.map((s, i) => (
          <li key={s.id} data-state={sectionState(i)}>
            <button onClick={() => seek(i === 4 ? tl.decideAt : tl.starts[i])}>
              <span className="rail-bar"><i style={{ transform: `scaleX(${progress(elapsed, tl.starts[i], tl.starts[i + 1] ?? tl.end)})` }} /></span>
              <span className="rail-label">{s.label}</span>
            </button>
          </li>
        ))}
      </ol>

      <section className="rp rp-declare" data-state={sectionState(0)}>
        <h4>Agent declares</h4>
        <p className="rp-intent">
          <span>{done || elapsed >= tl.typeEnd ? sentence : typed}</span>
          {!done && elapsed < tl.typeEnd + 300 && <span className="caret" aria-hidden="true" />}
        </p>
      </section>

      <section className="rp" data-state={sectionState(1)}>
        <h4>Transaction it built <span className="faint">unsigned</span></h4>
        <ol className="rp-ix">
          {entry.instructions.map((ix, i) => {
            const injected = (entry.injected ?? []).includes(i) && r.decision !== "ALLOW";
            return (
              <li key={i} data-shown={i < ixShown || done} data-flag={injected && undeclaredShown}>
                <span className="n">{i + 1}</span>
                <code className="mono">{ix}</code>
                {injected && undeclaredShown && <span className="rp-cause">Undeclared effect</span>}
              </li>
            );
          })}
        </ol>
      </section>

      <section className="rp" data-state={sectionState(2)}>
        <h4>Simulated, nothing signed <span className="faint">{`${ms(r.pipeline.reduce((a, p) => a + p.ms, 0))} measured on ${r.simulator === "litesvm" ? "LiteSVM" : "RPC"}${r.economicEffect ? `, ${String(r.economicEffect.computeUnits)} compute units` : ""}`}</span></h4>
        <ol className="rp-stages">
          {r.pipeline.slice(0, 6).map((p, i) => (
            <li key={p.stage} data-done={i < stagesDone || done} data-ok={p.ok}>
              <span className="dot" />
              <span className="lbl" title={STAGE_LABEL[p.stage]}>{SHORT[p.stage]}</span>
              <span className="t">{ms(p.ms)}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="rp" data-state={sectionState(3)}>
        <h4>Declared against what actually happens</h4>
        <div className="diff rp-diff" role="table" aria-label="Declared intent compared with simulated effect">
          <DiffRows lines={lines} actors={actors} shown={(i) => i < rowsShown || done} />
        </div>
      </section>

      <section className={`band rp-band ${decided || done ? "is-in" : ""}`} data-decision={r.decision} aria-live="polite" aria-label={decided || done ? `Verdict ${r.decision}` : "Verdict pending"}>
        <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
          <div className="band-word">{decided || done ? <Glyph d={r.decision} /> : <span className="glyph pending-glyph" aria-hidden="true" />}{decided || done ? r.decision : "Waiting"}</div>
          <div className="band-intent" data-hidden={!(decided || done)}>
            {story(entry, actors) || sentence}
          </div>
        </div>
        <div className="band-side">
          <span className="band-codes" data-hidden={!(decided || done)}>{deciding(r).length ? [...new Set(deciding(r).map((f) => f.code))].map((c) => <Code key={c} code={c} />) : <strong>No findings</strong>}</span>
          <span className="band-meta mono" data-hidden={!(decided || done)}>{r.evaluationId}</span>
        </div>
      </section>
      <p className="replay-note">Staged replay of a real evaluation. Values and timings are the engine&rsquo;s; the pacing is slowed for reading.</p>
    </div>
  );
}

function progress(t: number, a: number, b: number) {
  if (t <= a) return 0;
  if (t >= b) return 1;
  return (t - a) / (b - a);
}
