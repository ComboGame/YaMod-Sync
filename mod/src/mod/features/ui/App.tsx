import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ListMusic, LogOut, Radio, Settings2, Sparkles, Users, X } from "lucide-react";
import { FaGithub } from "react-icons/fa";

import { Button } from "@ui/components/ui/button";
import { Card, CardTitle } from "@ui/components/ui/setting-row";
import { Toaster } from "@ui/components/ui/sonner";
import { JoinForm } from "@ui/components/sync/join-form";
import { NowPlaying, SyncDot, syncState } from "@ui/components/sync/now-playing";
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
import { ShadowPortal } from "@ui/lib/shadow";
import { contentIn, panelIn, panelOut } from "@ui/lib/motion";
import { cn } from "@ui/lib/utils";
import { disconnect, type SyncState } from "~/mod/features/yandex-sync";

import logo from "@ui/assets/logo.png?inline";

const REPO_URL = "https://github.com/mshivarev/ym-sync";

type Screen = "room" | "queue" | "people" | "features" | "system";

const SCREENS: { id: Screen; label: string; icon: typeof Radio }[] = [
  { id: "room", label: "Комната", icon: Radio },
  { id: "queue", label: "Очередь", icon: ListMusic },
  { id: "people", label: "Участники", icon: Users },
  { id: "features", label: "Возможности", icon: Sparkles },
  { id: "system", label: "Система", icon: Settings2 },
];

function inRoom(sync: SyncState) {
  return !!sync.room && (sync.session === "connected" || sync.session === "reconnecting");
}

/** Кнопка в шапке клиента, рядом с профилем. Живёт в своём shadow-корне. */
function Trigger({ onOpen, collapsed }: { onOpen: () => void; collapsed: boolean }) {
  const sync = useSync();
  const live = inRoom(sync);
  const tone = live && sync.room ? syncState(sync.room).tone : "idle";
  return (
    <button
      onClick={onOpen}
      aria-label={live ? `Комната, слушают: ${sync.room!.listeners.length}` : "Яндекс Музыка Sync"}
      className={cn(
        "ymsync-trigger flex h-10 cursor-pointer items-center gap-2 rounded-md border px-3 text-[13px] font-semibold transition-[filter,background-color] outline-none focus-visible:ring-[3px] focus-visible:ring-brand-soft",
        live ? "border-brand/40 bg-surface-3 text-strong hover:brightness-125" : "border-surface-4 bg-surface-3 text-foreground hover:brightness-125",
      )}
    >
      <span className="size-5 bg-contain bg-center bg-no-repeat" style={{ backgroundImage: `url(${logo})` }} aria-hidden />
      {!collapsed && <span>{live ? `${sync.room!.listeners.length} в комнате` : "Sync"}</span>}
      {live && <SyncDot tone={sync.session === "reconnecting" ? "catching" : tone} />}
    </button>
  );
}

function Rail({ screen, onSelect, sync }: { screen: Screen; onSelect: (s: Screen) => void; sync: SyncState }) {
  const live = inRoom(sync);
  const status =
    sync.session === "connected" ? "В комнате" : sync.session === "reconnecting" ? "Переподключение" : sync.session === "connecting" ? "Подключение" : "Не в комнате";
  return (
    <nav aria-label="Разделы" className="flex w-16 shrink-0 flex-col items-center gap-1.5 border-r border-surface-4 bg-surface-1 py-3">
      <span className="mb-2 size-9 bg-contain bg-center bg-no-repeat" style={{ backgroundImage: `url(${logo})` }} aria-hidden />
      {SCREENS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          onClick={() => onSelect(id)}
          aria-label={label}
          aria-current={screen === id ? "page" : undefined}
          title={label}
          className={cn(
            "flex size-11 cursor-pointer items-center justify-center rounded-md transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-brand-soft",
            screen === id ? "bg-brand-soft text-brand" : "text-muted-foreground hover:bg-surface-4 hover:text-strong",
          )}
        >
          <Icon className="size-5" />
        </button>
      ))}
      <div className="mt-auto flex flex-col items-center gap-2" title={status}>
        <SyncDot tone={!live ? "idle" : sync.session === "reconnecting" ? "catching" : syncState(sync.room!).tone} />
      </div>
    </nav>
  );
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

