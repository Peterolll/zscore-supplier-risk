"use client";
// lib/i18n.tsx — React Context + useT hook + 持久化（localStorage + cookie）
//
// 设计要点：
// 1. server 端一律渲染 zh（默认），避免水合不匹配；客户端 hydration 后读取
//    localStorage / cookie 切换到真实语言。LangSwitcher 修改后即时刷新 + 持久化。
// 2. 持久化双写：localStorage（前端）+ cookie（首次访问/SSR 友好）。
// 3. 切换时同步更新 document.documentElement.lang（影响屏幕阅读器 / 浏览器翻译）。
// 4. 提供 useT()（直接拿字典）和 useLang()（拿语言本身）两个 hook，
//    后者给 LangSwitcher 用。

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  lookupMessage,
  DEFAULT_LANG,
  isLang,
  LANG_STORAGE_KEY,
  LANG_COOKIE_KEY,
  type Lang,
  type Messages,
} from "./messages";

interface I18nValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: Messages;
}

const I18nContext = createContext<I18nValue | null>(null);

function readCookieLang(): Lang | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(
    new RegExp("(?:^|; )" + LANG_COOKIE_KEY + "=([^;]*)")
  );
  const v = m ? decodeURIComponent(m[1]) : null;
  return isLang(v) ? v : null;
}

function readStorageLang(): Lang | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(LANG_STORAGE_KEY);
    return isLang(v) ? v : null;
  } catch {
    return null;
  }
}

function writeCookieLang(lang: Lang) {
  if (typeof document === "undefined") return;
  // 90 天；path=/ 以便整站生效；SameSite=Lax
  const maxAge = 60 * 60 * 24 * 90;
  document.cookie = `${LANG_COOKIE_KEY}=${encodeURIComponent(lang)}; max-age=${maxAge}; path=/; SameSite=Lax`;
}

function writeStorageLang(lang: Lang) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    // localStorage 不可用（如隐私模式）→ 静默降级到 cookie
  }
}

export function I18nProvider({
  children,
  initialLang,
}: {
  children: ReactNode;
  initialLang?: Lang;
}) {
  // 始终以 initialLang（默认 zh）作为首屏渲染值，杜绝水合不匹配
  const [lang, setLangState] = useState<Lang>(initialLang ?? DEFAULT_LANG);

  // hydration 后再读取用户偏好并 apply；首屏不闪烁
  useEffect(() => {
    const stored = readStorageLang() ?? readCookieLang();
    if (stored && stored !== lang) {
      setLangState(stored);
      if (typeof document !== "undefined") {
        document.documentElement.lang = stored === "zh" ? "zh-CN" : "en";
      }
    }
    // 仅在挂载时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    writeStorageLang(next);
    writeCookieLang(next);
    if (typeof document !== "undefined") {
      document.documentElement.lang = next === "zh" ? "zh-CN" : "en";
    }
  }, []);

  const t = useMemo(() => lookupMessage(lang), [lang]);

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const v = useContext(I18nContext);
  if (!v) {
    // 没被 Provider 包住时返回默认（zh），避免崩溃——但开发期应该包住
    if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.warn(
        "[i18n] useI18n called outside <I18nProvider>; falling back to default (zh)."
      );
    }
    return { lang: DEFAULT_LANG, setLang: () => {}, t: lookupMessage(DEFAULT_LANG) };
  }
  return v;
}

/** 拿字典（最常用） */
export function useT(): Messages {
  return useI18n().t;
}

/** 拿语言本身（给 LangSwitcher 用） */
export function useLang(): Lang {
  return useI18n().lang;
}