import { GATE_PATH, LOGO_VIEWBOX, MARK_TRANSFORM, RING_PATH, WORD_PATH, WORD_TRANSFORM } from "./logo-paths";
import { BRAND } from "./brand";

/** The Ostira mark: a ring the transaction would close, held open by the gate. */
export function Mark({ size = 22, mono = false, title }: { size?: number; mono?: boolean; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <path d={RING_PATH} fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" />
      <path d={GATE_PATH} fill="none" stroke={mono ? "currentColor" : "var(--gate)"} strokeWidth="8" strokeLinecap="round" />
    </svg>
  );
}

/** Mark plus outlined wordmark. Height sets the size; width follows the artwork. */
export function Logo({ height = 22 }: { height?: number }) {
  const [, , w, h] = LOGO_VIEWBOX.split(" ").map(Number);
  return (
    <svg height={height} width={(height * w) / h} viewBox={LOGO_VIEWBOX} role="img" aria-label={BRAND.name}>
      <g transform={MARK_TRANSFORM}>
        <path d={RING_PATH} fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" />
        <path d={GATE_PATH} fill="none" stroke="var(--gate)" strokeWidth="8" strokeLinecap="round" />
      </g>
      <path transform={WORD_TRANSFORM} d={WORD_PATH} fill="currentColor" />
    </svg>
  );
}

/**
 * Where Ostira sits: one agent, two transactions, one gate.
 * Honest transaction passes and the wallet signs; the one with a hidden approval stops at the gate.
 * Drawn twice (wide and tall) so the labels stay readable at every width.
 */
