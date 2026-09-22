# creative-agents-v2

Deployable Next.js App Router scaffold for Creative Agents (`creative-agents` package). Slice C adds Alchemy Agent Wallet signer status and **dry-run** trade planning (`wallet_prepareCalls` only) — **no live trading or broadcast**.

## Survival First

- **Trading is disabled by default** (`TRADING_ENABLED=false`).
- Slice C may plan/prepare calls; it never calls `wallet_sendPreparedCalls` / `wallet_sendCalls`.
- `wouldExecute` and `broadcast` are always `false` on dry-run responses.
- Use `KILL_SWITCH=true` to hard-block any future trading paths.
- Do not add wallet private keys, exchange credentials, or signing secrets to this repo.

## Environment Variables

Copy `.env.example` to `.env.local` for local development:

| Variable | Default | Description |
| --- | --- | --- |
| `TRADING_ENABLED` | `false` | Master gate (Slice C still only dry-runs when true) |
| `KILL_SWITCH` | `false` | Emergency stop — overrides `TRADING_ENABLED` |
| `MAX_TRADE_USDC` | `25` | Max single trade size (USDC) |
| `DAILY_VOLUME_USDC` | `100` | Max daily volume (USDC) |
| `SLIPPAGE_BPS` | `250` | Slippage tolerance (basis points) |
| `COOLDOWN_SECONDS` | `1800` | Cooldown between trades (seconds) |
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
| `CRON_SECRET` | _(unset)_ | Bearer token for future `/api/agent1/tick` cron auth |

## API Routes

| Route | Description |
| --- | --- |
| `GET /api/agent1/health` | Health, signer summary, subgraph sample, wallet balances |
| `GET /api/agent1/policy` | Env-driven policy limits and gates |
| `GET /api/agent1/signer` | Alchemy signer configuration status (`canBroadcast: false`) |
| `GET/POST /api/agent1/quote` | Read-only USDC → subgraph-listed MeToken quote |
| `GET/POST /api/agent1/dry-run` | Slice C dry-run: quote + planned calls + optional Alchemy prepare |
| `GET /api/agent2/health` | Agent 2 stub (future slice) |

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
3. Redeploy after merging Slice C.

## Slice Roadmap & Blockers

| Slice | Scope | Blockers |
| --- | --- | --- |
| **A** | Scaffold, policy gates, health APIs, logger, cron helper | — |
| **B** | Subgraph MeToken universe, wallet reads, read-only quote API | G2 router/diamond confirm for production onchain quotes |
| **C** (current) | Alchemy Agent Wallet signer status + dry-run (`prepareCalls` only) | Alchemy API key + wallet address in Vercel; G2 mint ABI confirm |
| **D** | Tick loop → policy → quote / dry-run | Model keys (Ollama / AI Gateway) |
| **E** | Live execute + Gemini + cron | Funding, router confirm, explicit broadcast enablement |
| **F** | Alerts + runbook | Alert channel |

## License

Proprietary — All Rights Reserved. Copyright (c) 2026 Creative Platform, Inc. See [LICENSE](./LICENSE).
