export type Category = 'linear' | 'spot';
export type View = 'desk' | 'markets' | 'dex' | 'journal' | 'execution';
export type Exchange =
  | 'binance'
  | 'bybit'
  | 'okx'
  | 'coinbase'
  | 'kraken'
  | 'gate'
  | 'bitget'
  | 'bitstamp'
  | 'mexc'
  | 'cryptocom'
  | 'kucoin'
  | 'htx';
export interface Market {
  exchange: Exchange;
  volumeEstimate?: boolean;
  symbol: string;
  base: string;
  quote: string;
  category: Category;
  price: number;
  change: number;
  volume: number;
  high: number;
  low: number;
  funding: number | null;
  fundingHours: number | null;
  nextFunding: number | null;
  oi: number | null;
  tick: number | null;
  qtyStep: number | null;
}
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
export interface Envelope<T> {
  data: T;
  asOf: number;
  stale: boolean;
  warning?: string;
  reason?: string;
}
export interface DexPair {
  chain: string;
  dex: string;
  address: string;
  token: string;
  symbol: string;
  name: string;
  quote: string;
  price: number | null;
  change: number | null;
  liquidity: number | null;
  volume: number | null;
  marketCap: number | null;
  fdv: number | null;
  buys: number | null;
  sells: number | null;
  created: number | null;
  url: string;
  boosted: boolean;
}
export interface TokenSecurity {
  honeypot: boolean | null;
  mintable: boolean | null;
  openSource: boolean | null;
  sellBlocked: boolean | null;
  buyTax: number | null;
  sellTax: number | null;
  holders: number | null;
  owner: string | null;
}
