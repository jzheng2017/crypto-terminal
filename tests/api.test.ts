import { beforeAll, afterAll, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
let child: ChildProcess, base: string;
beforeAll(async () => {
  child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: '0', BYBIT_API_KEY: '', BYBIT_API_SECRET: '', COINGLASS_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  base = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Test service did not start')), 15_000);
    child.stdout!.on('data', (buffer) => {
      const url = /http:\/\/127\.0\.0\.1:\d+/.exec(buffer.toString());
      if (url) {
        clearTimeout(timeout);
        resolve(url[0]);
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timeout);
      if (code) reject(new Error('Test service exited'));
    });
  });
}, 20_000);
afterAll(() => child?.kill());
it('exposes twelve venue adapters and keeps order routing disabled without credentials', async () => {
  const venues = await (await fetch(base + '/api/venues')).json();
  expect(venues.data).toHaveLength(12);
  const status = await (await fetch(base + '/api/execution/status')).json();
  expect(status.data.configured).toBe(false);
  expect(status.data.enabled).toBe(false);
});
it('rejects invalid provider symbols and unsupported exchange IDs before making network requests', async () => {
  expect((await fetch(base + '/api/candles?symbol=BTC/USDT')).status).toBe(400);
  expect((await fetch(base + '/api/markets?exchange=unknown')).status).toBe(400);
});
it('rejects cross-origin local-account access and implicit order submissions', async () => {
  expect(
    (await fetch(base + '/api/execution/status', { headers: { Origin: 'https://unrelated.example' } }))
      .status,
  ).toBe(403);
  expect(
    (
      await fetch(base + '/api/execution/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
    ).status,
  ).toBe(403);
  const explicit = await fetch(base + '/api/execution/order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Tape-Action': 'explicit' },
    body: '{}',
  });
  expect(explicit.status).toBe(403);
  expect((await explicit.json()).error).toContain('disabled');
});
it('clearly reports unavailable historical credentials instead of generating sample market data', async () => {
  const result = await fetch(base + '/api/coinglass?kind=cvd');
  expect(result.status).toBe(428);
  expect((await result.json()).error).toContain('COINGLASS_API_KEY');
});
it('reloads an empty saved-pool list without a discovery-feed dependency', async () => {
  const response = await fetch(base + '/api/dex/saved?ids=');
  expect(response.status).toBe(200);
  expect((await response.json()).data).toEqual([]);
  expect((await fetch(base + '/api/dex/saved?ids=ethereum:invalid')).status).toBe(400);
});
it('validates alert venue identities and returns empty quote coverage for an empty alert list', async () => {
  expect((await fetch(base + '/api/alert-quotes?ids=unknown:spot:BTCUSDT')).status).toBe(400);
  const response = await fetch(base + '/api/alert-quotes?ids=');
  expect((await response.json()).data).toEqual([]);
});
