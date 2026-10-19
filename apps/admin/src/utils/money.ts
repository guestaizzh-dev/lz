export function moneyText(value: string | undefined) {
  if(value===undefined)return '—';
  const amount=BigInt(value),absolute=amount<0n?-amount:amount;
  return (amount<0n?'-':'')+'¥'+String(absolute/100n)+'.'+String(absolute%100n).padStart(2,'0');
}
