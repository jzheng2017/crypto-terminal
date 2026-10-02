export interface Position {
  exchange: string;
  symbol: string;
  category: 'spot' | 'linear';
  quantity: number;
  average: number;
  mark: number;
  updatedAt: number;
}
export interface Fill {
  exchange: string;
  id: string;
  symbol: string;
  category: string;
  side: string;
  price: number;
  quantity: number;
  fee: number;
  realized: number;
  time: number;
}
export interface PaperState {
  version: 1;
  cash: number;
  positions: Record<string, Position>;
  fills: Fill[];
}
export const initialPaper = (): PaperState => ({ version: 1, cash: 100_000, positions: {}, fills: [] });
export function paperFillPrice(levels: { price: number; size: number }[], quantity: number) {
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Enter a positive quantity.');
  let remaining = quantity,
    notional = 0;
  for (const level of levels) {
    if (![level.price, level.size].every((n) => Number.isFinite(n) && n > 0)) continue;
    const take = Math.min(remaining, level.size);
    notional += take * level.price;
    remaining -= take;
    if (remaining <= quantity * 1e-12) return notional / quantity;
  }
  throw new Error('The order exceeds visible book liquidity. Reduce its size.');
}
export function account(state: PaperState) {
  const positions = Object.values(state.positions);
  const unrealized = positions.reduce((sum, p) => sum + (p.mark - p.average) * p.quantity, 0);
  return {
    unrealized,
    equity: state.cash + unrealized,
    exposure: positions.reduce((sum, p) => sum + Math.abs(p.quantity * p.mark), 0),
  };
}
export function executePaper(
  state: PaperState,
  order: {
    exchange: string;
    symbol: string;
    category: 'linear' | 'spot';
    side: 'Buy' | 'Sell';
    quantity: number;
    bid: number;
    ask: number;
    quoteTime: number;
    bids: { price: number; size: number }[];
    asks: { price: number; size: number }[];
    now?: number;
  },
): PaperState {
  const now = order.now ?? Date.now();
  if (now - order.quoteTime > 5000 || order.quoteTime > now + 1000)
    throw new Error('The quote is stale. Wait for the live order book.');
  if (!Number.isFinite(order.quantity) || order.quantity <= 0) throw new Error('Enter a positive quantity.');
  if (![order.bid, order.ask].every((p) => Number.isFinite(p) && p > 0) || order.ask < order.bid)
    throw new Error('A valid bid and ask are required.');
  const fillPrice = paperFillPrice(order.side === 'Buy' ? order.asks : order.bids, order.quantity);
  const signed = order.side === 'Buy' ? order.quantity : -order.quantity;
  const key = `${order.exchange}:${order.category}:${order.symbol}`,
    old = state.positions[key];
  const previousQty = old?.quantity ?? 0,
    newQty = previousQty + signed;
  if (order.category === 'spot' && newQty < -1e-12)
    throw new Error('Spot paper orders can only sell a quantity you hold.');
  const reducing = previousQty * signed < 0;
  const closeQty = reducing ? Math.min(Math.abs(previousQty), Math.abs(signed)) : 0;
  const realized = closeQty * (fillPrice - (old?.average ?? fillPrice)) * Math.sign(previousQty);
  const fee = fillPrice * order.quantity * 0.0006;
  const cash = state.cash + realized - fee;
  const average =
    newQty === 0
      ? 0
      : !old || Math.sign(newQty) !== Math.sign(previousQty)
        ? fillPrice
        : reducing
          ? old.average
          : (Math.abs(previousQty) * old.average + Math.abs(signed) * fillPrice) / Math.abs(newQty);
  const positions = { ...state.positions };
  if (Math.abs(newQty) < 1e-12) delete positions[key];
  else
    positions[key] = {
      exchange: order.exchange,
      symbol: order.symbol,
      category: order.category,
      quantity: newQty,
      average,
      mark: fillPrice,
      updatedAt: now,
    };
  const next = { ...state, cash, positions };
  const before = account(state),
    after = account(next);
  if (after.exposure > after.equity && after.exposure > before.exposure + 0.001)
    throw new Error('This exceeds the paper account’s available buying power (1× gross exposure).');
  return {
    ...next,
    fills: [
      {
        exchange: order.exchange,
        id: crypto.randomUUID(),
        symbol: order.symbol,
        category: order.category,
        side: order.side,
        price: fillPrice,
        quantity: order.quantity,
        fee,
        realized,
        time: now,
      },
      ...state.fills,
    ].slice(0, 200),
  };
}
