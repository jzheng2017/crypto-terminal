import { WebSocket } from 'ws';
import { BookSync } from './book-sync.mjs';
import { ccxtInstrument, ccxtCandles } from './ccxt-adapter.mjs';

// Coinbase level2_batch is explicitly public; the ordinary level2 channel
// requires authentication. Match sides describe the maker and are inverted.
export function coinbaseStream(client, { category, symbol, interval }) {
  let active = true,
    ws,
    retry,
    heartbeat,
    poll,
    currentInterval = interval,
    attempt = 0;
  const send = (value) => {
    if (active && client.readyState === 1) {
      if (client.bufferedAmount > 2_000_000) return client.close(1013, 'Slow consumer');
      client.send(JSON.stringify(value));
    }
  };
  const topic = (name, data, ts = Date.now()) =>
    send({ topic: `${name}.${symbol}`, type: 'snapshot', data, ts });
  const connect = async () => {
    let market;
    try {
      market = await ccxtInstrument('coinbase', category, symbol);
    } catch (error) {
      send({ event: 'status', status: 'error', message: error.message });
      return;
    }
    if (!active) return;
    const book = new BookSync();
    let sequence = 0,
      tradeId = 0,
      received = Date.now();
    ws = new WebSocket('wss://ws-feed.exchange.coinbase.com', { handshakeTimeout: 12_000 });
    ws.on('open', () => {
      send({ event: 'session', startedAt: Date.now() });
      ws.send(
        JSON.stringify({
          type: 'subscribe',
          product_ids: [market.nativeSymbol],
          channels: ['level2_batch', 'matches', 'ticker', 'heartbeat'],
        }),
      );
      heartbeat = setInterval(() => {
        if (Date.now() - received > 15_000) ws.terminate();
      }, 5000);
    });
    ws.on('message', (buffer) => {
      received = Date.now();
      try {
        const m = JSON.parse(buffer.toString());
        if (m.type === 'error') {
          send({ event: 'status', status: 'error', message: `Coinbase: ${m.message}` });
          return;
        }
        if (m.type === 'snapshot') {
          book.snapshot(m.bids, m.asks, ++sequence);
          topic('orderbook.50', book.levels());
          attempt = 0;
          send({ event: 'status', status: 'live' });
        }
        if (m.type === 'l2update') {
          if (!book.ready) {
            ws.terminate();
            return;
          }
          const bids = [],
            asks = [];
          for (const [side, p, q] of m.changes) (side === 'buy' ? bids : asks).push([p, q]);
          book.updateSide(book.bids, bids);
          book.updateSide(book.asks, asks);
          book.id = ++sequence;
          topic('orderbook.50', book.levels(), Date.parse(m.time) || Date.now());
        }
        if (m.type === 'match') {
          // Match-channel trade IDs and heartbeat IDs reveal dropped executions.
          if (tradeId && Number(m.trade_id) > tradeId + 1) {
            send({
              event: 'status',
              status: 'reconnecting',
              message: 'Coinbase trade continuity was lost; restarting the flow session.',
            });
            ws.terminate();
            return;
          }
          if (Number(m.trade_id) <= tradeId) return;
          tradeId = Number(m.trade_id);
          topic(
            'publicTrade',
            [
              {
                i: String(m.trade_id),
                S: m.side === 'buy' ? 'Sell' : 'Buy',
                p: m.price,
                v: m.size,
                T: Date.parse(m.time),
              },
            ],
            Date.parse(m.time),
          );
        }
        if (m.type === 'heartbeat' && tradeId && Number(m.last_trade_id) > tradeId) {
          ws.terminate();
          return;
        }
        if (m.type === 'ticker')
          topic(
            'tickers',
            {
              lastPrice: m.price,
              price24hPcnt: String(Number(m.open_24h) ? Number(m.price) / Number(m.open_24h) - 1 : 0),
              turnover24h: String(Number(m.volume_24h) * Number(m.price)),
            },
            Date.parse(m.time) || Date.now(),
          );
      } catch {
        ws.terminate();
      }
    });
    const candle = async () => {
      try {
        const r = await ccxtCandles('coinbase', category, symbol, currentInterval),
          c = r.data.at(-1);
        if (c) topic('kline', [{ start: c.time * 1000, ...c }]);
      } catch {
        /* Chart errors are independently reported by REST. */
      }
    };
    void candle();
    poll = setInterval(candle, 30_000);
    ws.on('error', () => {});
    ws.on('close', () => {
      clearInterval(heartbeat);
      clearInterval(poll);
      if (active) {
        send({ event: 'status', status: 'reconnecting' });
        retry = setTimeout(connect, Math.min(1000 * 2 ** attempt++, 30_000));
      }
    });
  };
  client.on('message', (buffer) => {
    try {
      const m = JSON.parse(buffer.toString());
      if (m.event === 'interval' && ['1', '5', '15', '60', '240', 'D'].includes(m.interval))
        currentInterval = m.interval;
    } catch {}
  });
  client.on('close', () => {
    active = false;
    clearTimeout(retry);
    clearInterval(heartbeat);
    clearInterval(poll);
    ws?.terminate();
  });
  client.on('error', () => client.close());
  void connect();
}
