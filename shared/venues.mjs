// Includes CoinGecko's first ten by Trust Score as checked 2026-10-02,
// plus KuCoin and HTX. Rankings are not embedded as product recommendations.
export const VENUES = [
  { id: 'binance', name: 'Binance', derivatives: true },
  { id: 'bybit', name: 'Bybit', derivatives: true },
  { id: 'okx', name: 'OKX', derivatives: true },
  { id: 'coinbase', name: 'Coinbase', derivatives: false, adapter: 'coinbaseexchange' },
  { id: 'kraken', name: 'Kraken', derivatives: false },
  { id: 'gate', name: 'Gate', derivatives: true },
  { id: 'bitget', name: 'Bitget', derivatives: true },
  { id: 'bitstamp', name: 'Bitstamp', derivatives: false },
  { id: 'mexc', name: 'MEXC', derivatives: true },
  { id: 'cryptocom', name: 'Crypto.com', derivatives: false },
  { id: 'kucoin', name: 'KuCoin', derivatives: true },
  { id: 'htx', name: 'HTX', derivatives: true },
];
export const VENUE_IDS = VENUES.map((v) => v.id);
export const venueName = (id) => VENUES.find((v) => v.id === id)?.name || id;
export const venueWebsite = (id) =>
  ({
    binance: 'https://www.binance.com',
    bybit: 'https://www.bybit.com',
    okx: 'https://www.okx.com',
    coinbase: 'https://www.coinbase.com/advanced-trade',
    kraken: 'https://pro.kraken.com',
    gate: 'https://www.gate.com',
    bitget: 'https://www.bitget.com',
    bitstamp: 'https://www.bitstamp.net',
    mexc: 'https://www.mexc.com',
    cryptocom: 'https://crypto.com/exchange',
    kucoin: 'https://www.kucoin.com',
    htx: 'https://www.htx.com',
  })[id];
