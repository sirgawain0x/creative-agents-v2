import type { Abi, Address } from "viem";

import {
  STAGING_HUB2_USDC_VAULT,
  STAGING_METOKENS_DIAMOND_ADDRESS,
} from "@/lib/agent1/constants";
import type { QuoteMode } from "@/lib/agent1/quote";

export const VENUE_ABI_LABEL_PROVISIONAL = "foundry-facet-v1-provisional";
export const VENUE_ABI_LABEL_CONFIRMED = "foundry-facet-v1-confirmed";

/**
 * Provisional FoundryFacet mint ABI (2-arg staging path).
 * G2 must confirm diamond + full mint path before Slice E live execute.
 */
export const provisionalMintAbi = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "meToken", type: "address" },
      { name: "assetsDeposited", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const satisfies Abi;

/**
 * G2-confirmed Creative Platform path: approve USDC to hub vault, then
 * FoundryFacet.mint(meToken, assetsDeposited, recipient) on the Diamond.
 */
export const confirmedMintAbi = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "meToken", type: "address" },
      { name: "assetsDeposited", type: "uint256" },
      { name: "recipient", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const satisfies Abi;

export const foundryQuoteAbi = [
  {
    type: "function",
    name: "calculateMeTokensMinted",
    stateMutability: "view",
    inputs: [
      { name: "meToken", type: "address" },
      { name: "assetsDeposited", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const satisfies Abi;

function parseBooleanEnv(value: string | undefined): boolean {
  if (!value?.trim()) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

/** Explicit G2 opt-in — never defaulted to true in code or env templates. */
export function isAgent1RouterConfirmed(): boolean {
  return parseBooleanEnv(process.env.AGENT1_ROUTER_CONFIRMED);
}

export function getConfiguredDiamondAddress(): Address | null {
  const configured = process.env.AGENT1_METOKENS_DIAMOND_ADDRESS?.trim();
  if (configured) {
    return configured as Address;
  }
  return null;
}

export function getConfiguredHubVaultAddress(): Address | null {
  const configured = process.env.AGENT1_HUB2_USDC_VAULT_ADDRESS?.trim();
  if (configured) {
    return configured as Address;
  }
  return null;
}

export function getEffectiveDiamondAddress(): Address {
  return (getConfiguredDiamondAddress() ?? STAGING_METOKENS_DIAMOND_ADDRESS) as Address;
}

export function getEffectiveHubVaultAddress(): Address {
  return (getConfiguredHubVaultAddress() ?? STAGING_HUB2_USDC_VAULT) as Address;
}

export function getQuoteModeFromEnv(): QuoteMode {
  const raw = process.env.AGENT1_QUOTE_MODE?.trim().toLowerCase();
  if (raw === "onchain") {
    return "onchain";
  }
  if (raw === "mock") {
    return "mock";
  }
  if (getConfiguredDiamondAddress()) {
    return "onchain";
  }
  return "mock";
}

export interface Agent1VenueStatus {
  agent: "agent1";
  slice: "E-prep";
  venue: {
    type: "metokens_diamond_mint";
    routerConfirmed: boolean;
    abiLabel: typeof VENUE_ABI_LABEL_PROVISIONAL | typeof VENUE_ABI_LABEL_CONFIRMED;
    quoteMode: QuoteMode;
    addresses: {
      diamond: string;
      diamondConfigured: boolean;
      hub2UsdcVault: string;
      hubVaultConfigured: boolean;
      stagingDiamondDefault: string;
      stagingHubVaultDefault: string;
    };
    mintPath: "provisional_approve_diamond" | "confirmed_approve_hub_vault";
    note: string;
  };
  gates: {
    /** Live execute still blocked regardless of router confirm */
    broadcastAllowed: false;
    routerConfirmEnv: "AGENT1_ROUTER_CONFIRMED";
  };
}

export function getAgent1VenueStatus(): Agent1VenueStatus {
  const routerConfirmed = isAgent1RouterConfirmed();
  const quoteMode = getQuoteModeFromEnv();
  const diamondConfigured = Boolean(getConfiguredDiamondAddress());
  const hubVaultConfigured = Boolean(getConfiguredHubVaultAddress());
  const effectiveConfirmed = routerConfirmed && diamondConfigured;

  const abiLabel = effectiveConfirmed ? VENUE_ABI_LABEL_CONFIRMED : VENUE_ABI_LABEL_PROVISIONAL;
  const mintPath = effectiveConfirmed
    ? "confirmed_approve_hub_vault"
    : "provisional_approve_diamond";

  let note =
    "Creative Platform MeTokens diamond + hub vault addresses are staging candidates until G2 sets AGENT1_ROUTER_CONFIRMED=true.";
  if (effectiveConfirmed) {
    note =
      "Router confirmed for read-only quotes and dry-run calldata (FoundryFacet + hub-2 USDC vault). Slice E live execute still requires funding and explicit broadcast enablement.";
  } else if (routerConfirmed && !diamondConfigured) {
    note =
      "AGENT1_ROUTER_CONFIRMED=true but AGENT1_METOKENS_DIAMOND_ADDRESS is unset — venue remains unconfirmed (fail-closed).";
  }

  return {
    agent: "agent1",
    slice: "E-prep",
    venue: {
      type: "metokens_diamond_mint",
      routerConfirmed: effectiveConfirmed,
      abiLabel,
      quoteMode,
      addresses: {
        diamond: getEffectiveDiamondAddress(),
        diamondConfigured,
        hub2UsdcVault: getEffectiveHubVaultAddress(),
        hubVaultConfigured,
        stagingDiamondDefault: STAGING_METOKENS_DIAMOND_ADDRESS,
        stagingHubVaultDefault: STAGING_HUB2_USDC_VAULT,
      },
      mintPath,
      note,
    },
    gates: {
      broadcastAllowed: false,
      routerConfirmEnv: "AGENT1_ROUTER_CONFIRMED",
    },
  };
}

export interface Agent1QuoteVenue {
  type: "metokens_diamond_mint_quote";
  routerConfirmed: boolean;
  abiLabel: typeof VENUE_ABI_LABEL_PROVISIONAL | typeof VENUE_ABI_LABEL_CONFIRMED;
  quoteMode: QuoteMode;
  diamondAddress: string;
  addresses: Agent1VenueStatus["venue"]["addresses"];
  mintPath: Agent1VenueStatus["venue"]["mintPath"];
  note: string;
}

export function buildQuoteVenueBlock(mode: QuoteMode): Agent1QuoteVenue {
  const status = getAgent1VenueStatus();
  const diamondAddress =
    getConfiguredDiamondAddress() ?? STAGING_METOKENS_DIAMOND_ADDRESS;

  return {
    type: "metokens_diamond_mint_quote",
    routerConfirmed: status.venue.routerConfirmed,
    abiLabel: status.venue.abiLabel,
    quoteMode: mode,
    diamondAddress,
    addresses: status.venue.addresses,
    mintPath: status.venue.mintPath,
    note: status.venue.note,
  };
}
