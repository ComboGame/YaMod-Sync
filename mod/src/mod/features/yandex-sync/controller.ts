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
// мода — это действие пользователя, и оно уходит командой комнате.
//
// Смена трека в комнате не выполняется в плеере сразу: «вперёд», «назад», выбор
// трека из очереди уходят в комнату, и трек ставит загрузка от ядра — у всех
// одновременно. Пауза и перемотка выполняются сразу (их ждать незачем), и пока
// команда идёт до комнаты и обратно, встречные указания ядра на короткое время
// не выполняются — иначе оно тут же вернуло бы плеер назад.
import * as sonata from "./sonata";
import type { TrackRef } from "./sonata";
import { getTracksInfo } from "~/mod/features/utils/yandex-api";
import { onYandexApiRequest } from "~/mod/features/utils";

export type SessionState = "stopped" | "connecting" | "connected" | "reconnecting";

export type Listener = { name: string; you: boolean };

/** Сколько занимает каждый шаг — измерено ядром (см. engine.rs::Latency). */
export type Latency = {
  /** Лучший RTT до релея за последнюю минуту. */
  rtt_ms: number | null;
  /** RTT последнего замера часов. */
  rtt_last_ms: number | null;
  /** От команды до ответа релея. */
  command_ms: number | null;
  /** Сколько шло последнее состояние комнаты от релея. */
  delivery_ms: number | null;
  /** От нового трека комнаты до подтверждения плеера. */
  load_ms: number | null;
  /** Сколько комната последний раз ждала готовности всех. */
  barrier_ms: number | null;
};

