import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "url";
import asar from "asar";
import { prettifyDirectory } from "./prettier";
const _7z = require("7zip-min");
import { $ } from "bun";
import { build as esbuild } from "esbuild";

import { downloadBuild } from "./api";
import type { AppBuild } from "~/types/AppBuild";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const __projectRoot = path.resolve(__dirname, "..", "..");

/** Версия Electron, на которой собрана сама Яндекс Музыка 5.12x. */
const ELECTRON_VERSION = "38.2.2";

const MOD_PRODUCT_NAME = "Яндекс Музыка Sync";
const MOD_APP_ID = "ru.yandex.desktop.music.mod.sync";
const BRIDGE_EXE = "ymsync-bridge.exe";

export type ProcessOptions = {
  /** Только подготовить папку mod/ для `electron .`, без установщика. */
  dev: boolean;
};

/**
 * Точечная правка исходника приложения.
 *
 * Каждая правка обязана найти своё место ровно столько раз, сколько ожидается:
 * сборка Яндекса меняется от версии к версии, и молча пропущенная правка дала бы
 * мод, который выглядит рабочим, а обновления, например, не отключены.
 */
function patch(contents: string, file: string, label: string, find: string | RegExp, replace: string, times = 1) {
  const found = typeof find === "string" ? contents.split(find).length - 1 : (contents.match(find) ?? []).length;
  if (found !== times) {
    throw new Error(`[${file}] ${label}: ожидалось ${times} совпадение(й), найдено ${found}`);
  }
  return typeof find === "string" ? contents.replaceAll(find, replace) : contents.replace(find, replace);
}

function unpack(archive: string, target: string) {
  return new Promise<void>((resolve, reject) =>
    _7z.unpack(archive, target, (error: unknown) => (error ? reject(error) : resolve())),
  );
}

/** Собранный мост к ядру YandexSync: готовый файл или сборка из соседнего репозитория. */
async function locateBridge(log: (message: string) => void): Promise<string> {
  const explicit = process.env.YMSYNC_BRIDGE;
  if (explicit) {
    if (!fs.existsSync(explicit)) throw new Error(`YMSYNC_BRIDGE указывает на несуществующий файл: ${explicit}`);
    return explicit;
  }

  // Каталог mod/ лежит в корне репозитория, рядом с crates/, поэтому по умолчанию ищем уровнем выше.
  const repo = path.resolve(process.env.YMSYNC_REPO ?? path.join(__projectRoot, ".."));
  if (!fs.existsSync(path.join(repo, "crates", "bridge", "Cargo.toml"))) {
    throw new Error(`не найден репозиторий с crates/bridge: ${repo}. Укажите YMSYNC_REPO или YMSYNC_BRIDGE`);
  }
  log(`🦀  cargo build --release -p ymsync-bridge (${repo})`);
  await $`cargo build --release --locked -p ymsync-bridge`.cwd(repo);
  const built = path.join(repo, "target", "release", BRIDGE_EXE);
  if (!fs.existsSync(built)) throw new Error(`после сборки не найден ${built}`);
  return built;
}

