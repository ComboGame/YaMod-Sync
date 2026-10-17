import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { Code2, ListMusic, LogOut, Paintbrush, Radio, Sparkles, Users, X } from "lucide-react";
import { FaGithub } from "react-icons/fa";

import { Button } from "@ui/components/ui/button";
import { Card, CardTitle, PanelSection, SettingRow } from "@ui/components/ui/setting-row";
import { Switch } from "@ui/components/ui/switch";
import { JoinForm } from "@ui/components/sync/join-form";
import { NowPlaying } from "@ui/components/sync/now-playing";
import { WaveCard } from "@ui/components/sync/wave-card";
import { ListenerList } from "@ui/components/sync/listeners";
import { QueueList } from "@ui/components/sync/queue";
import { Playground } from "@ui/components/playground";
import { IPChecker } from "@ui/components/ip-checker";
import { FontChanger } from "@ui/components/font-changer";
import { Devtools } from "@ui/components/devtools";
import { AutoBestQuality } from "@ui/components/auto-best-quality";
import { DiscordRPC } from "@ui/components/discord-rpc";
import { AutoLiker } from "@ui/components/auto-liker";
import { useSync } from "@ui/hooks/use-sync";
import { contentIn, modalIn, modalOut } from "@ui/lib/motion";
import { cn } from "@ui/lib/utils";
import { disconnect, type SyncState } from "~/mod/features/yandex-sync";
import { BrandMark } from "./brand";
import { clientVersion, setShell, useShell, type SettingsScreen, type Theme } from "./shell-state";

import modVersion from "../../../../../VERSION?raw";

const REPO_URL = "https://github.com/ComboGame/YaMod-Sync";

type Item = { id: SettingsScreen; label: string; icon: typeof Radio };

const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: "Комната",
    items: [
      { id: "room", label: "Подключение", icon: Radio },
      { id: "queue", label: "Очередь", icon: ListMusic },
      { id: "people", label: "Участники", icon: Users },
    ],
  },
  {
    title: "Приложение",
    items: [
      { id: "appearance", label: "Внешний вид", icon: Paintbrush },
      { id: "features", label: "Возможности", icon: Sparkles },
    ],
  },
  {
    title: "Система",
    items: [{ id: "system", label: "Разработчику", icon: Code2 }],
  },
];

const TITLES: Record<SettingsScreen, { title: string; text: string }> = {
  room: { title: "Комната", text: "Сервер, комната и как вас видят остальные." },
  queue: { title: "Очередь комнаты", text: "Одна на всех. Клик по треку ставит его всей комнате." },
  people: { title: "Участники", text: "Все, кто сейчас слушает вместе с вами." },
  appearance: { title: "Оформление", text: "Как выглядит Яндекс Музыка." },
  features: { title: "Возможности", text: "Дополнения к приложению." },
  system: { title: "Разработчику", text: "Инструменты для отладки и сведения о моде." },
};

function inRoom(sync: SyncState) {
  return !!sync.room && (sync.session === "connected" || sync.session === "reconnecting");
}

function EmptyState(props: { title: string; text: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-surface-5 px-6 py-12 text-center">
      <p className="text-strong text-[15px] font-bold">{props.title}</p>
      <p className="text-muted-foreground mt-1 max-w-[340px] text-[13px] leading-snug">{props.text}</p>
      {props.action && <div className="mt-4">{props.action}</div>}
    </div>
  );
}

function RoomScreen({ sync }: { sync: SyncState }) {
  if (!inRoom(sync)) return <JoinForm />;
  const room = sync.room!;
  return (
    <div className="flex flex-col gap-3">
      <NowPlaying room={room} />
      <div className="grid items-start gap-3 md:grid-cols-2">
        <WaveCard room={room} />
        <Card>
          <CardTitle title={sync.roomName ?? "Комната"} description={room.hosting ? `На этом компьютере: ${room.hosting}` : (sync.server ?? undefined)} />
          <Button variant="destructive" className="w-full" onClick={() => void disconnect()}>
            <LogOut /> Выйти из комнаты
          </Button>
        </Card>
      </div>
    </div>
  );
}

function QueueScreen({ sync }: { sync: SyncState }) {
  if (!inRoom(sync) || !sync.room!.queue.length) {
    return (
      <EmptyState
        title="Очередь пуста"
        text={inRoom(sync) ? "Включите трек, альбом или волну в приложении — они станут очередью комнаты." : "Очередь появится, когда вы войдёте в комнату."}
        action={!inRoom(sync) && <Button onClick={() => setShell({ settings: "room" })}>Войти в комнату</Button>}
      />
    );
  }
  return (
    <Card className="p-2">
      <QueueList room={sync.room!} />
    </Card>
  );
}

