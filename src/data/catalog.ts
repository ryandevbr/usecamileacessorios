import p1 from "@/assets/product-1.asset.json";
import p2 from "@/assets/product-2.asset.json";
import p3 from "@/assets/product-3.asset.json";
import p4 from "@/assets/product-4.asset.json";
import p5 from "@/assets/product-5.asset.json";
import p6 from "@/assets/product-6.asset.json";
import p7 from "@/assets/product-7.asset.json";
import p8 from "@/assets/product-8.asset.json";
import p9 from "@/assets/product-9.asset.json";
import p10 from "@/assets/product-10.asset.json";
import p11 from "@/assets/product-11.asset.json";
import p12 from "@/assets/product-12.asset.json";
import editorial from "@/assets/editorial.asset.json";
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
  mobile_image_url?: string;
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
  profile: AdminProfile;
}
export const emptyStoreData: StoreData = {
  products: [],
  coupons: [],
  banners: [],
  announcement: { active: false, text: "", link: "#vitrine" },
  profile: { name: "Administradora", email: "", avatar: "" },
};
const names = [
  "Argola Dourada Essencial",
  "Colar Coração em Prata",
  "Colar Duplo Pérola",
  "Anel Solitário em Prata",
  "Pulseira Riviera Dourada",
  "Argola Delicada em Prata",
  "Colar Sol Dourado",
  "Pulseira Coração em Prata",
  "Brinco Pérola Clássica",
  "Anel Abraço em Prata",
  "Conjunto Pérola Dourado",
  "Colar Estrela em Prata",
];
const categories = [
  "Brincos",
  "Colares",
  "Colares",
  "Anéis",
  "Pulseiras",
  "Brincos",
  "Colares",
  "Pulseiras",
  "Brincos",
  "Anéis",
  "Conjuntos",
  "Colares",
];
const prices = [69.9, 89.9, 119.9, 99.9, 149.9, 59.9, 79.9, 89.9, 39.9, 69.9, 189.9, 99.9];
const photos = [p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11, p12];
export const initialData: StoreData = {
  products: names.map((name, i) => ({
    id: `camile-${i + 1}`,
    name,
    sku: `UC${String(i + 1).padStart(3, "0")}`,
    category: categories[i] ?? "Colares",
    material: [1, 3, 5, 7, 9, 11].includes(i) ? "Prata 925" : "Semijoia",
    price: prices[i] ?? 69.9,
    sale_price: Number(((prices[i] ?? 69.9) * 0.8).toFixed(2)),
    is_on_sale: [0, 4, 10].includes(i),
    sale_label: "",
    image_url: photos[i]?.url ?? p1.url,
    description:
      "Um toque de delicadeza para acompanhar seus melhores momentos. Uma peça selecionada com carinho, perfeita para compor looks e presentear alguém especial.",
    active: true,
    featured: i < 4,
    in_stock: i !== 9,
    characteristics: [
      {
        attribute: "Material",
        value: [1, 3, 5, 7, 9, 11].includes(i) ? "Prata 925" : "Banho de ouro 18k",
      },
      { attribute: "Acabamento", value: "Polido" },
      { attribute: "Detalhes", value: "Design delicado" },
    ],
  })),
  coupons: [
    {
      id: "first",
      code: "PRIMEIRACOMPRA",
      type: "percent",
      value: 10,
      min_order_value: 0,
      expires_at: "",
      active: true,
      allow_on_sale: false,
    },
    {
      id: "fixed",
      code: "USECAMILE15",
      type: "fixed",
      value: 15,
      min_order_value: 120,
      expires_at: "",
      active: true,
      allow_on_sale: true,
    },
  ],
  banners: [
    {
      id: "b1",
      image_url: editorial.url,
      alt: "Colares delicados e anéis dourados em uma composição editorial",
      active: true,
      filter: "",
    },
    {
      id: "b2",
      image_url: p11.url,
      alt: "Conjunto de pérolas dourado",
      active: true,
      filter: "Semijoias",
    },
    {
      id: "b3",
      image_url: p2.url,
      alt: "Colar coração em Prata 925",
      active: true,
      filter: "Prata 925",
    },
  ],
  announcement: {
    active: true,
    text: "Sua primeira compra merece um brilho extra: 10% OFF com PRIMEIRACOMPRA",
    link: "#vitrine",
  },
  profile: { name: "Administradora", email: "", avatar: "" },
};
export const DEFAULT_CATEGORIES = [
  "Anéis",
  "Colares",
  "Brincos",
  "Pulseiras",
  "Tornozeleiras",
  "Conjuntos",
] as const;
export const DEFAULT_MATERIALS = ["Prata 925", "Semijoia"] as const;
export const categoriesList: string[] = [...DEFAULT_CATEGORIES];
export const materialsList: string[] = [...DEFAULT_MATERIALS];
export const money = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const priceOf = (p: Product) => (p.is_on_sale ? p.sale_price : p.price);