export function GateIllustration() {
  return (
    <figure className="gate-art" aria-labelledby="gate-art-cap">
      <svg className="gate-wide" viewBox="0 0 1000 330" role="img" aria-label="An AI agent proposes two transactions. The honest one passes Ostira, is signed and sent to the chain. The one with a hidden unlimited approval is blocked at Ostira and nothing is signed.">
        <Defs />
        {/* agent */}
        <g transform="translate(20 125)">
          <rect className="ga-card" width="210" height="80" rx="12" />
          <text className="ga-t" x="18" y="34">AI agent</text>
          <text className="ga-s" x="18" y="58">Says: pay Alice 500 USDC</text>
        </g>
        {/* lanes */}
        <path className="ga-line" d="M230 165 C 260 165, 260 85, 290 85" />
        <path className="ga-line" d="M230 165 C 260 165, 260 237, 290 237" />
        {/* honest tx */}
        <g transform="translate(290 55)">
          <rect className="ga-tx" width="250" height="60" rx="10" />
          <text className="ga-k" x="16" y="26">Transaction A</text>
          <text className="ga-m" x="16" y="46">Transfer 500 USDC to Alice</text>
        </g>
        {/* attacked tx */}
        <g transform="translate(290 195)">
          <rect className="ga-tx" width="250" height="84" rx="10" />
          <text className="ga-k" x="16" y="26">Transaction B</text>
          <text className="ga-m" x="16" y="46">Transfer 500 USDC to Alice</text>
          <rect className="ga-hit" x="10" y="54" width="230" height="22" rx="5" />
          <text className="ga-m ga-red" x="16" y="70">Approve unlimited to unknown</text>
        </g>
        <path className="ga-line" d="M540 85 H600" markerEnd="url(#ga-arrow)" />
        <path className="ga-line" d="M540 237 H600" markerEnd="url(#ga-arrow)" />
        {/* gate */}
        <g transform="translate(600 30)">
          <rect className="ga-gate" width="130" height="270" rx="18" />
          <g transform="translate(25 82) scale(1.25)">
            <path d={RING_PATH} fill="none" className="ga-ring" strokeWidth="7" strokeLinecap="round" />
            <path d={GATE_PATH} fill="none" stroke="var(--gate)" strokeWidth="7" strokeLinecap="round" />
          </g>
          <text className="ga-t" x="65" y="212" textAnchor="middle">{BRAND.name}</text>
          <text className="ga-s" x="65" y="234" textAnchor="middle">simulate, compare</text>
        </g>
        {/* outcomes */}
        <path className="ga-line ga-ok" d="M730 85 H800" markerEnd="url(#ga-arrow-ok)" />
        <g transform="translate(800 55)">
          <rect className="ga-out ga-out-ok" width="180" height="60" rx="10" />
          <text className="ga-v ga-green" x="16" y="27">ALLOW</text>
          <text className="ga-s" x="16" y="47">Signed, sent to chain</text>
        </g>
        <path className="ga-line ga-stop" d="M730 237 H770" />
        <path className="ga-x" d="M776 229 l16 16 M792 229 l-16 16" />
        <g transform="translate(800 207)">
          <rect className="ga-out ga-out-block" width="180" height="60" rx="10" />
          <text className="ga-v ga-red" x="16" y="27">BLOCK</text>
          <text className="ga-s" x="16" y="47">Nothing is signed</text>
        </g>
      </svg>

      <svg className="gate-tall" viewBox="0 0 360 600" role="img" aria-label="An AI agent proposes two transactions. The honest one passes Ostira, is signed and sent to the chain. The one with a hidden unlimited approval is blocked at Ostira and nothing is signed.">
        <Defs />
        <g transform="translate(90 10)">
          <rect className="ga-card" width="180" height="70" rx="12" />
          <text className="ga-t" x="90" y="30" textAnchor="middle">AI agent</text>
          <text className="ga-s" x="90" y="52" textAnchor="middle">Says: pay Alice 500 USDC</text>
        </g>
        <path className="ga-line" d="M180 80 C 180 105, 92 100, 92 125" />
        <path className="ga-line" d="M180 80 C 180 105, 268 100, 268 125" />
        <g transform="translate(10 125)">
          <rect className="ga-tx" width="164" height="80" rx="10" />
          <text className="ga-k" x="12" y="24">Transaction A</text>
          <text className="ga-m" x="12" y="46">Transfer 500 USDC</text>
        </g>
        <g transform="translate(186 125)">
          <rect className="ga-tx" width="164" height="80" rx="10" />
          <text className="ga-k" x="12" y="24">Transaction B</text>
          <text className="ga-m" x="12" y="44">Transfer 500 USDC</text>
          <rect className="ga-hit" x="6" y="52" width="152" height="20" rx="5" />
          <text className="ga-m ga-red" x="12" y="66">Approve unlimited</text>
        </g>
        <path className="ga-line" d="M92 205 V235" markerEnd="url(#ga-arrow)" />
        <path className="ga-line" d="M268 205 V235" markerEnd="url(#ga-arrow)" />
        <g transform="translate(10 235)">
          <rect className="ga-gate" width="340" height="150" rx="18" />
          <g transform="translate(140 18) scale(0.95)">
            <path d={RING_PATH} fill="none" className="ga-ring" strokeWidth="7" strokeLinecap="round" />
            <path d={GATE_PATH} fill="none" stroke="var(--gate)" strokeWidth="7" strokeLinecap="round" />
          </g>
          <text className="ga-t" x="170" y="112" textAnchor="middle">{BRAND.name}</text>
          <text className="ga-s" x="170" y="134" textAnchor="middle">simulate, compare</text>
        </g>
        <path className="ga-line ga-ok" d="M92 385 V430" markerEnd="url(#ga-arrow-ok)" />
        <path className="ga-line ga-stop" d="M268 385 V412" />
        <path className="ga-x" d="M260 418 l16 16 M276 418 l-16 16" />
        <g transform="translate(10 440)">
          <rect className="ga-out ga-out-ok" width="164" height="64" rx="10" />
          <text className="ga-v ga-green" x="12" y="28">ALLOW</text>
          <text className="ga-s" x="12" y="49">Signed, to chain</text>
        </g>
        <g transform="translate(186 440)">
          <rect className="ga-out ga-out-block" width="164" height="64" rx="10" />
          <text className="ga-v ga-red" x="12" y="28">BLOCK</text>
          <text className="ga-s" x="12" y="49">Nothing is signed</text>
        </g>
      </svg>
      <figcaption id="gate-art-cap">{BRAND.name} never holds keys and never broadcasts. An integrated wallet signs only after ALLOW, and only the exact transaction that was evaluated.</figcaption>
    </figure>
  );
}

function Defs() {
  return (
    <defs>
      <marker id="ga-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
        <path d="M0 0L10 5L0 10z" className="ga-arrowhead" />
      </marker>
      <marker id="ga-arrow-ok" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
        <path d="M0 0L10 5L0 10z" className="ga-arrowhead-ok" />
      </marker>
    </defs>
  );
}
