import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  ImagePlus,
  Loader2,
  RotateCcw,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  NICHE_CATALOG_DEFAULTS,
  STORE_CONFIG,
  getMaterialLabel,
  getQuickSizesForNiche,
  isFashionNiche,
  isFootwearNiche,
  supportsSizes,
  toggleQuickSize,
} from "@/config/store.config";
import { money, type Product } from "@/data/catalog";
import {
  BATCH_RETRY_ROUNDS,
  NICHE_FALLBACK_DEMO_PRICE,
  buildDemoPromoPricing,
  formatRetryCountdownMessage,
  toCommercialPrice,
  type RetryCountdownState,
} from "@/lib/batch-retry";
import { normalizeImageFile } from "@/lib/normalize-image";
import { analyzeProductWithAi } from "@/services/aiProductService";
import { optionLookupKey } from "@/services/catalogOptionsService";
import { deleteStoreImage, uploadStoreImage } from "@/services/storageService";

type BatchStep = 1 | 2 | 3;
type BatchItemStatus =
  | "queued"
  | "waiting_retry"
  | "analyzing"
  | "uploading"
  | "done"
  | "failed";

interface BatchItem {
  id: string;
  file: File;
  originalName: string;
  previewUrl: string;
  status: BatchItemStatus;
  attempt?: number | undefined;
  uploadedImageUrl?: string | undefined;
  error?: string | undefined;
  productName?: string | undefined;
  resolvedCategory?: string | undefined;
  resolvedMaterial?: string | undefined;
  resolvedPrice?: number | undefined;
  resolvedSalePrice?: number | undefined;
  resolvedIsOnSale?: boolean | undefined;
}

export interface BatchImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categoryNames: string[];
  materialNames: string[];
  saveProduct: (product: Product) => Promise<void>;
  /** Opcional para testes: sobrescreve a duração de 1 segundo da contagem regressiva e intervalos */
  timingScale?: number;
  /** Opcional para testes: sobrescreve STORE_CONFIG.enableAiDemoPricing */
  enableAiDemoPricing?: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitInterruptible(ms: number, shouldStop: () => boolean): Promise<void> {
  if (ms <= 0) return;
  const stepMs = Math.min(100, ms);
  let elapsed = 0;
  while (elapsed < ms && !shouldStop()) {
    const chunk = Math.min(stepMs, ms - elapsed);
    await sleep(chunk);
    elapsed += chunk;
  }
}

function fallbackProductName(filename: string): string {
  const withoutExt = filename.replace(/\.[^.]+$/, "").trim();
  const cleaned = withoutExt.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return (
    cleaned ||
    (isFashionNiche()
      ? `Peça ${STORE_CONFIG.name}`
      : isFootwearNiche()
        ? `Calçado ${STORE_CONFIG.name}`
        : `Acessório ${STORE_CONFIG.name}`)
  );
}

function matchCatalogOption(
  candidate: string | undefined,
  available: string[],
): string | undefined {
  if (!candidate?.trim()) return undefined;
  const key = optionLookupKey(candidate);
  return available.find((item) => optionLookupKey(item) === key);
}

