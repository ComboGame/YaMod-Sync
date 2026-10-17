// Намеренные правки самого клиента, при любом оформлении. Тема Modrinth — в
// theme/modrinth.css; здесь только то, без чего клиент вводит в заблуждение.
const TWEAKS = `
/* Обложки «Мне нравится и история» на главной — блок, который мод скрывал всегда. */
div[data-test-id="LIKES_HISTORY_COVERS"] { display: none; }

/*
 * Главная в комнате. Очередь комнаты стоит в плеере контекстом «набор треков»,
 * и клиент принимает его за отдельный трек: сверху пишет «Моя волна по треку
 * <название>» с крестиком, а в колесе — «Назад к привычному». Подпись менялась
 * на каждом треке, а обе кнопки запускали «волну по треку» вместо волны комнаты.
 * В комнате они скрыты, а сверху — что играет у комнаты на самом деле.
 */
html.ymsync-in-room [class*="VibePage_context__"] { visibility: hidden; }
html.ymsync-in-room [data-test-id="WHEEL_RESHUFFLE_ITEM"] { visibility: hidden; pointer-events: none; }
html.ymsync-in-room [class*="VibePage_meta__"] { position: relative; }
html.ymsync-in-room [class*="VibePage_meta__"]::before {
  content: var(--ymsync-room-label, "");
  position: absolute;
  inset-inline: 1rem;
  top: 1.75rem;
  z-index: 2;
  text-align: center;
  font-size: 1.125rem;
  font-weight: 700;
  line-height: 1.5rem;
  color: var(--ym-controls-color-primary-default-enabled);
  pointer-events: none;
}

/* Волну ведёт другой участник: режимы слева — его. */
html.ymsync-wave-guest [class*="VibePage_wheel__"] {
  pointer-events: none;
  opacity: 0.4;
  filter: grayscale(0.5);
  transition: opacity 0.2s;
}
`;

export function applyClientTweaks() {
  if (document.getElementById("yandex-music-sync-tweaks")) return;
  const style = document.createElement("style");
  style.id = "yandex-music-sync-tweaks";
  style.textContent = TWEAKS;
  document.head.appendChild(style);
}

/**
 * Состояние комнаты для правил выше: в комнате ли вы, ведёт ли волну другой
 * участник, и что написать над волной на главной.
 */
export function markRoom(state: { inRoom: boolean; guestOf: string | null; label: string | null }) {
  const html = document.documentElement;
  html.classList.toggle("ymsync-in-room", state.inRoom);
  html.classList.toggle("ymsync-wave-guest", state.inRoom && state.guestOf !== null);
  if (state.label) html.style.setProperty("--ymsync-room-label", JSON.stringify(state.label));
  else html.style.removeProperty("--ymsync-room-label");
}
