import { useLayoutEffect, useRef, useState } from "react";
import { Crown, Waves } from "lucide-react";

import { Button } from "@ui/components/ui/button";
import { cn } from "@ui/lib/utils";
import { itemIn, itemOut } from "@ui/lib/motion";
import { command, type Listener, type RoomSnapshot } from "~/mod/features/yandex-sync";

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

function Badge({ children, tone = "plain" }: { children: string; tone?: "plain" | "brand" | "muted" }) {
  return (
    <span
      className={cn(
        "rounded-sm px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap",
        tone === "brand" ? "bg-brand-soft text-brand" : tone === "muted" ? "text-muted-foreground border border-surface-5" : "bg-surface-5 text-foreground",
      )}
    >
      {children}
    </span>
  );
}

/** Что админ может сделать с участником: передать ему волну или свои права. */
function AdminActions({ room, row }: { room: RoomSnapshot; row: Listener }) {
  if (!room.admin || row.you) return null;
  const canHand = !!room.station && !row.feeds && row.plus !== false;
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      {canHand && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Передать волну: ${row.name}`}
          title={`Передать волну: дальше она будет подбираться для ${row.name}`}
          onClick={() => command({ c: "hand_wave", to: row.peer })}
        >
          <Waves className="size-4" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Сделать админом: ${row.name}`}
        title={`Сделать ${row.name} админом комнаты вместо вас`}
        onClick={() => command({ c: "set_admin", peer: row.peer })}
      >
        <Crown className="size-4" />
      </Button>
    </span>
  );
}

type Row = Listener & { key: string; leaving?: boolean };

/**
 * Список участников. Новые строки появляются, ушедшие гаснут — чтобы было
 * видно, кто только что вошёл или вышел, а не просто сменился список.
 */
export function ListenerList({ room, compact = false }: { room: RoomSnapshot; compact?: boolean }) {
  const keyed = room.listeners.map((l, i) => ({ ...l, key: `${l.name}#${room.listeners.slice(0, i).filter((o) => o.name === l.name).length}` }));
  const [rows, setRows] = useState<Row[]>(keyed);
  const refs = useRef(new Map<string, HTMLLIElement>());
  const known = useRef(new Set(keyed.map((r) => r.key)));

  // Значки и действия тоже меняются (волну передали, админа сменили) — строки
  // берутся из свежего списка, анимация — только на вход и выход.
  const fresh = new Map(keyed.map((r) => [r.key, r]));
  const signature = keyed.map((r) => `${r.key}:${r.you}:${r.admin}:${r.feeds}:${r.plus}:${r.peer}`).join("|");
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
      {rows.map((stale) => {
        const row = { ...stale, ...(fresh.get(stale.key) ?? {}) };
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
              {row.admin && <Badge>админ</Badge>}
              {row.feeds && !room.station_unfed && <Badge>волна</Badge>}
              {row.plus === false && <Badge tone="muted">без Плюса</Badge>}
              {row.you && room.hosting && <Badge>хост</Badge>}
            </span>
            {!row.leaving && <AdminActions room={room} row={row} />}
          </li>
        );
      })}
    </ul>
  );
}
