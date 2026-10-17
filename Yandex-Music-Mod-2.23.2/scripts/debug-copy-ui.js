// Пересобирает renderer, main и preload мода и кладёт их в последнюю
// подготовленную сборку (.versions/<версия>/mod), не перепатчивая приложение
// целиком. Для работы с `bun run dev` + `electron .versions/<версия>/mod`: после
// изменений в renderer окно достаточно перезагрузить, после main и preload —
// перезапустить приложение.
import { $ } from "bun";
import { build } from "esbuild";
import path from "path";
import fs from "fs";

await $`bun run ui:build`;

const versions = fs
  .readdirSync(".versions")
  .filter((name) => fs.existsSync(path.join(".versions", name, "mod", "app")))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
const latest = versions.at(-1);
if (!latest) {
  console.error("нет подготовленной сборки: сначала bun run dev");
  process.exit(1);
}

const modPath = path.join(".versions", latest, "mod", "app", "yandexMusicMod");
fs.mkdirSync(modPath, { recursive: true });

for (const file of ["renderer.js", "renderer.css"]) {
  fs.copyFileSync(path.join("src/mod/dist", file), path.join(modPath, file));
}
const rendererPath = path.join(modPath, "renderer.js");
fs.writeFileSync(rendererPath, `(function () {\n${fs.readFileSync(rendererPath, "utf8")}\n})()`);

const modRoot = path.join(".versions", latest, "mod");
const common = { bundle: true, format: "cjs", external: ["electron"], logLevel: "warning" };
await build({ ...common, entryPoints: ["src/mod/main.ts"], outfile: "src/mod/dist/main.js", platform: "node", target: "node22" });
await build({ ...common, entryPoints: ["src/mod/preload.ts"], outfile: "src/mod/dist/preload.js", platform: "browser" });
fs.copyFileSync("src/mod/dist/main.js", path.join(modRoot, "yandexMusicMod-main.js"));
// preload.js приложения — нетронутый из .versions/<версия>/src плюс наш.
fs.writeFileSync(
  path.join(modRoot, "preload.js"),
  fs.readFileSync(path.join(".versions", latest, "src", "preload.js"), "utf8") +
    `

// yandexMusicMod preload
(() => {
${fs.readFileSync("src/mod/dist/preload.js", "utf8")}
})();
`,
);

console.log(`renderer, main и preload обновлены в ${modRoot}`);
