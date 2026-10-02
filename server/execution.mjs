import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { DataError, cached } from './providers.mjs';
import { cryptoInstrument } from '../shared/market-policy.mjs';

export function executionStatus() {
  const configured = Boolean(process.env.BYBIT_API_KEY && process.env.BYBIT_API_SECRET);
  const network = process.env.BYBIT_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';
  const enabled =
    configured &&
    process.env.BYBIT_TRADING_ENABLED === 'true' &&
    (network === 'testnet' || process.env.BYBIT_ALLOW_MAINNET === 'true');
  const cap = Number(process.env.MAX_ORDER_NOTIONAL_USDT || 1000);
  return { configured, network, enabled, maxNotional: Number.isFinite(cap) && cap > 0 ? cap : 1000 };
}
export function signedHeaders(method, payload, key, secret, timestamp = Date.now()) {
  const serialized = method === 'GET' ? new URLSearchParams(payload).toString() : JSON.stringify(payload);
  const recvWindow = '5000';
  return {
    serialized,
    headers: {
      'X-BAPI-API-KEY': key,
      'X-BAPI-TIMESTAMP': String(timestamp),
      'X-BAPI-RECV-WINDOW': recvWindow,
      'X-BAPI-SIGN': createHmac('sha256', secret)
        .update(`${timestamp}${key}${recvWindow}${serialized}`)
        .digest('hex'),
      'Content-Type': 'application/json',
    },
  };
}
const executionBase = () =>
  executionStatus().network === 'testnet' ? 'https://api-testnet.bybit.com' : 'https://api.bybit.com';
