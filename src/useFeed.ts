import { useEffect, useRef, useState } from 'react';
import { FlowEngine, type FlowSnapshot } from '../shared/flow';
import type { Candle, Category, Exchange } from './types';

export function useFeed(
  exchange: Exchange,
  symbol: string,
  category: Category,
  interval: string,
  initialPrice: number,
  tick: number | null,
) {
  const socket = useRef<WebSocket | null>(null);
  const chartInterval = useRef(interval);
  chartInterval.current = interval;
  const [flow, setFlow] = useState<FlowSnapshot>(() => new FlowEngine(1).snapshot());
  const [status, setStatus] = useState('connecting');
  const [message, setMessage] = useState('');
  const [quality, setQuality] = useState('');
  const [ticker, setTicker] = useState<Record<string, string>>({});
  const [candle, setCandle] = useState<Candle | null>(null);
  useEffect(() => {
    const bin = Math.max(tick || 0, initialPrice * 0.0002 || 0.01);
    let engine = new FlowEngine(bin),
      ws: WebSocket,
      active = true,
      received = Date.now(),
      connectionStatus = 'connecting';
    let retry: ReturnType<typeof setTimeout>,
      backoff = 1000;
    setFlow(engine.snapshot());
    setTicker({});
    setCandle(null);
    setMessage('');
    setQuality('');
    const connect = () => {
      if (!active) return;
      connectionStatus = 'connecting';
      setStatus('connecting');
      ws = new WebSocket(
        `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/stream?exchange=${exchange}&symbol=${symbol}&category=${category}&interval=${chartInterval.current}`,
      );
      socket.current = ws;
      ws.onopen = () => ws.send(JSON.stringify({ event: 'interval', interval: chartInterval.current }));
      ws.onmessage = (event) => {
        if (!active) return;
        try {
          const m = JSON.parse(event.data);
          if (m.event === 'quality') setQuality(m.message || '');
          if (m.event === 'status') {
            connectionStatus = m.status;
            setStatus(m.status);
            setMessage(m.message || '');
          }
          if (m.event === 'session') {
            engine = new FlowEngine(bin, m.startedAt);
            setFlow(engine.snapshot());
            setCandle(null);
            setTicker({});
            received = Date.now();
            backoff = 1000;
          }
          if (!m.topic) return;
          received = Date.now();
          if (m.topic.startsWith('orderbook.')) engine.book.apply(m.type, m.data, Number(m.ts));
          if (m.topic.startsWith('publicTrade.'))
            for (const t of m.data)
              engine.addTrade({
                id: t.i,
                side: t.S,
                price: Number(t.p),
                size: Number(t.v),
                time: Number(t.T),
              });
          if (m.topic.startsWith('tickers.')) setTicker((previous) => ({ ...previous, ...m.data }));
          if (m.topic.startsWith('kline.'))
            for (const c of m.data)
              setCandle({
                time: c.start / 1000,
                open: Number(c.open),
                high: Number(c.high),
                low: Number(c.low),
                close: Number(c.close),
                volume: Number(c.volume),
              });
          if (m.topic.startsWith('allLiquidation.'))
            for (const t of m.data) {
              engine.addLiquidation({
                id: `${t.T}:${t.S}:${t.p}:${t.v}`,
                position: t.S === 'Buy' ? 'Long' : 'Short',
                price: Number(t.p),
                value: Number(t.p) * Number(t.v),
                time: Number(t.T),
              });
            }
        } catch {
          setMessage('An unreadable feed update was skipped.');
        }
      };
      ws.onclose = () => {
        if (!active) return;
        connectionStatus = 'reconnecting';
        setStatus('reconnecting');
        retry = setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 30_000);
      };
      ws.onerror = () => {
        if (active) setMessage('The local feed is unavailable. Reconnecting…');
      };
    };
    connect();
    const flush = setInterval(() => {
      setFlow(engine.snapshot());
      if (connectionStatus === 'live') setStatus(Date.now() - received > 15_000 ? 'stale' : 'live');
    }, 250);
    return () => {
      active = false;
      clearInterval(flush);
      clearTimeout(retry);
      ws?.close();
      socket.current = null;
    };
    // Price/tick changes must not reset a collecting session.
  }, [exchange, symbol, category]);
  useEffect(() => {
    setCandle(null);
    if (socket.current?.readyState === WebSocket.OPEN)
      socket.current.send(JSON.stringify({ event: 'interval', interval }));
  }, [interval]);
  return { flow, status, message: [message, quality].filter(Boolean).join(' '), ticker, candle };
}
