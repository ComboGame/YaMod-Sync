import { useEffect, useRef, type ReactNode } from "react";
import { ChevronRight, LogOut, Pause, Play, Settings2, SkipForward, TriangleAlert, Users } from "lucide-react";

import { Button } from "@ui/components/ui/button";
import { ListenerList } from "@ui/components/sync/listeners";
import { coverUrl, formatTime, SyncDot, syncState } from "@ui/components/sync/now-playing";
import { WaveCard } from "@ui/components/sync/wave-card";
import { useSync } from "@ui/hooks/use-sync";
import { contentIn } from "@ui/lib/motion";
import { cn } from "@ui/lib/utils";
import { command, crossfadeEnabled, disconnect, type RoomSnapshot, type SyncState } from "~/mod/features/yandex-sync";
import { openSettings } from "./shell-state";

/** Заголовок раздела колонки — как «Сейчас играет» и «Новости» у Modrinth. */
function Heading(props: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h2 className="text-foreground text-[15px] font-semibold">{props.children}</h2>
      {props.aside}
    </div>
  );
}

function Section(props: { children: ReactNode; className?: string }) {
  return <section className={cn("border-b border-surface-4 px-4 py-4 last:border-b-0", props.className)}>{props.children}</section>;
}

function inRoom(sync: SyncState) {
  return !!sync.room && (sync.session === "connected" || sync.session === "reconnecting");
}

/** Что играет у комнаты и насколько вы с ней вместе. */
function NowCard({ room }: { room: RoomSnapshot }) {
  const track = room.track;
  const sync = syncState(room);
  const duration = room.duration_ms || track?.duration_ms || 0;
  const progress = duration ? Math.min(1, room.position_ms / duration) : 0;
  const art = useRef<HTMLDivElement>(null);
  useEffect(() => contentIn(art.current ? [art.current] : null, { x: 8 }), [track?.track_id]);
  const playing = room.room_playing || room.waiting;
  return (
    <div className="rounded-lg border border-surface-4 bg-surface-2-5 p-3">
      <div ref={art} className="flex items-center gap-3">
        <div
          className="size-12 shrink-0 rounded-md bg-surface-4 bg-cover bg-center"
          style={{ backgroundImage: track?.cover_uri ? `url(${coverUrl(track.cover_uri, 100)})` : undefined }}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="text-strong truncate text-sm font-semibold">{track?.title ?? "Ничего не играет"}</div>
          <div className="text-muted-foreground truncate text-[13px]">{track?.artist ?? "Включите что-нибудь — заиграет у всех"}</div>
        </div>
        {track && (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              size="icon-sm"
              className="rounded-full"
              aria-label={playing ? "Пауза для всех" : "Играть для всех"}
              onClick={() => command({ c: "toggle" })}
            >
              {playing ? <Pause className="size-4" fill="currentColor" /> : <Play className="size-4 translate-x-px" fill="currentColor" />}
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Следующий трек для всех" onClick={() => command({ c: "next" })}>
              <SkipForward className="size-4" fill="currentColor" />
            </Button>
          </div>
        )}
      </div>
      {track && (
        <div className="mt-3 flex items-center gap-2">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-5">
            <div className="h-full rounded-full bg-brand transition-[width] duration-300 ease-linear" style={{ width: `${progress * 100}%` }} />
          </div>
          <span className="text-muted-foreground text-[11px] tabular-nums">
            {formatTime(room.position_ms)} / {formatTime(duration)}
          </span>
        </div>
      )}
      <div className="mt-2.5 flex items-center gap-2 text-[13px]" role="status">
        <SyncDot tone={sync.tone} />
        <span className={sync.tone === "together" ? "text-brand" : "text-muted-foreground"}>{sync.text}</span>
      </div>
    </div>
  );
}

