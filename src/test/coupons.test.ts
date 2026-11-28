import { describe, expect, it } from "vitest";
import { initialData, type Product } from "@/data/catalog";
import { calculateCoupon, getCartItemKey, normalizeCode } from "@/services/couponService";
const base = initialData.products[0];
if (!base) throw new Error("Missing sample");
const normal: Product = { ...base, price: 100, is_on_sale: false };
const sale: Product = { ...base, id: "sale", price: 100, sale_price: 80, is_on_sale: true };
describe("Coupon rules", () => {
  it("PRIMEIRACOMPRA gives 10% only on full-price items", () => {
    const c = initialData.coupons.find((c) => c.code === "PRIMEIRACOMPRA");
    const result = calculateCoupon(
      [
        { product: normal, quantity: 1 },
        { product: sale, quantity: 1 },
      ],
      c,
    );
    expect(result.discount).toBe(10);
    expect(result.total).toBe(170);
    expect(result.mixed).toBe(true);
  });
  it("rejects nonstackable coupon on an all-sale bag", () => {
    const result = calculateCoupon([{ product: sale, quantity: 1 }], initialData.coupons[0]);
    expect(result.discount).toBe(0);
    expect(result.error).not.toBe("");
  });
  it("BEMVINDA15 requires R$120 and gives R$15 on sale items too", () => {
    const c = initialData.coupons[1];
    expect(c?.min_order_value).toBe(120);
    expect(c?.allow_on_sale).toBe(true);
    expect(calculateCoupon([{ product: sale, quantity: 1 }], c).discount).toBe(0);
    expect(calculateCoupon([{ product: sale, quantity: 2 }], c).discount).toBe(15);
  });
  it("caps fixed discounts at eligible subtotal", () => {
    const c = initialData.coupons[1];
    if (!c) throw new Error("Missing coupon");
    expect(
      calculateCoupon([{ product: normal, quantity: 1 }], { ...c, value: 200, min_order_value: 0 })
        .total,
    ).toBe(0);
  });
  it("validates minimum against only eligible items", () => {
    const c = initialData.coupons[0];
    if (!c) throw new Error("Missing coupon");
    expect(
      calculateCoupon(
        [
          { product: normal, quantity: 1 },
          { product: sale, quantity: 2 },
        ],
        { ...c, min_order_value: 120 },
      ).discount,
    ).toBe(0);
  });
  it("rejects inactive and expired coupons, includes expiration day", () => {
    const c = initialData.coupons[0];
    if (!c) throw new Error("Missing coupon");
    const items = [{ product: normal, quantity: 1 }];
    expect(calculateCoupon(items, { ...c, active: false }).discount).toBe(0);
    expect(calculateCoupon(items, { ...c, expires_at: "2026-11-23" }, "2026-11-24").discount).toBe(
      0,
    );
    expect(calculateCoupon(items, { ...c, expires_at: "2026-11-24" }, "2026-11-24").discount).toBe(
      10,
    );
  });
  it("normalizes codes to uppercase without spaces", () =>
    expect(normalizeCode(" primeira compra ")).toBe("PRIMEIRACOMPRA"));
  it("seeds twelve products, three sales, one unavailable, prices 39.90–189.90", () => {
    expect(initialData.products).toHaveLength(12);
    expect(initialData.products.filter((p) => p.is_on_sale)).toHaveLength(3);
    expect(initialData.products.filter((p) => !p.in_stock)).toHaveLength(1);
    expect(Math.min(...initialData.products.map((p) => p.price))).toBe(39.9);
    expect(Math.max(...initialData.products.map((p) => p.price))).toBe(189.9);
  });
  it("distinguishes same product in different sizes in the cart and sums coupons accurately", () => {
    expect(getCartItemKey(normal.id, "P")).not.toBe(getCartItemKey(normal.id, "M"));
    expect(getCartItemKey(normal.id, "P")).toBe(getCartItemKey(normal.id, " P "));
    const result = calculateCoupon(
      [
        { product: normal, quantity: 1, selectedSize: "P" },
        { product: normal, quantity: 1, selectedSize: "M" },
      ],
      initialData.coupons[0],
    );
    expect(result.subtotal).toBe(200);
    expect(result.discount).toBe(20);
    expect(result.total).toBe(180);
  });
});
