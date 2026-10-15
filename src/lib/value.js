// Production value of one logged entry.
// Products are priced per unit (quantity x price), per kg (weight x price)
// or per set (quantity / pieces-in-a-set x price).
export const isKg = (p) => p?.pricing_unit === 'kg';
export const isSet = (p) => p?.pricing_unit === 'set';
export const setSize = (p) => Math.max(Number(p?.set_size) || 1, 1);
export const entryValue = (qty, weight, p) => {
  const price = Number(p?.selling_price || 0);
  if (isKg(p)) return Number(weight || 0) * price;
  if (isSet(p)) return (Number(qty || 0) / setSize(p)) * price;
  return Number(qty || 0) * price;
};
export const priceLabel = (p) => (isKg(p) ? '/kg' : isSet(p) ? `/set of ${setSize(p)}` : '/unit');
