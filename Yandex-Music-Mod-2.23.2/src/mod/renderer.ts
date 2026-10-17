import { initFetchInterceptor } from "~/mod/features/utils";

// Инициализация мода utils для перехвата запросов к yandex api
initFetchInterceptor();

// YandexSync: совместное прослушивание через комнату ym-sync
import "./features/yandex-sync";

// Инициализация интерфейса мода
import "./features/ui/index";

// Инициализация мода на изменение шрифта
import "./features/font-changer";

// Инициализация мода на режим разработчика
import "./features/devtools";

// Инициализация мода авто-выбора качества
import "./features/auto-best-quality";

// Инициализация renderer части мода discordRPC
import "./features/discord-RPC/discordRPC";
