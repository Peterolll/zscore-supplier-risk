// lib/messages/index.ts — 语言字典入口
// 提供 lookupMessage(lang) 供 i18n Provider 调用；client 端按 lang 选 zh/en。
// 额外暴露 translateGate() 把 Python 端输出的中文闸门 key 翻成当前语言。

import type { Lang, Messages } from "./types";
import { zh } from "./zh";
import { en } from "./en";

export type { Lang, Messages } from "./types";

export const LANGS: Lang[] = ["zh", "en"];

export const DEFAULT_LANG: Lang = "zh";

export const LANG_STORAGE_KEY = "zscore-lang";
export const LANG_COOKIE_KEY = "zscore-lang";

const DICTS: Record<Lang, Messages> = { zh, en };

export function lookupMessage(lang: Lang): Messages {
  return DICTS[lang] ?? DICTS[DEFAULT_LANG];
}

export function isLang(s: string | undefined | null): s is Lang {
  return s === "zh" || s === "en";
}

/**
 * 把 Python m5_validate.py 输出的闸门 key 翻成指定语言的可读文本。
 * key 不在字典里时原样返回，避免"未识别闸门"被静默替换成空字符串。
 */
export function translateGate(m: Messages, key: string): string {
  return m.gates[key] ?? key;
}