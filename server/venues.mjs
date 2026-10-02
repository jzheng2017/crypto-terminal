import { cached, json, DataError, markets as bybitMarkets, bybit, coinglass } from './providers.mjs';
import { VENUES, venueName } from '../shared/venues.mjs';
import { cryptoInstrument } from '../shared/market-policy.mjs';

export const venueNames = Object.fromEntries(VENUES.map((v) => [v.id, v.name]));
export const binanceInterval = (v) =>
  v === 'D' ? '1d' : v === 'W' ? '1w' : Number(v) >= 60 ? `${Number(v) / 60}h` : `${v}m`;
export const okxInterval = (v) =>
  v === 'D' ? '1Dutc' : v === 'W' ? '1Wutc' : Number(v) >= 60 ? `${Number(v) / 60}H` : `${v}m`;
export const binanceBase = (category) =>
  category === 'linear' ? 'https://fapi.binance.com/fapi/v1' : 'https://api.binance.com/api/v3';
export async function binance(category, path, params = {}) {
  const r = await json(`${binanceBase(category)}/${path}?${new URLSearchParams(params)}`);
  if (r.code && Number(r.code) < 0) throw new DataError(`Binance: ${r.msg}`);
  return r;
}
export async function okx(path, params = {}) {
  const r = await json(`https://www.okx.com/api/v5/${path}?${new URLSearchParams(params)}`);
  if (r.code !== '0') throw new DataError(`OKX: ${r.msg || 'data unavailable'}`);
  return r.data;
}
export async function venueMarkets(exchange, category) {
  if (!['bybit', 'binance', 'okx'].includes(exchange))
    return (await import('./ccxt-adapter.mjs')).ccxtMarkets(exchange, category);
  if (exchange === 'bybit') {
    const r = await bybitMarkets(category);
    return { ...r, data: r.data.map((m) => ({ ...m, exchange })) };
  }
  return cached(`markets:${exchange}:${category}`, 15_000, async () => {
    if (exchange === 'binance') {
      const [ticks, info, premiums, fundingInfo] = await Promise.all([
        binance(category, 'ticker/24hr'),
        cached(`binance:info:${category}`, 3_600_000, () => binance(category, 'exchangeInfo')),
        category === 'linear' ? binance(category, 'premiumIndex') : [],
        category === 'linear'
          ? cached('binance:fundingInfo', 600_000, () => binance(category, 'fundingInfo'))
          : { data: [] },
      ]);
      const meta = new Map(
        info.data.symbols
          .filter(
            (m) =>
              m.status === 'TRADING' &&
              m.quoteAsset === 'USDT' &&
              (category === 'spot'
                ? m.isSpotTradingAllowed !== false
                : m.contractType === 'PERPETUAL' && cryptoInstrument(m, 'binance')),
          )
          .map((m) => [m.symbol, m]),
      );
      const premium = new Map(premiums.map((p) => [p.symbol, p]));
      const hours = new Map(fundingInfo.data.map((p) => [p.symbol, Number(p.fundingIntervalHours)]));
      return ticks
        .filter((t) => meta.has(t.symbol))
        .map((t) => {
          const m = meta.get(t.symbol),
            p = premium.get(t.symbol),
            lot = m.filters.find((f) => f.filterType === 'LOT_SIZE'),
            filter = m.filters.find((f) => f.filterType === 'PRICE_FILTER');
          return {
            exchange,
            category,
            symbol: t.symbol,
            base: m.baseAsset,
            quote: 'USDT',
            price: Number(t.lastPrice),
            change: Number(t.priceChangePercent),
            volume: Number(t.quoteVolume),
            high: Number(t.highPrice),
            low: Number(t.lowPrice),
            funding: p ? Number(p.lastFundingRate) * 100 : null,
            fundingHours: category === 'linear' ? hours.get(t.symbol) || 8 : null,
            nextFunding: p ? Number(p.nextFundingTime) : null,
            oi: null,
            tick: Number(filter.tickSize),
            qtyStep: Number(lot.stepSize),
          };
        })
        .sort((a, b) => b.volume - a.volume);
    }
    const instType = category === 'linear' ? 'SWAP' : 'SPOT';
    const [ticks, info] = await Promise.all([
      okx('market/tickers', { instType }),
      cached(`okx:info:${category}`, 3_600_000, () => okx('public/instruments', { instType })),
    ]);
    const meta = new Map(
      info.data
        .filter(
          (m) =>
            m.state === 'live' &&
            (category === 'spot' ? m.quoteCcy === 'USDT' : m.settleCcy === 'USDT' && m.ctType === 'linear'),
        )
        .map((m) => [m.instId, m]),
    );
    return ticks
      .filter((t) => meta.has(t.instId))
      .map((t) => {
        const m = meta.get(t.instId),
          base = category === 'linear' ? m.ctValCcy : m.baseCcy;
        const multiplier = category === 'linear' ? Number(m.ctVal) * Number(m.ctMult || 1) : 1;
        return {
          exchange,
          category,
          symbol: `${base}USDT`,
          nativeSymbol: m.instId,
          contractMultiplier: multiplier,
          base,
          quote: 'USDT',
          price: Number(t.last),
          change: Number(t.open24h) ? (Number(t.last) / Number(t.open24h) - 1) * 100 : 0,
          volume: Number(t.volCcy24h) * (category === 'linear' ? Number(t.last) : 1),
          volumeEstimate: category === 'linear',
          high: Number(t.high24h),
          low: Number(t.low24h),
          funding: null,
          fundingHours: null,
          nextFunding: null,
          oi: null,
          tick: Number(m.tickSz),
          qtyStep: Number(m.lotSz) * multiplier,
        };
      })
      .filter((m) => /^[A-Z0-9]{2,30}$/.test(m.symbol) && m.contractMultiplier > 0)
      .sort((a, b) => b.volume - a.volume);
  });
}
export async function venueInstrument(exchange, category, symbol) {
  const r = await venueMarkets(exchange, category),
    m = r.data.find((m) => m.symbol === symbol);
  if (!m) throw new DataError(`${venueNames[exchange]} does not list this USDT market.`, 404);
  return m;
}
export async function venueCandles(exchange, category, symbol, interval) {
  if (!['bybit', 'binance', 'okx'].includes(exchange))
    return (await import('./ccxt-adapter.mjs')).ccxtCandles(exchange, category, symbol, interval);
  return cached(`candles:${exchange}:${category}:${symbol}:${interval}`, 10_000, async () => {
    if (exchange === 'bybit') {
      const r = await bybit('kline', { category, symbol, interval, limit: '300' });
      return r.list
        .map((c) => ({
          time: Number(c[0]) / 1000,
          open: Number(c[1]),
          high: Number(c[2]),
          low: Number(c[3]),
          close: Number(c[4]),
          volume: Number(c[5]),
        }))
        .reverse();
    }
    if (exchange === 'binance')
      return (
        await binance(category, 'klines', { symbol, interval: binanceInterval(interval), limit: '300' })
      ).map((c) => ({
        time: Number(c[0]) / 1000,
        open: Number(c[1]),
        high: Number(c[2]),
        low: Number(c[3]),
        close: Number(c[4]),
        volume: Number(c[5]),
      }));
    const m = await venueInstrument(exchange, category, symbol);
    return (await okx('market/candles', { instId: m.nativeSymbol, bar: okxInterval(interval), limit: '300' }))
      .map((c) => ({
        time: Number(c[0]) / 1000,
        open: Number(c[1]),
        high: Number(c[2]),
        low: Number(c[3]),
        close: Number(c[4]),
        volume: Number(c[6]),
      }))
      .reverse();
  });
}
export async function venueRecent(exchange, category, symbol) {
  if (!['bybit', 'binance', 'okx'].includes(exchange))
    return (await import('./ccxt-adapter.mjs')).ccxtRecent(exchange, category, symbol);
  return cached(
    `recent:${exchange}:${category}:${symbol}`,
    5000,
    async () => {
      if (exchange === 'bybit') {
        const r = await bybit('recent-trade', { category, symbol, limit: '100' });
        return {
          trades: r.list.map((t) => ({
            id: t.execId,
            side: t.side,
            price: Number(t.price),
            size: Number(t.size),
            time: Number(t.time),
          })),
        };
      }
      if (exchange === 'binance')
        return {
          trades: (await binance(category, 'aggTrades', { symbol, limit: '100' })).reverse().map((t) => ({
            id: String(t.a),
            side: t.m ? 'Sell' : 'Buy',
            price: Number(t.p),
            size: Number(t.q),
            time: Number(t.T),
          })),
        };
      const m = await venueInstrument(exchange, category, symbol);
      return {
        trades: (await okx('market/trades', { instId: m.nativeSymbol, limit: '100' })).map((t) => ({
          id: t.tradeId,
          side: t.side === 'buy' ? 'Buy' : 'Sell',
          price: Number(t.px),
          size: Number(t.sz) * m.contractMultiplier,
          time: Number(t.ts),
        })),
      };
    },
    10_000,
  );
}

