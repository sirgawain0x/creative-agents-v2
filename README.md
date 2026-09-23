# creative-agents-v2

Deployable Next.js App Router scaffold for Creative Agents (`creative-agents` package). Slice D adds a **cron tick loop** that runs policy → quote / dry-run planning — **no live trading or broadcast**.

## Survival First

- **Trading is disabled by default** (`TRADING_ENABLED=false`).
- Slice D may plan/prepare calls via the Slice C dry-run path; it never calls `wallet_sendPreparedCalls` / `wallet_sendCalls`.
- `wouldExecute` and `broadcast` are always `false` on tick and dry-run responses.
- Use `KILL_SWITCH=true` to hard-block any future trading paths.
- Do not add wallet private keys, exchange credentials, or signing secrets to this repo.

## Environment Variables

Copy `.env.example` to `.env.local` for local development:

| Variable | Default | Description |
| --- | --- | --- |
| `TRADING_ENABLED` | `false` | Master gate (Slice D still only dry-runs when true) |
| `KILL_SWITCH` | `false` | Emergency stop — overrides `TRADING_ENABLED` |
| `MAX_TRADE_USDC` | `25` | Max single trade size (USDC) |
| `DAILY_VOLUME_USDC` | `100` | Max daily volume (USDC) |
| `SLIPPAGE_BPS` | `250` | Slippage tolerance (basis points) |
| `COOLDOWN_SECONDS` | `1800` | Cooldown between planned ticks (seconds) |
| `AGENT1_DENIED_METOKENS` | _(empty)_ | Optional comma-separated deny list |
| `SUBGRAPH_PROVIDER_MODE` | `studio` | `studio` (preferred), `goldsky`, or `dual` |
| `GRAPH_STUDIO_CREATIVE_PLATFORM_URL` | Studio creative-platform URL | Locked Studio subgraph endpoint |
| `AGENT1_WALLET_ADDRESS` | _(unset)_ | Wallet for balances + Alchemy prepare `from` |
| `ALCHEMY_API_KEY` | _(unset)_ | Alchemy Wallet API key for `wallet_prepareCalls` |
| `ALCHEMY_GAS_POLICY_ID` | _(unset)_ | Optional Gas Manager policy for sponsored prepare |
| `AGENT1_DRY_RUN_PREPARE` | `true` | When credentials exist, attempt Alchemy prepare during dry-run |
| `BASE_RPC_URL` | _(unset)_ | Base RPC for balance/quote reads |
| `AGENT1_QUOTE_MODE` | `mock` | `mock` or `onchain` |
| `AGENT1_METOKENS_DIAMOND_ADDRESS` | _(unset)_ | **G2 must confirm** before treating as production truth |
| `CRON_SECRET` | _(unset)_ | Bearer token for `/api/agent1/tick` cron auth (**fail-closed when unset**) |
| `AGENT1_TICK_CANDIDATE_LIMIT` | `10` | Max Subscribe entities scanned per tick |
| `AGENT1_TICK_MODEL_ENABLED` | `false` | Optional model path (stub in Slice D; requires keys in Slice E) |

## API Routes

| Route | Description |
| --- | --- |
| `GET /api/agent1/health` | Health, tick state, signer summary, subgraph sample, wallet balances |
| `GET /api/agent1/policy` | Env-driven policy limits, gates, and tick config |
| `GET /api/agent1/signer` | Alchemy signer configuration status (`canBroadcast: false`) |
| `GET/POST /api/agent1/quote` | Read-only USDC → subgraph-listed MeToken quote |
| `GET/POST /api/agent1/dry-run` | Slice C dry-run: quote + planned calls + optional Alchemy prepare |
| `GET/POST /api/agent1/tick` | Slice D tick loop: policy → candidate selection → dry-run plan |
| `GET /api/agent2/health` | Agent 2 stub (future slice) |

### Slice D — `/api/agent1/tick`

Cron-triggered (or manual) tick that **never broadcasts**:

1. Authenticates via `Authorization: Bearer ${CRON_SECRET}` when `CRON_SECRET` is set (401 if missing/wrong; **fail-closed** when unset)
2. Loads policy / kill switch / trading gates
3. Enforces cooldown + daily volume (process-scoped state; resets on cold start)
4. Selects candidate MeToken(s) from subgraph `Subscribe` entities
5. Runs quote + dry-run planning (reuses Slice C path)
6. Always returns `wouldExecute: false`, `broadcast: false`

