import {
  NICHE_CATALOG_DEFAULTS,
  STORE_CONFIG,
  getDefaultBannerAlt,
  getMaterialLabel,
  isFashionNiche,
  isFootwearNiche,
} from "@/config/store.config";
import type {
  AdminProfile,
  Banner,
  CartItem,
  Coupon,
  Product,
  ProductCharacteristic,
  PromoCtaType,
  StoreAnnouncement,
  StoreData,
  StorePromotion,
  StoreSettings,
} from "@/types";

export type {
  AdminProfile,
  Banner,
  CartItem,
  Coupon,
  Product,
  ProductCharacteristic,
  PromoCtaType,
  StoreAnnouncement,
  StoreData,
  StorePromotion,
  StoreSettings,
};

export const defaultPromotion: StorePromotion = {
  promo_active: false,
  promo_badge: "CAMPANHA ESPECIAL",
  promo_title: "",
  promo_description: "",
  promo_highlight: "",
  promo_cta_label: "Aproveitar promoção",
  promo_cta_type: "vitrine",
};

export const emptyStoreData: StoreData = {
  products: [],
  coupons: [],
  banners: [],
  announcement: { active: false, text: "", link: "#vitrine" },
  promotion: { ...defaultPromotion },
  profile: { name: "Administradora", email: "", avatar: "" },
};

const isModa = isFashionNiche();
const isCalcados = isFootwearNiche();

