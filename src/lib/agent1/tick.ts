import { isDeniedMeToken } from "@/lib/agent1/deny-list";
import { dryRunUsdcToMeToken, type Agent1DryRunSuccess } from "@/lib/agent1/dry-run";
import {
  listSubscribedMeTokens,
  type SubscribedMeToken,
} from "@/lib/agent1/metokens-subgraph";
import {
  executeTradingNoOp,
  getAgent1Policy,
  type Agent1Policy,
} from "@/lib/agent1/policy";
import {
  checkCooldown,
  checkDailyVolumeCapacity,
  getTickStateSnapshot,
  recordPlannedDryRun,
} from "@/lib/agent1/tick-state";
import { validateMeTokenUniverse } from "@/lib/agent1/universe";
import { logger } from "@/lib/logger";

export const DEFAULT_CANDIDATE_STRATEGY = "newest_subscribe_first" as const;

export type Agent1CandidateStrategy =
  | typeof DEFAULT_CANDIDATE_STRATEGY
  | "model_assisted";

export interface Agent1TickCandidate {
  meToken: string;
  symbol: string;
  name: string;
  hubId: string;
  selected: boolean;
  rejectReason?: string;
}

export interface Agent1TickSuccess {
  ok: true;
  agent: "agent1";
  slice: "D";
  wouldExecute: false;
  broadcast: false;
  timestamp: string;
  policy: Pick<Agent1Policy, "gates" | "limits" | "trading">;
  tickState: ReturnType<typeof getTickStateSnapshot>;
  decision: {
    action: "skipped" | "planned";
    reason: string;
    candidateStrategy: Agent1CandidateStrategy;
    modelUsed: false;
    tradeUsdcAmount: string | null;
  };
  candidatesConsidered: Agent1TickCandidate[];
  dryRun: Agent1DryRunSuccess | null;
  trading: {
    executed: false;
    reason: string;
  };
  warnings: string[];
}

export interface Agent1TickFailure {
  ok: false;
  agent: "agent1";
  slice: "D";
  wouldExecute: false;
  broadcast: false;
  error: string;
  message: string;
  status: number;
}

export type Agent1TickResult = Agent1TickSuccess | Agent1TickFailure;

function parsePositiveInt(value: string | undefined, defaultValue: number): number {
  if (!value?.trim()) {
    return defaultValue;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultValue;
  }
  return parsed;
}

function isModelPathEnabled(): boolean {
  const flag = process.env.AGENT1_TICK_MODEL_ENABLED?.trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(flag ?? "");
}

function hasModelCredentials(): boolean {
  return Boolean(
    process.env.OLLAMA_BASE_URL?.trim() ||
      process.env.AI_GATEWAY_API_KEY?.trim() ||
      process.env.VERCEL_AI_GATEWAY_API_KEY?.trim(),
  );
}

function resolveCandidateStrategy(): Agent1CandidateStrategy {
  if (isModelPathEnabled() && hasModelCredentials()) {
    // Slice D stub: model-assisted path falls back to deterministic selection until keys wired in Slice E.
    return DEFAULT_CANDIDATE_STRATEGY;
  }
  return DEFAULT_CANDIDATE_STRATEGY;
}

function resolveTradeUsdcAmount(policy: Agent1Policy): string {
  const maxTrade = policy.limits.maxTradeUsdc;
  const volumeCheck = checkDailyVolumeCapacity(maxTrade, policy.limits.dailyVolumeUsdc);
  if (!volumeCheck.ok) {
    return "0";
  }
  const amount = Math.min(maxTrade, volumeCheck.remainingUsdc);
  return String(amount);
}

async function loadCandidateUniverse(limit: number): Promise<SubscribedMeToken[]> {
  return listSubscribedMeTokens(limit, 0);
}

async function evaluateCandidates(
  tokens: SubscribedMeToken[],
): Promise<{ candidates: Agent1TickCandidate[]; selected: SubscribedMeToken | null }> {
  const candidates: Agent1TickCandidate[] = [];
  let selected: SubscribedMeToken | null = null;

  for (const token of tokens) {
    if (isDeniedMeToken(token.meToken)) {
      candidates.push({
        meToken: token.meToken,
        symbol: token.symbol,
        name: token.name,
        hubId: token.hubId,
        selected: false,
        rejectReason: "deny_listed",
      });
      continue;
    }

    const universe = await validateMeTokenUniverse(token.meToken);
    if (!universe.ok) {
      candidates.push({
        meToken: token.meToken,
        symbol: token.symbol,
        name: token.name,
        hubId: token.hubId,
        selected: false,
        rejectReason: universe.reason,
      });
      continue;
    }

    if (!selected) {
      selected = token;
      candidates.push({
        meToken: token.meToken,
        symbol: token.symbol,
        name: token.name,
        hubId: token.hubId,
        selected: true,
      });
    } else {
      candidates.push({
        meToken: token.meToken,
        symbol: token.symbol,
        name: token.name,
        hubId: token.hubId,
        selected: false,
        rejectReason: "not_selected",
      });
    }
  }

  return { candidates, selected };
}

