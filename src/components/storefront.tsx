import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Search,
  ShoppingBag,
  Sparkles,
  Truck,
  ShieldCheck,
  MessageCircle,
  Instagram,
  LockKeyhole,
  Plus,
  Minus,
  Trash2,
  Share2,
  Check,
  CreditCard,
  Heart,
  Gift,
  MapPin,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  ACTIVE_STORE_SLUG,
  NICHE_CATALOG_DEFAULTS,
  STORE_CONFIG,
  getDefaultBannerAlt,
  getMaterialLabel,
  getPhysicalStoreMapsUrl,
  getWhatsappUrl,
  hasActivePhysicalStore,
  isFashionNiche,
  isFootwearNiche,
} from "@/config/store.config";
import { useStore } from "@/services/storeService";
import {
  mergeOptionValues,
  optionLookupKey,
  useCatalogOptions,
} from "@/services/catalogOptionsService";
import {
  calculateCoupon,
  getCartItemKey,
  normalizeCode,
  type CartItem,
} from "@/services/couponService";
import { money, priceOf, type Product } from "@/data/catalog";

function matchesFilter(product: Product, selected: string): boolean {
  if (selected === "Todos") return true;
  if (selected === "Promoções") return product.is_on_sale;
  const target = optionLookupKey(selected);
  const productCategory = optionLookupKey(product.category);
  const productMaterial = optionLookupKey(product.material);
  if (target === "semijoias" && productMaterial === "semijoia") return true;
  return productCategory === target || productMaterial === target;
}

function getMaterialBadgeClass(material: string): string {
  const key = optionLookupKey(material);
  if (key.includes("prata")) {
    return "bg-background/95 text-foreground border border-border/80 backdrop-blur-sm";
  }
  if (key.includes("semijoia") || key.includes("ouro") || key.includes("dourad")) {
    return "bg-secondary/95 text-foreground border border-primary/25 backdrop-blur-sm";
  }
  return "bg-background/95 text-foreground/90 border border-border/80 backdrop-blur-sm";
}

function getDefaultSelectedSize(sizes: string[]): string {
  if (sizes.length === 1 && sizes[0] === "Tamanho Único") {
    return "Tamanho Único";
  }
  return "";
}

const BAG_STORAGE_KEY = `store-bag-v1-${ACTIVE_STORE_SLUG}`;
const PRODUCTS_PER_PAGE = 16;

