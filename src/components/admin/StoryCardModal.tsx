import { useEffect, useState } from "react";
import { Download, Loader2, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import type { Product } from "@/data/catalog";
import {
  generateProductStoryCard,
  type StoryCardResult,
} from "@/utils/generateStoryCard";

export interface StoryCardModalProps {
  open: boolean;
  product: Product | null;
  storeName: string;
  storeUrl: string;
  logoUrl?: string;
  onClose: () => void;
}

export function StoryCardModal({
  open,
  product,
  storeName,
  storeUrl,
  logoUrl = "/logo.png",
  onClose,
}: StoryCardModalProps) {
  const [showPrice, setShowPrice] = useState(true);
  const [loading, setLoading] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState("");
  const [card, setCard] = useState<StoryCardResult | null>(null);

  useEffect(() => {
    if (open && product) {
      setShowPrice(true);
      setError("");
    }
  }, [open, product?.id]);

  useEffect(() => {
    if (!open || !product) {
      setCard(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError("");

    const hasPromo =
      Boolean(product.is_on_sale) &&
      Number(product.sale_price) > 0 &&
      Number(product.sale_price) < Number(product.price);
    const activePrice = hasPromo ? Number(product.sale_price) : Number(product.price);
    const originalPrice = hasPromo ? Number(product.price) : null;

    void generateProductStoryCard({
      productName: product.name,
      price: activePrice,
      originalPrice,
      category: product.category,
      imageUrl: product.image_url,
      logoUrl,
      storeName,
      storeUrl,
      showPrice,
    })
      .then((res) => {
        if (!cancelled) {
          setCard(res);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Erro ao gerar a arte para Stories.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, product, storeName, storeUrl, logoUrl, showPrice]);

  const handleDownload = () => {
    if (!card) return;
    const link = document.createElement("a");
    let objectUrl = "";
    if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
      objectUrl = URL.createObjectURL(card.blob);
      link.href = objectUrl;
    } else {
      link.href = card.dataUrl;
    }
    link.download = card.filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    if (objectUrl) {
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    }
    toast.success("Imagem PNG baixada! Pronta para postar nos Stories.");
  };

  const handleShare = async () => {
    if (!card || !product) return;
    setSharing(true);
    try {
      const file = new File([card.blob], card.filename, { type: "image/png" });
      if (
        typeof navigator !== "undefined" &&
        typeof navigator.share === "function" &&
        navigator.canShare?.({ files: [file] })
      ) {
        await navigator.share({
          files: [file],
          title: product.name,
        });
        toast.success("Compartilhamento aberto!");
        return;
      }

      // Fallback automático para download quando Web Share de arquivos não é suportado
      handleDownload();
      toast.info("Compartilhamento direto indisponível neste navegador — a imagem foi baixada.");
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      handleDownload();
    } finally {
      setSharing(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent className="max-h-[92dvh] overflow-y-auto w-[calc(100%-24px)] max-w-md space-y-4">
        <div>
          <DialogTitle className="font-display text-2xl">
            📲 Card 9:16 para Stories
          </DialogTitle>
          <DialogDescription>
            {product ? `${product.name} · 1080×1920 (Instagram Stories & Status)` : "Prévia da arte"}
          </DialogDescription>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/40 px-3.5 py-2.5">
          <label
            htmlFor="story-show-price-switch"
            className="text-xs font-medium text-foreground cursor-pointer select-none"
          >
            Mostrar preço na arte
          </label>
          <Switch
            id="story-show-price-switch"
            checked={showPrice}
            onCheckedChange={setShowPrice}
          />
        </div>

        <div className="flex items-center justify-center min-h-[260px] rounded-xl bg-muted/30 border p-3">
          {loading && !card && (
            <div className="flex flex-col items-center gap-2 text-xs text-muted-foreground py-12">
              <Loader2 className="animate-spin text-primary" size={24} />
              <span>Montando arte em alta resolução...</span>
            </div>
          )}

          {error && !loading && (
            <p className="text-xs text-destructive text-center px-4">{error}</p>
          )}

          {card && (
            <div className="relative">
              <img
                src={card.dataUrl}
                alt={`Card para Stories de ${product?.name || "produto"}`}
                className={`max-h-[60vh] w-auto rounded-2xl shadow-xl border mx-auto object-contain transition-opacity ${
                  loading ? "opacity-60" : "opacity-100"
                }`}
              />
              {loading && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="rounded-full bg-background/90 p-2 shadow">
                    <Loader2 className="animate-spin text-primary" size={18} />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-2.5">
          <Button
            type="button"
            className="w-full h-11 font-semibold"
            disabled={!card || loading || sharing}
            onClick={() => void handleShare()}
          >
            <Share2 size={16} />
            {sharing ? "Abrindo compartilhamento..." : "📤 Compartilhar nos Stories / WhatsApp"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full h-10 text-xs font-medium"
            disabled={!card || loading}
            onClick={handleDownload}
          >
            <Download size={15} />
            ⬇️ Baixar Imagem (PNG)
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
