import { Download, ExternalLink, RefreshCw } from "lucide-react";

import { Button } from "@ui/components/ui/button";
import { Card, CardTitle } from "@ui/components/ui/setting-row";
import { checkForUpdate, installUpdate, useUpdate } from "@ui/hooks/use-update";

function megabytes(bytes?: number) {
  return bytes ? `${Math.round(bytes / 1024 / 1024)} МБ` : "";
}

/**
 * Из заметок релиза — только раздел «Что нового» (release-notes/mod.md). В
 * релизах без него карточка ничего не перечисляет: весь «Что умеет» — не про
 * то, что изменилось, а подробности есть по кнопке «Что нового».
 */
function shortNotes(notes?: string) {
  if (!notes) return [];
  const lines = notes.split(/\r?\n/).map((line) => line.trim());
  const start = lines.findIndex((line) => /^##\s*Что нового/i.test(line));
  if (start < 0) return [];
  const end = lines.findIndex((line, i) => i > start && line.startsWith("## "));
  return lines
    .slice(start + 1, end < 0 ? undefined : end)
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).replace(/\*\*/g, "").replace(/`/g, ""))
    .slice(0, 6);
}

/** Обновления мода: что стоит, что вышло, и кнопка поставить новое. */
export function UpdateCard() {
  const state = useUpdate();
  if (!state) {
    return (
      <Card>
        <CardTitle title="Обновления" description="Проверка обновлений недоступна в этом окне." />
      </Card>
    );
  }

  const busy = state.status === "checking" || state.status === "downloading" || state.status === "ready";
  const fresh = state.status === "available" || state.status === "failed" || state.status === "downloading" || state.status === "ready";
  const description = fresh
    ? `Вышла версия ${state.version}. У вас ${state.current}.`
    : state.status === "latest"
      ? `У вас последняя версия, ${state.current}.`
      : state.status === "checking"
        ? "Проверяю…"
        : `Установлена версия ${state.current}.`;

  return (
    <Card tone={fresh ? "brand" : "plain"}>
      <CardTitle
        title="Обновления"
        description={description}
        aside={
          !fresh && (
            <Button variant="ghost" size="icon-sm" aria-label="Проверить обновления" disabled={busy} onClick={() => void checkForUpdate()}>
              <RefreshCw className={state.status === "checking" ? "size-4 animate-spin motion-reduce:animate-none" : "size-4"} />
            </Button>
          )
        }
      />
      {fresh && (
        <>
          {shortNotes(state.notes).length > 0 && (
            <ul className="text-foreground mb-3 flex list-disc flex-col gap-1 pl-5 text-[13px] leading-snug">
              {shortNotes(state.notes).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          {state.status === "downloading" && (
            <div className="mb-3" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((state.progress ?? 0) * 100)}>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-5">
                <div className="h-full rounded-full bg-brand transition-[width] duration-200" style={{ width: `${(state.progress ?? 0) * 100}%` }} />
              </div>
              <p className="text-muted-foreground mt-1.5 text-xs">Скачиваю установщик… {Math.round((state.progress ?? 0) * 100)}%</p>
            </div>
          )}
          {state.status === "ready" && <p className="text-foreground mb-3 text-[13px]">Запускаю установщик, приложение закроется.</p>}
          {state.status === "failed" && state.error && (
            <p role="alert" className="text-destructive mb-3 text-[13px] leading-snug">
              {state.error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => void installUpdate()}>
              <Download /> {state.status === "failed" ? "Повторить" : `Обновить до ${state.version}`} {megabytes(state.size) && `· ${megabytes(state.size)}`}
            </Button>
            {state.url && (
              <Button variant="secondary" onClick={() => window.open(state.url, "_blank", "noreferrer")}>
                <ExternalLink /> Что нового
              </Button>
            )}
          </div>
          <p className="text-muted-foreground mt-2.5 text-xs leading-snug">
            Установщик поставит новую версию поверх этой: вход в аккаунт, настройки и комната сохранятся. Комнату на время
            установки придётся покинуть.
          </p>
        </>
      )}
    </Card>
  );
}
