import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  CandlestickChart,
  Layers,
  Search,
  SlidersHorizontal,
  Wallet,
  ArrowUpRight,
  BookOpen,
  Check,
  Info,
  Plug,
  Bell,
} from 'lucide-react';
import { z } from 'zod';
import { useApi } from './api';
import { Desk } from './Desk';
import { Markets } from './Markets';
import { Dex } from './Dex';
import { Journal } from './Journal';
import { Empty, Modal, Segmented } from './ui';
import type { Market, Category, View, Exchange } from './types';
import { initialPaper, type PaperState } from '../shared/paper';
import { percent, price } from './format';
import { VENUES, VENUE_IDS, venueName } from '../shared/venues.mjs';
import { evaluateAlert, type PriceAlert } from '../shared/risk';
import { AlertsDialog } from './RiskTools';
import { Execution } from './Execution';

const read = <T,>(key: string, fallback: T, schema?: z.ZodType): T => {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    if (value === null) return fallback;
    return (schema ? schema.parse(value) : value) as T;
  } catch {
    return fallback;
  }
};
const save = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};
const storageStrings = z.array(z.string().max(140)).max(500);
const positionSchema = z.object({
  exchange: z.string().default('bybit'),
  symbol: z.string().regex(/^[A-Z0-9]{2,30}$/),
  category: z.enum(['spot', 'linear']),
  quantity: z.number().finite(),
  average: z.number().positive(),
  mark: z.number().positive(),
  updatedAt: z.number().finite(),
});
const paperSchema = z.object({
  version: z.literal(1),
  cash: z.number().finite(),
  positions: z.record(z.string(), positionSchema),
  fills: z
    .array(
      z.object({
        exchange: z.string().default('bybit'),
        id: z.string(),
        symbol: z.string().regex(/^[A-Z0-9]{2,30}$/),
        category: z.enum(['spot', 'linear']),
        side: z.enum(['Buy', 'Sell']),
        price: z.number().positive(),
        quantity: z.number().positive(),
        fee: z.number().nonnegative(),
        realized: z.number().finite(),
        time: z.number().finite(),
      }),
    )
    .max(200),
});
const navigation = [
  { id: 'desk' as const, label: 'Trading desk', icon: CandlestickChart, key: '1' },
  { id: 'markets' as const, label: 'Markets', icon: Activity, key: '2' },
  { id: 'dex' as const, label: 'DEX explorer', icon: Layers, key: '3' },
  { id: 'journal' as const, label: 'Paper journal', icon: Wallet, key: '4' },
  { id: 'execution' as const, label: 'Exchange account', icon: Plug, key: '5' },
];
export default function App() {
  const [view, setView] = useState<View>('desk');
  const [exchange, updateExchange] = useState<Exchange>(() =>
    read('tape.exchange', 'binance', z.enum(VENUE_IDS)),
  );
  const [category, setCategory] = useState<Category>(() =>
    read('tape.category', 'linear', z.enum(['linear', 'spot'])),
  );
  const [symbol, setSymbol] = useState(() =>
    read('tape.symbol', 'SOLUSDT', z.string().regex(/^[A-Z0-9]{2,30}$/)),
  );
  const [stars, setStars] = useState<string[]>(() =>
    read('tape.watchlist', ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'DOGEUSDT', '1000PEPEUSDT'], storageStrings),
  );
  const [dexStars, setDexStars] = useState<string[]>(() => read('tape.dex-watchlist', [], storageStrings));
  const [paper, updatePaper] = useState<PaperState>(() => {
    const value = read('tape.paper', initialPaper(), paperSchema);
    return {
      ...value,
      positions: Object.fromEntries(
        Object.values(value.positions).map((p) => [`${p.exchange}:${p.category}:${p.symbol}`, p]),
      ),
    };
  });
  const [search, setSearch] = useState(false),
    [sources, setSources] = useState(false),
    [help, setHelp] = useState(false);
  const [toastMessage, setToast] = useState(''),
    [dexQuery, setDexQuery] = useState('');
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [alerts, setAlerts] = useState<PriceAlert[]>(() =>
    read(
      'tape.alerts',
      [],
      z
        .array(
          z.object({
            exchange: z.enum(VENUE_IDS),
            id: z.string(),
            symbol: z.string(),
            category: z.enum(['spot', 'linear']),
            direction: z.enum(['above', 'below']),
            threshold: z.number().positive(),
            lastPrice: z.number().positive(),
            triggeredAt: z.number().nullable(),
            createdAt: z.number(),
          }),
        )
        .max(100),
    ),
  );
  const data = useApi<Market[]>(`/api/markets?exchange=${exchange}&category=${category}`, 15_000);
  const alertQuotes = useApi<
    { exchange: string; category: string; symbol: string; price: number; asOf: number; stale: boolean }[]
  >(
    alerts.some((a) => !a.triggeredAt)
      ? `/api/alert-quotes?ids=${encodeURIComponent([...new Set(alerts.filter((a) => !a.triggeredAt).map((a) => `${a.exchange}:${a.category}:${a.symbol}`))].join(','))}`
      : null,
    15_000,
  );
  const markets = data.result?.data.filter((m) => m.category === category && m.exchange === exchange) || [];
  const market = markets.find((m) => m.symbol === symbol);
  const watchlist = stars
    .map((s) => markets.find((m) => m.symbol === s))
    .filter((m): m is Market => Boolean(m));
  const setExchange = (id: Exchange) => {
    updateExchange(id);
    if (!VENUES.find((v) => v.id === id)?.derivatives) setCategory('spot');
  };
  const setMarketCategory = (c: Category) =>
    setCategory(c === 'linear' && !VENUES.find((v) => v.id === exchange)?.derivatives ? 'spot' : c);
  useEffect(() => {
    save('tape.exchange', exchange);
  }, [exchange]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view, exchange, symbol]);
  useEffect(() => {
    save('tape.alerts', alerts);
  }, [alerts]);
  useEffect(() => {
    if (markets.length && !markets.some((m) => m.symbol === symbol)) {
      const base = symbol.replace(/USDT$|USDC$|USD$/, '');
      setSymbol(
        (markets.find((m) => m.base === base) || markets.find((m) => m.base === 'SOL') || markets[0]).symbol,
      );
    }
  }, [data.result]);
  useEffect(() => {
    if (!alertQuotes.result || alertQuotes.error) return;
    const next = alerts.map((a) => {
      const m = alertQuotes.result!.data.find(
        (m) =>
          m.symbol === a.symbol &&
          m.exchange === a.exchange &&
          m.category === a.category &&
          !m.stale &&
          Date.now() - m.asOf < 45_000,
      );
      if (!m || a.triggeredAt || a.lastPrice === m.price) return a;
      const result = evaluateAlert(a, m.price, m.asOf);
      if (result.triggeredAt)
        setToast(`${venueName(a.exchange)} ${a.symbol} crossed ${a.direction} ${price(a.threshold)}.`);
      return result;
    });
    if (next.some((a, i) => a !== alerts[i])) setAlerts(next);
  }, [alertQuotes.result]);
  useEffect(() => {
    save('tape.category', category);
  }, [category]);
  useEffect(() => {
    save('tape.symbol', symbol);
  }, [symbol]);
  useEffect(() => {
    save('tape.watchlist', stars);
  }, [stars]);
  useEffect(() => {
    save('tape.dex-watchlist', dexStars);
  }, [dexStars]);
  useEffect(() => {
    if (!save('tape.paper', paper))
      setToast('Browser storage is full. The current journal will only persist for this session.');
  }, [paper]);
  useEffect(() => {
    if (!data.result || data.result.stale || Date.now() - data.result.asOf > 30_000) return;
    updatePaper((previous) => {
      let changed = false;
      const positions = { ...previous.positions };
      for (const [key, p] of Object.entries(positions)) {
        const m = data.result?.data.find(
          (x) => x.symbol === p.symbol && x.category === p.category && x.exchange === p.exchange,
        );
        if (m && m.price > 0 && Number.isFinite(m.price)) {
          positions[key] = { ...p, mark: m.price, updatedAt: data.result!.asOf };
          changed = true;
        }
      }
      return changed ? { ...previous, positions } : previous;
    });
  }, [data.result]);
  useEffect(() => {
    if (!toastMessage) return;
    const timeout = setTimeout(() => setToast(''), 5000);
    return () => clearTimeout(timeout);
  }, [toastMessage]);
  useEffect(() => {
    const keyboard = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearch((v) => !v);
        return;
      }
      if (
        search ||
        sources ||
        help ||
        alertsOpen ||
        (e.target instanceof HTMLElement &&
          (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable))
      )
        return;
      if (e.key === '/') {
        e.preventDefault();
        setSearch(true);
      }
      if (e.key === '?') setHelp(true);
      const nav = navigation.find((n) => n.key === e.key);
      if (nav) setView(nav.id);
    };
    document.addEventListener('keydown', keyboard);
    return () => document.removeEventListener('keydown', keyboard);
  }, [search, sources, help, alertsOpen]);
  const toggleDexStar = (key: string) => {
    if (!dexStars.includes(key) && dexStars.length >= 50) {
      setToast('Saved pools are limited to 50. Remove a pool to add another.');
      return;
    }
    setDexStars((previous) =>
      previous.includes(key) ? previous.filter((v) => v !== key) : [...previous, key],
    );
  };
  const toggleStar = (s: string) =>
    setStars((previous) => (previous.includes(s) ? previous.filter((v) => v !== s) : [...previous, s]));
  const select = (s: string, c: Category = category, venue: Exchange = exchange) => {
    updateExchange(venue);
    setCategory(c);
    setSymbol(s);
    setView('desk');
    setSearch(false);
  };
  const navName = navigation.find((n) => n.id === view)!.label;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#desk"
          onClick={(e) => {
            e.preventDefault();
            setView('desk');
          }}
          aria-label="Tape home"
        >
          <img src="/tape.svg" alt="" />
          <span>
            TAPE<b>CRYPTO TERMINAL</b>
          </span>
        </a>
        <div className="sidebar-section-label">WORKSPACE</div>
        <nav aria-label="Primary navigation">
          {navigation.map((n) => (
            <button
              className={`nav-item ${view === n.id ? 'selected' : ''}`}
              key={n.id}
              aria-label={n.label}
              title={n.label}
              aria-current={view === n.id ? 'page' : undefined}
              onClick={() => setView(n.id)}
            >
              <n.icon size={17} />
              <span>{n.label}</span>
              <kbd>{n.key}</kbd>
            </button>
          ))}
        </nav>
        <div className="watchlist-heading">
          <span>WATCHLIST</span>
          <button className="icon-button" aria-label="Find a market to watch" onClick={() => setSearch(true)}>
            <Search size={14} />
          </button>
        </div>
        <div className="sidebar-watchlist">
          {watchlist.map((m) => (
            <button
              className={`watch-item ${symbol === m.symbol ? 'selected' : ''}`}
              key={m.symbol}
              onClick={() => select(m.symbol)}
            >
              <span>
                <b>{m.base}</b>
                <small>
                  {m.quote} {category === 'linear' ? 'PERP' : 'SPOT'}
                </small>
              </span>
              <span className="mono">
                <b>{price(m.price, m.tick)}</b>
                <small className={m.change >= 0 ? 'positive' : 'negative'}>{percent(m.change)}</small>
              </span>
            </button>
          ))}
          {!watchlist.length && (
            <div className="watch-empty">
              {data.loading ? 'Loading your markets…' : 'Star a market to keep it here.'}
            </div>
          )}
        </div>
        <button className="add-market" onClick={() => setSearch(true)}>
          + Find a market <kbd>⌘ K</kbd>
        </button>
        <div className="sidebar-bottom">
          <button onClick={() => setSources(true)}>
            <SlidersHorizontal size={16} />
            Data connections
          </button>
          <button onClick={() => setHelp(true)}>
            <BookOpen size={16} />
            Desk guide
          </button>
          <div className="local-session">
            <i
              className={`status-dot ${data.result && !data.result.stale && !data.error ? 'connected' : ''}`}
            />
            <span>
              Local workspace<b>Public feeds · no account</b>
            </span>
            <span className="version">v0.1</span>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span> <b>{navName}</b>
          </div>
          <select
            className="venue-select"
            aria-label="Market data exchange"
            value={exchange}
            onChange={(e) => setExchange(e.target.value as Exchange)}
          >
            {VENUES.map((v) => (
              <option value={v.id} key={v.id}>
                {v.name}
              </option>
            ))}
          </select>
          <button className="global-search" onClick={() => setSearch(true)}>
            <Search size={15} />
            <span>Search markets or contract address</span>
            <kbd>Ctrl K</kbd>
          </button>
          <button className="icon-button" aria-label="Price alerts" onClick={() => setAlertsOpen(true)}>
            <Bell size={17} />
          </button>
          <button className="icon-button" aria-label="Data connections" onClick={() => setSources(true)}>
            <SlidersHorizontal size={17} />
          </button>
        </header>
        <main className={view === 'desk' ? 'desk-main' : ''}>
          <div hidden={view !== 'desk'}>
            {market ? (
              <Desk
                key={`${exchange}:${category}:${symbol}`}
                market={market}
                star={stars.includes(symbol)}
                toggleStar={() => toggleStar(symbol)}
                paper={paper}
                setPaper={updatePaper}
                toast={setToast}
                openSources={() => setSources(true)}
              />
            ) : (
              <Empty
                title={
                  data.loading
                    ? 'Connecting your crypto desk…'
                    : `${symbol} is unavailable in ${category === 'spot' ? 'spot' : 'perpetual'} markets`
                }
                detail={data.error || 'Choose an available market to open its chart and order flow.'}
                retry={data.error ? data.refresh : undefined}
              />
            )}
            {!market && !data.loading && (
              <button className="button browse-markets" onClick={() => setView('markets')}>
                Browse markets <ArrowUpRight size={15} />
              </button>
            )}
          </div>
          {view === 'markets' && (
            <Markets
              markets={markets}
              exchange={exchange}
              category={category}
              setCategory={setMarketCategory}
              stars={stars}
              toggleStar={toggleStar}
              select={select}
              loading={data.loading}
              error={data.error}
              refresh={data.refresh}
              result={data.result}
            />
          )}
          {view === 'dex' && (
            <Dex initialQuery={dexQuery} stars={dexStars} toggleStar={toggleDexStar} toast={setToast} />
          )}
          {view === 'execution' && (
            <Execution selected={symbol} toast={setToast} openSources={() => setSources(true)} />
          )}
          {view === 'journal' && (
            <Journal paper={paper} setPaper={updatePaper} select={select} toast={setToast} />
          )}
        </main>
      </div>
      {search && (
        <SearchDialog
          markets={markets}
          exchange={exchange}
          category={category}
          setCategory={setMarketCategory}
          close={() => setSearch(false)}
          select={(s) => select(s)}
          openDex={(q) => {
            setDexQuery(q);
            setView('dex');
            setSearch(false);
          }}
        />
      )}
      {alertsOpen && (
        <AlertsDialog
          alerts={alerts}
          setAlerts={setAlerts}
          markets={markets}
          selected={symbol}
          category={category}
          close={() => setAlertsOpen(false)}
        />
      )}
      {sources && <SourceDialog close={() => setSources(false)} />}
      {help && (
        <Modal title="Your desk, at a glance" close={() => setHelp(false)}>
          <div className="modal-body guide-content">
            <p>
              Pick a market in the watchlist or search. Every panel on the trading desk follows that
              instrument.
            </p>
            <dl>
              <dt>Order flow</dt>
              <dd>
                CVD adds taker buy notional and subtracts taker sell notional in USDT. It starts when the feed
                connects and resets after connection gaps. The chart retains the latest 30 minutes; the
                session total continues to accumulate.
              </dd>
              <dt>Liquidity heatmap</dt>
              <dd>
                Visible resting orders recorded from the 50-level book. Brighter bands carry more quote
                notional. Orders can disappear before trading.
              </dd>
              <dt>DEX explorer</dt>
              <dd>
                Search token contracts to distinguish identical symbols. Pool prices, liquidity and swaps are
                sampled provider data; token checks depend on network coverage.
              </dd>
              <dt>Paper journal</dt>
              <dd>
                Test orders against the live book with visible-depth slippage and a fixed 6 bps fee. Sell
                reduces or reverses perpetual positions; spot sells require holdings.
              </dd>
            </dl>
            <div className="keyboard-guide">
              <span>
                <kbd>Ctrl K</kbd> Search
              </span>
              <span>
                <kbd>1–5</kbd> Workspaces
              </span>
              <span>
                <kbd>?</kbd> This guide
              </span>
              <span>
                <kbd>Esc</kbd> Close dialog
              </span>
            </div>
          </div>
        </Modal>
      )}
      {toastMessage && (
        <div className="toast" role="status">
          <Check size={15} />
          {toastMessage}
        </div>
      )}
    </div>
  );
}

