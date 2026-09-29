# Agent 1 — Router confirm checklist (Slice E)

**Trading stays off by default.** This document is evidence for G2 to opt in to the **confirmed** FoundryFacet mint path. Do not set `TRADING_ENABLED`, `AGENT1_BROADCAST_ENABLED`, or `AGENT1_ROUTER_CONFIRMED` in code defaults.

## Production snapshot (2026-09-24)

| Field | Value |
| --- | --- |
| Slice | `E-live` |
| `trading` | disabled |
| `venue.routerConfirmed` | `false` (expected until G2 flip) |
| `venue.abiLabel` | `foundry-facet-v1-provisional` |
| Agent wallet | `0x8f8c5df780cab54adfc5a8fdd8406d91bac5bf10` (~4.51 USDC — ops funding) |

## Verified Base addresses

| Role | Address | Source |
| --- | --- | --- |
| MeTokens Diamond (FoundryFacet) | `0xba5502db2aC2cBff189965e991C07109B14eB3f5` | Vercel env + `STAGING_METOKENS_DIAMOND_ADDRESS` |
| Hub-2 USDC vault (approve target) | `0xd4b3f4d2c44Feba751F30e19D7e1047A29eE085d` | Vercel env + `STAGING_HUB2_USDC_VAULT` |
| Base USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | `BASE_USDC_ADDRESS` |

Cross-checked against sibling repos:

- `sirgawain0x/code-alliance-dao` — `config/metoken.ts`, `components/buy-crtv.tsx` (approve vault → `mint(meToken, amount, recipient)` on diamond)
- `sirgawain0x/crtv3` — `useMeTokens.ts` / market buy hooks (same 3-arg `mint` on diamond; `calculateMeTokensMinted` for quotes)

## ABI lock — live mint path (`foundry-facet-v1-confirmed`)

| Step | Contract | Function | Signature | Selector |
| --- | --- | --- | --- | --- |
| 1 | Base USDC | `approve` | `approve(address,uint256)` | `0x095ea7b3` |
| 1 spender | Hub-2 vault | — | `0xd4b3f4d2c44Feba751F30e19D7e1047A29eE085d` | — |
| 2 | Diamond | `mint` | `mint(address,uint256,address)` | `0x0d4d1513` |
| Quote (read) | Diamond | `calculateMeTokensMinted` | `calculateMeTokensMinted(address,uint256)` | `0xb9aa404a` |

Implementation: `src/lib/agent1/venue.ts` (`confirmedMintAbi`, `foundryQuoteAbi`), planned calls in `src/lib/agent1/dry-run.ts`.

Automated evidence: `tests/agent1/abi-selectors.test.ts`.

## Provisional label vs live (`foundry-facet-v1-provisional`)

Until router confirm, health/dry-run use **intentionally wrong** calldata for execute safety:

- Approve USDC to the **diamond** (not the hub vault)
- `mint(address,uint256)` (2-arg) — selector `0x40c10f19`, **not** the FoundryFacet 3-arg mint

**Provisional does not match live mint.** That is by design (fail-closed). On-chain quotes via `calculateMeTokensMinted` already match live when `AGENT1_QUOTE_MODE=onchain` and diamond env are set.

## G2 opt-in (single env flip for ABI lock)

After reviewing this checklist and sibling buy flows:

1. Ensure Vercel already has `AGENT1_METOKENS_DIAMOND_ADDRESS` and `AGENT1_HUB2_USDC_VAULT_ADDRESS` (production does).
2. Set **`AGENT1_ROUTER_CONFIRMED=true`** in Vercel only (never in repo defaults).
3. Verify: `GET /api/agent1/venue` → `routerConfirmed: true`, `abiLabel: foundry-facet-v1-confirmed`, `mintPath: confirmed_approve_hub_vault`.
4. Smoke: `GET /api/agent1/dry-run?meToken=<subscribed>&usdcAmount=1` → planned approve to hub vault + 3-arg mint calldata.

**Still required before any live broadcast (separate gates):**

- `TRADING_ENABLED=true` (master — keep `false` until ops)
- `AGENT1_BROADCAST_ENABLED=true`
- `KILL_SWITCH` clear, signer + signed prepared calls, wallet funded (~$250 USDC target)

## Persistent tick store

Daily volume + cooldown use Upstash (`UPSTASH_REDIS_REST_*` or Vercel `KV_REST_API_*`). Production reports `persistent: true`. No in-memory-only path when KV credentials are present (`src/lib/agent1/tick-state-store.ts`).

## Blocker status (code vs G2)

| Blocker | Code status | G2 / ops |
| --- | --- | --- |
| Vault / wallet seed | Calldata path ready when confirmed | Fund agent wallet (~$250 USDC) |
| Diamond / router confirm | ABIs match live; staging addresses in constants | Set `AGENT1_ROUTER_CONFIRMED=true` |
| Mint ABI lock | `foundry-facet-v1-confirmed` matches DAO/crtv3 | Flip router confirm env |
| Persistent store | Upstash-backed tick state complete | Already on prod (verify via health `tick.store`) |
