import { priceOf, type Coupon, type Product } from "@/data/catalog";
export interface CartItem {
  product: Product;
  quantity: number;
}
export const normalizeCode = (code: string) => code.toUpperCase().replace(/\s/g, "");
export function calculateCoupon(
  items: CartItem[],
  coupon: Coupon | undefined,
  today = new Date().toISOString().slice(0, 10),
) {
  const subtotal = items.reduce((s, i) => s + priceOf(i.product) * i.quantity, 0);
  if (!coupon)
    return { subtotal, discount: 0, total: subtotal, error: "Cupom não encontrado.", mixed: false };
  const eligible = items
    .filter((i) => coupon.allow_on_sale || !i.product.is_on_sale)
    .reduce((s, i) => s + priceOf(i.product) * i.quantity, 0);
  let error = "";
  if (!coupon.active) error = "Este cupom não está ativo.";
  else if (coupon.expires_at && coupon.expires_at < today) error = "Este cupom expirou.";
  else if (eligible === 0) error = "Este cupom não se aplica a peças que já estão em promoção.";
  else if (eligible < coupon.min_order_value)
    error = `O valor dos itens elegíveis precisa atingir R$ ${coupon.min_order_value.toFixed(2).replace(".", ",")}.`;
  const discount = error
    ? 0
    : Math.min(
        eligible,
        coupon.type === "percent" ? (eligible * coupon.value) / 100 : coupon.value,
      );
  return {
    subtotal,
    discount: Math.round(discount * 100) / 100,
    total: Math.round((subtotal - discount) * 100) / 100,
    error,
    mixed: !coupon.allow_on_sale && eligible < subtotal && eligible > 0,
  };
}
