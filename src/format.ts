export function price(n: number | null | undefined, tick?: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n === 0) return '0';
  if (Math.abs(n) < 1e-14) return n.toExponential(4);
  const [mantissa, exponent] = tick && tick > 0 ? String(tick).toLowerCase().split('e') : ['', '0'];
  const tickDigits = (mantissa.split('.')[1]?.length || 0) - Number(exponent || 0);
  const digits =
    tick && tick > 0
      ? Math.max(0, Math.min(16, tickDigits))
      : Math.max(2, Math.min(16, 4 - Math.floor(Math.log10(Math.abs(n)))));
  return n.toLocaleString('en-US', {
    minimumFractionDigits: Math.min(digits, 2),
    maximumFractionDigits: digits,
  });
}
export function compact(n: number | null | undefined, currency = false): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const prefix = currency ? '$' : '';
  const a = Math.abs(n);
  if (a > 0 && a < 1) return prefix + price(n);
  const unit =
    a >= 1e12 ? [1e12, 'T'] : a >= 1e9 ? [1e9, 'B'] : a >= 1e6 ? [1e6, 'M'] : a >= 1e3 ? [1e3, 'K'] : [1, ''];
  return prefix + (n / Number(unit[0])).toLocaleString('en-US', { maximumFractionDigits: 2 }) + unit[1];
}
export function percent(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n > 0 ? '+' : ''}${n.toFixed(digits)}%`;
}
export function time(n: number, seconds = false): string {
  return new Date(n).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {}),
  });
}
export function age(n: number | null): string {
  if (!n) return 'Unknown';
  const seconds = Math.max(0, (Date.now() - n) / 1000);
  if (seconds < 60) return '<1m';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}
export const shortened = (s: string) => (s.length > 16 ? `${s.slice(0, 7)}…${s.slice(-5)}` : s);
