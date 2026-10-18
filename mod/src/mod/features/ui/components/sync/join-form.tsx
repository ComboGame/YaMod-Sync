import { useEffect, useId, useRef, useState } from "react";
import { Eye, EyeOff, Plus, RefreshCw, Users, Waves } from "lucide-react";

import { Button } from "@ui/components/ui/button";
import { Input } from "@ui/components/ui/input";
import { Switch } from "@ui/components/ui/switch";
import { SettingRow } from "@ui/components/ui/setting-row";
import { useSync } from "@ui/hooks/use-sync";
import { cn } from "@ui/lib/utils";
import {
  connect,
  disconnect,
  getAutoConnect,
  hasYandexToken,
  listRooms,
  loadSyncConfig,
  saveSyncConfig,
  setAutoConnect,
  SYNC_DEFAULTS,
  type RoomListing,
  type SyncConfig,
} from "~/mod/features/yandex-sync";

function Field(props: { label: string; hint?: string; children: React.ReactNode; htmlFor: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={props.htmlFor} className="text-strong text-[13px] font-semibold">
        {props.label}
      </label>
      {props.children}
      {props.hint && <span className="text-muted-foreground text-xs leading-snug">{props.hint}</span>}
    </div>
  );
}

type Rooms = { state: "idle" } | { state: "loading" } | { state: "ok"; rooms: RoomListing[] } | { state: "error"; error: string };

/** Через сколько после ввода адреса и пароля спросить сервер о комнатах. */
const LOOKUP_DELAY_MS = 600;

function listeners(count: number) {
  const tail = count % 10 === 1 && count % 100 !== 11 ? "слушатель" : [2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100) ? "слушателя" : "слушателей";
  return `${count} ${tail}`;
}

/** Одна комната сервера: кто в ней и что играет. Клик — войти. */
function RoomRow({ room, current, disabled, onJoin }: { room: RoomListing; current: boolean; disabled: boolean; onJoin: () => void }) {
  const empty = room.listeners.length === 0;
  return (
    <li>
      <button
        type="button"
        disabled={disabled}
        onClick={onJoin}
        className={cn(
          "flex w-full cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 text-left transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-brand-soft disabled:cursor-default disabled:opacity-60",
          current ? "border-brand/50 bg-brand-soft/40" : "border-surface-4 bg-surface-2 hover:border-surface-5 hover:bg-surface-4",
        )}
      >
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-md",
            empty ? "bg-surface-4 text-muted-foreground" : "bg-brand-soft text-brand",
          )}
        >
          {room.wave ? <Waves className="size-4" /> : <Users className="size-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="text-strong block truncate text-sm font-semibold">{room.name}</span>
          <span className="text-muted-foreground block truncate text-xs">
            {empty ? "Сейчас никого" : `${listeners(room.listeners.length)}: ${room.listeners.map((n) => n || "без имени").join(", ")}`}
          </span>
          {room.track && (
            <span className="text-foreground block truncate text-xs">
              {room.playing ? "Играет" : "На паузе"}: {room.track}
            </span>
          )}
        </span>
        <span className="text-brand shrink-0 text-[13px] font-semibold">Войти</span>
      </button>
    </li>
  );
}

