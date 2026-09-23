import { isAddress, type Address } from "viem";

import { logger } from "@/lib/logger";

/**
 * Alchemy Agent Wallet / Wallet API signer surface.
 *
 * Survival First:
 * - Never expose or require a private key in this module.
 * - Prepare (`wallet_prepareCalls`) is available when API key + wallet are set.
 * - Broadcast (`wallet_sendPreparedCalls`) requires credentials + explicit
 *   `AGENT1_BROADCAST_ENABLED=true`. Policy/venue gates still must pass at call sites.
 */

export type Agent1SignerMode = "unconfigured" | "api_key";

export interface Agent1SignerStatus {
  slice: "C";
  configured: boolean;
  mode: Agent1SignerMode;
  address: Address | null;
  alchemyApiKeyPresent: boolean;
  gasPolicyIdPresent: boolean;
  /** True when API key + wallet address are set — enough for wallet_prepareCalls. */
  canPrepareCalls: boolean;
  /**
   * True when prepare credentials exist and `AGENT1_BROADCAST_ENABLED` is set.
   * Call sites must still enforce TRADING_ENABLED / kill switch / router confirm.
   */
  canBroadcast: boolean;
  note: string;
}

const ALCHEMY_WALLET_RPC = "https://api.g.alchemy.com/v2";

function parseBooleanEnv(value: string | undefined): boolean {
  if (!value?.trim()) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

/** Explicit opt-in for send — never defaulted to true. */
export function isAgent1BroadcastEnabled(): boolean {
  return parseBooleanEnv(process.env.AGENT1_BROADCAST_ENABLED);
}

export function getAlchemyApiKey(): string | null {
  const key =
    process.env.ALCHEMY_API_KEY?.trim() ||
    process.env.ALCHEMY_WALLET_API_KEY?.trim() ||
    null;
  return key || null;
}

export function getAlchemyGasPolicyId(): string | null {
  const id = process.env.ALCHEMY_GAS_POLICY_ID?.trim();
  return id || null;
}

export function getAgent1SignerAddress(): Address | null {
  const raw = process.env.AGENT1_WALLET_ADDRESS?.trim();
  if (!raw || !isAddress(raw)) {
    return null;
  }
  return raw as Address;
}

export function getAlchemyWalletRpcUrl(apiKey?: string | null): string | null {
  const key = apiKey ?? getAlchemyApiKey();
  if (!key) {
    return null;
  }
  return `${ALCHEMY_WALLET_RPC}/${key}`;
}

export function getAgent1SignerStatus(): Agent1SignerStatus {
  const apiKey = getAlchemyApiKey();
  const address = getAgent1SignerAddress();
  const gasPolicyId = getAlchemyGasPolicyId();
  const alchemyApiKeyPresent = Boolean(apiKey);
  const configured = alchemyApiKeyPresent && Boolean(address);
  const mode: Agent1SignerMode = configured ? "api_key" : "unconfigured";
  const broadcastEnabled = isAgent1BroadcastEnabled();
  const canBroadcast = configured && broadcastEnabled;

  let note: string;
  if (!alchemyApiKeyPresent && !address) {
    note =
      "Set ALCHEMY_API_KEY and AGENT1_WALLET_ADDRESS to enable Alchemy wallet_prepareCalls dry-runs. " +
      "Approve Agent Wallet sessions in the Alchemy Dashboard when using CLI session flows. " +
      "Broadcast requires AGENT1_BROADCAST_ENABLED=true plus policy/venue gates.";
  } else if (!alchemyApiKeyPresent) {
    note =
      "AGENT1_WALLET_ADDRESS is set but ALCHEMY_API_KEY is missing — dry-run returns a local plan only.";
  } else if (!address) {
    note =
      "ALCHEMY_API_KEY is set but AGENT1_WALLET_ADDRESS is missing — cannot prepare EIP-7702 calls.";
  } else if (!broadcastEnabled) {
    note =
      "Signer configured for Alchemy wallet_prepareCalls. Broadcast remains disabled until AGENT1_BROADCAST_ENABLED=true.";
  } else {
    note =
      "Signer configured for prepare + sendPreparedCalls. Live execute still requires TRADING_ENABLED, router confirm, and kill switch clear.";
  }

  return {
    slice: "C",
    configured,
    mode,
    address,
    alchemyApiKeyPresent,
    gasPolicyIdPresent: Boolean(gasPolicyId),
    canPrepareCalls: configured,
    canBroadcast,
    note,
  };
}

export interface AlchemyPrepareCallsInput {
  from: Address;
  chainId: `0x${string}`;
  calls: Array<{
    to: Address;
    data?: `0x${string}`;
    value?: `0x${string}`;
  }>;
  gasPolicyId?: string | null;
}

export interface AlchemyPrepareCallsResult {
  ok: true;
  prepared: unknown;
}

export interface AlchemyPrepareCallsFailure {
  ok: false;
  error: string;
  message: string;
}

/**
 * Call Alchemy `wallet_prepareCalls` only.
 * Used by dry-run / tick when credentials are configured.
 */
export async function prepareAlchemyCalls(
  input: AlchemyPrepareCallsInput,
): Promise<AlchemyPrepareCallsResult | AlchemyPrepareCallsFailure> {
  const rpcUrl = getAlchemyWalletRpcUrl();
  if (!rpcUrl) {
    return {
      ok: false,
      error: "alchemy_api_key_missing",
      message: "ALCHEMY_API_KEY is required for wallet_prepareCalls",
    };
  }

  const gasPolicyId = input.gasPolicyId ?? getAlchemyGasPolicyId();
  const params: Record<string, unknown> = {
    from: input.from,
    chainId: input.chainId,
    calls: input.calls,
  };

  if (gasPolicyId) {
    params.capabilities = {
      paymasterService: {
        policyId: gasPolicyId,
      },
    };
  }

  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        id: 1,
        jsonrpc: "2.0",
        method: "wallet_prepareCalls",
        params: [params],
      }),
      cache: "no-store",
    });

    const payload = (await response.json()) as {
      result?: unknown;
      error?: { message?: string; code?: number };
    };

    if (!response.ok || payload.error) {
      const message =
        payload.error?.message ?? `Alchemy prepareCalls HTTP ${response.status}`;
      logger.warn("alchemy_prepare_calls_failed", {
        status: response.status,
        message,
      });
      return {
        ok: false,
        error: "alchemy_prepare_failed",
        message,
      };
    }

    logger.info("alchemy_prepare_calls_ok", {
      from: input.from.toLowerCase(),
      callCount: input.calls.length,
    });

    return { ok: true, prepared: payload.result };
  } catch (error) {
    const message = error instanceof Error ? error.message : "prepare_calls_network_error";
    logger.error("alchemy_prepare_calls_error", { message });
    return {
      ok: false,
      error: "alchemy_prepare_error",
      message,
    };
  }
}

