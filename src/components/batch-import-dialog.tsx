import { useEffect, useRef, useState } from "react";
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
import { money, type Product } from "@/data/catalog";
import { normalizeImageFile } from "@/lib/normalize-image";
import { analyzeProductWithAi } from "@/services/aiProductService";
import { optionLookupKey } from "@/services/catalogOptionsService";
import { deleteStoreImage, uploadStoreImage } from "@/services/storageService";

type BatchStep = 1 | 2 | 3;
type BatchItemStatus = "queued" | "analyzing" | "uploading" | "done" | "failed";

interface BatchItem {
  id: string;
  file: File;
  originalName: string;
  previewUrl: string;
  status: BatchItemStatus;
  error?: string;
  productName?: string;
  resolvedCategory?: string;
  resolvedMaterial?: string;
}

interface BatchImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categoryNames: string[];
  materialNames: string[];
  saveProduct: (product: Product) => Promise<void>;
}

const BATCH_ITEM_DELAY_MS = 800;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fallbackProductName(filename: string): string {
  const withoutExt = filename.replace(/\.[^.]+$/, "").trim();
  const cleaned = withoutExt.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return cleaned || "Acessório Use Camile";
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
}: BatchImportDialogProps) {
  const [step, setStep] = useState<BatchStep>(1);
  const [price, setPrice] = useState<string>("");
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [selectedMaterial, setSelectedMaterial] = useState<string>("");
  const [autoPublish, setAutoPublish] = useState<boolean>(true);
  const [items, setItems] = useState<BatchItem[]>([]);
  const [converting, setConverting] = useState<{ current: number; total: number } | null>(null);
  const [isRunning, setIsRunning] = useState<boolean>(false);

  const itemsRef = useRef<BatchItem[]>([]);
  const objectUrlsRef = useRef<Set<string>>(new Set());
  const cancelRequestedRef = useRef<boolean>(false);
  const mountedRef = useRef<boolean>(true);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    mountedRef.current = true;
    const urls = objectUrlsRef.current;
    return () => {
      mountedRef.current = false;
      cancelRequestedRef.current = true;
      for (const url of urls) {
        URL.revokeObjectURL(url);
      }
      urls.clear();
    };
  }, []);

  const parsedPrice = Number(price.replace(",", "."));
  const hasValidPrice = Number.isFinite(parsedPrice) && parsedPrice > 0;

  const doneCount = items.filter((item) => item.status === "done").length;
  const failedCount = items.filter((item) => item.status === "failed").length;
  const queuedCount = items.filter((item) => item.status === "queued").length;
  const processedCount = doneCount + failedCount;
  const progressPercent = items.length > 0 ? Math.round((processedCount / items.length) * 100) : 0;

  const clearAllItems = () => {
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
    setSelectedCategory("");
    setSelectedMaterial("");
    setAutoPublish(true);
    setConverting(null);
    setIsRunning(false);
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
        setItems((prev) => {
          const updated = [...prev, nextItem];
          itemsRef.current = updated;
          return updated;
        });
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

  const removeItem = (id: string) => {
    if (isRunning) return;
    setItems((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
        objectUrlsRef.current.delete(target.previewUrl);
      }
      const updated = prev.filter((item) => item.id !== id);
      itemsRef.current = updated;
      return updated;
    });
  };

  const updateItem = (id: string, updater: (item: BatchItem) => BatchItem) => {
    setItems((prev) => {
      const updated = prev.map((item) => (item.id === id ? updater(item) : item));
      itemsRef.current = updated;
      return updated;
    });
  };

  const runQueue = async (targetIds: string[]) => {
    if (isRunning || targetIds.length === 0) return;

    cancelRequestedRef.current = false;
    setIsRunning(true);

    const defaultCategory = categoryNames.includes("Brincos")
      ? "Brincos"
      : (categoryNames[0] ?? "Brincos");
    const defaultMaterial = materialNames.includes("Semijoia")
      ? "Semijoia"
      : (materialNames[0] ?? "Semijoia");

    // Reset target items back to queued before processing
    const targetSet = new Set(targetIds);
    setItems((prev) => {
      const updated = prev.map((item) =>
        targetSet.has(item.id)
          ? {
              id: item.id,
              file: item.file,
              originalName: item.originalName,
              previewUrl: item.previewUrl,
              status: "queued" as const,
            }
          : item,
      );
      itemsRef.current = updated;
      return updated;
    });

    let batchDone = 0;
    let batchFailed = 0;

    for (let i = 0; i < targetIds.length; i++) {
      if (cancelRequestedRef.current || !mountedRef.current) break;
      const itemId = targetIds[i];
      if (!itemId) continue;

      const currentItem = itemsRef.current.find((item) => item.id === itemId);
      if (!currentItem) continue;

      updateItem(itemId, (item) => ({
        id: item.id,
        file: item.file,
        originalName: item.originalName,
        previewUrl: item.previewUrl,
        status: "analyzing",
      }));

      let uploadedImageUrl = "";
      try {
        const analysis = await analyzeProductWithAi({
          file: currentItem.file,
          availableCategories: categoryNames,
          availableMaterials: materialNames,
        });

        if (!mountedRef.current) break;

        const resolvedCategory =
          selectedCategory ||
          matchCatalogOption(analysis.category, categoryNames) ||
          defaultCategory;
        const resolvedMaterial =
          selectedMaterial ||
          matchCatalogOption(analysis.material, materialNames) ||
          defaultMaterial;
        const resolvedName = analysis.name.trim() || fallbackProductName(currentItem.originalName);
        const characteristics = analysis.characteristics.map((row) => ({
          attribute: row.label,
          value: row.value,
        }));

        updateItem(itemId, (item) => ({
          ...item,
          status: "uploading",
          productName: resolvedName,
          resolvedCategory,
          resolvedMaterial,
        }));

        const uploaded = await uploadStoreImage(currentItem.file, "products");
        uploadedImageUrl = uploaded.url;

        const productToCreate: Product = {
          id: crypto.randomUUID(),
          name: resolvedName,
          sku: "",
          category: resolvedCategory,
          material: resolvedMaterial,
          price: parsedPrice,
          sale_price: 0,
          is_on_sale: false,
          sale_label: "",
          image_url: uploaded.url,
          description: analysis.description.trim(),
          active: autoPublish,
          featured: false,
          in_stock: true,
          characteristics,
        };

        await saveProduct(productToCreate);
        uploadedImageUrl = "";

        if (!mountedRef.current) break;
        updateItem(itemId, (item) => ({
          ...item,
          status: "done",
          productName: resolvedName,
          resolvedCategory,
          resolvedMaterial,
        }));
        batchDone += 1;
      } catch (err) {
        if (uploadedImageUrl) {
          void deleteStoreImage(uploadedImageUrl);
        }
        const message =
          err instanceof Error ? err.message : "Erro inesperado ao importar esta peça.";
        if (!mountedRef.current) break;
        updateItem(itemId, (item) => ({
          ...item,
          status: "failed",
          error: message,
        }));
        batchFailed += 1;
      }

      if (i < targetIds.length - 1 && !cancelRequestedRef.current && mountedRef.current) {
        await sleep(BATCH_ITEM_DELAY_MS);
      }
    }

    if (mountedRef.current) {
      setIsRunning(false);
      if (cancelRequestedRef.current) {
        toast.info("Fila pausada. Você pode continuar quando desejar.");
      } else if (batchFailed === 0 && batchDone > 0) {
        toast.success(
          batchDone === 1
            ? "1 produto importado com sucesso!"
            : `${batchDone} produtos importados com sucesso!`,
        );
      } else if (batchFailed > 0) {
        toast.error(
          `${batchDone} importado(s) e ${batchFailed} com falha. Você pode reprocessar as falhas abaixo.`,
        );
      }
    }
  };

  const startBatch = () => {
    if (!hasValidPrice) {
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
      case "analyzing":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
            <Loader2 size={12} className="animate-spin" />
            Analisando...
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
              <label>
                Preço único do lote (R$)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Ex.: 79.90"
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
                    {categoryNames.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Material
                  <select
                    value={selectedMaterial}
                    onChange={(e) => setSelectedMaterial(e.target.value)}
                  >
                    <option value="">Deixar a IA identificar por foto</option>
                    {materialNames.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

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
                <label className="inline-flex cursor-pointer items-center justify-center rounded-md bg-primary px-4 py-2.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors w-fit mx-auto">
                  Escolher fotos
                  <input
                    type="file"
                    multiple
                    accept="image/*,.heic,.heif"
                    disabled={!!converting}
                    className="sr-only"
                    onChange={(e) => {
                      const selected = e.target.files;
                      void handleFilesSelected(selected);
                      e.target.value = "";
                    }}
                  />
                </label>
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
                      · {money(parsedPrice)} cada
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
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-foreground">
                    {isRunning
                      ? `Processando fila (${processedCount} de ${items.length})...`
                      : `Processamento finalizado (${processedCount} de ${items.length})`}
                  </span>
                  <span className="font-semibold text-primary">{progressPercent}%</span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-border">
                  <div
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                  <span>Publicados: {doneCount}</span>
                  <span>Falhas: {failedCount}</span>
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
                          ? `${item.resolvedCategory} · ${item.resolvedMaterial} · ${money(parsedPrice)}`
                          : `${money(parsedPrice)} · ${selectedCategory || "Categoria via IA"} · ${selectedMaterial || "Material via IA"}`}
                      </p>
                      {item.status === "done" && !autoPublish && (
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          Salvo como inativo na vitrine
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
                disabled={!hasValidPrice}
                onClick={() => {
                  if (!hasValidPrice) {
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
                {isRunning ? "Processando..." : "Concluir"}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