/** Снапшот ядра, в той части, что нужна моду. */
export type RoomSnapshot = {
  connected: boolean;
  peers: number;
  /** Очередь приходит отдельным сообщением и подставляется сюда. */
  queue: TrackRef[];
  queue_revision: number;
  index: number;
  track: TrackRef | null;
  position_ms: number;
  duration_ms: number;
  /** Играет ли плеер трек комнаты. */
  playing: boolean;
  loading: boolean;
  station: string | null;
  feeding: boolean;
  /** Включивший волну вышел: очередь доиграет, новых треков не будет. */
  station_unfed: boolean;
  drift_ms: number | null;
  rtt_ms: number | null;
  hosting: string | null;
  listeners: Listener[];
  repeat: "off" | "all" | "one";
  shuffle: boolean;
  waiting: boolean;
  notice: string | null;
  /** Что комната хочет: играть или стоять. null — релей ещё ничего не сказал. */
  room_playing: boolean | null;
  /** На каком треке плеер на самом деле. */
  local_track: string | null;
  /** Свежи ли отчёты плеера; если нет — playing лишь догадка. */
  local_live: boolean;
  latency: Latency;
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
  | { c: "wave"; seeds?: string[] }
  | { c: "wave_feedback"; kind: FeedbackKind; track_id: string }
  | { c: "stop_wave" }
  | { c: "repeat"; mode: "off" | "all" | "one" }
  | { c: "shuffle"; on: boolean }
  | { c: "name"; name: string };

export type FeedbackKind = "like" | "unlike" | "dislike" | "undislike";

/** Что сказано о волне в строке станции комнаты (см. crates/core/src/station.rs). */
export type StationInfo = { seeds: string[]; name?: string; description?: string; by?: string };

export function parseStation(station: string | null): StationInfo | null {
  if (!station) return null;
  if (station.trim().startsWith("{")) {
    try {
      const spec = JSON.parse(station);
      if (Array.isArray(spec.seeds) && spec.seeds.length) return spec;
    } catch {}
  }
  return { seeds: [station] };
}

export type SyncState = {
  session: SessionState;
  error: string | null;
  room: RoomSnapshot | null;
  /** Последнее, что стоит показать: «вы поставили на паузу» и т.п. */
  activity: string | null;
};

const REPORT_EVERY_MS = 200;
/** Сколько после своей паузы или перемотки не выполнять встречные указания ядра. */
const USER_HOLD_MS = 1500;
/** Сколько до конца трека плеер считается «вот-вот перейдёт сам». */
const FINISHING_MS = 2500;
/** Через сколько повторить отправку своей очереди, если её не удалось собрать. */
const SHARE_RETRY_MS = 3000;

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
/** Очередь комнаты: мост шлёт её отдельно и только при изменении. */
let roomQueue: { revision: number; tracks: TrackRef[] } = { revision: -1, tracks: [] };
/** Для диагностики: сколько отчётов ушло, последняя ошибка цикла, что пропущено. */
const stats = {
  ticks: 0,
  reports: 0,
  lastError: "" as string,
  /** Указания ядра для другого трека, которые плеер не стал выполнять. */
  refused: 0,
  /** Загрузки, отменённые более новыми. */
  superseded: 0,
  /** Очереди, обновлённые на месте, без перезагрузки контекста. */
  queueUpdates: 0,
};

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

function ours(snapshot: sonata.PlayerSnapshot | null) {
  return !!snapshot?.contextId?.startsWith(sonata.OUR_CONTEXT_PREFIX);
}

// ---- от ядра к плееру ------------------------------------------------------

/**
 * Всё, что меняет очередь плеера, — по одному: загрузки трека и обновления
 * очереди не должны пересекаться, иначе setEntityByIndex одной загрузки
 * доставался контексту другой.
 */
let chain: Promise<void> = Promise.resolve();
function serial(task: () => Promise<void>) {
  chain = chain.then(task).catch((error) => console.warn("[YandexSync] плеер не выполнил указание", error));
}

/** Номер последней загрузки: более старые, если ещё не закончились, тихо отменяются. */
let loadSeq = 0;

async function handleOp(message: any) {
  switch (message.op) {
    case "load": {
      const seq = ++loadSeq;
      serial(() => load(message.track as TrackRef, seq));
      return;
    }
    case "rate":
      // Скорость относится к очереди комнаты, как и остальные указания.
      if (!ours(sonata.snapshot())) return;
      return sonata.setRate(Number(message.rate));
    case "play":
    case "pause":
    case "seek": {
      // Пользователь только что сам управлял плеером, и комната ещё не ответила:
      // это указание ядро дало по старому состоянию комнаты.
      if (Date.now() < holdUntil) return;
      const now = sonata.snapshot();
      // Плеер играет то, что пользователь включил сам, и комната об этом ещё не
      // знает: указания для очереди комнаты к этому треку не относятся.
      if (!ours(now)) return;
      // Указание для другого трека: плеер уже ушёл с него сам. Выполнить его —
      // значит перемотать не тот трек. Ядро увидит расхождение и поставит трек.
      if (message.track_id && now?.trackId !== String(message.track_id)) {
        stats.refused++;
        return;
      }
      if (message.op === "play") return sonata.play();
      if (message.op === "pause") return sonata.pause();
      return sonata.seek(Number(message.ms));
    }
  }
}

async function load(track: TrackRef, seq: number) {
  // Пока эта загрузка ждала своей очереди, ядро попросило другой трек: мост об
  // этой уже забыл, отвечать не нужно.
  const stale = () => seq !== loadSeq;
  if (stale()) {
    stats.superseded++;
    return;
  }
  // Плееру отдаётся вся очередь комнаты, чтобы его собственные «вперёд»/«назад»,
  // автопереход и список «Далее» были именно её.
  const queue = roomQueue.tracks;
  let ids = [track.track_id];
  let index = 0;
  let contextId = `${sonata.OUR_CONTEXT_PREFIX}single-${track.track_id}`;
  const room = state.room;
  const found =
    room && queue[room.index]?.track_id === track.track_id
      ? room.index
      : queue.findIndex((t) => t.track_id === track.track_id);
  if (found >= 0) {
    ids = queue.map((t) => t.track_id);
    index = found;
    contextId = `${sonata.OUR_CONTEXT_PREFIX}${roomQueue.revision}`;
  }

  try {
    const now = sonata.snapshot();
    const alreadyThere = now?.trackId === track.track_id && ours(now);
    // Плеер доигрывает предыдущий трек нашей очереди и вот-вот перейдёт сам:
    // комната закончила трек по длительности Яндекса, а файл обычно чуть
    // длиннее. Переключить его сейчас — значит столкнуться с его собственным
    // автопереходом: тот прибавляет единицу к уже выставленному индексу, и плеер
    // уезжал через трек.
    const finishing =
      !!now &&
      !alreadyThere &&
      found > 0 &&
      ours(now) &&
      now.trackId === ids[found - 1] &&
      now.status === "playing" &&
      now.durationMs > 0 &&
      now.durationMs - now.positionMs < FINISHING_MS;
    let on = alreadyThere || (finishing && (await sonata.waitUntilOn(track.track_id, track.duration_ms, FINISHING_MS + 1000, stale)));
    if (stale()) {
      stats.superseded++;
      return;
    }
    // Плеер уже на этом треке нашей очереди: перешёл сам в конце предыдущего, и
    // комната догнала. Перезапускать трек незачем — позицию ядро выровняет.
    if (on && found >= 0) sonata.updateQueue(ids, index);
    if (!on) {
      await sonata.stageQueue(contextId, ids, index);
      on = await sonata.waitUntilOn(track.track_id, track.duration_ms, 1500, stale);
      // Плеер оказался на другом треке (его автопереход пришёлся на тот же
      // момент) — поставить ещё раз сразу, а не ждать отказа и повтора ядра.
      if (!on && !stale() && sonata.snapshot()?.trackId !== track.track_id) {
        await sonata.stageQueue(contextId, ids, index);
      }
    }
    if (stale()) {
      stats.superseded++;
      return;
    }
    // И в том случае, когда плеер перешёл сам: подмена источника ещё может идти.
    on = await sonata.waitUntilOn(track.track_id, track.duration_ms, 5000, stale);
    if (stale()) {
      stats.superseded++;
      return;
    }
    if (!on) {
      // Не «ok»: иначе комната стартовала бы, а у вас играл бы прежний трек.
      // Ядро попробует ещё раз.
      sync?.reportLoaded({ track_id: track.track_id, ok: false, error: "плеер Яндекс Музыки не переключился на трек" });
      return;
    }
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

/** Новая очередь комнаты — в плеер, не прерывая текущий трек. */
function onRoomQueue() {
  serial(async () => {
    const room = state.room;
    if (!room || roomQueue.tracks.length === 0) return;
    const ids = roomQueue.tracks.map((t) => t.track_id);
    if (sonata.updateQueue(ids, room.index)) stats.queueUpdates++;
  });
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
    ours: ours(now),
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
  if (ours(now) || !now.trackId || !playing) return;
  const key = `${now.contextId}/${now.trackId}`;
  if (announcedForeign === key) return;
  announcedForeign = key;
  hold();
  void shareForeignQueue().then((shared) => {
    // Не вышло собрать очередь (сеть, API): попробовать ещё раз позже, иначе
    // комната так и играла бы своё, а вы — своё.
    if (!shared) window.setTimeout(() => announcedForeign === key && (announcedForeign = null), SHARE_RETRY_MS);
  });
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
  inject: 1,
  injectNext: 1,
  injectLast: 1,
};

/**
 * Что сделать с вызовом кнопки приложения, пока вы в комнате.
 * "block" — не выполнять его в плеере; "now" — выполнить без паузы в указаниях ядра.
 */
type Intercept = (args: any[], room: RoomSnapshot) => "block" | "now" | void;

/** Треки из того, что приложение передаёт в inject: метаданные, если есть, иначе id. */
async function tracksFrom(entitiesData: any[]): Promise<TrackRef[]> {
  const metas = (entitiesData ?? []).map((item: any) => item?.meta ?? item?.data?.meta ?? item);
  const ready = metas.map((meta: any) => sonata.trackFromMeta(meta));
  const missing = metas.filter((_: any, i: number) => !ready[i]).map((meta: any) => String(meta?.id ?? "")).filter(Boolean);
  if (!missing.length) return ready.filter((t): t is TrackRef => t !== null);
  const info = await getTracksInfo(missing);
  const byId = new Map(info.isOk() ? info.value.map((meta: any) => [String(meta.id), sonata.trackFromMeta(meta)]) : []);
  return metas
    .map((meta: any, i: number) => ready[i] ?? byId.get(String(meta?.id ?? "")) ?? null)
    .filter((t: TrackRef | null): t is TrackRef => t !== null);
}

function queueFromApp(params: any, where: "next" | "last") {
  void tracksFrom(params?.entitiesData).then((tracks) => {
    if (!tracks.length) return;
    activity(where === "next" ? "Вы поставили трек следующим для всей комнаты" : "Вы добавили в очередь комнаты");
    command(where === "next" ? { c: "play_next", tracks } : { c: "enqueue", tracks });
  });
}

const INTERCEPTS: Record<string, Intercept> = {
  pause: (_args, room) => {
    if (room.room_playing === false && !room.waiting) return;
    activity("Вы поставили паузу для всей комнаты");
    command({ c: "toggle" });
  },
  resume: (_args, room) => {
    if (room.room_playing || room.waiting) return;
    activity("Вы продолжили для всей комнаты");
    command({ c: "toggle" });
  },
  play: (_args, room) => {
    if (room.room_playing || room.waiting) return;
    activity("Вы продолжили для всей комнаты");
    command({ c: "toggle" });
  },
  togglePause: (_args, room) => {
    activity(room.room_playing || room.waiting ? "Вы поставили паузу для всей комнаты" : "Вы продолжили для всей комнаты");
    command({ c: "toggle" });
  },
  setProgress: ([seconds]) => {
    activity("Вы перемотали для всей комнаты");
    command({ c: "seek", ms: Math.max(0, Math.round(Number(seconds) * 1000)) });
  },
  // Смена трека — через комнату: трек поставит загрузка, у всех сразу.
  moveForward: () => {
    if (!ours(sonata.snapshot())) return "now";
    activity("Вы переключили трек для всей комнаты");
    command({ c: "next" });
    return "block";
  },
  moveBackward: () => {
    if (!ours(sonata.snapshot())) return "now";
    activity("Вы вернули предыдущий трек для всей комнаты");
    command({ c: "prev" });
    return "block";
  },
  setEntityByIndex: ([index]) => {
    if (!ours(sonata.snapshot())) return "now";
    activity("Вы выбрали трек для всей комнаты");
    command({ c: "index", index: Number(index) });
    return "block";
  },
  // «Играть следующим» и «Добавить в очередь» — в очередь комнаты, а не только
  // в свою: иначе ваш плеер разошёлся бы с остальными.
  injectNext: ([params]) => {
    if (!ours(sonata.snapshot())) return "now";
    queueFromApp(params, "next");
    return "block";
  },
  injectLast: ([params]) => {
    if (!ours(sonata.snapshot())) return "now";
    queueFromApp(params, "last");
    return "block";
  },
  inject: ([params]) => {
    const now = sonata.snapshot();
    if (!ours(now)) return "now";
    queueFromApp(params, Number(params?.position) === (now?.index ?? -1) + 1 ? "next" : "last");
    return "block";
  },
  playContext: ([params], room) => {
    if (params?.contextData?.type === "vibe") {
      // Волна комнаты — это ваша «Моя волна» или выбранный пресет, но через
      // ядро: оно подкачивает треки для всех по тем же сидам, что передал бы
      // плеер, и сообщает Яндексу, что дослушано и что пропущено. Та же волна,
      // что уже играет у вас, не перезапускается — ядро её просто продолжит.
      const seeds: string[] = Array.isArray(params.contextData.seeds) ? params.contextData.seeds.map(String) : [];
      const current = parseStation(room.station);
      const same = room.feeding && current && sameSeeds(current.seeds, seeds);
      activity(same ? "Волна продолжается" : "Вы включили волну для всей комнаты");
      command({ c: "wave", seeds });
      return "block";
    }
    // Своё: дать плееру загрузить, а очередь отправит detectUserAction.
    announcedForeign = null;
    return "now";
  },
};

function sameSeeds(a: string[], b: string[]) {
  const norm = (seeds: string[]) => (seeds.length ? seeds : ["user:onyourwave"]).map((s) => s.trim()).join("|");
  return norm(a) === norm(b);
}

function installInterceptors(facade: any) {
  if (facade.__yandexSync) return;
  facade.__yandexSync = true;
  for (const [name, intercept] of Object.entries(INTERCEPTS)) {
    const original = facade[name];
    if (typeof original !== "function") continue;
    facade[name] = function (this: any, ...args: any[]) {
      const otherPlayback = args[PLAYBACK_ARG[name]!] !== undefined;
      if (sonata.isModCall() || otherPlayback || !inRoom()) return original.apply(this, args);
      const verdict = intercept(args, state.room!);
      if (verdict === "block") return Promise.resolve();
      if (verdict !== "now") hold();
      return original.apply(this, args);
    };
  }
}

sonata.onFacade(installInterceptors);

/**
 * Лайк и дизлайк из приложения. Сам запрос в «Мне нравится» или «Не нравится»
 * идёт как обычно, на ваш аккаунт. Если сейчас играет ваша волна, Яндекс,
 * кроме того, узнаёт о нём как о фидбеке волны — так же, как его отправил бы
 * клиент. Пропуск при дизлайке клиент делает сам, через moveForward, и он уже
 * становится «следующим» для всей комнаты.
 */
const FEEDBACK_ROUTES: { pattern: RegExp; kind: FeedbackKind }[] = [
  { pattern: /\/users\/[^/]+\/likes\/tracks\/add(?:\?|$)/, kind: "like" },
  { pattern: /\/users\/[^/]+\/likes\/tracks\/([^/?]+)\/remove/, kind: "unlike" },
  { pattern: /\/users\/[^/]+\/dislikes\/tracks\/add(?:\?|$)/, kind: "dislike" },
  { pattern: /\/users\/[^/]+\/dislikes\/tracks\/([^/?]+)\/remove/, kind: "undislike" },
];

function onFeedbackRequest(request: Request) {
  if (request.method !== "POST" || !inRoom()) return;
  const room = state.room!;
  if (!room.feeding || !room.station || !room.track) return;
  const url = new URL(request.url);
  for (const route of FEEDBACK_ROUTES) {
    const match = url.pathname.match(route.pattern);
    if (!match) continue;
    const raw = match[1] ? decodeURIComponent(match[1]) : (url.searchParams.get("track-id") ?? "");
    // `id:album` или просто id.
    const trackId = raw.split(":")[0];
    if (trackId !== room.track.track_id) return;
    command({ c: "wave_feedback", kind: route.kind, track_id: trackId });
    return;
  }
}

for (const prefix of ["/likes/tracks/", "/dislikes/tracks/"]) {
  onYandexApiRequest(prefix, async (request: Request) => {
    onFeedbackRequest(request);
  });
}

/** Очередь, которую пользователь включил в приложении, становится очередью комнаты. */
async function shareForeignQueue(): Promise<boolean> {
  const { tracks, missing, index } = sonata.queueTracks();
  let all = tracks;
  if (missing.length) {
    const info = await getTracksInfo(missing);
    if (!info.isOk()) return false;
    const byId = new Map(info.value.map((meta: any) => [String(meta.id), sonata.trackFromMeta(meta)]));
    const queue = sonata.player()?.getState().queueState.entityList.value ?? [];
    all = queue
      .map((item: any) => {
        const id = String(item?.entity?.data?.meta?.id ?? "");
        return tracks.find((t) => t.track_id === id) ?? byId.get(id) ?? null;
      })
      .filter((t: TrackRef | null): t is TrackRef => t !== null);
  }
  if (!all.length) return false;
  const current = sonata.snapshot()?.trackId;
  const at = all.findIndex((t) => t.track_id === current);
  const start = at >= 0 ? at : Math.min(index, all.length - 1);
  activity(`Вы включили «${all[start]?.title ?? all[0]!.title}» для всей комнаты`);
  command({ c: "set_queue", tracks: all, start });
  return true;
}

/**
 * То, что играло в приложении до входа в комнату, — не действие пользователя:
 * иначе вход в комнату заменял бы её музыку на вашу.
 */
function rememberWhatWasPlaying() {
  const now = sonata.snapshot();
  if (now && now.trackId && !ours(now)) {
    announcedForeign = `${now.contextId}/${now.trackId}`;
  }
}

// Для диагностики из devtools.
(window as any).__yandexSync = { connect, disconnect, command, getSyncState, snapshot: sonata.snapshot, player: sonata.player, stats };

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
        roomQueue = { revision: -1, tracks: [] };
      } else {
        if (message.state === "connected") rememberWhatWasPlaying();
        startReporting();
      }
      break;
    case "queue":
      roomQueue = { revision: Number(message.revision), tracks: (message.tracks ?? []) as TrackRef[] };
      if (state.room) setState({ room: { ...state.room, queue: roomQueue.tracks } });
      onRoomQueue();
      break;
    case "snapshot":
      setState({ room: { ...(message.snapshot as RoomSnapshot), queue: roomQueue.tracks } });
      break;
    case "player":
      void handleOp(message).catch((error: unknown) => console.warn("[YandexSync] команда плееру не выполнилась", error));
      break;
    case "bridge_exit":
      stopReporting();
      void sonata.setRate(1);
      roomQueue = { revision: -1, tracks: [] };
      setState({
        session: "stopped",
        room: null,
        error: state.session === "stopped" ? null : "процесс YandexSync завершился",
      });
      break;
  }
});
