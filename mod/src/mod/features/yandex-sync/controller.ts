// Связка плеера Яндекс Музыки с комнатой YandexSync.
//
// Ядро синхрона (ymsync-bridge, см. main/yandex-sync.ts) решает, что и с какой
// позиции должно играть, и присылает команды плееру: load / play / pause / seek.
// Здесь они выполняются плеером приложения, а обратно несколько раз в секунду
// уходит, что плеер делает на самом деле.
//
// Вторая половина — обратное направление. Пока вы в комнате, кнопки самого
// приложения тоже должны управлять комнатой: пауза, перемотка, следующий трек,
// включённый альбом или «Моя волна». Для этого перехватываются методы фасада
// плеера, которые вызывают кнопки, горячие клавиши и медиаклавиши: вызов не от
// мода — это действие пользователя, и оно уходит командой комнате. Пока команда
// идёт до комнаты и обратно, встречные указания ядра на короткое время не
// выполняются — иначе оно тут же вернуло бы плеер назад.
import * as sonata from "./sonata";
import type { TrackRef } from "./sonata";
import { getTracksInfo } from "~/mod/features/utils/yandex-api";

export type SessionState = "stopped" | "connecting" | "connected" | "reconnecting";

export type Listener = { name: string; you: boolean };

/** Снапшот ядра, в той части, что нужна моду. */
export type RoomSnapshot = {
  connected: boolean;
  peers: number;
  queue: TrackRef[];
  queue_revision: number;
  index: number;
  track: TrackRef | null;
  position_ms: number;
  duration_ms: number;
  playing: boolean;
  loading: boolean;
  station: string | null;
  feeding: boolean;
  drift_ms: number | null;
  rtt_ms: number | null;
  hosting: string | null;
  listeners: Listener[];
  repeat: "off" | "all" | "one";
  shuffle: boolean;
  waiting: boolean;
  notice: string | null;
};

export type SyncConfig = {
  relay: string;
  room: string;
  password: string;
  name: string;
  host: boolean;
  host_port: number;
  advertise: string;
};

export type RoomCommand =
  | { c: "toggle" }
  | { c: "next" }
  | { c: "prev" }
  | { c: "seek"; ms: number }
  | { c: "index"; index: number }
  | { c: "set_queue"; tracks: TrackRef[]; start: number }
  | { c: "enqueue"; tracks: TrackRef[] }
  | { c: "play_next"; tracks: TrackRef[] }
  | { c: "wave" }
  | { c: "stop_wave" }
  | { c: "repeat"; mode: "off" | "all" | "one" }
  | { c: "shuffle"; on: boolean }
  | { c: "name"; name: string };

export type SyncState = {
  session: SessionState;
  error: string | null;
  room: RoomSnapshot | null;
  /** Последнее, что стоит показать: «вы поставили на паузу» и т.п. */
  activity: string | null;
};

const REPORT_EVERY_MS = 200;
/** Сколько после своего действия не выполнять встречные указания ядра. */
const USER_HOLD_MS = 2500;

const sync = window.yandexMusicMod?.sync;

let state: SyncState = { session: "stopped", error: null, room: null, activity: null };
const listeners = new Set<(state: SyncState) => void>();

function setState(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener(state);
}

export function getSyncState() {
  return state;
}

