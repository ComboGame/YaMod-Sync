import { useLayoutEffect, useRef, useState } from "react";

import { cn } from "@ui/lib/utils";
import { itemIn, itemOut } from "@ui/lib/motion";
import { parseStation, type Listener, type RoomSnapshot } from "~/mod/features/yandex-sync";

/** Цвет кружка — от имени, чтобы у каждого был свой и не менялся. */
const AVATAR_COLORS = ["#1bd96a", "#4f9cff", "#e08325", "#c084fc", "#f67687", "#2dd4bf", "#facc15"];

/** FNV-1a: у похожих имён разные цвета, у одного имени — всегда один. */
function avatarColor(name: string) {
  let hash = 0x811c9dc5;
  for (const ch of name) hash = Math.imul(hash ^ ch.codePointAt(0)!, 0x01000193);
  return AVATAR_COLORS[(hash >>> 0) % AVATAR_COLORS.length]!;
}

export function Avatar({ name, size = 36, you }: { name: string; size?: number; you?: boolean }) {
  return (
    <span
      className={cn("flex shrink-0 items-center justify-center rounded-full font-bold text-black", you && "ring-2 ring-brand ring-offset-2 ring-offset-surface-3")}
      style={{ width: size, height: size, background: avatarColor(name), fontSize: size * 0.42 }}
      aria-hidden
    >
      {(name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}

function Badge({ children, tone = "plain" }: { children: string; tone?: "plain" | "brand" }) {
  return (
    <span
      className={cn(
        "rounded-sm px-1.5 py-0.5 text-[11px] font-semibold",
        tone === "brand" ? "bg-brand-soft text-brand" : "bg-surface-5 text-foreground",
      )}
    >
      {children}
    </span>
  );
}

type Row = Listener & { key: string; leaving?: boolean };

/**
 * Список участников. Новые строки появляются, ушедшие гаснут — чтобы было
 * видно, кто только что вошёл или вышел, а не просто сменился список.
 */
export function ListenerList({ room, compact = false }: { room: RoomSnapshot; compact?: boolean }) {
  const wave = parseStation(room.station);
  const keyed = room.listeners.map((l, i) => ({ ...l, key: `${l.name}#${room.listeners.slice(0, i).filter((o) => o.name === l.name).length}` }));
  const [rows, setRows] = useState<Row[]>(keyed);
  const refs = useRef(new Map<string, HTMLLIElement>());
  const known = useRef(new Set(keyed.map((r) => r.key)));

  const signature = keyed.map((r) => `${r.key}:${r.you}`).join("|");
  useLayoutEffect(() => {
    const next = new Set(keyed.map((r) => r.key));
    const added = keyed.filter((r) => !known.current.has(r.key)).map((r) => r.key);
    const gone = rows.filter((r) => !next.has(r.key) && !r.leaving);
    setRows([...keyed, ...gone.map((r) => ({ ...r, leaving: true }))]);
    known.current = next;
    requestAnimationFrame(() => itemIn(added.map((k) => refs.current.get(k)).filter((el): el is HTMLLIElement => !!el)));
    for (const row of gone) {
      itemOut(refs.current.get(row.key) ?? null, () => setRows((current) => current.filter((r) => r.key !== row.key)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return (
    <ul className={cn("flex flex-col", compact ? "gap-1.5" : "gap-1")}>
      {rows.map((row) => {
        const feeding = wave?.by !== undefined && wave.by === row.name && !room.station_unfed;
        return (
          <li
            key={row.key}
            ref={(el) => {
              if (el) refs.current.set(row.key, el);
              else refs.current.delete(row.key);
            }}
            className={cn("flex items-center gap-3 rounded-md", compact ? "" : "px-2 py-2 hover:bg-surface-4", row.leaving && "pointer-events-none")}
          >
            <Avatar name={row.name} you={row.you} size={compact ? 28 : 36} />
            <span className="text-strong min-w-0 flex-1 truncate text-sm">{row.name}</span>
            <span className="flex shrink-0 items-center gap-1">
              {row.you && <Badge tone="brand">вы</Badge>}
              {feeding && <Badge>волна</Badge>}
              {row.you && room.hosting && <Badge>хост</Badge>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