export async function exchangeRequest(method, path, payload, authenticated = true) {
  if (authenticated && !executionStatus().configured)
    throw new DataError('Configure Bybit credentials in .env to connect an account.', 428);
  const auth = authenticated
    ? signedHeaders(method, payload, process.env.BYBIT_API_KEY, process.env.BYBIT_API_SECRET)
    : {
        serialized: method === 'GET' ? new URLSearchParams(payload).toString() : JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      };
  let response;
  try {
    response = await fetch(`${executionBase()}${path}${method === 'GET' ? '?' + auth.serialized : ''}`, {
      method,
      headers: auth.headers,
      ...(method === 'GET' ? {} : { body: auth.serialized }),
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new DataError(
      method === 'POST'
        ? 'Submission status is unknown. Reconcile exchange orders before submitting another order; retain the same client order ID.'
        : 'The exchange account service is unavailable.',
    );
  }
  if (!response.ok)
    throw new DataError(
      method === 'POST'
        ? `Exchange returned HTTP ${response.status}. Reconcile orders before retrying.`
        : `Exchange returned HTTP ${response.status}.`,
    );
  let r;
  try {
    r = await response.json();
  } catch {
    throw new DataError(
      method === 'POST'
        ? 'Submission response is unreadable. Reconcile orders before retrying.'
        : 'Exchange response is unreadable.',
    );
  }
  if (r.retCode !== 0) throw new DataError(`Bybit (${r.retCode}): ${r.retMsg || 'request rejected'}`, 422);
  return r.result;
}
export const orderSchema = z.object({
  category: z.enum(['linear', 'spot']),
  symbol: z.string().regex(/^[A-Z0-9]{2,30}$/),
  side: z.enum(['Buy', 'Sell']),
  orderType: z.enum(['Market', 'Limit']),
  qty: z
    .string()
    .regex(/^\d+(\.\d{1,16})?$/)
    .max(40),
  price: z
    .string()
    .regex(/^\d+(\.\d{1,16})?$/)
    .max(40)
    .optional(),
  timeInForce: z.enum(['GTC', 'IOC', 'FOK', 'PostOnly']).default('GTC'),
  reduceOnly: z.boolean().default(false),
  triggerPrice: z
    .string()
    .regex(/^\d+(\.\d{1,16})?$/)
    .max(40)
    .optional(),
  triggerDirection: z.union([z.literal(1), z.literal(2)]).optional(),
  positionIdx: z.union([z.literal(0), z.literal(1), z.literal(2)]).default(0),
  orderLinkId: z.string().regex(/^tp_[a-f0-9]{32}$/),
});
export function multipleOf(value, step) {
  const parts = (raw) => {
    const match = /^(\d+)(?:\.(\d+))?$/.exec(String(raw));
    return match ? { integer: BigInt(match[1] + (match[2] || '')), scale: (match[2] || '').length } : null;
  };
  const v = parts(value),
    s = parts(step);
  if (!v || !s || s.integer === 0n) return false;
  const scale = Math.max(v.scale, s.scale);
  return (v.integer * 10n ** BigInt(scale - v.scale)) % (s.integer * 10n ** BigInt(scale - s.scale)) === 0n;
}
export function validateOrder(input, instrument, quote, maxNotional) {
  const order = orderSchema.parse(input),
    qty = Number(order.qty);
  if (qty <= 0) throw new DataError('Quantity must be positive.', 400);
  if (
    !cryptoInstrument(instrument, 'bybit') ||
    instrument.quoteCoin !== 'USDT' ||
    instrument.status !== 'Trading' ||
    (order.category === 'linear' && instrument.contractType !== 'LinearPerpetual')
  )
    throw new DataError('Only actively trading crypto USDT spot and perpetual markets are supported.', 400);
  const lot = instrument.lotSizeFilter,
    step = lot.qtyStep || lot.basePrecision;
  if (!multipleOf(order.qty, step)) throw new DataError(`Quantity must be a multiple of ${step}.`, 400);
  if (
    qty < Number(lot.minOrderQty || 0) ||
    qty >
      Number(
        order.orderType === 'Market'
          ? lot.maxMktOrderQty || lot.maxMarketOrderQty || lot.maxOrderQty
          : lot.maxOrderQty || lot.maxLimitOrderQty,
      )
  )
    throw new DataError('Quantity is outside the exchange instrument limits.', 400);
  if (
    order.orderType === 'Limit' &&
    (!order.price || Number(order.price) <= 0 || !multipleOf(order.price, instrument.priceFilter.tickSize))
  )
    throw new DataError(
      `Limit price must be positive and a multiple of ${instrument.priceFilter.tickSize}.`,
      400,
    );
  if (
    order.orderType === 'Limit' &&
    (Number(order.price) < Number(instrument.priceFilter.minPrice || 0) ||
      Number(order.price) > Number(instrument.priceFilter.maxPrice || Infinity))
  )
    throw new DataError('Limit price is outside the exchange instrument limits.', 400);
  const reference =
    order.orderType === 'Limit'
      ? Number(order.price)
      : order.side === 'Buy'
        ? Number(quote.a[0]?.[0])
        : Number(quote.b[0]?.[0]);
  const current = order.side === 'Buy' ? Number(quote.a[0]?.[0]) : Number(quote.b[0]?.[0]);
  if (!Number.isFinite(current) || current <= 0 || Date.now() - Number(quote.ts) > 5000)
    throw new DataError('Fresh execution-network quotes are required.', 409);
  if (
    qty *
      Math.max(reference, current, Number(order.triggerPrice || 0)) *
      (order.orderType === 'Market' ? 1.005 : 1) >
    maxNotional
  )
    throw new DataError(`Order exceeds the configured ${maxNotional} USDT submission-notional cap.`, 400);
  if (qty * reference < Number(lot.minNotionalValue || lot.minOrderAmt || 0))
    throw new DataError('Order is below the exchange minimum notional.', 400);
  if (order.category === 'spot' && (order.reduceOnly || order.triggerPrice))
    throw new DataError(
      'Reduce-only and conditional orders are supported for perpetuals in this adapter.',
      400,
    );
  if (order.triggerPrice) {
    if (
      !order.triggerDirection ||
      Number(order.triggerPrice) <= 0 ||
      !multipleOf(order.triggerPrice, instrument.priceFilter.tickSize)
    )
      throw new DataError('Set a valid conditional trigger price and direction.', 400);
    if (
      (order.triggerDirection === 1 && Number(order.triggerPrice) <= current) ||
      (order.triggerDirection === 2 && Number(order.triggerPrice) >= current)
    )
      throw new DataError(
        'Trigger direction must match the trigger price relative to the current market.',
        400,
      );
  }
  const result = {
    category: order.category,
    symbol: order.symbol,
    side: order.side,
    orderType: order.orderType,
    qty: order.qty,
    orderLinkId: order.orderLinkId,
  };
  if (order.category === 'linear')
    Object.assign(result, { reduceOnly: order.reduceOnly, positionIdx: order.positionIdx });
  if (order.category === 'spot') result.marketUnit = 'baseCoin';
  if (order.orderType === 'Limit')
    Object.assign(result, { price: order.price, timeInForce: order.timeInForce });
  else if (!order.triggerPrice)
    Object.assign(result, { slippageToleranceType: 'Percent', slippageTolerance: '0.50' });
  if (order.triggerPrice)
    Object.assign(result, {
      triggerPrice: order.triggerPrice,
      triggerDirection: order.triggerDirection,
      triggerBy: 'LastPrice',
      ...(order.reduceOnly ? { closeOnTrigger: true } : {}),
    });
  return result;
}
export async function executionQuote(category, symbol) {
  return cached(
    `execution-quote:${executionStatus().network}:${category}:${symbol}`,
    1000,
    async () => {
      const [book, info] = await Promise.all([
        exchangeRequest('GET', '/v5/market/orderbook', { category, symbol, limit: '50' }, false),
        exchangeRequest('GET', '/v5/market/instruments-info', { category, symbol }, false),
      ]);
      if (!info.list?.[0])
        throw new DataError('This instrument is not available on the execution network.', 422);
      return { book, instrument: info.list[0], network: executionStatus().network };
    },
    0,
  );
}
export async function placeOrder(input) {
  const status = executionStatus();
  if (!status.enabled)
    throw new DataError(
      'Exchange trading is disabled. Configure the account and explicitly enable trading.',
      403,
    );
  const order = orderSchema.parse(input);
  const { data } = await executionQuote(order.category, order.symbol);
  return exchangeRequest(
    'POST',
    '/v5/order/create',
    validateOrder(order, data.instrument, data.book, status.maxNotional),
  );
}
export async function cancelOrder(input) {
  if (!executionStatus().enabled) throw new DataError('Exchange trading is disabled.', 403);
  const order = z
    .object({
      category: z.enum(['spot', 'linear']),
      symbol: z.string().regex(/^[A-Z0-9]{2,30}$/),
      orderId: z.string().regex(/^[a-zA-Z0-9-]{1,100}$/),
    })
    .parse(input);
  return exchangeRequest('POST', '/v5/order/cancel', order);
}
export async function accountSnapshot(category) {
  const [wallet, positions, orders, executions] = await Promise.all([
    exchangeRequest('GET', '/v5/account/wallet-balance', { accountType: 'UNIFIED' }),
    category === 'linear'
      ? exchangeRequest('GET', '/v5/position/list', { category, settleCoin: 'USDT', limit: '200' })
      : Promise.resolve({ list: [] }),
    exchangeRequest('GET', '/v5/order/realtime', {
      category,
      ...(category === 'linear' ? { settleCoin: 'USDT' } : {}),
      openOnly: '0',
      limit: '50',
    }),
    exchangeRequest('GET', '/v5/execution/list', { category, limit: '50' }),
  ]);
  return {
    network: executionStatus().network,
    wallet: wallet.list,
    positions: positions.list.filter((p) => Number(p.size) > 0),
    orders: orders.list,
    executions: executions.list,
    cursors: {
      positions: positions.nextPageCursor || null,
      orders: orders.nextPageCursor || null,
      executions: executions.nextPageCursor || null,
    },
  };
}
