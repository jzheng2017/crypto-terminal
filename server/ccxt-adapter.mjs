import ccxt from 'ccxt';
import { cached, DataError } from './providers.mjs';
import { VENUES, venueName } from '../shared/venues.mjs';
import { binanceInterval } from './venues.mjs';
import { cryptoInstrument } from '../shared/market-policy.mjs';
import { tradeWindow } from './trade-window.mjs';

const clients = new Map();
export function ccxtClient(id, category) {
  const key = `${id}:${category}`;
  if (clients.has(key)) return clients.get(key);
  const config = VENUES.find((v) => v.id === id);
  if (!config) throw new DataError('Unknown exchange.', 400);
  const adapter = id === 'kucoin' && category === 'linear' ? 'kucoinfutures' : config.adapter || id;
  const client = new ccxt.pro[adapter]({
    enableRateLimit: true,
    timeout: 12_000,
    newUpdates: true,
    options: {
      defaultType: category === 'spot' ? 'spot' : 'swap',
      defaultSubType: 'linear',
      adjustForTimeDifference: true,
    },
  });
  clients.set(key, client);
  return client;
}
const unit = (precision, mode) =>
  precision == null
    ? null
    : mode === ccxt.TICK_SIZE
      ? Number(precision)
      : mode === ccxt.DECIMAL_PLACES
        ? 10 ** -Number(precision)
        : null;
