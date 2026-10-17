// Main-процесс YandexSync: держит ymsync-bridge.exe — ядро синхрона (связь с
// комнатой, общие часы, движок синхрона и «Моей волны») — и пересылает строки
// JSON между ним и окном приложения.
//
// Плеер остаётся плеером Яндекс Музыки: мост говорит, что поставить, когда
// играть и куда перемотать, а окно отвечает, что плеер делает на самом деле
// (см. features/yandex-sync в renderer).
import { app, BrowserWindow, ipcMain } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const BRIDGE_EXE = "ymsync-bridge.exe";

let bridge: ChildProcessWithoutNullStreams | null = null;

/** Установленный мод держит мост в resources/assets, запуск через `electron .` — в assets/ рядом с приложением. */
function bridgePath(): string {
  const candidates = [
    path.join(process.resourcesPath, "assets", BRIDGE_EXE),
    path.join(app.getAppPath(), "assets", BRIDGE_EXE),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error(`не найден ${BRIDGE_EXE} (искал: ${candidates.join(", ")})`);
  return found;
}

function broadcast(message: unknown) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send("yandexSync.event", message);
  }
}

function send(message: unknown) {
  if (!bridge || bridge.killed || !bridge.stdin.writable) return false;
  bridge.stdin.write(JSON.stringify(message) + "\n");
  return true;
}

function ensureBridge(): ChildProcessWithoutNullStreams {
  if (bridge && !bridge.killed && bridge.exitCode === null) return bridge;

  const child = spawn(bridgePath(), [], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    env: { ...process.env, RUST_LOG: process.env.RUST_LOG ?? "ymsync=info,ymsync_bridge=info" },
  });
  bridge = child;

  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    if (!line.trim()) return;
    try {
      broadcast(JSON.parse(line));
    } catch {
      console.warn("[YandexSync] непонятная строка от моста:", line);
    }
  });
  readline.createInterface({ input: child.stderr }).on("line", (line) => console.log("[ymsync-bridge]", line));

  child.on("exit", (code, signal) => {
    if (bridge === child) bridge = null;
    setFullSpeed(false);
    broadcast({ t: "bridge_exit", code, signal });
  });
  child.on("error", (error) => {
    broadcast({ t: "status", state: "stopped", error: `мост YandexSync не запустился: ${error.message}` });
  });
  return child;
}

/**
 * Chromium почти останавливает таймеры свёрнутого окна, а отчёты плеера и
 * выполнение команд комнаты идут по таймеру страницы. Пока вы в комнате, окно
 * работает в полную силу, даже свёрнутым; после выхода — как обычно.
 */
let inRoom = false;
function setFullSpeed(on: boolean) {
  inRoom = on;
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.setBackgroundThrottling(!on);
  }
}

export function setupYandexSync() {
  app.on("browser-window-created", (_event, window) => {
    if (inRoom) window.webContents.setBackgroundThrottling(false);
  });

  ipcMain.handle("yandexSync.start", (_event, config: Record<string, unknown>) => {
    try {
      ensureBridge();
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    // Кэш ядра (сайдкары треков, «Мне нравится») — в профиле приложения.
    const dataDir = path.join(app.getPath("userData"), "ymsync");
    send({ t: "start", config: { ...config, data_dir: dataDir } });
    setFullSpeed(true);
    return { ok: true };
  });

  ipcMain.handle("yandexSync.stop", () => {
    send({ t: "stop" });
    setFullSpeed(false);
    return { ok: true };
  });

  ipcMain.on("yandexSync.command", (_event, command: unknown) => {
    send({ t: "command", command });
  });

  ipcMain.on("yandexSync.player", (_event, state: unknown) => {
    send({ t: "player", state });
  });

  ipcMain.on("yandexSync.loaded", (_event, result: unknown) => {
    send({ t: "loaded", result });
  });

  app.on("before-quit", () => {
    // Мост прощается с комнатой сам; если не успеет — его закроет ОС вместе с нами.
    send({ t: "quit" });
  });
}
