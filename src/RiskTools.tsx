import { useState } from 'react';
import { ArrowUpRight, Trash2 } from 'lucide-react';
import { sizeByRisk, type PriceAlert } from '../shared/risk';
import { account, type PaperState } from '../shared/paper';
import type { Market, Category } from './types';
import { compact, price, time } from './format';
import { venueName } from '../shared/venues.mjs';
import { Segmented, Modal, Empty } from './ui';

export function RiskSizer({
  market,
  paper,
  useNotional,
}: {
  market: Market;
  paper: PaperState;
  useNotional: (n: number) => void;
}) {
  const [equity, setEquity] = useState(market.quote === 'USDT' ? String(account(paper).equity) : ''),
    [risk, setRisk] = useState('0.5'),
    [side, setSide] = useState<'long' | 'short'>('long');
  const [entry, setEntry] = useState(
      market.price.toFixed(Math.min(16, market.tick ? Math.max(0, -Math.floor(Math.log10(market.tick))) : 8)),
    ),
    [stop, setStop] = useState(''),
    [fee, setFee] = useState('6'),
    [slippage, setSlippage] = useState('5');
  let result = null,
    error = '';
  try {
    result = sizeByRisk({
      equity: Number(equity),
      riskPercent: Number(risk),
      entry: Number(entry),
      stop: Number(stop),
      side,
      feeBps: Number(fee),
      slippageBps: Number(slippage),
      quantityStep: market.qtyStep,
    });
  } catch (e) {
    if (stop) error = e instanceof Error ? e.message : 'Invalid sizing inputs.';
  }
  return (
    <>
      <div className="analysis-heading">
        <div>
          <h3>Position size by loss budget</h3>
          <span>Entry, stop distance, fees and slippage · {market.base} base units</span>
        </div>
        <Segmented
          value={side}
          options={[
            { value: 'long', label: 'Long' },
            { value: 'short', label: 'Short' },
          ]}
          onChange={setSide}
          label="Position sizing direction"
        />
      </div>
      <div className="risk-sizer">
        <div className="risk-fields">
          {[
            [`Account equity · ${market.quote}`, equity, setEquity],
            ['Risk budget · %', risk, setRisk],
            [`Entry price · ${market.quote}`, entry, setEntry],
            [`Stop price · ${market.quote}`, stop, setStop],
            ['Fee per fill · bps', fee, setFee],
            ['Slippage per fill · bps', slippage, setSlippage],
          ].map(([label, value, setter]) => (
            <label className="field-label" key={String(label)}>
              {label as string}
              <input
                type="number"
                min="0"
                step="any"
                value={value as string}
                onChange={(e) => (setter as (s: string) => void)(e.target.value)}
              />
            </label>
          ))}
        </div>
        <div className="risk-results">
          <span>Suggested quantity</span>
          <strong className="mono">
            {result ? price(result.quantity, market.qtyStep) : '—'} <small>{market.base}</small>
          </strong>
          <div>
            <span>Notional</span>
            <b className="mono">
              {compact(result?.notional)} {market.quote}
            </b>
          </div>
          <div>
            <span>Estimated stop loss</span>
            <b className="mono">
              {result ? price(result.estimatedLoss) : '—'} {market.quote}
            </b>
          </div>
          <div>
            <span>Loss budget</span>
            <b className="mono">
              {result ? price(result.budget) : '—'} {market.quote}
            </b>
          </div>
          <button
            className="button"
            disabled={!result || result.quantity <= 0 || market.quote !== 'USDT'}
            onClick={() => result && useNotional(result.notional)}
          >
            Use in paper ticket <ArrowUpRight size={13} />
          </button>
        </div>
      </div>
      {error && <p className="form-error risk-error">{error}</p>}
      <div className="panel-footnote">
        Sizing rounds down to the exchange quantity step. Estimated stop loss includes fees and slippage on
        both fills. Gaps, funding and market impact can increase losses.
      </div>
    </>
  );
}

export function AlertsDialog({
  alerts,
  setAlerts,
  markets,
  selected,
  category,
  close,
}: {
  alerts: PriceAlert[];
  setAlerts: (a: PriceAlert[]) => void;
  markets: Market[];
  selected: string;
  category: Category;
  close: () => void;
}) {
  const [symbol, setSymbol] = useState(selected),
    [direction, setDirection] = useState<'above' | 'below'>('above'),
    [threshold, setThreshold] = useState('');
  const market = markets.find((m) => m.symbol === symbol);
  return (
    <Modal title="Price alerts" close={close} wide>
      <div className="modal-body">
        <p>
          Crossing alerts are checked against fresh 15s market quotes while this workspace is open. Each alert
          triggers once.
        </p>
        <div className="alert-form">
          <label className="field-label">
            Market
            <select value={symbol} onChange={(e) => setSymbol(e.target.value)}>
              {markets.map((m) => (
                <option key={m.symbol}>{m.symbol}</option>
              ))}
            </select>
          </label>
          <label className="field-label">
            Crosses
            <select value={direction} onChange={(e) => setDirection(e.target.value as 'above' | 'below')}>
              <option value="above">Above</option>
              <option value="below">Below</option>
            </select>
          </label>
          <label className="field-label">
            Price · USDT
            <input
              type="number"
              step="any"
              min="0"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
            />
          </label>
          <button
            className="button primary"
            disabled={
              !market || !Number.isFinite(Number(threshold)) || Number(threshold) <= 0 || alerts.length >= 100
            }
            onClick={() => {
              if (market) {
                setAlerts([
                  ...alerts,
                  {
                    exchange: market.exchange,
                    id: crypto.randomUUID(),
                    symbol,
                    category,
                    direction,
                    threshold: Number(threshold),
                    lastPrice: market.price,
                    triggeredAt: null,
                    createdAt: Date.now(),
                  },
                ]);
                setThreshold('');
              }
            }}
          >
            Add alert
          </button>
        </div>
        {market && (
          <div className="alert-current subtle">
            Current quote {price(market.price, market.tick)} USDT ·{' '}
            {category === 'linear' ? 'perpetual' : 'spot'}
          </div>
        )}
        <div className="alert-list">
          {alerts.map((a) => (
            <div key={a.id}>
              <span>
                <b>{a.symbol}</b>
                <small>
                  {venueName(a.exchange)} · {a.category} · crosses {a.direction} {price(a.threshold)}
                </small>
              </span>
              <span className={a.triggeredAt ? 'amber' : 'subtle'}>
                {a.triggeredAt ? `Triggered ${time(a.triggeredAt, true)}` : 'Armed'}
              </span>
              <button
                className="icon-button"
                aria-label={`Delete alert for ${a.symbol}`}
                onClick={() => setAlerts(alerts.filter((x) => x.id !== a.id))}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {!alerts.length && (
            <Empty
              title="No price alerts yet"
              detail="Choose an exchange market and the price you want to watch."
            />
          )}
        </div>
        <p className="page-note">
          Alerts evaluate all armed exchange markets while this workspace is open, regardless of the selected
          desk. They pause when this browser is closed or provider data is stale. Notification delivery is in
          this workspace.
        </p>
      </div>
    </Modal>
  );
}
