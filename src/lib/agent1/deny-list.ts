function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

export function parseDeniedMeTokens(raw?: string): Set<string> {
  if (!raw?.trim()) {
    return new Set();
  }

  const denied = raw
    .split(",")
    .map((entry) => normalizeAddress(entry))
    .filter((entry) => entry.length > 0);

  return new Set(denied);
}

export function getDeniedMeTokens(): Set<string> {
  return parseDeniedMeTokens(process.env.AGENT1_DENIED_METOKENS);
}

export function isDeniedMeToken(address: string, denied?: Set<string>): boolean {
  const list = denied ?? getDeniedMeTokens();
  return list.has(normalizeAddress(address));
}
