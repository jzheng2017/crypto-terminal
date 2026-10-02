import { useMemo, useState } from 'react';
import { ArrowUpRight, Star, Info, Wallet } from 'lucide-react';
import type { Category, Market, Candle } from './types';
import { useApi } from './api';
import { useFeed } from './useFeed';
import { aggregateLevels, type FlowSnapshot, type Trade } from '../shared/flow';
import { PriceChart, LineChart, Heatmap, type CoinGlassHeat } from './Charts';
import { compact, price, percent, time } from './format';
import { Empty, Segmented } from './ui';
import { PaperTicket } from './Journal';
import type { PaperState } from '../shared/paper';
import { venueName, venueWebsite } from '../shared/venues.mjs';
import { HistoricalFlow } from './HistoricalFlow';
import { RiskSizer } from './RiskTools';

type Analysis = 'flow' | 'liquidity' | 'profile' | 'derivatives' | 'coinglass' | 'risk' | 'venues';
export function Desk({
  market,
  star,
  toggleStar,
  paper,
  setPaper,
  toast,
  openSources,
}: {
  market: Market;
  star: boolean;
  toggleStar: () => void;
  paper: PaperState;
  setPaper: (p: PaperState) => void;
  toast: (message: string) => void;
  openSources: () => void;
}) {
  const [interval, setInterval] = useState('15');
  const [analysis, setAnalysis] = useState<Analysis>('flow');
  const [ticket, setTicket] = useState(false);
  const [tradeFloor, setTradeFloor] = useState('0');
  const [riskNotional, setRiskNotional] = useState<number | null>(null);
  const feed = useFeed(market.exchange, market.symbol, market.category, interval, market.price, market.tick);
  const candles = useApi<Candle[]>(
    `/api/candles?exchange=${market.exchange}&category=${market.category}&symbol=${market.symbol}&interval=${interval}`,
    30_000,
  );
  const recent = useApi<{ trades: Trade[] }>(
    `/api/snapshot?exchange=${market.exchange}&category=${market.category}&symbol=${market.symbol}`,
  );
  const ticker = feed.ticker;
  const last = ticker.lastPrice == null ? market.price : Number(ticker.lastPrice);
  const change = ticker.price24hPcnt == null ? market.change : Number(ticker.price24hPcnt) * 100;
  const funding = ticker.fundingRate == null ? market.funding : Number(ticker.fundingRate) * 100;
  const oi = ticker.openInterestValue == null ? market.oi : Number(ticker.openInterestValue);
  const trades = feed.flow.trades.length ? feed.flow.trades : recent.result?.data.trades || [];
  return (
    <>
      <div className="desk-heading">
        <div className="instrument-title">
          <button
            className={`icon-button ${star ? 'starred' : ''}`}
            aria-label={star ? 'Remove from watchlist' : 'Add to watchlist'}
            onClick={toggleStar}
          >
            <Star size={19} fill={star ? 'currentColor' : 'none'} />
          </button>
          <div>
            <h1>
              {market.base}
              <span> / {market.quote}</span>
            </h1>
            <div className="instrument-meta">
              {venueName(market.exchange)} <span className="dot-separator">·</span>{' '}
              {market.category === 'linear' ? 'Perpetual' : 'Spot'}{' '}
              <span className={`feed-label ${feed.status}`}>
                <i />
                {feed.status}
              </span>
            </div>
          </div>
        </div>
        <div className="instrument-price mono">
          <strong>{price(last, market.tick)}</strong>
          <span className={change >= 0 ? 'positive' : 'negative'}>
            {percent(change)} <small>24h</small>
          </span>
        </div>
        <div className="instrument-stat">
          <span>
            24h turnover <small>{market.quote}</small>
          </span>
          <b className="mono">
            {market.volumeEstimate ? '~' : ''}
            {compact(ticker.turnover24h == null ? market.volume : Number(ticker.turnover24h))}
          </b>
        </div>
        {market.category === 'linear' && (
          <>
            <div className="instrument-stat">
              <span>
                Funding <small>/{ticker.fundingHours || market.fundingHours || '?'}h</small>
              </span>
              <b className={`mono ${(funding || 0) >= 0 ? 'positive' : 'negative'}`}>{percent(funding, 4)}</b>
            </div>
            <div className="instrument-stat">
              <span>
                Open interest <small>USDT</small>
              </span>
              <b className="mono">{compact(oi)}</b>
            </div>
          </>
        )}
        <button
          className={`button paper-toggle ${ticket ? 'active' : ''}`}
          disabled={market.quote !== 'USDT'}
          title={
            market.quote !== 'USDT'
              ? 'The paper account is denominated in USDT. Select a USDT market.'
              : 'Trade against the public book in simulation'
          }
          onClick={() => setTicket((t) => !t)}
        >
          <Wallet size={15} />
          Paper trade
        </button>
      </div>
      {feed.message && <div className="inline-notice">{feed.message}</div>}
      <div className="desk-grid">
        <div className="chart-column">
          <section className="panel main-chart-panel">
            <div className="panel-toolbar">
              <div className="toolbar-title">
                Price <span className="subtle">/ {market.symbol}</span>
              </div>
              <div className="timeframes" role="group" aria-label="Chart timeframe">
                {[
                  ['1', '1m'],
                  ['5', '5m'],
                  ['15', '15m'],
                  ['60', '1h'],
                  ['240', '4h'],
                  ['D', '1D'],
                ].map(([v, l]) => (
                  <button
                    key={v}
                    aria-pressed={interval === v}
                    className={interval === v ? 'selected' : ''}
                    onClick={() => setInterval(v)}
                  >
                    {l}
                  </button>
                ))}
              </div>
              <a
                className="icon-button"
                href={venueWebsite(market.exchange)}
                target="_blank"
                rel="noreferrer"
                aria-label={`Open ${venueName(market.exchange)}`}
              >
                <ArrowUpRight size={16} />
              </a>
            </div>
            {candles.result?.data.length ? (
              <PriceChart
                key={`${market.symbol}:${interval}:${market.category}`}
                candles={candles.result.data}
                live={feed.candle}
                tick={market.tick}
                label={market.symbol}
              />
            ) : (
              <Empty
                title={candles.loading ? 'Loading market history…' : 'Chart unavailable'}
                detail={
                  candles.loading ? undefined : candles.error || 'No candles are available for this market.'
                }
                retry={candles.loading ? undefined : candles.refresh}
              />
            )}
            {(candles.error || candles.result?.stale) && candles.result && (
              <div className="inline-notice">Candle history is stale. {candles.error}</div>
            )}
          </section>
          <section className="panel analysis-panel">
            <div className="analysis-tabs" role="group" aria-label="Market analytics">
              {(
                [
                  ['flow', 'Order flow'],
                  ['liquidity', 'Liquidity heatmap'],
                  ['profile', 'Volume profile'],
                  ['risk', 'Risk size'],
                  ...(market.category === 'linear'
                    ? [
                        ['derivatives', 'Derivatives'],
                        ['venues', 'Venue comparison'],
                        ['coinglass', 'CoinGlass'],
                      ]
                    : []),
                ] as [Analysis, string][]
              ).map(([v, l]) => (
                <button
                  key={v}
                  aria-pressed={analysis === v}
                  className={analysis === v ? 'selected' : ''}
                  onClick={() => setAnalysis(v)}
                >
                  {l}
                </button>
              ))}
            </div>
            {analysis === 'flow' && (
              <HistoricalFlow
                market={market}
                session={
                  <FlowPanel
                    flow={feed.flow}
                    category={market.category}
                    quote={market.quote}
                    exchange={market.exchange}
                  />
                }
              />
            )}
            {analysis === 'liquidity' && (
              <>
                <div className="analysis-heading">
                  <div>
                    <h3>Resting liquidity</h3>
                    <span>Observed L2 book · latest 3 minutes · 50 levels per side</span>
                  </div>
                  <span className="heat-legend">
                    <i />
                    Bid <i />
                    Ask <i />
                    Mid
                  </span>
                </div>
                <Heatmap samples={feed.flow.heat} />
                <div className="panel-footnote">
                  Bands show visible limit orders, which can be cancelled. This is observed book depth.
                </div>
              </>
            )}
            {analysis === 'profile' && <VolumeProfile flow={feed.flow} />}
            {analysis === 'risk' && (
              <RiskSizer
                market={market}
                paper={paper}
                useNotional={(n) => {
                  setRiskNotional(n);
                  setTicket(true);
                }}
              />
            )}
            {analysis === 'venues' && (
              <VenueComparison symbol={market.quote === 'USDT' ? market.symbol : `${market.base}USDT`} />
            )}
            {analysis === 'derivatives' && (
              <Derivatives exchange={market.exchange} symbol={market.symbol} flow={feed.flow} />
            )}
            {analysis === 'coinglass' && (
              <CoinGlassPanel exchange={market.exchange} symbol={market.symbol} openSources={openSources} />
            )}
            <div className="analysis-footer">
              <Info size={12} />
              <span>
                Live: {venueName(market.exchange)} {market.category === 'linear' ? 'perpetual' : 'spot'} ·
                quote units {market.quote} · session from {time(feed.flow.startedAt, true)} · resets after
                reconnect
              </span>
            </div>
          </section>
        </div>
        <aside className="book-column">
          {ticket && (
            <PaperTicket
              market={market}
              flow={feed.flow}
              status={feed.status}
              paper={paper}
              setPaper={setPaper}
              initialNotional={riskNotional}
              toast={toast}
              close={() => setTicket(false)}
            />
          )}
          <OrderBook flow={feed.flow} market={market} status={feed.status} />
          <section className="panel tape-panel">
            <div className="panel-toolbar">
              <h3>Time & sales</h3>
              <select
                aria-label="Minimum trade notional"
                value={tradeFloor}
                onChange={(e) => setTradeFloor(e.target.value)}
              >
                <option value="0">All prints</option>
                <option value="1000">≥ 1K {market.quote}</option>
                <option value="10000">≥ 10K {market.quote}</option>
                <option value="100000">≥ 100K {market.quote}</option>
              </select>
            </div>
            <div className="book-table-head">
              <span>Price</span>
              <span>{market.quote}</span>
              <span>Time</span>
            </div>
            <div className="tape-rows">
              {trades
                .filter((t) => t.price * t.size >= Number(tradeFloor))
                .slice(0, 30)
                .map((t) => (
                  <div className="tape-row mono" key={t.id}>
                    <span className={t.side === 'Buy' ? 'positive' : 'negative'}>
                      {price(t.price, market.tick)}
                    </span>
                    <span>{compact(t.price * t.size)}</span>
                    <span className="subtle">{time(t.time, true)}</span>
                  </div>
                ))}
              {!trades.filter((t) => t.price * t.size >= Number(tradeFloor)).length && (
                <Empty title="No matching prints yet" detail="Trades appear as they execute." />
              )}
            </div>
          </section>
        </aside>
      </div>
      <div className="desk-bottom">
        <span>
          <i className={`status-dot ${feed.status === 'live' ? 'connected' : ''}`} />
          {feed.status === 'live' ? 'Market stream connected' : `Market stream ${feed.status}`}
        </span>
        <span>
          Public market data <span className="dot-separator">·</span> Paper execution only
        </span>
        <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">
          Charts by TradingView
        </a>
      </div>
    </>
  );
}

