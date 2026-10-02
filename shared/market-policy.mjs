// USDT suffixes alone do not distinguish crypto from TradFi contracts.
export function cryptoInstrument(instrument, exchange) {
  if (exchange === 'binance') return instrument.underlyingType === 'COIN';
  if (exchange === 'bybit') {
    const type = String(instrument.symbolType || '').toLowerCase();
    return type === '' || type === 'innovation';
  }
  const type = String(instrument.underlyingType || instrument.symbolType || '').toLowerCase();
  return ![
    'stock',
    'equity',
    'cn_equity',
    'hk_equity',
    'kr_equity',
    'etf',
    'forex',
    'fx',
    'commodity',
    'bond',
    'index',
  ].includes(type);
}
