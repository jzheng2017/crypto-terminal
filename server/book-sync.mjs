const crcTable = Array.from({ length: 256 }, (_, index) => {
  let c = index;
  for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(text) {
  let crc = 0xffffffff;
  for (const byte of new TextEncoder().encode(text)) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
export class BookSync {
  bids = new Map();
  asks = new Map();
  id = 0;
  ready = false;
  bridged = false;
  updateSide(side, rows) {
    for (const [p, qty] of rows || []) {
      const price = Number(p),
        size = Number(qty);
      if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(size) || size < 0)
        throw new Error('Invalid depth level');
      if (!size) side.delete(price);
      else side.set(price, { p, qty });
    }
    if (side.size > 50_000) throw new Error('Depth buffer limit');
  }
  snapshot(bids, asks, id) {
    this.bids.clear();
    this.asks.clear();
    this.updateSide(this.bids, bids);
    this.updateSide(this.asks, asks);
    this.id = Number(id);
    this.ready = true;
    this.bridged = false;
  }
  binance(event, futures) {
    if (!this.ready) throw new Error('Snapshot required');
    if (futures ? event.u < this.id : event.u <= this.id) return false;
    if (!this.bridged) {
      const target = futures ? this.id : this.id + 1;
      if (event.U > target || event.u < target) throw new Error('Depth snapshot does not bridge stream');
    } else if (futures ? event.pu !== this.id : event.U > this.id + 1) throw new Error('Depth sequence gap');
    this.updateSide(this.bids, event.b);
    this.updateSide(this.asks, event.a);
    this.id = event.u;
    this.bridged = true;
    return true;
  }
  okx(action, data) {
    if (action === 'snapshot') this.snapshot(data.bids, data.asks, data.seqId);
    else {
      if (!this.ready || Number(data.prevSeqId) !== this.id) throw new Error('OKX depth sequence gap');
      this.updateSide(this.bids, data.bids);
      this.updateSide(this.asks, data.asks);
      this.id = Number(data.seqId);
    }
    // OKX's current books feed keeps the deprecated checksum field fixed at 0.
    // Continuity is always verified with prevSeqId; nonzero legacy checksums
    // are additionally checked when supplied by older datasets.
    if (data.checksum !== undefined && Number(data.checksum) !== 0) {
      const b = [...this.bids].sort((a, b) => b[0] - a[0]).slice(0, 25),
        a = [...this.asks].sort((a, b) => a[0] - b[0]).slice(0, 25),
        fields = [];
      for (let i = 0; i < Math.max(b.length, a.length); i++) {
        if (b[i]) fields.push(b[i][1].p, b[i][1].qty);
        if (a[i]) fields.push(a[i][1].p, a[i][1].qty);
      }
      if ((crc32(fields.join(':')) | 0) !== Number(data.checksum))
        throw new Error('OKX depth checksum mismatch');
    }
  }
  levels(multiplier = 1) {
    return {
      b: [...this.bids]
        .sort((a, b) => b[0] - a[0])
        .slice(0, 50)
        .map(([p, q]) => [q.p, String(Number(q.qty) * multiplier)]),
      a: [...this.asks]
        .sort((a, b) => a[0] - b[0])
        .slice(0, 50)
        .map(([p, q]) => [q.p, String(Number(q.qty) * multiplier)]),
      u: this.id,
      seq: this.id,
    };
  }
}
