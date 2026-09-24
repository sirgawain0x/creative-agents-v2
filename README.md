# creative-agents-v2

Deployable Next.js App Router scaffold for Creative Agents (`creative-agents` package). **Slice E live** adds gated Alchemy `wallet_sendPreparedCalls` broadcast and optional Gemini/AI Gateway tick candidate assist — **still fail-closed** until explicit env gates are set.

## Survival First

- **Trading is disabled by default** (`TRADING_ENABLED=false`).
- **Broadcast is disabled by default** (`AGENT1_BROADCAST_ENABLED=false`).
- Dry-run never calls `wallet_sendPreparedCalls` / `wallet_sendCalls`.
- Tick may broadcast only when **all** of these are true: `TRADING_ENABLED`, `AGENT1_BROADCAST_ENABLED`, G2 `AGENT1_ROUTER_CONFIRMED` (+ diamond), kill switch clear, signer credentials present, and signed prepared calls available.
- Use `KILL_SWITCH=true` to hard-block trading paths.
- Do not add wallet private keys, exchange credentials, or signing secrets to this repo.

## Environment Variables

Copy `.env.example` to `.env.local` for local development:

| Variable | Default | Description |
| --- | --- | --- |
| `TRADING_ENABLED` | `false` | Master gate (tick plans when true; broadcast still gated) |
| `KILL_SWITCH` | `false` | Emergency stop — overrides `TRADING_ENABLED` |
| `AGENT1_BROADCAST_ENABLED` | `false` | **Explicit** live send opt-in for `wallet_sendPreparedCalls` |
| `MAX_TRADE_USDC` | `25` | Max single trade size (USDC) |
| `DAILY_VOLUME_USDC` | `100` | Max daily volume (USDC) |
| `SLIPPAGE_BPS` | `250` | Slippage tolerance (basis points) |
| `COOLDOWN_SECONDS` | `1800` | Cooldown between planned ticks (seconds) |
| `AGENT1_DENIED_METOKENS` | _(empty)_ | Optional comma-separated deny list |
| `SUBGRAPH_PROVIDER_MODE` | `studio` | `studio` (preferred), `goldsky`, or `dual` |
| `GRAPH_STUDIO_CREATIVE_PLATFORM_URL` | Studio creative-platform URL | Locked Studio subgraph endpoint |
| `AGENT1_WALLET_ADDRESS` | _(unset)_ | Wallet for balances + Alchemy prepare `from` |
| `ALCHEMY_API_KEY` | _(unset)_ | Alchemy Wallet API key for prepare/send |
| `ALCHEMY_GAS_POLICY_ID` | _(unset)_ | Optional Gas Manager policy for sponsored prepare |
| `AGENT1_DRY_RUN_PREPARE` | `true` | When credentials exist, attempt Alchemy prepare during dry-run |
| `BASE_RPC_URL` | _(unset)_ | Base RPC for balance/quote reads |
| `AGENT1_QUOTE_MODE` | `mock` | `mock` or `onchain` |
| `AGENT1_METOKENS_DIAMOND_ADDRESS` | _(unset)_ | Candidate MeTokens Diamond on Base (**G2 confirm**) |
| `AGENT1_HUB2_USDC_VAULT_ADDRESS` | _(unset)_ | Candidate Hub-2 USDC vault for approve path |
| `AGENT1_ROUTER_CONFIRMED` | _(unset/false)_ | **Explicit G2 opt-in** — never auto-set in code |
| `UPSTASH_REDIS_REST_URL` | _(unset)_ | Upstash Redis REST URL for durable tick state |
| `UPSTASH_REDIS_REST_TOKEN` | _(unset)_ | Upstash Redis REST token (pair with URL) |
| `CRON_SECRET` | _(unset)_ | Bearer token for `/api/agent1/tick` cron auth (**fail-closed when unset**) |
| `AGENT1_TICK_CANDIDATE_LIMIT` | `10` | Max Subscribe entities scanned per tick |
| `AGENT1_TICK_MODEL_ENABLED` | `false` | Optional Gemini / AI Gateway / Ollama candidate assist |
| `GEMINI_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY` | _(unset)_ | Google Generative AI key for tick model |
| `AI_GATEWAY_API_KEY` | _(unset)_ | Vercel AI Gateway key (Gemini via OpenAI-compatible chat) |
| `AGENT1_TICK_MODEL` / `GEMINI_MODEL` | `gemini-2.0-flash` | Model id for tick assist |

## API Routes

| Route | Description |
| --- | --- |
| `GET /api/agent1/health` | Health, tick store state, venue summary, signer, subgraph sample |
| `GET /api/agent1/policy` | Env-driven policy limits, gates, tick store, venue confirm |
| `GET /api/agent1/venue` | Read-only venue status (addresses, ABI label, `routerConfirmed`, `broadcastAllowed`) |
| `GET /api/agent1/signer` | Alchemy signer configuration status (`canBroadcast` gated) |
| `GET/POST /api/agent1/quote` | Read-only USDC → subgraph-listed MeToken quote |
| `GET/POST /api/agent1/dry-run` | Dry-run: quote + planned calls + optional Alchemy prepare (**never broadcasts**) |
| `GET/POST /api/agent1/tick` | Cron tick: policy → candidates → dry-run → optional gated broadcast |
| `GET /api/agent2/health` | Agent 2 stub (future slice) |