const names = isModa
  ? [
      "Vestido Midi Linho Natural",
      "Conjunto Alfaiataria Essencial",
      "Blusa Tricot Gola Alta",
      "Calça Pantalona Viscolinho",
      "Cropped Canelado Decote Reto",
      "Saia Midi Crepe Fluido",
      "Macacão Longo Alfaiataria",
      "Vestido Curto Algodão Leve",
      "Short Alfaiataria Cintura Alta",
      "Conjunto Tricot Inverno",
      "Biquíni Poliamida Texturizada",
      "Camisa Linho Manga Longa",
    ]
  : isCalcados
    ? [
        "Sandália Salto Bloco Napa",
        "Rasteira Tiras Finas Couro",
        "Tênis Casual Branco Couro",
        "Bota Cano Curto Camurça",
        "Scarpin Clássico Verniz",
        "Sapatilha Bico Fino Napa",
        "Mule Minimalista Couro Sintético",
        "Slide Confortável EVA",
        "Sandália Anabela Camurça",
        "Bota Coturno Couro",
        "Tênis Knit Têxtil Malha",
        "Tamanco Salto Geométrico Napa",
      ]
    : [
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

const categories = isModa
  ? [
      "Vestidos",
      "Conjuntos",
      "Tricot & Inverno",
      "Calças",
      "Blusas & Croppeds",
      "Shorts & Saias",
      "Macaquinhos & Macacões",
      "Vestidos",
      "Shorts & Saias",
      "Tricot & Inverno",
      "Moda Praia",
      "Blusas & Croppeds",
    ]
  : isCalcados
    ? [
        "Sandálias",
        "Rasteiras",
        "Tênis",
        "Botas",
        "Scarpins",
        "Sapatilhas",
        "Mules & Tamancos",
        "Chinelos & Slides",
        "Sandálias",
        "Botas",
        "Tênis",
        "Mules & Tamancos",
      ]
    : [
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

const modaMaterials = [
  "Linho",
  "Alfaiataria",
  "Tricot",
  "Viscolinho",
  "Canelado",
  "Crepe",
  "Alfaiataria",
  "Algodão",
  "Alfaiataria",
  "Tricot",
  "Poliamida",
  "Linho",
];

const calcadosMaterials = [
  "Napa",
  "Couro",
  "Couro",
  "Camurça",
  "Verniz",
  "Napa",
  "Couro Sintético",
  "Borracha / EVA",
  "Camurça",
  "Couro",
  "Têxtil / Malha",
  "Napa",
];

const prices = [69.9, 89.9, 119.9, 99.9, 149.9, 59.9, 79.9, 89.9, 39.9, 69.9, 189.9, 99.9];

const defaultBannerAlt = getDefaultBannerAlt();
const materialLabel = getMaterialLabel();

export const initialData: StoreData = {
  products: names.map((name, i) => {
    const itemMaterial = isModa
      ? (modaMaterials[i] ?? "Alfaiataria")
      : isCalcados
        ? (calcadosMaterials[i] ?? "Couro")
        : [1, 3, 5, 7, 9, 11].includes(i)
          ? "Prata 925"
          : "Semijoia";

    return {
      id: `item-${i + 1}`,
      name,
      sku: `SKU${String(i + 1).padStart(3, "0")}`,
      category:
        categories[i] ?? NICHE_CATALOG_DEFAULTS[STORE_CONFIG.niche].categories[0] ?? "Conjuntos",
      material: itemMaterial,
      price: prices[i] ?? 69.9,
      sale_price: Number(((prices[i] ?? 69.9) * 0.8).toFixed(2)),
      is_on_sale: [0, 4, 10].includes(i),
      sale_label: "",
      image_url: "/logo.png",
      description: isModa
        ? "Peça de modelagem elegante e caimento impecável, pensada para acompanhar sua rotina com conforto e sofisticação em diversas ocasiões."
        : isCalcados
          ? "Calçado confortável com acabamento cuidadoso, ideal para acompanhar o seu dia com estilo, leveza e estabilidade."
          : "Um toque de delicadeza para acompanhar seus melhores momentos. Uma peça selecionada com carinho, perfeita para compor looks e presentear alguém especial.",
      active: true,
      featured: i < 4,
      in_stock: i !== 9,
      sizes: isModa
        ? i === 10
          ? ["Tamanho Único"]
          : ["P", "M", "G"]
        : isCalcados
          ? ["35", "36", "37", "38"]
          : [],
      characteristics: isModa
        ? [
            { attribute: materialLabel, value: itemMaterial },
            { attribute: "Caimento", value: "Confortável e estruturado" },
            { attribute: "Ocasião", value: "Dia a dia e eventos" },
          ]
        : isCalcados
          ? [
              { attribute: materialLabel, value: itemMaterial },
              { attribute: "Palmilha", value: "Macia e anatômica" },
              { attribute: "Ocasião", value: "Dia a dia e eventos" },
            ]
          : [
              {
                attribute: materialLabel,
                value: [1, 3, 5, 7, 9, 11].includes(i) ? "Prata 925" : "Banho de ouro 18k",
              },
              { attribute: "Acabamento", value: "Polido" },
              { attribute: "Detalhes", value: "Design delicado" },
            ],
    };
  }),
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
      code: "BEMVINDA15",
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
      image_url: "/logo.png",
      alt: defaultBannerAlt,
      active: true,
      filter: "",
    },
    {
      id: "b2",
      image_url: "/logo.png",
      alt: defaultBannerAlt,
      active: true,
      filter: isModa ? "Vestidos" : isCalcados ? "Sandálias" : "Semijoias",
    },
    {
      id: "b3",
      image_url: "/logo.png",
      alt: defaultBannerAlt,
      active: true,
      filter: isModa ? "Conjuntos" : isCalcados ? "Tênis" : "Prata 925",
    },
  ],
  announcement: {
    active: true,
    text: STORE_CONFIG.defaultAnnouncement,
    link: "#vitrine",
  },
  promotion: { ...defaultPromotion },
  profile: { name: "Administradora", email: "", avatar: "" },
};

export const DEFAULT_CATEGORIES = NICHE_CATALOG_DEFAULTS[STORE_CONFIG.niche].categories;
export const DEFAULT_MATERIALS = NICHE_CATALOG_DEFAULTS[STORE_CONFIG.niche].materials;
export const categoriesList: string[] = [...DEFAULT_CATEGORIES];
export const materialsList: string[] = [...DEFAULT_MATERIALS];

export const money = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const priceOf = (p: Product) => (p.is_on_sale ? p.sale_price : p.price);
