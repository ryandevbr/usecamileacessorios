export interface ProductCharacteristic {
  attribute: string;
  value: string;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  category: string;
  material: string;
  price: number;
  sale_price: number;
  is_on_sale: boolean;
  sale_label: string;
  image_url: string;
  description: string;
  active: boolean;
  featured: boolean;
  in_stock: boolean;
  characteristics: ProductCharacteristic[];
  sizes: string[];
}

export interface CartItem {
  product: Product;
  quantity: number;
  selectedSize?: string | undefined;
}

export interface Coupon {
  id: string;
  code: string;
  type: "percent" | "fixed";
  value: number;
  min_order_value: number;
  expires_at: string;
  active: boolean;
  allow_on_sale: boolean;
}

export interface Banner {
  id: string;
  image_url: string;
  mobile_image_url?: string | null;
  alt: string;
  active: boolean;
  filter: string;
  display_order?: number;
}

export interface StoreAnnouncement {
  active: boolean;
  text: string;
  link: string;
}

export type PromoCtaType = "vitrine" | "whatsapp";

export interface StorePromotion {
  promo_active: boolean;
  promo_badge: string;
  promo_title: string;
  promo_description: string;
  promo_highlight: string;
  promo_cta_label: string;
  promo_cta_type: PromoCtaType;
}

export interface StoreSettings extends StorePromotion {
  announcement_active: boolean;
  announcement_text: string;
  announcement_link: string;
}

export interface AdminProfile {
  name: string;
  email: string;
  avatar: string;
}

export interface StoreData {
  products: Product[];
  coupons: Coupon[];
  banners: Banner[];
  announcement: StoreAnnouncement;
  promotion: StorePromotion;
  profile: AdminProfile;
}
