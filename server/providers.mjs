import { cryptoInstrument } from '../shared/market-policy.mjs';
const cache = new Map();
const pending = new Map();
export class DataError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

// Coalesce clients, keep original observation times, and bound memory.
export async function cached(key, ttl, load, staleFor = 120_000) {
  const previous = cache.get(key);
  if (previous && Date.now() - previous.asOf < ttl) return previous;
  if (pending.has(key)) return pending.get(key);
  const request = (async () => {
    try {
      const result = { data: await load(), asOf: Date.now(), stale: false };
      if (cache.size >= 500) cache.delete(cache.keys().next().value);
      cache.set(key, result);
      return result;
    } catch (error) {
      if (previous && Date.now() - previous.asOf < staleFor) {
        return { ...previous, stale: true, warning: error.message };
      }
      throw error;
    } finally {
      pending.delete(key);
    }
  })();
  pending.set(key, request);
  return request;
}

export async function json(url, headers = {}) {
  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json', ...headers },
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new DataError('The data provider did not respond. Try again shortly.');
  }
  if (!response.ok)
    throw new DataError(
      response.status === 429
        ? 'Provider rate limit reached. Try again shortly.'
        : `Data provider returned HTTP ${response.status}.`,
      response.status === 429 ? 429 : 502,
    );
  try {
    return await response.json();
  } catch {
    throw new DataError('The data provider returned an unreadable response.');
  }
}

export async function bybit(path, params) {
  const value = await json(`https://api.bybit.com/v5/market/${path}?${new URLSearchParams(params)}`);
  if (value.retCode !== 0) throw new DataError(`Bybit: ${value.retMsg || 'data unavailable'}`);
  return value.result;
}

export async function instruments(category) {
  return cached(
    `instruments:${category}`,
    3_600_000,
    async () => {
      const rows = [];
      let cursor = '';
      for (let page = 0; page < 10; page++) {
        const result = await bybit('instruments-info', {
          category,
          limit: '1000',
          ...(cursor ? { cursor } : {}),
        });
        rows.push(...result.list);
        cursor = result.nextPageCursor;
        if (!cursor) break;
      }
      return rows.filter(
        (x) =>
          x.status === 'Trading' &&
          x.quoteCoin === 'USDT' &&
          cryptoInstrument(x, 'bybit') &&
          (category === 'spot' || x.contractType === 'LinearPerpetual'),
      );
    },
    7_200_000,
  );
}

export async function markets(category) {
  return cached(`markets:${category}`, 10_000, async () => {
    const [tickers, contracts] = await Promise.all([bybit('tickers', { category }), instruments(category)]);
    const metadata = new Map(contracts.data.map((x) => [x.symbol, x]));
    return tickers.list
      .filter((x) => metadata.has(x.symbol))
      .map((t) => {
        const m = metadata.get(t.symbol);
        return {
          symbol: t.symbol,
          base: m.baseCoin,
          quote: m.quoteCoin,
          category,
          price: Number(t.lastPrice),
          change: Number(t.price24hPcnt) * 100,
          volume: Number(t.turnover24h),
          high: Number(t.highPrice24h),
          low: Number(t.lowPrice24h),
          funding: t.fundingRate === undefined ? null : Number(t.fundingRate) * 100,
          fundingHours: m.fundingInterval ? Number(m.fundingInterval) / 60 : null,
          nextFunding: Number(t.nextFundingTime) || null,
          oi: t.openInterestValue === undefined ? null : Number(t.openInterestValue),
          tick: Number(m.priceFilter?.tickSize) || null,
          qtyStep: Number(m.lotSizeFilter?.qtyStep ?? m.lotSizeFilter?.basePrecision) || null,
        };
      })
      .sort((a, b) => b.volume - a.volume);
  });
}

const numeric = (x) => (x == null || x === '' || !Number.isFinite(Number(x)) ? null : Number(x));
export function normalizePair(p) {
  return {
    chain: p.chainId,
    dex: p.dexId,
    address: p.pairAddress,
    token: p.baseToken?.address,
    symbol: p.baseToken?.symbol || '?',
    name: p.baseToken?.name || 'Unknown token',
    quote: p.quoteToken?.symbol || '?',
    price: numeric(p.priceUsd),
    change: numeric(p.priceChange?.h24),
    liquidity: numeric(p.liquidity?.usd),
    volume: numeric(p.volume?.h24),
    marketCap: numeric(p.marketCap),
    fdv: numeric(p.fdv),
    buys: numeric(p.txns?.h24?.buys),
    sells: numeric(p.txns?.h24?.sells),
    created: numeric(p.pairCreatedAt),
    url: p.url,
    boosted: Number(p.boosts?.active) > 0,
  };
}