function RoomScreen({ sync, go }: { sync: SyncState; go: (s: Screen) => void }) {
  if (!inRoom(sync)) return <JoinForm />;
  const room = sync.room!;
  const raw = sync.activity ?? room.notice;
  // Уведомления ядра пишутся со строчной буквы; на экране — как предложение.
  const message = raw ? raw[0]!.toUpperCase() + raw.slice(1) : null;
  return (
    <div className="flex flex-col gap-3">
      {sync.session === "reconnecting" && (
        <p role="status" className="rounded-md border border-[#e08325]/40 bg-[#e08325]/10 px-3.5 py-2.5 text-[13px] text-strong">
          Связь с комнатой потеряна, переподключаюсь.{sync.error ? ` ${sync.error}` : ""}
        </p>
      )}
      <NowPlaying room={room} />
      {message && <p className="text-muted-foreground px-1 text-[13px] leading-snug">{message}</p>}
      <div className="grid items-start gap-3 md:grid-cols-2">
        <WaveCard room={room} />
        <Card>
          <CardTitle
            title={`Участники: ${room.listeners.length}`}
            aside={
              <Button variant="ghost" size="sm" onClick={() => go("people")}>
                Все
              </Button>
            }
          />
          <ListenerList room={room} compact />
          {room.hosting && (
            <p className="text-muted-foreground mt-3 text-[13px] leading-snug">
              Комната на этом компьютере. Дайте друзьям адрес <span className="text-strong select-all">{room.hosting}</span>.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}

function QueueScreen({ sync, go }: { sync: SyncState; go: (s: Screen) => void }) {
  if (!inRoom(sync) || !sync.room!.queue.length) {
    return (
      <EmptyState
        title="Очередь пуста"
        text={inRoom(sync) ? "Включите трек, альбом или волну в приложении — они станут очередью комнаты." : "Очередь появится, когда вы войдёте в комнату."}
        action={!inRoom(sync) && <Button onClick={() => go("room")}>Войти в комнату</Button>}
      />
    );
  }
  return (
    <Card className="p-2">
      <QueueList room={sync.room!} />
    </Card>
  );
}

function PeopleScreen({ sync, go }: { sync: SyncState; go: (s: Screen) => void }) {
  if (!inRoom(sync)) {
    return (
      <EmptyState
        title="Вы не в комнате"
        text="Здесь будут все, кто слушает вместе с вами."
        action={<Button onClick={() => go("room")}>Войти в комнату</Button>}
      />
    );
  }
  return (
    <Card className="p-2">
      <ListenerList room={sync.room!} />
    </Card>
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

const TITLES: Record<Screen, string> = {
  room: "Комната",
  queue: "Очередь комнаты",
  people: "Участники",
  features: "Возможности",
  system: "Система",
};

/** Окно мода над клиентом: сайдбар с разделами слева, экран справа. */
function Panel({ onClose, devtools }: { onClose: () => void; devtools: boolean }) {
  const sync = useSync();
  const [screen, setScreen] = useState<Screen>("room");
  const panel = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const closing = useRef(false);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    panelOut(panel.current, backdrop.current, onClose);
  }, [onClose]);

  useLayoutEffect(() => {
    panelIn(panel.current, backdrop.current);
    panel.current?.focus();
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

  const subtitle = inRoom(sync)
    ? sync.room!.hosting
      ? "Комната на этом компьютере"
      : `${sync.room!.listeners.length} в комнате`
    : sync.session === "connecting"
      ? "Подключаюсь"
      : "Не в комнате";

  return (
    <div className="fixed inset-0 z-[2147483000]">
      <div ref={backdrop} className="absolute inset-0 bg-black/60" onClick={close} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Яндекс Музыка Sync"
        tabIndex={-1}
        className="absolute top-3 bottom-3 left-3 flex w-[min(780px,calc(100vw-24px))] overflow-hidden rounded-xl bg-surface-2 shadow-[var(--ms-shadow-floating)] outline-none"
      >
        <Rail screen={screen} onSelect={setScreen} sync={sync} />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center gap-3 border-b border-surface-4 px-5 py-3.5">
            <div className="min-w-0 flex-1">
              <h2 className="text-strong truncate text-lg font-bold">{TITLES[screen]}</h2>
              <p className="text-muted-foreground truncate text-xs">{subtitle}</p>
            </div>
            {inRoom(sync) && (
              <Button variant="destructive" size="sm" onClick={() => void disconnect()}>
                <LogOut /> Выйти
              </Button>
            )}
            <Button variant="ghost" size="icon-sm" aria-label="Закрыть" onClick={close}>
              <X />
            </Button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <div ref={content} key={screen}>
              {screen === "room" && <RoomScreen sync={sync} go={setScreen} />}
              {screen === "queue" && <QueueScreen sync={sync} go={setScreen} />}
              {screen === "people" && <PeopleScreen sync={sync} go={setScreen} />}
              {screen === "features" && <FeaturesScreen />}
              {screen === "system" && <SystemScreen devtools={devtools} />}
            </div>
          </div>
        </div>
        <Toaster position="bottom-right" />
      </div>
    </div>
  );
}

const TARGET_SELECTOR = 'div[class*="NavbarDesktopUserWidget_userProfileContainer"]';
const CONTAINER_ID = "mod-sheet-container";

export default function App() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [open, setOpen] = useState(false);
  const [devtools, setDevtools] = useState(false);

  useEffect(() => {
    void window.yandexMusicMod.getStorageValue("devtools/enabled").then((on) => setDevtools(on === true));
    return window.yandexMusicMod.onStorageChanged((key, value) => {
      if (key === "devtools/enabled") setDevtools(value === true);
    });
  }, []);

  // Кнопка живёт в шапке клиента, рядом с профилем. Шапка перерисовывается при
  // навигации, поэтому место для кнопки поддерживается наблюдателем.
  useEffect(() => {
    const place = () => {
      const target = document.querySelector(TARGET_SELECTOR);
      let container = document.getElementById(CONTAINER_ID);
      if (target) {
        if (!container) {
          container = document.createElement("div");
          container.id = CONTAINER_ID;
          container.style.display = "flex";
          container.style.justifyContent = "center";
          target.parentNode?.insertBefore(container, target);
        }
        setHost(container);
        setCollapsed(!!target.closest('aside[class*="Navbar_root_collapsed"]'));
      } else {
        container?.remove();
        setHost(null);
      }
    };
    place();
    const observer = new MutationObserver(place);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      document.getElementById(CONTAINER_ID)?.remove();
    };
  }, []);

  return (
    <>
      {host && (
        <ShadowPortal host={host}>
          <Trigger onOpen={() => setOpen(true)} collapsed={collapsed} />
        </ShadowPortal>
      )}
      {open && <Panel onClose={() => setOpen(false)} devtools={devtools} />}
    </>
  );
}
