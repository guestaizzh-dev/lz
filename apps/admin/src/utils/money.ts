export function moneyText(value: string | undefined) {
  if (value === undefined) return '—';
  const amount = BigInt(value),
    absolute = amount < 0n ? -amount : amount;
  const yuan = String(absolute / 100n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (amount < 0n ? '-' : '') + '¥' + yuan + '.' + String(absolute % 100n).padStart(2, '0');
}
