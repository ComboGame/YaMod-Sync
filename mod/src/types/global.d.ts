declare global {
  interface Window {
    yandexMusicMod: {
      getStorageValue: (key: string) => Promise<any>;
      setStorageValue: (key: string, value: any) => void;
      onStorageChanged: (cb: (key: string, value: any) => void) => () => void;
      sync: {
        start: (config: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
        stop: () => Promise<{ ok: boolean }>;
        command: (command: unknown) => void;
        reportPlayer: (state: unknown) => void;
        reportLoaded: (result: unknown) => void;
        onEvent: (cb: (message: unknown) => void) => () => void;
      };
    };
    VERSION: string;
    __getPlayerState: () => any;
  }
}

export {};
