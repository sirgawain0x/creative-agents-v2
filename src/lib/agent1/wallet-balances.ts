import { createPublicClient, erc20Abi, formatUnits, http, type Address } from "viem";
import { base } from "viem/chains";

import { BASE_USDC_ADDRESS, METOKEN_DECIMALS, USDC_DECIMALS } from "@/lib/agent1/constants";
import {
  getMeTokenBalancesForUser,
  listSubscribedMeTokens,
  type SubscribedMeToken,
} from "@/lib/agent1/metokens-subgraph";
import { logger } from "@/lib/logger";

export interface WalletUsdcBalance {
  token: typeof BASE_USDC_ADDRESS;
  raw: string;
  formatted: string;
  decimals: number;
}

export interface WalletMeTokenBalance {
  meToken: string;
  symbol: string;
  name: string;
  hubId: string;
  raw: string;
  formatted: string;
  decimals: number;
  subgraphListed: true;
}

export interface Agent1WalletBalances {
  wallet: string;
  usdc: WalletUsdcBalance | null;
  meTokens: WalletMeTokenBalance[];
  readOnly: true;
}

function getBaseRpcUrl(): string | undefined {
  return process.env.BASE_RPC_URL?.trim() || process.env.ALCHEMY_BASE_RPC_URL?.trim();
}

function getAgent1WalletAddress(): string | undefined {
  return process.env.AGENT1_WALLET_ADDRESS?.trim();
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

export async function getWalletUsdcBalance(
  walletAddress: string,
): Promise<WalletUsdcBalance | null> {
  const client = createBaseClient();
  if (!client) {
    logger.warn("wallet_usdc_balance_skipped", { reason: "BASE_RPC_URL unset" });
    return null;
  }

  const balance = await client.readContract({
    address: BASE_USDC_ADDRESS,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [walletAddress as Address],
  });

  return {
    token: BASE_USDC_ADDRESS,
    raw: balance.toString(),
    formatted: formatUnits(balance, USDC_DECIMALS),
    decimals: USDC_DECIMALS,
  };
}

function indexSubscribedMeTokens(tokens: SubscribedMeToken[]): Map<string, SubscribedMeToken> {
  const map = new Map<string, SubscribedMeToken>();
  for (const token of tokens) {
    map.set(token.meToken.toLowerCase(), token);
  }
  return map;
}

export async function getWalletMeTokenBalances(
  walletAddress: string,
): Promise<WalletMeTokenBalance[]> {
  const [subscribed, balances] = await Promise.all([
    listSubscribedMeTokens(200, 0),
    getMeTokenBalancesForUser(walletAddress, 200, 0),
  ]);

  const subscribedByAddress = indexSubscribedMeTokens(subscribed);

  const held: WalletMeTokenBalance[] = [];
  for (const row of balances) {
    const listing = subscribedByAddress.get(row.meToken.toLowerCase());
    if (!listing) {
      continue;
    }

    held.push({
      meToken: listing.meToken,
      symbol: listing.symbol,
      name: listing.name,
      hubId: listing.hubId,
      raw: row.balance,
      formatted: formatUnits(BigInt(row.balance), METOKEN_DECIMALS),
      decimals: METOKEN_DECIMALS,
      subgraphListed: true,
    });
  }

  return held;
}

export async function getAgent1WalletBalances(): Promise<Agent1WalletBalances | null> {
  const wallet = getAgent1WalletAddress();
  if (!wallet) {
    return null;
  }

  const [usdc, meTokens] = await Promise.all([
    getWalletUsdcBalance(wallet),
    getWalletMeTokenBalances(wallet),
  ]);

  return {
    wallet: wallet.toLowerCase(),
    usdc,
    meTokens,
    readOnly: true,
  };
}
