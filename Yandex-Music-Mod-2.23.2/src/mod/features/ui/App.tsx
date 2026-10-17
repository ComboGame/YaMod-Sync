import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { FaGithub } from "react-icons/fa";

import { ThemeProvider } from "./contexts/ThemeContext";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger, SheetClose } from "@ui/components/ui/sheet";
import { ScrollArea } from "@ui/components/ui/scroll-area";
import { Toaster } from "@ui/components/ui/sonner";
import { Segmented } from "@ui/components/ui/setting-row";
import { Button } from "@ui/components/ui/button";

import { JoinForm } from "@ui/components/sync/join-form";
import { LiveRoom } from "@ui/components/sync/live-room";
import { Playground } from "@ui/components/playground";
import { IPChecker } from "@ui/components/ip-checker";
import { FontChanger } from "@ui/components/font-changer";
import { Devtools } from "@ui/components/devtools";
import { AutoBestQuality } from "@ui/components/auto-best-quality";
import { DiscordRPC } from "@ui/components/discord-rpc";
import { AutoLiker } from "@ui/components/auto-liker";
import { useSync } from "@ui/hooks/use-sync";
import { cn } from "@ui/lib/utils";

import logo from "@ui/assets/logo.png?inline";

const REPO_URL = "https://github.com/mshivarev/ym-sync";

type Tab = "room" | "features" | "system";

/** Кнопка рядом с профилем в шапке приложения: открывает панель и показывает, что вы в комнате. */
function Trigger() {
  const sync = useSync();
  const inRoom = sync.session === "connected" && sync.room;
  const listeners = sync.room?.listeners.length ?? 0;
  return (
    <SheetTrigger
      className={cn(
        "flex h-10 cursor-pointer items-center gap-2 rounded-full px-3.5 text-[13px] font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        inRoom ? "bg-primary text-primary-foreground" : "bg-card text-foreground hover:bg-accent/60",
      )}
      aria-label={inRoom ? `Комната: ${listeners} слушают` : "Яндекс Музыка Sync"}
    >
      <span className="size-5 bg-contain bg-center bg-no-repeat" style={{ backgroundImage: `url(${logo})` }} aria-hidden />
      <span className="trigger-text hidden lg:inline">{inRoom ? `${listeners} в комнате` : "Sync"}</span>
      {sync.session === "reconnecting" && <span className="size-2 rounded-full bg-destructive" aria-hidden />}
    </SheetTrigger>
  );
}

function RoomTab() {
  const sync = useSync();
  const live = sync.room && (sync.session === "connected" || sync.session === "reconnecting");
  return live ? <LiveRoom /> : <JoinForm />;
}

function FeaturesTab() {
  return (
    <div className="divide-y divide-border">
      <AutoBestQuality />
      <DiscordRPC />
      <FontChanger />
      <AutoLiker />
    </div>
  );
}

function SystemTab({ devtools }: { devtools: boolean }) {
  return (
    <div className="divide-y divide-border">
      <Devtools />
      {devtools && <IPChecker />}
      {devtools && <Playground />}
      <section className="px-5 py-4">
        <h3 className="text-foreground text-[15px] font-bold">О моде</h3>
        <p className="text-muted-foreground mt-1 text-[13px] leading-snug">
          Яндекс Музыка со встроенным YandexSync. Работает с вашей подпиской Плюс: мод не открывает платное и не
          скачивает треки. Синхрон — ядро ym-sync, интерфейс и патчер выросли из Yandex Music Mod.
        </p>
        <Button variant="secondary" size="sm" className="mt-3" onClick={() => window.open(REPO_URL, "_blank", "noreferrer")}>
          <FaGithub /> Исходный код ym-sync
        </Button>
      </section>
    </div>
  );
}

export default function App() {
  const [mountNode, setMountNode] = useState<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("room");
  const [devtools, setDevtools] = useState(false);

  useEffect(() => {
    void window.yandexMusicMod.getStorageValue("devtools/enabled").then((on) => setDevtools(on === true));
    return window.yandexMusicMod.onStorageChanged((key, value) => {
      if (key === "devtools/enabled") setDevtools(value === true);
    });
  }, []);

  // Кнопка живёт в шапке приложения, рядом с профилем; шапка перерисовывается
  // при навигации, поэтому место для кнопки поддерживается наблюдателем.
  useEffect(() => {
    const targetSelector = 'div[class*="NavbarDesktopUserWidget_userProfileContainer"]';
    const containerId = "mod-sheet-container";

    const place = () => {
      const target = document.querySelector(targetSelector);
      let container = document.getElementById(containerId) as HTMLDivElement | null;
      if (target) {
        if (!container) {
          container = document.createElement("div");
          container.id = containerId;
          container.style.display = "flex";
          container.style.justifyContent = "center";
          target.parentNode?.insertBefore(container, target);
        }
        setMountNode(container);
      } else {
        container?.remove();
        setMountNode(null);
      }
    };

    place();
    const observer = new MutationObserver(place);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      document.getElementById(containerId)?.remove();
    };
  }, []);

  return (
    <ThemeProvider>
      <Sheet open={open} onOpenChange={setOpen}>
        {mountNode && createPortal(<Trigger />, mountNode)}
        <SheetContent
          id="yandex-music-sync-panel"
          side="left"
          className="w-full gap-0 border-r border-border bg-panel p-0 text-foreground outline-none lg:max-w-[420px]"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <header className="flex items-center gap-3 px-5 pt-[calc(var(--ym-spacer-size-xxxl,2.5rem)+0.5rem)] pb-3">
            <span className="size-8 shrink-0 bg-contain bg-center bg-no-repeat" style={{ backgroundImage: `url(${logo})` }} aria-hidden />
            <div className="min-w-0 flex-1">
              <SheetTitle className="text-foreground text-base font-bold">Яндекс Музыка Sync</SheetTitle>
              <SheetDescription className="text-muted-foreground text-xs">
                Совместное прослушивание и настройки мода
              </SheetDescription>
            </div>
            <SheetClose asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Закрыть">
                <X className="size-4" />
              </Button>
            </SheetClose>
          </header>

          <div className="px-5 pb-1">
            <Segmented<Tab>
              value={tab}
              onChange={setTab}
              options={[
                { value: "room", label: "Комната" },
                { value: "features", label: "Возможности" },
                { value: "system", label: "Система" },
              ]}
            />
          </div>

          <ScrollArea className="min-h-0 flex-1">
            {tab === "room" && <RoomTab />}
            {tab === "features" && <FeaturesTab />}
            {tab === "system" && <SystemTab devtools={devtools} />}
          </ScrollArea>

          <Toaster position="bottom-right" />
        </SheetContent>
      </Sheet>
    </ThemeProvider>
  );
}