export function JoinForm() {
  const sync = useSync();
  const ids = {
    relay: useId(),
    room: useId(),
    password: useId(),
    name: useId(),
    host: useId(),
    auto: useId(),
    port: useId(),
    fresh: useId(),
  };
  const [config, setConfig] = useState<SyncConfig>(SYNC_DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const [autoConnect, setAuto] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rooms, setRooms] = useState<Rooms>({ state: "idle" });
  const [fresh, setFresh] = useState("");
  const lookup = useRef(0);

  useEffect(() => {
    void loadSyncConfig().then((saved) => {
      setConfig(saved);
      setLoaded(true);
    });
    void getAutoConnect().then(setAuto);
  }, []);

  const update = (patch: Partial<SyncConfig>) => setConfig((current) => ({ ...current, ...patch }));
  const busy = sync.session === "connecting" || sync.session === "reconnecting";
  const relay = config.relay.trim();
  const password = config.password.trim();
  const ready = !!password && (config.host || !!relay);

  const findRooms = async () => {
    const seq = ++lookup.current;
    setRooms({ state: "loading" });
    const result = await listRooms(relay, password);
    if (seq !== lookup.current) return;
    setRooms(result.ok ? { state: "ok", rooms: result.rooms } : { state: "error", error: result.error });
  };

  // Адрес и пароль введены — сервер сам показывает, какие на нём комнаты.
  useEffect(() => {
    if (!loaded || config.host || !relay || !password) {
      lookup.current++;
      setRooms({ state: "idle" });
      return;
    }
    const timer = window.setTimeout(() => void findRooms(), LOOKUP_DELAY_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, relay, password, config.host]);

  const join = (room: string) => {
    const name = room.trim();
    if (!ready || !name || busy) return;
    const cleaned = { ...config, relay, room: name, name: config.name.trim() };
    setConfig(cleaned);
    saveSyncConfig(cleaned);
    void connect(cleaned);
  };

  const listed = rooms.state === "ok" ? rooms.rooms : [];
  const freshName = fresh.trim();
  const exists = listed.some((room) => room.name === freshName);

  return (
    <div className="mx-auto flex w-full max-w-[460px] flex-col gap-4 rounded-lg border border-surface-4 bg-surface-3 p-5 shadow-[var(--ms-shadow-card)]">
      <div>
        <h2 className="text-strong text-xl font-bold">Слушать вместе</h2>
        <p className="text-muted-foreground mt-1 text-[13px] leading-snug">
          У всех в комнате играет одно и то же с одной позиции. Пауза, перемотка и очередь — общие. Волну включает участник
          с Плюсом, а слушать её может каждый.
        </p>
      </div>

      {!hasYandexToken() && (
        <p className="rounded-md border border-[#e08325]/40 bg-[#e08325]/10 px-3.5 py-2.5 text-[13px] leading-snug text-strong">
          Войдите в аккаунт Яндекса: треки комнаты играют с вашего аккаунта.
        </p>
      )}

      {!config.host && (
        <Field label="Адрес сервера" hint="Тот, что дал владелец сервера: ws://IP:8787 или wss://домен" htmlFor={ids.relay}>
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
            className="text-muted-foreground hover:text-strong absolute inset-y-0 right-0 flex w-9 cursor-pointer items-center justify-center"
          >
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </Field>

      <Field label="Как вас видят остальные" hint="Пусто — имя компьютера" htmlFor={ids.name}>
        <Input id={ids.name} value={config.name} maxLength={32} onChange={(e) => update({ name: e.target.value })} />
      </Field>

      {config.host ? (
        <Field label="Комната" htmlFor={ids.room}>
          <Input id={ids.room} value={config.room} onChange={(e) => update({ room: e.target.value })} spellCheck={false} />
        </Field>
      ) : (
        <section aria-label="Комнаты на сервере" className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-strong text-[13px] font-semibold">Комнаты на сервере</h3>
            {rooms.state !== "idle" && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Обновить список комнат"
                disabled={rooms.state === "loading"}
                onClick={() => void findRooms()}
              >
                <RefreshCw className={cn("size-4", rooms.state === "loading" && "animate-spin motion-reduce:animate-none")} />
              </Button>
            )}
          </div>
          {rooms.state === "idle" && (
            <p className="text-muted-foreground text-[13px] leading-snug">Введите адрес сервера и пароль — здесь появятся его комнаты.</p>
          )}
          {rooms.state === "loading" && <p className="text-muted-foreground text-[13px]">Спрашиваю сервер…</p>}
          {rooms.state === "error" && (
            <p role="alert" className="text-destructive text-[13px] leading-snug">
              {rooms.error}
            </p>
          )}
          {rooms.state === "ok" && listed.length === 0 && (
            <p className="text-muted-foreground text-[13px] leading-snug">На сервере пока нет комнат — создайте первую.</p>
          )}
          {listed.length > 0 && (
            <ul className="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
              {listed.map((room) => (
                <RoomRow
                  key={room.name}
                  room={room}
                  current={room.name === config.room}
                  disabled={busy || !hasYandexToken()}
                  onJoin={() => join(room.name)}
                />
              ))}
            </ul>
          )}
          {/* Своя комната — и для старого сервера, который списка не даёт. */}
          <form
            className="mt-1 flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              join(freshName);
            }}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <label htmlFor={ids.fresh} className="text-muted-foreground text-xs">
                {rooms.state === "error" ? "Название комнаты" : "Или новая комната"}
              </label>
              <Input
                id={ids.fresh}
                value={fresh}
                maxLength={64}
                placeholder={rooms.state === "error" ? config.room : "например, дом"}
                onChange={(e) => setFresh(e.target.value)}
                spellCheck={false}
              />
            </div>
            <Button type="submit" variant="secondary" disabled={!ready || !freshName || busy}>
              <Plus /> {exists ? "Войти" : "Создать"}
            </Button>
          </form>
        </section>
      )}

      <div className="flex flex-col rounded-md bg-surface-2 px-3.5 py-3">
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
        <SettingRow title="Входить в последнюю комнату при запуске" htmlFor={ids.auto}>
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
          {sync.session === "connecting" ? "Подключаюсь… Отменить" : "Переподключаюсь… Отменить"}
        </Button>
      )}
      {config.host && !busy && (
        <Button size="lg" disabled={!ready || !config.room.trim()} onClick={() => join(config.room)}>
          Открыть комнату
        </Button>
      )}
      {!ready && !busy && (
        <p className="text-muted-foreground -mt-2 text-center text-[13px]">
          {!password ? "Введите пароль сервера" : "Введите адрес сервера"}
        </p>
      )}
    </div>
  );
}
