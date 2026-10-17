import { useEffect, useRef, useState } from "react";

import { Toaster } from "@ui/components/ui/sonner";
import { SyncDot, syncState } from "@ui/components/sync/now-playing";
import { useSync } from "@ui/hooks/use-sync";
import { ShadowPortal } from "@ui/lib/shadow";
import { dockIn } from "@ui/lib/motion";
import { cn } from "@ui/lib/utils";
import { applyTheme, DOCK_WIDTH, reserveDock } from "@ui/theme";
import { FixedHost } from "@ui/shell/fixed-host";
import { RailButtons } from "@ui/shell/rail";
import { RoomDock } from "@ui/shell/room-dock";
import { SettingsModal } from "@ui/shell/settings";
import { dockOpen, loadShell, openSettings, setShell, useShell, wideWindow } from "@ui/shell/shell-state";
import { TopBar } from "@ui/shell/top-bar";

import logo from "@ui/assets/logo.png?inline";

/** Кнопка Sync в навигации клиента — для оформления «как в Яндекс Музыке». */
function Trigger({ collapsed }: { collapsed: boolean }) {
  const sync = useSync();
  const live = !!sync.room && (sync.session === "connected" || sync.session === "reconnecting");
  const tone = live && sync.room ? syncState(sync.room).tone : "idle";
  return (
    <button
      onClick={() => openSettings("room")}
      aria-label={live ? `Комната, слушают: ${sync.room!.listeners.length}` : "Яндекс Музыка Sync"}
      className={cn(
        "flex h-10 cursor-pointer items-center gap-2 rounded-md border px-3 text-[13px] font-semibold transition-[filter,background-color] outline-none focus-visible:ring-[3px] focus-visible:ring-brand-soft",
        live ? "border-brand/40 bg-surface-3 text-strong hover:brightness-125" : "border-surface-4 bg-surface-3 text-foreground hover:brightness-125",
      )}
    >
      <span className="size-5 bg-contain bg-center bg-no-repeat" style={{ backgroundImage: `url(${logo})` }} aria-hidden />
      {!collapsed && <span>{live ? `${sync.room!.listeners.length} в комнате` : "Sync"}</span>}
      {live && <SyncDot tone={sync.session === "reconnecting" ? "catching" : tone} />}
    </button>
  );
}

const TARGET_SELECTOR = 'div[class*="NavbarDesktopUserWidget_userProfileContainer"]';
const CONTAINER_ID = "mod-sheet-container";

/**
 * Место мода в сайдбаре клиента — над профилем. Сайдбар клиент перерисовывает
 * при навигации, поэтому место поддерживается наблюдателем (не чаще раза за кадр).
 */
function useNavbarSlot() {
  const [slot, setSlot] = useState<{ host: HTMLElement | null; collapsed: boolean }>({ host: null, collapsed: false });
  useEffect(() => {
    let scheduled = false;
    const place = () => {
      scheduled = false;
      const target = document.querySelector(TARGET_SELECTOR);
      let container = document.getElementById(CONTAINER_ID);
      if (target) {
        if (!container) {
          container = document.createElement("div");
          container.id = CONTAINER_ID;
          container.style.display = "flex";
          container.style.justifyContent = "center";
          target.parentNode?.insertBefore(container, target);
        }
        const collapsed = !!target.closest('aside[class*="Navbar_root_collapsed"]');
        setSlot((current) => (current.host === container && current.collapsed === collapsed ? current : { host: container, collapsed }));
      } else {
        container?.remove();
        setSlot((current) => (current.host === null ? current : { host: null, collapsed: false }));
      }
    };
    place();
    const observer = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(place);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      document.getElementById(CONTAINER_ID)?.remove();
    };
  }, []);
  return slot;
}

function useWideWindow() {
  const [wide, setWide] = useState(wideWindow);
  useEffect(() => {
    const onResize = () => setWide(wideWindow());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return wide;
}

/** Колонка комнаты: в широком окне — своё место справа, в узком — поверх страницы. */
function Dock({ overlay }: { overlay: boolean }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => dockIn(panel.current), []);
  // Поверх страницы колонка закрывается кликом мимо неё — как всплывающая панель.
  useEffect(() => {
    if (!overlay) return;
    const onDown = (event: PointerEvent) => {
      const inside = event.composedPath().some(
        (node) => node instanceof HTMLElement && (node.id === "ymsync-dock" || node.id === "ymsync-topbar" || node.id === "mod-sheet-container"),
      );
      if (!inside) setShell({ peek: false });
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [overlay]);
  return (
    <div
      ref={panel}
      className={cn("h-full border-l border-surface-4 bg-surface-1", overlay && "shadow-[var(--ms-shadow-floating)]")}
    >
      <RoomDock />
    </div>
  );
}

export default function App() {
  const shell = useShell();
  const slot = useNavbarSlot();
  const wide = useWideWindow();
  const [devtools, setDevtools] = useState(false);
  const modrinth = shell.theme === "modrinth";
  const docked = modrinth && shell.dock && wide;
  const showDock = modrinth && dockOpen(shell, wide);

  useEffect(() => {
    void loadShell();
    void window.yandexMusicMod.getStorageValue("devtools/enabled").then((on) => setDevtools(on === true));
    return window.yandexMusicMod.onStorageChanged((key, value) => {
      if (key === "devtools/enabled") setDevtools(value === true);
    });
  }, []);

  useEffect(() => applyTheme(modrinth), [modrinth]);
  useEffect(() => reserveDock(docked ? DOCK_WIDTH : 0), [docked]);

  return (
    <>
      {slot.host && (
        <ShadowPortal host={slot.host}>{modrinth ? <RailButtons /> : <Trigger collapsed={slot.collapsed} />}</ShadowPortal>
      )}
      {modrinth && (
        // Справа остаются кнопки окна клиента: три по 2.75rem.
        <FixedHost id="ymsync-topbar" style={{ top: "0", left: "0", right: "8.25rem", height: "3rem", zIndex: "703" }}>
          <TopBar />
        </FixedHost>
      )}
      {showDock && (
        <FixedHost
          id="ymsync-dock"
          style={{ top: "3rem", right: "0", bottom: "0", width: `${DOCK_WIDTH}px`, zIndex: "250" }}
        >
          <Dock overlay={!wide} />
        </FixedHost>
      )}
      {shell.settings && <SettingsModal screen={shell.settings} devtools={devtools} />}
      <Toaster position="bottom-right" />
    </>
  );
}
