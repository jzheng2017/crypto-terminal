// Distinguish a verified overlap from a missing portion of a capped history.
export function tradeWindow(rows, previousId) {
  const ordered = [
    ...new Map(
      rows
        .filter(
          (t) =>
            t.id &&
            Number.isFinite(t.timestamp) &&
            t.price > 0 &&
            t.amount > 0 &&
            ['buy', 'sell'].includes(t.side),
        )
        .map((t) => [String(t.id), t]),
    ).values(),
  ].sort((a, b) => a.timestamp - b.timestamp);
  const index = previousId == null ? -1 : ordered.findIndex((t) => String(t.id) === previousId);
  return {
    fresh: index >= 0 ? ordered.slice(index + 1) : ordered,
    gap: previousId != null && ordered.length > 0 && index < 0,
    latestId: ordered.length ? String(ordered.at(-1).id) : previousId,
  };
}
