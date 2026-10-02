import { describe, expect, it } from 'vitest';
import { OrderBook, FlowEngine, aggregateLevels } from '../shared/flow';
import { executePaper, initialPaper, account, paperFillPrice } from '../shared/paper';
import { sizeByRisk, evaluateAlert } from '../shared/risk';
import { price, compact } from '../src/format';
import { BookSync, crc32 } from '../server/book-sync.mjs';
import { flowHistory } from '../server/venues.mjs';
import { tradeWindow } from '../server/trade-window.mjs';

describe('market data integrity', () => {
  it('captures only newer prints when a history window overlaps and flags missing continuity', () => {
    const rows = [1, 2, 3].map((id) => ({
      id: String(id),
      timestamp: id * 1000,
      side: 'buy',
      price: 100,
      amount: 1,
    }));
    expect(tradeWindow(rows, '2').fresh.map((t) => t.id)).toEqual(['3']);
    expect(tradeWindow(rows, '2').gap).toBe(false);
    expect(tradeWindow(rows, '0').gap).toBe(true);
    expect(tradeWindow([], '3').latestId).toBe('3');
  });
  it('requires a snapshot, removes zero quantities and rejects out-of-order deltas', () => {
    const b = new OrderBook();
    expect(b.apply('delta', { b: [['99', '5']], a: [], u: 2 }, 1)).toBe(false);
    b.apply('snapshot', { b: [['99', '1']], a: [['101', '2']], u: 5, seq: 10 }, 2);
    b.apply(
      'delta',
      {
        b: [
          ['99', '0'],
          ['98', '3'],
        ],
        a: [],
        u: 6,
        seq: 11,
      },
      3,
    );
    expect(b.levels().bids).toEqual([{ price: 98, size: 3 }]);
    expect(b.apply('delta', { b: [['98', '20']], a: [], u: 5, seq: 10 }, 4)).toBe(false);
    b.apply('snapshot', { b: [['97', '1']], a: [], u: 1, seq: 1 }, 5);
    expect(b.levels().bids).toEqual([{ price: 97, size: 1 }]);
  });
  it('computes quote-notional CVD once per trade and starts a fresh session without old cache trades', () => {
    const f = new FlowEngine(1, 1000);
    const buy = { id: 'buy', side: 'Buy' as const, price: 100, size: 2, time: 2000 };
    f.addTrade(buy);
    f.addTrade(buy);
    f.addTrade({ id: 'sell', side: 'Sell', price: 105, size: 1, time: 3000 });
    expect(f.snapshot().cvd).toBe(95);
    expect(f.snapshot().buy).toBe(200);
    expect(f.snapshot().sell).toBe(105);
    expect(f.snapshot().bins.reduce((a, b) => a + b.buy + b.sell, 0)).toBe(305);
    const next = new FlowEngine(1, 4000);
    expect(next.addTrade(buy)).toBe(false);
    expect(next.snapshot().cvd).toBe(0);
  });
  it('preserves small token prices and groups bids/asks outward', () => {
    expect(price(0.0000000001234)).not.toBe('0');
    expect(price(1.23e-30)).toContain('e-30');
    expect(price(100.5, 0.5)).toBe('100.5');
    expect(compact(0.00012)).not.toBe('0');
    const levels = [
      { price: 0.000011, size: 1 },
      { price: 0.000012, size: 2 },
    ];
    expect(aggregateLevels(levels, 0.00001, 'bid')[0]).toEqual({ price: 0.00001, size: 3 });
    expect(aggregateLevels(levels, 0.00001, 'ask')[0]).toEqual({ price: 0.00002, size: 3 });
  });
  it('bridges Binance snapshots and rejects missing futures depth updates', () => {
    const b = new BookSync();
    b.snapshot([['99', '1']], [['101', '1']], 100);
    expect(b.binance({ U: 98, u: 99, pu: 97, b: [], a: [] }, true)).toBe(false);
    b.binance({ U: 99, u: 101, pu: 98, b: [['99', '2']], a: [] }, true);
    expect(() => b.binance({ U: 104, u: 105, pu: 103, b: [], a: [] }, true)).toThrow('gap');
    expect(b.levels().b[0]).toEqual(['99', '2']);
  });
  it('validates OKX CRC checksums and normalizes contract quantities', () => {
    expect(crc32('123456789')).toBe(0xcbf43926);
    const b = new BookSync();
    b.okx('snapshot', {
      bids: [['99', '2']],
      asks: [['101', '3']],
      seqId: 1,
      checksum: crc32('99:2:101:3') | 0,
    });
    expect(b.levels(0.01).b[0]).toEqual(['99', '0.02']);
    expect(() => b.okx('update', { bids: [], asks: [], prevSeqId: 1, seqId: 2, checksum: 123 })).toThrow(
      'checksum',
    );
    b.okx('snapshot', { bids: [['99', '2']], asks: [['101', '3']], seqId: 5, checksum: 0 });
    b.okx('update', { bids: [], asks: [], prevSeqId: 5, seqId: 6, checksum: 0 });
    expect(() => b.okx('update', { bids: [], asks: [], prevSeqId: 8, seqId: 9, checksum: 0 })).toThrow('gap');
  });
  it('rebases historical CVD from taker volumes, deduplicates bars and reports missing coverage', () => {
    const rows = [
      { time: 0, buy: 10, sell: 3 },
      { time: 0, buy: 10, sell: 3 },
      { time: 300, buy: 4, sell: 8 },
      { time: 900, buy: 6, sell: 1 },
    ];
    const h = flowHistory(rows, 'fixture', 300, 0, 1_000_000);
    expect(h.bars.map((b) => b.cvd)).toEqual([7, 3, 8]);
    expect(h.gaps).toBe(1);
    expect(h.buy).toBe(20);
    expect(h.sell).toBe(12);
  });
});