export function subscribe(listener: (state: SyncState) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let holdUntil = 0;
/** Чужой (не наш) контекст, о котором комнате уже сказано. */
let announcedForeign: string | null = null;
let reportTimer: number | null = null;
/** Для диагностики: сколько отчётов ушло и последняя ошибка цикла. */
const stats = { ticks: 0, reports: 0, lastError: "" as string };

function yandexToken(): string {
  try {
    return localStorage.oauth ? String(JSON.parse(localStorage.oauth).value ?? "") : "";
  } catch {
    return "";
  }
}

export function hasYandexToken() {
  return yandexToken() !== "";
}

export async function connect(config: SyncConfig) {
  if (!sync) {
    setState({ error: "мост YandexSync недоступен в этом окне" });
    return;
  }
  setState({ session: "connecting", error: null, activity: null });
  const result = await sync.start({ ...config, yandex_token: yandexToken() });
  if (!result?.ok) {
    setState({ session: "stopped", error: result?.error ?? "не удалось запустить YandexSync" });
    return;
  }
  startReporting();
}

export async function disconnect() {
  await sync?.stop();
  stopReporting();
  void sonata.setRate(1);
  setState({ session: "stopped", room: null, activity: null });
}

export function command(cmd: RoomCommand) {
  sync?.command(cmd);
}

function inRoom() {
  return state.session === "connected" && state.room !== null;
}

function activity(text: string) {
  setState({ activity: text });
}

// ---- от ядра к плееру ------------------------------------------------------

async function handleOp(message: any) {
  switch (message.op) {
    case "load":
      return load(message.track as TrackRef);
    case "rate":
      // Скорость относится к очереди комнаты, как и остальные указания.
      if (!sonata.snapshot()?.contextId?.startsWith(sonata.OUR_CONTEXT_PREFIX)) return;
      return sonata.setRate(Number(message.rate));
    case "play":
    case "pause":
    case "seek":
      // Пользователь только что сам управлял плеером, и комната ещё не ответила:
      // это указание ядро дало по старому состоянию комнаты.
      if (Date.now() < holdUntil) return;
      // Плеер играет то, что пользователь включил сам, и комната об этом ещё не
      // знает: указания для очереди комнаты к этому треку не относятся.
      if (!sonata.snapshot()?.contextId?.startsWith(sonata.OUR_CONTEXT_PREFIX)) return;
      if (message.op === "play") return sonata.play();
      if (message.op === "pause") return sonata.pause();
      return sonata.seek(Number(message.ms));
  }
}

async function load(track: TrackRef) {
  const room = state.room;
  // Плееру отдаётся вся очередь комнаты, чтобы его собственные «вперёд»/«назад»
  // и список «Далее» показывали именно её.
  let ids = [track.track_id];
  let index = 0;
  let contextId = `${sonata.OUR_CONTEXT_PREFIX}single-${track.track_id}`;
  if (room && room.queue[room.index]?.track_id === track.track_id) {
    ids = room.queue.map((t) => t.track_id);
    index = room.index;
    contextId = `${sonata.OUR_CONTEXT_PREFIX}${room.queue_revision}`;
  } else if (room) {
    const found = room.queue.findIndex((t) => t.track_id === track.track_id);
    if (found >= 0) {
      ids = room.queue.map((t) => t.track_id);
      index = found;
      contextId = `${sonata.OUR_CONTEXT_PREFIX}${room.queue_revision}`;
    }
  }

  try {
    const now = sonata.snapshot();
    const alreadyThere = now?.trackId === track.track_id && !!now.contextId?.startsWith(sonata.OUR_CONTEXT_PREFIX);
    // Плеер уже на этом треке нашей очереди: перешёл сам в конце предыдущего или
    // по кнопке «вперёд», и комната догнала. Перезапускать трек незачем — позицию
    // ядро выровняет.
    if (!alreadyThere) await sonata.stageQueue(contextId, ids, index);
    // И в том случае, когда плеер перешёл сам: подмена источника ещё может идти.
    await sonata.waitUntilOn(track.track_id, track.duration_ms);
    announcedForeign = null;
    sync?.reportLoaded({ track_id: track.track_id, ok: true });
  } catch (error) {
    sync?.reportLoaded({
      track_id: track.track_id,
      ok: false,
      error: `плеер Яндекс Музыки не поставил трек: ${error instanceof Error ? error.message : error}`,
    });
  }
}

// ---- от плеера к ядру ------------------------------------------------------

function startReporting() {
  if (reportTimer !== null) return;
  reportTimer = window.setInterval(() => {
    stats.ticks++;
    try {
      tick();
    } catch (error) {
      stats.lastError = String(error);
      console.warn("[YandexSync] ошибка в цикле плеера", error);
    }
  }, REPORT_EVERY_MS);
}

function stopReporting() {
  if (reportTimer !== null) window.clearInterval(reportTimer);
  reportTimer = null;
}

function tick() {
  const now = sonata.snapshot();
  if (!now) return;
  const playing = now.status === "playing" || now.status === "buffering";
  sync?.reportPlayer({
    track_id: now.trackId,
    position_ms: now.positionMs,
    playing,
    ended: now.status === "ended",
  });
  stats.reports++;

  if (inRoom()) detectUserAction(now, playing);
}

function hold() {
  holdUntil = Date.now() + USER_HOLD_MS;
}

/**
 * Пользователь включил в приложении что-то своё — альбом, плейлист, трек из
 * поиска: когда плеер это загрузит, оно становится очередью комнаты.
 */
function detectUserAction(now: sonata.PlayerSnapshot, playing: boolean) {
  const ours = now.contextId?.startsWith(sonata.OUR_CONTEXT_PREFIX) ?? false;
  if (ours || !now.trackId || !playing) return;
  const key = `${now.contextId}/${now.trackId}`;
  if (announcedForeign === key) return;
  announcedForeign = key;
  hold();
  void shareForeignQueue();
}

/** Индекс аргумента «id воспроизведения»: трейлеры и клипы — отдельные плееры. */
const PLAYBACK_ARG: Record<string, number> = {
  pause: 0,
  resume: 0,
  play: 0,
  togglePause: 0,
  moveForward: 0,
  moveBackward: 0,
  setProgress: 1,
  setEntityByIndex: 1,
  playContext: 1,
};

/** Что сделать с вызовом кнопки приложения, пока вы в комнате. "block" — не выполнять его в плеере. */
type Intercept = (args: any[], room: RoomSnapshot) => "block" | void;

const INTERCEPTS: Record<string, Intercept> = {
  pause: (_args, room) => {
    if (!room.playing) return;
    activity("Вы поставили паузу для всей комнаты");
    command({ c: "toggle" });
  },
  resume: (_args, room) => {
    if (room.playing) return;
    activity("Вы продолжили для всей комнаты");
    command({ c: "toggle" });
  },
  play: (_args, room) => {
    if (room.playing) return;
    activity("Вы продолжили для всей комнаты");
    command({ c: "toggle" });
  },
  togglePause: (_args, room) => {
    activity(room.playing ? "Вы поставили паузу для всей комнаты" : "Вы продолжили для всей комнаты");
    command({ c: "toggle" });
  },
  setProgress: ([seconds]) => {
    activity("Вы перемотали для всей комнаты");
    command({ c: "seek", ms: Math.max(0, Math.round(Number(seconds) * 1000)) });
  },
  moveForward: () => {
    activity("Вы переключили трек для всей комнаты");
    command({ c: "next" });
  },
  moveBackward: () => {
    activity("Вы вернули предыдущий трек для всей комнаты");
    command({ c: "prev" });
  },
  setEntityByIndex: ([index]) => {
    if (!sonata.snapshot()?.contextId?.startsWith(sonata.OUR_CONTEXT_PREFIX)) return;
    activity("Вы выбрали трек для всей комнаты");
    command({ c: "index", index: Number(index) });
  },
  playContext: ([params]) => {
    if (params?.contextData?.type === "vibe") {
      // Волна комнаты — это ваша «Моя волна», но через ядро: оно подкачивает
      // треки для всех и сообщает Яндексу, что дослушано и что пропущено.
      activity("Вы включили «Мою волну» для всей комнаты");
      command({ c: "wave" });
      return "block";
    }
    // Своё: дать плееру загрузить, а очередь отправит detectUserAction.
    announcedForeign = null;
  },
};

function installInterceptors(facade: any) {
  if (facade.__yandexSync) return;
  facade.__yandexSync = true;
  for (const [name, intercept] of Object.entries(INTERCEPTS)) {
    const original = facade[name];
    if (typeof original !== "function") continue;
    facade[name] = function (this: any, ...args: any[]) {
      const otherPlayback = args[PLAYBACK_ARG[name]!] !== undefined;
      if (sonata.isModCall() || otherPlayback || !inRoom()) return original.apply(this, args);
      hold();
      if (intercept(args, state.room!) === "block") return Promise.resolve();
      return original.apply(this, args);
    };
  }
}

sonata.onFacade(installInterceptors);

/** Очередь, которую пользователь включил в приложении, становится очередью комнаты. */
async function shareForeignQueue() {
  const { tracks, missing, index } = sonata.queueTracks();
  let all = tracks;
  if (missing.length) {
    const info = await getTracksInfo(missing);
    if (info.isOk()) {
      const byId = new Map(info.value.map((meta: any) => [String(meta.id), sonata.trackFromMeta(meta)]));
      const queue = sonata.player()?.getState().queueState.entityList.value ?? [];
      all = queue
        .map((item: any) => {
          const id = String(item?.entity?.data?.meta?.id ?? "");
          return tracks.find((t) => t.track_id === id) ?? byId.get(id) ?? null;
        })
        .filter((t: TrackRef | null): t is TrackRef => t !== null);
    }
  }
  if (!all.length) return;
  const current = sonata.snapshot()?.trackId;
  const start = Math.max(0, all.findIndex((t) => t.track_id === current));
  activity(`Вы включили «${all[start]?.title ?? all[0]!.title}» для всей комнаты`);
  command({ c: "set_queue", tracks: all, start: start >= 0 ? start : Math.min(index, all.length - 1) });
}

/**
 * То, что играло в приложении до входа в комнату, — не действие пользователя:
 * иначе вход в комнату заменял бы её музыку на вашу.
 */
function rememberWhatWasPlaying() {
  const now = sonata.snapshot();
  if (now && now.trackId && !now.contextId?.startsWith(sonata.OUR_CONTEXT_PREFIX)) {
    announcedForeign = `${now.contextId}/${now.trackId}`;
  }
}

// Для диагностики из devtools.
(window as any).__yandexSync = { connect, disconnect, command, getSyncState, snapshot: sonata.snapshot, stats };

// ---- события моста ---------------------------------------------------------

sync?.onEvent((message: any) => {
  switch (message.t) {
    case "status":
      setState({
        session: message.state,
        error: message.error ?? (message.state === "connected" ? null : state.error),
        room: message.state === "connected" ? state.room : message.state === "stopped" ? null : state.room,
      });
      if (message.state === "stopped") {
        stopReporting();
        void sonata.setRate(1);
            } else {
        if (message.state === "connected") rememberWhatWasPlaying();
        startReporting();
      }
      break;
    case "snapshot":
      setState({ room: message.snapshot as RoomSnapshot });
      break;
    case "player":
      void handleOp(message).catch((error) => console.warn("[YandexSync] команда плееру не выполнилась", error));
      break;
    case "bridge_exit":
      stopReporting();
      void sonata.setRate(1);
          setState({
        session: "stopped",
        room: null,
        error: state.session === "stopped" ? null : "процесс YandexSync завершился",
      });
      break;
  }
});
