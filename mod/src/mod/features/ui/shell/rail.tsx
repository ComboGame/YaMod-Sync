import { Settings } from "lucide-react";

import { SyncDot, syncState } from "@ui/components/sync/now-playing";
import { useSync } from "@ui/hooks/use-sync";
import { cn } from "@ui/lib/utils";
import { BrandMark } from "./brand";
import { listening } from "./top-bar";
import { dockOpen, openSettings, toggleDock, useShell, wideWindow } from "./shell-state";

function RailButton(props: { label: string; active?: boolean; pressed?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={props.label}
      aria-label={props.label}
      aria-pressed={props.pressed}
      onClick={props.onClick}
      className={cn(
        "relative flex size-12 cursor-pointer items-center justify-center rounded-lg transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-brand-soft",
        props.active ? "bg-brand-soft text-brand" : "text-muted-foreground hover:bg-surface-4 hover:text-strong",
      )}
    >
      {props.children}
    </button>
  );
}

/**
 * Кнопки мода в сайдбаре, внизу над профилем — где у Modrinth шестерёнка
 * настроек: комната (открывает колонку справа) и настройки мода.
 */
export function RailButtons() {
  const sync = useSync();
  const shell = useShell();
  const live = !!sync.room && (sync.session === "connected" || sync.session === "reconnecting");
  const tone = !live ? "idle" : sync.session === "reconnecting" ? "catching" : syncState(sync.room!).tone;
  return (
    <div className="flex flex-col items-center gap-1.5 border-t border-surface-4 pt-2">
      <RailButton
        label={live ? `Комната: ${listening(sync.room!.listeners.length)}` : "Комната"}
        active={dockOpen(shell, wideWindow())}
        pressed={dockOpen(shell, wideWindow())}
        onClick={toggleDock}
      >
        <BrandMark className="size-6" />
        {live && (
          <span className="absolute right-2 bottom-2 flex rounded-full ring-2 ring-black">
            <SyncDot tone={tone} />
          </span>
        )}
      </RailButton>
      <RailButton label="Настройки мода" active={shell.settings !== null} onClick={() => openSettings("room")}>
        <Settings className="size-6" />
      </RailButton>
    </div>
  );
}
