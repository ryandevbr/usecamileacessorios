import type { StoreNiche } from "@/config/store.config";

export interface RetryCountdownState {
  nextAttempt: 2 | 3;
  maxAttempts: 3;
  secondsLeft: number;
  failedCount: number;
}

export interface BatchRetryRoundConfig {
  attempt: 1 | 2 | 3;
  maxAttempts: 3;
  waitSecondsBeforeRound: number;
  itemDelayMs: number;
}

export const BATCH_RETRY_ROUNDS: readonly BatchRetryRoundConfig[] = [
  { attempt: 1, maxAttempts: 3, waitSecondsBeforeRound: 0, itemDelayMs: 800 },
  { attempt: 2, maxAttempts: 3, waitSecondsBeforeRound: 5, itemDelayMs: 1200 },
  { attempt: 3, maxAttempts: 3, waitSecondsBeforeRound: 8, itemDelayMs: 1500 },
];

export const NICHE_FALLBACK_DEMO_PRICE: Record<StoreNiche, number> = {
  acessorios: 69.9,
  moda: 129.9,
  calcados: 149.9,
};

export function formatRetryCountdownMessage(countdown: RetryCountdownState): string {
  if (countdown.nextAttempt === 2) {
    return `A IA estava ocupada em ${countdown.failedCount} foto(s). Aguardando ${countdown.secondsLeft}s para tentar novamente automaticamente...`;
  }
  return `Aguardando ${countdown.secondsLeft}s para última tentativa automática em ${countdown.failedCount} foto(s)...`;
}

/**
 * Normaliza qualquer valor numérico para um preço comercial terminado em .90
 * (mínimo R$ 19,90), evitando valores quebrados como 134.37.
 */
export function toCommercialPrice(value: number): number {
  if (!Number.isFinite(value)) return 19.9;
  return Number(Math.max(19.9, Math.floor(value) + 0.9).toFixed(2));
}

export interface SimulatedPromoPricing {
  is_on_sale: boolean;
  sale_price: number;
  sale_label: string;
}

/**
 * Simula promoção em ~25% dos itens do lote (1 a cada 4 peças), aplicando
 * desconto entre 15% e 20% arredondado para .90 e garantindo sale_price < originalPrice.
 */
export function buildDemoPromoPricing(
  originalPrice: number,
  itemIndex: number,
): SimulatedPromoPricing {
  const shouldPromote = itemIndex % 4 === 1;
  if (!shouldPromote || !Number.isFinite(originalPrice) || originalPrice <= 24.9) {
    return { is_on_sale: false, sale_price: 0, sale_label: "" };
  }

  const discountRates = [0.15, 0.18, 0.2] as const;
  const discountRate = discountRates[Math.floor(itemIndex / 4) % discountRates.length] ?? 0.18;
  const salePrice = toCommercialPrice(originalPrice * (1 - discountRate));

  if (salePrice >= originalPrice) {
    return { is_on_sale: false, sale_price: 0, sale_label: "" };
  }

  const discountPercent = Math.round((1 - salePrice / originalPrice) * 100);
  return {
    is_on_sale: true,
    sale_price: salePrice,
    sale_label: discountPercent > 0 ? `${discountPercent}% OFF` : "",
  };
}
