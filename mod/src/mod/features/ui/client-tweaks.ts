// Намеренные правки самого клиента, унаследованные от исходного мода. Это
// единственный CSS мода, который виден клиенту, и он ничего не стилизует —
// только прячет.
const TWEAKS = `
/* Обложки «Мне нравится и история» на главной — блок, который мод скрывал всегда. */
div[data-test-id="LIKES_HISTORY_COVERS"] { display: none; }
`;

export function applyClientTweaks() {
  if (document.getElementById("yandex-music-sync-tweaks")) return;
  const style = document.createElement("style");
  style.id = "yandex-music-sync-tweaks";
  style.textContent = TWEAKS;
  document.head.appendChild(style);
}