export function BatchImportDialog({
  open,
  onOpenChange,
  categoryNames,
  materialNames,
  saveProduct,
  timingScale = 1,
  enableAiDemoPricing = STORE_CONFIG.enableAiDemoPricing,
}: BatchImportDialogProps) {
  const demoPricingEnabled = enableAiDemoPricing === true;
  const [step, setStep] = useState<BatchStep>(1);
  const [price, setPrice] = useState<string>("");
  const [useAiPricing, setUseAiPricing] = useState<boolean>(demoPricingEnabled);
  const [simulatePromo, setSimulatePromo] = useState<boolean>(demoPricingEnabled);
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [selectedMaterial, setSelectedMaterial] = useState<string>("");
  const [selectedSizes, setSelectedSizes] = useState<string[]>([]);
  const [autoPublish, setAutoPublish] = useState<boolean>(true);
  const [items, setItems] = useState<BatchItem[]>([]);
  const [converting, setConverting] = useState<{ current: number; total: number } | null>(null);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [currentAttempt, setCurrentAttempt] = useState<number>(1);
  const [retryCountdown, setRetryCountdown] = useState<RetryCountdownState | null>(null);

  const aiPricingActive = demoPricingEnabled && useAiPricing;
  const simulatePromoActive = demoPricingEnabled && simulatePromo;
  const showSizes = supportsSizes();
  const availableQuickSizes = getQuickSizesForNiche();
  const nicheDefaults = NICHE_CATALOG_DEFAULTS[STORE_CONFIG.niche];
  const effectiveCategoryNames =
    categoryNames.length > 0 ? categoryNames : [...nicheDefaults.categories];
  const effectiveMaterialNames =
    materialNames.length > 0 ? materialNames : [...nicheDefaults.materials];
  const materialLabel = getMaterialLabel();

  const itemsRef = useRef<BatchItem[]>([]);
  const objectUrlsRef = useRef<Set<string>>(new Set());
  const cancelRequestedRef = useRef<boolean>(false);
  const mountedRef = useRef<boolean>(true);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    mountedRef.current = true;
    const urls = objectUrlsRef.current;
    return () => {
      mountedRef.current = false;
      cancelRequestedRef.current = true;
      for (const item of itemsRef.current) {
        if (item.status !== "done" && item.uploadedImageUrl) {
          void deleteStoreImage(item.uploadedImageUrl);
        }
      }
      for (const url of urls) {
        URL.revokeObjectURL(url);
      }
      urls.clear();
    };
  }, []);

  const parsedPrice = Number(price.replace(",", "."));
  const hasValidPrice = Number.isFinite(parsedPrice) && parsedPrice > 0;
  const canProceedStep1 = aiPricingActive || hasValidPrice;

  const doneCount = items.filter((item) => item.status === "done").length;
  const failedCount = items.filter((item) => item.status === "failed").length;
  const waitingRetryCount = items.filter((item) => item.status === "waiting_retry").length;
  const queuedCount = items.filter((item) => item.status === "queued").length;
  const processedCount = doneCount + failedCount;
  const progressPercent = items.length > 0 ? Math.round((processedCount / items.length) * 100) : 0;

  const clearAllItems = () => {
    for (const item of itemsRef.current) {
      if (item.status !== "done" && item.uploadedImageUrl) {
        void deleteStoreImage(item.uploadedImageUrl);
      }
    }
    for (const url of objectUrlsRef.current) {
      URL.revokeObjectURL(url);
    }
    objectUrlsRef.current.clear();
    itemsRef.current = [];
    setItems([]);
  };

  const resetModal = () => {
    cancelRequestedRef.current = false;
    setStep(1);
    setPrice("");
    setUseAiPricing(demoPricingEnabled);
    setSimulatePromo(demoPricingEnabled);
    setSelectedCategory("");
    setSelectedMaterial("");
    setSelectedSizes([]);
    setAutoPublish(true);
    setConverting(null);
    setIsRunning(false);
    setCurrentAttempt(1);
    setRetryCountdown(null);
    clearAllItems();
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      if (isRunning || converting) {
        toast.info("Aguarde ou pause a fila antes de fechar.");
        return;
      }
      resetModal();
    }
    onOpenChange(nextOpen);
  };

  const applyItems = (updater: (prev: BatchItem[]) => BatchItem[]) => {
    const next = updater(itemsRef.current);
    itemsRef.current = next;
    setItems(next);
  };

  const handleFilesSelected = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const rawFiles = Array.from(fileList);
    setConverting({ current: 0, total: rawFiles.length });

    let failedConversions = 0;
    let addedCount = 0;

    for (let i = 0; i < rawFiles.length; i++) {
      const rawFile = rawFiles[i];
      if (!rawFile || !mountedRef.current) break;

      setConverting({ current: i + 1, total: rawFiles.length });
      try {
        const normalizedFile = await normalizeImageFile(rawFile);
        if (!mountedRef.current) break;
        const previewUrl = URL.createObjectURL(normalizedFile);
        objectUrlsRef.current.add(previewUrl);

        const nextItem: BatchItem = {
          id: crypto.randomUUID(),
          file: normalizedFile,
          originalName: rawFile.name || normalizedFile.name,
          previewUrl,
          status: "queued",
        };
        applyItems((prev) => [...prev, nextItem]);
        addedCount += 1;
      } catch (err) {
        failedConversions += 1;
        toast.error(
          err instanceof Error
            ? err.message
            : `Não foi possível preparar a imagem "${rawFile.name}".`,
        );
      }
    }

    if (mountedRef.current) {
      setConverting(null);
      if (addedCount > 0 && failedConversions === 0) {
        toast.success(
          addedCount === 1
            ? "1 foto pronta para importação."
            : `${addedCount} fotos prontas para importação.`,
        );
      }
    }
  };

  const handleFilesChange = (e: ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files;
    void handleFilesSelected(selected);
    e.target.value = "";
  };

  const removeItem = (id: string) => {
    if (isRunning) return;
    applyItems((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target) {
        if (target.status !== "done" && target.uploadedImageUrl) {
          void deleteStoreImage(target.uploadedImageUrl);
        }
        URL.revokeObjectURL(target.previewUrl);
        objectUrlsRef.current.delete(target.previewUrl);
      }
      return prev.filter((item) => item.id !== id);
    });
  };

  const updateItem = (id: string, updater: (item: BatchItem) => BatchItem) => {
    applyItems((prev) => prev.map((item) => (item.id === id ? updater(item) : item)));
  };

  const runQueue = async (initialTargetIds: string[]) => {
    if (isRunning || initialTargetIds.length === 0) return;

    // Garante que itens já publicados em passagens anteriores nunca sejam duplicados
    let currentRoundIds = initialTargetIds.filter((id) => {
      const found = itemsRef.current.find((item) => item.id === id);
      return found != null && found.status !== "done";
    });
    if (currentRoundIds.length === 0) return;

    cancelRequestedRef.current = false;
    setIsRunning(true);
    setRetryCountdown(null);
    setCurrentAttempt(1);

    const defaultCategory = effectiveCategoryNames[0] ?? nicheDefaults.categories[0] ?? "";
    const defaultMaterial = effectiveMaterialNames[0] ?? nicheDefaults.materials[0] ?? "";
    const safeScale = Math.max(0, timingScale);
    const shouldStop = () => cancelRequestedRef.current || !mountedRef.current;

    // Reseta os itens alvo para a fila antes da 1ª passagem, preservando uploadedImageUrl se já enviada
    const initialSet = new Set(currentRoundIds);
    applyItems((prev) =>
      prev.map((item) =>
        initialSet.has(item.id) && item.status !== "done"
          ? {
              ...item,
              status: "queued" as const,
              attempt: 1,
              error: undefined,
            }
          : item,
      ),
    );

    let totalPublishedInRun = 0;
    let recoveredInRetries = 0;

    for (const round of BATCH_RETRY_ROUNDS) {
      if (shouldStop() || currentRoundIds.length === 0) break;

      if (round.waitSecondsBeforeRound > 0) {
        const roundSet = new Set(currentRoundIds);
        applyItems((prev) =>
          prev.map((item) =>
            roundSet.has(item.id) && item.status !== "done"
              ? {
                  ...item,
                  status: "waiting_retry" as const,
                  attempt: round.attempt,
                }
              : item,
          ),
        );

        const nextAttempt = round.attempt as 2 | 3;
        for (let secondsLeft = round.waitSecondsBeforeRound; secondsLeft >= 1; secondsLeft--) {
          if (shouldStop()) break;
          setRetryCountdown({
            nextAttempt,
            maxAttempts: round.maxAttempts,
            secondsLeft,
            failedCount: currentRoundIds.length,
          });
          await waitInterruptible(1000 * safeScale, shouldStop);
        }

        if (mountedRef.current) {
          setRetryCountdown(null);
        }

        if (shouldStop()) {
          if (mountedRef.current) {
            applyItems((prev) =>
              prev.map((item) =>
                item.status === "waiting_retry" ? { ...item, status: "failed" as const } : item,
              ),
            );
          }
          break;
        }
      }

      setCurrentAttempt(round.attempt);
      const nextRoundFailedIds: string[] = [];

      for (let i = 0; i < currentRoundIds.length; i++) {
        if (shouldStop()) break;
        const itemId = currentRoundIds[i];
        if (!itemId) continue;

        const currentItem = itemsRef.current.find((item) => item.id === itemId);
        if (!currentItem || currentItem.status === "done") continue;

        updateItem(itemId, (item) => ({
          ...item,
          status: "analyzing",
          attempt: round.attempt,
          error: undefined,
        }));

        let uploadedImageUrl = currentItem.uploadedImageUrl ?? "";
        try {
          const analysis = await analyzeProductWithAi({
            file: currentItem.file,
            availableCategories: effectiveCategoryNames,
            availableMaterials: effectiveMaterialNames,
            niche: STORE_CONFIG.niche,
            estimatePrice: aiPricingActive,
          });

          if (!mountedRef.current) break;

          const resolvedCategory =
            selectedCategory ||
            matchCatalogOption(analysis.category, effectiveCategoryNames) ||
            defaultCategory;
          const resolvedMaterial =
            selectedMaterial ||
            matchCatalogOption(analysis.material, effectiveMaterialNames) ||
            defaultMaterial;
          const resolvedName =
            analysis.name.trim() || fallbackProductName(currentItem.originalName);
          const characteristics = analysis.characteristics.map((row) => ({
            attribute: row.label,
            value: row.value,
          }));

          const resolvedPrice = aiPricingActive
            ? typeof analysis.estimatedPrice === "number" &&
              Number.isFinite(analysis.estimatedPrice) &&
              analysis.estimatedPrice > 0
              ? toCommercialPrice(analysis.estimatedPrice)
              : hasValidPrice
                ? toCommercialPrice(parsedPrice)
                : NICHE_FALLBACK_DEMO_PRICE[STORE_CONFIG.niche]
            : parsedPrice;

          const batchIndex = itemsRef.current.findIndex((item) => item.id === itemId);
          const promoPricing = simulatePromoActive
            ? buildDemoPromoPricing(resolvedPrice, batchIndex >= 0 ? batchIndex : i)
            : { is_on_sale: false, sale_price: 0, sale_label: "" };

          updateItem(itemId, (item) => ({
            ...item,
            status: "uploading",
            attempt: round.attempt,
            productName: resolvedName,
            resolvedCategory,
            resolvedMaterial,
            resolvedPrice,
            resolvedSalePrice: promoPricing.sale_price,
            resolvedIsOnSale: promoPricing.is_on_sale,
          }));

          // Faz upload da imagem para o bucket store-media apenas se ainda não tiver sido enviada
          if (!uploadedImageUrl) {
            const uploaded = await uploadStoreImage(currentItem.file, "products");
            uploadedImageUrl = uploaded.url;
            if (mountedRef.current) {
              updateItem(itemId, (item) => ({
                ...item,
                uploadedImageUrl,
              }));
            }
          }

          const productToCreate: Product = {
            id: crypto.randomUUID(),
            name: resolvedName,
            sku: "",
            category: resolvedCategory,
            material: resolvedMaterial,
            price: resolvedPrice,
            sale_price: promoPricing.sale_price,
            is_on_sale: promoPricing.is_on_sale,
            sale_label: promoPricing.sale_label,
            image_url: uploadedImageUrl,
            description: analysis.description.trim(),
            active: autoPublish,
            featured: false,
            in_stock: true,
            characteristics,
            sizes: showSizes ? [...selectedSizes] : [],
          };

          await saveProduct(productToCreate);

          if (!mountedRef.current) break;
          updateItem(itemId, (item) => ({
            ...item,
            status: "done",
            attempt: round.attempt,
            uploadedImageUrl,
            error: undefined,
            productName: resolvedName,
            resolvedCategory,
            resolvedMaterial,
            resolvedPrice,
            resolvedSalePrice: promoPricing.sale_price,
            resolvedIsOnSale: promoPricing.is_on_sale,
          }));
          totalPublishedInRun += 1;
          if (round.attempt > 1) {
            recoveredInRetries += 1;
          }
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Erro inesperado ao importar esta peça.";
          if (!mountedRef.current) break;
          updateItem(itemId, (item) => ({
            ...item,
            status: "failed",
            attempt: round.attempt,
            uploadedImageUrl: uploadedImageUrl || item.uploadedImageUrl,
            error: message,
          }));
          nextRoundFailedIds.push(itemId);
        }

        if (i < currentRoundIds.length - 1 && !shouldStop()) {
          await waitInterruptible(round.itemDelayMs * safeScale, shouldStop);
        }
      }

      if (shouldStop()) {
        if (mountedRef.current) {
          applyItems((prev) =>
            prev.map((item) =>
              item.status === "waiting_retry" ? { ...item, status: "failed" as const } : item,
            ),
          );
        }
        break;
      }

      currentRoundIds = nextRoundFailedIds;
    }

    if (mountedRef.current) {
      setRetryCountdown(null);
      setIsRunning(false);
      const remainingFailed = itemsRef.current.filter((item) => item.status === "failed").length;

      if (cancelRequestedRef.current) {
        toast.info("Fila pausada. Você pode continuar ou reprocessar quando desejar.");
      } else if (remainingFailed === 0 && totalPublishedInRun > 0) {
        if (recoveredInRetries > 0) {
          toast.success(
            `${totalPublishedInRun} produto(s) importado(s) com sucesso (${recoveredInRetries} recuperado(s) na repescagem automática)!`,
          );
        } else {
          toast.success(
            totalPublishedInRun === 1
              ? "1 produto importado com sucesso!"
              : `${totalPublishedInRun} produtos importados com sucesso!`,
          );
        }
      } else if (remainingFailed > 0) {
        toast.error(
          `${totalPublishedInRun} importado(s) e ${remainingFailed} com falha após 3 tentativas. Você pode reprocessar as falhas abaixo.`,
        );
      }
    }
  };

  const startBatch = () => {
    if (!aiPricingActive && !hasValidPrice) {
      toast.error("Informe um preço válido para o lote.");
      setStep(1);
      return;
    }
    if (items.length === 0) {
      toast.error("Selecione ao menos uma foto para importar.");
      return;
    }
    setStep(3);
    const pendingIds = items.filter((item) => item.status !== "done").map((item) => item.id);
    void runQueue(pendingIds);
  };

  const retryFailed = () => {
    const failedIds = items.filter((item) => item.status === "failed").map((item) => item.id);
    if (failedIds.length > 0) {
      void runQueue(failedIds);
    }
  };

  const continueQueued = () => {
    const remainingIds = items.filter((item) => item.status === "queued").map((item) => item.id);
    if (remainingIds.length > 0) {
      void runQueue(remainingIds);
    }
  };

  const renderStatusBadge = (item: BatchItem) => {
    switch (item.status) {
      case "queued":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
            <Clock size={12} />
            Na fila
          </span>
        );
      case "waiting_retry":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-medium text-amber-700">
            <Clock size={12} className="animate-pulse" />
            Aguardando repescagem...
          </span>
        );
      case "analyzing":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
            <Loader2 size={12} className="animate-spin" />
            {item.attempt && item.attempt > 1 ? `Analisando (${item.attempt}/3)...` : "Analisando..."}
          </span>
        );
      case "uploading":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-[11px] font-medium text-foreground">
            <Upload size={12} className="animate-pulse" />
            Enviando...
          </span>
        );
      case "done":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600/10 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
            <CheckCircle2 size={12} />
            Publicado ✓
          </span>
        );
      case "failed":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2.5 py-1 text-[11px] font-medium text-destructive">
            <AlertCircle size={12} />
            Falhou
          </span>
        );
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-h-[90dvh] overflow-hidden flex flex-col w-[calc(100%-24px)] max-w-2xl"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogTitle className="font-display text-3xl flex items-center gap-2">
          <Sparkles size={22} className="text-primary shrink-0" />
          Importar em Lote (IA)
        </DialogTitle>
        <DialogDescription>
          Envie várias fotos de uma vez e deixe a IA preencher nome, descrição e detalhes.
        </DialogDescription>

        <div className="grid grid-cols-3 gap-2 border-y py-3 text-[11px]">
          {[
            [1, "1. Configuração"],
            [2, "2. Fotos"],
            [3, "3. Importação"],
          ].map(([num, label]) => {
            const active = step === num;
            const completed = step > Number(num);
            return (
              <div
                key={String(num)}
                className={`rounded-md px-2.5 py-1.5 text-center font-medium transition-colors ${
                  active
                    ? "bg-primary/10 text-primary border border-primary/25"
                    : completed
                      ? "bg-muted text-foreground"
                      : "bg-muted/40 text-muted-foreground"
                }`}
              >
                {label}
              </div>
            );
          })}
        </div>

        <div className="overflow-y-auto min-h-0 flex-1 space-y-5 pr-1 py-1">
          {step === 1 && (
            <div className="space-y-4">
              {demoPricingEnabled && (
                <div className="space-y-2.5 rounded-lg border border-primary/30 bg-primary/5 p-3.5">
                  <div className="flex items-center gap-2 text-xs font-semibold text-primary">
                    <Sparkles size={14} className="shrink-0" />
                    <span>Modo Prévia (Demonstração)</span>
                  </div>
                  <label className="flex items-center gap-2.5 text-xs text-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={useAiPricing}
                      onChange={(e) => setUseAiPricing(e.target.checked)}
                    />
                    Deixar a IA estimar preços realistas por peça (terminados em ,90)
                  </label>
                  <label className="flex items-center gap-2.5 text-xs text-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={simulatePromo}
                      onChange={(e) => setSimulatePromo(e.target.checked)}
                    />
                    Simular etiquetas de promoção em ~25% do lote
                  </label>
                </div>
              )}

              <label>
                {aiPricingActive
                  ? "Preço único do lote (R$ — opcional, usado como fallback)"
                  : "Preço único do lote (R$)"}
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder={aiPricingActive ? "Opcional — ex.: 99.90" : "Ex.: 79.90"}
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </label>

              <div className="field-grid">
                <label>
                  Categoria
                  <select
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                  >
                    <option value="">Deixar a IA identificar por foto</option>
                    {effectiveCategoryNames.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  {materialLabel}
                  <select
                    value={selectedMaterial}
                    onChange={(e) => setSelectedMaterial(e.target.value)}
                  >
                    <option value="">Deixar a IA identificar por foto</option>
                    {effectiveMaterialNames.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {showSizes && (
                <div className="space-y-2.5 rounded-lg border bg-muted/25 p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-foreground">
                      Tamanhos do lote (opcional)
                    </p>
                    {selectedSizes.length > 0 && (
                      <button
                        type="button"
                        className="text-[11px] font-medium text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
                        onClick={() => setSelectedSizes([])}
                      >
                        Limpar ({selectedSizes.length})
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2" role="group" aria-label="Tamanhos do lote">
                    {availableQuickSizes.map((size) => {
                      const selected = selectedSizes.includes(size);
                      return (
                        <button
                          key={size}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => setSelectedSizes((prev) => toggleQuickSize(prev, size))}
                          className={`min-h-8 min-w-10 rounded-md border px-3 py-1 text-xs font-medium transition-colors cursor-pointer ${
                            selected
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border bg-background text-foreground hover:border-primary/60 hover:text-primary"
                          }`}
                        >
                          {size}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    A mesma grade selecionada será aplicada a todas as peças desta fila. Deixe vazio
                    para itens sem tamanho.
                  </p>
                </div>
              )}

              <label className="flex items-center gap-2.5 rounded-lg border bg-muted/35 px-3.5 py-3 text-xs text-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoPublish}
                  onChange={(e) => setAutoPublish(e.target.checked)}
                />
                Publicar automaticamente na vitrine após analisar
              </label>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="rounded-lg border border-dashed border-primary/35 bg-muted/30 p-5 text-center space-y-2.5">
                <ImagePlus size={26} className="mx-auto text-primary" />
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Selecione as fotos das peças
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Aceita JPG, PNG, WebP e fotos do iPhone (.HEIC / .HEIF) com conversão
                    automática.
                  </p>
                </div>
                <input
                  ref={galleryInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  aria-label="Escolher fotos da galeria"
                  disabled={!!converting}
                  className="hidden"
                  onChange={handleFilesChange}
                />
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  aria-label="Tirar foto com a câmera"
                  disabled={!!converting}
                  className="hidden"
                  onChange={handleFilesChange}
                />
                <div className="grid grid-cols-2 gap-3 w-full pt-1">
                  <Button
                    type="button"
                    variant="default"
                    className="w-full h-11 text-xs font-medium"
                    disabled={!!converting}
                    onClick={() => galleryInputRef.current?.click()}
                  >
                    🖼️ Galeria
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full h-11 text-xs font-medium"
                    disabled={!!converting}
                    onClick={() => cameraInputRef.current?.click()}
                  >
                    📷 Tirar Foto
                  </Button>
                </div>
              </div>

              {converting && (
                <div className="flex items-center justify-center gap-2 rounded-lg border bg-secondary/40 px-4 py-3 text-xs text-foreground">
                  <Loader2 size={15} className="animate-spin text-primary shrink-0" />
                  <span>
                    Preparando imagens ({converting.current} de {converting.total})...
                  </span>
                </div>
              )}

              {items.length > 0 && (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {items.length === 1
                        ? "1 foto selecionada"
                        : `${items.length} fotos selecionadas`}{" "}
                      ·{" "}
                      {aiPricingActive
                        ? hasValidPrice
                          ? `Preços via IA (fallback ${money(toCommercialPrice(parsedPrice))})`
                          : "Preços estimados via IA"
                        : `${money(parsedPrice)} cada`}
                    </span>
                    <button
                      type="button"
                      className="text-destructive hover:underline cursor-pointer"
                      disabled={!!converting}
                      onClick={clearAllItems}
                    >
                      Limpar tudo
                    </button>
                  </div>

                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                    {items.map((item) => (
                      <div
                        key={item.id}
                        className="group relative rounded-lg border bg-background overflow-hidden"
                      >
                        <img
                          src={item.previewUrl}
                          alt={item.originalName}
                          className="aspect-square w-full object-cover"
                        />
                        <button
                          type="button"
                          aria-label={`Remover ${item.originalName}`}
                          disabled={!!converting}
                          onClick={() => removeItem(item.id)}
                          className="absolute top-1.5 right-1.5 h-6 w-6 rounded-full bg-background/90 text-foreground border shadow-xs grid place-items-center hover:bg-destructive hover:text-destructive-foreground transition-colors cursor-pointer"
                        >
                          <X size={13} />
                        </button>
                        <p
                          className="px-2 py-1.5 text-[10px] text-muted-foreground truncate"
                          title={item.originalName}
                        >
                          {item.originalName}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/35 p-4 space-y-2.5">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-medium text-foreground">
                    {retryCountdown
                      ? `Repescagem automática (Tentativa ${retryCountdown.nextAttempt}/${retryCountdown.maxAttempts})...`
                      : isRunning && currentAttempt > 1
                        ? `Reprocessando automaticamente (Tentativa ${currentAttempt}/3) — ${doneCount} de ${items.length} publicados...`
                        : isRunning
                          ? `Processando fila (${processedCount} de ${items.length})...`
                          : `Processamento finalizado (${doneCount} de ${items.length} publicados)`}
                  </span>
                  <span className="font-semibold text-primary shrink-0">{progressPercent}%</span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-border">
                  <div
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                {retryCountdown && (
                  <div
                    role="status"
                    aria-live="polite"
                    className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-800"
                  >
                    <Clock size={14} className="shrink-0 animate-pulse" />
                    <span>{formatRetryCountdownMessage(retryCountdown)}</span>
                  </div>
                )}
                <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                  <span>Publicados: {doneCount}</span>
                  <span>Falhas: {failedCount}</span>
                  {waitingRetryCount > 0 && <span>Repescagem: {waitingRetryCount}</span>}
                  <span>Na fila: {queuedCount}</span>
                </div>
              </div>

              <div className="divide-y rounded-lg border">
                {items.map((item) => (
                  <div key={item.id} className="flex items-center gap-3 p-3">
                    <img
                      src={item.previewUrl}
                      alt={item.productName || item.originalName}
                      className="h-14 w-14 shrink-0 rounded object-cover border"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">
                        {item.productName || item.originalName}
                      </p>
                      <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                        {item.resolvedCategory && item.resolvedMaterial
                          ? `${item.resolvedCategory} · ${item.resolvedMaterial} · ${
                              item.resolvedIsOnSale &&
                              item.resolvedSalePrice &&
                              item.resolvedPrice
                                ? `${money(item.resolvedSalePrice)} (de ${money(item.resolvedPrice)})`
                                : money(item.resolvedPrice ?? parsedPrice)
                            }${showSizes && selectedSizes.length > 0 ? ` · Tam: ${selectedSizes.join(", ")}` : ""}`
                          : `${hasValidPrice ? money(parsedPrice) : "Preço via IA"} · ${selectedCategory || "Categoria via IA"} · ${selectedMaterial || `${materialLabel} via IA`}${showSizes && selectedSizes.length > 0 ? ` · Tam: ${selectedSizes.join(", ")}` : ""}`}
                      </p>
                      {item.status === "done" && !autoPublish && (
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          Salvo como inativo na vitrine
                        </p>
                      )}
                      {item.status === "waiting_retry" && item.error && (
                        <p className="text-[11px] text-amber-700 mt-1 leading-snug">
                          Nova tentativa automática agendada...
                        </p>
                      )}
                      {item.status === "failed" && item.error && (
                        <p className="text-[11px] text-destructive mt-1 leading-snug">
                          {item.error}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      {renderStatusBadge(item)}
                      {item.status === "failed" && !isRunning && (
                        <button
                          type="button"
                          onClick={() => void runQueue([item.id])}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline cursor-pointer"
                        >
                          <RotateCcw size={11} />
                          Reprocessar
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="border-t pt-3 flex flex-wrap items-center justify-between gap-2">
          {step === 1 && (
            <>
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                Cancelar
              </Button>
              <Button
                type="button"
                disabled={!canProceedStep1}
                onClick={() => {
                  if (!canProceedStep1) {
                    toast.error("Informe um preço válido maior que zero.");
                    return;
                  }
                  setStep(2);
                }}
              >
                Próximo: Selecionar fotos
                <ArrowRight size={15} />
              </Button>
            </>
          )}

          {step === 2 && (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={!!converting}
                onClick={() => setStep(1)}
              >
                <ArrowLeft size={15} />
                Voltar
              </Button>
              <Button
                type="button"
                disabled={!!converting || items.length === 0}
                onClick={startBatch}
              >
                <Sparkles size={15} />
                Iniciar importação ({items.length})
              </Button>
            </>
          )}

          {step === 3 && (
            <>
              <div className="flex flex-wrap gap-2">
                {isRunning && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      cancelRequestedRef.current = true;
                    }}
                  >
                    Pausar fila
                  </Button>
                )}
                {!isRunning && queuedCount > 0 && (
                  <Button type="button" variant="outline" onClick={continueQueued}>
                    Continuar fila ({queuedCount})
                  </Button>
                )}
                {!isRunning && failedCount > 0 && (
                  <Button type="button" variant="secondary" onClick={retryFailed}>
                    <RotateCcw size={14} />
                    Reprocessar falhas ({failedCount})
                  </Button>
                )}
              </div>
              <Button type="button" disabled={isRunning} onClick={() => handleOpenChange(false)}>
                {isRunning ? "Processando lote..." : "Concluir"}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
