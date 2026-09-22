import { isAddress, type Address } from "viem";

import { logger } from "@/lib/logger";

/**
 * Slice C — Alchemy Agent Wallet / Wallet API signer surface.
 *
 * Survival First:
 * - Never expose or require a private key in this module.
 * - Slice C can prepare/simulate only — `canBroadcast` is always false.
 * - Live send (`wallet_sendPreparedCalls` / `wallet_sendCalls`) is Slice E+.
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
  /** Always false in Slice C. */
  canBroadcast: false;
  note: string;
}

const ALCHEMY_WALLET_RPC = "https://api.g.alchemy.com/v2";

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

  let note: string;
  if (!alchemyApiKeyPresent && !address) {
    note =
      "Set ALCHEMY_API_KEY and AGENT1_WALLET_ADDRESS to enable Alchemy wallet_prepareCalls dry-runs. " +
      "Approve Agent Wallet sessions in the Alchemy Dashboard when using CLI session flows. " +
      "Slice C never broadcasts.";
  } else if (!alchemyApiKeyPresent) {
    note =
      "AGENT1_WALLET_ADDRESS is set but ALCHEMY_API_KEY is missing — dry-run returns a local plan only.";
  } else if (!address) {
    note =
      "ALCHEMY_API_KEY is set but AGENT1_WALLET_ADDRESS is missing — cannot prepare EIP-7702 calls.";
  } else {
    note =
      "Signer configured for Alchemy wallet_prepareCalls. Slice C dry-run may prepare; broadcast remains disabled until Slice E.";
  }

  return {
    slice: "C",
    configured,
    mode,
    address,
    alchemyApiKeyPresent,
    gasPolicyIdPresent: Boolean(gasPolicyId),
    canPrepareCalls: configured,
    canBroadcast: false,
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
 * Call Alchemy `wallet_prepareCalls` only — never `wallet_sendPreparedCalls`.
 * Used by Slice C dry-run when credentials are configured.
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