export async function processBuild(build: AppBuild, options: ProcessOptions) {
  const buildDir = path.resolve(path.join(__projectRoot, ".versions", build.version));
  const tempDir = path.join(buildDir, "temp");
  const buildBinaryPath = path.join(buildDir, "build.exe");
  const extractDir = path.join(tempDir, "extracted");
  const buildSourceDir = path.join(buildDir, "src");
  const buildModdedDir = path.join(buildDir, "mod");
  const modSourcesDir = path.join(__projectRoot, "src/mod");
  const modCompiledDir = path.join(__projectRoot, "src/mod/dist");

  const log = (message: string) => console.log(message);

  // Скачанный установщик (~100 МБ) переживает пересборку, остальное собирается заново.
  for (const dir of [tempDir, buildSourceDir, buildModdedDir]) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(extractDir, { recursive: true });

  log(`[1] Сборка Яндекс Музыки ${build.version}`);
  if (fs.existsSync(buildBinaryPath) && fs.statSync(buildBinaryPath).size === build.size) {
    log(`✔️   Уже скачана`);
  } else {
    const downloaded = await downloadBuild(build, buildBinaryPath);
    if (downloaded.isErr()) throw new Error(`не удалось скачать сборку: ${downloaded.error}`);
    log(`✔️   Скачана`);
  }

  log(`[2] Распаковка`);
  await unpack(buildBinaryPath, extractDir);
  const resourcesDir = path.join(extractDir, "resources");
  const appAsarPath = path.join(resourcesDir, "app.asar");
  if (!fs.existsSync(appAsarPath)) throw new Error("в установщике нет resources/app.asar");
  asar.extractAll(appAsarPath, buildSourceDir);
  fs.cpSync(buildSourceDir, buildModdedDir, { recursive: true });
  log(`✔️   app.asar распакован`);

  log(`[3] Правки приложения`);

  const files = {
    packageJson: path.join(buildModdedDir, "package.json"),
    indexJs: path.join(buildModdedDir, "index.js"),
    preloadJs: path.join(buildModdedDir, "preload.js"),
  };
  for (const [name, file] of Object.entries(files)) {
    if (!fs.existsSync(file)) throw new Error(`в сборке ${build.version} нет ${name} (${file})`);
  }

  // package.json: своё имя и appId, чтобы мод ставился рядом с обычной Яндекс
  // Музыкой и держал отдельный профиль, и настройки упаковки.
  const packageJson = JSON.parse(fs.readFileSync(files.packageJson, "utf8"));
  packageJson.name = "YandexMusicSync";
  packageJson.productName = MOD_PRODUCT_NAME;
  packageJson.description = "Яндекс Музыка с совместным прослушиванием YandexSync";
  packageJson.devDependencies = { electron: ELECTRON_VERSION };
  packageJson.build = {
    appId: MOD_APP_ID,
    productName: MOD_PRODUCT_NAME,
    electronVersion: ELECTRON_VERSION,
    ...(process.env.ELECTRON_MIRROR ? { electronDownload: { mirror: process.env.ELECTRON_MIRROR } } : {}),
    npmRebuild: false,
    nodeGypRebuild: false,
    publish: null,
    directories: { output: "dist" },
    files: ["**/*", "!dist/**", "!assets/**"],
    extraResources: [{ from: "assets/", to: "assets/", filter: ["**/*"] }],
    win: { icon: "assets/icon.ico", target: "nsis" },
    nsis: {
      oneClick: false,
      allowToChangeInstallationDirectory: true,
      artifactName: "YandexMusicSync-Setup-${version}.${ext}",
      shortcutName: MOD_PRODUCT_NAME,
    },
  };
  fs.writeFileSync(files.packageJson, JSON.stringify(packageJson, null, 2));
  log(`✔️   package.json`);

  let indexJs = fs.readFileSync(files.indexJs, "utf8");
  const f = "index.js";
  indexJs = patch(indexJs, f, "интервал обновлений", /UPDATE_POLL_INTERVAL_MS:\d+/, "UPDATE_POLL_INTERVAL_MS:999999999");
  indexJs = patch(indexJs, f, "триггер обновления данных", /REFRESH_EVENT_TRIGGER_TIME_MS:\d+/, "REFRESH_EVENT_TRIGGER_TIME_MS:999999999");
  indexJs = patch(indexJs, f, "название в трее", /PRODUCT_NAME_LOCALIZED:"[^"]*"/, `PRODUCT_NAME_LOCALIZED:${JSON.stringify(MOD_PRODUCT_NAME)}`);
  // Обновление поставило бы поверх мода обычную Яндекс Музыку.
  indexJs = patch(indexJs, f, "автообновление", "    updater.start();", "    /* yandexMusicMod: автообновление отключено */");
  indexJs = patch(indexJs, f, "минимальная ширина окна", "minWidth: 768", "minWidth: 360");
  indexJs = patch(indexJs, f, "минимальная высота окна", "minHeight: 650", "minHeight: 550");
  // Системная рамка окна по настройке devtools/systemToolbar, как в исходном моде.
  indexJs = patch(
    indexJs,
    f,
    "системная рамка окна",
    'titleBarStyle: "hidden",',
    'titleBarStyle: __yandexMusicModSettings()["devtools/systemToolbar"] ? undefined : "hidden",',
  );
  indexJs =
    `const __yandexMusicModSettings = () => {
  try {
    const file = require("node:path").join(require("electron").app.getPath("userData"), "mod_settings.json");
    return JSON.parse(require("node:fs").readFileSync(file, "utf8"));
  } catch {
    return {};
  }
};
` + indexJs;
  // Main-часть мода — отдельный файл рядом с index.js, подключаемый одной строкой.
  indexJs += `\n\n// yandexMusicMod\nrequire("./yandexMusicMod-main.js");\n`;
  fs.writeFileSync(files.indexJs, indexJs);
  log(`✔️   index.js`);

  const splashScreenPath = path.join(buildModdedDir, "app", "media", "splash_screen");
  if (fs.existsSync(splashScreenPath)) {
    fs.rmSync(splashScreenPath, { recursive: true, force: true });
    log(`✔️   убрано видео на старте`);
  }

  log(`[4] Сборка мода`);

  await $`bun run ui:build`.cwd(__projectRoot);

  // CommonJS: оба файла исполняются не как модули — preload дописывается в
  // preload.js приложения, main подключается через require из index.js.
  await esbuild({
    entryPoints: [path.join(modSourcesDir, "preload.ts")],
    outfile: path.join(modCompiledDir, "preload.js"),
    bundle: true,
    platform: "browser",
    format: "cjs",
    external: ["electron"],
    logLevel: "warning",
  });
  await esbuild({
    entryPoints: [path.join(modSourcesDir, "main.ts")],
    outfile: path.join(modCompiledDir, "main.js"),
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    external: ["electron"],
    logLevel: "warning",
  });

  fs.copyFileSync(path.join(modCompiledDir, "main.js"), path.join(buildModdedDir, "yandexMusicMod-main.js"));

  // Preload приложения работает в песочнице и не может подключать файлы, поэтому
  // часть мода дописывается в него целиком.
  fs.writeFileSync(
    files.preloadJs,
    fs.readFileSync(files.preloadJs, "utf8") +
      `\n\n// yandexMusicMod preload\n(() => {\n${fs.readFileSync(path.join(modCompiledDir, "preload.js"), "utf8")}\n})();\n`,
  );

  const modAppDir = path.join(buildModdedDir, "app", "yandexMusicMod");
  fs.mkdirSync(modAppDir, { recursive: true });
  // Стили мода живут в его shadow-корнях внутри renderer.js; отдельного
  // renderer.css, видимого клиенту, больше нет.
  fs.copyFileSync(path.join(modCompiledDir, "renderer.js"), path.join(modAppDir, "renderer.js"));
  const rendererPath = path.join(modAppDir, "renderer.js");
  fs.writeFileSync(rendererPath, `(function () {\n${fs.readFileSync(rendererPath, "utf8")}\n})()`);

  const appPath = path.join(buildModdedDir, "app");
  const htmlFiles = (fs.readdirSync(appPath, { recursive: true }) as string[]).filter((file) => file.endsWith(".html"));
  for (const htmlFile of htmlFiles) {
    const fullHtmlPath = path.join(appPath, htmlFile);
    const html = fs.readFileSync(fullHtmlPath, "utf8");
    if (!html.includes("<head>")) continue;
    fs.writeFileSync(
      fullHtmlPath,
      html.replace(
        "<head>",
        `<head><script src="/yandexMusicMod/renderer.js"></script>`,
      ),
    );
  }
  log(`✔️   renderer внедрён в ${htmlFiles.length} страниц`);

  log(`[5] Ресурсы и мост YandexSync`);
  const assetsDir = path.join(buildModdedDir, "assets");
  fs.cpSync(path.join(resourcesDir, "assets"), assetsDir, { recursive: true });
  // Иконки мода поверх клиентских: та же звезда, но в зелёном акценте
  // (branding/, собраны scripts/green-icons.py). icon.ico — окно, ярлык и установщик.
  fs.cpSync(path.join(__projectRoot, "branding"), assetsDir, { recursive: true });
  fs.copyFileSync(await locateBridge(log), path.join(assetsDir, BRIDGE_EXE));
  log(`✔️   ${BRIDGE_EXE} в assets`);

  fs.rmSync(tempDir, { recursive: true, force: true });

  if (process.env.PRETTIFY === "true") {
    log(`🛠️  Prettier по ${buildModdedDir}`);
    await prettifyDirectory(buildModdedDir);
  }

  if (options.dev) {
    log(`\nГотово для разработки. Запуск:\n  bunx electron "${buildModdedDir}"`);
    return;
  }

  log(`[6] Упаковка установщика`);
  await $`bunx electron-builder --win nsis --projectDir ${buildModdedDir}`.cwd(__projectRoot);
  const outDir = path.join(buildModdedDir, "dist");
  const installer = fs.readdirSync(outDir).find((file) => file.endsWith(".exe"));
  if (!installer) throw new Error(`electron-builder не оставил установщик в ${outDir}`);
  log(`✔️   ${path.join(outDir, installer)}`);
}
