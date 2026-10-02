import { WebSocket } from 'ws';
import { BookSync } from './book-sync.mjs';
import { binance, binanceInterval, venueInstrument, venueCandles, okx } from './venues.mjs';

// Alternative venues emit the same transport schema as the Bybit adapter.
// Quantities are normalized to base units before reaching analytics or paper fills.
export function alternativeStream(client, { exchange, category, symbol, interval }) {
  let active = true,
    sockets = [],
    retry,
    heartbeat,
    poll,
    attempt = 0,
    currentInterval = interval,
    updating = false;
  let lastReceived = Date.now(),
    marketSocket;
  const send = (value) => {
    if (!active || client.readyState !== WebSocket.OPEN) return;
    if (client.bufferedAmount > 2_000_000) {
      client.close(1013, 'Slow consumer');
      return;
    }
    client.send(JSON.stringify(value));
  };
  const topic = (name, data, ts = Date.now(), type = 'snapshot') =>
    send({ topic: `${name}.${symbol}`, type, ts, data });
  const reset = () => {
    if (!active || updating) return;
    updating = true;
    clearInterval(heartbeat);
    clearInterval(poll);
    for (const ws of sockets) {
      ws.removeAllListeners();
      ws.on('error', () => {});
      ws.terminate();
    }
    sockets = [];
    send({ event: 'status', status: 'reconnecting' });
    retry = setTimeout(
      () => {
        updating = false;
        void connect();
      },
      Math.min(1000 * 2 ** attempt++, 30_000),
    );
  };
  const createSocket = (url, onOpen, onMessage) => {
    const ws = new WebSocket(url, { handshakeTimeout: 12_000 });
    sockets.push(ws);
    ws.on('open', () => {
      lastReceived = Date.now();
      onOpen(ws);
    });
    ws.on('message', (buffer) => {
      lastReceived = Date.now();
      try {
        onMessage(buffer.toString());
      } catch {
        send({
          event: 'status',
          status: 'reconnecting',
          message: 'Book continuity was lost; requesting a new snapshot.',
        });
        reset();
      }
    });
    ws.on('error', reset);
    ws.on('close', reset);
    return ws;
  };
  const connect = async () => {
    if (!active) return;
    send({ event: 'status', status: 'connecting' });
    let m;
    try {
      m = await venueInstrument(exchange, category, symbol);
    } catch (error) {
      send({ event: 'status', status: 'error', message: error.message });
      return;
    }
    if (!active) return;
    send({ event: 'session', startedAt: Date.now() });
    topic('tickers', {
      lastPrice: String(m.price),
      price24hPcnt: String(m.change / 100),
      turnover24h: String(m.volume),
    });
    const sync = new BookSync();
    if (exchange === 'binance') {
      const lower = symbol.toLowerCase(),
        futures = category === 'linear';
      const base = futures ? 'wss://fstream.binance.com' : 'wss://stream.binance.com:9443';
      let buffered = [],
        snapshotting = true;
      const handleDepth = (d) => {
        if (snapshotting) {
          buffered.push(d);
          if (buffered.length > 2000) reset();
          return;
        }
        if (sync.binance(d, futures)) topic('orderbook.50', sync.levels(), d.E || Date.now());
      };
      createSocket(
        `${base}${futures ? '/public' : ''}/stream?streams=${lower}@depth@100ms`,
        async () => {
          try {
            const book = await binance(category, 'depth', { symbol, limit: '1000' });
            if (!active || updating) return;
            sync.snapshot(book.bids, book.asks, book.lastUpdateId);
            snapshotting = false;
            topic('orderbook.50', sync.levels(), book.E || Date.now());
            for (const d of buffered) handleDepth(d);
            buffered = [];
            attempt = 0;
            send({ event: 'status', status: 'live' });
          } catch {
            reset();
          }
        },
        (raw) => {
          const m = JSON.parse(raw);
          const d = m.data || m;
          if (d.e === 'depthUpdate') handleDepth(d);
        },
      );
      const streams = [
        `${lower}@aggTrade`,
        `${lower}@ticker`,
        `${lower}@kline_${binanceInterval(currentInterval)}`,
        ...(futures ? [`${lower}@markPrice@1s`, `${lower}@forceOrder`] : []),
      ].join('/');
      marketSocket = createSocket(
        `${base}${futures ? '/market' : ''}/stream?streams=${streams}`,
        () => {},
        (raw) => {
          const message = JSON.parse(raw),
            d = message.data || message;
          if (d.e === 'aggTrade')
            topic('publicTrade', [{ i: String(d.a), S: d.m ? 'Sell' : 'Buy', p: d.p, v: d.q, T: d.T }], d.E);
          if (d.e === '24hrTicker')
            topic(
              'tickers',
              { lastPrice: d.c, price24hPcnt: String(Number(d.P) / 100), turnover24h: d.q },
              d.E,
            );
          if (d.e === 'markPriceUpdate')
            topic('tickers', { markPrice: d.p, fundingRate: d.r, nextFundingTime: String(d.T) }, d.E);
          if (d.e === 'kline' && d.k.i === binanceInterval(currentInterval))
            topic(
              'kline',
              [{ start: d.k.t, open: d.k.o, high: d.k.h, low: d.k.l, close: d.k.c, volume: d.k.v }],
              d.E,
            );
          if (d.e === 'forceOrder')
            topic(
              'allLiquidation',
              [{ T: d.o.T, S: d.o.S === 'SELL' ? 'Buy' : 'Sell', p: d.o.ap || d.o.p, v: d.o.z }],
              d.E,
            );
        },
      );
      if (futures) {
        const updateOI = async () => {
          try {
            const [r, p] = await Promise.all([
              binance(category, 'openInterest', { symbol }),
              binance(category, 'premiumIndex', { symbol }),
            ]);
            topic(
              'tickers',
              { openInterestValue: String(Number(r.openInterest) * Number(p.markPrice)) },
              Number(r.time),
            );
          } catch {
            /* Missing OI does not interrupt valid trade/depth streams. */
          }
        };
        void updateOI();
        poll = setInterval(updateOI, 30_000);
      }
    } else {
      marketSocket = createSocket(
        'wss://ws.okx.com:8443/ws/v5/public',
        (ws) => {
          ws.send(
            JSON.stringify({
              op: 'subscribe',
              args: [
                'books',
                'trades',
                'tickers',
                ...(category === 'linear' ? ['funding-rate', 'open-interest'] : []),
              ].map((channel) => ({ channel, instId: m.nativeSymbol })),
            }),
          );
        },
        (raw) => {
          if (raw === 'pong') return;
          const d = JSON.parse(raw);
          if (d.event === 'error') {
            send({ event: 'status', status: 'error', message: `OKX: ${d.msg}` });
            return;
          }
          if (!d.data) return;
          for (const r of d.data) {
            if (d.arg.channel === 'books') {
              sync.okx(d.action, r);
              topic('orderbook.50', sync.levels(m.contractMultiplier), Number(r.ts));
              attempt = 0;
              send({ event: 'status', status: 'live' });
            }
            if (d.arg.channel === 'trades')
              topic(
                'publicTrade',
                [
                  {
                    i: r.tradeId,
                    S: r.side === 'buy' ? 'Buy' : 'Sell',
                    p: r.px,
                    v: String(Number(r.sz) * m.contractMultiplier),
                    T: Number(r.ts),
                  },
                ],
                Number(r.ts),
              );
            if (d.arg.channel === 'tickers')
              topic(
                'tickers',
                {
                  lastPrice: r.last,
                  price24hPcnt: String(Number(r.open24h) ? Number(r.last) / Number(r.open24h) - 1 : 0),
                  turnover24h: String(Number(r.volCcy24h) * (category === 'linear' ? Number(r.last) : 1)),
                },
                Number(r.ts),
              );
            if (d.arg.channel === 'funding-rate')
              topic(
                'tickers',
                {
                  fundingRate: r.fundingRate,
                  nextFundingTime: r.nextFundingTime,
                  fundingHours: String((Number(r.nextFundingTime) - Number(r.fundingTime)) / 3_600_000),
                },
                Number(r.ts),
              );
            if (d.arg.channel === 'open-interest')
              topic('tickers', { openInterestValue: r.oiUsd }, Number(r.ts));
          }
        },
      );
      const pollCandle = async () => {
        try {
          const r = await venueCandles(exchange, category, symbol, currentInterval),
            c = r.data.at(-1);
          if (c) topic('kline', [{ start: c.time * 1000, ...c }]);
        } catch {
          /* Chart request errors remain visible in the chart's REST state. */
        }
      };
      void pollCandle();
      poll = setInterval(pollCandle, 10_000);
    }
    heartbeat = setInterval(() => {
      if (Date.now() - lastReceived > 45_000) return reset();
      for (const ws of sockets)
        if (ws.readyState === WebSocket.OPEN) {
          if (exchange === 'okx') ws.send('ping');
          else ws.ping();
        }
    }, 20_000);
  };
  client.on('message', (buffer) => {
    try {
      const d = JSON.parse(buffer.toString());
      if (
        d.event !== 'interval' ||
        !['1', '3', '5', '15', '30', '60', '120', '240', '360', '720', 'D', 'W'].includes(d.interval) ||
        d.interval === currentInterval
      )
        return;
      if (exchange === 'binance' && marketSocket?.readyState === WebSocket.OPEN) {
        marketSocket.send(
          JSON.stringify({
            method: 'UNSUBSCRIBE',
            params: [`${symbol.toLowerCase()}@kline_${binanceInterval(currentInterval)}`],
            id: 'old' + Date.now(),
          }),
        );
        marketSocket.send(
          JSON.stringify({
            method: 'SUBSCRIBE',
            params: [`${symbol.toLowerCase()}@kline_${binanceInterval(d.interval)}`],
            id: 'new' + Date.now(),
          }),
        );
      }
      currentInterval = d.interval;
    } catch {
      /* Ignore unsupported commands. */
    }
  });
  client.on('error', () => client.close());
  client.on('close', () => {
    active = false;
    clearTimeout(retry);
    clearInterval(heartbeat);
    clearInterval(poll);
    for (const ws of sockets) {
      ws.removeAllListeners();
      ws.on('error', () => {});
      ws.terminate();
    }
  });
  void connect();
}
