import { useEffect, useState } from 'react';
import { X, ArrowUpRight, Download, RotateCcw } from 'lucide-react';
import { executePaper, initialPaper, account, paperFillPrice, type PaperState } from '../shared/paper';
import type { FlowSnapshot } from '../shared/flow';
import type { Market, Category, Exchange } from './types';
import { venueName } from '../shared/venues.mjs';
import { price, compact, time } from './format';
import { Modal, Empty, Segmented } from './ui';

export function PaperTicket({
  market,
  flow,
  status,
  paper,
  setPaper,
  toast,
  close,
  initialNotional,
}: {
  market: Market;
  flow: FlowSnapshot;
  status: string;
  paper: PaperState;
  setPaper: (p: PaperState) => void;
  toast: (m: string) => void;
  close: () => void;
  initialNotional?: number | null;
}) {
  const [side, setSide] = useState<'Buy' | 'Sell'>('Buy');
  const [notional, setNotional] = useState('1000');
  useEffect(() => {
    if (initialNotional != null) setNotional(initialNotional.toFixed(4));
  }, [initialNotional]);
  const [error, setError] = useState('');
  const levels = side === 'Buy' ? flow.asks : flow.bids;
  const best = levels[0]?.price;
  const rawQty = Number(notional) / best;
  const quantity = market.qtyStep
    ? Math.floor((rawQty + market.qtyStep * 1e-8) / market.qtyStep) * market.qtyStep
    : rawQty;
  let estimate = null;
  try {
    estimate = paperFillPrice(levels, quantity);
  } catch {
    /* Display unavailable; execution will explain the constraint. */
  }
  const position = paper.positions[`${market.exchange}:${market.category}:${market.symbol}`];
  return (
    <section className="panel paper-ticket">
      <div className="panel-toolbar">
        <h3>
          Paper order <span className="badge">SIMULATED</span>
        </h3>
        <button className="icon-button" aria-label="Close paper order" onClick={close}>
          <X size={14} />
        </button>
      </div>
      <div className="ticket-body">
        <Segmented
          value={side}
          options={[
            { value: 'Buy', label: market.category === 'linear' ? 'Buy / long' : 'Buy' },
            { value: 'Sell', label: market.category === 'linear' ? 'Sell / short' : 'Sell' },
          ]}
          onChange={(v) => {
            setSide(v);
            setError('');
          }}
          label="Paper order side"
        />
        <label className="field-label">
          Order notional <span>USDT</span>
          <input
            type="number"
            min="0"
            step="any"
            value={notional}
            onChange={(e) => setNotional(e.target.value)}
          />
        </label>
        <div className="ticket-values">
          <span>Quantity</span>
          <b className="mono">
            {Number.isFinite(quantity) ? price(quantity, market.qtyStep) : '—'} {market.base}
          </b>
          <span>Estimated fill</span>
          <b className="mono">{price(estimate, market.tick)}</b>
          <span>Fee · 6 bps</span>
          <b className="mono">{estimate ? price(estimate * quantity * 0.0006) : '—'} USDT</b>
          {position && (
            <>
              <span>Position</span>
              <b className="mono">
                {compact(position.quantity)} {market.base}
              </b>
            </>
          )}
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button
          className={`button execute-paper ${side === 'Buy' ? 'buy' : 'sell'}`}
          disabled={status !== 'live'}
          onClick={() => {
            try {
              const next = executePaper(paper, {
                exchange: market.exchange,
                symbol: market.symbol,
                category: market.category,
                side,
                quantity,
                bid: flow.bids[0]?.price,
                ask: flow.asks[0]?.price,
                quoteTime: flow.bookTime,
                bids: flow.bids,
                asks: flow.asks,
              });
              setPaper(next);
              setError('');
              toast(
                `Paper ${side.toLowerCase()} filled · ${market.symbol} · ${price(next.fills[0].price, market.tick)}`,
              );
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Paper order could not be filled.');
            }
          }}
        >
          Execute paper {side.toLowerCase()}
        </button>
        <p className="ticket-note">
          Simulated fills walk the visible book. 1× exposure cap; 6 bps fee. Funding and latency are excluded.
        </p>
      </div>
    </section>
  );
}