function FlowPanel({
  flow,
  category,
  quote,
  exchange,
}: {
  flow: FlowSnapshot;
  category: Category;
  quote: string;
  exchange: string;
}) {
  const total = flow.buy + flow.sell,
    buyShare = total ? (flow.buy / total) * 100 : null;
  return (
    <>
      <div className="flow-metrics">
        <div>
          <span>
            Session CVD <small>{quote}</small>
          </span>
          <strong className={`mono ${flow.cvd >= 0 ? 'positive' : 'negative'}`}>
            {flow.cvd > 0 ? '+' : ''}
            {compact(flow.cvd)}
          </strong>
        </div>
        <div>
          <span>Taker buys</span>
          <strong className="mono positive">{compact(flow.buy)}</strong>
        </div>
        <div>
          <span>Taker sells</span>
          <strong className="mono negative">{compact(flow.sell)}</strong>
        </div>
        <div className="taker-balance">
          <span>Buy / sell pressure</span>
          <div className="balance-bar">
            <i style={{ width: `${buyShare ?? 50}%` }} />
          </div>
          <span className="mono">
            {buyShare === null
              ? 'Waiting for trades'
              : `${buyShare.toFixed(1)}% / ${(100 - buyShare).toFixed(1)}%`}
          </span>
        </div>
      </div>
      <div className="cvd-chart">
        {flow.points.length ? (
          <LineChart
            key={flow.startedAt}
            points={flow.points}
            color={flow.cvd >= 0 ? '#65b99c' : '#d57c83'}
            height={150}
          />
        ) : (
          <Empty
            title="Collecting taker flow"
            detail="CVD starts at zero and accumulates executed buys minus sells. Historical candles do not supply trade delta."
          />
        )}
      </div>
      {category === 'linear' && ['bybit', 'binance'].includes(exchange) && (
        <div className="liquidation-summary">
          <span>Observed liquidations{exchange === 'binance' ? ' · sampled feed' : ''}</span>
          <span className="mono">
            Long <b className="negative">{compact(flow.longLiquidated)} USDT</b>
          </span>
          <span className="mono">
            Short <b className="positive">{compact(flow.shortLiquidated)} USDT</b>
          </span>
        </div>
      )}
    </>
  );
}
function OrderBook({ flow, market, status }: { flow: FlowSnapshot; market: Market; status: string }) {
  const [multiple, setMultiple] = useState(1);
  const step = (market.tick || market.price * 0.000001) * multiple;
  const bids = useMemo(() => aggregateLevels(flow.bids, step, 'bid').slice(0, 10), [flow.bids, step]);
  const asks = useMemo(() => aggregateLevels(flow.asks, step, 'ask').slice(0, 10), [flow.asks, step]);
  const bidValue = bids.reduce((a, l) => a + l.price * l.size, 0),
    askValue = asks.reduce((a, l) => a + l.price * l.size, 0);
  const share = bidValue + askValue > 0 ? (bidValue / (bidValue + askValue)) * 100 : 50;
  const max = Math.max(bidValue, askValue, 1);
  const rows = (levels: typeof bids, side: 'bid' | 'ask') => {
    let cumulative = 0;
    const list = levels.map((l) => {
      cumulative += l.price * l.size;
      return { ...l, cumulative };
    });
    if (side === 'ask') list.reverse();
    return list.map((l) => (
      <div className={`book-row mono ${side}`} key={l.price}>
        <i style={{ width: `${(l.cumulative / max) * 100}%` }} />
        <span className={side === 'bid' ? 'positive' : 'negative'}>{price(l.price, market.tick)}</span>
        <span>{compact(l.size)}</span>
        <span>{compact(l.cumulative)}</span>
      </div>
    ));
  };
  const bestBid = flow.bids[0]?.price,
    bestAsk = flow.asks[0]?.price;
  const spread = bestBid && bestAsk ? bestAsk - bestBid : null;
  return (
    <section className={`panel orderbook ${status === 'live' ? '' : 'inactive-feed'}`}>
      <div className="panel-toolbar">
        <h3>Order book</h3>
        <select
          aria-label="Order book price grouping"
          value={multiple}
          onChange={(e) => setMultiple(Number(e.target.value))}
        >
          {[1, 5, 10, 50].map((n) => (
            <option key={n} value={n}>
              {price((market.tick || 0.00001) * n, market.tick)}
            </option>
          ))}
        </select>
      </div>
      <div className="book-table-head">
        <span>
          Price <small>{market.quote}</small>
        </span>
        <span>
          Size <small>{market.base}</small>
        </span>
        <span>
          Total <small>{market.quote}</small>
        </span>
      </div>
      {asks.length ? (
        <div className="book-side">{rows(asks, 'ask')}</div>
      ) : (
        <Empty
          title="Waiting for book snapshot"
          detail={
            status === 'live'
              ? 'The exchange has not sent an order-book snapshot yet.'
              : 'Connecting to the exchange…'
          }
        />
      )}
      <div className="book-mid">
        <b className="mono">{bestBid && bestAsk ? price((bestBid + bestAsk) / 2, market.tick) : '—'}</b>
        <span>
          Spread{' '}
          <b className="mono">
            {spread == null
              ? '—'
              : `${price(spread, market.tick)} · ${((spread / bestBid) * 10_000).toFixed(2)} bps`}
          </b>
        </span>
      </div>
      <div className="book-side">{rows(bids, 'bid')}</div>
      <div className="book-balance">
        <div className="balance-bar">
          <i style={{ width: `${share}%` }} />
        </div>
        <div>
          <span className="positive mono">Bid {bidValue + askValue > 0 ? share.toFixed(1) + '%' : '—'}</span>
          <span className="subtle">Displayed depth</span>
          <span className="negative mono">
            Ask {bidValue + askValue > 0 ? (100 - share).toFixed(1) + '%' : '—'}
          </span>
        </div>
      </div>
    </section>
  );
}
function VolumeProfile({ flow }: { flow: FlowSnapshot }) {
  const bins = [...flow.bins]
    .sort((a, b) => b.buy + b.sell - (a.buy + a.sell))
    .slice(0, 18)
    .sort((a, b) => b.price - a.price);
  const max = Math.max(...bins.map((b) => b.buy + b.sell), 1);
  return (
    <>
      <div className="analysis-heading">
        <div>
          <h3>Session volume at price</h3>
          <span>Executed notional · largest 18 price bins · {flow.bins.length} bins collected</span>
        </div>
        <span className="subtle">Buy / sell · USDT</span>
      </div>
      {bins.length ? (
        <div className="volume-profile">
          {bins.map((b) => (
            <div className="profile-row mono" key={b.price}>
              <span>{price(b.price)}</span>
              <div className="profile-bars">
                <i style={{ width: `${(b.sell / max) * 100}%` }} />
                <i style={{ width: `${(b.buy / max) * 100}%` }} />
              </div>
              <span className="negative">{compact(b.sell)}</span>
              <span className="positive">{compact(b.buy)}</span>
              <span className={b.buy >= b.sell ? 'positive' : 'negative'}>{compact(b.buy - b.sell)}</span>
            </div>
          ))}
        </div>
      ) : (
        <Empty
          title="Waiting for executed trades"
          detail="Volume is assigned to price bins from this session’s taker trades."
        />
      )}
      <div className="panel-footnote">
        Sell and buy notional by execution price; the last column is delta.
      </div>
    </>
  );
}
function Derivatives({ symbol, flow, exchange }: { symbol: string; flow: FlowSnapshot; exchange: string }) {
  const history = useApi<{
    oi: { time: number; value: number }[];
    funding: { time: number; value: number }[];
    warnings: string[];
  }>(`/api/derivatives?exchange=${exchange}&symbol=${symbol}`, 60_000);
  const [tab, setTab] = useState('oi');
  const data = history.result?.data;
  return (
    <>
      <div className="analysis-heading">
        <div>
          <h3>Derivatives context</h3>
          <span>{venueName(exchange)} · open interest in base units · funding per settlement</span>
        </div>
        <Segmented
          value={tab}
          options={[
            { value: 'oi', label: 'Open interest' },
            { value: 'funding', label: 'Funding' },
            { value: 'liquidations', label: 'Liquidations' },
          ]}
          onChange={setTab}
          label="Derivatives dataset"
        />
      </div>
      {tab === 'liquidations' && !['bybit', 'binance'].includes(exchange) ? (
        <Empty
          title="Liquidation feed is not connected for this venue"
          detail="Funding and taker trades have independent coverage. Unavailable liquidation data is not reported as zero."
        />
      ) : tab === 'liquidations' ? (
        <div className="liquidation-list">
          {flow.liquidations.length ? (
            flow.liquidations.slice(0, 12).map((t) => (
              <div className="mono" key={t.id}>
                <span className={t.position === 'Long' ? 'negative' : 'positive'}>
                  {t.position} liquidated
                </span>
                <span>{compact(t.value)} USDT</span>
                <span>{price(t.price)}</span>
                <span className="subtle">{time(t.time, true)}</span>
              </div>
            ))
          ) : (
            <Empty
              title="No liquidations observed this session"
              detail="Events are exchange-reported liquidations at bankruptcy price. They are distinct from projected liquidation levels."
            />
          )}
        </div>
      ) : data?.[tab === 'oi' ? 'oi' : 'funding'].length ? (
        <LineChart
          key={tab}
          points={data[tab === 'oi' ? 'oi' : 'funding']}
          formatter={tab === 'oi' ? (n) => compact(n) : (n) => percent(n, 4)}
          height={210}
        />
      ) : (
        <Empty
          title={history.loading ? 'Loading derivatives history…' : 'Dataset unavailable'}
          detail={history.error || data?.warnings.join(' ')}
          retry={history.loading ? undefined : history.refresh}
        />
      )}
    </>
  );
}
function CoinGlassPanel({
  symbol,
  exchange,
  openSources,
}: {
  symbol: string;
  exchange: string;
  openSources: () => void;
}) {
  const [tab, setTab] = useState('cvd');
  const data = useApi<{ time: number; cum_vol_delta: number }[] | CoinGlassHeat>(
    `/api/coinglass?exchange=${exchange}&symbol=${symbol}&kind=${tab}`,
    60_000,
  );
  return (
    <>
      <div className="analysis-heading">
        <div>
          <h3>{tab === 'cvd' ? 'Historical CVD' : 'Modelled liquidation levels'}</h3>
          <span>CoinGlass · Bybit perpetual · {tab === 'cvd' ? '1h interval' : '24h model'}</span>
        </div>
        <Segmented
          value={tab}
          options={[
            { value: 'cvd', label: 'CVD' },
            { value: 'heatmap', label: 'Liquidation heatmap' },
          ]}
          onChange={setTab}
          label="CoinGlass dataset"
        />
      </div>
      {data.result?.data ? (
        tab === 'cvd' && Array.isArray(data.result.data) ? (
          <LineChart
            points={data.result.data.map((x) => ({
              time: x.time > 1e12 ? x.time / 1000 : x.time,
              value: Number(x.cum_vol_delta),
            }))}
            height={210}
          />
        ) : !Array.isArray(data.result.data) && Array.isArray(data.result.data.y_axis) ? (
          <Heatmap model={data.result.data} />
        ) : (
          <Empty
            title="Unrecognised provider response"
            detail="The connected dataset does not match the documented schema."
          />
        )
      ) : (
        <div className="coinglass-empty">
          <Info size={22} />
          <div>
            <h3>{data.loading ? 'Checking historical coverage…' : 'Connect your CoinGlass data'}</h3>
            <p>{data.error || 'Historical datasets use your own data subscription.'}</p>
            <button className="button" onClick={openSources}>
              Data connections <ArrowUpRight size={14} />
            </button>
          </div>
        </div>
      )}
      <div className="panel-footnote">
        CoinGlass liquidation heatmaps estimate levels from market data and leverage. They do not show actual
        orders or guarantee where positions will liquidate.
      </div>
    </>
  );
}

