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
  SlidersHorizontal,
  Sparkles,
  Loader2,
  X,
  Save,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useStore } from "@/services/storeService";
import {
  mergeOptionValues,
  optionLookupKey,
  useCatalogOptions,
  type CatalogOptionType,
} from "@/services/catalogOptionsService";
import { analyzeProductWithAi, isAnalyzableImageUrl } from "@/services/aiProductService";
import { getAuthState, signOutAdmin, subscribeAuthChanges } from "@/services/authService";
import {
  deleteStoreImage,
  uploadOriginalBannerImage,
  uploadStoreImage,
} from "@/services/storageService";
import {
  money,
  priceOf,
  type AdminProfile,
  type Product,
  type Coupon,
  type Banner,
  type StoreAnnouncement,
} from "@/data/catalog";
import { normalizeCode } from "@/services/couponService";

function ensureOptionPresent(options: string[], current: string | undefined): string[] {
  if (!current) return options;
  return options.includes(current) ? options : [...options, current];
}

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

  const {
    categories: categoryOptions,
    materials: materialOptions,
    categoryNames,
    materialNames,
    addOption,
    removeOption,
  } = useCatalogOptions({ enabled: allowed });

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
  const [mobileSizeInfo, setMobileSizeInfo] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [autoFillOnUpload, setAutoFillOnUpload] = useState(true);
  const [analyzingAi, setAnalyzingAi] = useState(false);
  const [inlineOptionType, setInlineOptionType] = useState<CatalogOptionType | null>(null);
  const [inlineOptionValue, setInlineOptionValue] = useState("");
  const [savingOption, setSavingOption] = useState(false);
  const [manageOptionsOpen, setManageOptionsOpen] = useState(false);
  const [manageCategoryInput, setManageCategoryInput] = useState("");
  const [manageMaterialInput, setManageMaterialInput] = useState("");
  const [removingOptionId, setRemovingOptionId] = useState<string | null>(null);
  const [announcementDraft, setAnnouncementDraft] = useState<StoreAnnouncement>(data.announcement);
  const [profileDraft, setProfileDraft] = useState<AdminProfile>(data.profile);
  const pendingUploadsRef = useRef<string[]>([]);
  const lastProductFileRef = useRef<File | null>(null);
  const productModalSessionRef = useRef(0);

  const cleanupPendingUploads = (keepUrls?: string | string[]) => {
    const kept = new Set(
      (Array.isArray(keepUrls) ? keepUrls : keepUrls ? [keepUrls] : []).filter(Boolean),
    );
    const toDelete = pendingUploadsRef.current.filter((url) => url && !kept.has(url));
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

  async function runAiAnalysis(options: {
    mode: "auto" | "manual";
    file?: File | null;
    imageUrl?: string;
  }) {
    const sessionId = productModalSessionRef.current;
    const fileToUse = options.file !== undefined ? options.file : lastProductFileRef.current;
    const urlToUse = options.imageUrl ?? edit?.image_url ?? "";

    if (!fileToUse && !isAnalyzableImageUrl(urlToUse)) {
      toast.error("Envie uma foto ou informe uma URL válida antes de analisar com IA.");
      return;
    }

    const availableCategories =
      formCategories.length > 0 ? formCategories : mergeOptionValues(categoryNames);
    const availableMaterials =
      formMaterials.length > 0 ? formMaterials : mergeOptionValues(materialNames);

    setAnalyzingAi(true);
    try {
      const analysis = await analyzeProductWithAi({
        file: fileToUse,
        imageUrl: urlToUse,
        availableCategories,
        availableMaterials,
      });

      if (sessionId !== productModalSessionRef.current) return;

      setEdit((prev) => {
        if (!prev) return prev;

        const validCategories = ensureOptionPresent(
          mergeOptionValues(categoryNames, prev.category ? [prev.category] : []),
          prev.category,
        );
        const validMaterials = ensureOptionPresent(
          mergeOptionValues(materialNames, prev.material ? [prev.material] : []),
          prev.material,
        );

        const matchedCategory = analysis.category
          ? validCategories.find((c) => optionLookupKey(c) === optionLookupKey(analysis.category))
          : undefined;
        const matchedMaterial = analysis.material
          ? validMaterials.find((m) => optionLookupKey(m) === optionLookupKey(analysis.material))
          : undefined;

        const aiChars = analysis.characteristics.map((item) => ({
          attribute: item.label,
          value: item.value,
        }));

        let nextCharacteristics = prev.characteristics;
        if (aiChars.length > 0) {
          if (options.mode === "manual") {
            nextCharacteristics = aiChars;
          } else {
            const hasFilled = prev.characteristics.some(
              (row) => row.attribute.trim() !== "" || row.value.trim() !== "",
            );
            if (!hasFilled) {
              nextCharacteristics = aiChars;
            } else {
              const usedKeys = new Set(
                prev.characteristics.map((row) => optionLookupKey(row.attribute)).filter(Boolean),
              );
              const remainingAi = aiChars.filter(
                (item) => !usedKeys.has(optionLookupKey(item.attribute)),
              );
              let cursor = 0;
              nextCharacteristics = prev.characteristics.map((row) => {
                if (row.attribute.trim() !== "" || row.value.trim() !== "") return row;
                const replacement = remainingAi[cursor++];
                return replacement ?? row;
              });
            }
          }
        }

        return {
          ...prev,
          name: analysis.name || prev.name,
          category: matchedCategory ?? prev.category,
          material: matchedMaterial ?? prev.material,
          description: analysis.description || prev.description,
          characteristics: nextCharacteristics,
        };
      });

      toast.success("Campos preenchidos com IA! Revise o material e informe o preço.");
    } catch (err) {
      if (sessionId !== productModalSessionRef.current) return;
      toast.error(err instanceof Error ? err.message : "Erro ao analisar a peça com IA.");
    } finally {
      if (sessionId === productModalSessionRef.current) {
        setAnalyzingAi(false);
      }
    }
  }

  async function upload(file: File, kind: "product" | "banner" | "banner-mobile" | "profile") {
    const sessionId = productModalSessionRef.current;
    setUploading(true);
    try {
      const result =
        kind === "banner" || kind === "banner-mobile"
          ? await uploadOriginalBannerImage(file)
          : await uploadStoreImage(file, kind === "product" ? "products" : "profiles");
      if (kind === "banner" || kind === "banner-mobile") {
        const sizeLabel =
          result.original >= 1024 * 1024
            ? `${(result.original / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`
            : `${Math.round(result.original / 1024)} KB`;
        pendingUploadsRef.current.push(result.url);
        if (kind === "banner") {
          setSizeInfo(sizeLabel);
          setBanner((prev) => (prev ? { ...prev, image_url: result.url } : prev));
        } else {
          setMobileSizeInfo(sizeLabel);
          setBanner((prev) => (prev ? { ...prev, mobile_image_url: result.url } : prev));
        }
      } else {
        setSizeInfo(
          `${Math.round(result.original / 1024)} KB → ${Math.round(result.compressed / 1024)} KB`,
        );
      }
      if (kind === "product") {
        lastProductFileRef.current = file;
        pendingUploadsRef.current.push(result.url);
        setEdit((prev) => (prev ? { ...prev, image_url: result.url } : prev));
        if (autoFillOnUpload && sessionId === productModalSessionRef.current) {
          void runAiAnalysis({ mode: "auto", file, imageUrl: result.url });
        }
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

  const handleCreateInlineOption = async (type: CatalogOptionType) => {
    setSavingOption(true);
    try {
      const created = await addOption(type, inlineOptionValue);
      setEdit((prev) =>
        prev
          ? type === "category"
            ? { ...prev, category: created.name }
            : { ...prev, material: created.name }
          : prev,
      );
      setInlineOptionType(null);
      setInlineOptionValue("");
      toast.success(type === "category" ? "Categoria adicionada!" : "Material adicionado!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar a opção.");
    } finally {
      setSavingOption(false);
    }
  };

  const handleCreateManagedOption = async (type: CatalogOptionType) => {
    const rawValue = type === "category" ? manageCategoryInput : manageMaterialInput;
    setSavingOption(true);
    try {
      await addOption(type, rawValue);
      if (type === "category") setManageCategoryInput("");
      else setManageMaterialInput("");
      toast.success(type === "category" ? "Categoria adicionada!" : "Material adicionado!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar a opção.");
    } finally {
      setSavingOption(false);
    }
  };

  const handleRemoveManagedOption = async (id: string, type: CatalogOptionType) => {
    setRemovingOptionId(id);
    try {
      await removeOption(id);
      toast.success(
        type === "category" ? "Categoria removida da lista." : "Material removido da lista.",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao remover opção.");
    } finally {
      setRemovingOptionId(null);
    }
  };

  const newProduct = () => {
    productModalSessionRef.current += 1;
    lastProductFileRef.current = null;
    setAnalyzingAi(false);
    setAutoFillOnUpload(true);
    setSizeInfo("");
    setInlineOptionType(null);
    setInlineOptionValue("");
    const defaultCategory = categoryNames.includes("Brincos")
      ? "Brincos"
      : (categoryNames[0] ?? "Brincos");
    const defaultMaterial = materialNames.includes("Semijoia")
      ? "Semijoia"
      : (materialNames[0] ?? "Semijoia");
    setEdit({
      id: crypto.randomUUID(),
      name: "",
      sku: "",
      category: defaultCategory,
      material: defaultMaterial,
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

  const filterCategories = mergeOptionValues(
    categoryNames,
    data.products.map((p) => p.category),
  );
  const filterMaterials = mergeOptionValues(
    materialNames,
    data.products.map((p) => p.material),
  );
  const formCategories = ensureOptionPresent(
    mergeOptionValues(categoryNames, edit?.category ? [edit.category] : []),
    edit?.category,
  );
  const formMaterials = ensureOptionPresent(
    mergeOptionValues(materialNames, edit?.material ? [edit.material] : []),
    edit?.material,
  );
  const bannerFilterOptions = ensureOptionPresent(
    [
      "Promoções",
      ...mergeOptionValues([
        ...materialNames,
        ...categoryNames,
        ...data.products.flatMap((p) => [p.material, p.category]),
      ]),
    ],
    banner?.filter || undefined,
  );

  const list = data.products.filter(
    (p) =>
      `${p.name} ${p.sku}`.toLowerCase().includes(query.toLowerCase()) &&
      (!category || optionLookupKey(p.category) === optionLookupKey(category)) &&
      (!material || optionLookupKey(p.material) === optionLookupKey(material)) &&
      (!status ||
        (status === "active" ? p.active : status === "inactive" ? !p.active : !p.in_stock)) &&
      (!sale || p.is_on_sale),
  );

  if (!allowed) return null;

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b">
        <div className="shell h-17 md:h-20 flex items-center justify-between gap-3">
          <img
            src="/logo.png"
            alt="Use Camile Acessórios"
            className="h-11 sm:h-12 md:h-14 w-auto shrink-0 object-contain"
          />
          <div className="flex gap-2 shrink-0">
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
                <Search
                  className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted-foreground"
                  size={18}
                />
                <input
                  className="w-full pl-10!"
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
                {filterCategories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <select
                aria-label="Material"
                value={material}
                onChange={(e) => setMaterial(e.target.value)}
              >
                <option value="">Todos os materiais</option>
                {filterMaterials.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
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
            <div className="mt-3 flex justify-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setManageOptionsOpen(true)}
              >
                <SlidersHorizontal size={13} />
                Gerenciar categorias e materiais
              </Button>
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
                        productModalSessionRef.current += 1;
                        lastProductFileRef.current = null;
                        setAnalyzingAi(false);
                        setAutoFillOnUpload(false);
                        setEdit(structuredClone(p));
                        setSizeInfo("");
                        setInlineOptionType(null);
                        setInlineOptionValue("");
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
                  setMobileSizeInfo("");
                  setBanner({
                    id: crypto.randomUUID(),
                    image_url: "",
                    mobile_image_url: "",
                    alt: "Banner Use Camile Acessórios",
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
                <img
                  src={b.image_url}
                  alt={b.alt || "Banner Use Camile Acessórios"}
                  className="w-full h-20 object-cover"
                />
                <div>
                  <p className="text-sm font-medium">Banner {i + 1}</p>
                  <p className="text-xs text-muted-foreground mt-2">
                    Ordem {i + 1} · {b.filter || "Sem filtro"}
                    {b.mobile_image_url?.trim() ? " · Com imagem mobile" : ""}
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
                      setMobileSizeInfo("");
                      setBanner({
                        ...b,
                        mobile_image_url: b.mobile_image_url ?? "",
                        display_order: b.display_order ?? i,
                      });
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
            productModalSessionRef.current += 1;
            lastProductFileRef.current = null;
            setAnalyzingAi(false);
            cleanupPendingUploads();
            setInlineOptionType(null);
            setInlineOptionValue("");
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
              <div className="rounded-lg border bg-muted/40 p-4 space-y-3">
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
                    className="h-40 w-full rounded object-contain bg-background border"
                  />
                )}
                {uploading && <p className="text-xs text-muted-foreground">Enviando foto...</p>}
                {sizeInfo && <p className="text-xs text-primary">Foto comprimida: {sizeInfo}</p>}
                <label>
                  Ou URL da foto
                  <input
                    value={edit.image_url.startsWith("data:") ? "" : edit.image_url}
                    onChange={(e) => {
                      lastProductFileRef.current = null;
                      setEdit({ ...edit, image_url: e.target.value });
                    }}
                    placeholder="https://..."
                  />
                </label>
                <div className="pt-2 border-t space-y-2.5">
                  <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoFillOnUpload}
                      onChange={(e) => setAutoFillOnUpload(e.target.checked)}
                    />
                    Preencher automaticamente ao enviar foto
                  </label>
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full h-11 gap-2 border border-primary/25 bg-primary/10 text-primary hover:bg-primary/15"
                    disabled={
                      uploading ||
                      analyzingAi ||
                      (!lastProductFileRef.current && !isAnalyzableImageUrl(edit.image_url))
                    }
                    onClick={() => void runAiAnalysis({ mode: "manual" })}
                  >
                    {analyzingAi ? (
                      <>
                        <Loader2 className="animate-spin" size={16} />
                        Analisando a peça com IA...
                      </>
                    ) : (
                      <>
                        <Sparkles size={16} />
                        Preencher detalhes com IA
                      </>
                    )}
                  </Button>
                </div>
              </div>
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
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor="product-category" className="text-xs text-muted-foreground">
                      Categoria
                    </label>
                    <button
                      type="button"
                      className="text-[11px] font-medium text-primary hover:underline cursor-pointer"
                      onClick={() => {
                        setInlineOptionType((prev) => (prev === "category" ? null : "category"));
                        setInlineOptionValue("");
                      }}
                    >
                      + Nova
                    </button>
                  </div>
                  <select
                    id="product-category"
                    value={edit.category}
                    onChange={(e) => setEdit({ ...edit, category: e.target.value })}
                  >
                    {formCategories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  {inlineOptionType === "category" && (
                    <div className="rounded-md border bg-muted/60 p-2.5 space-y-2">
                      <input
                        type="text"
                        aria-label="Nova categoria"
                        className="text-base h-10"
                        placeholder="Ex.: Tornozeleiras"
                        value={inlineOptionValue}
                        onChange={(e) => setInlineOptionValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void handleCreateInlineOption("category");
                          } else if (e.key === "Escape") {
                            setInlineOptionType(null);
                            setInlineOptionValue("");
                          }
                        }}
                        autoFocus
                      />
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          className="flex-1"
                          disabled={savingOption}
                          onClick={() => void handleCreateInlineOption("category")}
                        >
                          {savingOption ? "Salvando..." : "Salvar"}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={savingOption}
                          onClick={() => {
                            setInlineOptionType(null);
                            setInlineOptionValue("");
                          }}
                        >
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor="product-material" className="text-xs text-muted-foreground">
                      Material
                    </label>
                    <button
                      type="button"
                      className="text-[11px] font-medium text-primary hover:underline cursor-pointer"
                      onClick={() => {
                        setInlineOptionType((prev) => (prev === "material" ? null : "material"));
                        setInlineOptionValue("");
                      }}
                    >
                      + Novo
                    </button>
                  </div>
                  <select
                    id="product-material"
                    value={edit.material}
                    onChange={(e) => setEdit({ ...edit, material: e.target.value })}
                  >
                    {formMaterials.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                  {inlineOptionType === "material" && (
                    <div className="rounded-md border bg-muted/60 p-2.5 space-y-2">
                      <input
                        type="text"
                        aria-label="Novo material"
                        className="text-base h-10"
                        placeholder="Ex.: Aço Inox, Ródio Branco"
                        value={inlineOptionValue}
                        onChange={(e) => setInlineOptionValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void handleCreateInlineOption("material");
                          } else if (e.key === "Escape") {
                            setInlineOptionType(null);
                            setInlineOptionValue("");
                          }
                        }}
                        autoFocus
                      />
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          className="flex-1"
                          disabled={savingOption}
                          onClick={() => void handleCreateInlineOption("material")}
                        >
                          {savingOption ? "Salvando..." : "Salvar"}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={savingOption}
                          onClick={() => {
                            setInlineOptionType(null);
                            setInlineOptionValue("");
                          }}
                        >
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex justify-end -mt-2">
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                  onClick={() => setManageOptionsOpen(true)}
                >
                  <SlidersHorizontal size={12} />
                  Gerenciar opções
                </button>
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
              <div className="rounded-lg border bg-muted/30 p-3.5 space-y-3">
                <label>
                  Foto principal (Desktop — 16:9)
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
                    alt="Prévia do banner principal"
                    className="w-full h-36 object-contain bg-muted rounded"
                  />
                )}
                {uploading && <p className="text-xs text-muted-foreground">Enviando foto...</p>}
                {sizeInfo && (
                  <p className="text-xs text-muted-foreground">Arquivo original ({sizeInfo})</p>
                )}
                <label>
                  Ou URL da imagem
                  <input
                    value={banner.image_url.startsWith("data:") ? "" : banner.image_url}
                    onChange={(e) => setBanner({ ...banner, image_url: e.target.value })}
                    placeholder="https://..."
                  />
                </label>
              </div>
              <div className="rounded-lg border bg-muted/30 p-3.5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">
                    Imagem para Celular (opcional — 4:5 ou 1:1)
                  </span>
                  {banner.mobile_image_url && (
                    <button
                      type="button"
                      className="text-[11px] text-destructive hover:underline cursor-pointer"
                      onClick={() => {
                        setMobileSizeInfo("");
                        setBanner({ ...banner, mobile_image_url: "" });
                      }}
                    >
                      Remover
                    </button>
                  )}
                </div>
                <input
                  type="file"
                  aria-label="Imagem para Celular (opcional — 4:5 ou 1:1)"
                  accept="image/*"
                  disabled={uploading}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void upload(f, "banner-mobile");
                  }}
                />
                {banner.mobile_image_url && (
                  <img
                    src={banner.mobile_image_url}
                    alt="Prévia do banner para celular"
                    className="w-full h-36 object-contain bg-muted rounded"
                  />
                )}
                {mobileSizeInfo && (
                  <p className="text-xs text-muted-foreground">
                    Arquivo original mobile ({mobileSizeInfo})
                  </p>
                )}
                <label>
                  Ou URL da imagem para celular
                  <input
                    value={
                      (banner.mobile_image_url ?? "").startsWith("data:")
                        ? ""
                        : (banner.mobile_image_url ?? "")
                    }
                    onChange={(e) => setBanner({ ...banner, mobile_image_url: e.target.value })}
                    placeholder="Deixe vazio para usar a imagem principal"
                  />
                </label>
              </div>
              <label>
                Filtro de destino
                <select
                  value={banner.filter}
                  onChange={(e) => setBanner({ ...banner, filter: e.target.value })}
                >
                  <option value="">Sem filtro</option>
                  {bannerFilterOptions.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
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
                  if (!banner.image_url.trim()) {
                    toast.error("Adicione a foto principal do banner.");
                    return;
                  }
                  setSaving(true);
                  try {
                    await saveBanner({
                      ...banner,
                      alt: banner.alt.trim() || "Banner Use Camile Acessórios",
                    });
                    cleanupPendingUploads([banner.image_url, banner.mobile_image_url ?? ""]);
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
      <Dialog open={manageOptionsOpen} onOpenChange={setManageOptionsOpen}>
        <DialogContent className="max-h-[88dvh] overflow-hidden flex flex-col w-[calc(100%-24px)] max-w-lg">
          <DialogTitle className="font-display text-3xl">Categorias e materiais</DialogTitle>
          <DialogDescription>
            Adicione ou remova opções da lista de seleção. Produtos já cadastrados mantêm o texto
            salvo mesmo se uma opção for excluída.
          </DialogDescription>
          <div className="overflow-y-auto min-h-0 space-y-6 pr-1">
            <section className="space-y-3">
              <h3 className="text-xl">Categorias</h3>
              <div className="flex gap-2">
                <input
                  type="text"
                  aria-label="Adicionar categoria"
                  className="text-base h-10"
                  placeholder="Nova categoria..."
                  value={manageCategoryInput}
                  onChange={(e) => setManageCategoryInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleCreateManagedOption("category");
                    }
                  }}
                />
                <Button
                  type="button"
                  size="sm"
                  className="h-10 px-4 shrink-0"
                  disabled={savingOption}
                  onClick={() => void handleCreateManagedOption("category")}
                >
                  <Plus size={14} />
                  Adicionar
                </Button>
              </div>
              <div className="divide-y border rounded-md">
                {categoryOptions.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                  >
                    <span className="truncate">{item.name}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                      disabled={removingOptionId === item.id}
                      aria-label={`Excluir categoria ${item.name}`}
                      onClick={() => void handleRemoveManagedOption(item.id, "category")}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                ))}
                {categoryOptions.length === 0 && (
                  <p className="px-3 py-4 text-xs text-muted-foreground text-center">
                    Nenhuma categoria cadastrada.
                  </p>
                )}
              </div>
            </section>
            <section className="space-y-3">
              <h3 className="text-xl">Materiais</h3>
              <div className="flex gap-2">
                <input
                  type="text"
                  aria-label="Adicionar material"
                  className="text-base h-10"
                  placeholder="Novo material..."
                  value={manageMaterialInput}
                  onChange={(e) => setManageMaterialInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleCreateManagedOption("material");
                    }
                  }}
                />
                <Button
                  type="button"
                  size="sm"
                  className="h-10 px-4 shrink-0"
                  disabled={savingOption}
                  onClick={() => void handleCreateManagedOption("material")}
                >
                  <Plus size={14} />
                  Adicionar
                </Button>
              </div>
              <div className="divide-y border rounded-md">
                {materialOptions.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                  >
                    <span className="truncate">{item.name}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                      disabled={removingOptionId === item.id}
                      aria-label={`Excluir material ${item.name}`}
                      onClick={() => void handleRemoveManagedOption(item.id, "material")}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                ))}
                {materialOptions.length === 0 && (
                  <p className="px-3 py-4 text-xs text-muted-foreground text-center">
                    Nenhum material cadastrado.
                  </p>
                )}
              </div>
            </section>
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
