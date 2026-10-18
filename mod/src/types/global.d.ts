declare global {
  /** Что известно об обновлении мода (см. main/updater.ts). */
  type ModUpdateState = {
    status: "idle" | "checking" | "latest" | "available" | "downloading" | "ready" | "failed";
    current: string;
    version?: string;
    notes?: string;
    url?: string;
    size?: number;
    progress?: number;
    error?: string;
    checkedAt?: number;
  };

  interface Window {
    yandexMusicMod: {
      getStorageValue: (key: string) => Promise<any>;
      setStorageValue: (key: string, value: any) => void;
      onStorageChanged: (cb: (key: string, value: any) => void) => () => void;
      sync: {
        start: (config: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
        stop: () => Promise<{ ok: boolean }>;
        state: () => Promise<{
          status: { state: string; error?: string };
          room: { room: string; relay: string; host: boolean } | null;
        }>;
        resume: () => Promise<{ ok: boolean }>;
        rooms: (
          relay: string,
          password: string,
        ) => Promise<
          | { ok: true; rooms: { name: string; listeners: string[]; track?: string; playing: boolean; wave?: boolean }[] }
          | { ok: false; error: string }
        >;
        command: (command: unknown) => void;
        reportPlayer: (state: unknown) => void;
        reportLoaded: (result: unknown) => void;
        onEvent: (cb: (message: unknown) => void) => () => void;
      };
      update?: {
        state: () => Promise<ModUpdateState>;
        check: () => Promise<ModUpdateState>;
        install: () => Promise<ModUpdateState>;
        onEvent: (cb: (state: ModUpdateState) => void) => () => void;
      };
    };
    VERSION: string;
    __getPlayerState: () => any;
  }
}

export {};
