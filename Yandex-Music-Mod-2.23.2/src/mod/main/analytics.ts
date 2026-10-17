// Блокировка аналитики и рекламных запросов, как в исходном моде. Раньше этот код
// вставлялся в index.js приложения, теперь он работает из main-части мода.
import { app, session } from "electron";

const BLOCKED_URLS = [
  "https://yandex.ru/clck/*",
  "https://mc.yandex.ru/*",
  "https://api.music.yandex.net/dynamic-pages/trigger/*",
  "https://log.strm.yandex.ru/*",
  "https://api.acquisition-gwe.plus.yandex.net/*",
  "https://api.events.plus.yandex.net/*",
  "https://events.plus.yandex.net/*",
  "https://yandex.ru/ads/*",
  "https://strm.yandex.ru/ping",
];

/** Заголовки, по которым запросы к API связываются с устройством. */
const STRIPPED_HEADERS = ["x-yandex-music-device", "x-request-id"];

export function blockAnalytics() {
  app.whenReady().then(() => {
    session.defaultSession.webRequest.onBeforeRequest({ urls: BLOCKED_URLS }, (_details, callback) => {
      callback({ cancel: true });
    });
    session.defaultSession.webRequest.onBeforeSendHeaders(
      { urls: ["https://api.music.yandex.net/*"] },
      (details, callback) => {
        for (const header of STRIPPED_HEADERS) delete details.requestHeaders[header];
        callback({ requestHeaders: details.requestHeaders });
      },
    );
  });
}
