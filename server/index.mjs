import express from 'express';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { WebSocket, WebSocketServer } from 'ws';
import { z } from 'zod';
import {
  DataError,
  bybit,
  cached,
  markets,
  dexPairs,
  poolCandles,
  poolTrades,
  security,
  coinglass,
} from './providers.mjs';
import { executionStatus, executionQuote, placeOrder, cancelOrder, accountSnapshot } from './execution.mjs';
import { comparison } from './comparison.mjs';
import { VENUES, VENUE_IDS, venueName } from '../shared/venues.mjs';
import { venueMarkets, venueCandles, venueRecent, venueDerivatives, historicalFlow } from './venues.mjs';
import { alternativeStream } from './streams.mjs';
import { ccxtStream } from './ccxt-adapter.mjs';
import { coinbaseStream } from './coinbase-stream.mjs';

const app = express();
app.disable('x-powered-by');
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const server = createServer(app);
const port = Number(process.env.PORT || 8787);
const localHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
const allowedOrigin = (value) => {
  if (!value) return true;
  try {
    const u = new URL(value);
    return localHosts.has(u.hostname) && ['5173', String(port)].includes(u.port);
  } catch {
    return false;
  }
};
app.use((req, res, next) => {
  let host;
  try {
    host = new URL(`http://${req.headers.host}`).hostname;
  } catch {
    return res.sendStatus(403);
  }
  if (!localHosts.has(host) || !allowedOrigin(req.headers.origin)) return res.sendStatus(403);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});
