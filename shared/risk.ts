export function sizeByRisk(input: {
  equity: number;
  riskPercent: number;
  entry: number;
  stop: number;
  side: 'long' | 'short';
  feeBps: number;
  slippageBps: number;
  quantityStep?: number | null;
}) {
  const { equity, riskPercent, entry, stop, side, feeBps, slippageBps, quantityStep } = input;
  if (
    ![equity, riskPercent, entry, stop, feeBps, slippageBps].every(Number.isFinite) ||
    equity <= 0 ||
    riskPercent <= 0 ||
    riskPercent > 100 ||
    entry <= 0 ||
    stop <= 0 ||
    feeBps < 0 ||
    slippageBps < 0
  )
    throw new Error('Enter valid positive equity, risk, entry and stop values.');
  if ((side === 'long' && stop >= entry) || (side === 'short' && stop <= entry))
    throw new Error(
      side === 'long' ? 'A long stop must be below the entry.' : 'A short stop must be above the entry.',
    );
  const budget = (equity * riskPercent) / 100;
  const distance = Math.abs(entry - stop);
  const costPerUnit = ((entry + stop) * (feeBps + slippageBps)) / 10_000;
  const raw = budget / (distance + costPerUnit);
  const quantity = quantityStep && quantityStep > 0 ? Math.floor(raw / quantityStep) * quantityStep : raw;
  return {
    quantity,
    notional: quantity * entry,
    budget,
    estimatedLoss: quantity * (distance + costPerUnit),
    distance,
    costPerUnit,
  };
}
export interface PriceAlert {
  exchange: string;
  id: string;
  symbol: string;
  category: 'linear' | 'spot';
  direction: 'above' | 'below';
  threshold: number;
  lastPrice: number;
  triggeredAt: number | null;
  createdAt: number;
}
export function evaluateAlert(alert: PriceAlert, current: number, now: number): PriceAlert {
  if (alert.triggeredAt || !Number.isFinite(current) || current <= 0) return alert;
  const crossed =
    alert.direction === 'above'
      ? alert.lastPrice < alert.threshold && current >= alert.threshold
      : alert.lastPrice > alert.threshold && current <= alert.threshold;
  return { ...alert, lastPrice: current, triggeredAt: crossed ? now : null };
}
