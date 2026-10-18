import { useEffect, useState } from "react";

// Обновление мода: состояние держит main-процесс (main/updater.ts), окно его
// только показывает. Одна подписка на всё окно — компонентов много, а событие одно.
let current: ModUpdateState | null = null;
const listeners = new Set<(state: ModUpdateState | null) => void>();

function set(state: ModUpdateState) {
  current = state;
  for (const listener of listeners) listener(state);
}

const update = window.yandexMusicMod?.update;
void update?.state().then(set);
update?.onEvent(set);

export function checkForUpdate() {
  return update?.check();
}

export function installUpdate() {
  return update?.install();
}

/** Есть ли что ставить: вышла новая версия, или скачивание оборвалось и можно повторить. */
export function updateReady(state: ModUpdateState | null) {
  return state?.status === "available" || state?.status === "failed" || state?.status === "downloading" || state?.status === "ready";
}

export function onUpdate(listener: (state: ModUpdateState | null) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useUpdate(): ModUpdateState | null {
  const [state, setState] = useState(current);
  useEffect(() => {
    const off = onUpdate(setState);
    setState(current);
    return () => {
      off();
    };
  }, []);
  return state;
}
