import { isDeniedMeToken } from "@/lib/agent1/deny-list";
import { getSubscribedMeToken } from "@/lib/agent1/metokens-subgraph";
import type { SubscribedMeToken } from "@/lib/agent1/metokens-subgraph";

export type UniverseRejectReason = "not_in_subgraph" | "deny_listed" | "invalid_address";

export interface UniverseValidationSuccess {
  ok: true;
  meToken: SubscribedMeToken;
}

export interface UniverseValidationFailure {
  ok: false;
  reason: UniverseRejectReason;
  message: string;
}

export type UniverseValidationResult = UniverseValidationSuccess | UniverseValidationFailure;

const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

export function isValidEthereumAddress(address: string): boolean {
  return ADDRESS_REGEX.test(address.trim());
}

export async function validateMeTokenUniverse(
  meTokenAddress: string,
): Promise<UniverseValidationResult> {
  if (!isValidEthereumAddress(meTokenAddress)) {
    return {
      ok: false,
      reason: "invalid_address",
      message: "Invalid MeToken address format",
    };
  }

  if (isDeniedMeToken(meTokenAddress)) {
    return {
      ok: false,
      reason: "deny_listed",
      message: "MeToken is on AGENT1_DENIED_METOKENS deny list",
    };
  }

  const meToken = await getSubscribedMeToken(meTokenAddress);
  if (!meToken) {
    return {
      ok: false,
      reason: "not_in_subgraph",
      message: "MeToken is not listed in the creative-platform subgraph (Subscribe events)",
    };
  }

  return { ok: true, meToken };
}