export function flowHistory(rows, source, periodSeconds, requestedFrom, requestedTo) {
  let cvd = 0,
    buy = 0,
    sell = 0;
  const bars = [...new Map(rows.map((x) => [x.time, x])).values()]
    .filter(
      (x) =>
        x.time * 1000 >= requestedFrom &&
        x.time * 1000 <= requestedTo &&
        [x.time, x.buy, x.sell].every(Number.isFinite) &&
        x.buy >= 0 &&
        x.sell >= 0,
    )
    .sort((a, b) => a.time - b.time)
    .map((x) => {
      buy += x.buy;
      sell += x.sell;
      cvd += x.buy - x.sell;
      return { ...x, delta: x.buy - x.sell, cvd };
    });
  let gaps = 0;
  for (let i = 1; i < bars.length; i++) if (bars[i].time - bars[i - 1].time > periodSeconds * 1.5) gaps++;
  return {
    source,
    periodSeconds,
    requestedFrom,
    requestedTo,
    bars,
    buy,
    sell,
    cvd,
    gaps,
    from: bars[0]?.time * 1000 || null,
    to: bars.at(-1)?.time * 1000 || null,
  };
}
export async function historicalFlow(exchange, category, symbol, range, end) {
  const spec = { '6h': [6, '5'], '24h': [24, '5'], '7d': [168, '15'], '30d': [720, '60'] }[range];
  const endTime = end || Date.now(),
    from = endTime - spec[0] * 3_600_000,
    interval = spec[1],
    period = Number(interval) * 60;
  // A minute bucket keeps sliding lookbacks cacheable across multiple clients.
  return cached(
    `flow-history:${exchange}:${category}:${symbol}:${range}:${Math.floor(endTime / 60_000)}`,
    60_000,
    async () => {
      if (exchange === 'binance') {
        const r = await binance(category, 'klines', {
          symbol,
          interval: binanceInterval(interval),
          startTime: String(from),
          endTime: String(endTime),
          limit: '1000',
        });
        const rows = r.map((c) => ({
          time: Number(c[0]) / 1000,
          buy: Number(c[10]),
          sell: Math.max(0, Number(c[7]) - Number(c[10])),
          partial: Number(c[6]) >= endTime,
        }));
        return flowHistory(rows, 'Binance taker quote volume from exchange klines', period, from, endTime);
      }
      if (exchange === 'okx' && category === 'linear') {
        const m = await venueInstrument(exchange, category, symbol),
          rows = [];
        let cursor = endTime;
        for (let i = 0; i < 10; i++) {
          const batch = await okx('rubik/stat/taker-volume-contract', {
            instId: m.nativeSymbol,
            period: okxInterval(interval),
            unit: '2',
            end: String(cursor),
            limit: '100',
          });
          if (!batch.length) break;
          rows.push(
            ...batch.map((c) => ({
              time: Number(c[0]) / 1000,
              sell: Number(c[1]),
              buy: Number(c[2]),
              partial: Number(c[0]) + period * 1000 > endTime,
            })),
          );
          const oldest = Math.min(...batch.map((c) => Number(c[0])));
          if (oldest <= from || oldest >= cursor) break;
          cursor = oldest - 1;
          // Provider limit: five requests per two seconds.
          await new Promise((resolve) => setTimeout(resolve, 420));
        }
        return flowHistory(rows, 'OKX contract taker volume · quote units (unit=2)', period, from, endTime);
      }
      if (category === 'spot')
        throw new DataError(
          'Historical spot taker CVD is available on Binance in the public adapters. Choose Binance, or connect a provider with this spot dataset.',
          422,
        );
      const r = await coinglass(
        'cvd',
        symbol,
        interval === '60' ? '1h' : interval + 'm',
        venueNames[exchange],
        from,
        endTime,
      );
      const rows = r.data.map((c) => ({
        time: Number(c.time) > 1e12 ? Number(c.time) / 1000 : Number(c.time),
        buy: Number(c.taker_buy_vol),
        sell: Number(c.taker_sell_vol),
        partial: false,
      }));
      return flowHistory(
        rows,
        `CoinGlass historical taker volumes · ${venueNames[exchange]}`,
        period,
        from,
        endTime,
      );
    },
  );
}

