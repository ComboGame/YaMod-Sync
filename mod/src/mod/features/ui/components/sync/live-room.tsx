import { Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Waves } from "lucide-react";

import { Button } from "@ui/components/ui/button";
import { useSync } from "@ui/hooks/use-sync";
import { cn } from "@ui/lib/utils";
import { command, disconnect, parseStation, type RoomSnapshot } from "~/mod/features/yandex-sync";


function formatTime(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function cover(uri: string | undefined, size: number) {
  return uri ? `https://${uri.replace("%%", `${size}x${size}`)}` : undefined;
}

/** «Вместе ±N мс»: то, ради чего комната существует, — насколько вы совпадаете с остальными. */
function TogetherBadge({ room }: { room: RoomSnapshot }) {
  const drift = room.drift_ms;
  const aligned = drift !== null && Math.abs(drift) <= 120;
  const text = room.waiting
    ? "ждём, пока трек загрузится у всех"
    : !room.playing
      ? "на паузе у всех"
      : drift === null
        ? "выравниваю позицию…"
        : aligned
          ? `вместе, расхождение ${Math.abs(drift)} мс`
          : `догоняю комнату, ${Math.abs(drift)} мс`;
  return (
    <div className="flex items-center gap-2 text-[13px]">
      <span
        className={cn(
          "size-2 rounded-full",
          aligned && room.playing ? "bg-primary animate-pulse" : "bg-muted-foreground",
        )}
        aria-hidden
      />
      <span className="text-muted-foreground">{text}</span>
    </div>
  );
}

function Listeners({ room }: { room: RoomSnapshot }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex -space-x-2">
        {room.listeners.slice(0, 5).map((listener, i) => (
          <span
            key={`${listener.name}-${i}`}
            title={listener.you ? `${listener.name} (вы)` : listener.name}
            className={cn(
              "flex size-8 items-center justify-center rounded-full border-2 border-[var(--panel)] text-[13px] font-bold",
              listener.you ? "bg-primary text-primary-foreground" : "bg-accent text-foreground",
            )}
          >
            {(listener.name.trim()[0] ?? "?").toUpperCase()}
          </span>
        ))}
      </div>
      <span className="text-foreground min-w-0 truncate text-[13px]">
        {room.listeners.map((l) => (l.you ? `${l.name} (вы)` : l.name)).join(", ")}
      </span>
    </div>
  );
}

