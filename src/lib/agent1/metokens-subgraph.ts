import { logger } from "@/lib/logger";
import { queryCreativePlatformSubgraph } from "@/lib/subgraph/creative-platform-proxy";

/**
 * MeToken discovery uses **Subscribe** events (per-token registrations).
 * **Register** entities are hub-level registrations (hubs 1–4), not the MeToken universe.
 */

export interface SubscribedMeToken {
  id: string;
  meToken: string;
  owner: string;
  name: string;
  symbol: string;
  hubId: string;
  asset: string;
  assetsDeposited: string;
  timestamp: string;
  blockNumber: string;
  transactionHash: string;
}

export interface HubSummary {
  id: string;
  asset: string;
  vault: string;
  active: boolean;
  refundRatio: string;
  reserveWeight: string;
  baseY: string;
}

export interface MintActivity {
  id: string;
  meToken: string;
  depositor: string;
  recipient: string;
  assetsDeposited: string;
  meTokensMinted: string;
  timestamp: string;
}

export interface BurnActivity {
  id: string;
  meToken: string;
  burner: string;
  recipient: string;
  meTokensBurned: string;
  assetsReturned: string;
  timestamp: string;
}

export interface MeTokenBalanceRow {
  id: string;
  user: string;
  meToken: string;
  balance: string;
  updatedAt: string;
}

export interface SubgraphMeta {
  blockNumber: string;
  hasIndexingErrors: boolean;
}

const LIST_SUBSCRIBED_METOKENS = `
  query ListSubscribedMeTokens($first: Int!, $skip: Int!) {
    subscribes(
      first: $first
      skip: $skip
      orderBy: timestamp_
      orderDirection: desc
    ) {
      id
      meToken
      owner
      name
      symbol
      hubId
      asset
      assetsDeposited
      timestamp_
      block_number
      transactionHash_
    }
  }
`;

const GET_SUBSCRIBE_BY_METOKEN = `
  query GetSubscribeByMeToken($meToken: Bytes!) {
    subscribes(where: { meToken: $meToken }, first: 1) {
      id
      meToken
      owner
      name
      symbol
      hubId
      asset
      assetsDeposited
      timestamp_
      block_number
      transactionHash_
    }
  }
`;

const GET_ACTIVE_HUBS = `
  query GetActiveHubs($first: Int!) {
    hubs(where: { active: true }, first: $first, orderBy: id, orderDirection: asc) {
      id
      asset
      vault
      active
      refundRatio
      reserveWeight
      baseY
    }
  }
`;

const GET_RECENT_MINTS = `
  query GetRecentMints($first: Int!) {
    mints(first: $first, orderBy: timestamp_, orderDirection: desc) {
      id
      meToken
      depositor
      recipient
      assetsDeposited
      meTokensMinted
      timestamp_
    }
  }
`;

const GET_RECENT_BURNS = `
  query GetRecentBurns($first: Int!) {
    burns(first: $first, orderBy: timestamp_, orderDirection: desc) {
      id
      meToken
      burner
      recipient
      meTokensBurned
      assetsReturned
      timestamp_
    }
  }
`;

const GET_METOKEN_BALANCES_BY_USER = `
  query GetMeTokenBalancesByUser($user: Bytes!, $first: Int!, $skip: Int!) {
    meTokenBalances(
      where: { user: $user, balance_gt: 0 }
      first: $first
      skip: $skip
      orderBy: balance
      orderDirection: desc
    ) {
      id
      user
      meToken
      balance
      updatedAt
    }
  }
`;

const GET_SUBGRAPH_META = `
  query GetSubgraphMeta {
    _meta {
      block {
        number
      }
      hasIndexingErrors
    }
  }
`;

function mapSubscribe(row: {
  id: string;
  meToken: string;
  owner: string;
  name: string;
  symbol: string;
  hubId: string;
  asset: string;
  assetsDeposited: string;
  timestamp_: string;
  block_number: string;
  transactionHash_: string;
}): SubscribedMeToken {
  return {
    id: row.id,
    meToken: row.meToken.toLowerCase(),
    owner: row.owner.toLowerCase(),
    name: row.name,
    symbol: row.symbol,
    hubId: row.hubId,
    asset: row.asset.toLowerCase(),
    assetsDeposited: row.assetsDeposited,
    timestamp: row.timestamp_,
    blockNumber: row.block_number,
    transactionHash: row.transactionHash_,
  };
}