let requests = 0;
const requestWindow = setInterval(() => {
  requests = 0;
}, 60_000).unref();
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  if (++requests > 600)
    return res.status(429).json({ error: 'Local request limit reached. Try again in a minute.' });
  next();
});
const marketQuery = z.object({
  exchange: z.enum(VENUE_IDS).default('bybit'),
  category: z.enum(['spot', 'linear']).default('linear'),
  symbol: z
    .string()
    .regex(/^[A-Z0-9]{2,30}$/)
    .default('BTCUSDT'),
});
const intervalSchema = z.enum(['1', '3', '5', '15', '30', '60', '120', '240', '360', '720', 'D', 'W']);
const poolQuery = z.object({
  chain: z.string().regex(/^[a-z0-9_-]{1,30}$/),
  address: z.string().regex(/^[a-zA-Z0-9]{20,100}$/),
});
const route = (handler) => async (req, res, next) => {
  try {
    res.json(await handler(req));
  } catch (error) {
    next(error);
  }
};
app.get('/api/execution/status', (req, res) =>
  res.json({ data: executionStatus(), asOf: Date.now(), stale: false }),
);
app.get(
  '/api/execution/quote',
  route((req) => {
    const { category, symbol } = marketQuery.parse(req.query);
    return executionQuote(category, symbol);
  }),
);
app.get(
  '/api/execution/account',
  route(async (req) => {
    const { category } = marketQuery.parse(req.query);
    return { data: await accountSnapshot(category), asOf: Date.now(), stale: false };
  }),
);
const requireAction = (req, res, next) => {
  if (req.headers['x-tape-action'] !== 'explicit' || !req.is('application/json'))
    return res.status(403).json({ error: 'Explicit local order action required.' });
  next();
};
app.post(
  '/api/execution/order',
  requireAction,
  express.json({ limit: '8kb' }),
  route(async (req) => ({ data: await placeOrder(req.body), asOf: Date.now(), stale: false })),
);
app.post(
  '/api/execution/cancel',
  requireAction,
  express.json({ limit: '8kb' }),
  route(async (req) => ({ data: await cancelOrder(req.body), asOf: Date.now(), stale: false })),
);
app.get('/api/health', (req, res) =>
  res.json({ ok: true, coinglass: Boolean(process.env.COINGLASS_API_KEY), version: '0.1.0' }),
);
app.get('/api/venues', (req, res) => res.json({ data: VENUES, asOf: Date.now(), stale: false }));
app.get(
  '/api/markets',
  route((req) => {
    const { exchange, category } = marketQuery.parse(req.query);
    return venueMarkets(exchange, category);
  }),
);
app.get(
  '/api/alert-quotes',
  route(async (req) => {
    const ids = z.string().max(8000).default('').parse(req.query.ids).split(',').filter(Boolean);
    if (ids.length > 100) throw new DataError('At most 100 alert markets are supported.', 400);
    const groups = new Map();
    for (const id of ids) {
      const [exchange, category, symbol, extra] = id.split(':');
      if (extra) throw new DataError('Invalid alert market.', 400);
      const q = marketQuery.parse({ exchange, category, symbol });
      const key = `${q.exchange}:${q.category}`;
      groups.set(key, {
        exchange: q.exchange,
        category: q.category,
        symbols: [...(groups.get(key)?.symbols || []), q.symbol],
      });
    }
    const results = await Promise.allSettled(
      [...groups.values()].map(async (g) => {
        const r = await venueMarkets(g.exchange, g.category);
        return r.data
          .filter((m) => g.symbols.includes(m.symbol))
          .map((m) => ({
            exchange: g.exchange,
            category: g.category,
            symbol: m.symbol,
            price: m.price,
            asOf: r.asOf,
            stale: r.stale,
          }));
      }),
    );
    return {
      data: results.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])),
      asOf: Date.now(),
      stale: false,
      warning: results.some((r) => r.status === 'rejected')
        ? 'One or more alert venues did not respond.'
        : undefined,
    };
  }),
);
app.get(
  '/api/candles',
  route((req) => {
    const { exchange, category, symbol } = marketQuery.parse(req.query);
    const interval = intervalSchema.parse(req.query.interval || '15');
    return venueCandles(exchange, category, symbol, interval);
  }),
);
app.get(
  '/api/snapshot',
  route((req) => {
    const { exchange, category, symbol } = marketQuery.parse(req.query);
    return venueRecent(exchange, category, symbol);
  }),
);
app.get(
  '/api/derivatives',
  route((req) => {
    const { exchange, symbol } = marketQuery.parse(req.query);
    return cached(`derivatives:${exchange}:${symbol}`, 60_000, () => venueDerivatives(exchange, symbol));
  }),
);
app.get(
  '/api/flow-history',
  route((req) => {
    const { exchange, category, symbol } = marketQuery.parse(req.query);
    const q = z
      .object({
        range: z.enum(['6h', '24h', '7d', '30d']).default('24h'),
        end: z.coerce
          .number()
          .finite()
          .positive()
          .max(Date.now() + 60_000)
          .optional(),
      })
      .parse(req.query);
    return historicalFlow(exchange, category, symbol, q.range, q.end);
  }),
);
app.get(
  '/api/comparison',
  route((req) => comparison(marketQuery.parse(req.query).symbol)),
);
app.get(
  '/api/dex',
  route((req) => {
    const q = z
      .object({
        q: z.string().max(100).default(''),
        chain: z
          .string()
          .regex(/^[a-z0-9_-]{1,30}$/)
          .default('all'),
        mode: z.enum(['profiles', 'boosted']).default('profiles'),
      })
      .parse(req.query);
    return dexPairs(q.q.trim(), q.chain, q.mode);
  }),
);
app.get(
  '/api/dex/saved',
  route((req) => {
    const ids = z.string().max(8000).default('').parse(req.query.ids).split(',').filter(Boolean);
    if (ids.length > 50) throw new DataError('Saved-pool lookup supports up to 50 pools.', 400);
    const groups = new Map();
    for (const id of ids) {
      const [chain, address, extra] = id.split(':');
      if (extra) throw new DataError('Invalid saved pool identity.', 400);
      const q = poolQuery.parse({ chain, address });
      groups.set(q.chain, [...(groups.get(q.chain) || []), q.address]);
    }
    return cached(`saved:${ids.join(',')}`, 45_000, async () => {
      const { json, normalizePair } = await import('./providers.mjs');
      const requests = [...groups].flatMap(([chain, addresses]) => {
        const batches = [];
        for (let i = 0; i < addresses.length; i += 30)
          batches.push(
            json(
              `https://api.dexscreener.com/latest/dex/pairs/${chain}/${addresses.slice(i, i + 30).join(',')}`,
            ),
          );
        return batches;
      });
      const results = await Promise.allSettled(requests);
      if (results.some((r) => r.status === 'rejected'))
        throw new DataError('One or more saved-pool providers are unavailable. Retry shortly.');
      return results.flatMap((r) =>
        r.status === 'fulfilled' ? (r.value.pairs || []).map(normalizePair) : [],
      );
    });
  }),
);
app.get(
  '/api/dex/pair',
  route((req) => {
    const { chain, address } = poolQuery.parse(req.query);
    return cached(`pair:${chain}:${address}`, 30_000, async () => {
      const { json, normalizePair } = await import('./providers.mjs');
      const r = await json(`https://api.dexscreener.com/latest/dex/pairs/${chain}/${address}`);
      if (!r.pairs?.length) throw new DataError('This pool is no longer indexed.', 404);
      return normalizePair(r.pairs[0]);
    });
  }),
);
app.get(
  '/api/dex/candles',
  route((req) => {
    const { chain, address } = poolQuery.parse(req.query);
    return poolCandles(chain, address, z.enum(['1', '5', '15']).parse(req.query.interval || '15'));
  }),
);
app.get(
  '/api/dex/trades',
  route((req) => {
    const { chain, address } = poolQuery.parse(req.query);
    return poolTrades(chain, address);
  }),
);
app.get(
  '/api/dex/security',
  route((req) => {
    const { chain, address } = poolQuery.parse(req.query);
    return security(chain, address);
  }),
);
app.get(
  '/api/coinglass',
  route((req) => {
    const { symbol, exchange } = marketQuery.parse(req.query);
    const q = z
      .object({
        kind: z.enum(['cvd', 'heatmap']),
        interval: z.enum(['1m', '5m', '15m', '1h', '4h', '1d']).default('1h'),
      })
      .parse(req.query);
    return coinglass(q.kind, symbol, q.interval, venueName(exchange));
  }),
);
app.use('/api', (req, res) => res.status(404).json({ error: 'Unknown data endpoint.' }));
if (existsSync(resolve(root, 'dist/index.html'))) {
  app.use(express.static(resolve(root, 'dist')));
  app.get('/', (req, res) => res.sendFile(resolve(root, 'dist/index.html')));
}
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status =
    error instanceof z.ZodError
      ? 400
      : error.status ||
        (/Network|Request|Exchange|RateLimit|NotSupported|BadSymbol|Authentication/.test(error.name || '')
          ? 502
          : 500);
  res.status(status).json({
    error:
      error instanceof z.ZodError
        ? 'Invalid market or filter parameters.'
        : status === 500
          ? 'The local data service encountered an error.'
          : error.message,
  });
});

