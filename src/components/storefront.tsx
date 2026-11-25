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
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useStore } from "@/services/storeService";
import {
  mergeOptionValues,
  optionLookupKey,
  useCatalogOptions,
} from "@/services/catalogOptionsService";
import { calculateCoupon, normalizeCode, type CartItem } from "@/services/couponService";
import { money, priceOf, type Product } from "@/data/catalog";
import { storeContent } from "@/data/storeContent";

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

const PRODUCTS_PER_PAGE = 16;

export function Storefront() {
  const { data, loading, error } = useStore({ scope: "public" });
  const { categoryNames, materialNames } = useCatalogOptions();
  const [filter, setFilter] = useState("Todos");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("featured");
  const [visibleCount, setVisibleCount] = useState(PRODUCTS_PER_PAGE);
  const [product, setProduct] = useState<Product | null>(null);
  const [bag, setBag] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [ready, setReady] = useState(false);
  const [code, setCode] = useState("");
  const [applied, setApplied] = useState("");
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [slide, setSlide] = useState(0);
  useEffect(() => {
    try {
      setCart(JSON.parse(localStorage.getItem("camile-bag") ?? "[]"));
    } catch {}
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    const id = new URL(window.location.href).searchParams.get("produto");
    if (id) {
      const p = data.products.find((p) => p.id === id && p.active);
      if (p) {
        setProduct(p);
        document.getElementById("vitrine")?.scrollIntoView();
      }
    }
  }, [ready, data.products]);
  useEffect(() => {
    if (ready) localStorage.setItem("camile-bag", JSON.stringify(cart));
  }, [cart, ready]);
  useEffect(() => {
    setVisibleCount(PRODUCTS_PER_PAGE);
  }, [filter, query, sort]);
  const banners = data.banners.filter((b) => b.active);
  const currentSlide = banners.length > 0 ? slide % banners.length : 0;
  const activeBanner = banners[currentSlide];
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || banners.length < 2) return;
    const timer = setInterval(() => setSlide((s) => (s + 1) % banners.length), 3000);
    return () => clearInterval(timer);
  }, [banners.length]);
  function open(p: Product | null) {
    setProduct(p);
    const url = new URL(window.location.href);
    if (p) url.searchParams.set("produto", p.id);
    else url.searchParams.delete("produto");
    window.history.replaceState({}, "", url);
  }
  function add(p: Product) {
    if (!p.in_stock) return;
    setCart((c) => {
      const old = c.find((i) => i.product.id === p.id);
      return old
        ? c.map((i) => (i.product.id === p.id ? { ...i, quantity: i.quantity + 1 } : i))
        : [...c, { product: p, quantity: 1 }];
    });
    toast.success("Peça adicionada à sacola");
  }
  const activeProducts = data.products.filter((p) => p.active);
  const dynamicMaterials = mergeOptionValues(
    materialNames,
    activeProducts.map((p) => p.material),
  );
  const dynamicCategories = mergeOptionValues(
    categoryNames,
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
      if (navigator.share) await navigator.share({ title: p.name, text: storeContent.name, url });
      else {
        await navigator.clipboard.writeText(url);
        toast.success("Link copiado!");
      }
    } catch {}
  }
  const checkout = () => {
    const lines = [
      "Olá, Use Camile Acessórios! ✨",
      "Gostaria de finalizar meu pedido feito pelo site:",
      "",
      cart
        .map(
          (i) =>
            `• *${i.product.name}* (${i.product.material})${i.product.is_on_sale ? " (Promoção)" : ""} — Qtd: ${i.quantity} — ${money(priceOf(i.product) * i.quantity)}`,
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
      "Aguardo para combinarmos o frete e a forma de pagamento!",
    ];
    window.open(
      `${storeContent.whatsapp}?text=${encodeURIComponent(lines.join("\n"))}`,
      "_blank",
      "noopener,noreferrer",
    );
  };
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
            aria-label="Use Camile — início"
            className="inline-flex items-center shrink-0"
          >
            <img
              src="/logo.png"
              alt="Use Camile Acessórios"
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
          <div
            className={`hero-media ${
              activeBanner?.mobile_image_url?.trim()
                ? "aspect-4/5 max-h-115 md:aspect-auto md:max-h-none"
                : "aspect-16/10 md:aspect-auto"
            }`}
          >
            {banners.map((b, i) => {
              const mobileUrl = b.mobile_image_url?.trim() ?? "";
              return (
                <picture
                  key={b.id}
                  className={`hero-photo block ${i === currentSlide ? "opacity-100" : "opacity-0 pointer-events-none"}`}
                  onClick={() => b.filter && scroll(b.filter)}
                >
                  {mobileUrl && <source media="(max-width: 767px)" srcSet={mobileUrl} />}
                  <img
                    src={b.image_url}
                    alt={b.alt || "Banner Use Camile Acessórios"}
                    className={`w-full h-full object-cover ${
                      mobileUrl ? "object-center" : "object-[72%_center] md:object-center"
                    }`}
                    loading={i === 0 ? "eager" : "lazy"}
                    fetchPriority={i === 0 ? "high" : "auto"}
                    decoding="async"
                  />
                </picture>
              );
            })}
            <div className="hero-scrim pointer-events-none" />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-0 h-7 bg-linear-to-t from-[#FAF8FB] to-transparent md:hidden"
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
          <div className="shell hero-content bg-[#FAF8FB] md:bg-transparent pointer-events-none">
            <div className="max-w-127.5 pointer-events-auto">
              <p className="eyebrow text-[#7A6A66] md:text-muted-foreground flex gap-2 items-center mb-4 md:mb-5">
                <Sparkles size={15} className="text-[#C91E7C] md:text-primary" /> Delicadeza que faz
                a diferença
              </p>
              <h1 className="text-[#3D3533] md:text-foreground">
                Invista em você:
                <br />
                acessórios são a<br />
                <em className="text-[#C91E7C] md:text-primary">alma do look!</em>
              </h1>
              <p className="text-[#5C514E] md:text-muted-foreground text-sm leading-7 mt-4 md:mt-6 max-w-98.75">
                Prata 925 e Semijoias selecionadas para realçar o seu estilo. Peças especiais, para
                todos os seus momentos.
              </p>
              <div className="flex flex-wrap gap-3 mt-6 md:mt-7">
                <Button size="lg" onClick={() => scroll("Todos")}>
                  Ver vitrine <ArrowRight />
                </Button>
                <Button size="lg" variant="editorial" asChild>
                  <a href={storeContent.whatsapp} target="_blank" rel="noreferrer">
                    <MessageCircle />
                    Chamar no WhatsApp
                  </a>
                </Button>
              </div>
              <a
                href="#envios-entregas"
                className="inline-flex gap-2 items-center text-[11px] text-[#5C514E] md:text-muted-foreground mt-5"
              >
                <Truck size={14} />
                Envios e entregas <ArrowRight size={12} />
              </a>
            </div>
          </div>
        </section>
        <div className="bg-background border-b">
          <div className="shell grid grid-cols-2 md:grid-cols-4 py-6 gap-5 text-[11px] text-muted-foreground">
            {[
              [Truck, "Para todo o Brasil"],
              [Sparkles, "Prata 925 & Semijoias"],
              [Heart, "Curadoria feita com carinho"],
              [ShieldCheck, "Atendimento personalizado"],
            ].map(([Icon, text], i) => {
              const C = Icon as typeof Truck;
              return (
                <div key={i} className="flex justify-center items-center gap-2">
                  <C size={17} className="text-primary shrink-0" />
                  <span>{text as string}</span>
                </div>
              );
            })}
          </div>
        </div>
        <section id="vitrine" className="shell pt-16 pb-20">
          <div className="text-center">
            <p className="eyebrow text-primary mb-3">Encontre seu próximo favorito</p>
            <h2 className="section-title">Um brilho para chamar de seu</h2>
            <p className="text-sm text-muted-foreground mt-3">
              Pequenos detalhes. Grandes encantos.
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
            {visibleProducts.map((p) => (
              <article key={p.id}>
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
                <Button
                  variant="editorial"
                  className="w-full text-[10px] mt-3 h-9 gap-2 px-1"
                  disabled={!p.in_stock}
                  onClick={() => add(p)}
                >
                  <Plus size={13} />
                  {p.in_stock ? "Adicionar à sacola" : "Indisponível"}
                </Button>
              </article>
            ))}
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
                  className="min-h-11 px-8 rounded-full border-[#C91E7C] bg-transparent text-[#C91E7C] text-xs font-medium tracking-wide transition-colors hover:bg-[#C91E7C] hover:text-white"
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
            <div className="grid md:grid-cols-3 gap-8 border-t mt-12 pt-8 text-xs text-muted-foreground">
              <div>
                <Truck size={21} className="text-primary mb-3" />
                <h3 className="text-xl text-foreground">Enviamos para todo o Brasil</h3>
                <p className="leading-6 mt-2">
                  Envio seguro pelos Correios ou transportadora, com código de rastreio para
                  acompanhar sua encomenda.
                </p>
              </div>
              <div>
                <CreditCard size={21} className="text-primary mb-3" />
                <h3 className="text-xl text-foreground">Pagamento do seu jeito</h3>
                <p className="leading-6 mt-2">
                  Pix ou cartão de crédito. Combinamos todos os detalhes diretamente no atendimento.
                </p>
              </div>
              <div>
                <ShieldCheck size={21} className="text-primary mb-3" />
                <h3 className="text-xl text-foreground">Cuidados e garantia</h3>
                {[
                  "Como cuidar da Prata 925?",
                  "Como cuidar das Semijoias?",
                  "Sobre a garantia",
                ].map((q, i) => (
                  <details key={q} className="border-b py-3">
                    <summary className="cursor-pointer">{q}</summary>
                    <p className="leading-6 mt-2">
                      {
                        [
                          "Limpe com flanela macia e guarde em local seco, separada de outras peças.",
                          "Evite perfumes, produtos químicos, banho e piscina. Guarde cada peça individualmente.",
                          "Consulte as condições e os prazos de cada peça em nosso atendimento pelo WhatsApp.",
                        ][i]
                      }
                    </p>
                  </details>
                ))}
              </div>
            </div>
          </div>
        </section>
        <section id="sobre" className="shell py-20 text-center max-w-3xl">
          <Sparkles className="mx-auto text-primary mb-5" size={25} />
          <p className="eyebrow text-primary mb-3">Nossa essência</p>
          <h2 className="section-title">Mais que acessórios, um pouco de você.</h2>
          <p className="text-sm text-muted-foreground leading-8 mt-6">{storeContent.about}</p>
          <a
            href="https://instagram.com/echileyvasconcelos"
            target="_blank"
            rel="noreferrer"
            className="block font-display italic text-2xl mt-6"
          >
            Com carinho, Echiley
          </a>
        </section>
      </main>
      <footer className="bg-secondary/60 border-t pt-10 pb-24 md:pb-8">
        <div className="shell grid md:grid-cols-[1fr_1fr_1fr] gap-6 items-center">
          <div>
            <img
              src="/logo.png"
              alt="Use Camile Acessórios"
              className="h-12 sm:h-14 w-auto object-contain"
            />
            <p className="text-[11px] text-muted-foreground mt-3">Seu estilo merece esse brilho.</p>
          </div>
          <div className="text-xs text-muted-foreground md:text-center leading-7">
            Loja 100% Online
            <br />
            Enviamos para todo o Brasil
          </div>
          <div className="flex md:justify-end gap-3">
            <Button variant="ghost" size="icon" asChild>
              <a
                href={storeContent.instagram}
                aria-label="Instagram"
                target="_blank"
                rel="noreferrer"
              >
                <Instagram />
              </a>
            </Button>
            <Button variant="ghost" size="icon" asChild>
              <a
                href={storeContent.whatsapp}
                aria-label="WhatsApp"
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
                className="transition-colors hover:text-[#C91E7C]"
              >
                @ryan.devbr
              </a>
            </p>
            <p className="order-1 md:order-2 md:text-center md:justify-self-center">
              © 2026 Use Camile Acessórios. Todos os direitos reservados.
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
          href={storeContent.whatsapp}
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
                    {product.material}
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
                <DialogDescription className="mt-5 leading-7 text-sm">
                  {product.description}
                </DialogDescription>
                <dl className="mt-5 text-xs">
                  {product.characteristics.map((c, i) => (
                    <div className="flex justify-between py-3 border-b" key={i}>
                      <dt className="text-muted-foreground">{c.attribute}</dt>
                      <dd>{c.value}</dd>
                    </div>
                  ))}
                </dl>
                <div className="flex gap-2 mt-6">
                  <Button
                    className="flex-1"
                    size="lg"
                    onClick={() => {
                      if (product.in_stock) add(product);
                      else
                        window.open(
                          `${storeContent.whatsapp}?text=${encodeURIComponent(`Olá! Gostaria de ser avisada quando ${product.name} estiver disponível.`)}`,
                          "_blank",
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
            Um brilho especial está a caminho.
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
                {cart.map((i) => (
                  <div key={i.product.id} className="flex gap-4 border-b py-4">
                    <img
                      src={i.product.image_url}
                      alt={i.product.name}
                      className="w-20 h-24 object-cover"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold">{i.product.name}</p>
                      <p className="text-[10px] text-muted-foreground mt-1">{i.product.material}</p>
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
                                  row.product.id === i.product.id
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
                                  row.product.id === i.product.id
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
                            setCart((c) => c.filter((row) => row.product.id !== i.product.id))
                          }
                        >
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
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
                Frete calculado no atendimento pelo WhatsApp
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
