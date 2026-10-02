import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  executionStatus,
  multipleOf,
  signedHeaders,
  validateOrder,
  placeOrder,
} from '../server/execution.mjs';
import { cryptoInstrument } from '../shared/market-policy.mjs';
const instrument = {
  status: 'Trading',
  quoteCoin: 'USDT',
  contractType: 'LinearPerpetual',
  priceFilter: { tickSize: '0.01', minPrice: '0.01', maxPrice: '1000000' },
  lotSizeFilter: {
    qtyStep: '0.001',
    minOrderQty: '0.001',
    maxOrderQty: '1000',
    maxMktOrderQty: '500',
    minNotionalValue: '5',
  },
};
const order = {
  category: 'linear',
  symbol: 'BTCUSDT',
  side: 'Buy',
  orderType: 'Limit',
  qty: '0.010',
  price: '50000.00',
  reduceOnly: false,
  orderLinkId: 'tp_' + 'a'.repeat(32),
};
const quote = () => ({ a: [['50001', '10']], b: [['50000', '10']], ts: Date.now() });
afterEach(() => vi.unstubAllEnvs());
describe('authenticated order safeguards', () => {
  it('excludes TradFi products while retaining crypto and innovation listings', () => {
    expect(cryptoInstrument({ underlyingType: 'COIN' }, 'binance')).toBe(true);
    expect(cryptoInstrument({ underlyingType: 'EQUITY' }, 'binance')).toBe(false);
    expect(cryptoInstrument({ symbolType: 'innovation' }, 'bybit')).toBe(true);
    for (const symbolType of ['stock', 'ETF', 'forex', 'commodity']) {
      expect(cryptoInstrument({ symbolType }, 'bybit')).toBe(false);
      expect(() => validateOrder(order, { ...instrument, symbolType }, quote(), 1000)).toThrow('crypto');
    }
  });
  it('uses exact decimal arithmetic for tiny prices and large meme-coin quantities', () => {
    expect(multipleOf('0.000000000123', '0.000000000001')).toBe(true);
    expect(multipleOf('10000000000000000.1', '1')).toBe(false);
    expect(multipleOf('0.010', '0.003')).toBe(false);
  });
  it('signs the exact transmitted GET query and POST body', () => {
    const signed = signedHeaders('POST', { symbol: 'BTCUSDT', qty: '0.01' }, 'test-key', 'test-secret', 1234);
    expect(signed.headers['X-BAPI-SIGN']).toBe(
      createHmac('sha256', 'test-secret')
        .update('1234test-key5000' + signed.serialized)
        .digest('hex'),
    );
    expect(
      signedHeaders('GET', { category: 'linear', symbol: 'BTCUSDT' }, 'test-key', 'test-secret', 1234)
        .serialized,
    ).toBe('category=linear&symbol=BTCUSDT');
  });
  it('requires configured credentials, trading opt-in and a separate mainnet opt-in', async () => {
    vi.stubEnv('BYBIT_API_KEY', '');
    vi.stubEnv('BYBIT_API_SECRET', '');
    vi.stubEnv('BYBIT_TRADING_ENABLED', 'true');
    expect(executionStatus().enabled).toBe(false);
    await expect(placeOrder(order)).rejects.toThrow('disabled');
    vi.stubEnv('BYBIT_API_KEY', 'unit-key');
    vi.stubEnv('BYBIT_API_SECRET', 'unit-secret');
    vi.stubEnv('BYBIT_NETWORK', 'mainnet');
    vi.stubEnv('BYBIT_ALLOW_MAINNET', 'false');
    expect(executionStatus().enabled).toBe(false);
    vi.stubEnv('BYBIT_ALLOW_MAINNET', 'true');
    expect(executionStatus().enabled).toBe(true);
  });
  it('enforces tick size, quantity precision, quote freshness and notional caps', () => {
    expect(validateOrder(order, instrument, quote(), 1000).qty).toBe('0.010');
    expect(() => validateOrder({ ...order, price: '50000.001' }, instrument, quote(), 1000)).toThrow(
      'multiple',
    );
    expect(() => validateOrder({ ...order, qty: '0.0001' }, instrument, quote(), 1000)).toThrow('multiple');
    expect(() => validateOrder(order, instrument, { ...quote(), ts: Date.now() - 10000 }, 1000)).toThrow(
      'Fresh',
    );
    expect(() => validateOrder({ ...order, qty: '1' }, instrument, quote(), 1000)).toThrow('cap');
  });
  it('maps spot quantities to base units and attaches explicit market slippage protection', () => {
    const value = validateOrder(
      { ...order, category: 'spot', orderType: 'Market' },
      { ...instrument, contractType: undefined },
      quote(),
      1000,
    );
    expect(value.marketUnit).toBe('baseCoin');
    expect(value.slippageTolerance).toBe('0.50');
    expect(value.reduceOnly).toBeUndefined();
    expect(() =>
      validateOrder({ ...order, category: 'spot', reduceOnly: true }, instrument, quote(), 1000),
    ).toThrow('perpetuals');
  });
  it('validates trigger direction and closing-only conditional payloads', () => {
    const result = validateOrder(
      { ...order, orderType: 'Market', triggerPrice: '49000.00', triggerDirection: 2, reduceOnly: true },
      instrument,
      quote(),
      1000,
    );
    expect(result.closeOnTrigger).toBe(true);
    expect(result.triggerBy).toBe('LastPrice');
    expect(result.slippageTolerance).toBeUndefined();
    expect(() =>
      validateOrder({ ...order, triggerPrice: '51000.00', triggerDirection: 2 }, instrument, quote(), 1000),
    ).toThrow('direction');
  });
});