/** Следующие треки комнаты; клик ставит трек всем. */
function UpNext({ room }: { room: RoomSnapshot }) {
  const next = room.queue.slice(room.index + 1, room.index + 4);
  if (!next.length) return null;
  return (
    <Section>
      <Heading
        aside={
          <button
            type="button"
            onClick={() => openSettings("queue")}
            className="text-muted-foreground hover:text-strong flex cursor-pointer items-center gap-0.5 text-[13px] font-medium outline-none focus-visible:text-strong"
          >
            Вся очередь <ChevronRight className="size-3.5" />
          </button>
        }
      >
        Дальше
      </Heading>
      <ol className="-mx-2 flex flex-col">
        {next.map((track, i) => (
          <li key={`${track.track_id}-${i}`}>
            <button
              type="button"
              onClick={() => command({ c: "index", index: room.index + 1 + i })}
              className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left outline-none hover:bg-surface-4 focus-visible:bg-surface-4"
            >
              <span
                className="size-8 shrink-0 rounded-sm bg-surface-4 bg-cover bg-center"
                style={{ backgroundImage: track.cover_uri ? `url(${coverUrl(track.cover_uri, 100)})` : undefined }}
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className="text-strong block truncate text-[13px]">{track.title}</span>
                <span className="text-muted-foreground block truncate text-xs">{track.artist}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </Section>
  );
}

/** Задержки, как их измерило ядро: только то, что есть, без догадок. */
function Latency({ room }: { room: RoomSnapshot }) {
  const l = room.latency;
  const parts = [
    l.rtt_ms !== null && `пинг ${l.rtt_ms} мс`,
    l.command_ms !== null && `ответ комнаты ${l.command_ms} мс`,
    l.load_ms !== null && `загрузка трека ${l.load_ms} мс`,
  ].filter(Boolean);
  if (!parts.length) return null;
  return <p className="text-muted-foreground text-xs leading-relaxed">{parts.join(" · ")}</p>;
}

function Outside({ sync }: { sync: SyncState }) {
  const busy = sync.session === "connecting" || sync.session === "reconnecting";
  return (
    <Section>
      <Heading>Совместное прослушивание</Heading>
      <p className="text-foreground text-[13px] leading-relaxed">
        <button
          type="button"
          onClick={() => openSettings("room")}
          className="text-brand cursor-pointer font-semibold outline-none hover:underline focus-visible:underline"
        >
          Войдите в комнату
        </button>
        , чтобы слушать вместе с друзьями: у всех одно и то же, с одной позиции, и управлять может любой.
      </p>
      {busy && <p className="text-muted-foreground mt-3 text-[13px]">{sync.session === "connecting" ? "Подключаюсь…" : "Переподключаюсь…"}</p>}
      {sync.error && !busy && <p className="text-destructive mt-3 text-[13px] leading-snug">{sync.error}</p>}
    </Section>
  );
}

/**
 * Колонка «Комната» справа — место Sync в окне, как у Modrinth App колонка
 * с тем, что сейчас играет, и друзьями. Её можно закрыть кнопкой в верхней панели.
 */
export function RoomDock() {
  const sync = useSync();
  if (!inRoom(sync)) {
    return (
      <aside aria-label="Комната" className="flex h-full flex-col overflow-y-auto">
        <Outside sync={sync} />
      </aside>
    );
  }
  const room = sync.room!;
  const raw = sync.activity ?? room.notice;
  const message = raw ? raw[0]!.toUpperCase() + raw.slice(1) : null;
  return (
    <aside aria-label="Комната" className="flex h-full flex-col overflow-y-auto">
      <Section>
        <Heading
          aside={
            <Button variant="ghost" size="icon-sm" aria-label="Настройки комнаты" onClick={() => openSettings("room")}>
              <Settings2 className="size-4" />
            </Button>
          }
        >
          Сейчас играет
        </Heading>
        {sync.session === "reconnecting" && (
          <p role="status" className="mb-3 rounded-md border border-[#e08325]/40 bg-[#e08325]/10 px-3 py-2 text-[13px] text-strong">
            Связь с комнатой потеряна, переподключаюсь.
          </p>
        )}
        <NowCard room={room} />
        {message && <p className="text-muted-foreground mt-2.5 text-[13px] leading-snug">{message}</p>}
        {crossfadeEnabled() && (
          <p className="mt-2.5 flex gap-2 text-[13px] leading-snug text-[#e08325]">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>Включены плавные переходы между треками: в комнате следующий трек будет начинаться раньше остальных. Их можно выключить в настройках приложения.</span>
          </p>
        )}
      </Section>
      <Section>
        <WaveCard room={room} />
      </Section>
      <Section>
        <Heading
          aside={
            <span className="text-muted-foreground flex items-center gap-1 text-[13px]">
              <Users className="size-3.5" /> {room.listeners.length}
            </span>
          }
        >
          Слушают
        </Heading>
        <ListenerList room={room} compact />
      </Section>
      <UpNext room={room} />
      <Section className="mt-auto">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-strong truncate text-sm font-semibold">{sync.roomName ?? "Комната"}</div>
            <div className="text-muted-foreground truncate text-xs">{room.hosting ? `Комната на этом компьютере: ${room.hosting}` : sync.server}</div>
          </div>
          <Button variant="destructive" size="sm" onClick={() => void disconnect()}>
            <LogOut /> Выйти
          </Button>
        </div>
        <Latency room={room} />
      </Section>
    </aside>
  );
}
