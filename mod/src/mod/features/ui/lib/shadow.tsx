// Изоляция интерфейса мода: всё рисуется в Shadow DOM, со своей копией CSS.
// Tailwind, его preflight и токены не видны клиенту Яндекс Музыки, а стили
// клиента не видны моду. Порталы Radix получают контейнер внутри того же
// shadow-корня, иначе выпадающие списки оказались бы в document.body без стилей.
import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import modCss from "../index.css?inline";
import sonnerCss from "sonner/dist/styles.css?inline";
import interLatin from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?inline";
import interCyrillic from "@fontsource-variable/inter/files/inter-cyrillic-wght-normal.woff2?inline";

/** Семейство с собственным именем: объявление шрифта ничего не меняет в клиенте. */
export const FONT_FAMILY = "YMSync Inter";

const LATIN =
  "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
const CYRILLIC = "U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116";

/**
 * @font-face внутри shadow-корня Chromium не применяет, поэтому шрифт объявляется
 * в документе — один раз и под именем, которого клиент не использует.
 */
function declareFont() {
  if (document.getElementById("yandex-music-sync-font")) return;
  const style = document.createElement("style");
  style.id = "yandex-music-sync-font";
  style.textContent = [
    [interLatin, LATIN],
    [interCyrillic, CYRILLIC],
  ]
    .map(
      ([src, range]) =>
        `@font-face{font-family:"${FONT_FAMILY}";font-style:normal;font-display:swap;font-weight:100 900;src:url(${src}) format("woff2-variations");unicode-range:${range};}`,
    )
    .join("\n");
  document.head.appendChild(style);
}

/**
 * Tailwind 4 задаёт начальные значения своих переменных (--tw-translate-x,
 * --tw-ring-shadow…) через @property, а Chromium не применяет @property внутри
 * shadow-корня. Без них сдвиги, кольца фокуса и тени не работают — например,
 * бегунок переключателя не двигается. Те же значения дублируются обычным
 * правилом в самом нижнем слое, чтобы утилиты их перекрывали.
 */
function withPropertyDefaults(css: string): string {
  const defaults: string[] = [];
  for (const match of css.matchAll(/@property\s+(--[\w-]+)\s*\{([^}]*)\}/g)) {
    const initial = /initial-value\s*:\s*([^;]+);?/.exec(match[2]!);
    if (initial) defaults.push(`${match[1]}:${initial[1]!.trim()};`);
  }
  if (!defaults.length) return css;
  return `@layer properties{:host,*,::before,::after,::backdrop{${defaults.join("")}}}\n${css}`;
}

const STYLES = `${withPropertyDefaults(modCss)}\n${sonnerCss}`;

/** Корни мода: события из их полей ввода — наши, а не горячие клавиши клиента. */
const modRoots = new WeakSet<ShadowRoot>();

/**
 * У клиента буквы — горячие клавиши: k — пауза, l и j — перемотка, n — следующий
 * трек, m — звук и так далее. Он не реагирует на них в полях ввода, но событие
 * из shadow-корня мода приходит к документу с хостом в target, а не с полем, —
 * и клиент глотал эти буквы в названии комнаты, имени, адресе. Клавиши, нажатые
 * в поле мода, дальше окна не идут. Ввод при этом не страдает: печать — действие
 * браузера по умолчанию, а не обработчик. Escape и Tab идут как обычно: ими
 * закрывают окна и переходят между полями.
 */
function guardModInputs() {
  const stop = (event: KeyboardEvent) => {
    if (event.key === "Escape" || event.key === "Tab") return;
    const target = event.composedPath()[0];
    if (!(target instanceof HTMLElement)) return;
    const editable = target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
    const root = target.getRootNode();
    if (editable && root instanceof ShadowRoot && modRoots.has(root)) event.stopPropagation();
  };
  // На window в фазе захвата — раньше любого обработчика клиента.
  for (const type of ["keydown", "keypress", "keyup"] as const) window.addEventListener(type, stop, true);
}

let inputsGuarded = false;

/** Прикрепляет к элементу shadow-корень мода со стилями; повторно — тот же корень. */
export function attachModShadow(host: HTMLElement): HTMLElement {
  declareFont();
  if (!inputsGuarded) {
    inputsGuarded = true;
    guardModInputs();
  }
  const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
  modRoots.add(root);
  let mount = root.querySelector<HTMLElement>(":scope > [data-ymsync-mount]");
  if (!mount) {
    const style = document.createElement("style");
    style.textContent = STYLES;
    root.appendChild(style);
    mount = document.createElement("div");
    mount.dataset.ymsyncMount = "";
    mount.className = "ymsync-root";
    root.appendChild(mount);
  }
  return mount;
}

const PortalContainer = createContext<HTMLElement | null>(null);

export function PortalContainerProvider(props: { container: HTMLElement; children: ReactNode }) {
  return <PortalContainer.Provider value={props.container}>{props.children}</PortalContainer.Provider>;
}

/** Куда порталам Radix класть всплывающее: внутрь shadow-корня мода. */
export function usePortalContainer(): HTMLElement | undefined {
  return useContext(PortalContainer) ?? undefined;
}

/** Рисует детей в shadow-корне чужого элемента — например, в шапке клиента. */
export function ShadowPortal(props: { host: HTMLElement; children: ReactNode }) {
  const [mount, setMount] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => setMount(attachModShadow(props.host)), [props.host]);
  if (!mount) return null;
  return createPortal(<PortalContainerProvider container={mount}>{props.children}</PortalContainerProvider>, mount);
}
