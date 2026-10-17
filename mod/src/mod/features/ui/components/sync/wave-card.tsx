import { Waves } from "lucide-react";

import { Button } from "@ui/components/ui/button";
import { Card } from "@ui/components/ui/setting-row";
import { command, parseStation, type RoomSnapshot } from "~/mod/features/yandex-sync";

/** Какая волна у комнаты, чья она, и что с ней можно сделать отсюда. */
export function WaveCard({ room }: { room: RoomSnapshot }) {
  const wave = parseStation(room.station);

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
              Треки подбираются для вашего аккаунта и играют у всех. Пресеты волны в приложении тоже работают.
            </p>
          </div>
        </div>
        <Button variant="secondary" className="mt-3 w-full" onClick={() => command({ c: "wave" })}>
          <Waves /> Включить «Мою волну»
        </Button>
      </Card>
    );
  }

  const title = wave.name ?? "Моя волна";
  const whose = room.feeding ? "Подбирается для вас" : wave.by ? `Подбирается для ${wave.by}` : "Подбирается для участника";

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
          <Button className="mt-2 w-full" onClick={() => command({ c: "wave", seeds: wave.seeds })}>
            Продолжить со своего аккаунта
          </Button>
        </>
      ) : room.feeding ? (
        <Button variant="secondary" className="mt-3 w-full" onClick={() => command({ c: "stop_wave" })}>
          Выключить волну
        </Button>
      ) : (
        <p className="text-muted-foreground mt-3 text-[13px] leading-snug">
          Выключить её может тот, кто включил. Ваша волна или пресет из приложения заменят эту.
        </p>
      )}
    </Card>
  );
}