function PeopleScreen({ sync }: { sync: SyncState }) {
  if (!inRoom(sync)) {
    return (
      <EmptyState
        title="Вы не в комнате"
        text="Здесь будут все, кто слушает вместе с вами."
        action={<Button onClick={() => setShell({ settings: "room" })}>Войти в комнату</Button>}
      />
    );
  }
  return (
    <Card className="p-2">
      <ListenerList room={sync.room!} />
    </Card>
  );
}

/** Карточка темы с миниатюрой окна — как выбор темы в настройках Modrinth. */
function ThemeCard(props: { theme: Theme; current: Theme; title: string; hint: string; preview: ReactNode }) {
  const selected = props.theme === props.current;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={() => setShell({ theme: props.theme })}
      className={cn(
        "flex cursor-pointer flex-col overflow-hidden rounded-lg border text-left transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-brand-soft",
        selected ? "border-brand bg-surface-3" : "border-surface-4 bg-surface-2-5 hover:border-surface-5",
      )}
    >
      <div className="flex h-28 items-center justify-center bg-surface-1 p-4">{props.preview}</div>
      <div className="flex items-start gap-2.5 border-t border-surface-4 px-3.5 py-3">
        <span
          className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-2", selected ? "border-brand" : "border-surface-5")}
          aria-hidden
        >
          {selected && <span className="size-2 rounded-full bg-brand" />}
        </span>
        <span className="min-w-0">
          <span className="text-strong block text-sm font-semibold">{props.title}</span>
          <span className="text-muted-foreground block text-xs leading-snug">{props.hint}</span>
        </span>
      </div>
    </button>
  );
}

function MiniWindow(props: { rail: string; page: string; accent: string; border: string }) {
  return (
    <div className="flex h-20 w-36 overflow-hidden rounded-md border" style={{ borderColor: props.border, background: props.rail }}>
      <div className="flex w-6 flex-col items-center gap-1.5 pt-2">
        <span className="size-3 rounded-[4px]" style={{ background: props.accent }} />
        <span className="size-3 rounded-[4px] bg-white/15" />
        <span className="size-3 rounded-[4px] bg-white/15" />
      </div>
      <div className="mt-2 flex-1 rounded-tl-md border-t border-l p-2" style={{ background: props.page, borderColor: props.border }}>
        <span className="block h-1.5 w-12 rounded-full bg-white/70" />
        <span className="mt-1.5 block h-1.5 w-16 rounded-full bg-white/25" />
        <span className="mt-2.5 block h-3 w-8 rounded-[4px]" style={{ background: props.accent }} />
      </div>
    </div>
  );
}

function AppearanceScreen() {
  const shell = useShell();
  return (
    <div className="flex flex-col gap-4">
      <div role="radiogroup" aria-label="Тема" className="grid gap-3 sm:grid-cols-2">
        <ThemeCard
          theme="modrinth"
          current={shell.theme}
          title="Modrinth OLED"
          hint="Узкий сайдбар, верхняя панель, колонка комнаты, чёрный фон и зелёный акцент"
          preview={<MiniWindow rail="#000" page="#000" accent="#1bd96a" border="#25262b" />}
        />
        <ThemeCard
          theme="original"
          current={shell.theme}
          title="Как в Яндекс Музыке"
          hint="Оформление клиента без изменений; Sync — кнопкой в навигации"
          preview={<MiniWindow rail="#000" page="#121212" accent="#ffdb4d" border="#1a1a1a" />}
        />
      </div>
      {shell.theme === "modrinth" && (
        <PanelSection title="Колонка комнаты">
          <SettingRow title="Показывать справа" hint="Что играет в комнате, кто слушает и волна. Узкое окно кладёт её поверх страницы">
            <Switch checked={shell.dock} onCheckedChange={(dock) => setShell({ dock })} aria-label="Колонка комнаты" />
          </SettingRow>
        </PanelSection>
      )}
    </div>
  );
}

function FeaturesScreen() {
  return (
    <div className="grid items-start gap-3 md:grid-cols-2">
      <AutoBestQuality />
      <DiscordRPC />
      <FontChanger />
      <AutoLiker />
    </div>
  );
}