export interface AlchemySendPreparedCallsResult {
  ok: true;
  result: unknown;
}

export interface AlchemySendPreparedCallsFailure {
  ok: false;
  error: string;
  message: string;
}

/** True when a prepare result already includes a signature payload suitable for send. */
export function isSignedPreparedCalls(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record.signature && typeof record.signature === "object") {
    return true;
  }
  if (record.type === "array" && Array.isArray(record.data)) {
    return record.data.every(
      (item) =>
        item &&
        typeof item === "object" &&
        "signature" in (item as Record<string, unknown>),
    );
  }
  return false;
}

/**
 * Call Alchemy `wallet_sendPreparedCalls` with already-signed prepared calls.
 * Fail-closed unless `AGENT1_BROADCAST_ENABLED` and signer credentials are present.
 */
export async function sendPreparedAlchemyCalls(
  signedCalls: unknown,
): Promise<AlchemySendPreparedCallsResult | AlchemySendPreparedCallsFailure> {
  const status = getAgent1SignerStatus();
  if (!status.canBroadcast) {
    return {
      ok: false,
      error: "broadcast_disabled",
      message:
        "wallet_sendPreparedCalls blocked — set AGENT1_BROADCAST_ENABLED=true with Alchemy credentials",
    };
  }

  if (!isSignedPreparedCalls(signedCalls)) {
    return {
      ok: false,
      error: "prepared_calls_unsigned",
      message:
        "Prepared calls are missing a signature. Sign via Agent Wallet / wallet_signPreparedCalls before send.",
    };
  }

  const rpcUrl = getAlchemyWalletRpcUrl();
  if (!rpcUrl) {
    return {
      ok: false,
      error: "alchemy_api_key_missing",
      message: "ALCHEMY_API_KEY is required for wallet_sendPreparedCalls",
    };
  }

  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        id: 1,
        jsonrpc: "2.0",
        method: "wallet_sendPreparedCalls",
        params: [signedCalls],
      }),
      cache: "no-store",
    });

    const payload = (await response.json()) as {
      result?: unknown;
      error?: { message?: string; code?: number };
    };

    if (!response.ok || payload.error) {
      const message =
        payload.error?.message ?? `Alchemy sendPreparedCalls HTTP ${response.status}`;
      logger.warn("alchemy_send_prepared_calls_failed", {
        status: response.status,
        message,
      });
      return {
        ok: false,
        error: "alchemy_send_failed",
        message,
      };
    }

    logger.info("alchemy_send_prepared_calls_ok", {
      address: status.address?.toLowerCase() ?? null,
    });

    return { ok: true, result: payload.result };
  } catch (error) {
    const message = error instanceof Error ? error.message : "send_prepared_calls_network_error";
    logger.error("alchemy_send_prepared_calls_error", { message });
    return {
      ok: false,
      error: "alchemy_send_error",
      message,
    };
  }
}