export async function listSubscribedMeTokens(
  first = 100,
  skip = 0,
): Promise<SubscribedMeToken[]> {
  const { data, endpoint } = await queryCreativePlatformSubgraph<{
    subscribes: Array<{
      id: string;
      meToken: string;
      owner: string;
      name: string;
      symbol: string;
      hubId: string;
      asset: string;
      assetsDeposited: string;
      timestamp_: string;
      block_number: string;
      transactionHash_: string;
    }>;
  }>(LIST_SUBSCRIBED_METOKENS, { first, skip });

  logger.debug("metokens_subgraph_list", {
    endpoint,
    count: data.subscribes.length,
    first,
    skip,
  });

  return data.subscribes.map(mapSubscribe);
}

export async function getSubscribedMeToken(
  meTokenAddress: string,
): Promise<SubscribedMeToken | null> {
  const normalized = meTokenAddress.trim().toLowerCase();

  const { data } = await queryCreativePlatformSubgraph<{
    subscribes: Array<{
      id: string;
      meToken: string;
      owner: string;
      name: string;
      symbol: string;
      hubId: string;
      asset: string;
      assetsDeposited: string;
      timestamp_: string;
      block_number: string;
      transactionHash_: string;
    }>;
  }>(GET_SUBSCRIBE_BY_METOKEN, { meToken: normalized });

  const row = data.subscribes[0];
  return row ? mapSubscribe(row) : null;
}

export async function isSubgraphListedMeToken(meTokenAddress: string): Promise<boolean> {
  const token = await getSubscribedMeToken(meTokenAddress);
  return token !== null;
}

export async function listActiveHubs(first = 20): Promise<HubSummary[]> {
  const { data } = await queryCreativePlatformSubgraph<{
    hubs: HubSummary[];
  }>(GET_ACTIVE_HUBS, { first });

  return data.hubs.map((hub) => ({
    ...hub,
    asset: hub.asset.toLowerCase(),
  }));
}

export async function getRecentMintActivity(first = 10): Promise<MintActivity[]> {
  const { data } = await queryCreativePlatformSubgraph<{
    mints: Array<{
      id: string;
      meToken: string;
      depositor: string;
      recipient: string;
      assetsDeposited: string;
      meTokensMinted: string;
      timestamp_: string;
    }>;
  }>(GET_RECENT_MINTS, { first });

  return data.mints.map((mint) => ({
    id: mint.id,
    meToken: mint.meToken.toLowerCase(),
    depositor: mint.depositor.toLowerCase(),
    recipient: mint.recipient.toLowerCase(),
    assetsDeposited: mint.assetsDeposited,
    meTokensMinted: mint.meTokensMinted,
    timestamp: mint.timestamp_,
  }));
}

export async function getRecentBurnActivity(first = 10): Promise<BurnActivity[]> {
  const { data } = await queryCreativePlatformSubgraph<{
    burns: Array<{
      id: string;
      meToken: string;
      burner: string;
      recipient: string;
      meTokensBurned: string;
      assetsReturned: string;
      timestamp_: string;
    }>;
  }>(GET_RECENT_BURNS, { first });

  return data.burns.map((burn) => ({
    id: burn.id,
    meToken: burn.meToken.toLowerCase(),
    burner: burn.burner.toLowerCase(),
    recipient: burn.recipient.toLowerCase(),
    meTokensBurned: burn.meTokensBurned,
    assetsReturned: burn.assetsReturned,
    timestamp: burn.timestamp_,
  }));
}

export async function getMeTokenBalancesForUser(
  userAddress: string,
  first = 100,
  skip = 0,
): Promise<MeTokenBalanceRow[]> {
  const user = userAddress.trim().toLowerCase();
  const { data } = await queryCreativePlatformSubgraph<{
    meTokenBalances: MeTokenBalanceRow[];
  }>(GET_METOKEN_BALANCES_BY_USER, { user, first, skip });

  return data.meTokenBalances.map((row) => ({
    ...row,
    user: row.user.toLowerCase(),
    meToken: row.meToken.toLowerCase(),
  }));
}

export async function getSubgraphMeta(): Promise<SubgraphMeta> {
  const { data } = await queryCreativePlatformSubgraph<{
    _meta: { block: { number: string }; hasIndexingErrors: boolean };
  }>(GET_SUBGRAPH_META);

  return {
    blockNumber: data._meta.block.number,
    hasIndexingErrors: data._meta.hasIndexingErrors,
  };
}
