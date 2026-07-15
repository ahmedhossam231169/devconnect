import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import i18n from "./i18n";

type Lang = "en" | "ar";

interface LanguageState {
  lang: Lang;
  dir: "ltr" | "rtl";
  setLang: (lang: Lang) => void;
  toggle: () => void;
}

const LanguageContext = createContext<LanguageState | null>(null);
const LANG_KEY = "devconnect_lang";

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const saved = localStorage.getItem(LANG_KEY);
    return saved === "ar" ? "ar" : "en";
  });

  const dir = lang === "ar" ? "rtl" : "ltr";

  useEffect(() => {
    const root = document.documentElement;
    root.lang = lang;
    root.dir = dir;
    localStorage.setItem(LANG_KEY, lang);
    i18n.changeLanguage(lang);
  }, [lang, dir]);

  const setLang = (l: Lang) => setLangState(l);
  const toggle = () => setLangState((l) => (l === "en" ? "ar" : "en"));

  return (
    <LanguageContext.Provider value={{ lang, dir, setLang, toggle }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used inside <LanguageProvider>");
  return ctx;
}
