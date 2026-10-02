import { venueMarkets, venueCandles, venueRecent } from '../server/venues.mjs';
import { VENUES } from '../shared/venues.mjs';

let failures = 0;
for (let i = 0; i < VENUES.length; i += 4) {
  await Promise.all(
    VENUES.slice(i, i + 4).map(async (v) => {
      try {
        const r = await venueMarkets(v.id, 'spot');
        const m =
          r.data.find((m) => m.base === 'BTC' && m.quote === 'USDT') ||
          r.data.find((m) => m.base === 'BTC' && m.quote === 'USD') ||
          r.data[0];
        if (!m) throw new Error('No markets');
        const [bars, recent] = await Promise.all([
          venueCandles(v.id, 'spot', m.symbol, '15'),
          venueRecent(v.id, 'spot', m.symbol),
        ]);
        if (!bars.data.length || !recent.data.trades.length) throw new Error('Missing candles or trades');
        console.log(
          JSON.stringify({
            venue: v.id,
            markets: r.data.length,
            symbol: m.symbol,
            candles: bars.data.length,
            trades: recent.data.trades.length,
          }),
        );
      } catch (error) {
        failures++;
        console.log(JSON.stringify({ venue: v.id, error: error.message }));
      }
    }),
  );
}
process.exit(failures ? 1 : 0);
