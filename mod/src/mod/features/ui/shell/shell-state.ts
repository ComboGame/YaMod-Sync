// Состояние оболочки мода: тема оформления, колонка комнаты справа и открытый
// экран настроек. Тема и колонка хранятся в настройках мода и переживают
// перезапуск; открытые настройки — нет.
import { useEffect, useState } from "react";

export type Theme = "modrinth" | "original";

export type SettingsScreen = "room" | "queue" | "people" | "appearance" | "features" | "updates" | "system";

export type ShellState = {
  theme: Theme;
  /** Колонка «Комната» справа открыта — в широком окне, где у неё своё место. */
  dock: boolean;
  /** В узком окне колонка открыта поверх страницы — до клика мимо неё. Не сохраняется. */
  peek: boolean;
  /** Открытый экран настроек мода, null — настройки закрыты. */
  settings: SettingsScreen | null;
};

const THEME_KEY = "ui/theme";
const DOCK_KEY = "ui/dock";

let state: ShellState = { theme: "modrinth", dock: true, peek: false, settings: null };

/** Шире этого окно отдаёт колонке комнаты своё место; уже — она ложится поверх. */
export const DOCK_MIN_WINDOW = 1100;

export function wideWindow() {
  return window.innerWidth >= DOCK_MIN_WINDOW;
}

/** Кнопка колонки: в широком окне — открыть или убрать насовсем, в узком — заглянуть. */
export function toggleDock() {
  if (wideWindow()) setShell({ dock: !state.dock, peek: false });
  else setShell({ peek: !state.peek });
}

/** Открыта ли колонка сейчас, при такой ширине окна. */
export function dockOpen(shell: ShellState, wide: boolean) {
  return wide ? shell.dock : shell.peek;
}
const listeners = new Set<(state: ShellState) => void>();

export function getShell() {
  return state;
}

export function setShell(patch: Partial<ShellState>) {
  const next = { ...state, ...patch };
  if (next.theme !== state.theme) window.yandexMusicMod.setStorageValue(THEME_KEY, next.theme);
  if (next.dock !== state.dock) window.yandexMusicMod.setStorageValue(DOCK_KEY, next.dock);
  state = next;
  for (const listener of listeners) listener(state);
}

export function openSettings(screen: SettingsScreen = "room") {
  setShell({ settings: screen });
}

/** Читает сохранённое; до этого действуют значения по умолчанию. */
export async function loadShell() {
  const [theme, dock] = await Promise.all([
    window.yandexMusicMod.getStorageValue(THEME_KEY),
    window.yandexMusicMod.getStorageValue(DOCK_KEY),
  ]);
  state = {
    ...state,
    theme: theme === "original" ? "original" : "modrinth",
    dock: typeof dock === "boolean" ? dock : true,
  };
  for (const listener of listeners) listener(state);
}

export function useShell(): ShellState {
  const [current, setCurrent] = useState(state);
  useEffect(() => {
    listeners.add(setCurrent);
    setCurrent(state);
    return () => {
      listeners.delete(setCurrent);
    };
  }, []);
  return current;
}

/** Версии для подвала настроек: клиента (из user agent приложения) и мода. */
export function clientVersion(): string | null {
  return /Sync\/([\d.]+)/.exec(navigator.userAgent)?.[1] ?? null;
}
