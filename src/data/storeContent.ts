import { STORE_CONFIG, getWhatsappUrl } from "@/config/store.config";

export const storeContent = {
  name: STORE_CONFIG.name,
  whatsapp: getWhatsappUrl(),
  whatsappDisplay: STORE_CONFIG.whatsappDisplay,
  instagram: STORE_CONFIG.instagramUrl,
  instagramHandle: STORE_CONFIG.instagramHandle,
  slogan: STORE_CONFIG.hero.title,
  about:
    STORE_CONFIG.aboutText ??
    "Nossa curadoria reúne estilo, qualidade e atendimento personalizado com envio para todo o Brasil.",
};
