# Ostira console — design brief

## Research distilled (what world-class products actually do)

| Source | Principle we take |
|---|---|
| Linear (2025–26 refresh) | Supporting chrome recedes; the work surface wins. Structure is *felt, not seen*: fewer, softer dividers. Warm, low-chroma greys instead of cold blue-grey. Dim the sidebar so content leads. |
| Vercel Geist / design.md | Monochrome by default; colour only for real state, never colour alone. Geist Sans for UI and numbers, Geist Mono only for identifiers/addresses/hashes. Tabular numerals. Sentence case. One continuous canvas: no card-wrapping everything, no nested panels, no glow, no gradients, no fake depth. Motion only to explain a state change. One dominant focal object per moment. |
| Stripe Radar | The verdict leads; the exact rules that fired follow; no opaque score. |
| Sentry / Datadog / Raycast | In dark UIs, saturated colour is reserved strictly for severity. One accent on neutral greys. |
| Mercury | Premium = restraint + trust. Red/yellow only ever mean "needs attention". Position first, controls one level down. |
| Tenderly | Simulation results need a unified state-change view and a collapsible full trace (outer + internal calls). |
| GitHub PR diff | Expected vs actual is a diff. Matching lines are calm; undeclared effects are the red `+` lines. |

## Ostira's signature: the Effect Diff

Every evaluation renders as **declared intent → observed effect**, diffed line by line.
- `=` line (neutral): effect the agent declared and the chain confirmed.
- `+` line (verdict colour): effect that happened but was **not declared**. This is the whole product in one glyph.
- `−` line (amber): effect the agent declared but that **did not happen**.

The hero BLOCK ("Pay Alice 500 USDC" + hidden unlimited approval) is two calm `=` lines and one loud `+` line.

## System

- **Type:** Geist Sans (UI, figures, tabular-nums), Geist Mono (addresses, ids, hashes, instruction names). Display only for the verdict word.
- **Colour:** warm neutral greys (OKLCH, low chroma). Verdict colours are the *only* saturated colour on screen: ALLOW green, REVIEW amber, BLOCK red. Always paired with a glyph and the word.
- **Surfaces:** one canvas. Boundaries only where earned: the diff block, the trace, the review action bar.
- **Density:** Linear-level. 13–14px UI, 12px metadata, tight lists.
- **Motion:** stillness. The only motion: the verdict settling in after the pipeline steps resolve (explains a state change), honoring reduced-motion.
- **Layout:** desktop = evaluation feed (left, dimmed) + detail (right, dominant). Mobile = feed → detail push, verdict pinned at top.
- **Copy:** plain-language effects ("Unknown program can spend all of the agent's USDC"), exact numbers, real addresses truncated middle (`7vQ3…y1kk`) with copy.

## Screens

1. **Feed** — every evaluation: verdict glyph, intent sentence, agent, time. Counts by verdict as quiet filters, not KPI cards.
2. **Evaluation detail** — verdict header → Effect Diff → Reasons (machine codes + sentence) → Pipeline (decode → simulate → extract → match → policy) → Trace (outer + CPI) → Audit (evaluation id, policy version, tx fingerprint, CU).
3. **REVIEW** — same detail, plus a pinned decision bar: Approve / Reject, recorded with who and when.
4. **Policy** — the active rules as readable sentences, with the version hash.

## Creative-director pass (v2)

**Design read:** a verification console for engineers who ship autonomous financial agents, with a calm, exacting, audit-grade language, leaning toward Linear/Vercel restraint with a customs-inspection metaphor.

**References and what we take from each**
1. *Customs declaration forms (CBP 6059B, CN22):* the declarant lists items with a value column on the right; an inspector checks the goods, not the paperwork. We take the two voices: what the agent declared, what the simulation found. Line items keep a right-aligned value column.
2. *The inspection stamp:* the outcome is one decisive mark at the end of the form. We take the verdict band as the single loud element per screen.
3. *Stripe Radar:* outcome first, then the exact rules that fired with their conditions in mono. We take reasons as rule code plus plain sentence.
4. *Stripe Radar event timeline / Tenderly trace:* the steps behind a decision are shown in order with timings. We take the 7-stage pipeline strip and the indented CPI trace.

**System**
- Colour: porcelain neutrals (canvas #f3f4f6, surface #ffffff, ink #14171c, ink-2 #4a515c, rule #e2e5ea) plus four verdict tones. Nothing else saturated.
- Type: Schibsted Grotesk (UI, display) and Martian Mono at 87% width (addresses, hashes, codes), both self-hosted. Scale 12/13/14/16/20/25/32/44/64.
- Radius rule: 10px for containers, 6px for controls, full pill only for verdict chips.
- Icons: Phosphor only.
- Signature: the Effect Diff, the declaration checked line by line, undeclared lines filled in the verdict colour.
- Motion: one moment. On the overview hero the diff rows resolve in order, then the verdict settles. Everything else changes instantly or with a 120 to 180ms state transition in answer to an action.
