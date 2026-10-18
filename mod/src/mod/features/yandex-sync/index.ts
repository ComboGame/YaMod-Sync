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

export type RoomListing = { name: string; listeners: string[]; track?: string; playing: boolean; wave?: boolean };

/** Комнаты сервера — тому, кто знает его пароль (запрос идёт из main-процесса). */
export async function listRooms(relay: string, password: string): Promise<{ ok: true; rooms: RoomListing[] } | { ok: false; error: string }> {
  const sync = window.yandexMusicMod?.sync;
  if (!sync?.rooms) return { ok: false, error: "список комнат недоступен в этом окне" };
  try {
    return await sync.rooms(relay, password);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
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