export function Storefront() {
  const { data, loading, error } = useStore({ scope: "public" });
  const { categoryNames, materialNames } = useCatalogOptions();
  const [filter, setFilter] = useState("Todos");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("featured");
  const [visibleCount, setVisibleCount] = useState(PRODUCTS_PER_PAGE);
  const [product, setProduct] = useState<Product | null>(null);
  const [selectedSizes, setSelectedSizes] = useState<Record<string, string>>({});
  const [bag, setBag] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [ready, setReady] = useState(false);
  const [code, setCode] = useState("");
  const [applied, setApplied] = useState("");
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [slide, setSlide] = useState(0);

  const isModa = isFashionNiche();
  const isCalcados = isFootwearNiche();
  const materialLabel = getMaterialLabel();
  const physicalStore = STORE_CONFIG.physicalStore;
  const hasPhysicalStore = hasActivePhysicalStore();
  const mapsUrl = physicalStore ? getPhysicalStoreMapsUrl(physicalStore) : "";
  const whatsappHref = getWhatsappUrl();
  const defaultBannerAlt = getDefaultBannerAlt();

  useEffect(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(BAG_STORAGE_KEY) ?? "[]") as CartItem[];
      if (Array.isArray(parsed)) {
        setCart(
          parsed
            .filter((item) => item && item.product && typeof item.quantity === "number")
            .map((item) => ({
              ...item,
              product: {
                ...item.product,
                sizes: Array.isArray(item.product.sizes) ? item.product.sizes : [],
              },
            })),
        );
      }
    } catch {
      // ignore corrupted storage
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const id = new URL(window.location.href).searchParams.get("produto");
    if (id) {
      const p = data.products.find((item) => item.id === id && item.active);
      if (p) {
        setProduct(p);
        document.getElementById("vitrine")?.scrollIntoView();
      }
    }
  }, [ready, data.products]);

  useEffect(() => {
    if (ready) localStorage.setItem(BAG_STORAGE_KEY, JSON.stringify(cart));
  }, [cart, ready]);

  useEffect(() => {
    setVisibleCount(PRODUCTS_PER_PAGE);
  }, [filter, query, sort]);

  const banners = data.banners.filter((b) => b.active);
  const currentSlide = banners.length > 0 ? slide % banners.length : 0;

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || banners.length < 2) return;
    const timer = setInterval(() => setSlide((s) => (s + 1) % banners.length), 3000);
    return () => clearInterval(timer);
  }, [banners.length]);

  const getActiveSize = (p: Product): string => {
    const chosen = selectedSizes[p.id];
    if (chosen && p.sizes.includes(chosen)) return chosen;
    return getDefaultSelectedSize(p.sizes);
  };

  function open(p: Product | null) {
    setProduct(p);
    const url = new URL(window.location.href);
    if (p) url.searchParams.set("produto", p.id);
    else url.searchParams.delete("produto");
    window.history.replaceState({}, "", url);
  }

  function add(p: Product, explicitSize?: string) {
    if (!p.in_stock) return;
    const chosenSize = (explicitSize ?? getActiveSize(p)).trim();
    if (p.sizes.length > 0 && !chosenSize) {
      toast.error("Selecione um tamanho antes de adicionar à sacola.");
      return;
    }

    const itemKey = getCartItemKey(p.id, chosenSize || undefined);
    setCart((c) => {
      const existing = c.find((i) => getCartItemKey(i.product.id, i.selectedSize) === itemKey);
      if (existing) {
        return c.map((i) =>
          getCartItemKey(i.product.id, i.selectedSize) === itemKey
            ? { ...i, quantity: i.quantity + 1 }
            : i,
        );
      }
      const nextItem: CartItem = chosenSize
        ? { product: p, quantity: 1, selectedSize: chosenSize }
        : { product: p, quantity: 1 };
      return [...c, nextItem];
    });
    toast.success(
      chosenSize ? `Peça (${chosenSize}) adicionada à sacola` : "Peça adicionada à sacola",
    );
  }

  const activeProducts = data.products.filter((p) => p.active);
  const nicheDefaults = NICHE_CATALOG_DEFAULTS[STORE_CONFIG.niche];
  const dynamicMaterials = mergeOptionValues(
    materialNames.length > 0 ? materialNames : [...nicheDefaults.materials],
    activeProducts.map((p) => p.material),
  );
  const dynamicCategories = mergeOptionValues(
    categoryNames.length > 0 ? categoryNames : [...nicheDefaults.categories],
    activeProducts.map((p) => p.category),
  );
  const filters = [
    "Todos",
    "Promoções",
    ...mergeOptionValues([...dynamicMaterials, ...dynamicCategories]),
  ];
  const filteredProducts = activeProducts
    .filter(
      (p) =>
        matchesFilter(p, filter) &&
        `${p.name} ${p.sku}`.toLowerCase().includes(query.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "low"
        ? priceOf(a) - priceOf(b)
        : sort === "high"
          ? priceOf(b) - priceOf(a)
          : Number(b.featured) - Number(a.featured),
    );
  const visibleProducts = filteredProducts.slice(0, visibleCount);
  const remainingCount = Math.max(0, filteredProducts.length - visibleCount);
  const nextBatchCount = Math.min(PRODUCTS_PER_PAGE, remainingCount);
  const promotion = data.promotion;
  const showPromotion = promotion.promo_active && promotion.promo_title.trim() !== "";
  const coupon = data.coupons.find((c) => c.code === applied);
  const totals = calculateCoupon(cart, coupon);
  const subtotal = cart.reduce((s, i) => s + priceOf(i.product) * i.quantity, 0);
  const discount = applied && !totals.error ? totals.discount : 0;
  const total = subtotal - discount;
  const count = cart.reduce((s, i) => s + i.quantity, 0);

  const scroll = (f: string) => {
    const targetKey = optionLookupKey(f);
    const matched =
      filters.find((item) => optionLookupKey(item) === targetKey) ??
      (targetKey === "semijoias"
        ? filters.find((item) => optionLookupKey(item) === "semijoia")
        : undefined);
    setFilter(matched ?? f);
    document.getElementById("vitrine")?.scrollIntoView({ behavior: "smooth" });
  };

  async function share(p: Product) {
    const url = `${window.location.origin}/?produto=${p.id}`;
    try {
      if (navigator.share) await navigator.share({ title: p.name, text: STORE_CONFIG.name, url });
      else {
        await navigator.clipboard.writeText(url);
        toast.success("Link copiado!");
      }
    } catch {
      // user cancelled share dialog
    }
  }

  const checkout = () => {
    const lines = [
      `Olá, ${STORE_CONFIG.name}! ✨`,
      "Gostaria de finalizar meu pedido feito pelo site:",
      "",
      cart
        .map(
          (i) =>
            `• *${i.product.name}*${i.selectedSize ? ` — Tam: ${i.selectedSize}` : ""} (${i.product.material})${i.product.is_on_sale ? " (Promoção)" : ""} — Qtd: ${i.quantity} — ${money(priceOf(i.product) * i.quantity)}`,
        )
        .join("\n\n"),
      "",
      `Subtotal: ${money(subtotal)}`,
      ...(discount
        ? [
            `Cupom aplicado: ${applied} (- ${money(discount)})`,
            ...(totals.mixed ? ["(Cupom aplicado apenas nos itens sem promoção)"] : []),
          ]
        : []),
      `Total estimado: ${money(total)}`,
      "",
      ...(name ? [`Nome: ${name}`] : []),
      ...(city ? [`CEP/Cidade: ${city}`] : []),
      "",
      hasPhysicalStore
        ? "Aguardo para combinarmos o frete ou retirada presencial e a forma de pagamento!"
        : "Aguardo para combinarmos o frete e a forma de pagamento!",
    ];
    window.open(getWhatsappUrl(lines.join("\n")), "_blank", "noopener,noreferrer");
  };

  const careItems = isModa
    ? [
        [
          "Como cuidar das suas peças?",
          "Prefira lavagem delicada à mão ou ciclo suave com sabão neutro e seque à sombra para preservar o caimento e a cor.",
        ],
        [
          "Dúvidas sobre tamanhos e caimento?",
          "Consulte a grade disponível em cada peça ou chame nossa equipe no WhatsApp para orientação personalizada.",
        ],
        [
          "Trocas e devoluções",
          "Consulte as condições e prazos diretamente em nosso atendimento pelo WhatsApp.",
        ],
      ]
    : isCalcados
      ? [
          [
            "Como cuidar dos seus calçados?",
            "Limpe com pano macio levemente umedecido, evite exposição prolongada ao sol e guarde em local arejado.",
          ],
          [
            "Dúvidas sobre numeração e calce?",
            "Consulte as numerações disponíveis no produto ou fale conosco no WhatsApp para ajuda na escolha ideal.",
          ],
          [
            "Trocas e devoluções",
            "Consulte as condições e prazos diretamente em nosso atendimento pelo WhatsApp.",
          ],
        ]
      : [
          [
            "Como cuidar da Prata 925?",
            "Limpe com flanela macia e guarde em local seco, separada de outras peças.",
          ],
          [
            "Como cuidar das Semijoias?",
            "Evite perfumes, produtos químicos, banho e piscina. Guarde cada peça individualmente.",
          ],
          [
            "Sobre a garantia",
            "Consulte as condições e os prazos de cada peça em nosso atendimento pelo WhatsApp.",
          ],
        ];

  const trustHighlights: Array<[typeof Truck, string]> = [
    [Truck, "Para todo o Brasil"],
    [
      Sparkles,
      isModa
        ? "Moda Feminina selecionada"
        : isCalcados
          ? "Calçados selecionados"
          : "Prata 925 & Semijoias",
    ],
    hasPhysicalStore && physicalStore
      ? [MapPin, physicalStore.title]
      : [Heart, "Curadoria feita com carinho"],
    [ShieldCheck, "Atendimento personalizado"],
  ];

  const aboutTitle =
    STORE_CONFIG.aboutTitle ??
    (isModa
      ? "Mais que moda, um pouco de você."
      : isCalcados
        ? "Conforto e estilo a cada passo."
        : "Mais que acessórios, um pouco de você.");
  const aboutText =
    STORE_CONFIG.aboutText ??
    "Nossa curadoria reúne estilo, qualidade e atendimento personalizado com envio para todo o Brasil.";

  return (
    <>
      {data.announcement.active && data.announcement.text.trim() && (
        <div className="bg-primary text-primary-foreground text-center px-4 py-2.5 text-[10px] sm:text-xs">
          <a href={data.announcement.link || "#vitrine"} className="inline-flex gap-2 items-center">
            <Sparkles size={12} />
            {data.announcement.text}
            <span className="hidden sm:inline"> · Enviamos para todo o Brasil</span>
          </a>
        </div>
      )}
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-border">
        <div className="shell flex items-center justify-between gap-3 md:grid md:grid-cols-[1fr_auto_1fr] h-17 sm:h-18.5 md:h-20">
          <a
            href="#inicio"
            aria-label={`${STORE_CONFIG.name} — início`}
            className="inline-flex items-center shrink-0"
          >
            <img
              src="/logo.png"
              alt={STORE_CONFIG.name}
              className="h-12 sm:h-14 md:h-16 w-auto max-w-none shrink-0 object-contain"
            />
          </a>
          <nav className="hidden md:flex justify-center gap-8 text-xs text-muted-foreground">
            <a href="#inicio">Início</a>
            <a href="#vitrine">Vitrine</a>
            <a href="#envios-entregas">Envios e entregas</a>
            <a href="#sobre">Sobre</a>
          </nav>
          <div className="flex gap-2 sm:gap-4 justify-end items-center shrink-0">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Buscar peças"
              onClick={() => {
                document.getElementById("vitrine")?.scrollIntoView();
                document.getElementById("search")?.focus();
              }}
            >
              <Search />
            </Button>
            <Button
              variant="ghost"
              onClick={() => setBag(true)}
              aria-label={`Sacola com ${count} itens`}
              className="px-0 gap-2"
            >
              <ShoppingBag />
              <span className="hidden sm:inline text-xs">Sacola</span>
              <span className="rounded-full bg-secondary text-foreground text-[10px] h-5 w-5 grid place-items-center">
                {count}
              </span>
            </Button>
          </div>
        </div>
      </header>
      <main>
        <section id="inicio" className="hero">
          <div className="hero-media aspect-video md:aspect-auto">
            {banners.map((b, i) => (
              <img
                key={b.id}
                src={b.image_url}
                alt={b.alt || defaultBannerAlt}
                className={`hero-photo w-full h-full object-cover object-center ${
                  i === currentSlide ? "opacity-100" : "opacity-0 pointer-events-none"
                }`}
                loading={i === 0 ? "eager" : "lazy"}
                fetchPriority={i === 0 ? "high" : "auto"}
                decoding="async"
                onClick={() => b.filter && scroll(b.filter)}
              />
            ))}
            <div className="hero-scrim pointer-events-none" />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-0 h-7 bg-linear-to-t from-surface to-transparent md:hidden"
            />
            {banners.length > 1 && (
              <div className="absolute bottom-3 right-4 md:bottom-6 md:right-8 z-10 flex gap-2">
                {banners.map((b, i) => (
                  <Button
                    key={b.id}
                    variant="ghost"
                    className={`p-0 h-2 w-2 rounded-full ${i === currentSlide ? "bg-primary" : "bg-foreground/25"}`}
                    aria-label={`Foto ${i + 1}`}
                    onClick={() => setSlide(i)}
                  />
                ))}
              </div>
            )}
          </div>
          <div className="shell hero-content bg-surface md:bg-transparent pointer-events-none">
            <div className="max-w-127.5 pointer-events-auto">
              <p className="eyebrow text-muted-foreground flex gap-2 items-center mb-4 md:mb-5">
                <Sparkles size={15} className="text-primary" /> {STORE_CONFIG.hero.badge}
              </p>
              <h1 className="text-foreground">{STORE_CONFIG.hero.title}</h1>
              <p className="text-muted-foreground text-sm leading-7 mt-4 md:mt-6 max-w-98.75">
                {STORE_CONFIG.hero.subtitle}
              </p>
              <div className="flex flex-wrap gap-3 mt-6 md:mt-7">
                <Button size="lg" onClick={() => scroll("Todos")}>
                  Ver vitrine <ArrowRight />
                </Button>
                <Button size="lg" variant="editorial" asChild>
                  <a href={whatsappHref} target="_blank" rel="noreferrer">
                    <MessageCircle />
                    Chamar no WhatsApp
                  </a>
                </Button>
              </div>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-5">
                <a
                  href="#envios-entregas"
                  className="inline-flex gap-2 items-center text-[11px] text-muted-foreground hover:text-primary transition-colors"
                >
                  <Truck size={14} />
                  Envios e entregas <ArrowRight size={12} />
                </a>
                {hasPhysicalStore && physicalStore && (
                  <a
                    href={mapsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex gap-1.5 items-center text-[11px] text-muted-foreground hover:text-primary transition-colors"
                  >
                    <MapPin size={14} className="text-primary shrink-0" />
                    <span>
                      {physicalStore.address} · {physicalStore.cityState}
                    </span>
                  </a>
                )}
              </div>
            </div>
          </div>
        </section>
        <div className="bg-background border-b">
          <div className="shell grid grid-cols-2 md:grid-cols-4 py-6 gap-5 text-[11px] text-muted-foreground">
            {trustHighlights.map(([Icon, text], i) => {
              const C = Icon;
              return (
                <div key={i} className="flex justify-center items-center gap-2">
                  <C size={17} className="text-primary shrink-0" />
                  <span>{text}</span>
                </div>
              );
            })}
          </div>
        </div>
        {showPromotion && (
          <section id="promocoes" className="shell pt-8 md:pt-10">
            <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-linear-to-br from-surface via-surface to-secondary/75 px-5 py-7 sm:px-9 sm:py-8 md:px-12 md:py-10 text-center shadow-xs">
              {promotion.promo_badge.trim() && (
                <p className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
                  <Gift size={13} />
                  {promotion.promo_badge.trim()}
                </p>
              )}
              <h2 className="font-display text-3xl sm:text-4xl md:text-[40px] leading-[1.12] text-foreground mt-3.5 max-w-3xl mx-auto">
                {promotion.promo_title.trim()}
              </h2>
              {promotion.promo_description.trim() && (
                <p className="whitespace-pre-line text-sm sm:text-[15px] leading-7 text-muted-foreground mt-3.5 max-w-2xl mx-auto">
                  {promotion.promo_description.trim()}
                </p>
              )}
              {promotion.promo_highlight.trim() && (
                <div className="mt-5 inline-flex max-w-2xl items-center justify-center gap-2.5 rounded-xl border border-primary/20 bg-background/85 px-4 py-2.5 text-left sm:text-center text-xs sm:text-sm text-foreground shadow-2xs">
                  <Sparkles size={15} className="text-primary shrink-0" />
                  <span className="whitespace-pre-line">{promotion.promo_highlight.trim()}</span>
                </div>
              )}
            </div>
          </section>
        )}
        <section id="vitrine" className="shell pt-16 pb-20">
          <div className="text-center">
            <p className="eyebrow text-primary mb-3">Encontre seu próximo favorito</p>
            <h2 className="section-title">
              {isModa
                ? "Looks para chamar de seus"
                : isCalcados
                  ? "Passos cheios de estilo"
                  : "Um brilho para chamar de seu"}
            </h2>
            <p className="text-sm text-muted-foreground mt-3">
              {isModa
                ? "Modelagens atemporais, conforto e estilo em cada detalhe."
                : isCalcados
                  ? "Conforto, acabamento e personalidade em cada escolha."
                  : "Pequenos detalhes. Grandes encantos."}
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2 mt-8">
            {filters.map((f) => (
              <Button
                key={f}
                variant={filter === f ? "default" : "ghost"}
                className={`filter-pill ${filter !== f ? "border border-border" : ""}`}
                onClick={() => setFilter(f)}
              >
                {f}
                {f === "Promoções" && <Sparkles size={12} />}
              </Button>
            ))}
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 mt-8 mb-6">
            <div className="relative w-full max-w-xs">
              <Search
                size={16}
                className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted-foreground"
              />
              <input
                id="search"
                aria-label="Buscar por nome ou SKU"
                placeholder="Qual peça você procura?"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full pl-10! bg-muted text-sm"
              />
            </div>
            <select
              aria-label="Ordenar produtos"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className="w-auto text-xs border-0"
            >
              <option value="featured">Destaques</option>
              <option value="low">Menor preço</option>
              <option value="high">Maior preço</option>
            </select>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-5 gap-y-10">
            {visibleProducts.map((p) => {
              const activeSize = getActiveSize(p);
              return (
                <article key={p.id} className="flex flex-col">
                  <div className="product-image">
                    <Button
                      variant="ghost"
                      className="w-full h-full p-0 rounded-none"
                      onClick={() => open(p)}
                      aria-label={`Ver ${p.name}`}
                    >
                      <img
                        src={p.image_url}
                        alt={`${p.name} — ${p.material}`}
                        loading="lazy"
                        decoding="async"
                      />
                    </Button>
                    <div className="absolute top-3 left-3 flex flex-col gap-2 pointer-events-none">
                      {p.is_on_sale ? (
                        <span className="bg-primary text-primary-foreground px-2 py-1 text-[9px] uppercase tracking-wide">
                          {p.sale_label || `${((1 - p.sale_price / p.price) * 100).toFixed(0)}% OFF`}
                        </span>
                      ) : p.featured ? (
                        <span className="bg-background/90 text-foreground px-2 py-1 text-[9px] uppercase tracking-wide">
                          Destaque
                        </span>
                      ) : null}
                      {!p.in_stock && (
                        <span className="bg-foreground text-background px-2 py-1 text-[9px]">
                          Indisponível
                        </span>
                      )}
                    </div>
                    <span
                      title={`${materialLabel}: ${p.material}`}
                      className={`absolute bottom-3 left-3 max-w-[calc(100%-24px)] truncate rounded-sm px-2 py-1 text-[9px] font-medium tracking-wide shadow-xs ${getMaterialBadgeClass(p.material)}`}
                    >
                      {p.material}
                    </span>
                  </div>
                  <Button
                    variant="link"
                    onClick={() => open(p)}
                    className="text-foreground p-0 h-auto whitespace-normal justify-start text-left mt-4 text-xs font-medium"
                  >
                    {p.name}
                  </Button>
                  <div className="flex gap-2 items-center mt-2 flex-wrap">
                    {p.is_on_sale && (
                      <del className="text-muted-foreground text-[10px]">{money(p.price)}</del>
                    )}
                    <span className="font-semibold text-sm">{money(priceOf(p))}</span>
                  </div>
                  {p.sizes.length > 0 && (
                    <div
                      className="mt-2.5 flex flex-wrap gap-1.5"
                      role="group"
                      aria-label={`Tamanhos de ${p.name}`}
                    >
                      {p.sizes.map((size) => {
                        const isSelected = activeSize === size;
                        return (
                          <button
                            key={size}
                            type="button"
                            disabled={!p.in_stock}
                            aria-pressed={isSelected}
                            onClick={() =>
                              setSelectedSizes((prev) => ({
                                ...prev,
                                [p.id]: size,
                              }))
                            }
                            className={`min-w-7 rounded border px-2 py-1 text-[10px] font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                              isSelected
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border bg-background text-foreground hover:border-primary/60 hover:text-primary"
                            }`}
                          >
                            {size}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <div className="mt-auto pt-3">
                    <Button
                      variant="editorial"
                      className="w-full text-[10px] h-9 gap-2 px-1"
                      disabled={!p.in_stock}
                      onClick={() => add(p, activeSize)}
                    >
                      <Plus size={13} />
                      {p.in_stock ? "Adicionar à sacola" : "Indisponível"}
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
          {loading && filteredProducts.length === 0 ? (
            <p className="py-16 text-center text-muted-foreground">Carregando vitrine...</p>
          ) : error && filteredProducts.length === 0 ? (
            <p className="py-16 text-center text-muted-foreground">
              Não foi possível carregar o catálogo no momento.
            </p>
          ) : (
            filteredProducts.length === 0 && (
              <p className="py-16 text-center text-muted-foreground">Nenhuma peça encontrada.</p>
            )
          )}
          {filteredProducts.length > 0 && (
            <div className="mt-10 flex flex-col items-center gap-4">
              <p className="text-center text-xs text-muted-foreground">
                Exibindo {visibleProducts.length} de {filteredProducts.length}{" "}
                {filteredProducts.length === 1 ? "peça" : "peças"}
              </p>
              {visibleCount < filteredProducts.length && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setVisibleCount((prev) => prev + PRODUCTS_PER_PAGE)}
                  className="min-h-11 px-8 rounded-full border-primary bg-transparent text-primary text-xs font-medium tracking-wide transition-colors hover:bg-primary hover:text-primary-foreground"
                >
                  Ver mais {nextBatchCount} {nextBatchCount === 1 ? "peça" : "peças"}
                </Button>
              )}
            </div>
          )}
        </section>
        <section id="envios-entregas" className="bg-muted py-16">
          <div className="shell">
            <div className="text-center">
              <p className="eyebrow text-primary mb-3">Da nossa curadoria para você</p>
              <h2 className="section-title">Comprar é simples. Encantar-se também.</h2>
            </div>
            <div className="grid md:grid-cols-3 gap-9 mt-12">
              {[
                "Escolha suas peças na vitrine",
                "Envie sua sacola pelo WhatsApp",
                "Combine frete e pagamento",
              ].map((t, i) => (
                <div key={t} className="text-center">
                  <span className="font-display text-primary text-4xl">0{i + 1}</span>
                  <h3 className="text-2xl mt-4">{t}</h3>
                  <p className="text-xs text-muted-foreground leading-6 mt-2">
                    {
                      [
                        "Descubra os detalhes e reúna seus favoritos na sacola.",
                        "Seu pedido chega prontinho para nosso atendimento.",
                        "Atendimento personalizado, do pedido até a entrega.",
                      ][i]
                    }
                  </p>
                </div>
              ))}
            </div>
            <div
              className={`grid ${
                hasPhysicalStore ? "md:grid-cols-2 lg:grid-cols-4" : "md:grid-cols-3"
              } gap-8 border-t mt-12 pt-8 text-xs text-muted-foreground`}
            >
              <div>
                <Truck size={21} className="text-primary mb-3" />
                <h3 className="text-xl text-foreground">Enviamos para todo o Brasil</h3>
                <p className="leading-6 mt-2">
                  Envio seguro pelos Correios ou transportadora, com código de rastreio para
                  acompanhar sua encomenda.
                </p>
              </div>
              {hasPhysicalStore && physicalStore && (
                <div>
                  <MapPin size={21} className="text-primary mb-3" />
                  <h3 className="text-xl text-foreground">{physicalStore.title}</h3>
                  <p className="leading-6 mt-2">
                    {physicalStore.address}
                    <br />
                    {physicalStore.cityState}
                  </p>
                  <a
                    href={mapsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-primary font-medium mt-2.5 hover:underline"
                  >
                    Ver no mapa <ArrowRight size={12} />
                  </a>
                </div>
              )}
              <div>
                <CreditCard size={21} className="text-primary mb-3" />
                <h3 className="text-xl text-foreground">Pagamento do seu jeito</h3>
                <p className="leading-6 mt-2">
                  Pix ou cartão de crédito. Combinamos todos os detalhes diretamente no atendimento.
                </p>
              </div>
              <div>
                <ShieldCheck size={21} className="text-primary mb-3" />
                <h3 className="text-xl text-foreground">
                  {isModa || isCalcados ? "Cuidados e atendimento" : "Cuidados e garantia"}
                </h3>
                {careItems.map(([question, answer]) => (
                  <details key={question} className="border-b py-3">
                    <summary className="cursor-pointer">{question}</summary>
                    <p className="leading-6 mt-2">{answer}</p>
                  </details>
                ))}
              </div>
            </div>
          </div>
        </section>
        <section id="sobre" className="shell py-20 text-center max-w-3xl">
          <Sparkles className="mx-auto text-primary mb-5" size={25} />
          <p className="eyebrow text-primary mb-3">Nossa essência</p>
          <h2 className="section-title">{aboutTitle}</h2>
          <p className="text-sm text-muted-foreground leading-8 mt-6">{aboutText}</p>
          <a
            href={STORE_CONFIG.instagramUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-block font-display italic text-2xl mt-6 text-foreground hover:text-primary transition-colors"
          >
            {STORE_CONFIG.instagramHandle}
          </a>
        </section>
      </main>
      <footer className="bg-secondary/60 border-t pt-10 pb-24 md:pb-8">
        <div className="shell grid md:grid-cols-[1fr_1fr_1fr] gap-6 items-center">
          <div>
            <img
              src="/logo.png"
              alt={STORE_CONFIG.name}
              className="h-12 sm:h-14 w-auto object-contain"
            />
            {STORE_CONFIG.tagline && (
              <p className="text-[11px] text-muted-foreground mt-3">{STORE_CONFIG.tagline}</p>
            )}
          </div>
          <div className="text-xs text-muted-foreground md:text-center leading-7">
            {hasPhysicalStore && physicalStore ? (
              <>
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-primary transition-colors"
                >
                  {physicalStore.address} · {physicalStore.cityState}
                </a>
                <br />
                Enviamos para todo o Brasil · {STORE_CONFIG.whatsappDisplay}
              </>
            ) : (
              <>
                Loja 100% Online · {STORE_CONFIG.whatsappDisplay}
                <br />
                Enviamos para todo o Brasil
              </>
            )}
          </div>
          <div className="flex md:justify-end gap-3">
            <Button variant="ghost" size="icon" asChild>
              <a
                href={STORE_CONFIG.instagramUrl}
                aria-label={`Instagram ${STORE_CONFIG.instagramHandle}`}
                target="_blank"
                rel="noreferrer"
              >
                <Instagram />
              </a>
            </Button>
            <Button variant="ghost" size="icon" asChild>
              <a
                href={whatsappHref}
                aria-label={`WhatsApp ${STORE_CONFIG.whatsappDisplay}`}
                target="_blank"
                rel="noreferrer"
              >
                <MessageCircle />
              </a>
            </Button>
          </div>
        </div>
        <div className="shell mt-8 pt-5 border-t">
          <div className="grid grid-cols-1 md:grid-cols-3 items-center gap-3 text-center text-[11px] text-muted-foreground">
            <p className="order-2 md:order-1 md:text-left md:justify-self-start">
              Feito por{" "}
              <a
                href="https://instagram.com/ryan.devbr"
                target="_blank"
                rel="noopener noreferrer"
                className="transition-colors hover:text-primary"
              >
                @ryan.devbr
              </a>
            </p>
            <p className="order-1 md:order-2 md:text-center md:justify-self-center">
              © {new Date().getFullYear()} {STORE_CONFIG.name}. Todos os direitos reservados.
            </p>
            <Link
              to="/login"
              className="order-3 inline-flex items-center justify-center gap-1.5 shrink-0 justify-self-center md:justify-self-end md:text-right md:pr-20 transition-colors hover:text-foreground"
            >
              <LockKeyhole size={12} />
              Área restrita
            </Link>
          </div>
        </div>
      </footer>
      <Button className="floating-chat" asChild>
        <a
          href={whatsappHref}
          aria-label="Conversar pelo WhatsApp"
          target="_blank"
          rel="noreferrer"
        >
          <MessageCircle className="size-6!" />
        </a>
      </Button>
      <Dialog open={!!product} onOpenChange={(v) => !v && open(null)}>
        <DialogContent className="modal-product" onOpenAutoFocus={(e) => e.preventDefault()}>
          {product && (
            <div className="modal-scroll">
              <img
                src={product.image_url}
                alt={product.name}
                className="w-full object-contain max-h-[55dvh] bg-muted"
              />
              <div className="p-6">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-medium tracking-wide ${getMaterialBadgeClass(product.material)}`}
                  >
                    {materialLabel}: {product.material}
                  </span>
                  <span className="eyebrow text-muted-foreground">{product.category}</span>
                </div>
                <DialogTitle className="font-display text-3xl">{product.name}</DialogTitle>
                <div className="flex items-center gap-3 mt-4">
                  {product.is_on_sale && (
                    <del className="text-muted-foreground text-sm">{money(product.price)}</del>
                  )}
                  <strong className="text-xl">{money(priceOf(product))}</strong>
                </div>
                {product.is_on_sale && (
                  <p className="text-primary text-xs mt-2">
                    Economize {money(product.price - product.sale_price)}
                  </p>
                )}
                {product.sizes.length > 0 && (
                  <div className="mt-5">
                    <p className="text-xs font-medium text-foreground mb-2">
                      Tamanho{" "}
                      {getActiveSize(product) ? (
                        <span className="text-primary font-semibold">
                          · {getActiveSize(product)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground font-normal">
                          (selecione uma opção)
                        </span>
                      )}
                    </p>
                    <div
                      className="flex flex-wrap gap-2"
                      role="group"
                      aria-label="Selecionar tamanho"
                    >
                      {product.sizes.map((size) => {
                        const isSelected = getActiveSize(product) === size;
                        return (
                          <button
                            key={size}
                            type="button"
                            disabled={!product.in_stock}
                            aria-pressed={isSelected}
                            onClick={() =>
                              setSelectedSizes((prev) => ({
                                ...prev,
                                [product.id]: size,
                              }))
                            }
                            className={`min-h-9 min-w-10 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                              isSelected
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border bg-background text-foreground hover:border-primary/60 hover:text-primary"
                            }`}
                          >
                            {size}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                <DialogDescription className="mt-5 leading-7 text-sm">
                  {product.description}
                </DialogDescription>
                <dl className="mt-5 text-xs">
                  {product.characteristics.map((c, i) => (
                    <div className="flex justify-between py-3 border-b" key={i}>
                      <dt className="text-muted-foreground">
                        {isModa && c.attribute.trim().toLowerCase() === "material"
                          ? "Tecido"
                          : c.attribute}
                      </dt>
                      <dd>{c.value}</dd>
                    </div>
                  ))}
                </dl>
                <div className="flex gap-2 mt-6">
                  <Button
                    className="flex-1"
                    size="lg"
                    onClick={() => {
                      if (product.in_stock) add(product, getActiveSize(product));
                      else
                        window.open(
                          getWhatsappUrl(
                            `Olá! Gostaria de ser avisada quando ${product.name} estiver disponível.`,
                          ),
                          "_blank",
                          "noopener,noreferrer",
                        );
                    }}
                  >
                    <ShoppingBag />
                    {product.in_stock ? "Adicionar à sacola" : "Avise-me no WhatsApp"}
                  </Button>
                  <Button
                    variant="outline"
                    size="lg"
                    aria-label="Compartilhar"
                    onClick={() => share(product)}
                  >
                    <Share2 />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={bag} onOpenChange={setBag}>
        <DialogContent variant="drawer" onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogTitle className="font-display text-3xl">
            Sua sacola <span className="text-primary">({count})</span>
          </DialogTitle>
          <DialogDescription className="text-xs mt-2">
            {isModa || isCalcados
              ? "Suas escolhas favoritas prontas para finalizar."
              : "Um brilho especial está a caminho."}
          </DialogDescription>
          <div className="flex-1 overflow-y-auto min-h-0 py-5">
            {!cart.length ? (
              <div className="text-center py-14">
                <ShoppingBag className="mx-auto text-muted-foreground mb-5" size={40} />
                <p className="text-sm text-muted-foreground">
                  Sua sacola está esperando seus favoritos.
                </p>
                <Button
                  className="mt-5"
                  onClick={() => {
                    setBag(false);
                    scroll("Todos");
                  }}
                >
                  Explorar a vitrine <ArrowRight />
                </Button>
              </div>
            ) : (
              <>
                {cart.map((i) => {
                  const rowKey = getCartItemKey(i.product.id, i.selectedSize);
                  return (
                    <div key={rowKey} className="flex gap-4 border-b py-4">
                      <img
                        src={i.product.image_url}
                        alt={i.product.name}
                        className="w-20 h-24 object-cover"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold">{i.product.name}</p>
                        {i.selectedSize && (
                          <p className="text-[11px] font-medium text-primary mt-0.5">
                            Tamanho: {i.selectedSize}
                          </p>
                        )}
                        <p className="text-[10px] text-muted-foreground mt-1">
                          {materialLabel}: {i.product.material}
                        </p>
                        <p className="text-xs mt-2">{money(priceOf(i.product))}</p>
                        <div className="flex items-center justify-between mt-2">
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-7 w-7"
                              aria-label={`Diminuir ${i.product.name}`}
                              onClick={() =>
                                setCart((c) =>
                                  c.flatMap((row) =>
                                    getCartItemKey(row.product.id, row.selectedSize) === rowKey
                                      ? row.quantity > 1
                                        ? [{ ...row, quantity: row.quantity - 1 }]
                                        : []
                                      : [row],
                                  ),
                                )
                              }
                            >
                              <Minus size={12} />
                            </Button>
                            <span className="text-xs">{i.quantity}</span>
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-7 w-7"
                              aria-label={`Aumentar ${i.product.name}`}
                              onClick={() =>
                                setCart((c) =>
                                  c.map((row) =>
                                    getCartItemKey(row.product.id, row.selectedSize) === rowKey
                                      ? { ...row, quantity: row.quantity + 1 }
                                      : row,
                                  ),
                                )
                              }
                            >
                              <Plus size={12} />
                            </Button>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Remover ${i.product.name}`}
                            onClick={() =>
                              setCart((c) =>
                                c.filter(
                                  (row) =>
                                    getCartItemKey(row.product.id, row.selectedSize) !== rowKey,
                                ),
                              )
                            }
                          >
                            <Trash2 size={14} />
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div className="mt-6">
                  <label>
                    Cupom de desconto
                    <div className="flex gap-2">
                      <input
                        aria-label="Cupom de desconto"
                        placeholder="Seu cupom"
                        value={code}
                        onChange={(e) => setCode(normalizeCode(e.target.value))}
                      />
                      <Button
                        className="h-auto"
                        variant="outline"
                        onClick={() => {
                          const found = data.coupons.find((c) => c.code === normalizeCode(code));
                          const result = calculateCoupon(cart, found);
                          if (result.error) toast.error(result.error);
                          else {
                            setApplied(normalizeCode(code));
                            toast.success("Cupom aplicado!");
                          }
                        }}
                      >
                        Aplicar
                      </Button>
                    </div>
                  </label>
                  {applied && (
                    <div className="mt-2 text-xs">
                      <div className="flex items-center justify-between text-primary">
                        <span>
                          <Check size={12} className="inline mr-1" />
                          {applied}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Remover cupom"
                          onClick={() => setApplied("")}
                        >
                          <X />
                        </Button>
                      </div>
                      {totals.error ? (
                        <p className="text-destructive">{totals.error}</p>
                      ) : (
                        totals.mixed && (
                          <p className="text-muted-foreground">
                            Cupom aplicado apenas nos itens sem promoção.
                          </p>
                        )
                      )}
                    </div>
                  )}
                  <div className="grid gap-3 mt-5">
                    <label>
                      Seu nome (opcional)
                      <input value={name} onChange={(e) => setName(e.target.value)} />
                    </label>
                    <label>
                      CEP ou Cidade/UF (opcional)
                      <input value={city} onChange={(e) => setCity(e.target.value)} />
                    </label>
                  </div>
                </div>
              </>
            )}
          </div>
          {cart.length > 0 && (
            <div className="border-t pt-5 space-y-3">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Subtotal</span>
                <span>{money(subtotal)}</span>
              </div>
              {discount > 0 && (
                <div className="flex justify-between text-xs text-primary">
                  <span>Desconto ({applied})</span>
                  <span>− {money(discount)}</span>
                </div>
              )}
              <div className="flex justify-between font-semibold">
                <span>Total estimado</span>
                <span>{money(total)}</span>
              </div>
              <p className="text-[10px] text-muted-foreground">
                {hasPhysicalStore
                  ? "Frete ou retirada presencial combinados no atendimento pelo WhatsApp"
                  : "Frete calculado no atendimento pelo WhatsApp"}
              </p>
              <Button size="lg" className="w-full text-xs" onClick={checkout}>
                <MessageCircle />
                Finalizar pedido no WhatsApp <ArrowRight />
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
