import { useEffect, useState } from "react";
import { getSyncState, subscribe, type SyncState } from "~/mod/features/yandex-sync";

/** Состояние YandexSync для компонентов: перерисовка на каждом снапшоте комнаты. */
export function useSync(): SyncState {
  const [state, setState] = useState(getSyncState());
  useEffect(() => {
    const unsubscribe = subscribe(setState);
    return () => {
      unsubscribe();
    };
  }, []);
  return state;
}
