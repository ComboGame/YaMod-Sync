// Оформление клиента: включает и выключает тему Modrinth (modrinth.css) и
// следит за местом под колонку комнаты.
import css from "./modrinth.css?raw";

const STYLE_ID = "ymsync-theme";
const THEME_CLASS = "ymsync-theme";

export const DOCK_WIDTH = 300;

export function applyTheme(on: boolean) {
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (on && !style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }
  if (!on) style?.remove();
  document.documentElement.classList.toggle(THEME_CLASS, on);
  if (on) watchNavbar();
  else stopNavbar();
}

/** Сколько места справа отдать колонке комнаты: 0, когда она закрыта или лежит поверх. */
export function reserveDock(width: number) {
  document.documentElement.style.setProperty("--ms-dock", `${width}px`);
}

/*
 * Подписи пунктов навигации в сайдбаре скрыты — остаются иконки, как в
 * Modrinth. Чтобы пункт оставался понятным, его подпись становится подсказкой и
 * доступным именем ссылки. Сайдбар клиент перерисовывает, поэтому — наблюдателем.
 */
let navObserver: MutationObserver | null = null;

function labelNavbar() {
  for (const link of Array.from(document.querySelectorAll<HTMLAnchorElement>('ol[class*="NavbarDesktop_navigationGroup__"] > li > a'))) {
    const label = link.querySelector("span[title]")?.getAttribute("title") ?? link.textContent?.trim();
    if (label && link.title !== label) {
      link.title = label;
      link.setAttribute("aria-label", label);
    }
  }
}

let labelScheduled = false;

function watchNavbar() {
  labelNavbar();
  if (navObserver) return;
  // Клиент меняет DOM постоянно (прогресс трека, анимации) — подписи
  // проверяются не чаще раза за кадр.
  navObserver = new MutationObserver(() => {
    if (labelScheduled) return;
    labelScheduled = true;
    requestAnimationFrame(() => {
      labelScheduled = false;
      labelNavbar();
    });
  });
  navObserver.observe(document.body, { childList: true, subtree: true });
}

function stopNavbar() {
  navObserver?.disconnect();
  navObserver = null;
}
