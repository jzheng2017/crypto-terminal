import { useEffect, useRef, useState } from 'react';
import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  ColorType,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Candle } from './types';
import type { FlowPoint, HeatSample } from '../shared/flow';
import { compact, price, time } from './format';

const chartOptions = {
  layout: {
    background: { type: ColorType.Solid, color: '#0d1014' },
    textColor: '#8c959f',
    fontFamily: 'Cascadia Code, Consolas, monospace',
    fontSize: 11,
    attributionLogo: true,
  },
  grid: { vertLines: { color: '#191d23' }, horzLines: { color: '#191d23' } },
  rightPriceScale: { borderColor: '#242a32' },
  timeScale: { borderColor: '#242a32', timeVisible: true, secondsVisible: false, rightOffset: 5 },
  crosshair: { vertLine: { color: '#606975' }, horzLine: { color: '#606975' } },
};
export function PriceChart({
  candles,
  live,
  tick,
  label,
}: {
  candles: Candle[];
  live?: Candle | null;
  tick?: number | null;
  label: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<{
    chart: IChartApi;
    series: ISeriesApi<'Candlestick'>;
    volume: ISeriesApi<'Histogram'>;
    lastTime: number;
  }>(null);
  const [hover, setHover] = useState<Candle | null>(null);
  const initial = useRef(true);
  const referencePrice = candles.at(-1)?.close || 1;
  const chartTick = tick || 10 ** (Math.floor(Math.log10(Math.abs(referencePrice))) - 4);
  useEffect(() => {
    if (!host.current) return;
    const chart = createChart(host.current, { ...chartOptions, autoSize: true });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#65b99c',
      downColor: '#d57c83',
      borderVisible: false,
      wickUpColor: '#65b99c',
      wickDownColor: '#d57c83',
      priceFormat: { type: 'custom', formatter: (n: number) => price(n, tick), minMove: chartTick },
    });
    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
      lastValueVisible: false,
      priceLineVisible: false,
    });
    series.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.22 } });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
    chart.subscribeCrosshairMove((event) => {
      const c = event.seriesData.get(series);
      if (c && 'close' in c) setHover(c as unknown as Candle);
      else setHover(null);
    });
    api.current = { chart, series, volume, lastTime: 0 };
    initial.current = true;
    return () => {
      api.current = null;
      chart.remove();
    };
  }, [label, tick]);
  useEffect(() => {
    const c = api.current;
    if (!c || !candles.length) return;
    const unique = [
      ...new Map(
        candles
          .filter((x) => [x.time, x.open, x.high, x.low, x.close, x.volume].every(Number.isFinite))
          .map((x) => [x.time, x]),
      ).values(),
    ].sort((a, b) => a.time - b.time);
    c.series.setData(unique.map((x) => ({ ...x, time: x.time as UTCTimestamp })));
    c.volume.setData(
      unique.map((x) => ({
        time: x.time as UTCTimestamp,
        value: x.volume,
        color: x.close >= x.open ? '#244239' : '#442b32',
      })),
    );
    c.lastTime = unique.at(-1)?.time || 0;
    if (initial.current) {
      c.chart.timeScale().fitContent();
      initial.current = false;
    }
  }, [candles, label, tick]);
  useEffect(() => {
    const c = api.current;
    if (!c || !live || live.time < c.lastTime || initial.current) return;
    c.series.update({ ...live, time: live.time as UTCTimestamp });
    c.volume.update({
      time: live.time as UTCTimestamp,
      value: live.volume,
      color: live.close >= live.open ? '#244239' : '#442b32',
    });
    c.lastTime = live.time;
  }, [live]);
  const last = hover || live || candles.at(-1);
  return (
    <div className="price-chart-wrap">
      <div className="ohlc mono">
        {last ? (
          <>
            <span>
              O <b>{price(last.open, tick)}</b>
            </span>
            <span>
              H <b>{price(last.high, tick)}</b>
            </span>
            <span>
              L <b>{price(last.low, tick)}</b>
            </span>
            <span>
              C <b>{price(last.close, tick)}</b>
            </span>
          </>
        ) : (
          'Waiting for candles'
        )}
      </div>
      <div
        ref={host}
        className="price-chart"
        role="img"
        aria-label={`${label} candlestick price chart. Drag to pan; scroll to zoom.`}
      />
    </div>
  );
}

