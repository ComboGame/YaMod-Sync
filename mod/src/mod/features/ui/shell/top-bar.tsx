import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  AudioWaveform,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Disc3,
  Heart,
  History,
  ListMusic,
  Mic2,
  Music2,
  PanelRight,
  Search,
  Settings,
  Smile,
  Ticket,
  TrendingUp,
  User,
} from "lucide-react";

import { useSync } from "@ui/hooks/use-sync";
import { SyncDot, syncState } from "@ui/components/sync/now-playing";
import { cn } from "@ui/lib/utils";
import { BrandMark } from "./brand";
import { navigate, useRoute, type Section } from "./route";
import { dockOpen, toggleDock, useShell, wideWindow } from "./shell-state";

const ICONS: Record<Section, typeof Search> = {
  wave: AudioWaveform,
  search: Search,
  trends: TrendingUp,
  concerts: Ticket,
  books: BookOpen,
  kids: Smile,
  collection: Heart,
  album: Disc3,
  artist: Mic2,
  playlist: ListMusic,
  chart: TrendingUp,
  genre: Music2,
  history: History,
  settings: Settings,
  profile: User,
  other: Music2,
};

const DRAG = { WebkitAppRegion: "drag" } as CSSProperties;
const NO_DRAG = { WebkitAppRegion: "no-drag" } as CSSProperties;

/** Можно ли сейчас назад/вперёд — по Navigation API Chromium, где он есть. */
function useHistoryState() {
  const nav = (window as any).navigation;
  const read = () => ({ back: nav?.canGoBack ?? true, forward: nav?.canGoForward ?? true });
  const [state, setState] = useState(read);
  useEffect(() => {
    if (!nav?.addEventListener) return;
    const update = () => setState(read());
    nav.addEventListener("currententrychange", update);
    return () => nav.removeEventListener("currententrychange", update);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return state;
}

function RoundButton(props: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      onClick={props.onClick}
      disabled={props.disabled}
      style={NO_DRAG}
      className="flex size-7 cursor-pointer items-center justify-center rounded-full border border-surface-4 bg-surface-2 text-foreground transition-colors outline-none hover:bg-surface-4 hover:text-strong focus-visible:ring-[3px] focus-visible:ring-brand-soft disabled:cursor-default disabled:opacity-40 disabled:hover:bg-surface-2"
    >
      {props.children}
    </button>
  );
}

/** «1 слушает», «3 слушают». */
export function listening(count: number) {
  return `${count} ${count === 1 ? "слушает" : "слушают"}`;
}

/** Состояние комнаты справа в панели: как «Нет активных сборок» у Modrinth. Открывает колонку. */
function RoomPill() {
  const sync = useSync();
  const shell = useShell();
  const open = dockOpen(shell, wideWindow());
  const live = !!sync.room && (sync.session === "connected" || sync.session === "reconnecting");
  const tone = !live ? "idle" : sync.session === "reconnecting" ? "catching" : syncState(sync.room!).tone;
  const label =
    sync.session === "connecting"
      ? "Подключаюсь"
      : sync.session === "reconnecting"
        ? "Переподключаюсь"
        : live
          ? `${sync.roomName ?? "Комната"} · ${listening(sync.room!.listeners.length)}`
          : "Не в комнате";
  return (
    <button
      type="button"
      onClick={toggleDock}
      aria-pressed={open}
      aria-label={`${label}. ${open ? "Скрыть" : "Показать"} колонку комнаты`}
      style={NO_DRAG}
      className={cn(
        "flex h-8 cursor-pointer items-center gap-2 rounded-full border px-3 text-[13px] font-semibold transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-brand-soft",
        live ? "border-brand/35 text-strong hover:bg-surface-4" : "border-surface-4 text-foreground hover:bg-surface-4 hover:text-strong",
      )}
    >
      <SyncDot tone={tone} />
      <span className="max-w-[220px] truncate">{label}</span>
      <PanelRight className={cn("size-4", open ? "text-brand" : "text-muted-foreground")} aria-hidden />
    </button>
  );
}

/**
 * Верхняя панель окна, как у Modrinth App: знак слева над сайдбаром, «назад» и
 * «вперёд», где вы сейчас — и состояние комнаты справа. Вся панель — область
 * перетаскивания окна; кнопки окна остаются клиентскими, справа от неё.
 */
export function TopBar() {
  const route = useRoute();
  const history = useHistoryState();
  const Icon = ICONS[route.section];
  return (
    <header style={DRAG} className="flex h-12 items-center gap-2 pr-2 select-none">
      <button
        type="button"
        onClick={() => navigate("/")}
        aria-label="Яндекс Музыка: на главную"
        title="На главную"
        style={NO_DRAG}
        className="flex h-12 w-16 shrink-0 cursor-pointer items-center justify-center outline-none focus-visible:ring-[3px] focus-visible:ring-brand-soft"
      >
        <BrandMark className="size-7" />
      </button>
      <div className="flex items-center gap-1.5">
        <RoundButton label="Назад" onClick={() => history.back && window.history.back()} disabled={!history.back}>
          <ChevronLeft className="size-4" />
        </RoundButton>
        <RoundButton label="Вперёд" onClick={() => history.forward && window.history.forward()} disabled={!history.forward}>
          <ChevronRight className="size-4" />
        </RoundButton>
      </div>
      <nav aria-label="Где вы" className="ml-2 flex min-w-0 items-center gap-2 text-[15px] font-semibold">
        <Icon className="text-foreground size-[18px] shrink-0" aria-hidden />
        <span className="text-strong shrink-0">{route.title}</span>
        {route.detail && (
          <>
            <ChevronRight className="text-muted-foreground size-4 shrink-0" aria-hidden />
            <span className="text-foreground truncate">{route.detail}</span>
          </>
        )}
      </nav>
      <div className="min-w-4 flex-1" />
      <button
        type="button"
        onClick={() => navigate("/search")}
        style={NO_DRAG}
        aria-label="Поиск"
        className="hidden h-8 w-52 shrink-0 cursor-pointer items-center gap-2 rounded-full border border-surface-4 bg-surface-2 px-3 text-[13px] text-muted-foreground transition-colors outline-none hover:border-surface-5 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-brand-soft min-[900px]:flex"
      >
        <Search className="size-4" aria-hidden />
        <span className="truncate whitespace-nowrap">Поиск музыки</span>
      </button>
      <RoomPill />
    </header>
  );
}
