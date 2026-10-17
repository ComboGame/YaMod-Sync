// Main-часть мода. Собирается в yandexMusicMod-main.js и подключается одной
// строкой в конце index.js приложения (см. src/patcher/patcher.ts).
import { setupStorage } from "./main/storage";
import { blockAnalytics } from "./main/analytics";
import { startDiscordRpc } from "./main/discord-rpc";
import { setupYandexSync } from "./main/yandex-sync";

setupStorage();
blockAnalytics();
setupYandexSync();
startDiscordRpc();
