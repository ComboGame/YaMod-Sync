// YandexSync в моде: настройки комнаты и автоподключение при запуске.
import { connect, hasYandexToken, type SyncConfig } from "./controller";
import { player } from "./sonata";

export * from "./controller";
export { crossfadeEnabled } from "./sonata";

export const SYNC_DEFAULTS: SyncConfig = {
  relay: "",
  room: "home",
  password: "",
  name: "",
  host: false,
  host_port: 8787,
  advertise: "",
};

export async function loadSyncConfig(): Promise<SyncConfig> {
  const saved = (await window.yandexMusicMod.getStorageValue("sync/config")) ?? {};
  return { ...SYNC_DEFAULTS, ...saved };
}

export function saveSyncConfig(config: SyncConfig) {
  window.yandexMusicMod.setStorageValue("sync/config", config);
}

export async function setAutoConnect(on: boolean) {
  window.yandexMusicMod.setStorageValue("sync/autoConnect", on);
}

export async function getAutoConnect(): Promise<boolean> {
  return (await window.yandexMusicMod.getStorageValue("sync/autoConnect")) === true;
}

/** Ждёт, пока приложение отрисует плеер и войдёт в аккаунт. */
function whenPlayerReady(): Promise<void> {
  return new Promise((resolve) => {
    const check = () => (player() && hasYandexToken() ? resolve() : window.setTimeout(check, 1000));
    check();
  });
}

(async () => {
  if (!window.yandexMusicMod?.sync) return;
  if (!(await getAutoConnect())) return;
  const config = await loadSyncConfig();
  if (!config.password || (!config.host && !config.relay)) return;
  await whenPlayerReady();
  await connect(config);
})();
