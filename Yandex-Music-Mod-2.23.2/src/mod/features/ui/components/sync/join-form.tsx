import { useEffect, useId, useState } from "react";
import { Eye, EyeOff } from "lucide-react";

import { Button } from "@ui/components/ui/button";
import { Input } from "@ui/components/ui/input";
import { Switch } from "@ui/components/ui/switch";
import { SettingRow } from "@ui/components/ui/setting-row";
import { useSync } from "@ui/hooks/use-sync";
import {
  connect,
  disconnect,
  getAutoConnect,
  hasYandexToken,
  loadSyncConfig,
  saveSyncConfig,
  setAutoConnect,
  SYNC_DEFAULTS,
  type SyncConfig,
} from "~/mod/features/yandex-sync";

function Field(props: { label: string; hint?: string; children: React.ReactNode; htmlFor: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={props.htmlFor} className="text-foreground text-[13px] font-medium">
        {props.label}
      </label>
      {props.children}
      {props.hint && <span className="text-muted-foreground text-xs leading-snug">{props.hint}</span>}
    </div>
  );
}

export function JoinForm() {
  const sync = useSync();
  const ids = { relay: useId(), room: useId(), password: useId(), name: useId(), host: useId(), auto: useId(), port: useId() };
  const [config, setConfig] = useState<SyncConfig>(SYNC_DEFAULTS);
  const [autoConnect, setAuto] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    void loadSyncConfig().then(setConfig);
    void getAutoConnect().then(setAuto);
  }, []);

  const update = (patch: Partial<SyncConfig>) => setConfig((current) => ({ ...current, ...patch }));
  const busy = sync.session === "connecting" || sync.session === "reconnecting";
  const missing = !config.password.trim()
    ? "Введите пароль комнаты"
    : !config.host && !config.relay.trim()
      ? "Введите адрес сервера"
      : !config.room.trim()
        ? "Введите название комнаты"
        : null;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (missing) return;
    const cleaned = { ...config, relay: config.relay.trim(), room: config.room.trim(), name: config.name.trim() };
    saveSyncConfig(cleaned);
    void connect(cleaned);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 px-5 pt-5 pb-4">
      <div>
        <h2 className="text-foreground text-xl font-bold">Слушать вместе</h2>
        <p className="text-muted-foreground mt-1 text-[13px] leading-snug">
          У всех в комнате играет одно и то же с одной позиции. Пауза, перемотка, очередь и «Моя волна» — общие, а
          управлять может любой.
        </p>
      </div>

      {!hasYandexToken() && (
        <p className="rounded-xl bg-card px-3.5 py-2.5 text-[13px] leading-snug text-foreground">
          Войдите в аккаунт Яндекса с Плюсом: треки комнаты играют с вашей подписки.
        </p>
      )}

      {!config.host && (
        <Field label="Адрес сервера" hint="Тот, что дал владелец комнаты: ws://IP:8787 или wss://домен" htmlFor={ids.relay}>
          <Input
            id={ids.relay}
            value={config.relay}
            onChange={(e) => update({ relay: e.target.value })}
            placeholder="ws://203.0.113.10:8787"
            spellCheck={false}
            autoComplete="off"
          />
        </Field>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Комната" htmlFor={ids.room}>
          <Input id={ids.room} value={config.room} onChange={(e) => update({ room: e.target.value })} spellCheck={false} />
        </Field>
        <Field label="Пароль" htmlFor={ids.password}>
          <div className="relative">
            <Input
              id={ids.password}
              type={showPassword ? "text" : "password"}
              value={config.password}
              onChange={(e) => update({ password: e.target.value })}
              className="pr-9"
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
              className="text-muted-foreground hover:text-foreground absolute inset-y-0 right-0 flex w-9 cursor-pointer items-center justify-center"
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </Field>
      </div>

      <Field label="Как вас видят остальные" hint="Пусто — имя компьютера" htmlFor={ids.name}>
        <Input id={ids.name} value={config.name} maxLength={32} onChange={(e) => update({ name: e.target.value })} />
      </Field>

      <div className="flex flex-col">
        <SettingRow
          title="Держать комнату на этом компьютере"
          hint="Без сервера: остальные подключаются к вам. Нужен открытый порт"
          htmlFor={ids.host}
        >
          <Switch id={ids.host} checked={config.host} onCheckedChange={(host) => update({ host })} />
        </SettingRow>
        {config.host && (
          <SettingRow title="Порт" htmlFor={ids.port}>
            <Input
              id={ids.port}
              className="w-24 text-right"
              inputMode="numeric"
              value={String(config.host_port)}
              onChange={(e) => update({ host_port: Number(e.target.value.replace(/\D/g, "")) || 8787 })}
            />
          </SettingRow>
        )}
        <SettingRow title="Входить в комнату при запуске" htmlFor={ids.auto}>
          <Switch
            id={ids.auto}
            checked={autoConnect}
            onCheckedChange={(on) => {
              setAuto(on);
              void setAutoConnect(on);
            }}
          />
        </SettingRow>
      </div>

      {sync.error && (
        <p role="alert" className="text-destructive text-[13px] leading-snug">
          {sync.error}
        </p>
      )}

      {busy && (
        <Button type="button" variant="secondary" onClick={() => void disconnect()}>
          Отменить
        </Button>
      )}
      <Button type="submit" size="lg" disabled={busy || missing !== null}>
        {sync.session === "connecting"
          ? "Подключаюсь…"
          : sync.session === "reconnecting"
            ? "Переподключаюсь…"
            : config.host
              ? "Открыть комнату"
              : "Войти в комнату"}
      </Button>
      {missing && !busy && <p className="text-muted-foreground -mt-2 text-center text-[13px]">{missing}</p>}
    </form>
  );
}
