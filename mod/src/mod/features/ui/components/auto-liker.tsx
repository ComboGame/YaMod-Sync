import { useMemo, useState, useEffect, useRef } from "react";

import {
  getPlaylistTracks,
  getTracksInfo,
  likeTrack,
  getAccountInfo,
  getLikesAndHistory,
  updateAccountSettings,
} from "~/mod/features/utils/yandex-api";

import { PanelSection } from "@ui/components/ui/setting-row";
import { Button } from "@ui/components/ui/button";
import { If } from "@ui/components/ui/if";
import { Progress } from "@ui/components/ui/progress";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@ui/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ui/components/ui/select";
import { Input } from "@ui/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ui/components/ui/tooltip";

import { Info } from "lucide-react";

export function AutoLiker() {
  const [isInProgress, setIsInProgress] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressStatusText, setProgressStatusText] = useState("");
  const [playlistUrl, setPlaylistUrl] = useState("");
  const stopSignal = useRef(false);

  const handleButtonClick = async () => {
    if (isInProgress) {
      stopSignal.current = true;
      return;
    }

    stopSignal.current = false;

    setIsInProgress(true);
    setProgress(0);
    setProgressStatusText("Получение информации о плейлисте");

    const playlistId = playlistUrl.match(/playlists\/([a-z0-9-\.]+)/)?.[1] || "";

    if (!playlistId) {
      toast.error("Произошла ошибка", {
        description: "Не удалось получить информацию о плейлисте",
      });
      setIsInProgress(false);
      return;
    }

    const trackIds = await getPlaylistTracks(playlistId);

    if (trackIds.isErr()) {
      toast.error("Произошла ошибка", {
        description: trackIds.error,
      });
      setIsInProgress(false);
      return;
    }

    const accountInfo = await getAccountInfo();

    if (accountInfo.isErr()) {
      toast.error("Произошла ошибка", {
        description: accountInfo.error,
      });
      setIsInProgress(false);
      return;
    }

    const userId = accountInfo.value.uid;

    console.log("[AutoLiker] userId", userId);

    for (var i = 0; i < trackIds.value.length; i++) {
      if (stopSignal.current) {
        setIsInProgress(false);
        return;
      }

      setProgressStatusText(`Добавление треков ${i + 1} / ${trackIds.value.length}`);
      setProgress((i / trackIds.value.length) * 100);

      const result = await likeTrack(userId, trackIds.value[i]!);

      if (result.isErr()) {
        toast.error("Произошла ошибка", {
          description: result.error,
        });
        continue;
      }

      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    setIsInProgress(false);
  };

  const handleCopyPlaylistLink = async () => {
    const likesAndHistory = await getLikesAndHistory();

    if (likesAndHistory.isErr()) {
      return toast.error("Произошла ошибка", {
        description: likesAndHistory.error,
      });
    }

    if (!likesAndHistory.value.favorites?.playlistUuid) {
      return toast.error("Произошла ошибка", {
        description: "Не удалось получить информацию о плейлисте",
      });
    }

    const updateVisabilityResult = await updateAccountSettings("userMusicVisibility", "PUBLIC");

    if (updateVisabilityResult.isErr()) {
      return toast.error("Произошла ошибка", {
        description: updateVisabilityResult.error,
      });
    }

    await navigator.clipboard.writeText(
      `https://music.yandex.ru/playlists/${likesAndHistory.value.favorites.playlistUuid}`,
    );

    toast.success("Ссылка скопирована", {
      description: "Ссылка на плейлист скопирована в буфер обмена",
    });
  };

  return (
    <PanelSection
      title="Перенос из плейлиста"
      description="Мод поставит лайк каждому треку плейлиста — так переносят музыку с другого аккаунта."
    >
      <div className="flex flex-col gap-3 pt-2">
        <If condition={isInProgress}>
          <div className="flex flex-col gap-3">
            <span className="text-sm text-foreground text-center">{progressStatusText}</span>
            <Progress value={progress} />
          </div>
        </If>

        <div className="flex gap-4 items-center justify-center">
          <Input
            type="text"
            defaultValue={playlistUrl}
            onChange={(e) => setPlaylistUrl(e.target.value)}
            disabled={isInProgress}
            className="flex-1 text-sm cursor-default w-full"
            placeholder="Ссылка на плейлист"
          />
        </div>

        <Button variant="default" className="w-full" onClick={handleButtonClick} disabled={playlistUrl.length === 0}>
          {isInProgress ? "Стоп" : "Перенести треки"}
        </Button>

        <Button variant="secondary" className="w-full" onClick={handleCopyPlaylistLink}>
          Ссылка на Мою коллекцию
        </Button>
      </div>
    </PanelSection>
  );
}
