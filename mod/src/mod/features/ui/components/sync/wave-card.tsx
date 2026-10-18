import { useState } from "react";
import { Undo2, Waves } from "lucide-react";

import { Button } from "@ui/components/ui/button";
import { Card } from "@ui/components/ui/setting-row";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ui/components/ui/select";
import { canStartWave, command, isPlainWave, parseStation, type RoomSnapshot } from "~/mod/features/yandex-sync";

/** Кому можно передать волну: всем в комнате, кроме того, кто её уже ведёт, и тех, у кого нет Плюса. */
function HandOver({ room }: { room: RoomSnapshot }) {
  const [key, setKey] = useState(0);
  const candidates = room.listeners.filter((l) => !l.feeds && l.plus !== false && (room.admin || !l.you));
  if (!candidates.length) return null;
  return (
    <Select
      key={key}
      onValueChange={(peer) => {
        command({ c: "hand_wave", to: Number(peer) });
        // Выбор — действие, а не значение: поле снова пустое.
        setKey((k) => k + 1);
      }}
    >
      <SelectTrigger className="mt-2 w-full" aria-label="Передать волну участнику">
        <SelectValue placeholder="Передать волну…" />
      </SelectTrigger>
      <SelectContent>
        {candidates.map((l) => (
          <SelectItem key={l.peer} value={String(l.peer)}>
            {l.you ? `${l.name} (вы)` : l.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Какая волна у комнаты, чья она, и что с ней можно сделать отсюда. */
export function WaveCard({ room }: { room: RoomSnapshot }) {
  const wave = parseStation(room.station);
  const canStart = canStartWave(room);

  if (!wave) {
    return (
      <Card>
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-surface-4 text-muted-foreground">
            <Waves className="size-5" />
          </span>
          <div className="min-w-0">
            <h3 className="text-strong text-[15px] font-bold">Волна для всех</h3>
            <p className="text-muted-foreground mt-0.5 text-[13px] leading-snug">
              {canStart
                ? "Треки подбираются для вашего аккаунта и играют у всех. Пресеты волны в приложении тоже работают."
                : "Волну включает участник с Плюсом: треки подбираются для его аккаунта, а вы слушаете вместе со всеми."}
            </p>
          </div>
        </div>
        {canStart && (
          <Button variant="secondary" className="mt-3 w-full" onClick={() => command({ c: "wave" })}>
            <Waves /> Включить «Мою волну»
          </Button>
        )}
      </Card>
    );
  }

  const title = wave.name ?? "Моя волна";
  const whose = room.feeding ? "Подбирается для вас" : wave.by ? `Подбирается для ${wave.by}` : "Подбирается для участника";
  // Пресет («R'n'B», «Асия»): тот, кто ведёт волну, может вернуться к обычной.
  const preset = !isPlainWave(wave);

  return (
    <Card tone="brand">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand">
          <Waves className="size-5" />
        </span>
        <div className="min-w-0">
          <div className="text-strong truncate text-[15px] font-bold">{title}</div>
          <div className="text-muted-foreground truncate text-[13px]">{wave.description ?? "Моя волна"}</div>
          <div className="text-brand mt-1 text-xs font-medium">{whose}</div>
        </div>
      </div>

      {room.station_unfed ? (
        <>
          <p className="text-foreground mt-3 text-[13px] leading-snug">
            Включивший волну вышел. Очередь доиграет, новых треков не будет.
          </p>
          {canStart ? (
            <Button className="mt-2 w-full" onClick={() => command({ c: "wave", seeds: wave.seeds })}>
              Продолжить со своего аккаунта
            </Button>
          ) : (
            <p className="text-muted-foreground mt-2 text-[13px] leading-snug">Продолжить её может участник с Плюсом.</p>
          )}
        </>
      ) : room.feeding ? (
        <>
          {preset && (
            <Button className="mt-3 w-full" onClick={() => command({ c: "wave" })}>
              <Undo2 /> Вернуться к «Моей волне»
            </Button>
          )}
          <Button variant="secondary" className={preset ? "mt-2 w-full" : "mt-3 w-full"} onClick={() => command({ c: "stop_wave" })}>
            Выключить волну
          </Button>
          <HandOver room={room} />
        </>
      ) : room.admin ? (
        <>
          <p className="text-muted-foreground mt-3 text-[13px] leading-snug">
            Волну ведёт {wave.by ?? "участник"}. Вы админ комнаты: можете выключить её или передать другому.
          </p>
          <Button variant="secondary" className="mt-2 w-full" onClick={() => command({ c: "stop_wave" })}>
            Выключить волну у {wave.by ?? "участника"}
          </Button>
          <HandOver room={room} />
        </>
      ) : (
        <p className="text-muted-foreground mt-3 text-[13px] leading-snug">
          Режим и очередь волны меняет {wave.by ?? "тот, кто её включил"}. Пауза, перемотка и пропуск — общие.
        </p>
      )}
    </Card>
  );
}