export async function dexPairs(query, chain, mode) {
  return cached(`dex:${query}:${chain}:${mode}`, 45_000, async () => {
    let pairs;
    if (query) {
      const r = await json(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`);
      pairs = r.pairs || [];
    } else {
      const endpoint = mode === 'boosted' ? 'token-boosts/top/v1' : 'token-profiles/latest/v1';
      const profiles = await json(`https://api.dexscreener.com/${endpoint}`);
      const candidates = profiles.filter((p) => chain === 'all' || p.chainId === chain).slice(0, 18);
      const groups = new Map();
      for (const p of candidates) groups.set(p.chainId, [...(groups.get(p.chainId) || []), p.tokenAddress]);
      const results = await Promise.allSettled(
        [...groups].map(([c, addresses]) =>
          json(
            `https://api.dexscreener.com/tokens/v1/${encodeURIComponent(c)}/${addresses.map(encodeURIComponent).join(',')}`,
          ),
        ),
      );
      pairs = results.flatMap((r) => (r.status === 'fulfilled' && Array.isArray(r.value) ? r.value : []));
      if (!pairs.length && candidates.length)
        throw new DataError('DEX pool lookups are temporarily unavailable.');
    }
    const unique = new Map();
    for (const p of pairs) {
      if (chain !== 'all' && p.chainId !== chain) continue;
      if (!p.pairAddress || !p.baseToken?.address) continue;
      unique.set(`${p.chainId}:${p.pairAddress}`, normalizePair(p));
    }
    return [...unique.values()].sort((a, b) => (b.liquidity ?? 0) - (a.liquidity ?? 0));
  });
}

export const geckoNetworks = {
  ethereum: 'eth',
  solana: 'solana',
  base: 'base',
  bsc: 'bsc',
  arbitrum: 'arbitrum',
  polygon: 'polygon_pos',
  avalanche: 'avax',
  optimism: 'optimism',
};
export async function poolCandles(chain, address, interval) {
  const network = geckoNetworks[chain];
  if (!network) throw new DataError('Pool chart coverage is unavailable for this network.', 422);
  return cached(`pool-candles:${chain}:${address}:${interval}`, 60_000, async () => {
    const r = await json(
      `https://api.geckoterminal.com/api/v2/networks/${network}/pools/${encodeURIComponent(address)}/ohlcv/minute?aggregate=${interval}&limit=200&currency=usd&token=base`,
    );
    return (r.data?.attributes?.ohlcv_list || [])
      .map((c) => ({ time: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] }))
      .reverse();
  });
}

export async function poolTrades(chain, address) {
  const network = geckoNetworks[chain];
  if (!network) throw new DataError('Swap coverage is unavailable for this network.', 422);
  return cached(`swaps:${chain}:${address}`, 60_000, async () => {
    const r = await json(
      `https://api.geckoterminal.com/api/v2/networks/${network}/pools/${encodeURIComponent(address)}/trades`,
    );
    return (r.data || []).map((x) => ({
      id: x.id,
      side: x.attributes.kind,
      price: numeric(
        x.attributes.kind === 'buy' ? x.attributes.price_to_in_usd : x.attributes.price_from_in_usd,
      ),
      value: numeric(x.attributes.volume_in_usd),
      time: Date.parse(x.attributes.block_timestamp),
      hash: x.attributes.tx_hash,
    }));
  });
}

const evmChains = {
  ethereum: '1',
  bsc: '56',
  base: '8453',
  arbitrum: '42161',
  polygon: '137',
  avalanche: '43114',
  optimism: '10',
};
export async function security(chain, token) {
  if (!evmChains[chain])
    return {
      data: null,
      asOf: Date.now(),
      stale: false,
      reason: 'This provider does not cover this network in the connected EVM adapter.',
    };
  return cached(`security:${chain}:${token}`, 300_000, async () => {
    const r = await json(
      `https://api.gopluslabs.io/api/v1/token_security/${evmChains[chain]}?contract_addresses=${encodeURIComponent(token)}`,
    );
    if (r.code !== 1) throw new DataError('Token security data is unavailable.');
    const d = r.result?.[token.toLowerCase()];
    if (!d) return null;
    const flag = (v) => (v === '1' ? true : v === '0' ? false : null);
    return {
      honeypot: flag(d.is_honeypot),
      mintable: flag(d.is_mintable),
      openSource: flag(d.is_open_source),
      sellBlocked: flag(d.cannot_sell_all),
      buyTax: numeric(d.buy_tax),
      sellTax: numeric(d.sell_tax),
      holders: numeric(d.holder_count),
      owner: d.owner_address || null,
    };
  });
}

export async function coinglass(kind, symbol, interval, exchange = 'Bybit', start, end) {
  const key = process.env.COINGLASS_API_KEY;
  if (!key)
    throw new DataError(
      'Add COINGLASS_API_KEY to .env and restart the data service to connect historical analytics.',
      428,
    );
  return cached(
    `coinglass:${kind}:${exchange}:${symbol}:${interval}:${start || ''}:${end || ''}`,
    60_000,
    async () => {
      const path = kind === 'cvd' ? '/api/futures/cvd/history' : '/api/futures/liquidation/heatmap/model1';
      const params =
        kind === 'cvd'
          ? {
              exchange,
              symbol,
              interval,
              limit: '1000',
              ...(start ? { start_time: String(start) } : {}),
              ...(end ? { end_time: String(end) } : {}),
            }
          : { exchange, symbol, range: '24h' };
      const r = await json(`https://open-api-v4.coinglass.com${path}?${new URLSearchParams(params)}`, {
        'CG-API-KEY': key,
      });
      if (String(r.code) !== '0')
        throw new DataError(
          'CoinGlass did not provide this dataset. Check the key, plan entitlement and supported market.',
          422,
        );
      return r.data;
    },
    180_000,
  );
}
