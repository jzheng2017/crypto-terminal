import { bybit, cached, json, DataError, markets } from './providers.mjs';

export function canonicalBase(base) {
  const m = /^(1000000|10000|1000|100)([A-Z][A-Z0-9]+)$/.exec(base);
  return m ? { token: m[2], multiplier: Number(m[1]) } : { token: base, multiplier: 1 };
}
export async function comparison(symbol) {
  return cached(`comparison:${symbol}`, 30_000, async () => {
    const m = (await markets('linear')).data.find((m) => m.symbol === symbol);
    if (!m) throw new DataError('No perpetual instrument exists for this symbol.', 404);
    const { token, multiplier } = canonicalBase(m.base);
    const own = {
      venue: 'Bybit',
      quote: 'USDT',
      price: m.price / multiplier,
      funding: m.funding,
      hours: m.fundingHours,
      spreadBps: null,
      asOf: Date.now(),
      stale: false,
    };
    const [okx, hyperliquid] = await Promise.allSettled([
      cached(`okx:${token}`, 30_000, async () => {
        const instId = `${token}-USDT-SWAP`;
        const [ticker, funding] = await Promise.all([
          json(`https://www.okx.com/api/v5/market/ticker?instId=${instId}`),
          json(`https://www.okx.com/api/v5/public/funding-rate?instId=${instId}`),
        ]);
        if (ticker.code !== '0' || funding.code !== '0' || !ticker.data?.[0] || !funding.data?.[0])
          throw new DataError('Instrument not covered on OKX.');
        const t = ticker.data[0],
          f = funding.data[0];
        return {
          venue: 'OKX',
          quote: 'USDT',
          price: Number(t.last),
          funding: f.fundingRate === '' ? null : Number(f.fundingRate) * 100,
          hours: (Number(f.nextFundingTime) - Number(f.fundingTime)) / 3_600_000,
          spreadBps:
            t.askPx && t.bidPx ? ((Number(t.askPx) - Number(t.bidPx)) / Number(t.last)) * 10000 : null,
        };
      }),
      cached('hyperliquid:contexts', 30_000, async () => {
        const response = await fetch('https://api.hyperliquid.xyz/info', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{"type":"metaAndAssetCtxs"}',
          signal: AbortSignal.timeout(12_000),
        });
        if (!response.ok) throw new DataError('Hyperliquid data unavailable.');
        return response.json();
      }),
    ]);
    const rows = [own],
      warnings = [];
    if (okx.status === 'fulfilled')
      rows.push({ ...okx.value.data, asOf: okx.value.asOf, stale: okx.value.stale });
    else warnings.push('OKX instrument or feed unavailable.');
    if (hyperliquid.status === 'fulfilled') {
      const [meta, contexts] = hyperliquid.value.data;
      const index = meta?.universe?.findIndex((x) => x.name === token);
      if (index >= 0 && contexts[index]) {
        const c = contexts[index];
        rows.push({
          venue: 'Hyperliquid',
          quote: 'USDC',
          price: Number(c.midPx || c.markPx),
          funding: Number(c.funding) * 100,
          hours: 1,
          spreadBps: null,
          asOf: hyperliquid.value.asOf,
          stale: hyperliquid.value.stale,
        });
      } else warnings.push('Hyperliquid has no exact token match.');
    } else warnings.push('Hyperliquid feed unavailable.');
    return { token, multiplier, rows, warnings };
  });
}
