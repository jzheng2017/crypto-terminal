export interface Level {
  price: number;
  size: number;
}
export interface Trade {
  id: string;
  side: 'Buy' | 'Sell';
  price: number;
  size: number;
  time: number;
}
export interface Liquidation {
  id: string;
  position: 'Long' | 'Short';
  price: number;
  value: number;
  time: number;
}
export interface FlowPoint {
  time: number;
  value: number;
}
export interface VolumeBin {
  price: number;
  buy: number;
  sell: number;
}
export interface HeatSample {
  time: number;
  bids: Level[];
  asks: Level[];
}
export interface FlowSnapshot {
  bids: Level[];
  asks: Level[];
  bookTime: number;
  buy: number;
  sell: number;
  cvd: number;
  points: FlowPoint[];
  trades: Trade[];
  bins: VolumeBin[];
  heat: HeatSample[];
  liquidations: Liquidation[];
  longLiquidated: number;
  shortLiquidated: number;
  startedAt: number;
}
const valid = (n: number) => Number.isFinite(n) && n > 0;
export class OrderBook {
  bids = new Map<number, number>();
  asks = new Map<number, number>();
  ready = false;
  updateId = 0;
  seq = 0;
  time = 0;

  apply(
    type: string,
    data: { b: string[][]; a: string[][]; u?: number; seq?: number },
    timestamp: number,
  ): boolean {
    const reset = type === 'snapshot' || data.u === 1;
    if (!reset && (!this.ready || (data.seq && data.seq <= this.seq) || (data.u && data.u <= this.updateId)))
      return false;
    if (reset) {
      this.bids.clear();
      this.asks.clear();
      this.ready = true;
    }
    for (const [side, rows] of [
      [this.bids, data.b],
      [this.asks, data.a],
    ] as const) {
      for (const row of rows || []) {
        const p = Number(row[0]),
          size = Number(row[1]);
        if (!valid(p) || !Number.isFinite(size) || size < 0) continue;
        if (size === 0) side.delete(p);
        else side.set(p, size);
      }
      if (side.size > 2000) {
        this.ready = false;
        this.bids.clear();
        this.asks.clear();
        return false;
      }
    }
    this.updateId = data.u ?? this.updateId;
    this.seq = data.seq ?? this.seq;
    this.time = timestamp;
    return true;
  }
  levels() {
    return {
      bids: [...this.bids]
        .sort((a, b) => b[0] - a[0])
        .slice(0, 50)
        .map(([price, size]) => ({ price, size })),
      asks: [...this.asks]
        .sort((a, b) => a[0] - b[0])
        .slice(0, 50)
        .map(([price, size]) => ({ price, size })),
    };
  }
}

export class FlowEngine {
  book = new OrderBook();
  buy = 0;
  sell = 0;
  startedAt: number;
  trades: Trade[] = [];
  points: FlowPoint[] = [];
  heat: HeatSample[] = [];
  bins = new Map<number, VolumeBin>();
  liquidations: Liquidation[] = [];
  longLiquidated = 0;
  shortLiquidated = 0;
  private seen = new Map<string, boolean>();
  private seenLiquidations = new Map<string, boolean>();
  constructor(
    public binSize: number,
    startedAt = Date.now(),
  ) {
    this.startedAt = startedAt;
  }
  addTrade(t: Trade) {
    if (
      !t.id ||
      this.seen.has(t.id) ||
      !valid(t.price) ||
      !valid(t.size) ||
      !Number.isFinite(t.time) ||
      t.time < this.startedAt ||
      !['Buy', 'Sell'].includes(t.side)
    )
      return false;
    this.seen.set(t.id, true);
    if (this.seen.size > 25_000) this.seen.delete(this.seen.keys().next().value!);
    const value = t.price * t.size;
    if (!Number.isFinite(value)) return false;
    if (t.side === 'Buy') this.buy += value;
    else this.sell += value;
    this.trades.unshift(t);
    this.trades.length = Math.min(this.trades.length, 120);
    const previous = this.points.at(-1);
    const second = Math.max(Math.floor(t.time / 1000), previous?.time ?? 0);
    const point = { time: second, value: this.buy - this.sell };
    if (previous?.time === second) this.points[this.points.length - 1] = point;
    else this.points.push(point);
    if (this.points.length > 1800) this.points.shift();
    const key = Math.round(t.price / this.binSize);
    const bin = this.bins.get(key) ?? { price: key * this.binSize, buy: 0, sell: 0 };
    if (t.side === 'Buy') bin.buy += value;
    else bin.sell += value;
    this.bins.set(key, bin);
    // Rebin rather than discard volume when a volatile small-cap traverses many levels.
    if (this.bins.size > 2000) {
      this.binSize *= 2;
      const merged = new Map<number, VolumeBin>();
      for (const b of this.bins.values()) {
        const k = Math.round(b.price / this.binSize),
          m = merged.get(k) ?? { price: k * this.binSize, buy: 0, sell: 0 };
        m.buy += b.buy;
        m.sell += b.sell;
        merged.set(k, m);
      }
      this.bins = merged;
    }
    return true;
  }
  addLiquidation(t: Liquidation) {
    if (this.seenLiquidations.has(t.id) || !valid(t.value) || !valid(t.price)) return;
    this.seenLiquidations.set(t.id, true);
    if (this.seenLiquidations.size > 5000)
      this.seenLiquidations.delete(this.seenLiquidations.keys().next().value!);
    if (t.position === 'Long') this.longLiquidated += t.value;
    else this.shortLiquidated += t.value;
    this.liquidations.unshift(t);
    this.liquidations.length = Math.min(100, this.liquidations.length);
  }
  snapshot(): FlowSnapshot {
    const levels = this.book.levels();
    const second = Math.floor(this.book.time / 1000);
    if (this.book.ready && second > (this.heat.at(-1)?.time ?? 0)) {
      this.heat.push({ time: second, ...levels });
      if (this.heat.length > 180) this.heat.shift();
    }
    return {
      ...levels,
      bookTime: this.book.time,
      buy: this.buy,
      sell: this.sell,
      cvd: this.buy - this.sell,
      points: [...this.points],
      trades: [...this.trades],
      bins: [...this.bins.values()].sort((a, b) => b.price - a.price),
      heat: [...this.heat],
      liquidations: [...this.liquidations],
      longLiquidated: this.longLiquidated,
      shortLiquidated: this.shortLiquidated,
      startedAt: this.startedAt,
    };
  }
}

export function aggregateLevels(levels: Level[], step: number, side: 'bid' | 'ask'): Level[] {
  if (!valid(step)) return levels;
  const grouped = new Map<number, number>();
  for (const level of levels) {
    const scaled = level.price / step;
    const k = side === 'bid' ? Math.floor(scaled + 1e-7) : Math.ceil(scaled - 1e-7);
    grouped.set(k, (grouped.get(k) ?? 0) + level.size);
  }
  return [...grouped]
    .sort((a, b) => (side === 'bid' ? b[0] - a[0] : a[0] - b[0]))
    .map(([k, size]) => ({ price: Number((k * step).toPrecision(15)), size }));
}