export function LineChart({
  points,
  color = '#d9ad70',
  formatter = (n: number) => compact(n),
  height = 140,
}: {
  points: FlowPoint[];
  color?: string;
  formatter?: (n: number) => string;
  height?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<{ chart: IChartApi; series: ISeriesApi<'Line'> }>(null);
  const fitted = useRef(false);
  const formatRef = useRef(formatter);
  formatRef.current = formatter;
  useEffect(() => {
    if (!host.current) return;
    const chart = createChart(host.current, {
      ...chartOptions,
      autoSize: true,
      timeScale: { ...chartOptions.timeScale, secondsVisible: true },
    });
    const series = chart.addSeries(LineSeries, {
      color,
      lineWidth: 2,
      priceFormat: { type: 'custom', formatter: (n: number) => formatRef.current(n) },
      priceLineVisible: false,
      lastValueVisible: true,
    });
    api.current = { chart, series };
    fitted.current = false;
    return () => {
      api.current = null;
      chart.remove();
    };
  }, []);
  useEffect(() => {
    api.current?.series.applyOptions({ color });
  }, [color]);
  useEffect(() => {
    if (!api.current) return;
    const rows = [
      ...new Map(
        points.filter((x) => Number.isFinite(x.time) && Number.isFinite(x.value)).map((x) => [x.time, x]),
      ).values(),
    ].sort((a, b) => a.time - b.time);
    api.current.series.setData(rows.map((x) => ({ ...x, time: x.time as UTCTimestamp })));
    if (!fitted.current && rows.length) {
      api.current.chart.timeScale().fitContent();
      fitted.current = true;
    }
  }, [points]);
  return (
    <div className="line-chart" ref={host} style={{ height }} role="img" aria-label="Time series chart" />
  );
}

export interface CoinGlassHeat {
  y_axis: number[];
  liquidation_leverage_data: number[][];
  price_candlesticks: number[][];
}
export function Heatmap({ samples = [], model }: { samples?: HeatSample[]; model?: CoinGlassHeat }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState('');
  const bounds = useRef({ low: 0, high: 1, width: 1, height: 1 });
  useEffect(() => {
    const node = canvas.current;
    if (!node) return;
    const draw = () => {
      const rect = node.getBoundingClientRect(),
        width = rect.width,
        height = rect.height;
      node.width = Math.round(width * devicePixelRatio);
      node.height = Math.round(height * devicePixelRatio);
      const ctx = node.getContext('2d');
      if (!ctx) return;
      ctx.scale(devicePixelRatio, devicePixelRatio);
      ctx.fillStyle = '#0d1014';
      ctx.fillRect(0, 0, width, height);
      const plot = width - 85;
      const allPrices = model
        ? model.y_axis
        : samples.flatMap((s) => [...s.bids, ...s.asks].map((l) => l.price));
      if (!allPrices.length) return;
      const low = allPrices.reduce((a, p) => Math.min(a, p), Infinity),
        high = allPrices.reduce((a, p) => Math.max(a, p), -Infinity);
      if (high <= low) return;
      bounds.current = { low, high, width: plot, height };
      const y = (p: number) => height - ((p - low) / (high - low)) * (height - 20) - 10;
      if (model) {
        const columns = model.liquidation_leverage_data.reduce(
          (a, d) => Math.max(a, d[0] + 1),
          Math.max(model.price_candlesticks.length, 1),
        );
        const max = model.liquidation_leverage_data.reduce((a, d) => Math.max(a, d[2]), 1);
        for (const [x, row, value] of model.liquidation_leverage_data) {
          if (![x, row, value, model.y_axis[row]].every(Number.isFinite) || value < 0) continue;
          const intensity = Math.log1p(value) / Math.log1p(max);
          ctx.fillStyle = `rgba(218, 173, 103, ${intensity * 0.9})`;
          ctx.fillRect(
            (x / columns) * plot,
            y(model.y_axis[row]),
            Math.max(1, plot / columns + 1),
            Math.max(1, height / model.y_axis.length + 1),
          );
        }
      } else {
        const max = Math.max(
          ...samples.flatMap((s) => [...s.bids, ...s.asks].map((l) => l.price * l.size)),
          1,
        );
        const colWidth = plot / Math.max(samples.length, 60);
        for (let i = 0; i < samples.length; i++) {
          const sample = samples[i];
          for (const [levels, rgb] of [
            [sample.bids, '72, 151, 137'],
            [sample.asks, '211, 163, 98'],
          ] as const) {
            for (const l of levels) {
              const intensity = Math.pow(Math.log1p(l.price * l.size) / Math.log1p(max), 3);
              ctx.fillStyle = `rgba(${rgb}, ${intensity * 0.85})`;
              ctx.fillRect(i * colWidth, y(l.price) - 1.5, colWidth + 0.5, 3);
            }
          }
        }
        ctx.strokeStyle = '#c9d1da';
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        samples.forEach((s, i) => {
          const mid = (s.bids[0]?.price + s.asks[0]?.price) / 2;
          if (!Number.isFinite(mid)) return;
          if (i === 0) ctx.moveTo(i * colWidth, y(mid));
          else ctx.lineTo(i * colWidth, y(mid));
        });
        ctx.stroke();
      }
      ctx.font = '11px Consolas, monospace';
      ctx.fillStyle = '#929ba5';
      for (let i = 0; i <= 4; i++) {
        const p = low + ((high - low) * i) / 4;
        ctx.fillText(price(p), plot + 10, Math.max(13, Math.min(height - 5, y(p) + 4)));
      }
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(node);
    return () => observer.disconnect();
  }, [samples, model]);
  return (
    <div className="heatmap-wrap">
      <canvas
        ref={canvas}
        className="heatmap"
        role="img"
        aria-label={
          model
            ? 'CoinGlass modelled liquidation-level heatmap'
            : 'Observed resting order-book liquidity over time; white line is midpoint'
        }
        onMouseLeave={() => setHover('')}
        onMouseMove={(e) => {
          const b = bounds.current,
            rect = e.currentTarget.getBoundingClientRect();
          const p = b.high - ((e.clientY - rect.top) / b.height) * (b.high - b.low);
          const sample =
            samples[
              Math.min(
                samples.length - 1,
                Math.floor((e.clientX - rect.left) / (b.width / Math.max(samples.length, 60))),
              )
            ];
          setHover(`${sample ? time(sample.time * 1000, true) + ' · ' : ''}${price(p)}`);
        }}
      />
      {hover && <span className="heat-tooltip mono">{hover}</span>}
      {!samples.length && !model && (
        <div className="canvas-empty">
          Collecting order-book observations<span>History builds while this market is open.</span>
        </div>
      )}
    </div>
  );
}
