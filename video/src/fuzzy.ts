// Filters a suggestion list like VS Code's suggest widget: the first typed
// character must match the start of the label, the rest in order; contiguous
// matches rank first, then by label.
export function fuzzy<T extends { label: string }>(items: T[], filter: string): T[] {
  if (!filter) return items;
  const f = filter.toLowerCase();
  const scored: { item: T; gaps: number; prefix: boolean }[] = [];
  for (const item of items) {
    const label = item.label.toLowerCase();
    if (label[0] !== f[0]) continue;
    let pos = 0;
    let gaps = 0;
    let ok = true;
    for (let i = 1; i < f.length; i++) {
      const next = label.indexOf(f[i], pos + 1);
      if (next < 0) {
        ok = false;
        break;
      }
      gaps += next - pos - 1;
      pos = next;
    }
    if (ok) scored.push({ item, gaps, prefix: label.startsWith(f) });
  }
  return scored
    .sort((a, b) => Number(b.prefix) - Number(a.prefix) || a.gaps - b.gaps || a.item.label.localeCompare(b.item.label))
    .map((s) => s.item);
}
