import { createPublicClient, formatUnits, http, parseUnits, type Address } from "viem";
import { base } from "viem/chains";

import { BASE_USDC_ADDRESS, METOKEN_DECIMALS, USDC_DECIMALS } from "@/lib/agent1/constants";
import type { SubscribedMeToken } from "@/lib/agent1/metokens-subgraph";
import {
  buildQuoteVenueBlock,
  foundryQuoteAbi,
  getConfiguredDiamondAddress,
  getQuoteModeFromEnv,
  type Agent1QuoteVenue,
} from "@/lib/agent1/venue";
import { logger } from "@/lib/logger";

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
  venue: Agent1QuoteVenue;
  warnings: string[];
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
  const mode = getQuoteModeFromEnv();
  const diamondAddress = getConfiguredDiamondAddress();
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

  const venue = buildQuoteVenueBlock(mode);
  if (!venue.routerConfirmed) {
    warnings.push("router_unconfirmed");
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
    venue,
    warnings,
  };
}