export async function ccxtMarkets(id, category) {
  const config = VENUES.find((v) => v.id === id);
  if (category === 'linear' && !config.derivatives)
    throw new DataError(`${config.name} is connected for spot markets. Select Spot.`, 422);
  return cached(`ccxt:markets:${id}:${category}`, 30_000, async () => {
    const client = ccxtClient(id, category);
    await client.loadMarkets();
    const meta = Object.values(client.markets).filter(
      (m) =>
        m.active !== false &&
        cryptoInstrument(m.info || {}, id) &&
        ['USDT', 'USD', 'USDC'].includes(m.quote) &&
        (category === 'spot' ? m.spot : m.swap && m.linear) &&
        /^[A-Z0-9]{1,24}$/.test(m.base),
    );
    const tickers = await client.fetchTickers(
      category === 'linear' && id === 'kucoin' ? meta.map((m) => m.symbol) : undefined,
    );
    return meta
      .flatMap((m) => {
        const t = tickers[m.symbol];
        if (!t || !Number.isFinite(t.last) || t.last <= 0) return [];
        const contract = m.contract ? Number(m.contractSize || 1) : 1;
        return [
          {
            exchange: id,
            category,
            symbol: `${m.base}${m.quote}`,
            ccxtSymbol: m.symbol,
            nativeSymbol: m.id,
            contractMultiplier: contract,
            base: m.base,
            quote: m.quote,
            price: t.last,
            change: t.percentage ?? (t.open ? (t.last / t.open - 1) * 100 : 0),
            volume: t.quoteVolume ?? (t.baseVolume == null ? 0 : t.baseVolume * t.last),
            volumeEstimate: t.quoteVolume == null,
            high: t.high,
            low: t.low,
            funding: null,
            fundingHours: null,
            nextFunding: null,
            oi: null,
            tick: unit(m.precision.price, client.precisionMode),
            qtyStep:
              unit(m.precision.amount, client.precisionMode) == null
                ? null
                : unit(m.precision.amount, client.precisionMode) * contract,
          },
        ];
      })
      .sort((a, b) => b.volume - a.volume);
  });
}
export async function ccxtInstrument(id, category, symbol) {
  const data = await ccxtMarkets(id, category),
    m = data.data.find((m) => m.symbol === symbol);
  if (!m) throw new DataError(`${venueName(id)} does not list this market in the selected market type.`, 404);
  return m;
}
export async function ccxtCandles(id, category, symbol, interval) {
  return cached(`ccxt:candles:${id}:${category}:${symbol}:${interval}`, 15_000, async () => {
    const m = await ccxtInstrument(id, category, symbol),
      client = ccxtClient(id, category);
    const requested = binanceInterval(interval);
    if (client.timeframes && !client.timeframes[requested])
      throw new DataError(
        `${venueName(id)} does not provide ${requested} candles. Select another interval.`,
        422,
      );
    return (await client.fetchOHLCV(m.ccxtSymbol, requested, undefined, 300)).map((c) => ({
      time: c[0] / 1000,
      open: c[1],
      high: c[2],
      low: c[3],
      close: c[4],
      volume: c[5],
    }));
  });
}
export async function ccxtRecent(id, category, symbol) {
  return cached(
    `ccxt:recent:${id}:${category}:${symbol}`,
    10_000,
    async () => {
      const m = await ccxtInstrument(id, category, symbol);
      return {
        trades: (await ccxtClient(id, category).fetchTrades(m.ccxtSymbol, undefined, 100))
          .filter((t) => t.side === 'buy' || t.side === 'sell')
          .reverse()
          .map((t) => ({
            id: String(t.id ?? `${t.timestamp}:${t.price}:${t.amount}`),
            side: t.side === 'buy' ? 'Buy' : 'Sell',
            price: t.price,
            size: t.amount * m.contractMultiplier,
            time: t.timestamp,
          })),
      };
    },
    20_000,
  );
}
export function ccxtStream(client, { exchange, category, symbol, interval }) {
  let active = true,
    instance,
    tradeTimer,
    retry,
    currentInterval = interval,
    poll,
    generation = 0,
    attempt = 0;
  const send = (value) => {
    if (active && client.readyState === 1) {
      if (client.bufferedAmount > 2_000_000) return client.close(1013, 'Slow consumer');
      client.send(JSON.stringify(value));
    }
  };
  const topic = (name, data, ts = Date.now()) =>
    send({ topic: `${name}.${symbol}`, type: 'snapshot', data, ts });
  const failure = async (error) => {
    if (!active || retry) return;
    generation++;
    clearInterval(poll);
    clearTimeout(tradeTimer);
    send({
      event: 'status',
      status: 'reconnecting',
      message: `${venueName(exchange)} feed interrupted. Reconnecting with a fresh session.`,
    });
    try {
      await instance?.close();
    } catch {
      /* Closing an already disconnected socket is harmless. */
    }
    if (active)
      retry = setTimeout(
        () => {
          retry = null;
          void connect();
        },
        Math.min(1000 * 2 ** attempt++, 30_000),
      );
  };
  const connect = async () => {
    let m;
    try {
      m = await ccxtInstrument(exchange, category, symbol);
    } catch (error) {
      send({ event: 'status', status: 'error', message: error.message });
      return;
    }
    if (!active) return;
    const rest = ccxtClient(exchange, category),
      config = VENUES.find((v) => v.id === exchange),
      adapter = exchange === 'kucoin' && category === 'linear' ? 'kucoinfutures' : config.adapter || exchange;
    instance = new ccxt.pro[adapter]({
      enableRateLimit: true,
      newUpdates: true,
      timeout: 12_000,
      options: { defaultType: category === 'spot' ? 'spot' : 'swap', defaultSubType: 'linear' },
    });
    instance.setMarketsFromExchange(rest);
    const thisGeneration = ++generation;
    send({ event: 'session', startedAt: Date.now() });
    send({ event: 'status', status: 'connecting' });
    const loop = async (method, consume) => {
      try {
        while (active && generation === thisGeneration) {
          const value = await method();
          if (active && generation === thisGeneration) consume(value);
        }
      } catch (error) {
        if (active && generation === thisGeneration) void failure(error);
      }
    };
    // The library verifies each venue's depth protocol/checksum before returning a book.
    let lastBookPush = 0;
    void loop(
      () => instance.watchOrderBook(m.ccxtSymbol),
      (book) => {
        if (Date.now() - lastBookPush < 100) return;
        lastBookPush = Date.now();
        const convert = (rows) =>
          rows.slice(0, 50).map(([p, size]) => [String(p), String(size * m.contractMultiplier)]);
        topic(
          'orderbook.50',
          { b: convert(book.bids), a: convert(book.asks), u: Number(book.nonce) || Date.now() },
          book.timestamp || Date.now(),
        );
        attempt = 0;
        send({ event: 'status', status: 'live' });
      },
    );
    const emitTrades = (trades) =>
      topic(
        'publicTrade',
        trades
          .filter((t) => ['buy', 'sell'].includes(t.side))
          .map((t) => ({
            i: String(t.id ?? `${t.timestamp}:${t.price}:${t.amount}:${t.side}`),
            S: t.side === 'buy' ? 'Buy' : 'Sell',
            p: String(t.price),
            v: String(t.amount * m.contractMultiplier),
            T: t.timestamp,
          })),
      );
    if (exchange === 'kucoin' && category === 'linear') {
      let lastId = null;
      const quality =
        'KuCoin perpetual trades use a capped public history window (2s target interval). Session CVD covers captured prints and resets on detected gaps.';
      const capture = async () => {
        try {
          const rows = await rest.fetchTrades(m.ccxtSymbol, undefined, 100);
          if (!active || generation !== thisGeneration) return;
          const window = tradeWindow(rows, lastId);
          if (window.gap && window.fresh.length)
            send({ event: 'session', startedAt: window.fresh[0].timestamp });
          send({ event: 'quality', message: quality });
          emitTrades(window.fresh);
          lastId = window.latestId;
        } catch {
          if (active && generation === thisGeneration)
            send({
              event: 'quality',
              message:
                'KuCoin trade capture is unavailable; session delta has incomplete coverage. The book has a separate live connection.',
            });
        } finally {
          if (active && generation === thisGeneration) tradeTimer = setTimeout(capture, 2000);
        }
      };
      void capture();
    } else void loop(() => instance.watchTrades(m.ccxtSymbol), emitTrades);
    if (instance.has.watchTicker)
      void loop(
        () => instance.watchTicker(m.ccxtSymbol),
        (t) => {
          topic(
            'tickers',
            {
              ...(t.last == null ? {} : { lastPrice: String(t.last) }),
              ...(t.percentage == null ? {} : { price24hPcnt: String(t.percentage / 100) }),
              ...(t.quoteVolume == null ? {} : { turnover24h: String(t.quoteVolume) }),
            },
            t.timestamp || Date.now(),
          );
        },
      );
    const update = async () => {
      try {
        const bars = await ccxtCandles(exchange, category, symbol, currentInterval),
          c = bars.data.at(-1);
        if (active && generation === thisGeneration && c) topic('kline', [{ start: c.time * 1000, ...c }]);
        if (category === 'linear' && rest.has.fetchFundingRate) {
          const f = await rest.fetchFundingRate(m.ccxtSymbol);
          if (active && generation === thisGeneration && f.fundingRate != null)
            topic('tickers', {
              fundingRate: String(f.fundingRate),
              ...(f.fundingTimestamp ? { nextFundingTime: String(f.fundingTimestamp) } : {}),
              ...(f.interval ? { fundingHours: String(parseFloat(f.interval)) } : {}),
            });
        }
      } catch {
        /* Candle/funding coverage is independent from book and trade continuity. */
      }
    };
    void update();
    poll = setInterval(update, 30_000);
  };
  client.on('message', (buffer) => {
    try {
      const m = JSON.parse(buffer.toString());
      if (
        m.event === 'interval' &&
        ['1', '3', '5', '15', '30', '60', '120', '240', '360', '720', 'D', 'W'].includes(m.interval)
      )
        currentInterval = m.interval;
    } catch {
      /* Ignore unsupported commands. */
    }
  });
  client.on('error', () => client.close());
  client.on('close', () => {
    active = false;
    generation++;
    clearTimeout(retry);
    clearInterval(poll);
    void instance?.close().catch(() => {});
    clearTimeout(tradeTimer);
  });
  void connect();
}