function NowPlaying({ room }: { room: RoomSnapshot }) {
  const track = room.track;
  const duration = room.duration_ms || track?.duration_ms || 0;
  const progress = duration ? Math.min(1, room.position_ms / duration) : 0;
  const wave = parseStation(room.station);

  return (
    <div className="flex flex-col gap-4 rounded-[var(--ym-radius-size-xxl,1.5rem)] bg-card p-4">
      <div className="flex items-center gap-3.5">
        <div
          className="size-16 shrink-0 rounded-xl bg-accent bg-cover bg-center"
          style={{ backgroundImage: track?.cover_uri ? `url(${cover(track.cover_uri, 200)})` : undefined }}
          aria-hidden
        />
        <div className="min-w-0">
          <div className="text-foreground truncate text-base font-bold">{track?.title ?? "Тишина"}</div>
          <div className="text-muted-foreground truncate text-[13px]">
            {track?.artist ?? "Включите что-нибудь в приложении или «Мою волну» ниже"}
          </div>
        </div>
      </div>

      {track && (
        <div className="flex flex-col gap-1.5">
          <div className="h-1 overflow-hidden rounded-full bg-accent">
            <div className="h-full rounded-full bg-foreground" style={{ width: `${progress * 100}%` }} />
          </div>
          <div className="text-muted-foreground flex justify-between text-xs tabular-nums">
            <span>{formatTime(room.position_ms)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" aria-label="Предыдущий трек" onClick={() => command({ c: "prev" })}>
            <SkipBack className="size-5" fill="currentColor" />
          </Button>
          <Button
            size="icon-lg"
            aria-label={room.playing ? "Пауза для всех" : "Играть для всех"}
            onClick={() => command({ c: "toggle" })}
            disabled={!track}
          >
            {room.playing ? <Pause className="size-6" fill="currentColor" /> : <Play className="size-6" fill="currentColor" />}
          </Button>
          <Button variant="ghost" size="icon" aria-label="Следующий трек" onClick={() => command({ c: "next" })}>
            <SkipForward className="size-5" fill="currentColor" />
          </Button>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Перемешать"
            aria-pressed={room.shuffle}
            className={cn(room.shuffle && "text-primary")}
            onClick={() => command({ c: "shuffle", on: !room.shuffle })}
          >
            <Shuffle className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={room.repeat === "one" ? "Повтор трека" : room.repeat === "all" ? "Повтор очереди" : "Без повтора"}
            aria-pressed={room.repeat !== "off"}
            className={cn(room.repeat !== "off" && "text-primary")}
            onClick={() =>
              command({ c: "repeat", mode: room.repeat === "off" ? "all" : room.repeat === "all" ? "one" : "off" })
            }
          >
            {room.repeat === "one" ? <Repeat1 className="size-4" /> : <Repeat className="size-4" />}
          </Button>
        </div>
      </div>

      <WaveControl room={room} wave={wave} />
    </div>
  );
}

/** Какая волна играет у комнаты, чья она, и что с ней можно сделать отсюда. */
function WaveControl({ room, wave }: { room: RoomSnapshot; wave: ReturnType<typeof parseStation> }) {
  if (!wave) {
    return (
      <Button variant="secondary" className="w-full" onClick={() => command({ c: "wave" })}>
        <Waves className="size-4" />
        Включить «Мою волну» для всех
      </Button>
    );
  }
  const title = wave.name ?? "Моя волна";
  const whose = room.feeding ? "для вашего аккаунта" : wave.by ? `для аккаунта ${wave.by}` : "для участника, который её включил";
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2.5">
        <Waves className="text-primary size-5 shrink-0" />
        <div className="min-w-0">
          <div className="text-foreground truncate text-sm font-medium">{title}</div>
          <div className="text-muted-foreground truncate text-xs">
            {wave.description && wave.description !== title ? `${wave.description}, ` : ""}
            {whose}
          </div>
        </div>
      </div>
      {room.station_unfed ? (
        <>
          <p className="text-muted-foreground text-xs leading-snug">
            Включивший волну вышел: она доиграет очередь и остановится.
          </p>
          <Button variant="secondary" className="w-full" onClick={() => command({ c: "wave", seeds: wave.seeds })}>
            Продолжить эту волну со своего аккаунта
          </Button>
        </>
      ) : room.feeding ? (
        <Button variant="secondary" className="w-full" onClick={() => command({ c: "stop_wave" })}>
          Выключить волну
        </Button>
      ) : (
        <p className="text-muted-foreground text-xs leading-snug">
          Выключить её может тот, кто включил. Свою волну или пресет можно включить в приложении — она заменит эту.
        </p>
      )}
    </div>
  );
}

function Queue({ room }: { room: RoomSnapshot }) {
  const upcoming = room.queue.map((track, index) => ({ track, index })).slice(Math.max(0, room.index - 1), room.index + 30);
  if (room.queue.length === 0) return null;
  return (
    <section className="flex flex-col">
      <h3 className="text-foreground px-1 pb-2 text-[15px] font-bold">
        Очередь комнаты <span className="text-muted-foreground font-normal">{room.queue.length}</span>
      </h3>
      <ol className="flex flex-col">
        {upcoming.map(({ track, index }) => (
          <li key={`${track.track_id}-${index}`}>
            <button
              onClick={() => command({ c: "index", index })}
              aria-current={index === room.index}
              className={cn(
                "flex w-full cursor-pointer items-center gap-3 rounded-xl px-2 py-1.5 text-left hover:bg-card focus-visible:bg-card outline-none",
                index === room.index && "bg-card",
              )}
            >
              <span
                className="size-9 shrink-0 rounded-lg bg-accent bg-cover bg-center"
                style={{ backgroundImage: track.cover_uri ? `url(${cover(track.cover_uri, 100)})` : undefined }}
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className={cn("block truncate text-sm", index === room.index ? "text-primary font-medium" : "text-foreground")}>
                  {track.title}
                </span>
                <span className="text-muted-foreground block truncate text-xs">{track.artist}</span>
              </span>
              <span className="text-muted-foreground text-xs tabular-nums">{formatTime(track.duration_ms)}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function LiveRoom() {
  const sync = useSync();
  const room = sync.room;
  if (!room) return null;
  const message = sync.activity ?? room.notice;

  return (
    <div className="flex flex-col gap-5 px-5 pt-5 pb-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-foreground text-xl font-bold">
            {room.hosting ? "Комната на этом компьютере" : "Вы в комнате"}
          </h2>
          <div className="mt-1">
            <TogetherBadge room={room} />
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void disconnect()}>
          Выйти
        </Button>
      </div>

      {sync.session === "reconnecting" && (
        <p role="status" className="rounded-xl bg-card px-3.5 py-2.5 text-[13px] leading-snug text-foreground">
          Связь с комнатой потеряна, переподключаюсь.{sync.error ? ` ${sync.error}` : ""}
        </p>
      )}

      <NowPlaying room={room} />
      <Listeners room={room} />
      {room.hosting && (
        <p className="text-muted-foreground -mt-2 text-[13px] leading-snug">
          Дайте друзьям адрес <span className="text-foreground select-all">{room.hosting}</span> и пароль комнаты.
        </p>
      )}
      {message && <p className="text-muted-foreground -mt-2 text-[13px] leading-snug">{message}</p>}
      <Queue room={room} />
    </div>
  );
}
