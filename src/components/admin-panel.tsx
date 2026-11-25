import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Plus,
  Pencil,
  Copy,
  Trash2,
  ExternalLink,
  LogOut,
  Search,
  Link as LinkIcon,
  ArrowUp,
  ArrowDown,
  UserRound,
  X,
  Save,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useStore } from "@/services/storeService";
import { getAuthState, signOutAdmin, subscribeAuthChanges } from "@/services/authService";
import { deleteStoreImage, uploadStoreImage } from "@/services/storageService";
import {
  money,
  priceOf,
  categoriesList,
  type AdminProfile,
  type Product,
  type Coupon,
  type Banner,
  type StoreAnnouncement,
} from "@/data/catalog";
import { normalizeCode } from "@/services/couponService";

export function AdminPanel() {
  const navigate = useNavigate();
  const [allowed, setAllowed] = useState(false);
  const {
    data,
    loading,
    error,
    isRemote,
    saveProduct,
    toggleProductField,
    duplicateProduct,
    deleteProduct,
    saveBanner,
    reorderBanners,
    deleteBanner,
    saveAnnouncement,
    saveCoupon,
    deleteCoupon,
    saveProfile,
  } = useStore({ scope: "admin", enabled: allowed });

  const [tab, setTab] = useState("Produtos");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [material, setMaterial] = useState("");
  const [status, setStatus] = useState("");
  const [sale, setSale] = useState(false);
  const [edit, setEdit] = useState<Product | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [coupon, setCoupon] = useState<Coupon | null>(null);
  const [confirm, setConfirm] = useState<{
    kind: "products" | "banners" | "coupons";
    id: string;
  } | null>(null);
  const [profile, setProfile] = useState(false);
  const [sizeInfo, setSizeInfo] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [announcementDraft, setAnnouncementDraft] = useState<StoreAnnouncement>(data.announcement);
  const [profileDraft, setProfileDraft] = useState<AdminProfile>(data.profile);
  const pendingUploadsRef = useRef<string[]>([]);

  const cleanupPendingUploads = (keepUrl?: string) => {
    const toDelete = pendingUploadsRef.current.filter((url) => url && url !== keepUrl);
    pendingUploadsRef.current = [];
    for (const url of toDelete) {
      void deleteStoreImage(url);
    }
  };

  useEffect(() => {
    setAnnouncementDraft(data.announcement);
  }, [data.announcement]);

  useEffect(() => {
    setProfileDraft(data.profile);
  }, [data.profile]);

  useEffect(() => {
    let active = true;
    void getAuthState().then((state) => {
      if (!active) return;
      if (!state.authenticated) {
        void navigate({ to: "/login" });
      } else {
        setAllowed(true);
      }
    });

    const unsubscribe = subscribeAuthChanges((state) => {
      if (!state.authenticated) {
        setAllowed(false);
        void navigate({ to: "/login" });
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [navigate]);

  const handleSaveProduct = async () => {
    if (!edit) return;
    if (!edit.name.trim() || edit.price <= 0) {
      toast.error("Informe o nome e um preço válido.");
      return;
    }
    if (edit.is_on_sale && (edit.sale_price <= 0 || edit.sale_price >= edit.price)) {
      toast.error("O preço promocional deve ser menor que o original.");
      return;
    }

    setSaving(true);
    try {
      await saveProduct(edit);
      cleanupPendingUploads(edit.image_url);
      setEdit(null);
      toast.success("Produto salvo!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar produto.");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleProduct = async (p: Product, key: "active" | "featured" | "in_stock") => {
    try {
      await toggleProductField(p, key);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao atualizar produto.");
    }
  };

  async function upload(file: File, kind: "product" | "banner" | "profile") {
    setUploading(true);
    try {
      const folder = kind === "product" ? "products" : kind === "banner" ? "banners" : "profiles";
      const result = await uploadStoreImage(file, folder);
      setSizeInfo(
        `${Math.round(result.original / 1024)} KB → ${Math.round(result.compressed / 1024)} KB`,
      );
      if (kind === "product") {
        pendingUploadsRef.current.push(result.url);
        setEdit((prev) => (prev ? { ...prev, image_url: result.url } : prev));
      }
      if (kind === "banner") {
        pendingUploadsRef.current.push(result.url);
        setBanner((prev) => (prev ? { ...prev, image_url: result.url } : prev));
      }
      if (kind === "profile") {
        const nextProfile = { ...profileDraft, avatar: result.url };
        setProfileDraft(nextProfile);
        await saveProfile(nextProfile);
        toast.success("Foto de perfil atualizada!");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível preparar a foto.");
    } finally {
      setUploading(false);
    }
  }

  const newProduct = () => {
    setSizeInfo("");
    setEdit({
      id: crypto.randomUUID(),
      name: "",
      sku: "",
      category: "Brincos",
      material: "Semijoia",
      price: 0,
      sale_price: 0,
      is_on_sale: false,
      sale_label: "",
      image_url: "",
      description: "",
      active: true,
      featured: false,
      in_stock: true,
      characteristics: [],
    });
  };

  const list = data.products.filter(
    (p) =>
      `${p.name} ${p.sku}`.toLowerCase().includes(query.toLowerCase()) &&
      (!category || p.category === category) &&
      (!material || p.material === material) &&
      (!status ||
        (status === "active" ? p.active : status === "inactive" ? !p.active : !p.in_stock)) &&
      (!sale || p.is_on_sale),
  );

  if (!allowed) return null;

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b">
        <div className="shell py-4 grid grid-cols-[minmax(0,1fr)_auto] items-center">
          <img src="/logo.png" alt="Use Camile Acessórios" className="brand-logo" />
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="icon"
              title="Perfil"
              aria-label="Perfil da administradora"
              onClick={() => setProfile(true)}
            >
              <UserRound />
            </Button>
            <Button variant="outline" asChild>
              <a href="/" target="_blank" rel="noreferrer">
                <ExternalLink />
                <span className="hidden sm:inline">Ver loja</span>
              </a>
            </Button>
            <Button
              variant="ghost"
              aria-label="Sair"
              onClick={async () => {
                try {
                  await signOutAdmin();
                  await navigate({ to: "/login" });
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Erro ao sair.");
                }
              }}
            >
              <LogOut />
              <span className="hidden sm:inline">Sair</span>
            </Button>
          </div>
        </div>
      </header>
      <div className="shell py-9">
        <div className="flex justify-between items-center">
          <div>
            <p className="eyebrow text-primary mb-2">Seu espaço de cuidado</p>
            <h1 className="text-4xl">Olá, {data.profile.name}.</h1>
          </div>
          <span className="text-[10px] text-primary bg-secondary px-3 py-2 rounded">
            {isRemote ? "Supabase conectado" : "Demonstração local"}
          </span>
        </div>
        {error && (
          <p className="mt-4 rounded border border-destructive/40 bg-destructive/5 px-4 py-3 text-xs text-destructive">
            {error}
          </p>
        )}
        <div className="flex gap-3 border-b mt-8 mb-8">
          {["Produtos", "Banners", "Cupons"].map((t) => (
            <Button
              key={t}
              variant="ghost"
              className={`rounded-none px-5 h-12 ${tab === t ? "border-b-2 border-primary text-primary" : ""}`}
              onClick={() => setTab(t)}
            >
              {t}
            </Button>
          ))}
        </div>
        {loading && isRemote && data.products.length === 0 && (
          <p className="text-sm text-muted-foreground py-8">Carregando dados da loja...</p>
        )}
        {tab === "Produtos" && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-5 mb-8">
              {[
                ["Total", data.products.length],
                ["Ativos", data.products.filter((p) => p.active).length],
                ["Em promoção", data.products.filter((p) => p.is_on_sale).length],
                ["Indisponíveis", data.products.filter((p) => !p.in_stock).length],
              ].map(([title, value]) => (
                <div key={title} className="border-b pb-5">
                  <p className="text-xs text-muted-foreground">{title}</p>
                  <p className="font-display text-4xl mt-2">{value}</p>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4">
              <div className="relative">
                <Search className="absolute left-3 top-3 text-muted-foreground" size={18} />
                <input
                  className="pl-10"
                  placeholder="Buscar por nome ou SKU"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <Button className="h-12" onClick={newProduct}>
                <Plus />
                <span className="hidden sm:inline">Novo produto</span>
              </Button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
              <select
                aria-label="Categoria"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">Todas as categorias</option>
                {categoriesList.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <select
                aria-label="Material"
                value={material}
                onChange={(e) => setMaterial(e.target.value)}
              >
                <option value="">Todos os materiais</option>
                <option>Prata 925</option>
                <option>Semijoia</option>
              </select>
              <select
                aria-label="Status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="">Todos os status</option>
                <option value="active">Ativos</option>
                <option value="inactive">Inativos</option>
                <option value="unavailable">Indisponíveis</option>
              </select>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={sale} onChange={(e) => setSale(e.target.checked)} />
                Só promoções
              </label>
            </div>
            <div className="mt-6">
              {list.map((p) => (
                <div className="admin-table" key={p.id}>
                  <img
                    src={p.image_url}
                    alt={p.name}
                    className="w-full aspect-square object-cover rounded"
                  />
                  <div>
                    <p className="text-sm font-medium">{p.name}</p>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {p.sku} · {p.category} · {p.material}
                    </p>
                    <div className="flex gap-3 mt-3 flex-wrap">
                      {(["active", "featured", "in_stock"] as const).map((key, i) => (
                        <label key={key} className="flex items-center gap-1 text-[10px]">
                          <input
                            type="checkbox"
                            checked={p[key]}
                            onChange={() => void handleToggleProduct(p, key)}
                          />
                          {["Ativo", "Destaque", "Disponível"][i]}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="text-xs">
                    {p.is_on_sale && (
                      <del className="text-muted-foreground block">{money(p.price)}</del>
                    )}
                    <strong>{money(priceOf(p))}</strong>
                    {p.is_on_sale && (
                      <p className="text-primary text-[10px] mt-1">
                        {Math.round((1 - p.sale_price / p.price) * 100)}% OFF
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Copiar link para Stories"
                      aria-label={`Copiar link de ${p.name}`}
                      onClick={async () => {
                        await navigator.clipboard.writeText(
                          `${window.location.origin}/?produto=${p.id}`,
                        );
                        toast.success("Link copiado para os Stories!");
                      }}
                    >
                      <LinkIcon />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      title="Editar"
                      aria-label={`Editar ${p.name}`}
                      onClick={() => {
                        setEdit(structuredClone(p));
                        setSizeInfo("");
                      }}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Duplicar"
                      aria-label={`Duplicar ${p.name}`}
                      onClick={async () => {
                        try {
                          await duplicateProduct(p);
                          toast.success("Produto duplicado como inativo.");
                        } catch (err) {
                          toast.error(
                            err instanceof Error ? err.message : "Erro ao duplicar produto.",
                          );
                        }
                      }}
                    >
                      <Copy />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Excluir"
                      aria-label={`Excluir ${p.name}`}
                      onClick={() => setConfirm({ kind: "products", id: p.id })}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            {!loading && !list.length && (
              <p className="text-sm text-muted-foreground text-center py-12">
                Nenhum produto encontrado.
              </p>
            )}
          </>
        )}
        {tab === "Banners" && (
          <>
            <h2 className="text-3xl mb-5">Barra de avisos</h2>
            <div className="grid gap-4 max-w-2xl">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={announcementDraft.active}
                  onChange={async (e) => {
                    const next = { ...announcementDraft, active: e.target.checked };
                    setAnnouncementDraft(next);
                    try {
                      await saveAnnouncement(next);
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Erro ao salvar aviso.");
                    }
                  }}
                />
                Exibir barra de avisos
              </label>
              <label>
                Texto do aviso
                <input
                  value={announcementDraft.text}
                  onChange={(e) =>
                    setAnnouncementDraft({ ...announcementDraft, text: e.target.value })
                  }
                />
              </label>
              <label>
                Ação / link
                <input
                  value={announcementDraft.link}
                  onChange={(e) =>
                    setAnnouncementDraft({ ...announcementDraft, link: e.target.value })
                  }
                />
              </label>
              <Button
                className="w-fit"
                disabled={saving}
                onClick={async () => {
                  setSaving(true);
                  try {
                    await saveAnnouncement(announcementDraft);
                    toast.success("Aviso salvo!");
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Erro ao salvar aviso.");
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                <Save />
                {saving ? "Salvando..." : "Salvar aviso"}
              </Button>
            </div>
            <div className="flex justify-between items-center mt-12 mb-6">
              <h2 className="text-3xl">Fotos de destaque</h2>
              <Button
                onClick={() => {
                  setSizeInfo("");
                  setBanner({
                    id: crypto.randomUUID(),
                    image_url: "",
                    alt: "",
                    active: true,
                    filter: "",
                    display_order: data.banners.length,
                  });
                }}
              >
                <Plus />
                Novo banner
              </Button>
            </div>
            {data.banners.map((b, i) => (
              <div
                key={b.id}
                className="grid grid-cols-[80px_minmax(0,1fr)] md:grid-cols-[120px_minmax(0,1fr)_auto] gap-5 py-5 border-b items-center"
              >
                <img src={b.image_url} alt={b.alt} className="w-full h-20 object-cover" />
                <div>
                  <p className="text-sm">{b.alt}</p>
                  <p className="text-xs text-muted-foreground mt-2">
                    Ordem {i + 1} · {b.filter || "Sem filtro"}
                  </p>
                  <label className="flex gap-2 items-center mt-2">
                    <input
                      type="checkbox"
                      checked={b.active}
                      onChange={async (e) => {
                        try {
                          await saveBanner({ ...b, active: e.target.checked, display_order: i });
                        } catch (err) {
                          toast.error(
                            err instanceof Error ? err.message : "Erro ao atualizar banner.",
                          );
                        }
                      }}
                    />
                    Ativo
                  </label>
                </div>
                <div className="flex gap-1 col-start-2 md:col-auto">
                  {[
                    [-1, ArrowUp],
                    [1, ArrowDown],
                  ].map(([delta, Icon], n) => {
                    const I = Icon as typeof ArrowUp;
                    return (
                      <Button
                        key={n}
                        variant="ghost"
                        size="icon"
                        disabled={i + Number(delta) < 0 || i + Number(delta) >= data.banners.length}
                        aria-label={n ? "Mover abaixo" : "Mover acima"}
                        onClick={async () => {
                          const arr = [...data.banners];
                          const other = arr[i + Number(delta)];
                          if (!other) return;
                          arr[i] = other;
                          arr[i + Number(delta)] = b;
                          try {
                            await reorderBanners(arr);
                          } catch (err) {
                            toast.error(
                              err instanceof Error ? err.message : "Erro ao reordenar banners.",
                            );
                          }
                        }}
                      >
                        <I />
                      </Button>
                    );
                  })}
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Editar banner"
                    onClick={() => {
                      setSizeInfo("");
                      setBanner({ ...b, display_order: b.display_order ?? i });
                    }}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Excluir banner"
                    onClick={() => setConfirm({ kind: "banners", id: b.id })}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
            ))}
          </>
        )}
        {tab === "Cupons" && (
          <>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-3xl">Cupons de carinho</h2>
              <Button
                onClick={() =>
                  setCoupon({
                    id: crypto.randomUUID(),
                    code: "",
                    type: "percent",
                    value: 10,
                    min_order_value: 0,
                    expires_at: "",
                    active: true,
                    allow_on_sale: false,
                  })
                }
              >
                <Plus />
                Novo cupom
              </Button>
            </div>
            {data.coupons.map((c) => (
              <div key={c.id} className="border-b py-6 grid grid-cols-[minmax(0,1fr)_auto] gap-4">
                <div>
                  <p className="font-semibold text-primary">{c.code}</p>
                  <p className="text-xs text-muted-foreground mt-2">
                    {c.type === "percent" ? `${c.value}% OFF` : `${money(c.value)} OFF`} · Pedido
                    mínimo {money(c.min_order_value)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-2">
                    {c.expires_at
                      ? `Validade: ${c.expires_at.split("-").reverse().join("/")}`
                      : "Sem data de validade"}{" "}
                    · {c.allow_on_sale ? "Acumula com promoções" : "Não acumula com promoções"}
                  </p>
                  <label className="flex gap-2 items-center mt-3">
                    <input
                      type="checkbox"
                      checked={c.active}
                      onChange={async (e) => {
                        try {
                          await saveCoupon({ ...c, active: e.target.checked });
                        } catch (err) {
                          toast.error(
                            err instanceof Error ? err.message : "Erro ao atualizar cupom.",
                          );
                        }
                      }}
                    />
                    Ativo
                  </label>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={`Editar ${c.code}`}
                    onClick={() => setCoupon({ ...c })}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Excluir ${c.code}`}
                    onClick={() => setConfirm({ kind: "coupons", id: c.id })}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
      <Dialog
        open={!!edit}
        onOpenChange={(v) => {
          if (!v) {
            cleanupPendingUploads();
            setEdit(null);
          }
        }}
      >
        <DialogContent
          className="max-h-[90dvh] overflow-hidden flex flex-col w-[calc(100%-24px)] max-w-2xl"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <DialogTitle className="font-display text-3xl">
            {data.products.some((p) => p.id === edit?.id) ? "Editar produto" : "Novo produto"}
          </DialogTitle>
          <DialogDescription>Detalhes da peça</DialogDescription>
          {edit && (
            <div className="overflow-y-auto min-h-0 space-y-5 pr-1">
              <div className="field-grid">
                <label>
                  Nome
                  <input
                    value={edit.name}
                    onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                  />
                </label>
                <label>
                  SKU (opcional)
                  <input
                    value={edit.sku}
                    onChange={(e) => setEdit({ ...edit, sku: e.target.value })}
                  />
                </label>
                <label>
                  Categoria
                  <select
                    value={edit.category}
                    onChange={(e) => setEdit({ ...edit, category: e.target.value })}
                  >
                    {categoriesList.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Material
                  <select
                    value={edit.material}
                    onChange={(e) => setEdit({ ...edit, material: e.target.value })}
                  >
                    <option>Prata 925</option>
                    <option>Semijoia</option>
                  </select>
                </label>
              </div>
              <div className="flex gap-4 flex-wrap">
                {(["active", "featured", "in_stock"] as const).map((key, i) => (
                  <label className="flex gap-2 items-center" key={key}>
                    <input
                      type="checkbox"
                      checked={edit[key]}
                      onChange={(e) => setEdit({ ...edit, [key]: e.target.checked })}
                    />
                    {["Ativo na vitrine", "Destaque", "Disponível em estoque"][i]}
                  </label>
                ))}
              </div>
              <label>
                Foto principal
                <input
                  type="file"
                  accept="image/*"
                  disabled={uploading}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void upload(f, "product");
                  }}
                />
              </label>
              {edit.image_url && (
                <img
                  src={edit.image_url}
                  alt="Prévia da peça"
                  className="h-36 w-full object-contain bg-muted"
                />
              )}
              {uploading && <p className="text-xs text-muted-foreground">Enviando foto...</p>}
              {sizeInfo && <p className="text-xs text-primary">Foto comprimida: {sizeInfo}</p>}
              <label>
                Ou URL da foto
                <input
                  value={edit.image_url.startsWith("data:") ? "" : edit.image_url}
                  onChange={(e) => setEdit({ ...edit, image_url: e.target.value })}
                  placeholder="https://..."
                />
              </label>
              <label>
                Descrição
                <textarea
                  rows={3}
                  value={edit.description}
                  onChange={(e) => setEdit({ ...edit, description: e.target.value })}
                />
              </label>
              <div>
                <p className="text-sm mb-3">Características</p>
                {edit.characteristics.map((c, i) => (
                  <div className="flex gap-2 mb-2" key={i}>
                    <input
                      aria-label="Atributo"
                      placeholder="Atributo"
                      value={c.attribute}
                      onChange={(e) =>
                        setEdit({
                          ...edit,
                          characteristics: edit.characteristics.map((row, n) =>
                            n === i ? { ...row, attribute: e.target.value } : row,
                          ),
                        })
                      }
                    />
                    <input
                      aria-label="Valor"
                      placeholder="Valor"
                      value={c.value}
                      onChange={(e) =>
                        setEdit({
                          ...edit,
                          characteristics: edit.characteristics.map((row, n) =>
                            n === i ? { ...row, value: e.target.value } : row,
                          ),
                        })
                      }
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Remover característica"
                      onClick={() =>
                        setEdit({
                          ...edit,
                          characteristics: edit.characteristics.filter((_, n) => n !== i),
                        })
                      }
                    >
                      <X />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  onClick={() =>
                    setEdit({
                      ...edit,
                      characteristics: [...edit.characteristics, { attribute: "", value: "" }],
                    })
                  }
                >
                  <Plus />
                  Adicionar característica
                </Button>
              </div>
              <label>
                Preço original (R$)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={edit.price || ""}
                  onChange={(e) => setEdit({ ...edit, price: Number(e.target.value) })}
                />
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={edit.is_on_sale}
                  onChange={(e) => setEdit({ ...edit, is_on_sale: e.target.checked })}
                />
                Ativar promoção
              </label>
              {edit.is_on_sale && (
                <>
                  <div className="field-grid">
                    <label>
                      Preço promocional (R$)
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={edit.sale_price || ""}
                        onChange={(e) => setEdit({ ...edit, sale_price: Number(e.target.value) })}
                      />
                    </label>
                    <label>
                      Desconto (%)
                      <input
                        type="number"
                        min="0"
                        max="99"
                        value={
                          edit.price ? Math.round((1 - edit.sale_price / edit.price) * 100) : 0
                        }
                        onChange={(e) =>
                          setEdit({
                            ...edit,
                            sale_price:
                              Math.round(edit.price * (1 - Number(e.target.value) / 100) * 100) /
                              100,
                          })
                        }
                      />
                    </label>
                  </div>
                  <label>
                    Etiqueta da promoção
                    <input
                      value={edit.sale_label}
                      onChange={(e) => setEdit({ ...edit, sale_label: e.target.value })}
                    />
                  </label>
                  <p className="text-primary font-semibold">
                    {money(edit.sale_price)}{" "}
                    <del className="text-muted-foreground font-normal text-xs">
                      {money(edit.price)}
                    </del>
                  </p>
                </>
              )}
              <Button
                className="w-full h-12"
                disabled={saving || uploading}
                onClick={() => void handleSaveProduct()}
              >
                <Save />
                {saving ? "Salvando..." : "Salvar produto"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={!!coupon} onOpenChange={(v) => !v && setCoupon(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogTitle className="font-display text-3xl">Cupom</DialogTitle>
          <DialogDescription>Condições de desconto</DialogDescription>
          {coupon && (
            <div className="space-y-4">
              <label>
                Código
                <input
                  value={coupon.code}
                  onChange={(e) => setCoupon({ ...coupon, code: normalizeCode(e.target.value) })}
                />
              </label>
              <label>
                Tipo
                <select
                  value={coupon.type}
                  onChange={(e) =>
                    setCoupon({ ...coupon, type: e.target.value === "fixed" ? "fixed" : "percent" })
                  }
                >
                  <option value="percent">Porcentagem %</option>
                  <option value="fixed">Valor fixo R$</option>
                </select>
              </label>
              <div className="field-grid">
                <label>
                  Valor
                  <input
                    type="number"
                    min="0"
                    value={coupon.value}
                    onChange={(e) => setCoupon({ ...coupon, value: Number(e.target.value) })}
                  />
                </label>
                <label>
                  Pedido mínimo (R$)
                  <input
                    type="number"
                    min="0"
                    value={coupon.min_order_value}
                    onChange={(e) =>
                      setCoupon({ ...coupon, min_order_value: Number(e.target.value) })
                    }
                  />
                </label>
              </div>
              <label>
                Data de validade
                <input
                  type="date"
                  value={coupon.expires_at}
                  onChange={(e) => setCoupon({ ...coupon, expires_at: e.target.value })}
                />
              </label>
              <label className="flex gap-2 items-center">
                <input
                  type="checkbox"
                  checked={coupon.active}
                  onChange={(e) => setCoupon({ ...coupon, active: e.target.checked })}
                />
                Cupom ativo
              </label>
              <label className="flex gap-2 items-center">
                <input
                  type="checkbox"
                  checked={coupon.allow_on_sale}
                  onChange={(e) => setCoupon({ ...coupon, allow_on_sale: e.target.checked })}
                />
                Acumular com produtos em promoção
              </label>
              <Button
                className="w-full"
                disabled={saving}
                onClick={async () => {
                  const normalizedCode = normalizeCode(coupon.code);
                  if (
                    !normalizedCode ||
                    coupon.value <= 0 ||
                    (coupon.type === "percent" && coupon.value > 100) ||
                    data.coupons.some((c) => c.id !== coupon.id && c.code === normalizedCode)
                  ) {
                    toast.error("Confira o código e o valor do cupom.");
                    return;
                  }
                  setSaving(true);
                  try {
                    await saveCoupon({ ...coupon, code: normalizedCode });
                    setCoupon(null);
                    toast.success("Cupom salvo!");
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Erro ao salvar cupom.");
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                <Save />
                {saving ? "Salvando..." : "Salvar cupom"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!banner}
        onOpenChange={(v) => {
          if (!v) {
            cleanupPendingUploads();
            setBanner(null);
          }
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogTitle className="font-display text-3xl">Banner</DialogTitle>
          <DialogDescription>Foto de destaque da loja</DialogDescription>
          {banner && (
            <div className="space-y-4">
              <label>
                Foto
                <input
                  type="file"
                  accept="image/*"
                  disabled={uploading}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void upload(f, "banner");
                  }}
                />
              </label>
              {banner.image_url && (
                <img
                  src={banner.image_url}
                  alt={banner.alt}
                  className="w-full h-36 object-contain bg-muted"
                />
              )}
              {uploading && <p className="text-xs text-muted-foreground">Enviando foto...</p>}
              {sizeInfo && <p className="text-primary text-xs">{sizeInfo}</p>}
              <label>
                Ou URL da imagem
                <input
                  value={banner.image_url.startsWith("data:") ? "" : banner.image_url}
                  onChange={(e) => setBanner({ ...banner, image_url: e.target.value })}
                />
              </label>
              <label>
                Texto alternativo
                <input
                  value={banner.alt}
                  onChange={(e) => setBanner({ ...banner, alt: e.target.value })}
                />
              </label>
              <label>
                Filtro de destino
                <select
                  value={banner.filter}
                  onChange={(e) => setBanner({ ...banner, filter: e.target.value })}
                >
                  <option value="">Sem filtro</option>
                  {["Promoções", "Prata 925", "Semijoias", ...categoriesList].map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
              </label>
              <label className="flex gap-2 items-center">
                <input
                  type="checkbox"
                  checked={banner.active}
                  onChange={(e) => setBanner({ ...banner, active: e.target.checked })}
                />
                Ativo
              </label>
              <Button
                className="w-full"
                disabled={saving || uploading}
                onClick={async () => {
                  if (!banner.image_url.trim() || !banner.alt.trim()) {
                    toast.error("Adicione a foto e o texto alternativo.");
                    return;
                  }
                  setSaving(true);
                  try {
                    await saveBanner(banner);
                    cleanupPendingUploads(banner.image_url);
                    setBanner(null);
                    toast.success("Banner salvo!");
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Erro ao salvar banner.");
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                <Save />
                {saving ? "Salvando..." : "Salvar banner"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={!!confirm} onOpenChange={(v) => !v && setConfirm(null)}>
        <DialogContent>
          <DialogTitle>Excluir este item?</DialogTitle>
          <DialogDescription>Esta ação não pode ser desfeita.</DialogDescription>
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setConfirm(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={saving}
              onClick={async () => {
                if (!confirm) return;
                setSaving(true);
                try {
                  if (confirm.kind === "products") await deleteProduct(confirm.id);
                  else if (confirm.kind === "banners") await deleteBanner(confirm.id);
                  else await deleteCoupon(confirm.id);
                  setConfirm(null);
                  toast.success("Item excluído.");
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Erro ao excluir item.");
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? "Excluindo..." : "Excluir"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={profile} onOpenChange={setProfile}>
        <DialogContent>
          <DialogTitle className="font-display text-3xl">Seu perfil</DialogTitle>
          <DialogDescription>
            {isRemote ? "Dados da administradora" : "Perfil local da administradora"}
          </DialogDescription>
          {profileDraft.avatar && (
            <img
              src={profileDraft.avatar}
              alt="Foto de perfil"
              className="w-20 h-20 object-cover rounded-full"
            />
          )}
          <label>
            Foto
            <input
              type="file"
              accept="image/*"
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f, "profile");
              }}
            />
          </label>
          <label>
            Nome
            <input
              value={profileDraft.name}
              onChange={(e) => setProfileDraft({ ...profileDraft, name: e.target.value })}
            />
          </label>
          <label>
            E-mail
            <input
              type="email"
              value={profileDraft.email}
              onChange={(e) => setProfileDraft({ ...profileDraft, email: e.target.value })}
            />
          </label>
          <Button
            disabled={saving || uploading}
            onClick={async () => {
              setSaving(true);
              try {
                await saveProfile(profileDraft);
                setProfile(false);
                toast.success(isRemote ? "Perfil salvo!" : "Perfil salvo neste navegador.");
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Erro ao salvar perfil.");
              } finally {
                setSaving(false);
              }
            }}
          >
            <Save />
            {saving ? "Salvando..." : "Salvar perfil"}
          </Button>
        </DialogContent>
      </Dialog>
    </main>
  );
}