**Candidate strategy (default):** `newest_subscribe_first` — scans recent `Subscribe` entities (newest first), skips deny-listed / invalid tokens, picks the first eligible MeToken. Optional model path is gated behind `AGENT1_TICK_MODEL_ENABLED` and falls back when model credentials are missing.

**Cron schedule:** every 30 minutes via `vercel.json` (`*/30 * * * *`). Requires `CRON_SECRET` in Vercel env.

**Smoke test:**

```bash
curl -sS -H "Authorization: Bearer $CRON_SECRET" \
  "https://agents.creativeplatform.xyz/api/agent1/tick" | jq .
```

### Slice C — `/api/agent1/dry-run`

Plans a USDC → MeToken mint **without broadcasting**:

1. Policy / size / universe checks (same reject rules as quote)
2. Read-only quote
3. Builds provisional `approve` + `mint` calldata (staging ABI)
4. Optionally calls Alchemy `wallet_prepareCalls` when `ALCHEMY_API_KEY` + `AGENT1_WALLET_ADDRESS` are set
5. Always returns `wouldExecute: false`, `broadcast: false`

**Query (GET):** `?meToken=0x…&usdcAmount=10`

**Body (POST):** `{ "meToken": "0x…", "usdcAmount": "10" }`

### Alchemy session credentials

For Vercel / server dry-runs, set:

1. `ALCHEMY_API_KEY` (Alchemy dashboard → API key with Wallet APIs)
2. `AGENT1_WALLET_ADDRESS` (Agent Wallet / EIP-7702 auth address)
3. Optional `ALCHEMY_GAS_POLICY_ID` for sponsored prepare simulation

CLI Agent Wallet sessions (`alchemy wallet connect --mode session`) are for local/terminal agents — approve in the [Alchemy Agent Wallets dashboard](https://www.alchemy.com/docs/agent-wallets), then use `--dry-run` there. This app uses Wallet APIs `wallet_prepareCalls` only.

### Quote path & G2 blockers

CreativeTV router/diamond addresses are **not G2-confirmed** for production execute.

| Mode | Behavior |
| --- | --- |
| `AGENT1_QUOTE_MODE=mock` (default) | Staging ratio quote; safe when `BASE_RPC_URL` unset |
| `AGENT1_QUOTE_MODE=onchain` | Read-only `calculateMeTokensMinted` on `AGENT1_METOKENS_DIAMOND_ADDRESS` |

Both quote modes set `venue.routerConfirmed: false`. Mint ABI used in dry-run planned calls is **provisional**.

**MeToken discovery:** `Subscribe` subgraph entities. `Register` entities are hub registrations, not the token universe.

## Local Development

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Build & Verify

```bash
pnpm build
pnpm start
pnpm lint
pnpm typecheck
pnpm test
```

## Deploy (Vercel)

Production: [https://agents.creativeplatform.xyz](https://agents.creativeplatform.xyz) (`creative-projects/creative-agents-v2`).

1. Keep `TRADING_ENABLED=false`.
2. Set `CRON_SECRET`, `AGENT1_WALLET_ADDRESS`, and (for prepare) `ALCHEMY_API_KEY` in Vercel env.
3. Redeploy after merging Slice D.

## Slice Roadmap & Blockers

| Slice | Scope | Blockers |
| --- | --- | --- |
| **A** | Scaffold, policy gates, health APIs, logger, cron helper | — |
| **B** | Subgraph MeToken universe, wallet reads, read-only quote API | G2 router/diamond confirm for production onchain quotes |
| **C** | Alchemy Agent Wallet signer status + dry-run (`prepareCalls` only) | Alchemy API key + wallet address in Vercel; G2 mint ABI confirm |
| **D** (current) | Tick loop → policy → quote / dry-run | Model keys (Ollama / AI Gateway); persistent daily-volume store for live execute |
| **E** | Live execute + Gemini + cron | Funding, router confirm, explicit broadcast enablement |
| **F** | Alerts + runbook | Alert channel |

## License

Proprietary — All Rights Reserved. Copyright (c) 2026 Creative Platform, Inc. See [LICENSE](./LICENSE).