### Slice E live — gated broadcast

Live execute path (tick only):

1. Policy / kill switch / trading gates
2. Durable cooldown + daily volume
3. Optional Gemini/AI Gateway candidate selection when `AGENT1_TICK_MODEL_ENABLED`
4. Quote + dry-run plan (+ Alchemy `wallet_prepareCalls` when configured)
5. If `venue.gates.broadcastAllowed` **and** `signer.canBroadcast` **and** prepare returned **signed** calls → `wallet_sendPreparedCalls`
6. Otherwise returns `decision.action: "planned"` with `broadcast: false`

Unsigned prepare results fail closed (`prepared_calls_unsigned`) — sign via Agent Wallet / `wallet_signPreparedCalls` before send. No private keys in this repo.

### Durable tick state

Daily USDC volume (UTC day key) and last-planned cooldown timestamp persist via **Upstash Redis REST** when `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` are set (or Vercel `KV_REST_API_*`). Without them, the app uses an in-memory store (fine for local dev; **not** durable across Vercel cold starts).

If the store errors on read/write, the tick **fail-closes** (`decision.reason: tick_store_error`).

### Venue confirm

Candidate Creative Platform Base addresses (from contract inventory):

| Role | Candidate default |
| --- | --- |
| MeTokens Diamond | `0xba5502db2aC2cBff189965e991C07109B14eB3f5` |
| Hub-2 USDC vault | `0xd4b3f4d2c44Feba751F30e19D7e1047A29eE085d` |

Mint path when **confirmed**: approve USDC → Hub-2 vault → `FoundryFacet.mint(meToken, assetsDeposited, recipient)` on the Diamond. Quotes use `calculateMeTokensMinted` on the Diamond.

Until `AGENT1_ROUTER_CONFIRMED=true` **and** `AGENT1_METOKENS_DIAMOND_ADDRESS` is set, responses keep `venue.routerConfirmed: false` and provisional approve-to-diamond calldata.

G2 checklist with verified selectors and addresses: [docs/AGENT1_ROUTER_CONFIRM.md](./docs/AGENT1_ROUTER_CONFIRM.md).

### `/api/agent1/tick`

Cron-triggered (or manual) tick:

1. Authenticates via `Authorization: Bearer ${CRON_SECRET}` (**fail-closed** when unset)
2. Loads policy / kill switch / trading / broadcast gates
3. Enforces cooldown + daily volume via durable tick store
4. Selects candidate MeToken(s) from subgraph `Subscribe` entities (optional model assist)
5. Runs quote + dry-run planning
6. Broadcasts only when every live gate passes and signed prepared calls exist

**Cron schedule:** every 30 minutes via `vercel.json` (`*/30 * * * *`).

**Smoke test:**

```bash
curl -sS -H "Authorization: Bearer $CRON_SECRET" \
  "https://agents.creativeplatform.xyz/api/agent1/tick" | jq .
```

### `/api/agent1/dry-run`

Plans a USDC → MeToken mint **without broadcasting** (see dry-run route for query/body shape).

### Quote path

| Mode | Behavior |
| --- | --- |
| `AGENT1_QUOTE_MODE=mock` (default) | Staging ratio quote |
| `AGENT1_QUOTE_MODE=onchain` | Read-only `calculateMeTokensMinted` on configured diamond |

`venue.routerConfirmed` is `true` only when G2 sets `AGENT1_ROUTER_CONFIRMED=true` with diamond address configured.

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

1. Keep `TRADING_ENABLED=false` and `AGENT1_BROADCAST_ENABLED=false` until ops is ready.
2. Set `CRON_SECRET`, Upstash/`KV_REST_API_*`, wallet/RPC env as needed.
3. Set venue candidate addresses; only set `AGENT1_ROUTER_CONFIRMED=true` after G2 review.
4. Fund the vault/wallet before enabling broadcast. Add Gemini / AI Gateway keys only if model assist is desired.

## Slice Roadmap & Blockers

| Slice | Scope | Blockers |
| --- | --- | --- |
| **A** | Scaffold, policy gates, health APIs, logger, cron helper | — |
| **B** | Subgraph MeToken universe, wallet reads, read-only quote API | — |
| **C** | Alchemy Agent Wallet signer status + dry-run (`prepareCalls` only) | — |
| **D** | Tick loop → policy → quote / dry-run | — (merged) |
| **E prep** | Upstash tick store + venue confirm gate + `/api/agent1/venue` | — (merged) |
| **E live** (current) | Live execute + Gemini + cron broadcast | Vault funding; G2 router confirm; `AGENT1_BROADCAST_ENABLED`; model keys (optional) |
| **F** | Alerts + runbook | Alert channel |

## License

Proprietary — All Rights Reserved. Copyright (c) 2026 Creative Platform, Inc. See [LICENSE](./LICENSE).