export async function venueDerivatives(exchange, symbol) {
  if (!['bybit', 'binance', 'okx'].includes(exchange))
    throw new DataError(
      'This venue’s derivative history is not connected in the public adapter. Historical CVD can be requested through CoinGlass where covered.',
      422,
    );
  if (exchange === 'bybit') {
    const [oi, funding] = await Promise.allSettled([
      bybit('open-interest', { category: 'linear', symbol, intervalTime: '1h', limit: '48' }),
      bybit('funding/history', { category: 'linear', symbol, limit: '24' }),
    ]);
    return {
      oi:
        oi.status === 'fulfilled'
          ? oi.value.list
              .map((x) => ({ time: Number(x.timestamp) / 1000, value: Number(x.openInterest) }))
              .reverse()
          : [],
      funding:
        funding.status === 'fulfilled'
          ? funding.value.list
              .map((x) => ({
                time: Number(x.fundingRateTimestamp) / 1000,
                value: Number(x.fundingRate) * 100,
              }))
              .reverse()
          : [],
      warnings: [oi, funding].filter((x) => x.status === 'rejected').map((x) => x.reason.message),
    };
  }
  if (exchange === 'binance') {
    const [oi, funding] = await Promise.allSettled([
      json(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&period=1h&limit=48`),
      binance('linear', 'fundingRate', { symbol, limit: '24' }),
    ]);
    return {
      oi:
        oi.status === 'fulfilled' && Array.isArray(oi.value)
          ? oi.value.map((x) => ({ time: x.timestamp / 1000, value: Number(x.sumOpenInterest) }))
          : [],
      funding:
        funding.status === 'fulfilled'
          ? funding.value.map((x) => ({ time: x.fundingTime / 1000, value: Number(x.fundingRate) * 100 }))
          : [],
      warnings: [oi, funding].filter((x) => x.status === 'rejected').map((x) => x.reason.message),
    };
  }
  const m = await venueInstrument(exchange, 'linear', symbol);
  const funding = await okx('public/funding-rate-history', { instId: m.nativeSymbol, limit: '48' });
  return {
    oi: [],
    funding: funding
      .map((x) => ({
        time: Number(x.fundingTime) / 1000,
        value: Number(x.realizedRate || x.fundingRate) * 100,
      }))
      .reverse(),
    warnings: ['Historical per-instrument OI is not connected in the public OKX adapter.'],
  };
}
