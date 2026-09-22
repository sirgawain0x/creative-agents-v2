import {
  encodeFunctionData,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import { base } from "viem/chains";

import {
  BASE_USDC_ADDRESS,
  STAGING_METOKENS_DIAMOND_ADDRESS,
  USDC_DECIMALS,
} from "@/lib/agent1/constants";
import {
  executeTradingNoOp,
  getAgent1Policy,
  type Agent1Policy,
} from "@/lib/agent1/policy";
import { quoteUsdcToMeToken, type Agent1QuoteResult } from "@/lib/agent1/quote";
import {
  getAgent1SignerStatus,
  prepareAlchemyCalls,
  type Agent1SignerStatus,
} from "@/lib/agent1/signer";
import {
  validateMeTokenUniverse,
  type UniverseValidationFailure,
} from "@/lib/agent1/universe";
import { logger } from "@/lib/logger";

/**
 * Provisional FoundryFacet mint ABI for dry-run calldata only.
 * G2 must confirm diamond address + ABI before Slice E live execute.
 */
const mintAbi = [
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
] as const;

const erc20ApproveAbi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export interface PlannedCall {
  step: "approve_usdc" | "mint_metoken";
  to: Address;
  data: Hex;
  value: "0x0";
  description: string;
}

export interface Agent1DryRunSuccess {
  ok: true;
  agent: "agent1";
  slice: "C";
  wouldExecute: false;
  broadcast: false;
  meToken: {
    address: string;
    symbol: string;
    name: string;
    hubId: string;
  };
  quote: Agent1QuoteResult;
  plannedCalls: PlannedCall[];
  signer: Agent1SignerStatus;
  alchemyPrepare:
    | { attempted: false; reason: string }
    | { attempted: true; ok: true; prepared: unknown }
    | { attempted: true; ok: false; error: string; message: string };
  trading: {
    executed: false;
    reason: string;
  };
  policy: Pick<Agent1Policy, "gates" | "limits" | "trading">;
  warnings: string[];
}

export interface Agent1DryRunFailure {
  ok: false;
  agent: "agent1";
  slice: "C";
  wouldExecute: false;
  broadcast: false;
  error: string;
  message: string;
  status: number;
}

export type Agent1DryRunResult = Agent1DryRunSuccess | Agent1DryRunFailure;

function getDiamondAddressForPlan(): Address {
  const configured = process.env.AGENT1_METOKENS_DIAMOND_ADDRESS?.trim();
  if (configured) {
    return configured as Address;
  }
  return STAGING_METOKENS_DIAMOND_ADDRESS;
}

function shouldAttemptAlchemyPrepare(signer: Agent1SignerStatus): boolean {
  if (!signer.canPrepareCalls) {
    return false;
  }
  const flag = process.env.AGENT1_DRY_RUN_PREPARE?.trim().toLowerCase();
  // Default ON when credentials exist; set AGENT1_DRY_RUN_PREPARE=false to skip remote prepare.
  if (flag === "0" || flag === "false" || flag === "off" || flag === "no") {
    return false;
  }
  return true;
}

function buildPlannedCalls(meToken: Address, usdcAmount: string): PlannedCall[] {
  const diamond = getDiamondAddressForPlan();
  const usdcRaw = parseUnits(usdcAmount, USDC_DECIMALS);

  const approveData = encodeFunctionData({
    abi: erc20ApproveAbi,
    functionName: "approve",
    args: [diamond, usdcRaw],
  });

  const mintData = encodeFunctionData({
    abi: mintAbi,
    functionName: "mint",
    args: [meToken, usdcRaw],
  });

  return [
    {
      step: "approve_usdc",
      to: BASE_USDC_ADDRESS,
      data: approveData,
      value: "0x0",
      description: `Approve ${usdcAmount} USDC to MeTokens diamond for mint`,
    },
    {
      step: "mint_metoken",
      to: diamond,
      data: mintData,
      value: "0x0",
      description: `Mint MeToken ${meToken} by depositing ${usdcAmount} USDC (staging ABI)`,
    },
  ];
}

export async function dryRunUsdcToMeToken(input: {
  meToken?: string;
  usdcAmount?: string;
}): Promise<Agent1DryRunResult> {
  const policy = getAgent1Policy();
  const signer = getAgent1SignerStatus();
  const tradingNoOp = executeTradingNoOp("slice_c_dry_run");

  if (!input.meToken) {
    return {
      ok: false,
      agent: "agent1",
      slice: "C",
      wouldExecute: false,
      broadcast: false,
      error: "missing_metoken",
      message: "meToken address is required",
      status: 400,
    };
  }

  if (!input.usdcAmount) {
    return {
      ok: false,
      agent: "agent1",
      slice: "C",
      wouldExecute: false,
      broadcast: false,
      error: "missing_amount",
      message: "usdcAmount is required",
      status: 400,
    };
  }

  const usdcAmountNumber = Number(input.usdcAmount);
  if (!Number.isFinite(usdcAmountNumber) || usdcAmountNumber <= 0) {
    return {
      ok: false,
      agent: "agent1",
      slice: "C",
      wouldExecute: false,
      broadcast: false,
      error: "invalid_amount",
      message: "usdcAmount must be a positive number",
      status: 400,
    };
  }

  if (usdcAmountNumber > policy.limits.maxTradeUsdc) {
    return {
      ok: false,
      agent: "agent1",
      slice: "C",
      wouldExecute: false,
      broadcast: false,
      error: "oversize",
      message: `usdcAmount exceeds MAX_TRADE_USDC (${policy.limits.maxTradeUsdc})`,
      status: 400,
    };
  }

  const universe = await validateMeTokenUniverse(input.meToken);
  if (!universe.ok) {
    const failure = universe as UniverseValidationFailure;
    const status = failure.reason === "invalid_address" ? 400 : 403;
    logger.info("agent1_dry_run_rejected", {
      meToken: input.meToken.toLowerCase(),
      reason: failure.reason,
    });
    return {
      ok: false,
      agent: "agent1",
      slice: "C",
      wouldExecute: false,
      broadcast: false,
      error: failure.reason,
      message: failure.message,
      status,
    };
  }

  const warnings: string[] = [
    "slice_c_dry_run_only",
    "router_unconfirmed",
    "mint_abi_provisional",
  ];

  if (policy.gates.killSwitch) {
    warnings.push("kill_switch_active");
  }
  if (!policy.gates.tradingEnabled) {
    warnings.push("trading_disabled");
  }

  let quote: Agent1QuoteResult;
  try {
    quote = await quoteUsdcToMeToken({
      meToken: universe.meToken,
      usdcAmount: String(usdcAmountNumber),
    });
  } catch (error) {
    return {
      ok: false,
      agent: "agent1",
      slice: "C",
      wouldExecute: false,
      broadcast: false,
      error: "quote_failed",
      message: error instanceof Error ? error.message : "Quote failed",
      status: 503,
    };
  }

  const plannedCalls = buildPlannedCalls(
    universe.meToken.meToken as Address,
    String(usdcAmountNumber),
  );

  let alchemyPrepare: Agent1DryRunSuccess["alchemyPrepare"];

  if (!shouldAttemptAlchemyPrepare(signer)) {
    alchemyPrepare = {
      attempted: false,
      reason: signer.canPrepareCalls
        ? "AGENT1_DRY_RUN_PREPARE disabled"
        : "signer_unconfigured",
    };
  } else if (!signer.address) {
    alchemyPrepare = {
      attempted: false,
      reason: "signer_address_missing",
    };
  } else {
    const prepare = await prepareAlchemyCalls({
      from: signer.address,
      chainId: `0x${base.id.toString(16)}`,
      calls: plannedCalls.map((call) => ({
        to: call.to,
        data: call.data,
        value: call.value,
      })),
    });

    if (prepare.ok) {
      alchemyPrepare = {
        attempted: true,
        ok: true,
        prepared: prepare.prepared,
      };
    } else {
      alchemyPrepare = {
        attempted: true,
        ok: false,
        error: prepare.error,
        message: prepare.message,
      };
      warnings.push("alchemy_prepare_failed");
    }
  }

  logger.info("agent1_dry_run", {
    meToken: universe.meToken.meToken.toLowerCase(),
    usdcAmount: String(usdcAmountNumber),
    prepareAttempted: alchemyPrepare.attempted,
    tradingReason: tradingNoOp.reason,
  });

  return {
    ok: true,
    agent: "agent1",
    slice: "C",
    wouldExecute: false,
    broadcast: false,
    meToken: {
      address: universe.meToken.meToken,
      symbol: universe.meToken.symbol,
      name: universe.meToken.name,
      hubId: universe.meToken.hubId,
    },
    quote,
    plannedCalls,
    signer,
    alchemyPrepare,
    trading: {
      executed: false,
      reason: tradingNoOp.reason,
    },
    policy: {
      gates: policy.gates,
      limits: policy.limits,
      trading: policy.trading,
    },
    warnings,
  };
}
