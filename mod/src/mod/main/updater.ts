// Обновления мода: новые релизы mod-v<версия> на GitHub.
//
// Свой механизм, а не updater клиента: тот отключён патчером, потому что ставил
// бы поверх мода обычную Яндекс Музыку. Здесь всё просто: main-процесс сам
// спрашивает GitHub о релизах, окно показывает, что вышло, и по кнопке main
// скачивает установщик, сверяет его контрольную сумму с SHA256SUMS.txt того же
// релиза и запускает его, закрыв приложение. Установщик ставит новую версию в ту
// же папку, профиль и настройки остаются.
import { app, BrowserWindow, ipcMain } from "electron";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

declare const __MOD_VERSION__: string;

const REPO = "ComboGame/YaMod-Sync";
const TAG_PREFIX = "mod-v";
/** Первая проверка — чуть погодя, чтобы не мешать запуску; дальше — раз в 6 часов. */
const FIRST_CHECK_MS = 15_000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

export type UpdateState =
  | { status: "idle" | "checking" | "latest"; current: string; checkedAt?: number; error?: string }
  | {
      status: "available" | "downloading" | "ready" | "failed";
      current: string;
      version: string;
      notes: string;
      url: string;
      size: number;
      /** 0…1 во время скачивания. */
      progress?: number;
      error?: string;
    };

type Release = { tag_name: string; draft: boolean; prerelease: boolean; body?: string; html_url: string; assets: Asset[] };
type Asset = { name: string; size: number; browser_download_url: string };

const current = (() => {
  try {
    return __MOD_VERSION__;
  } catch {
    return "0.0.0";
  }
})();

let state: UpdateState = { status: "idle", current };
let release: { installer: Asset; sums?: Asset } | null = null;
let downloading = false;

function setState(next: UpdateState) {
  state = next;
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send("modUpdate.event", state);
  }
}

/** «1.10.0» новее «1.9.3»: по числам, а не строкой. */
export function newer(candidate: string, than: string): boolean {
  const parse = (v: string) => v.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(candidate);
  const b = parse(than);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

async function github<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { "User-Agent": `YandexMusicSync/${current}`, Accept: "application/vnd.github+json" },
  });
  if (!response.ok) throw new Error(`GitHub ответил ${response.status}`);
  return (await response.json()) as T;
}

export async function checkForUpdate(): Promise<UpdateState> {
  if (downloading || state.status === "ready") return state;
  setState({ status: "checking", current });
  try {
    const releases = await github<Release[]>(`https://api.github.com/repos/${REPO}/releases?per_page=20`);
    const latest = releases
      .filter((r) => !r.draft && !r.prerelease && r.tag_name.startsWith(TAG_PREFIX))
      .map((r) => ({ release: r, version: r.tag_name.slice(TAG_PREFIX.length) }))
      .sort((a, b) => (newer(a.version, b.version) ? -1 : newer(b.version, a.version) ? 1 : 0))[0];
    const installer = latest?.release.assets.find((a) => /^YandexMusicSync-Setup-.*\.exe$/.test(a.name));
    if (!latest || !installer || !newer(latest.version, current)) {
      release = null;
      setState({ status: "latest", current, checkedAt: Date.now() });
      return state;
    }
    release = { installer, sums: latest.release.assets.find((a) => a.name === "SHA256SUMS.txt") };
    setState({
      status: "available",
      current,
      version: latest.version,
      notes: (latest.release.body ?? "").trim(),
      url: latest.release.html_url,
      size: installer.size,
    });
  } catch (error) {
    // Нет сети или GitHub недоступен — не повод беспокоить: попробуем позже.
    setState({ status: "idle", current, error: error instanceof Error ? error.message : String(error) });
  }
  return state;
}

/** Ожидаемая сумма установщика из SHA256SUMS.txt (строки «сумма  имя»). */
async function expectedSum(sums: Asset | undefined, name: string): Promise<string | null> {
  if (!sums) return null;
  const response = await fetch(sums.browser_download_url, { headers: { "User-Agent": `YandexMusicSync/${current}` } });
  if (!response.ok) throw new Error(`не удалось получить SHA256SUMS.txt (${response.status})`);
  for (const line of (await response.text()).split(/\r?\n/)) {
    const [sum, file] = line.trim().split(/\s+\*?/);
    if (sum && file === name) return sum.toLowerCase();
  }
  return null;
}

async function download(asset: Asset, target: string, onProgress: (fraction: number) => void) {
  const response = await fetch(asset.browser_download_url, { headers: { "User-Agent": `YandexMusicSync/${current}` } });
  if (!response.ok || !response.body) throw new Error(`скачивание не удалось (${response.status})`);
  const total = Number(response.headers.get("content-length")) || asset.size;
  const hash = crypto.createHash("sha256");
  const file = fs.createWriteStream(target);
  let received = 0;
  let reported = 0;
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      hash.update(chunk);
      received += chunk.length;
      if (!file.write(chunk)) await new Promise<void>((resolve) => file.once("drain", () => resolve()));
      if (received - reported > total / 100) {
        reported = received;
        onProgress(Math.min(1, received / total));
      }
    }
  } finally {
    await new Promise<void>((resolve, reject) => file.end((error?: Error | null) => (error ? reject(error) : resolve())));
  }
  return hash.digest("hex");
}

export async function installUpdate(): Promise<UpdateState> {
  if (state.status !== "available" && state.status !== "failed") return state;
  if (!release || downloading) return state;
  const base = state;
  downloading = true;
  try {
    setState({ ...base, status: "downloading", progress: 0, error: undefined });
    const target = path.join(app.getPath("temp"), `YandexMusicSync-Setup-${base.version}.exe`);
    const [sum, expected] = await Promise.all([
      download(release.installer, target, (progress) => setState({ ...base, status: "downloading", progress })),
      expectedSum(release.sums, release.installer.name),
    ]);
    if (expected && sum !== expected) {
      fs.rmSync(target, { force: true });
      throw new Error("контрольная сумма установщика не совпала с SHA256SUMS.txt — файл не запущен");
    }
    setState({ ...base, status: "ready", progress: 1 });
    // Установщик ставит поверх, поэтому приложение должно закрыться: он сам его
    // об этом спросил бы. Мост прощается с комнатой в before-quit.
    const child = spawn(target, [], { detached: true, stdio: "ignore" });
    child.unref();
    setTimeout(() => app.quit(), 500);
  } catch (error) {
    setState({ ...base, status: "failed", error: error instanceof Error ? error.message : String(error) });
  } finally {
    downloading = false;
  }
  return state;
}

export function setupUpdater() {
  ipcMain.handle("modUpdate.state", () => state);
  ipcMain.handle("modUpdate.check", () => checkForUpdate());
  ipcMain.handle("modUpdate.install", () => installUpdate());

  app.whenReady().then(() => {
    setTimeout(() => void checkForUpdate(), FIRST_CHECK_MS);
    setInterval(() => void checkForUpdate(), CHECK_EVERY_MS);
  });
}
