import { useEffect, useRef } from "react";
import { AudioLines } from "lucide-react";

import { cn } from "@ui/lib/utils";
import { command, type RoomSnapshot } from "~/mod/features/yandex-sync";
import { coverUrl, formatTime } from "./now-playing";

/** Очередь комнаты: что играет, что дальше. Клик ставит трек всей комнате. */
export function QueueList({ room }: { room: RoomSnapshot }) {
  const current = useRef<HTMLLIElement>(null);

  // Играющий трек — в поле зрения, когда очередь открыли или она сдвинулась.
  useEffect(() => {
    current.current?.scrollIntoView({ block: "nearest" });
  }, [room.index, room.queue_revision]);

  return (
    <ol className="flex flex-col gap-0.5">
      {room.queue.map((track, index) => {
        const playing = index === room.index;
        const played = index < room.index;
        return (
          <li key={`${track.track_id}-${index}`} ref={playing ? current : undefined}>
            <button
              onClick={() => command({ c: "index", index })}
              aria-current={playing}
              className={cn(
                "group flex w-full cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-left outline-none transition-colors",
                "hover:bg-surface-4 focus-visible:bg-surface-4 focus-visible:ring-[3px] focus-visible:ring-brand-soft",
                playing && "bg-surface-4",
                played && "opacity-55",
              )}
            >
              <span className="text-muted-foreground w-6 text-right text-xs tabular-nums">
                {playing ? <AudioLines className="text-brand ml-auto size-4" /> : index + 1}
              </span>
              <span
                className="size-10 shrink-0 rounded-sm bg-surface-5 bg-cover bg-center"
                style={{ backgroundImage: track.cover_uri ? `url(${coverUrl(track.cover_uri, 100)})` : undefined }}
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className={cn("block truncate text-sm", playing ? "text-brand font-semibold" : "text-strong")}>{track.title}</span>
                <span className="text-muted-foreground block truncate text-xs">{track.artist}</span>
              </span>
              <span className="text-muted-foreground text-xs tabular-nums">{formatTime(track.duration_ms)}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