function SystemScreen({ devtools }: { devtools: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      <Devtools />
      {devtools && <IPChecker />}
      {devtools && <Playground />}
      <Card>
        <CardTitle title="О моде" />
        <p className="text-muted-foreground text-[13px] leading-snug">
          Яндекс Музыка со встроенным YandexSync. Работает с вашей подпиской Плюс: мод не открывает платное и не
          скачивает треки. Синхрон — ядро ym-sync, интерфейс и патчер выросли из Yandex Music Mod.
        </p>
        <Button variant="secondary" size="sm" className="mt-3" onClick={() => window.open(REPO_URL, "_blank", "noreferrer")}>
          <FaGithub /> Исходный код
        </Button>
      </Card>
    </div>
  );
}

/**
 * Настройки мода — модальное окно, как настройки Modrinth App: разделы
 * группами слева, содержимое справа, версии внизу.
 */
export function SettingsModal({ screen, devtools }: { screen: SettingsScreen; devtools: boolean }) {
  const sync = useSync();
  const dialog = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const closing = useRef(false);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    modalOut(dialog.current, backdrop.current, () => setShell({ settings: null }));
  }, []);

  useLayoutEffect(() => {
    modalIn(dialog.current, backdrop.current);
    dialog.current?.focus();
  }, []);

  useEffect(() => {
    contentIn(content.current?.children ? Array.from(content.current.children) : null);
  }, [screen]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const version = clientVersion();
  return (
    <div className="fixed inset-0 z-[2147483000] flex items-center justify-center p-6">
      <div ref={backdrop} className="absolute inset-0 bg-black/55 backdrop-blur-[6px]" onClick={close} aria-hidden />
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ymsync-settings-title"
        tabIndex={-1}
        className="relative flex h-[min(640px,100%)] w-[min(940px,100%)] flex-col overflow-hidden rounded-xl border border-surface-4 bg-surface-2 shadow-[var(--ms-shadow-floating)] outline-none"
      >
        <header className="flex items-center justify-between border-b border-surface-4 px-6 py-4">
          <h2 id="ymsync-settings-title" className="text-strong text-2xl font-bold">
            Настройки
          </h2>
          <button
            type="button"
            onClick={close}
            aria-label="Закрыть"
            className="flex size-10 cursor-pointer items-center justify-center rounded-full bg-surface-4 text-foreground transition-colors outline-none hover:bg-surface-5 hover:text-strong focus-visible:ring-[3px] focus-visible:ring-brand-soft"
          >
            <X className="size-5" />
          </button>
        </header>
        <div className="flex min-h-0 flex-1">
          <nav aria-label="Разделы настроек" className="flex w-60 shrink-0 flex-col border-r border-surface-4">
            <div className="flex-1 overflow-y-auto px-3 py-4">
              {GROUPS.map((group) => (
                <div key={group.title} className="mb-4 last:mb-0">
                  <div className="text-muted-foreground mb-1.5 px-3 text-xs font-bold tracking-wide uppercase">{group.title}</div>
                  {group.items.map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setShell({ settings: id })}
                      aria-current={screen === id ? "page" : undefined}
                      className={cn(
                        "flex h-10 w-full cursor-pointer items-center gap-2.5 rounded-md px-3 text-[15px] font-semibold transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-brand-soft",
                        screen === id ? "bg-brand-soft text-brand" : "text-foreground hover:bg-surface-4 hover:text-strong",
                      )}
                    >
                      <Icon className="size-[18px]" />
                      {label}
                    </button>
                  ))}
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2.5 border-t border-surface-4 px-5 py-3.5">
              <BrandMark className="size-6 shrink-0" />
              <div className="text-muted-foreground min-w-0 text-xs leading-snug">
                <div className="text-foreground truncate font-semibold">Яндекс Музыка Sync {modVersion.trim()}</div>
                <div className="truncate">{version ? `Клиент ${version}` : "Клиент Яндекс Музыки"}</div>
              </div>
            </div>
          </nav>
          <div className="min-w-0 flex-1 overflow-y-auto px-6 py-5">
            <div ref={content} key={screen}>
              <div className="mb-4">
                <h3 className="text-strong text-xl font-bold">{TITLES[screen].title}</h3>
                <p className="text-muted-foreground mt-0.5 text-[13px]">{TITLES[screen].text}</p>
              </div>
              {screen === "room" && <RoomScreen sync={sync} />}
              {screen === "queue" && <QueueScreen sync={sync} />}
              {screen === "people" && <PeopleScreen sync={sync} />}
              {screen === "appearance" && <AppearanceScreen />}
              {screen === "features" && <FeaturesScreen />}
              {screen === "system" && <SystemScreen devtools={devtools} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
