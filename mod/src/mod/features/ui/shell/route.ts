// Где сейчас пользователь — для заголовка в верхней панели. Раздел берётся из
// адреса страницы клиента, название сущности (альбома, артиста, плейлиста) — из
// шапки самой страницы.
import { useEffect, useState } from "react";

export type Section =
  | "wave"
  | "search"
  | "trends"
  | "concerts"
  | "books"
  | "kids"
  | "collection"
  | "album"
  | "artist"
  | "playlist"
  | "chart"
  | "genre"
  | "history"
  | "settings"
  | "profile"
  | "other";

export type Route = { section: Section; title: string; detail: string | null };

const SECTIONS: [RegExp, Section, string][] = [
  [/^\/$/, "wave", "Моя волна"],
  [/^\/search/, "search", "Поиск"],
  [/^\/landing/, "trends", "Для вас и Тренды"],
  [/^\/concerts?/, "concerts", "Концерты"],
  [/^\/non-music/, "books", "Книги и подкасты"],
  [/^\/kids/, "kids", "Детям"],
  [/^\/collection|^\/mymusic/, "collection", "Коллекция"],
  [/^\/album/, "album", "Альбом"],
  [/^\/artist/, "artist", "Исполнитель"],
  [/^\/playlists?/, "playlist", "Плейлист"],
  [/^\/chart/, "chart", "Чарт"],
  [/^\/genre|^\/tag|^\/mixes|^\/label/, "genre", "Подборки"],
  [/^\/music-history/, "history", "История"],
  [/^\/settings/, "settings", "Настройки"],
  [/^\/users/, "profile", "Профиль"],
];

const COLLECTION_PARTS: Record<string, string> = {
  artists: "Исполнители",
  albums: "Альбомы",
  playlists: "Плейлисты",
  "non-music": "Книги и подкасты",
  kids: "Детям",
  shelf: "Полка",
  clips: "Клипы",
  dislikes: "Не нравится",
  downloads: "Скачанное",
};

function text(selector: string): string | null {
  const main = document.querySelector('[class*="CommonLayout_content__"]');
  const value = main?.querySelector(selector)?.textContent?.trim();
  return value ? value.replace(/\s+/g, " ").slice(0, 80) : null;
}

/** Название страницы: альбома, артиста, плейлиста — его заголовок h1. */
function headerTitle(): string | null {
  return text('[data-test-id="ENTITY_TITLE"]') ?? text("h1");
}

/** Что это за сущность словами клиента: «Сингл», «Альбом», «Подкаст». */
function headerKind(): string | null {
  return text('[data-test-id="ENTITY_NAME"]');
}

export function currentRoute(): Route {
  const path = location.pathname;
  const found = SECTIONS.find(([pattern]) => pattern.test(path));
  if (!found) return { section: "other", title: headerTitle() ?? "Яндекс Музыка", detail: null };
  const [, section, fallback] = found;
  let title = fallback;
  let detail: string | null = null;
  if (section === "collection") {
    const part = path.split("/")[2];
    detail = part ? (COLLECTION_PARTS[part] ?? null) : null;
  } else if (section === "album" || section === "artist" || section === "playlist" || section === "chart" || section === "genre") {
    detail = headerTitle();
    if (section === "album" || section === "playlist") title = headerKind() ?? title;
  }
  return { section, title, detail: detail && detail !== title ? detail : null };
}

/** Маршрут клиента; пересчитывается при навигации и когда шапка страницы дорисовалась. */
export function useRoute(): Route {
  const [route, setRoute] = useState(currentRoute);
  useEffect(() => {
    let last = "";
    const check = () => {
      const next = currentRoute();
      const key = `${next.section}|${next.title}|${next.detail}`;
      if (key !== last) {
        last = key;
        setRoute(next);
      }
    };
    // Клиент — одностраничное приложение на Next.js: адрес меняется через
    // history, а название сущности появляется, когда страница догрузится.
    const timer = window.setInterval(check, 400);
    window.addEventListener("popstate", check);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("popstate", check);
    };
  }, []);
  return route;
}

/** Переход внутри клиента, как по его собственной ссылке. */
export function navigate(url: string) {
  const router = (window as any).next?.router;
  if (router?.push) router.push(url);
  else location.assign(url);
}
