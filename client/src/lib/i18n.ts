import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "../locales/en.json";
import ar from "../locales/ar.json";

const saved = localStorage.getItem("devconnect_lang");

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ar: { translation: ar },
  },
  lng: saved === "ar" ? "ar" : "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export default i18n;
