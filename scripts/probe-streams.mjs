import { WebSocket } from 'ws';
import { VENUES } from '../shared/venues.mjs';
const base = process.env.TAPE_URL || 'http://127.0.0.1:8787';
const args = process.argv.slice(2);
const category = args.includes('--linear') ? 'linear' : 'spot';
const names = args.filter((a) => a !== '--linear');
if (names.some((id) => !VENUES.some((v) => v.id === id))) throw new Error('Unknown probe venue');
const selected = VENUES.filter(
  (v) => (!names.length || names.includes(v.id)) && (category === 'spot' || v.derivatives),
);
let failures = 0;
for (let i = 0; i < selected.length; i += 3) {
  await Promise.all(
    selected.slice(i, i + 3).map(async (v) => {
      try {
        const response = await fetch(`${base}/api/markets?exchange=${v.id}&category=${category}`),
          r = await response.json();
        if (!response.ok) throw new Error(r.error);
        const m = r.data.find((m) => m.base === 'BTC') || r.data[0];
        const result = await new Promise((resolve, reject) => {
          const ws = new WebSocket(
            `${base.replace('http', 'ws')}/stream?exchange=${v.id}&category=${category}&symbol=${m.symbol}&interval=15`,
          );
          let books = 0,
            trades = 0,
            latestError = '';
          const timer = setTimeout(() => {
            ws.close();
            reject(new Error(`Timed out: ${books} book updates, ${trades} trades. ${latestError}`));
          }, 30_000);
          const finish = () => {
            clearTimeout(timer);
            ws.close();
            resolve({ venue: v.id, category, symbol: m.symbol, books, trades });
          };
          ws.on('message', (buffer) => {
            const event = JSON.parse(buffer.toString());
            if (event.message) latestError = event.message;
            if (event.topic?.startsWith('orderbook.')) {
              const bid = Number(event.data.b?.[0]?.[0]),
                ask = Number(event.data.a?.[0]?.[0]);
              if (bid > 0 && ask >= bid) books++;
            }
            if (event.topic?.startsWith('publicTrade.'))
              trades += event.data.filter(
                (t) => Number(t.p) > 0 && Number(t.v) > 0 && ['Buy', 'Sell'].includes(t.S),
              ).length;
            if (books >= 2 && trades > 0) finish();
          });
          ws.on('error', (error) => {
            clearTimeout(timer);
            ws.close();
            reject(error);
          });
        });
        console.log(JSON.stringify(result));
      } catch (error) {
        failures++;
        console.log(JSON.stringify({ venue: v.id, error: error.message }));
      }
    }),
  );
}
process.exit(failures ? 1 : 0);
