import { useEffect, useRef } from "react";
import { Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward } from "lucide-react";

import { Button } from "@ui/components/ui/button";
import { cn } from "@ui/lib/utils";
import { contentIn, pulse } from "@ui/lib/motion";
import { command, type RoomSnapshot } from "~/mod/features/yandex-sync";

export function formatTime(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function coverUrl(uri: string | undefined, size: number) {
  return uri ? `https://${uri.replace("%%", `${size}x${size}`)}` : undefined;
}

/**
 * Насколько вы совпадаете с комнатой — ради этого комната и существует.
 *
 * Состояние комнаты и вашего плеера — разные вещи, и неизвестное не выдаётся за
 * паузу: «пауза у всех» — только когда комната действительно стоит.
 */
export function syncState(room: RoomSnapshot): { tone: "together" | "catching" | "idle"; text: string } {
  const drift = room.drift_ms;
  if (!room.track) return { tone: "idle", text: "В комнате тихо" };
  if (room.waiting) return { tone: "idle", text: "Ждём, пока трек загрузится у всех" };
  if (room.room_playing === null) return { tone: "catching", text: "Узнаю, что играет в комнате" };
  if (!room.room_playing) return { tone: "idle", text: "Пауза у всех" };
  if (room.loading) return { tone: "catching", text: "Загружаю трек" };
  if (!room.local_live) return { tone: "catching", text: "Плеер не отвечает" };
  if (room.local_track && room.local_track !== room.track.track_id) {
    return { tone: "catching", text: "Плеер на другом треке — возвращаю" };
  }
  if (drift === null) return { tone: "catching", text: "Выравниваю позицию" };
  if (Math.abs(drift) <= 120) return { tone: "together", text: `В синхроне, ${Math.abs(drift)} мс` };
  return { tone: "catching", text: `Догоняю комнату, ${Math.abs(drift)} мс` };
}

/** Точка синхрона: зелёная с расходящимся кольцом, пока вы вместе. */
export function SyncDot({ tone }: { tone: "together" | "catching" | "idle" }) {
  const ring = useRef<HTMLSpanElement>(null);
  useEffect(() => (tone === "together" ? pulse(ring.current) : undefined), [tone]);
  return (
    <span className="relative inline-flex size-2.5 shrink-0" aria-hidden>
      {tone === "together" && <span ref={ring} className="absolute inset-0 rounded-full bg-brand" />}
      <span
        className={cn(
          "relative inline-flex size-2.5 rounded-full",
          tone === "together" ? "bg-brand" : tone === "catching" ? "bg-[#e08325]" : "bg-surface-5",
        )}
      />
    </span>
  );
}

export function NowPlaying({ room }: { room: RoomSnapshot }) {
  const track = room.track;
  const duration = room.duration_ms || track?.duration_ms || 0;
  const progress = duration ? Math.min(1, room.position_ms / duration) : 0;
  const sync = syncState(room);
  const art = useRef<HTMLDivElement>(null);
  const titles = useRef<HTMLDivElement>(null);

  // Смена трека — единственный момент, когда карточка двигается сама.
  useEffect(() => {
    contentIn([art.current, titles.current].filter((el): el is HTMLDivElement => !!el), { x: 10 });
  }, [track?.track_id]);

  return (
    <section className="rounded-lg border border-surface-4 bg-surface-3 p-4 shadow-[var(--ms-shadow-card)]">
      <div className="flex items-center gap-4">
        <div
          ref={art}
          className="size-24 shrink-0 rounded-lg bg-surface-4 bg-cover bg-center shadow-[0_6px_20px_rgba(0,0,0,0.5)]"
          style={{ backgroundImage: track?.cover_uri ? `url(${coverUrl(track.cover_uri, 200)})` : undefined }}
          aria-hidden
        />
        <div ref={titles} className="min-w-0 flex-1">
          <div className="text-strong truncate text-lg font-bold leading-tight">{track?.title ?? "Ничего не играет"}</div>
          <div className="text-muted-foreground mt-0.5 truncate text-sm">
            {track?.artist ?? "Включите трек в приложении или волну ниже — он заиграет у всех"}
          </div>
          <div className="mt-2.5 flex items-center gap-2 text-[13px]">
            <SyncDot tone={sync.tone} />
            <span className={cn(sync.tone === "together" ? "text-brand" : "text-muted-foreground")}>{sync.text}</span>
          </div>
        </div>
      </div>

      {track && (
        <div className="mt-4 flex items-center gap-3">
          <span className="text-muted-foreground w-10 text-right text-xs tabular-nums">{formatTime(room.position_ms)}</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-5">
            <div className="h-full rounded-full bg-brand transition-[width] duration-300 ease-linear" style={{ width: `${progress * 100}%` }} />
          </div>
          <span className="text-muted-foreground w-10 text-xs tabular-nums">{formatTime(duration)}</span>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Перемешать"
            aria-pressed={room.shuffle}
            className={cn(room.shuffle && "text-brand")}
            onClick={() => command({ c: "shuffle", on: !room.shuffle })}
          >
            <Shuffle />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={room.repeat === "one" ? "Повтор трека" : room.repeat === "all" ? "Повтор очереди" : "Без повтора"}
            aria-pressed={room.repeat !== "off"}
            className={cn(room.repeat !== "off" && "text-brand")}
            onClick={() => command({ c: "repeat", mode: room.repeat === "off" ? "all" : room.repeat === "all" ? "one" : "off" })}
          >
            {room.repeat === "one" ? <Repeat1 /> : <Repeat />}
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="icon" aria-label="Предыдущий трек" onClick={() => command({ c: "prev" })}>
            <SkipBack className="size-[18px]" fill="currentColor" />
          </Button>
          <Button
            size="icon-lg"
            aria-label={room.room_playing || room.waiting ? "Пауза для всех" : "Играть для всех"}
            onClick={() => command({ c: "toggle" })}
            disabled={!track}
          >
            {room.room_playing || room.waiting ? <Pause className="size-5" fill="currentColor" /> : <Play className="size-5 translate-x-px" fill="currentColor" />}
          </Button>
          <Button variant="secondary" size="icon" aria-label="Следующий трек" onClick={() => command({ c: "next" })}>
            <SkipForward className="size-[18px]" fill="currentColor" />
          </Button>
        </div>
        <span className="w-[4.5rem]" aria-hidden />
      </div>
    </section>
  );
}
