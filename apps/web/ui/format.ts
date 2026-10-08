import type { Dataset } from "@ostira/core/dataset";

export type Actors = Dataset["actors"];

const PROGRAM_NAMES: Record<string, string> = {
  "11111111111111111111111111111111": "System Program",
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: "Token Program",
  ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL: "Associated Token Program",
  ComputeBudget111111111111111111111111111111: "Compute Budget",
  Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo: "Memo Program",
  MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr: "Memo Program",
  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: "Token-2022",
};

export function shortAddr(a: string, n = 4) {
  if (!a || a.length <= n * 2 + 1) return a;
  return `${a.slice(0, n)}…${a.slice(-n)}`;
}

export function nameOf(address: string, actors: Actors): string {
  for (const a of Object.values(actors)) if (a.address === address) return a.label;
  if (PROGRAM_NAMES[address]) return PROGRAM_NAMES[address];
  return shortAddr(address);
}

export function isKnown(address: string, actors: Actors) {
  return Object.values(actors).some((a) => a.address === address);
}

export function programName(id: string) {
  return PROGRAM_NAMES[id] ?? shortAddr(id);
}

/** "4000" -> "4,000"; keeps decimals as given. */
export function amount(ui: string) {
  if (ui === "unlimited") return "unlimited";
  const neg = ui.startsWith("-");
  const [w, f] = ui.replace("-", "").split(".");
  return (neg ? "−" : "") + Number(w).toLocaleString("en-US") + (f ? "." + f : "");
}

/** Names used mid-sentence: descriptive labels go lowercase, proper names stay. */
export function inlineName(address: string, actors: Actors) {
  const n = nameOf(address, actors);
  return /^(New|Unknown|Treasury|Spare) /.test(n) ? n.charAt(0).toLowerCase() + n.slice(1) : n;
}

export function intentSentence(intent: { action: string; amount: string; asset: string; recipient?: string; spender?: string } | null, actors: Actors) {
  if (!intent) return "Invalid intent";
  if (intent.action === "PAY") return `Pay ${inlineName(intent.recipient!, actors)} ${amount(intent.amount)} ${intent.asset}`;
  return intent.amount === "unlimited"
    ? `Approve ${inlineName(intent.spender!, actors)} for unlimited ${intent.asset}`
    : `Approve ${inlineName(intent.spender!, actors)} to spend ${amount(intent.amount)} ${intent.asset}`;
}

export function timeOf(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function ms(v: number) {
  return v < 1 ? `${v.toFixed(2)} ms` : `${v.toFixed(1)} ms`;
}

/** Engine messages carry short addresses; show the names the operator knows instead. */
export function humanize(message: string, actors: Actors) {
  let out = message.replace(/(?<![\d.,])(\d{4,})(?=(\.\d+)? [A-Z]{3,5}\b)/g, (n) => Number(n).toLocaleString("en-US"));
  for (const a of Object.values(actors)) {
    const pieces = out.split(`${a.address.slice(0, 4)}…${a.address.slice(-4)}`);
    out = pieces.reduce((acc, piece) => {
      const atStart = acc.trim().length === 0 || /[.:]\s*$/.test(acc);
      const label = atStart ? a.label : /^(New|Unknown|Treasury|Spare) /.test(a.label) ? a.label.charAt(0).toLowerCase() + a.label.slice(1) : a.label;
      return acc + label + piece;
    });
  }
  return out;
}

/** Feed-row summaries: what an operator needs to pick an evaluation, in a few words. */
export const FINDING_SHORT: Record<string, string> = {
  UNDECLARED_APPROVAL: "+ undeclared approval",
  UNLIMITED_APPROVAL: "Unlimited allowance",
  UNEXPECTED_RECIPIENT: "+ undeclared recipient",
  UNEXPECTED_ASSET_OUTFLOW: "+ undeclared outflow",
  AMOUNT_MISMATCH: "Amount differs from intent",
  RECIPIENT_NOT_PAID: "− declared recipient not paid",
  AUTHORITY_CHANGE: "+ authority change",
  ACCOUNT_CLOSED: "+ account closed",
  ACCOUNT_FROZEN: "+ account frozen",
  SUPPLY_CHANGE: "+ token supply change",
  UNEXPECTED_SOL_TRANSFER: "+ undeclared SOL transfer",
  SOL_SPEND_EXCEEDS_CAP: "SOL spend above cap",
  UNKNOWN_PROGRAM: "+ unapproved program",
  UNSUPPORTED_PROGRAM: "Unsupported: Token-2022",
  UNDECODABLE_TRANSACTION: "Could not be decoded",
  SIMULATION_FAILED: "Simulation failed",
  INVALID_INTENT: "Invalid intent",
  UNKNOWN_ASSET: "Unknown asset",
  APPROVAL_SPENDER_MISMATCH: "Allowance to another spender",
  APPROVAL_EXCEEDS_INTENT: "Allowance above intent",
  APPROVAL_NOT_GRANTED: "− declared allowance missing",
  NEW_RECIPIENT: "New recipient",
  UNKNOWN_SPENDER: "Spender not approved",
  AMOUNT_ABOVE_REVIEW_THRESHOLD: "Above review threshold",
  AMOUNT_ABOVE_LIMIT: "Above autonomous limit",
};

export const CATEGORY_LABEL: Record<string, string> = {
  UNSUPPORTED: "Unsupported",
  SIMULATION_FAILED: "Simulation failed",
  INTENT_MISMATCH: "Intent mismatch",
  POLICY_VIOLATION: "Policy",
  INVALID_REQUEST: "Invalid request",
};

/** 08 Oct 2026, 09:41:22 UTC */
export function dateTimeUtc(iso: string) {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
  return `${date}, ${timeUtc(iso)}`;
}
export function timeUtc(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "UTC" }) + " UTC";
}

/** "sha256:4f1c…9a2b" style, for hashes that are long hex. */
export function shortHash(h: string, n = 8) {
  return h.length > n * 2 + 1 ? `${h.slice(0, n)}…${h.slice(-4)}` : h;
}
