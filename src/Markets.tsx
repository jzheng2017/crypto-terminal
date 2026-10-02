import { useMemo, useState } from 'react';
import { Search, Star, ArrowUpRight, RefreshCw } from 'lucide-react';
import type { Market, Category, Envelope, Exchange } from './types';
import { compact, price, percent, time } from './format';
import { venueName } from '../shared/venues.mjs';
import { Empty, Segmented } from './ui';

export function Markets({
  markets,
  exchange,
  category,
  setCategory,
  stars,
  toggleStar,
  select,
  loading,
  error,
  refresh,
  result,
}: {
  markets: Market[];
  exchange: Exchange;
  category: Category;
  setCategory: (c: Category) => void;
  stars: string[];
  toggleStar: (s: string) => void;
  select: (s: string) => void;
  loading: boolean;
  error: string;
  refresh: () => void;
  result: Envelope<Market[]> | null;
}) {
  const [query, setQuery] = useState(''),
    [watchOnly, setWatchOnly] = useState(false),
    [sort, setSort] = useState('volume'),
    [ascending, setAscending] = useState(false),
    [count, setCount] = useState(100);
  const rows = useMemo(
    () =>
      markets
        .filter(
          (m) =>
            `${m.base} ${m.symbol}`.toLowerCase().includes(query.toLowerCase()) &&
            (!watchOnly || stars.includes(m.symbol)),
        )
        .sort((a, b) => {
          const value = (m: Market) =>
            sort === 'price'
              ? m.price
              : sort === 'change'
                ? m.change
                : sort === 'oi'
                  ? m.oi
                  : sort === 'funding'
                    ? m.funding
                    : m.volume;
          const av = value(a),
            bv = value(b);
          if (av == null) return 1;
          if (bv == null) return -1;
          return ascending ? av - bv : bv - av;
        }),
    [markets, query, watchOnly, stars, sort, ascending],
  );
  const sortBy = (value: string) => {
    if (sort === value) setAscending((v) => !v);
    else {
      setSort(value);
      setAscending(false);
    }
  };
  const sortLabel = (value: string) => (sort === value ? (ascending ? '↑' : '↓') : '');
  return (
    <div className="page markets-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">EXCHANGE MARKETS</div>
          <h1>The crypto market, at a glance.</h1>
          <p>Majors, altcoins and the long tail. One instrument takes you straight to the desk.</p>
        </div>
        <button className="icon-button" aria-label="Refresh exchange markets" onClick={refresh}>
          <RefreshCw size={17} />
        </button>
      </div>
      <div className="market-summary">
        <div>
          <span>Listed dollar-quoted markets</span>
          <b className="mono">{markets.length || '—'}</b>
        </div>
        <div>
          <span>
            24h turnover <small>USDT</small>
          </span>
          <b className="mono">
            {markets.length
              ? compact(markets.filter((m) => m.quote === 'USDT').reduce((s, m) => s + m.volume, 0))
              : '—'}
          </b>
        </div>
        <div>
          <span>
            Positive / negative <small>24h</small>
          </span>
          <b className="mono">
            <i className="positive">{markets.filter((m) => m.change > 0).length}</i>
            <span className="subtle"> / </span>
            <i className="negative">{markets.filter((m) => m.change < 0).length}</i>
          </b>
        </div>
        <div>
          <span>Data coverage</span>
          <b>
            {venueName(exchange)} <small>{category === 'linear' ? 'perpetuals' : 'spot'}</small>
          </b>
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
          label="Market type"
        />
        <div className="table-search">
          <Search size={14} />
          <input
            aria-label="Filter exchange markets"
            value={query}
            placeholder="Filter by symbol…"
            onChange={(e) => {
              setQuery(e.target.value);
              setCount(100);
            }}
          />
        </div>
        <button
          className={`button ${watchOnly ? 'active' : ''}`}
          aria-pressed={watchOnly}
          onClick={() => setWatchOnly((v) => !v)}
        >
          <Star size={14} />
          Watchlist
        </button>
        <span className="toolbar-end subtle">{rows.length} markets</span>
      </div>
      {(error || result?.stale) && <div className="inline-notice">{error || 'Market quotes are stale.'}</div>}
      <section className="panel markets-table">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th />
                <th>Asset</th>
                <th>
                  <button onClick={() => sortBy('price')}>Price / quote {sortLabel('price')}</button>
                </th>
                <th>
                  <button onClick={() => sortBy('change')}>24h change {sortLabel('change')}</button>
                </th>
                <th>
                  <button onClick={() => sortBy('volume')}>
                    24h turnover <small>quote units</small> {sortLabel('volume')}
                  </button>
                </th>
                {category === 'linear' && (
                  <>
                    <th>
                      <button onClick={() => sortBy('oi')}>
                        Open interest <small>USDT</small> {sortLabel('oi')}
                      </button>
                    </th>
                    <th>
                      <button onClick={() => sortBy('funding')}>Funding {sortLabel('funding')}</button>
                    </th>
                  </>
                )}
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, count).map((m) => (
                <tr key={m.symbol}>
                  <td className="star-cell">
                    <button
                      className={`icon-button ${stars.includes(m.symbol) ? 'starred' : ''}`}
                      aria-label={`${stars.includes(m.symbol) ? 'Unwatch' : 'Watch'} ${m.base}`}
                      onClick={() => toggleStar(m.symbol)}
                    >
                      <Star size={14} fill={stars.includes(m.symbol) ? 'currentColor' : 'none'} />
                    </button>
                  </td>
                  <td>
                    <button className="asset-button" onClick={() => select(m.symbol)}>
                      <span className="token-monogram">{m.base.slice(0, 2)}</span>
                      <span>
                        <b>
                          {m.base}
                          <small> / {m.quote}</small>
                        </b>
                        <span className="cell-secondary">{category === 'linear' ? 'Perpetual' : 'Spot'}</span>
                      </span>
                    </button>
                  </td>
                  <td className="mono">
                    {price(m.price, m.tick)}
                    <span className="cell-secondary">{m.quote}</span>
                  </td>
                  <td className="mono">
                    <span className={`change-tag ${m.change >= 0 ? 'positive' : 'negative'}`}>
                      {percent(m.change)}
                    </span>
                  </td>
                  <td className="mono">
                    {m.volumeEstimate ? '~' : ''}
                    {compact(m.volume)}
                  </td>
                  {category === 'linear' && (
                    <>
                      <td className="mono">{compact(m.oi)}</td>
                      <td className="mono">
                        <span className={(m.funding ?? 0) >= 0 ? 'positive' : 'negative'}>
                          {percent(m.funding, 4)}
                        </span>
                        <span className="cell-secondary">every {m.fundingHours ?? '?'}h</span>
                      </td>
                    </>
                  )}
                  <td>
                    <button
                      className="icon-button"
                      aria-label={`Open ${m.base} trading desk`}
                      onClick={() => select(m.symbol)}
                    >
                      <ArrowUpRight size={17} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && (
          <Empty
            title={loading ? 'Loading crypto markets…' : 'No matching markets'}
            detail={error || 'Adjust your search or watchlist filter.'}
            retry={error ? refresh : undefined}
          />
        )}
        {rows.length > count && (
          <button className="load-more" onClick={() => setCount((n) => n + 100)}>
            Show more markets{' '}
            <span>
              {count} / {rows.length}
            </span>
          </button>
        )}
      </section>
      <div className="table-footer">
        <span>
          Turnover summary covers USDT markets only. ~ marks turnover estimates from base volume × last price.
          Quote currencies remain separate.
        </span>
        <span>15s quote refresh {result ? `· observed ${time(result.asOf, true)}` : ''}</span>
      </div>
    </div>
  );
}
