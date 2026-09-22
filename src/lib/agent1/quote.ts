import { createPublicClient, formatUnits, http, parseUnits, type Address } from "viem";
import { base } from "viem/chains";

import {
  BASE_USDC_ADDRESS,
  METOKEN_DECIMALS,
  STAGING_METOKENS_DIAMOND_ADDRESS,
  USDC_DECIMALS,
} from "@/lib/agent1/constants";
import type { SubscribedMeToken } from "@/lib/agent1/metokens-subgraph";
import { logger } from "@/lib/logger";

/**
 * Minimal FoundryFacet view ABI for read-only mint quotes.
 * G2 must confirm diamond address + ABI parity with CreativeTV market UI.
 */
const foundryQuoteAbi = [
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
] as const;

export type QuoteMode = "mock" | "onchain";

export interface Agent1QuoteInput {
  meToken: SubscribedMeToken;
  usdcAmount: string;
}

export interface Agent1QuoteResult {
  mode: QuoteMode;
  inputAsset: typeof BASE_USDC_ADDRESS;
  outputToken: string;
  usdcIn: string;
  usdcInRaw: string;
  meTokensOut: string;
  meTokensOutRaw: string;
  slippageBpsEstimate: number | null;
  venue: {
    type: "metokens_diamond_mint_quote";
    diamondAddress: string | null;
    routerConfirmed: false;
    note: string;
  };
  warnings: string[];
}

function getQuoteMode(): QuoteMode {
  const raw = process.env.AGENT1_QUOTE_MODE?.trim().toLowerCase();
  if (raw === "onchain") {
    return "onchain";
  }
  if (raw === "mock") {
    return "mock";
  }

  if (process.env.AGENT1_METOKENS_DIAMOND_ADDRESS?.trim()) {
    return "onchain";
  }

  return "mock";
}

function getDiamondAddress(): Address | null {
  const configured = process.env.AGENT1_METOKENS_DIAMOND_ADDRESS?.trim();
  if (configured) {
    return configured as Address;
  }
  return null;
}

function getBaseRpcUrl(): string | undefined {
  return process.env.BASE_RPC_URL?.trim() || process.env.ALCHEMY_BASE_RPC_URL?.trim();
}

function createBaseClient() {
  const rpcUrl = getBaseRpcUrl();
  if (!rpcUrl) {
    return null;
  }

  return createPublicClient({
    chain: base,
    transport: http(rpcUrl),
  });
}

function buildVenueNote(mode: QuoteMode, diamondAddress: string | null): string {
  if (mode === "onchain" && diamondAddress) {
    return (
      "Read-only quote via calculateMeTokensMinted on meTokens Diamond (staging path). " +
      "CreativeTV router/diamond addresses and ABI are NOT G2-confirmed for production execute."
    );
  }

  return (
    "Staging mock quote — ratio derived from subgraph Subscribe metadata only. " +
    "Set AGENT1_METOKENS_DIAMOND_ADDRESS + BASE_RPC_URL + AGENT1_QUOTE_MODE=onchain for diamond read quotes. " +
    "G2 must confirm CreativeTV router/diamond before live execute (Slice E)."
  );
}

async function quoteOnchain(
  meToken: SubscribedMeToken,
  usdcInRaw: bigint,
  diamondAddress: Address,
): Promise<bigint> {
  const client = createBaseClient();
  if (!client) {
    throw new Error("BASE_RPC_URL is required for onchain quotes");
  }

  const meTokensOut = await client.readContract({
    address: diamondAddress,
    abi: foundryQuoteAbi,
    functionName: "calculateMeTokensMinted",
    args: [meToken.meToken as Address, usdcInRaw],
  });

  return meTokensOut;
}

function quoteMock(usdcInRaw: bigint): bigint {
  /**
   * Conservative staging mock: ~0.35 MeTokens per 1 USDC at 18-decimal output scale.
   * NOT production pricing — only for read-only Slice B when diamond/RPC unset.
   */
  const usdcWhole = Number(formatUnits(usdcInRaw, USDC_DECIMALS));
  const estimatedOut = usdcWhole * 0.35;
  return parseUnits(estimatedOut.toFixed(METOKEN_DECIMALS), METOKEN_DECIMALS);
}

export async function quoteUsdcToMeToken(input: Agent1QuoteInput): Promise<Agent1QuoteResult> {
  const mode = getQuoteMode();
  const diamondAddress = getDiamondAddress();
  const usdcInRaw = parseUnits(input.usdcAmount, USDC_DECIMALS);
  const warnings: string[] = [];

  if (input.meToken.asset.toLowerCase() !== BASE_USDC_ADDRESS.toLowerCase()) {
    warnings.push(
      `MeToken hub collateral is ${input.meToken.asset}, not Base USDC — quote may not match Agent1 USDC path`,
    );
  }

  let meTokensOutRaw: bigint;
  if (mode === "onchain") {
    if (!diamondAddress) {
      throw new Error(
        "AGENT1_QUOTE_MODE=onchain requires AGENT1_METOKENS_DIAMOND_ADDRESS (fail closed until G2 confirms)",
      );
    }
    meTokensOutRaw = await quoteOnchain(input.meToken, usdcInRaw, diamondAddress);
  } else {
    meTokensOutRaw = quoteMock(usdcInRaw);
    warnings.push("mock_quote_active");
    logger.info("agent1_quote_mock", {
      meToken: input.meToken.meToken,
      usdcAmount: input.usdcAmount,
    });
  }

  return {
    mode,
    inputAsset: BASE_USDC_ADDRESS,
    outputToken: input.meToken.meToken,
    usdcIn: input.usdcAmount,
    usdcInRaw: usdcInRaw.toString(),
    meTokensOut: formatUnits(meTokensOutRaw, METOKEN_DECIMALS),
    meTokensOutRaw: meTokensOutRaw.toString(),
    slippageBpsEstimate: null,
    venue: {
      type: "metokens_diamond_mint_quote",
      diamondAddress: diamondAddress ?? STAGING_METOKENS_DIAMOND_ADDRESS,
      routerConfirmed: false,
      note: buildVenueNote(mode, diamondAddress),
    },
    warnings,
  };
}