export function Journal({
  paper,
  setPaper,
  select,
  toast,
}: {
  paper: PaperState;
  setPaper: (p: PaperState) => void;
  select: (symbol: string, category: Category, exchange?: Exchange) => void;
  toast: (m: string) => void;
}) {
  const [reset, setReset] = useState(false);
  const totals = account(paper);
  const exportCsv = () => {
    const rows = [
      [
        'time',
        'exchange',
        'market',
        'category',
        'side',
        'quantity',
        'price_USDT',
        'fee_USDT',
        'realized_PnL_USDT',
      ],
      ...paper.fills.map((f) => [
        new Date(f.time).toISOString(),
        f.exchange,
        f.symbol,
        f.category,
        f.side,
        f.quantity,
        f.price,
        f.fee,
        f.realized,
      ]),
    ];
    const blob = new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob),
      anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'tape-paper-journal.csv';
    anchor.click();
    URL.revokeObjectURL(url);
    toast('Paper journal exported.');
  };
  return (
    <div className="page journal-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">SIMULATION</div>
          <h1>Paper journal</h1>
          <p>A local trading record. Start with 100,000 USDT and test your process.</p>
        </div>
        <div className="heading-actions">
          <button className="button" disabled={!paper.fills.length} onClick={exportCsv}>
            <Download size={14} />
            Export CSV
          </button>
          <button
            className="icon-button"
            aria-label="Reset paper account"
            title="Reset paper account"
            onClick={() => setReset(true)}
          >
            <RotateCcw size={17} />
          </button>
        </div>
      </div>
      <div className="journal-metrics">
        <div>
          <span>
            Equity <small>USDT</small>
          </span>
          <strong className="mono">{price(totals.equity)}</strong>
        </div>
        <div>
          <span>
            Unrealized PnL <small>USDT</small>
          </span>
          <strong className={`mono ${totals.unrealized >= 0 ? 'positive' : 'negative'}`}>
            {totals.unrealized > 0 ? '+' : ''}
            {price(totals.unrealized)}
          </strong>
        </div>
        <div>
          <span>
            Gross exposure <small>USDT</small>
          </span>
          <strong className="mono">{compact(totals.exposure)}</strong>
        </div>
        <div>
          <span>
            Fees in recorded fills <small>USDT</small>
          </span>
          <strong className="mono">{price(paper.fills.reduce((s, f) => s + f.fee, 0))}</strong>
        </div>
      </div>
      <section className="panel">
        <div className="panel-toolbar">
          <h3>Open positions</h3>
          <span className="subtle">Marks refresh with market quotes</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Market</th>
                <th>Quantity</th>
                <th>Entry</th>
                <th>Last mark</th>
                <th>Unrealized PnL</th>
                <th>Mark age</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {Object.values(paper.positions).map((p) => (
                <tr key={`${p.exchange}:${p.category}:${p.symbol}`}>
                  <td>
                    <b>{p.symbol}</b>
                    <span className="cell-secondary">
                      {venueName(p.exchange)} ·{' '}
                      {p.category === 'linear' ? (p.quantity > 0 ? 'Perp · long' : 'Perp · short') : 'Spot'}
                    </span>
                  </td>
                  <td className="mono">{compact(p.quantity)}</td>
                  <td className="mono">{price(p.average)}</td>
                  <td className="mono">{price(p.mark)}</td>
                  <td className={`mono ${(p.mark - p.average) * p.quantity >= 0 ? 'positive' : 'negative'}`}>
                    {price((p.mark - p.average) * p.quantity)}
                  </td>
                  <td className="subtle mono">{Math.floor((Date.now() - p.updatedAt) / 1000)}s</td>
                  <td>
                    <button
                      className="text-button"
                      onClick={() => select(p.symbol, p.category, p.exchange as Exchange)}
                    >
                      Manage <ArrowUpRight size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!Object.keys(paper.positions).length && (
          <Empty
            title="Your desk is clear"
            detail="Open a market and choose Paper trade to place a simulated order."
          />
        )}
      </section>
      <section className="panel fills-panel">
        <div className="panel-toolbar">
          <h3>Execution journal</h3>
          <span className="subtle">Latest {paper.fills.length} fills · retained locally</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Market</th>
                <th>Side</th>
                <th>Quantity</th>
                <th>Fill price</th>
                <th>Fee</th>
                <th>Realized PnL</th>
              </tr>
            </thead>
            <tbody>
              {paper.fills.map((f) => (
                <tr key={f.id}>
                  <td className="mono subtle" title={new Date(f.time).toLocaleString()}>
                    {time(f.time, true)}
                  </td>
                  <td>
                    <button
                      className="text-button"
                      onClick={() => select(f.symbol, f.category as Category, f.exchange as Exchange)}
                    >
                      {f.symbol}
                    </button>
                  </td>
                  <td className={f.side === 'Buy' ? 'positive' : 'negative'}>{f.side}</td>
                  <td className="mono">{compact(f.quantity)}</td>
                  <td className="mono">{price(f.price)}</td>
                  <td className="mono">{price(f.fee)}</td>
                  <td className={`mono ${f.realized >= 0 ? 'positive' : 'negative'}`}>{price(f.realized)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!paper.fills.length && (
          <Empty title="No executions yet" detail="Your fills, fees and realized PnL will appear here." />
        )}
      </section>
      <p className="page-note">
        Paper mode uses public order-book quotes and visible-depth slippage. It excludes funding, market
        impact, network latency and liquidation mechanics. Marks for inactive markets are the last observed
        quotes. The journal is stored in this browser; the latest 200 fills are retained.
      </p>
      {reset && (
        <Modal title="Reset paper account" close={() => setReset(false)}>
          <div className="modal-body">
            <p>This clears your local positions and journal and restores 100,000 USDT.</p>
            <div className="modal-actions">
              <button className="button" onClick={() => setReset(false)}>
                Keep journal
              </button>
              <button
                className="button danger"
                onClick={() => {
                  setPaper(initialPaper());
                  setReset(false);
                  toast('Paper account reset.');
                }}
              >
                Reset account
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