export async function runAgent1Tick(): Promise<Agent1TickResult> {
  const policy = getAgent1Policy();
  const tradingNoOp = executeTradingNoOp("slice_d_tick");
  const warnings: string[] = ["slice_d_tick_only", "no_broadcast"];
  const candidateStrategy = resolveCandidateStrategy();
  const candidateLimit = parsePositiveInt(process.env.AGENT1_TICK_CANDIDATE_LIMIT, 10);

  if (isModelPathEnabled() && !hasModelCredentials()) {
    warnings.push("model_enabled_but_credentials_missing");
  }

  const tickState = getTickStateSnapshot();
  const timestamp = new Date().toISOString();

  const baseSuccess = {
    agent: "agent1" as const,
    slice: "D" as const,
    wouldExecute: false as const,
    broadcast: false as const,
    timestamp,
    policy: {
      gates: policy.gates,
      limits: policy.limits,
      trading: policy.trading,
    },
    tickState,
    trading: {
      executed: false as const,
      reason: tradingNoOp.reason,
    },
    warnings,
  };

  if (!policy.gates.tradingEnabled || policy.gates.killSwitch) {
    const reason = policy.gates.killSwitch ? "kill_switch_active" : "trading_disabled";
    logger.info("agent1_tick_skipped", { reason, candidateStrategy });

    return {
      ok: true,
      ...baseSuccess,
      decision: {
        action: "skipped",
        reason,
        candidateStrategy,
        modelUsed: false,
        tradeUsdcAmount: null,
      },
      candidatesConsidered: [],
      dryRun: null,
    };
  }

  const cooldownCheck = checkCooldown(policy.limits.cooldownSeconds);
  if (!cooldownCheck.ok) {
    logger.info("agent1_tick_skipped", {
      reason: cooldownCheck.reason,
      remainingSeconds: cooldownCheck.remainingSeconds,
    });

    return {
      ok: true,
      ...baseSuccess,
      decision: {
        action: "skipped",
        reason: cooldownCheck.reason,
        candidateStrategy,
        modelUsed: false,
        tradeUsdcAmount: null,
      },
      candidatesConsidered: [],
      dryRun: null,
      warnings: [...warnings, "cooldown_active"],
    };
  }

  const tradeUsdcAmount = resolveTradeUsdcAmount(policy);
  const tradeAmountNumber = Number(tradeUsdcAmount);

  if (!Number.isFinite(tradeAmountNumber) || tradeAmountNumber <= 0) {
    logger.info("agent1_tick_skipped", { reason: "daily_volume_exceeded" });

    return {
      ok: true,
      ...baseSuccess,
      decision: {
        action: "skipped",
        reason: "daily_volume_exceeded",
        candidateStrategy,
        modelUsed: false,
        tradeUsdcAmount: null,
      },
      candidatesConsidered: [],
      dryRun: null,
      warnings: [...warnings, "daily_volume_exceeded"],
    };
  }

  let universe: SubscribedMeToken[];
  try {
    universe = await loadCandidateUniverse(candidateLimit);
  } catch (error) {
    return {
      ok: false,
      agent: "agent1",
      slice: "D",
      wouldExecute: false,
      broadcast: false,
      error: "subgraph_unavailable",
      message: error instanceof Error ? error.message : "Subgraph query failed",
      status: 503,
    };
  }

  const { candidates, selected } = await evaluateCandidates(universe);

  if (!selected) {
    logger.info("agent1_tick_skipped", { reason: "no_eligible_candidates" });

    return {
      ok: true,
      ...baseSuccess,
      decision: {
        action: "skipped",
        reason: "no_eligible_candidates",
        candidateStrategy,
        modelUsed: false,
        tradeUsdcAmount: null,
      },
      candidatesConsidered: candidates,
      dryRun: null,
      warnings: [...warnings, "no_eligible_candidates"],
    };
  }

  const dryRun = await dryRunUsdcToMeToken({
    meToken: selected.meToken,
    usdcAmount: tradeUsdcAmount,
  });

  if (!dryRun.ok) {
    logger.info("agent1_tick_dry_run_failed", {
      meToken: selected.meToken.toLowerCase(),
      error: dryRun.error,
    });

    return {
      ok: true,
      ...baseSuccess,
      decision: {
        action: "skipped",
        reason: dryRun.error,
        candidateStrategy,
        modelUsed: false,
        tradeUsdcAmount,
      },
      candidatesConsidered: candidates,
      dryRun: null,
      warnings: [...warnings, "dry_run_failed"],
    };
  }

  const slippageEstimate = dryRun.quote.slippageBpsEstimate;
  if (slippageEstimate !== null && slippageEstimate > policy.limits.slippageBps) {
    logger.info("agent1_tick_skipped", {
      reason: "slippage_exceeded",
      slippageBps: slippageEstimate,
      limitBps: policy.limits.slippageBps,
    });

    return {
      ok: true,
      ...baseSuccess,
      decision: {
        action: "skipped",
        reason: "slippage_exceeded",
        candidateStrategy,
        modelUsed: false,
        tradeUsdcAmount,
      },
      candidatesConsidered: candidates,
      dryRun: null,
      warnings: [...warnings, "slippage_exceeded"],
    };
  }

  if (slippageEstimate === null) {
    warnings.push("slippage_not_estimated");
  }

  recordPlannedDryRun(tradeAmountNumber);

  logger.info("agent1_tick_planned", {
    meToken: selected.meToken.toLowerCase(),
    usdcAmount: tradeUsdcAmount,
    candidateStrategy,
    prepareAttempted: dryRun.alchemyPrepare.attempted,
  });

  return {
    ok: true,
    ...baseSuccess,
    tickState: getTickStateSnapshot(),
    decision: {
      action: "planned",
      reason: "dry_run_planned",
      candidateStrategy,
      modelUsed: false,
      tradeUsdcAmount,
    },
    candidatesConsidered: candidates,
    dryRun,
    warnings,
  };
}
