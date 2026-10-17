// Анимации панели на Anime.js v4. Короткие, только transform и opacity, и
// только по поводу: открылась панель, сменился экран или трек, кто-то вошёл.
// При prefers-reduced-motion ничего не двигается — элементы сразу в конечном виде.
import { animate, stagger, utils, type JSAnimation } from "animejs";

const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

export function reducedMotion() {
  return reducedQuery.matches;
}

type Targets = Element | Element[] | NodeListOf<Element> | null | undefined;

function list(targets: Targets): Element[] {
  if (!targets) return [];
  if (targets instanceof Element) return [targets];
  return Array.from(targets);
}

/** Открытие панели: выезжает слева и проявляется. */
export function panelIn(panel: Element | null, backdrop: Element | null) {
  const els = list(panel);
  if (!els.length) return;
  if (reducedMotion()) {
    utils.set([...els, ...list(backdrop)], { opacity: 1, x: 0 });
    return;
  }
  if (backdrop) animate(backdrop, { opacity: [0, 1], duration: 180, ease: "outQuad" });
  animate(els, { opacity: [0, 1], x: [-20, 0], duration: 240, ease: "outQuart" });
}

/** Закрытие панели; `done` — когда можно убрать её из DOM. */
export function panelOut(panel: Element | null, backdrop: Element | null, done: () => void) {
  if (!panel || reducedMotion()) {
    done();
    return;
  }
  if (backdrop) animate(backdrop, { opacity: [1, 0], duration: 150, ease: "outQuad" });
  animate(panel, { opacity: [1, 0], x: [0, -16], duration: 160, ease: "inQuad", onComplete: done });
}

/** Новый экран или новый трек: содержимое чуть сдвигается и проявляется, по очереди. */
export function contentIn(targets: Targets, from: { x?: number; y?: number } = { y: 6 }) {
  const els = list(targets);
  if (!els.length || reducedMotion()) return;
  animate(els, {
    opacity: [0, 1],
    ...(from.x !== undefined ? { x: [from.x, 0] } : {}),
    ...(from.y !== undefined ? { y: [from.y, 0] } : {}),
    duration: 200,
    delay: stagger(35),
    ease: "outQuart",
  });
}

/** Участник вошёл: строка вырастает из точки. */
export function itemIn(targets: Targets) {
  const els = list(targets);
  if (!els.length || reducedMotion()) return;
  animate(els, { opacity: [0, 1], scale: [0.92, 1], duration: 220, delay: stagger(40), ease: "outBack(1.4)" });
}

/** Участник вышел: строка гаснет, потом её можно убрать. */
export function itemOut(target: Element | null, done: () => void) {
  if (!target || reducedMotion()) {
    done();
    return;
  }
  animate(target, { opacity: [1, 0], scale: [1, 0.94], duration: 180, ease: "inQuad", onComplete: done });
}

/**
 * Пульс индикатора «вместе»: кольцо расходится от точки, пока вы в синхроне.
 * Возвращает остановку — вызвать, когда синхрон потерян или панель закрыта.
 */
export function pulse(target: Element | null): () => void {
  if (!target || reducedMotion()) return () => {};
  const animation: JSAnimation = animate(target, {
    scale: [1, 2.4],
    opacity: [0.55, 0],
    duration: 1600,
    ease: "outQuad",
    loop: true,
  });
  return () => {
    animation.revert();
  };
}