const order = (overrides: Record<string, unknown> = {}) => ({
  exchange: 'bybit',
  symbol: 'BTCUSDT',
  category: 'linear' as const,
  side: 'Buy' as const,
  quantity: 2,
  bid: 99,
  ask: 100,
  quoteTime: 1000,
  now: 1000,
  bids: [{ price: 99, size: 100 }],
  asks: [{ price: 100, size: 100 }],
  ...overrides,
});
describe('paper execution accounting', () => {
  it('walks visible liquidity and rejects an oversized fill', () => {
    expect(
      paperFillPrice(
        [
          { price: 100, size: 1 },
          { price: 102, size: 2 },
        ],
        2,
      ),
    ).toBe(101);
    expect(() => paperFillPrice([{ price: 100, size: 1 }], 2)).toThrow('liquidity');
  });
  it('nets partial closes and reversals, realizes PnL and charges both fees', () => {
    const opened = executePaper(initialPaper(), order());
    const closed = executePaper(
      opened,
      order({ side: 'Sell', quantity: 1, bid: 110, ask: 111, bids: [{ price: 110, size: 100 }] }),
    );
    expect(closed.positions['bybit:linear:BTCUSDT'].quantity).toBe(1);
    expect(closed.fills[0].realized).toBe(10);
    expect(closed.cash).toBeCloseTo(100000 + 10 - 200 * 0.0006 - 110 * 0.0006);
    const reversed = executePaper(
      closed,
      order({ side: 'Sell', quantity: 3, bid: 110, ask: 111, bids: [{ price: 110, size: 100 }] }),
    );
    expect(reversed.positions['bybit:linear:BTCUSDT'].quantity).toBe(-2);
    expect(reversed.positions['bybit:linear:BTCUSDT'].average).toBe(110);
  });
  it('separates positions on different exchanges', () => {
    const bybit = executePaper(initialPaper(), order());
    const binance = executePaper(bybit, order({ exchange: 'binance', side: 'Sell' }));
    expect(Object.keys(binance.positions)).toHaveLength(2);
    expect(binance.positions['bybit:linear:BTCUSDT'].quantity).toBe(2);
    expect(binance.positions['binance:linear:BTCUSDT'].quantity).toBe(-2);
  });
  it('rejects stale quotes, unsupported spot shorts and excess buying power', () => {
    expect(() => executePaper(initialPaper(), order({ now: 8000 }))).toThrow('stale');
    expect(() => executePaper(initialPaper(), order({ category: 'spot', side: 'Sell' }))).toThrow('hold');
    expect(() =>
      executePaper(initialPaper(), order({ quantity: 1001, asks: [{ price: 100, size: 2000 }] })),
    ).toThrow('buying power');
  });
  it('marks unrealized PnL without double-counting position notional', () => {
    const state = executePaper(initialPaper(), order());
    state.positions['bybit:linear:BTCUSDT'].mark = 110;
    expect(account(state).unrealized).toBe(20);
    expect(account(state).equity).toBeCloseTo(100019.88);
  });
});
describe('risk and alerts', () => {
  it('includes fees and slippage and rounds risk size down to the instrument step', () => {
    const result = sizeByRisk({
      equity: 10000,
      riskPercent: 1,
      entry: 100,
      stop: 95,
      side: 'long',
      feeBps: 6,
      slippageBps: 5,
      quantityStep: 0.1,
    });
    expect(result.estimatedLoss).toBeLessThanOrEqual(100);
    expect(result.quantity).toBeCloseTo(19.1);
    expect(() =>
      sizeByRisk({
        equity: 10000,
        riskPercent: 1,
        entry: 100,
        stop: 105,
        side: 'long',
        feeBps: 0,
        slippageBps: 0,
      }),
    ).toThrow('below');
  });
  it('fires an alert once on crossing rather than on every quote', () => {
    const alert = {
      exchange: 'binance',
      id: 'a',
      symbol: 'BTCUSDT',
      category: 'linear' as const,
      direction: 'above' as const,
      threshold: 100,
      lastPrice: 99,
      triggeredAt: null,
      createdAt: 1,
    };
    const fired = evaluateAlert(alert, 101, 2000);
    expect(fired.triggeredAt).toBe(2000);
    expect(evaluateAlert(fired, 102, 3000).triggeredAt).toBe(2000);
  });
});