function SearchDialog({
  markets,
  exchange,
  category,
  setCategory,
  close,
  select,
  openDex,
}: {
  exchange: Exchange;
  markets: Market[];
  category: Category;
  setCategory: (c: Category) => void;
  close: () => void;
  select: (s: string) => void;
  openDex: (q: string) => void;
}) {
  const [query, setQuery] = useState(''),
    [index, setIndex] = useState(0);
  const rows = useMemo(
    () =>
      markets
        .filter((m) => `${m.symbol} ${m.base}`.toLowerCase().includes(query.toLowerCase().trim()))
        .slice(0, 9),
    [markets, query],
  );
  return (
    <Modal title="Find a market" close={close} wide>
      <div className="command-search">
        <Search size={20} />
        <input
          autoFocus
          aria-label="Search markets and token contracts"
          placeholder="Symbol or token contract…"
          value={query}
          role="combobox"
          aria-expanded="true"
          aria-controls="market-results"
          aria-activedescendant={rows[index] ? `search-${rows[index].symbol}` : undefined}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setIndex((i) => Math.min(i + 1, rows.length - 1));
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setIndex((i) => Math.max(i - 1, 0));
            }
            if (e.key === 'Enter') {
              e.preventDefault();
              if (rows[index]) select(rows[index].symbol);
              else if (query.trim()) openDex(query.trim());
            }
          }}
        />
      </div>
      <div className="command-filters">
        <Segmented
          value={category}
          options={[
            { value: 'linear', label: 'Perpetuals' },
            { value: 'spot', label: 'Spot' },
          ]}
          onChange={setCategory}
          label="Search market type"
        />
        <span className="subtle">{venueName(exchange)} markets</span>
      </div>
      <div className="command-results" role="listbox" id="market-results" aria-label="Matching markets">
        {rows.map((m, i) => (
          <button
            id={`search-${m.symbol}`}
            role="option"
            aria-selected={i === index}
            className={i === index ? 'selected' : ''}
            key={m.symbol}
            onMouseEnter={() => setIndex(i)}
            onClick={() => select(m.symbol)}
          >
            <span className="token-monogram">{m.base.slice(0, 2)}</span>
            <span>
              <b>
                {m.base} <small>/ {m.quote}</small>
              </b>
              <span className="cell-secondary">{category === 'linear' ? 'Perpetual' : 'Spot'}</span>
            </span>
            <span className="mono">
              {price(m.price, m.tick)}
              <small className={m.change >= 0 ? 'positive' : 'negative'}>{percent(m.change)}</small>
            </span>
            <ArrowUpRight size={15} />
          </button>
        ))}
        {!rows.length && (
          <Empty
            title="No exchange market matches"
            detail="Search on DEX for a token symbol or contract address."
          />
        )}
      </div>
      {query.trim() && (
        <button className="search-dex" onClick={() => openDex(query.trim())}>
          <Layers size={17} />
          <span>
            Search DEX pools for <b>{query.trim()}</b>
          </span>
          <ArrowUpRight size={16} />
        </button>
      )}
      <div className="command-footer">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> Navigate
        </span>
        <span>
          <kbd>Enter</kbd> Open
        </span>
        <span>
          <kbd>Esc</kbd> Close
        </span>
      </div>
    </Modal>
  );
}
function SourceDialog({ close }: { close: () => void }) {
  return (
    <Modal title="Data connections" close={close} wide>
      <div className="modal-body sources-content">
        <p>Your workspace connects through a local service. Public feeds need no API keys.</p>
        <div className="source-row">
          <div>
            <h3>12 exchange venues</h3>
            <span>
              Binance, Bybit, OKX, Coinbase, Kraken, Gate, Bitget, Bitstamp, MEXC, Crypto.com, KuCoin and HTX.
              Public spot feeds on all; perpetual coverage varies.
            </span>
          </div>
          <span className="connection-chip">Public</span>
        </div>
        <div className="source-row">
          <div>
            <h3>DEX Screener</h3>
            <span>Contract search · pools · liquidity · discovery · 60s refresh</span>
          </div>
          <span className="connection-chip">Public</span>
        </div>
        <div className="source-row">
          <div>
            <h3>GeckoTerminal / GoPlus</h3>
            <span>Pool candles & swaps · EVM token checks · coverage varies</span>
          </div>
          <span className="connection-chip">Public</span>
        </div>
        <div className="source-row">
          <div>
            <h3>Historical order flow</h3>
            <span>
              Binance spot/perpetuals and OKX perpetuals use public taker volumes. CoinGlass adds compatible
              venue history and modelled liquidation levels.
            </span>
          </div>
          <span className="badge">Optional key</span>
        </div>
        <div className="connection-instructions">
          <Info size={17} />
          <div>
            <h3>Connect CoinGlass</h3>
            <p>
              Copy <code>.env.example</code> to <code>.env</code> in the repository, add{' '}
              <code>COINGLASS_API_KEY</code>, and restart the data service. Keys stay on the local service.
            </p>
            <h3>Bybit account & execution</h3>
            <p>
              Add BYBIT_API_KEY and BYBIT_API_SECRET in .env. BYBIT_NETWORK defaults to testnet. Set
              BYBIT_TRADING_ENABLED=true to allow order routing; mainnet also requires
              BYBIT_ALLOW_MAINNET=true. The default per-order cap is 1,000 USDT. Restart the service after
              changes. Use a trade/read key without withdrawal permission.
            </p>
            <p>
              CVD requires a compatible API plan. Model1 liquidation heatmaps require Professional or
              Enterprise. The UI reports missing coverage and plan errors.
            </p>
            <a
              href="https://docs.coinglass.com/reference/getting-started-with-your-api"
              target="_blank"
              rel="noreferrer"
            >
              CoinGlass API documentation <ArrowUpRight size={13} />
            </a>
          </div>
        </div>
        <p className="page-note">
          Live CVD and exchange figures cover the selected venue. Historical CVD has its own explicit source
          selector. DEX provider sampling has separate refresh and indexing delays. A stale feed keeps its
          original observation time. No provider data is replaced with simulated market values.
        </p>
      </div>
    </Modal>
  );
}
