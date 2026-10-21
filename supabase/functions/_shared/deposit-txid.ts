const TXID_RE = /^[a-f0-9]{64}$/i;
const EMBEDDED_TXID_RE = /(^|[^a-f0-9])([a-f0-9]{64})(?![a-f0-9])/ig;

/** Return one unambiguous 64-character transaction hash from an AI/OCR candidate field. */
export function extractUniqueTxidCandidate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const input = value.trim();
  if (TXID_RE.test(input)) return input;
  const found = new Map<string, string>();
  EMBEDDED_TXID_RE.lastIndex = 0;
  for (const match of input.matchAll(EMBEDDED_TXID_RE)) {
    const txid = String(match[2] || "");
    // Reject EVM-style 0x prefixes; this scanner only accepts TRON transaction IDs.
    if (String(match[1] || "").toLowerCase() === "x" && match.index !== undefined && input[match.index - 1] === "0") continue;
    if (TXID_RE.test(txid)) found.set(txid.toLowerCase(), txid);
    if (found.size > 1) return null;
  }
  return found.size === 1 ? [...found.values()][0] : null;
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((x) => x.toString(16).padStart(2, "0")).join("");
}
