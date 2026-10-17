// Дописывается в конец preload.js приложения. Preload работает в песочнице,
// поэтому здесь только electron и ничего своего.
const electron = require("electron");

const subscribe = (channel: string, cb: (...args: any[]) => void) => {
  const listener = (_event: unknown, ...args: any[]) => cb(...args);
  electron.ipcRenderer.on(channel, listener);
  return () => electron.ipcRenderer.removeListener(channel, listener);
};

// Только в окне самого приложения: страницы входа Яндекса доступа к настройкам
// мода и к комнате не получают.
if (window === window.top && window.location.protocol === "music-application:") {
  electron.contextBridge.exposeInMainWorld("yandexMusicMod", {
    getStorageValue: (key: string) => electron.ipcRenderer.invoke("yandexMusicMod.getStorageValue", key),
    setStorageValue: (key: string, value: unknown) =>
      electron.ipcRenderer.send("yandexMusicMod.setStorageValue", key, value),
    onStorageChanged: (cb: (key: string, value: unknown) => void) => subscribe("yandexMusicMod.storageValueUpdated", cb),
    sync: {
      start: (config: unknown) => electron.ipcRenderer.invoke("yandexSync.start", config),
      stop: () => electron.ipcRenderer.invoke("yandexSync.stop"),
      command: (command: unknown) => electron.ipcRenderer.send("yandexSync.command", command),
      reportPlayer: (state: unknown) => electron.ipcRenderer.send("yandexSync.player", state),
      reportLoaded: (result: unknown) => electron.ipcRenderer.send("yandexSync.loaded", result),
      onEvent: (cb: (message: unknown) => void) => subscribe("yandexSync.event", cb),
    },
  });
}
