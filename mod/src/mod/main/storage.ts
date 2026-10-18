// Настройки мода: один JSON-файл в профиле приложения. Окно читает и пишет их
// через window.yandexMusicMod (см. preload.ts), а каждое изменение рассылается
// всем окнам, чтобы функции мода подхватывали его без перезапуска.
import { app, BrowserWindow, ipcMain } from "electron";
import fs from "node:fs";
import path from "node:path";

export const settingsFilePath = () => path.join(app.getPath("userData"), "mod_settings.json");

export function readSettings(): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(settingsFilePath(), "utf8")) ?? {};
  } catch {
    return {};
  }
}

function writeSettings(settings: Record<string, unknown>) {
  fs.mkdirSync(path.dirname(settingsFilePath()), { recursive: true });
  fs.writeFileSync(settingsFilePath(), JSON.stringify(settings, null, 2));
}

/** Запись одной настройки из main-процесса. */
export function writeSetting(key: string, value: unknown) {
  const settings = readSettings();
  settings[key] = value;
  writeSettings(settings);
}

export function setupStorage() {
  ipcMain.handle("yandexMusicMod.getStorageValue", (_event, key: string) => {
    const value = readSettings()[key];
    return value !== undefined ? value : null;
  });

  ipcMain.on("yandexMusicMod.setStorageValue", (_event, key: string, value: unknown) => {
    const settings = readSettings();
    settings[key] = value;
    writeSettings(settings);
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send("yandexMusicMod.storageValueUpdated", key, value);
    }
  });
}