const wsServer = new WebSocketServer({ noServer: true, maxPayload: 8192 });
server.on('upgrade', (request, socket, head) => {
  try {
    const u = new URL(request.url, `http://${request.headers.host}`);
    if (
      u.pathname !== '/stream' ||
      !localHosts.has(u.hostname) ||
      !allowedOrigin(request.headers.origin) ||
      wsServer.clients.size >= 12
    )
      throw new Error();
    const q = marketQuery
      .extend({ interval: intervalSchema.default('15') })
      .parse(Object.fromEntries(u.searchParams));
    wsServer.handleUpgrade(request, socket, head, (client) => wsServer.emit('connection', client, q));
  } catch {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
  }
});
wsServer.on('connection', (client, { exchange, category, symbol, interval }) => {
  if (exchange === 'coinbase') return coinbaseStream(client, { category, symbol, interval });
  if (exchange === 'binance' || exchange === 'okx')
    return alternativeStream(client, { exchange, category, symbol, interval });
  if (exchange !== 'bybit') return ccxtStream(client, { exchange, category, symbol, interval });
  let chartInterval = interval;
  let upstream,
    heartbeat,
    reconnect,
    attempt = 0,
    stopped = false,
    lastReceived = 0;
  const send = (data) => {
    if (client.readyState !== WebSocket.OPEN) return;
    if (client.bufferedAmount > 2_000_000) {
      client.close(1013, 'Slow consumer; reconnect for a new snapshot.');
      return;
    }
    client.send(typeof data === 'string' ? data : JSON.stringify(data));
  };
  const connect = () => {
    if (stopped) return;
    send({ event: 'status', status: 'connecting' });
    upstream = new WebSocket(`wss://stream.bybit.com/v5/public/${category}`, { handshakeTimeout: 12_000 });
    upstream.on('open', () => {
      lastReceived = Date.now();
      attempt = 0;
      // A new session is deliberate: missed trades must never be presented as continuous CVD.
      send({ event: 'session', startedAt: Date.now() });
      upstream.send(
        JSON.stringify({
          op: 'subscribe',
          args: [
            `orderbook.50.${symbol}`,
            `publicTrade.${symbol}`,
            `tickers.${symbol}`,
            `kline.${chartInterval}.${symbol}`,
            ...(category === 'linear' ? [`allLiquidation.${symbol}`] : []),
          ],
        }),
      );
      heartbeat = setInterval(() => {
        if (Date.now() - lastReceived > 45_000) {
          upstream.terminate();
          return;
        }
        if (upstream.readyState === WebSocket.OPEN) upstream.send(JSON.stringify({ op: 'ping' }));
      }, 20_000);
    });
    upstream.on('message', (buffer) => {
      lastReceived = Date.now();
      try {
        const m = JSON.parse(buffer.toString());
        if (m.op === 'subscribe') {
          send({
            event: 'status',
            status: m.success ? 'live' : 'error',
            message: m.success ? '' : m.ret_msg || 'Market stream subscription failed.',
          });
        } else if (m.topic) send(buffer.toString());
      } catch {
        send({ event: 'status', status: 'error', message: 'An unreadable stream update was received.' });
      }
    });
    upstream.on('error', () => {
      send({ event: 'status', status: 'reconnecting' });
    });
    upstream.on('close', () => {
      clearInterval(heartbeat);
      if (!stopped) {
        send({ event: 'status', status: 'reconnecting' });
        reconnect = setTimeout(connect, Math.min(1000 * 2 ** attempt++, 30_000));
      }
    });
  };
  client.on('error', () => client.close());
  client.on('message', (buffer) => {
    try {
      const update = z
        .object({ event: z.literal('interval'), interval: intervalSchema })
        .parse(JSON.parse(buffer.toString()));
      if (update.interval === chartInterval) return;
      if (upstream?.readyState === WebSocket.OPEN) {
        upstream.send(JSON.stringify({ op: 'unsubscribe', args: [`kline.${chartInterval}.${symbol}`] }));
        upstream.send(JSON.stringify({ op: 'subscribe', args: [`kline.${update.interval}.${symbol}`] }));
      }
      chartInterval = update.interval;
    } catch {
      /* Unrecognised browser commands cannot reach the upstream feed. */
    }
  });
  client.on('close', () => {
    stopped = true;
    clearInterval(heartbeat);
    clearTimeout(reconnect);
    upstream?.terminate();
  });
  connect();
});
server.listen(port, '127.0.0.1', () =>
  console.log(`Tape data service · http://127.0.0.1:${server.address().port}`),
);
function shutdown() {
  clearInterval(requestWindow);
  for (const client of wsServer.clients) client.close(1001, 'Service stopping');
  wsServer.close();
  server.close();
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
