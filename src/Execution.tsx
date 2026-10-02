import { useState } from 'react';
import { Plug, RefreshCw, ArrowUpRight } from 'lucide-react';
import { useApi } from './api';
import type { Category, Market } from './types';
import { Empty, Modal, Segmented } from './ui';
import { compact, price, time } from './format';

interface ExecutionStatus {
  configured: boolean;
  enabled: boolean;
  network: string;
  maxNotional: number;
}
interface ExchangeOrder {
  orderId: string;
  orderLinkId: string;
  symbol: string;
  side: string;
  orderType: string;
  qty: string;
  price: string;
  orderStatus: string;
  reduceOnly: boolean;
  triggerPrice: string;
  createdTime: string;
  cumExecQty: string;
}
interface ExchangePosition {
  symbol: string;
  side: string;
  size: string;
  avgPrice: string;
  markPrice: string;
  unrealisedPnl: string;
  liqPrice: string;
  leverage: string;
  positionIdx: number;
}
interface AccountData {
  network: string;
  wallet: { totalEquity: string; totalAvailableBalance: string; totalPerpUPL: string }[];
  orders: ExchangeOrder[];
  positions: ExchangePosition[];
  executions: {
    execId: string;
    symbol: string;
    side: string;
    execPrice: string;
    execQty: string;
    execFee: string;
    execTime: string;
  }[];
  cursors: { orders: string | null; positions: string | null; executions: string | null };
}
interface ExecutionQuote {
  network: string;
  book: { b: string[][]; a: string[][]; ts: number };
  instrument: {
    baseCoin: string;
    priceFilter: { tickSize: string };
    lotSizeFilter: { qtyStep?: string; basePrecision?: string; minOrderQty?: string };
  };
}
type OrderPayload = {
  category: Category;
  symbol: string;
  side: string;
  orderType: string;
  qty: string;
  price?: string;
  timeInForce: string;
  reduceOnly: boolean;
  triggerPrice?: string;
  triggerDirection?: number;
  positionIdx: number;
  orderLinkId: string;
};
async function exchangeAction(path: string, body: unknown) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Tape-Action': 'explicit' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Exchange action failed.');
  return result.data;
}
export function Execution({
  selected,
  toast,
  openSources,
}: {
  selected: string;
  toast: (m: string) => void;
  openSources: () => void;
}) {
  const [category, setCategory] = useState<Category>('linear');
  const inventory = useApi<Market[]>(`/api/markets?exchange=bybit&category=${category}`, 30_000);
  const markets = inventory.result?.data || [];
  const status = useApi<ExecutionStatus>('/api/execution/status', 30_000);
  const config = status.result?.data;
  const account = useApi<AccountData>(
    config?.configured ? `/api/execution/account?category=${category}` : null,
    10_000,
  );
  const [symbol, setSymbol] = useState(selected),
    [side, setSide] = useState('Buy'),
    [type, setType] = useState('Limit');
  const [qty, setQty] = useState(''),
    [limit, setLimit] = useState(''),
    [tif, setTif] = useState('GTC'),
    [reduceOnly, setReduceOnly] = useState(false),
    [trigger, setTrigger] = useState(''),
    [direction, setDirection] = useState(2),
    [positionIdx, setPositionIdx] = useState(0);
  const [review, setReview] = useState<OrderPayload | null>(null),
    [cancel, setCancel] = useState<ExchangeOrder | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const quote = useApi<ExecutionQuote>(
    config?.enabled && /^[A-Z0-9]{2,30}$/.test(symbol)
      ? `/api/execution/quote?category=${category}&symbol=${symbol}`
      : null,
    5000,
  );
  const data = account.result?.data,
    wallet = data?.wallet[0],
    q = quote.result?.data;
  const current = q ? Number(side === 'Buy' ? q.book.a[0]?.[0] : q.book.b[0]?.[0]) : null;
  const notional = Number(qty) * (type === 'Limit' ? Number(limit) : current || 0);
  return (
    <div className="page execution-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">ACCOUNT & EXECUTION</div>
          <h1>Exchange account</h1>
          <p>Orders, positions and fills reconciled directly with Bybit.</p>
        </div>
        <div className="heading-actions">
          <span className={`badge ${config?.network === 'mainnet' ? 'amber' : ''}`}>
            {config?.network === 'mainnet' ? 'MAINNET · REAL FUNDS' : 'TESTNET'}
          </span>
          <button
            className="icon-button"
            aria-label="Refresh exchange account"
            onClick={() => {
              status.refresh();
              account.refresh();
            }}
          >
            <RefreshCw size={17} />
          </button>
        </div>
      </div>
      <div className="filter-toolbar">
        <Segmented
          value={category}
          options={[
            { value: 'linear', label: 'Perpetuals' },
            { value: 'spot', label: 'Spot' },
          ]}
          onChange={setCategory}
          label="Exchange account market type"
        />
        <span className="subtle">Unified Trading Account · 10s reconciliation</span>
      </div>
      {!config?.configured && (
        <section className="panel account-connect">
          <Plug size={28} />
          <div>
            <h2>Connect an exchange account</h2>
            <p>
              Read-only account access is available with a configured API key. Order routing stays disabled
              until you explicitly enable it. Start with testnet.
            </p>
            <button className="button" onClick={openSources}>
              Connection setup <ArrowUpRight size={14} />
            </button>
          </div>
        </section>
      )}
      {status.error && <div className="inline-notice">{status.error}</div>}
      {account.error && (
        <div className="inline-notice">
          Account reconciliation failed. {account.error}{' '}
          {account.result && 'Previously received account data is stale.'}
        </div>
      )}
      <div className="journal-metrics">
        <div>
          <span>
            Exchange equity <small>USD equivalent</small>
          </span>
          <strong className="mono">{wallet?.totalEquity ? price(Number(wallet.totalEquity)) : '—'}</strong>
        </div>
        <div>
          <span>
            Available balance <small>USD equivalent</small>
          </span>
          <strong className="mono">
            {wallet?.totalAvailableBalance ? price(Number(wallet.totalAvailableBalance)) : '—'}
          </strong>
        </div>
        <div>
          <span>Perpetual unrealized PnL</span>
          <strong className="mono">{wallet?.totalPerpUPL ? price(Number(wallet.totalPerpUPL)) : '—'}</strong>
        </div>
        <div>
          <span>Routing status</span>
          <strong className={config?.enabled ? 'amber' : 'subtle'} style={{ fontSize: 18 }}>
            {config?.enabled ? `${config.network} enabled` : 'Disabled'}
          </strong>
        </div>
      </div>
      <div className="execution-grid">
        <div className="execution-tables">
          <section className="panel">
            <div className="panel-toolbar">
              <h3>Exchange positions</h3>
              <span className="subtle">
                {account.result ? `Observed ${time(account.result.asOf, true)}` : 'Awaiting account data'}
              </span>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Market</th>
                    <th>Side</th>
                    <th>Size</th>
                    <th>Entry</th>
                    <th>Mark</th>
                    <th>UPnL</th>
                    <th>Liq. price</th>
                    <th>Leverage</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.positions.map((p) => (
                    <tr key={`${p.symbol}:${p.positionIdx}`}>
                      <td>
                        <b>{p.symbol}</b>
                        <span className="cell-secondary">Position index {p.positionIdx}</span>
                      </td>
                      <td className={p.side === 'Buy' ? 'positive' : 'negative'}>
                        {p.side === 'Buy' ? 'Long' : 'Short'}
                      </td>
                      <td className="mono">{compact(Number(p.size))}</td>
                      <td className="mono">{price(Number(p.avgPrice))}</td>
                      <td className="mono">{price(Number(p.markPrice))}</td>
                      <td className={`mono ${Number(p.unrealisedPnl) >= 0 ? 'positive' : 'negative'}`}>
                        {price(Number(p.unrealisedPnl))}
                      </td>
                      <td className="mono">{p.liqPrice ? price(Number(p.liqPrice)) : '—'}</td>
                      <td className="mono">{p.leverage}×</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data?.positions.length && (
              <Empty
                title={
                  account.loading
                    ? 'Reconciling positions…'
                    : category === 'spot'
                      ? 'Spot holdings are held in your exchange wallet'
                      : 'No reported open positions'
                }
                detail={
                  config?.configured
                    ? 'The account snapshot supplies actual positions; order acknowledgements do not create positions locally.'
                    : 'Connect your exchange account to view positions.'
                }
              />
            )}
            {data?.cursors.positions && (
              <div className="inline-notice">
                Additional positions exist beyond the current page. Inspect the full account on the exchange.
              </div>
            )}
          </section>
          <section className="panel">
            <div className="panel-toolbar">
              <h3>Open orders</h3>
              <span className="subtle">Latest 50 · exchange status</span>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Market</th>
                    <th>Side / type</th>
                    <th>Qty / filled</th>
                    <th>Limit / trigger</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data?.orders.map((o) => (
                    <tr key={o.orderId}>
                      <td>
                        <b>{o.symbol}</b>
                        <span className="cell-secondary" title={o.orderLinkId}>
                          {o.reduceOnly ? 'Reduce only · ' : ''}
                          {o.orderLinkId?.slice(0, 12)}
                        </span>
                      </td>
                      <td>
                        <span className={o.side === 'Buy' ? 'positive' : 'negative'}>{o.side}</span>
                        <span className="cell-secondary">{o.orderType}</span>
                      </td>
                      <td className="mono">
                        {compact(Number(o.qty))}
                        <span className="cell-secondary">{compact(Number(o.cumExecQty))} filled</span>
                      </td>
                      <td className="mono">
                        {o.price && Number(o.price) > 0 ? price(Number(o.price)) : 'Market'}
                        {o.triggerPrice && Number(o.triggerPrice) > 0 && (
                          <span className="cell-secondary">Trigger {price(Number(o.triggerPrice))}</span>
                        )}
                      </td>
                      <td>{o.orderStatus}</td>
                      <td>
                        <button
                          className="text-button negative"
                          disabled={!config?.enabled}
                          onClick={() => {
                            setCancel(o);
                            setError('');
                          }}
                        >
                          Cancel
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data?.orders.length && (
              <Empty
                title="No reported open orders"
                detail={
                  config?.configured
                    ? 'Pending and partially filled orders appear after exchange reconciliation.'
                    : 'Configure account access to view your orders.'
                }
              />
            )}
            {data?.cursors.orders && (
              <div className="inline-notice">
                Additional open orders exist beyond the latest 50. Inspect the full order list on the
                exchange.
              </div>
            )}
          </section>
          <section className="panel">
            <div className="panel-toolbar">
              <h3>Exchange fills</h3>
              <span className="subtle">Latest 50 executions</span>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Market</th>
                    <th>Side</th>
                    <th>Size</th>
                    <th>Fill price</th>
                    <th>Fee</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.executions.map((f) => (
                    <tr key={f.execId}>
                      <td className="mono subtle">{time(Number(f.execTime), true)}</td>
                      <td>{f.symbol}</td>
                      <td className={f.side === 'Buy' ? 'positive' : 'negative'}>{f.side}</td>
                      <td className="mono">{compact(Number(f.execQty))}</td>
                      <td className="mono">{price(Number(f.execPrice))}</td>
                      <td className="mono">{price(Number(f.execFee))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data?.executions.length && <Empty title="No fills in the received account history" />}
          </section>
        </div>
        <section className="panel exchange-ticket">
          <div className="panel-toolbar">
            <h3>Exchange order</h3>
            <span className="badge">{config?.network || 'testnet'}</span>
          </div>
          <div className="ticket-body">
            <label className="field-label">
              USDT market
              <input
                list="execution-markets"
                aria-label="Exchange order symbol"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              />
              <datalist id="execution-markets">
                {markets.map((m) => (
                  <option key={m.symbol} value={m.symbol} />
                ))}
              </datalist>
            </label>
            <div className="ticket-quote">
              <span>Execution-network quote</span>
              <b className="mono">{price(current, Number(q?.instrument.priceFilter.tickSize))}</b>
              <small>
                {q?.network || 'Not connected'} · tick {q?.instrument.priceFilter.tickSize || '—'} · qty step{' '}
                {q?.instrument.lotSizeFilter.qtyStep || q?.instrument.lotSizeFilter.basePrecision || '—'}
              </small>
            </div>
            <Segmented
              value={side}
              options={[
                { value: 'Buy', label: 'Buy' },
                { value: 'Sell', label: 'Sell' },
              ]}
              onChange={setSide}
              label="Exchange order side"
            />
            <div className="ticket-form-grid">
              <label className="field-label">
                Type
                <select value={type} onChange={(e) => setType(e.target.value)}>
                  <option>Limit</option>
                  <option>Market</option>
                </select>
              </label>
              <label className="field-label">
                Quantity <small>{q?.instrument.baseCoin || 'base units'}</small>
                <input
                  type="number"
                  min="0"
                  step="any"
                  aria-label="Exchange order quantity"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                />
              </label>
            </div>
            {type === 'Limit' && (
              <>
                <label className="field-label">
                  Limit price <span>USDT</span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={limit}
                    onChange={(e) => setLimit(e.target.value)}
                    aria-label="Exchange limit price"
                  />
                </label>
                <label className="field-label">
                  Time in force
                  <select value={tif} onChange={(e) => setTif(e.target.value)}>
                    <option>GTC</option>
                    <option>IOC</option>
                    <option>FOK</option>
                    <option>PostOnly</option>
                  </select>
                </label>
              </>
            )}
            {category === 'linear' && (
              <details className="advanced-order">
                <summary>Position & conditional controls</summary>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={reduceOnly}
                    onChange={(e) => setReduceOnly(e.target.checked)}
                  />
                  Reduce only
                </label>
                <label className="field-label">
                  Position mode
                  <select value={positionIdx} onChange={(e) => setPositionIdx(Number(e.target.value))}>
                    <option value="0">One-way (index 0)</option>
                    <option value="1">Hedge long (index 1)</option>
                    <option value="2">Hedge short (index 2)</option>
                  </select>
                </label>
                <label className="field-label">
                  Trigger price · optional
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={trigger}
                    onChange={(e) => setTrigger(e.target.value)}
                    aria-label="Conditional trigger price"
                  />
                </label>
                {trigger && (
                  <label className="field-label">
                    Trigger direction
                    <select value={direction} onChange={(e) => setDirection(Number(e.target.value))}>
                      <option value="2">Price falls to trigger</option>
                      <option value="1">Price rises to trigger</option>
                    </select>
                  </label>
                )}
              </details>
            )}
            <div className="ticket-values">
              <span>Estimated notional</span>
              <b className="mono">{notional > 0 ? compact(notional) : '—'} USDT</b>
              <span>Per-order cap</span>
              <b className="mono">{compact(config?.maxNotional)} USDT</b>
            </div>
            {quote.error && <p className="form-error">{quote.error}</p>}
            <button
              className="button primary"
              style={{ width: '100%' }}
              disabled={!config?.enabled || !q || quote.result?.stale || !qty || (type === 'Limit' && !limit)}
              onClick={() => {
                setError('');
                setReview({
                  category,
                  symbol,
                  side,
                  orderType: type,
                  qty,
                  ...(type === 'Limit' ? { price: limit } : {}),
                  timeInForce: tif,
                  reduceOnly: category === 'linear' && reduceOnly,
                  ...(category === 'linear' && trigger
                    ? { triggerPrice: trigger, triggerDirection: direction }
                    : {}),
                  positionIdx,
                  orderLinkId: 'tp_' + crypto.randomUUID().replaceAll('-', ''),
                });
              }}
            >
              Review {config?.network || 'testnet'} order
            </button>
            <p className="ticket-note">
              Execution quotes use the selected account network. Unconditional market orders carry a 0.50%
              exchange slippage cap. Conditional orders use LastPrice triggers. Existing account leverage and
              margin mode are preserved.
            </p>
          </div>
        </section>
      </div>
      {review && (
        <Modal
          title={`Review ${config?.network} order`}
          close={() => {
            if (!busy) setReview(null);
          }}
        >
          <div className="modal-body">
            <p>
              {config?.network === 'mainnet'
                ? 'This submits an order using real funds on Bybit.'
                : 'This submits an order to Bybit testnet.'}
            </p>
            <dl className="order-review">
              <dt>Market</dt>
              <dd>
                {review.symbol} · {review.category}
              </dd>
              <dt>Order</dt>
              <dd>
                {review.side} {review.qty} · {review.orderType}
              </dd>
              <dt>Price</dt>
              <dd>{review.price || 'Market / exchange IOC'}</dd>
              <dt>Trigger</dt>
              <dd>{review.triggerPrice || 'None'}</dd>
              <dt>Reduce only</dt>
              <dd>{review.reduceOnly ? 'Yes' : 'No'}</dd>
              <dt>Client order ID</dt>
              <dd className="mono">{review.orderLinkId}</dd>
            </dl>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <p className="page-note">
              An acknowledgement is not a fill. Order and position status updates come from exchange
              reconciliation.
            </p>
            <div className="modal-actions">
              <button className="button" disabled={busy} onClick={() => account.refresh()}>
                Reconcile orders
              </button>
              <button
                className="button primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    const result = await exchangeAction('/api/execution/order', review);
                    toast(`Exchange acknowledged order ${result.orderId}. Awaiting reconciliation.`);
                    setReview(null);
                    account.refresh();
                  } catch (e) {
                    setError(
                      e instanceof Error
                        ? e.message
                        : 'Submission status unknown. Reconcile orders before retrying.',
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy
                  ? 'Submitting…'
                  : error
                    ? 'Retry same client order ID'
                    : `Submit ${config?.network} order`}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {cancel && (
        <Modal
          title="Cancel exchange order"
          close={() => {
            if (!busy) setCancel(null);
          }}
        >
          <div className="modal-body">
            <p>
              Cancel {cancel.side.toLowerCase()} {cancel.qty} {cancel.symbol} ({cancel.orderType}) on{' '}
              {config?.network}?
            </p>
            <p className="page-note mono">Order {cancel.orderId}</p>
            {error && <p className="form-error">{error}</p>}
            <div className="modal-actions">
              <button className="button" disabled={busy} onClick={() => setCancel(null)}>
                Keep order
              </button>
              <button
                className="button danger"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    await exchangeAction('/api/execution/cancel', {
                      category,
                      symbol: cancel.symbol,
                      orderId: cancel.orderId,
                    });
                    toast('Cancellation acknowledged; reconciling exchange status.');
                    setCancel(null);
                    account.refresh();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Cancellation status unknown.');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Cancel order
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
