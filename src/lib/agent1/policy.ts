import { logger } from "@/lib/logger";

export const DEFAULT_SUBGRAPH_URL =
  "https://api.studio.thegraph.com/query/3405/creative-platform/version/latest";

export interface Agent1PolicyLimits {
  maxTradeUsdc: number;
  dailyVolumeUsdc: number;
  slippageBps: number;
  cooldownSeconds: number;
}

export interface Agent1PolicyGates {
  tradingEnabled: boolean;
  killSwitch: boolean;
}

export interface Agent1Policy {
  agent: "agent1";
  version: "slice-a";
  subgraphUrl: string;
  limits: Agent1PolicyLimits;
  gates: Agent1PolicyGates;
  trading: {
    mode: "disabled" | "noop";
    reason: string;
  };
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value.trim() === "") {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return defaultValue;
}

function parsePositiveNumber(
  value: string | undefined,
  defaultValue: number,
  field: string,
): number {
  if (value === undefined || value.trim() === "") {
    return defaultValue;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    logger.warn("policy_invalid_number", { field, value, fallback: defaultValue });
    return defaultValue;
  }

  return parsed;
}

export function getAgent1Policy(): Agent1Policy {
  const tradingEnabled = parseBoolean(process.env.TRADING_ENABLED, false);
  const killSwitch = parseBoolean(process.env.KILL_SWITCH, false);
  const tradingBlocked = !tradingEnabled || killSwitch;

  const limits: Agent1PolicyLimits = {
    maxTradeUsdc: parsePositiveNumber(process.env.MAX_TRADE_USDC, 25, "MAX_TRADE_USDC"),
    dailyVolumeUsdc: parsePositiveNumber(
      process.env.DAILY_VOLUME_USDC,
      100,
      "DAILY_VOLUME_USDC",
    ),
    slippageBps: parsePositiveNumber(process.env.SLIPPAGE_BPS, 250, "SLIPPAGE_BPS"),
    cooldownSeconds: parsePositiveNumber(
      process.env.COOLDOWN_SECONDS,
      1800,
      "COOLDOWN_SECONDS",
    ),
  };

  const subgraphUrl = process.env.SUBGRAPH_URL?.trim() || DEFAULT_SUBGRAPH_URL;

  let reason = "trading_disabled_by_default";
  if (killSwitch) {
    reason = "kill_switch_active";
  } else if (tradingEnabled) {
    reason = "trading_enabled_but_slice_a_noop";
  }

  return {
    agent: "agent1",
    version: "slice-a",
    subgraphUrl,
    limits,
    gates: {
      tradingEnabled,
      killSwitch,
    },
    trading: {
      mode: tradingBlocked ? "disabled" : "noop",
      reason,
    },
  };
}

export interface TradingNoOpResult {
  executed: false;
  reason: string;
  policy: Agent1Policy;
}

export function executeTradingNoOp(intent?: string): TradingNoOpResult {
  const policy = getAgent1Policy();
  const blocked = !policy.gates.tradingEnabled || policy.gates.killSwitch;

  const reason = blocked
    ? policy.gates.killSwitch
      ? "kill_switch_active"
      : "trading_disabled"
    : "slice_a_noop_only";

  logger.info("trading_noop", {
    intent,
    reason,
    tradingEnabled: policy.gates.tradingEnabled,
    killSwitch: policy.gates.killSwitch,
  });

  return {
    executed: false,
    reason,
    policy,
  };
}
