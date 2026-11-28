import { STORE_CONFIG } from "@/config/store.config";

export interface StoryCardParams {
  productName: string;
  price: number;
  originalPrice?: number | null;
  category?: string;
  imageUrl: string;
  logoUrl?: string;
  storeName: string;
  storeUrl: string;
  showPrice?: boolean;
}

export interface StoryCardResult {
  dataUrl: string;
  blob: Blob;
  filename: string;
}

interface StoryThemeColors {
  background: string;
  surface: string;
  primary: string;
  secondary: string;
  foreground: string;
}

const CANVAS_WIDTH = 1080;
const CANVAS_HEIGHT = 1920;

const imageObjectUrls = new WeakMap<HTMLImageElement, string>();

export function cleanDisplayStoreUrl(rawUrl: string): string {
  const cleaned = String(rawUrl || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
  return cleaned || `${STORE_CONFIG.slug}.vercel.app`;
}

export function formatBrlPrice(value: number): string {
  const safe = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(safe);
}

function slugifyFilename(text: string): string {
  const normalized = String(text || "produto")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `story-${normalized || "produto"}.png`;
}

function loadImageElement(src: string, useAnonymousCors: boolean): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    if (useAnonymousCors) {
      img.crossOrigin = "anonymous";
    }
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function revokeSafeImage(img: HTMLImageElement | null): void {
  if (!img) return;
  const objectUrl = imageObjectUrls.get(img);
  if (objectUrl && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
    URL.revokeObjectURL(objectUrl);
    imageObjectUrls.delete(img);
  }
}

export async function loadSafeImage(url: string): Promise<HTMLImageElement | null> {
  const cleanUrl = String(url || "").trim();
  if (!cleanUrl) return null;

  // Tentativa 1: fetch -> blob -> ObjectURL (evita canvas tainted por CORS)
  if (typeof fetch === "function" && typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
    try {
      const res = await fetch(cleanUrl, { mode: "cors" });
      if (res.ok) {
        const blob = await res.blob();
        if (blob.size > 0) {
          const objectUrl = URL.createObjectURL(blob);
          const img = await loadImageElement(objectUrl, false);
          if (img) {
            imageObjectUrls.set(img, objectUrl);
            return img;
          }
          URL.revokeObjectURL(objectUrl);
        }
      }
    } catch {
      // Continua para o fallback direto com crossOrigin = "anonymous"
    }
  }

  // Tentativa 2: fallback direto com crossOrigin="anonymous"
  return loadImageElement(cleanUrl, true);
}

function readThemeColors(): StoryThemeColors {
  const fallback: StoryThemeColors = {
    background: STORE_CONFIG.theme?.background || "#FBF8F7",
    surface: STORE_CONFIG.theme?.surface || "#F4ECEA",
    primary: STORE_CONFIG.theme?.primary || "#8B6239",
    secondary: STORE_CONFIG.theme?.secondary || "#D6B3AD",
    foreground: STORE_CONFIG.theme?.foreground || "#2C221E",
  };

  if (typeof document === "undefined" || typeof getComputedStyle !== "function") {
    return fallback;
  }

  const styles = getComputedStyle(document.documentElement);
  const pick = (varName: string, fb: string): string => {
    const val = styles.getPropertyValue(varName).trim();
    return val || fb;
  };

  return {
    background: pick("--background", fallback.background),
    surface: pick("--surface", fallback.surface),
    primary: pick("--primary", fallback.primary),
    secondary: pick("--secondary", fallback.secondary),
    foreground: pick("--foreground", fallback.foreground),
  };
}

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void {
  const r = Math.min(radius, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let current = "";

  for (let i = 0; i < words.length; i++) {
    const word = words[i] ?? "";
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
      if (lines.length === maxLines - 1) {
        const rest = [current, ...words.slice(i + 1)].join(" ");
        let trimmed = rest;
        while (trimmed.length > 1 && ctx.measureText(`${trimmed}…`).width > maxWidth) {
          trimmed = trimmed.slice(0, -1).trimEnd();
        }
        lines.push(ctx.measureText(rest).width <= maxWidth ? rest : `${trimmed}…`);
        return lines;
      }
    }
  }

  if (current) {
    if (ctx.measureText(current).width > maxWidth) {
      let trimmed = current;
      while (trimmed.length > 1 && ctx.measureText(`${trimmed}…`).width > maxWidth) {
        trimmed = trimmed.slice(0, -1).trimEnd();
      }
      lines.push(`${trimmed}…`);
    } else {
      lines.push(current);
    }
  }

  return lines.slice(0, maxLines);
}

function drawCoverImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void {
  const imgW = img.naturalWidth || img.width || 1;
  const imgH = img.naturalHeight || img.height || 1;
  const scale = Math.max(w / imgW, h / imgH);
  const drawW = imgW * scale;
  const drawH = imgH * scale;
  const offsetX = x + (w - drawW) / 2;
  const offsetY = y + (h - drawH) / 2;

  ctx.save();
  drawRoundedRectPath(ctx, x, y, w, h, radius);
  ctx.clip();
  ctx.drawImage(img, offsetX, offsetY, drawW, drawH);
  ctx.restore();
}

function drawSpacedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  centerX: number,
  y: number,
  spacing: number,
): void {
  const chars = Array.from(text);
  if (chars.length === 0) return;

  const widths = chars.map((ch) => ctx.measureText(ch).width);
  const totalWidth =
    widths.reduce((sum, w) => sum + w, 0) + spacing * Math.max(0, chars.length - 1);
  let cursorX = centerX - totalWidth / 2;

  ctx.save();
  ctx.textAlign = "left";
  for (let i = 0; i < chars.length; i++) {
    ctx.fillText(chars[i] ?? "", cursorX, y);
    cursorX += (widths[i] ?? 0) + spacing;
  }
  ctx.restore();
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(",");
  const mimeMatch = header?.match(/data:([^;]+)/);
  const mime: string = mimeMatch?.[1] ?? "image/png";
  const binary = typeof atob === "function" ? atob(base64 || "") : "";
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

export async function generateProductStoryCard(params: StoryCardParams): Promise<StoryCardResult> {
  const {
    productName,
    price,
    originalPrice = null,
    category = "",
    imageUrl,
    logoUrl = "/logo.png",
    storeName,
    storeUrl,
    showPrice = true,
  } = params;

  if (typeof document === "undefined") {
    throw new Error("A geração de imagem Story só pode ser executada no navegador.");
  }

  // Aguarda fontes carregarem brevemente (sem bloquear caso não exista Font Loading API)
  try {
    if (document.fonts?.ready) {
      await Promise.race([
        document.fonts.ready,
        new Promise((resolve) => setTimeout(resolve, 600)),
      ]);
    }
  } catch {
    // Segue com fontes padrão
  }

  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Não foi possível inicializar o contexto Canvas 2D.");
  }

  const theme = readThemeColors();
  const sansFont = '"Plus Jakarta Sans", system-ui, -apple-system, sans-serif';
  const displayFont = '"Cormorant Garamond", Georgia, serif';

  const [productImg, logoImg] = await Promise.all([
    loadSafeImage(imageUrl),
    loadSafeImage(logoUrl || "/logo.png"),
  ]);

  try {
    // =========================================================================
    // 1. FUNDO EDITORIAL + FORMAS DECORATIVAS + MOLDURA INTERNA
    // =========================================================================
    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Formas suaves nos cantos usando --surface e --secondary
    ctx.save();
    ctx.fillStyle = theme.surface;
    ctx.beginPath();
    ctx.arc(0, 80, 420, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(CANVAS_WIDTH, CANVAS_HEIGHT - 160, 460, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 0.25;
    ctx.fillStyle = theme.secondary;
    ctx.beginPath();
    ctx.arc(CANVAS_WIDTH - 40, 260, 220, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(80, CANVAS_HEIGHT - 460, 210, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Moldura fina interna com cantos arredondados na cor --primary (opacidade suave)
    ctx.save();
    ctx.globalAlpha = 0.26;
    ctx.strokeStyle = theme.primary;
    ctx.lineWidth = 2.5;
    drawRoundedRectPath(ctx, 42, 42, CANVAS_WIDTH - 84, CANVAS_HEIGHT - 84, 44);
    ctx.stroke();
    ctx.restore();

    // =========================================================================
    // 2. TOPO (y = 90 a 260): LOGO DA LOJA + PÍLULA "NOVIDADE NA VITRINE"
    // =========================================================================
    if (logoImg) {
      const maxLogoH = 130;
      const maxLogoW = 540;
      const lW = logoImg.naturalWidth || logoImg.width || 1;
      const lH = logoImg.naturalHeight || logoImg.height || 1;
      const scale = Math.min(maxLogoW / lW, maxLogoH / lH);
      const drawW = lW * scale;
      const drawH = lH * scale;
      const drawX = (CANVAS_WIDTH - drawW) / 2;
      const drawY = 92 + (maxLogoH - drawH) / 2;
      ctx.drawImage(logoImg, drawX, drawY, drawW, drawH);
    } else {
      ctx.save();
      ctx.fillStyle = theme.foreground;
      ctx.font = `700 62px ${displayFont}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const safeStoreLines = wrapTextLines(ctx, storeName || STORE_CONFIG.name, 860, 1);
      ctx.fillText(safeStoreLines[0] || storeName, CANVAS_WIDTH / 2, 154);
      ctx.restore();
    }

    // Pílula discreta "NOVIDADE NA VITRINE"
    const badgeW = 352;
    const badgeH = 42;
    const badgeX = (CANVAS_WIDTH - badgeW) / 2;
    const badgeY = 232;

    ctx.save();
    drawRoundedRectPath(ctx, badgeX, badgeY, badgeW, badgeH, 21);
    ctx.fillStyle = theme.surface;
    ctx.fill();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = theme.primary;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.fillStyle = theme.primary;
    ctx.font = `700 18px ${sansFont}`;
    ctx.textBaseline = "middle";
    drawSpacedText(ctx, "NOVIDADE NA VITRINE", CANVAS_WIDTH / 2, badgeY + badgeH / 2 + 1, 3.2);
    ctx.restore();

    // =========================================================================
    // 3. CENTRO — CARD DA FOTO DO PRODUTO (x=110, y=300, w=860, h=920)
    // =========================================================================
    const cardX = 110;
    const cardY = 300;
    const cardW = 860;
    const cardH = 920;
    const cardRadius = 36;

    // Sombra suave + fundo do card
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.12)";
    ctx.shadowBlur = 42;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 18;
    drawRoundedRectPath(ctx, cardX, cardY, cardW, cardH, cardRadius);
    ctx.fillStyle = "#FFFFFF";
    ctx.fill();
    ctx.restore();

    // Borda bem sutil no card
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = theme.primary;
    ctx.lineWidth = 2;
    drawRoundedRectPath(ctx, cardX, cardY, cardW, cardH, cardRadius);
    ctx.stroke();
    ctx.restore();

    // Foto interna com recorte cover proporcional e cantos arredondados
    const pad = 16;
    const photoX = cardX + pad;
    const photoY = cardY + pad;
    const photoW = cardW - pad * 2;
    const photoH = cardH - pad * 2;
    const photoRadius = 24;

    if (productImg) {
      drawCoverImage(ctx, productImg, photoX, photoY, photoW, photoH, photoRadius);
    } else {
      ctx.save();
      drawRoundedRectPath(ctx, photoX, photoY, photoW, photoH, photoRadius);
      ctx.fillStyle = theme.surface;
      ctx.fill();
      ctx.fillStyle = theme.foreground;
      ctx.globalAlpha = 0.45;
      ctx.font = `600 32px ${sansFont}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Prévia da peça", CANVAS_WIDTH / 2, photoY + photoH / 2);
      ctx.restore();
    }

    // Tag "OFERTA" no canto superior direito da foto
    const hasSale =
      showPrice && typeof originalPrice === "number" && Number.isFinite(originalPrice) && originalPrice > price;
    if (hasSale) {
      const tagW = 188;
      const tagH = 58;
      const tagX = photoX + photoW - tagW - 24;
      const tagY = photoY + 24;

      ctx.save();
      ctx.shadowColor = "rgba(0, 0, 0, 0.22)";
      ctx.shadowBlur = 18;
      ctx.shadowOffsetY = 6;
      drawRoundedRectPath(ctx, tagX, tagY, tagW, tagH, 29);
      ctx.fillStyle = theme.primary;
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.fillStyle = "#FFFFFF";
      ctx.font = `800 24px ${sansFont}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("OFERTA", tagX + tagW / 2, tagY + tagH / 2 + 1);
      ctx.restore();
    }

    // =========================================================================
    // 4. BLOCO DE INFORMAÇÕES DO PRODUTO (y = 1265 a 1490)
    // =========================================================================
    const cleanCategory = String(category || "").trim();
    let nextY = 1288;

    if (cleanCategory) {
      ctx.save();
      ctx.fillStyle = theme.primary;
      ctx.font = `700 22px ${sansFont}`;
      ctx.textBaseline = "middle";
      drawSpacedText(ctx, cleanCategory.toUpperCase(), CANVAS_WIDTH / 2, nextY, 4);
      ctx.restore();
      nextY = 1338;
    } else {
      nextY = 1318;
    }

    // Nome do produto centralizado em até 2 linhas
    ctx.save();
    ctx.fillStyle = theme.foreground;
    ctx.font = `700 44px ${sansFont}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const nameLines = wrapTextLines(ctx, productName || "Peça Exclusiva", 880, 2);
    const lineHeight = 54;
    if (nameLines.length === 1) {
      ctx.fillText(nameLines[0] ?? "", CANVAS_WIDTH / 2, nextY + 12);
      nextY += 72;
    } else {
      ctx.fillText(nameLines[0] || "", CANVAS_WIDTH / 2, nextY);
      ctx.fillText(nameLines[1] || "", CANVAS_WIDTH / 2, nextY + lineHeight);
      nextY += lineHeight + 56;
    }
    ctx.restore();

    // Preço (opcional)
    if (showPrice) {
      const priceText = formatBrlPrice(price);
      const priceBaselineY = Math.min(Math.max(nextY + 26, 1450), 1482);

      if (hasSale && originalPrice) {
        const oldPriceText = formatBrlPrice(originalPrice);

        ctx.save();
        ctx.font = `500 32px ${sansFont}`;
        const oldW = ctx.measureText(oldPriceText).width;
        ctx.font = `800 62px ${sansFont}`;
        const newW = ctx.measureText(priceText).width;

        const gap = 26;
        const totalW = oldW + gap + newW;
        const startX = (CANVAS_WIDTH - totalW) / 2;

        // Preço antigo riscado
        ctx.fillStyle = theme.foreground;
        ctx.globalAlpha = 0.5;
        ctx.font = `500 32px ${sansFont}`;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(oldPriceText, startX, priceBaselineY + 4);

        ctx.strokeStyle = theme.foreground;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(startX - 4, priceBaselineY + 4);
        ctx.lineTo(startX + oldW + 4, priceBaselineY + 4);
        ctx.stroke();

        // Preço promocional em destaque
        ctx.globalAlpha = 1;
        ctx.fillStyle = theme.primary;
        ctx.font = `800 62px ${sansFont}`;
        ctx.fillText(priceText, startX + oldW + gap, priceBaselineY);
        ctx.restore();
      } else {
        ctx.save();
        ctx.fillStyle = theme.primary;
        ctx.font = `800 64px ${sansFont}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(priceText, CANVAS_WIDTH / 2, priceBaselineY);
        ctx.restore();
      }
    }

    // =========================================================================
    // 5. RODAPÉ — CHAMADA PARA O SITE (y = 1530 a 1710; últimos 210px livres)
    // =========================================================================
    const ctaX = 110;
    const ctaY = 1544;
    const ctaW = 860;
    const ctaH = 156;
    const ctaRadius = 78;

    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.16)";
    ctx.shadowBlur = 28;
    ctx.shadowOffsetY = 12;
    drawRoundedRectPath(ctx, ctaX, ctaY, ctaW, ctaH, ctaRadius);
    ctx.fillStyle = theme.primary;
    ctx.fill();
    ctx.restore();

    // Linha 1 da pílula
    ctx.save();
    ctx.fillStyle = "#FFFFFF";
    ctx.globalAlpha = 0.94;
    ctx.font = `600 28px ${sansFont}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("🛒 Peça agora pelo nosso site", CANVAS_WIDTH / 2, ctaY + 52);

    // Linha 2 da pílula (endereço limpo da loja)
    const displayUrl = cleanDisplayStoreUrl(storeUrl);
    let urlFontSize = 36;
    ctx.globalAlpha = 1;
    ctx.font = `800 ${urlFontSize}px ${sansFont}`;
    while (urlFontSize > 24 && ctx.measureText(displayUrl).width > ctaW - 88) {
      urlFontSize -= 2;
      ctx.font = `800 ${urlFontSize}px ${sansFont}`;
    }
    ctx.fillText(displayUrl, CANVAS_WIDTH / 2, ctaY + 108);
    ctx.restore();

    const dataUrl = canvas.toDataURL("image/png");
    const blob = await new Promise<Blob>((resolve) => {
      if (typeof canvas.toBlob === "function") {
        canvas.toBlob((b) => resolve(b || dataUrlToBlob(dataUrl)), "image/png");
      } else {
        resolve(dataUrlToBlob(dataUrl));
      }
    });

    return {
      dataUrl,
      blob,
      filename: slugifyFilename(productName),
    };
  } finally {
    revokeSafeImage(productImg);
    revokeSafeImage(logoImg);
  }
}
