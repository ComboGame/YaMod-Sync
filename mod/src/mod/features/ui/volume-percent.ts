// Процент громкости над всплывающим ползунком клиента. Значение ставится в
// data-атрибут контейнера ползунка, а рисует его CSS (::before): DOM клиента
// не меняется. Ползунок управляемый — клиент меняет его value и без события
// input (колесо мыши), поэтому значение перечитывается на следующем кадре после
// любого ввода рядом с ним.
const STYLE_ID = "ymsync-volume-percent";
const ROOT = '[class*="ChangeVolume_root__"]';
const CONTAINER = '[class*="ChangeVolume_sliderContainer__"]';
const SLIDER = 'input[data-test-id="CHANGE_VOLUME_SLIDER"]';

const CSS = `
html ${CONTAINER} [class*="ChangeVolume_slider__"] {
  min-width: 10.5rem;
}
html ${CONTAINER}[data-ymsync-volume]::before {
  content: attr(data-ymsync-volume);
  position: absolute;
  inset-inline: 0;
  top: 0.625rem;
  z-index: 1;
  text-align: center;
  font-size: 0.75rem;
  line-height: 1rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--ym-controls-color-secondary-text-enabled_variant, currentColor);
  pointer-events: none;
}
`;

function show(root: Element) {
  const slider = root.querySelector<HTMLInputElement>(SLIDER);
  const container = root.querySelector<HTMLElement>(CONTAINER);
  if (!slider || !container) return;
  const max = Number(slider.max) || 1;
  const percent = `${Math.round((Number(slider.value) / max) * 100)}%`;
  if (container.dataset.ymsyncVolume !== percent) container.dataset.ymsyncVolume = percent;
}

const pending = new Set<Element>();
let scheduled = false;

function onEvent(event: Event) {
  const root = event.target instanceof Element ? event.target.closest(ROOT) : null;
  if (!root) return;
  pending.add(root);
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    const roots = [...pending];
    pending.clear();
    for (const el of roots) show(el);
    // Обновление от колеса React может отрисовать позже кадра.
    window.setTimeout(() => roots.forEach(show), 120);
  });
}

export function showVolumePercent() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
  for (const type of ["pointerover", "input", "wheel", "keydown", "focusin"]) {
    window.addEventListener(type, onEvent, { capture: true, passive: true });
  }
}
