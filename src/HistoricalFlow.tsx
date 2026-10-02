import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useApi } from './api';
import type { Market } from './types';
import { VENUES, venueName } from '../shared/venues.mjs';
import { LineChart } from './Charts';
import { Empty, Segmented } from './ui';
import { compact } from './format';

interface HistoricalData {
  source: string;
  periodSeconds: number;
  bars: { time: number; buy: number; sell: number; delta: number; cvd: number; partial: boolean }[];
  buy: number;
  sell: number;
  cvd: number;
  gaps: number;
  from: number | null;
  to: number | null;
}
export function HistoricalFlow({ market, session }: { market: Market; session: ReactNode }) {
  const [mode, setMode] = useState('history'),
    [source, setSource] = useState(
      (market.exchange === 'okx' && market.category === 'linear') || market.exchange === 'binance'
        ? market.exchange
        : 'binance',
    );
  const [range, setRange] = useState('24h'),
    [date, setDate] = useState('');
  const end = useMemo(
    () => (date ? Math.min(Date.now(), Date.parse(`${date}T23:59:59.999Z`)) : null),
    [date],
  );
  const historySymbol = market.quote === 'USDT' ? market.symbol : `${market.base}USDT`;
  const data = useApi<HistoricalData>(
    mode === 'history'
      ? `/api/flow-history?exchange=${source}&category=${market.category}&symbol=${historySymbol}&range=${range}${end ? '&end=' + end : ''}`
      : null,
    date ? 0 : 60_000,
  );
  const h = data.result?.data;
  const points = useMemo(() => h?.bars.map((b) => ({ time: b.time, value: b.cvd })) || [], [h?.bars]);
  return (
    <>
      <div className="history-controls">
        <Segmented
          value={mode}
          options={[
            { value: 'history', label: 'Historical' },
            { value: 'session', label: 'Live session' },
          ]}
          onChange={setMode}
          label="Order-flow time coverage"
        />
        {mode === 'history' && (
          <>
            <label>
              Source
              <select
                aria-label="Historical order-flow exchange"
                value={source}
                onChange={(e) => setSource(e.target.value as typeof source)}
              >
                {VENUES.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                    {v.id === 'binance' || (v.id === 'okx' && market.category === 'linear')
                      ? ' · public'
                      : ' · provider key'}
                  </option>
                ))}
              </select>
            </label>
            <select
              aria-label="Historical order-flow lookback"
              value={range}
              onChange={(e) => setRange(e.target.value)}
            >
              <option value="6h">6 hours</option>
              <option value="24h">24 hours</option>
              <option value="7d">7 days</option>
              <option value="30d">30 days</option>
            </select>
            <label className="history-end">
              End (UTC)
              <input
                type="date"
                aria-label="Historical order-flow end date in UTC"
                value={date}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            {date && (
              <button className="text-button" onClick={() => setDate('')}>
                Latest
              </button>
            )}
          </>
        )}
      </div>
      {mode === 'session' ? (
        session
      ) : h?.bars.length ? (
        <>
          <div className="flow-metrics">
            <div>
              <span>
                Lookback CVD <small>USDT</small>
              </span>
              <strong className={`mono ${h.cvd >= 0 ? 'positive' : 'negative'}`}>
                {h.cvd > 0 ? '+' : ''}
                {compact(h.cvd)}
              </strong>
            </div>
            <div>
              <span>Historical taker buys</span>
              <strong className="mono positive">{compact(h.buy)}</strong>
            </div>
            <div>
              <span>Historical taker sells</span>
              <strong className="mono negative">{compact(h.sell)}</strong>
            </div>
            <div>
              <span>Coverage</span>
              <strong className="mono">
                {h.bars.length} <small>bars / {h.periodSeconds / 60}m</small>
              </strong>
            </div>
          </div>
          <LineChart points={points} height={155} />
          <div className="history-caption">
            <span>
              {venueName(source)} · {historySymbol} · CVD rebased at lookback start
            </span>
            <span>
              {new Date(h.from!).toLocaleString('en-GB', {
                timeZone: 'UTC',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}{' '}
              →{' '}
              {new Date(h.to!).toLocaleString('en-GB', {
                timeZone: 'UTC',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}{' '}
              UTC{h.bars.at(-1)?.partial ? ' · latest bar partial' : ''}
            </span>
          </div>
          <details className="historical-delta-table">
            <summary>Inspect bar delta · {h.source}</summary>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>UTC time</th>
                    <th>Buy USDT</th>
                    <th>Sell USDT</th>
                    <th>Delta USDT</th>
                    <th>CVD USDT</th>
                  </tr>
                </thead>
                <tbody>
                  {h.bars
                    .slice(-20)
                    .reverse()
                    .map((b) => (
                      <tr key={b.time}>
                        <td className="mono subtle">
                          {new Date(b.time * 1000).toISOString().slice(5, 16).replace('T', ' ')}
                        </td>
                        <td className="mono positive">{compact(b.buy)}</td>
                        <td className="mono negative">{compact(b.sell)}</td>
                        <td className={`mono ${b.delta >= 0 ? 'positive' : 'negative'}`}>
                          {compact(b.delta)}
                        </td>
                        <td className="mono">{compact(b.cvd)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </details>
          {(data.result?.stale || data.error || h.gaps > 0) && (
            <div className="inline-notice">
              {h.gaps > 0
                ? `${h.gaps} gaps exist in the returned bars. No missing volume is interpolated. `
                : ''}
              {data.error || (data.result?.stale ? 'Historical data is stale.' : '')}
            </div>
          )}
        </>
      ) : (
        <Empty
          title={
            data.loading
              ? `Loading ${venueName(source)} historical flow…`
              : 'Historical order flow unavailable'
          }
          detail={
            data.loading
              ? undefined
              : data.error || 'No compatible taker-volume bars were returned for this market and date.'
          }
          retry={data.loading ? undefined : data.refresh}
        />
      )}
      {mode === 'history' && (
        <div className="panel-footnote">
          Public historical taker-volume bars: Binance spot/perpetuals and OKX perpetuals. Other sources
          require compatible CoinGlass coverage. History and live-session totals are separate to prevent
          overlap and double counting.
        </div>
      )}
    </>
  );
}