function VenueComparison({ symbol }: { symbol: string }) {
  const data = useApi<{
    token: string;
    multiplier: number;
    rows: {
      venue: string;
      quote: string;
      price: number;
      funding: number | null;
      hours: number | null;
      spreadBps: number | null;
      asOf: number;
      stale: boolean;
    }[];
    warnings: string[];
  }>(`/api/comparison?symbol=${symbol}`, 30_000);
  const value = data.result?.data;
  return (
    <>
      <div className="analysis-heading">
        <div>
          <h3>Cross-venue context</h3>
          <span>Bybit, OKX & Hyperliquid · prices per single underlying token</span>
        </div>
      </div>
      {value ? (
        <div className="table-scroll">
          <table className="comparison-table">
            <thead>
              <tr>
                <th>Venue</th>
                <th>Price / quote</th>
                <th>Funding / interval</th>
                <th>8h equivalent</th>
                <th>Spread</th>
                <th>Observed</th>
              </tr>
            </thead>
            <tbody>
              {value.rows.map((r) => (
                <tr key={r.venue}>
                  <td>
                    {r.venue}
                    {r.stale ? ' · stale' : ''}
                  </td>
                  <td className="mono">
                    {price(r.price)}
                    <span className="cell-secondary">
                      {r.quote} / {value.token}
                    </span>
                  </td>
                  <td className="mono">
                    {percent(r.funding, 4)}
                    <span className="cell-secondary">{r.hours || '?'}h interval</span>
                  </td>
                  <td className="mono">
                    {r.funding != null && r.hours ? percent((r.funding * 8) / r.hours, 4) : '—'}
                  </td>
                  <td className="mono">{r.spreadBps == null ? '—' : r.spreadBps.toFixed(2) + ' bps'}</td>
                  <td className="mono subtle">{time(r.asOf, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {value.warnings.length > 0 && <div className="panel-footnote">{value.warnings.join(' ')}</div>}
        </div>
      ) : (
        <Empty
          title={data.loading ? 'Comparing venue data…' : 'Comparison unavailable'}
          detail={data.error}
          retry={data.error ? data.refresh : undefined}
        />
      )}
      <div className="panel-footnote">
        8h funding equivalents scale the current rate for comparison. USDT and USDC are distinct quotes;
        prices exclude fees, transfer costs and latency. Exact token matches only.
      </div>
    </>
  );
}
