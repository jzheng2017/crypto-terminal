import { useEffect, useMemo, useState } from 'react';
import { Search, ArrowLeft, ExternalLink, Copy, Star, RefreshCw, Info } from 'lucide-react';
import { useApi } from './api';
import type { Candle, DexPair, TokenSecurity } from './types';
import { compact, price, percent, age, shortened, time } from './format';
import { PriceChart } from './Charts';
import { Empty, Segmented } from './ui';

const chains = ['all', 'solana', 'ethereum', 'base', 'bsc', 'arbitrum', 'polygon', 'avalanche', 'optimism'];
const explorer: Record<string, string> = {
  solana: 'https://solscan.io/token/',
  ethereum: 'https://etherscan.io/token/',
  base: 'https://basescan.org/token/',
  bsc: 'https://bscscan.com/token/',
  arbitrum: 'https://arbiscan.io/token/',
  polygon: 'https://polygonscan.com/token/',
  avalanche: 'https://snowtrace.io/token/',
  optimism: 'https://optimistic.etherscan.io/token/',
};
export function Dex({
  initialQuery,
  stars,
  toggleStar,
  toast,
}: {
  initialQuery: string;
  stars: string[];
  toggleStar: (key: string) => void;
  toast: (m: string) => void;
}) {
  const [input, setInput] = useState(initialQuery),
    [query, setQuery] = useState(initialQuery),
    [chain, setChain] = useState('all');
  const [mode, setMode] = useState('profiles'),
    [floor, setFloor] = useState('0'),
    [sort, setSort] = useState('liquidity');
  const [pair, setPair] = useState<DexPair | null>(null),
    [watchOnly, setWatchOnly] = useState(false);
  useEffect(() => {
    setInput(initialQuery);
    setQuery(initialQuery);
    setPair(null);
  }, [initialQuery]);
  const discover = useApi<DexPair[]>(
    `/api/dex?q=${encodeURIComponent(query)}&chain=${chain}&mode=${mode}`,
    60_000,
  );
  const saved = useApi<DexPair[]>(
    watchOnly ? `/api/dex/saved?ids=${encodeURIComponent(stars.slice(0, 50).join(','))}` : null,
    60_000,
  );
  const data = watchOnly ? saved : discover;
  const rows = useMemo(
    () =>
      (data.result?.data || [])
        .filter(
          (p) =>
            (p.liquidity ?? 0) >= Math.max(0, Number(floor) || 0) && (chain === 'all' || p.chain === chain),
        )
        .sort((a, b) => {
          if (sort === 'change') return (b.change ?? -Infinity) - (a.change ?? -Infinity);
          if (sort === 'age') return (b.created ?? 0) - (a.created ?? 0);
          if (sort === 'volume') return (b.volume ?? 0) - (a.volume ?? 0);
          return (b.liquidity ?? 0) - (a.liquidity ?? 0);
        }),
    [data.result, floor, chain, sort],
  );
  if (pair)
    return (
      <DexDetail
        pair={pair}
        back={() => setPair(null)}
        starred={stars.includes(`${pair.chain}:${pair.address}`)}
        toggleStar={() => toggleStar(`${pair.chain}:${pair.address}`)}
        toast={toast}
      />
    );
  return (
    <div className="page dex-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">ONCHAIN MARKETS</div>
          <h1>DEX explorer</h1>
          <p>Find the token. Inspect the pool. Follow the liquidity.</p>
        </div>
        <button
          className="icon-button"
          title="Refresh pools"
          aria-label="Refresh DEX pools"
          onClick={data.refresh}
        >
          <RefreshCw size={17} />
        </button>
      </div>
      <form
        className="dex-search"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(input.trim());
          setWatchOnly(false);
        }}
      >
        <Search size={18} />
        <input
          aria-label="Search token symbol or contract address"
          placeholder="Search a token or paste its contract address…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button className="button primary" type="submit">
          Find pools
        </button>
      </form>
      <div className="filter-toolbar">
        <Segmented
          value={mode}
          options={[
            { value: 'profiles', label: 'Recently profiled' },
            { value: 'boosted', label: 'Boosted · paid' },
          ]}
          onChange={(v) => {
            setMode(v);
            setQuery('');
            setInput('');
          }}
          label="DEX discovery feed"
        />
        <label className="select-label">
          Network
          <select aria-label="DEX network" value={chain} onChange={(e) => setChain(e.target.value)}>
            {chains.map((c) => (
              <option key={c} value={c}>
                {c === 'all' ? 'All networks' : c.charAt(0).toUpperCase() + c.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <label className="select-label">
          Min. liquidity{' '}
          <input
            type="number"
            min="0"
            step="1000"
            value={floor}
            onChange={(e) => setFloor(e.target.value)}
            aria-label="Minimum pool liquidity in USD"
          />
          <span>USD</span>
        </label>
        <button
          className={`button ${watchOnly ? 'active' : ''}`}
          aria-pressed={watchOnly}
          onClick={() => setWatchOnly((v) => !v)}
        >
          <Star size={14} />
          Saved pools
        </button>
      </div>
      <div className="table-caption">
        <span>
          {watchOnly
            ? 'Saved pools'
            : query
              ? `Results for “${query}”`
              : mode === 'profiles'
                ? 'Recently profiled tokens · pool age is shown separately'
                : 'Paid token boosts · promotion does not indicate quality'}{' '}
          <span className="subtle">/ {rows.length} pools</span>
        </span>
        <span className="subtle">
          DEX Screener {data.result ? `· updated ${time(data.result.asOf, true)}` : ''}
        </span>
      </div>
      {(data.error || data.result?.stale) && (
        <div className="inline-notice">{data.error || 'These pool quotes are stale.'}</div>
      )}
      <section className="panel pool-table">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th />
                <th>Token / pool</th>
                <th>Network / DEX</th>
                <th>
                  Price <small>USD</small>
                </th>
                <th>
                  <button onClick={() => setSort('change')}>24h {sort === 'change' ? '↓' : ''}</button>
                </th>
                <th>
                  <button onClick={() => setSort('liquidity')}>
                    Liquidity {sort === 'liquidity' ? '↓' : ''}
                  </button>
                </th>
                <th>
                  <button onClick={() => setSort('volume')}>24h volume {sort === 'volume' ? '↓' : ''}</button>
                </th>
                <th>FDV</th>
                <th>
                  <button onClick={() => setSort('age')}>Pool age {sort === 'age' ? '↓' : ''}</button>
                </th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={`${p.chain}:${p.address}`}>
                  <td className="star-cell">
                    <button
                      className={`icon-button ${stars.includes(`${p.chain}:${p.address}`) ? 'starred' : ''}`}
                      aria-label={`Save ${p.symbol} pool on ${p.chain}`}
                      onClick={() => toggleStar(`${p.chain}:${p.address}`)}
                    >
                      <Star
                        size={14}
                        fill={stars.includes(`${p.chain}:${p.address}`) ? 'currentColor' : 'none'}
                      />
                    </button>
                  </td>
                  <td>
                    <button className="asset-button" onClick={() => setPair(p)}>
                      <span className="token-monogram">{p.symbol.slice(0, 2)}</span>
                      <span>
                        <b>
                          {p.symbol}
                          <small> / {p.quote}</small>
                          {p.boosted && <em className="paid-badge">paid boost</em>}
                        </b>
                        <span className="cell-secondary" title={`${p.name} · ${p.token}`}>
                          {shortened(p.token)}
                        </span>
                      </span>
                    </button>
                  </td>
                  <td>
                    <span className="chain-label">{p.chain}</span>
                    <span className="cell-secondary">{p.dex}</span>
                  </td>
                  <td className="mono">{price(p.price)}</td>
                  <td className={`mono ${(p.change ?? 0) >= 0 ? 'positive' : 'negative'}`}>
                    {percent(p.change)}
                  </td>
                  <td className={`mono ${p.liquidity != null && p.liquidity < 10000 ? 'amber' : ''}`}>
                    {compact(p.liquidity, true)}
                  </td>
                  <td className="mono">{compact(p.volume, true)}</td>
                  <td className="mono subtle">{compact(p.fdv, true)}</td>
                  <td className="mono subtle">{age(p.created)}</td>
                  <td>
                    <button
                      className="icon-button"
                      aria-label={`Inspect ${p.symbol} pool`}
                      onClick={() => setPair(p)}
                    >
                      <ExternalLink size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && (
          <Empty
            title={data.loading ? 'Finding onchain pools…' : 'No pools match these filters'}
            detail={
              data.error ||
              (watchOnly
                ? 'No indexed saved pools match these network or liquidity filters.'
                : 'Try a contract address, another network, or a lower liquidity threshold.')
            }
            retry={data.error ? data.refresh : undefined}
          />
        )}
      </section>
      <div className="page-note">
        <Info size={14} />
        Pair identity is chain + pool address. Search results and discovery feeds are provider samples, not a
        complete new-pool index. Missing market cap, pool age or security data stays unknown.
      </div>
    </div>
  );
}

function DexDetail({
  pair: initial,
  back,
  starred,
  toggleStar,
  toast,
}: {
  pair: DexPair;
  back: () => void;
  starred: boolean;
  toggleStar: () => void;
  toast: (m: string) => void;
}) {
  const [interval, setInterval] = useState('15');
  const q = `chain=${encodeURIComponent(initial.chain)}&address=${encodeURIComponent(initial.address)}`;
  const live = useApi<DexPair>(`/api/dex/pair?${q}`, 60_000),
    pair = live.result?.data || initial;
  const candles = useApi<Candle[]>(`/api/dex/candles?${q}&interval=${interval}`, 120_000);
  const security = useApi<TokenSecurity | null>(
    `/api/dex/security?chain=${encodeURIComponent(pair.chain)}&address=${encodeURIComponent(pair.token)}`,
  );
  const swaps = useApi<
    { id: string; side: string; price: number | null; value: number | null; time: number; hash: string }[]
  >(`/api/dex/trades?${q}`, 120_000);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast('Address copied.');
    } catch {
      toast('Clipboard unavailable. Select the address to copy it.');
    }
  };
  const tokenLink = explorer[pair.chain] ? `${explorer[pair.chain]}${encodeURIComponent(pair.token)}` : null;
  const poolLink = `https://dexscreener.com/${encodeURIComponent(pair.chain)}/${encodeURIComponent(pair.address)}`;
  const s = security.result?.data;
  return (
    <div className="page dex-detail">
      <button className="back-button" onClick={back}>
        <ArrowLeft size={15} />
        Back to pools
      </button>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            {pair.chain.toUpperCase()} / {pair.dex.toUpperCase()}
          </div>
          <h1>
            {pair.symbol}
            <span className="subtle"> / {pair.quote}</span>
            <button
              className={`icon-button ${starred ? 'starred' : ''}`}
              onClick={toggleStar}
              aria-label={starred ? 'Unsave pool' : 'Save pool'}
            >
              <Star size={18} fill={starred ? 'currentColor' : 'none'} />
            </button>
          </h1>
          <p>
            {pair.name} <span className="dot-separator">·</span> Pool age {age(pair.created)}
          </p>
        </div>
        <div className="detail-price mono">
          <strong>${price(pair.price)}</strong>
          <span className={(pair.change ?? 0) >= 0 ? 'positive' : 'negative'}>
            {percent(pair.change)} <small>24h</small>
          </span>
        </div>
      </div>
      {(live.error || live.result?.stale) && (
        <div className="inline-notice">Pool data is stale. {live.error}</div>
      )}
      <div className="dex-metrics">
        <div>
          <span>Pool liquidity</span>
          <b className="mono">{compact(pair.liquidity, true)}</b>
        </div>
        <div>
          <span>24h volume</span>
          <b className="mono">{compact(pair.volume, true)}</b>
        </div>
        <div>
          <span>Market cap</span>
          <b className="mono">{compact(pair.marketCap, true)}</b>
        </div>
        <div>
          <span>Fully diluted value</span>
          <b className="mono">{compact(pair.fdv, true)}</b>
        </div>
        <div>
          <span>24h buys / sells</span>
          <b className="mono">
            <i className="positive">{compact(pair.buys)}</i> /{' '}
            <i className="negative">{compact(pair.sells)}</i>
          </b>
        </div>
      </div>
      <div className="dex-detail-grid">
        <div>
          <section className="panel dex-chart">
            <div className="panel-toolbar">
              <h3>
                Pool price <span className="subtle">USD</span>
              </h3>
              <Segmented
                value={interval}
                options={[
                  { value: '1', label: '1m' },
                  { value: '5', label: '5m' },
                  { value: '15', label: '15m' },
                ]}
                onChange={setInterval}
                label="Pool chart interval"
              />
            </div>
            {candles.result?.data.length ? (
              <PriceChart candles={candles.result.data} label={`${pair.chain}:${pair.address}:${interval}`} />
            ) : (
              <Empty
                title={candles.loading ? 'Loading pool history…' : 'Pool chart not available'}
                detail={candles.error || 'GeckoTerminal has not indexed candle history for this pool.'}
                retry={candles.error ? candles.refresh : undefined}
              />
            )}
            <div className="panel-footnote">
              GeckoTerminal pool OHLCV · sampled refresh every 2 minutes{' '}
              {candles.result?.stale ? '· stale' : ''}
            </div>
          </section>
          <section className="panel swaps-panel">
            <div className="panel-toolbar">
              <h3>Recent swaps</h3>
              <span className="subtle">GeckoTerminal · provider sample</span>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Side</th>
                    <th>
                      Value <small>USD</small>
                    </th>
                    <th>Token price</th>
                    <th>Time</th>
                    <th>Transaction</th>
                  </tr>
                </thead>
                <tbody>
                  {swaps.result?.data.slice(0, 15).map((t) => (
                    <tr key={t.id}>
                      <td className={t.side === 'buy' ? 'positive' : 'negative'}>{t.side}</td>
                      <td className="mono">{compact(t.value, true)}</td>
                      <td className="mono">{price(t.price)}</td>
                      <td className="mono subtle">{time(t.time, true)}</td>
                      <td className="mono subtle" title={t.hash}>
                        {shortened(t.hash)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!swaps.result?.data.length && (
              <Empty
                title={swaps.loading ? 'Loading recent swaps…' : 'Swap data unavailable'}
                detail={swaps.error || 'The provider returned no recent transactions.'}
              />
            )}
            {swaps.result?.stale && <div className="inline-notice">Swap data is stale.</div>}
          </section>
        </div>
        <aside>
          <section className="panel identity-panel">
            <div className="panel-toolbar">
              <h3>Pool identity</h3>
            </div>
            <div className="identity-body">
              <span className="field-caption">Token contract</span>
              <div className="address-row">
                <code>{pair.token}</code>
                <button
                  className="icon-button"
                  aria-label="Copy token address"
                  onClick={() => copy(pair.token)}
                >
                  <Copy size={14} />
                </button>
              </div>
              <span className="field-caption">Pool address</span>
              <div className="address-row">
                <code>{pair.address}</code>
                <button
                  className="icon-button"
                  aria-label="Copy pool address"
                  onClick={() => copy(pair.address)}
                >
                  <Copy size={14} />
                </button>
              </div>
              <a className="button" href={poolLink} target="_blank" rel="noreferrer">
                Open pool on DEX Screener <ExternalLink size={13} />
              </a>
              {tokenLink && (
                <a className="text-button" href={tokenLink} target="_blank" rel="noreferrer">
                  View token on explorer <ExternalLink size={13} />
                </a>
              )}
            </div>
          </section>
          <section className="panel security-panel">
            <div className="panel-toolbar">
              <h3>Contract checks</h3>
              <span className="subtle">GoPlus</span>
            </div>
            {s ? (
              <div className="security-values">
                {[
                  ['Honeypot reported', s.honeypot],
                  ['Mint authority reported', s.mintable],
                  ['Sell restriction reported', s.sellBlocked],
                  ['Source code available', s.openSource],
                ].map(([label, value]) => (
                  <div key={String(label)}>
                    <span>{label}</span>
                    <b
                      className={
                        value === null
                          ? 'subtle'
                          : label === 'Source code available'
                            ? value
                              ? 'positive'
                              : 'amber'
                            : value
                              ? 'negative'
                              : 'subtle'
                      }
                    >
                      {value === null ? 'Unknown' : value ? 'Yes' : 'No'}
                    </b>
                  </div>
                ))}
                <div>
                  <span>Buy / sell tax</span>
                  <b className="mono">
                    {s.buyTax == null ? '—' : (s.buyTax * 100).toFixed(1) + '%'} /{' '}
                    {s.sellTax == null ? '—' : (s.sellTax * 100).toFixed(1) + '%'}
                  </b>
                </div>
                <div>
                  <span>Reported holders</span>
                  <b className="mono">{compact(s.holders)}</b>
                </div>
              </div>
            ) : (
              <Empty
                title={security.loading ? 'Checking contract…' : 'Security coverage unavailable'}
                detail={
                  security.error ||
                  security.result?.reason ||
                  'This token has no report from the connected provider.'
                }
              />
            )}
            <div className="panel-footnote">
              Provider-reported checks are partial and can change. Unknown fields do not imply safety.
            </div>
          </section>
          <section className="pool-context">
            <Info size={15} />
            <p>
              AMM pools have liquidity reserves and swaps. CEX order books and taker CVD are available in the
              trading desk for exchange-listed markets.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
