// Доступ к плееру Яндекс Музыки (Sonata) изнутри страницы.
//
// Фасад плеера живёт в состоянии одного из React-компонентов приложения: объект с
// полем playbackController и методами playContext/setContext/setProgress/... Мы
// находим его обходом React-дерева, как исходный мод находит состояние плеера, и
// дальше пользуемся только его публичными методами. Проверено на 5.122.0:
//
//   setContext({contextData, entitiesData, queueParams})  — ставит очередь на паузе
//   play() / pause() / resume() / setProgress(сек)        — как кнопки плеера
//   setEntityByIndex(i)                                    — другой трек той же очереди
//   getState().playerState.{status,progress}.value         — что происходит сейчас
//   getState().queueState.{currentEntity,entityList,index}.value
//   getState().currentContext.value.data                   — {type, meta:{id}}
//
// Треки передаются как {type: "unloaded", meta: {id}}: метаданные плеер подтянет сам.

export type TrackRef = {
  track_id: string;
  album_id?: string;
  album?: string;
  title: string;
  artist: string;
  duration_ms: number;
  cover_uri?: string;
};

export type PlayerSnapshot = {
  /** id трека, на котором стоит плеер. */
  trackId: string | null;
  positionMs: number;
  durationMs: number;
  /** playing | paused | buffering | ended | stopped | ... */
  status: string;
  contextType: string | null;
  contextId: string | null;
  index: number;
};

/** Наши очереди отличаются от тех, что пользователь включил сам, по id контекста. */
export const OUR_CONTEXT_PREFIX = "ymsync-room-";

let facade: any = null;

/** Пока true, вызовы методов плеера — наши, а не кнопки приложения. */
let internal = false;
let onFound: ((facade: any) => void) | null = null;

/** Вызывается один раз для каждого найденного фасада — чтобы перехватить его методы. */
export function onFacade(callback: (facade: any) => void) {
  onFound = callback;
  if (facade) callback(facade);
}

/**
 * Плеер обновляет позицию по timeupdate, раз в ~265 мс, и между обновлениями
 * значение устаревает. Для синхрона это заметно, поэтому запоминается момент
 * каждого обновления и позиция досчитывается от него.
 */
let progressAt = { positionMs: 0, at: 0 };
const watched = new WeakSet<object>();

function watchProgress(p: any) {
  const progress = p.getState().playerState.progress;
  if (watched.has(progress) || typeof progress.onChange !== "function") return;
  watched.add(progress);
  progress.onChange((value: any) => {
    progressAt = { positionMs: Math.max(0, (value?.position ?? 0) * 1000), at: performance.now() };
  });
}

/** Самое свежее, что можно сказать о позиции, когда плеер играет. */
function livePositionMs(reportedMs: number, playing: boolean): number {
  if (!playing || Math.abs(progressAt.positionMs - reportedMs) > 1) return reportedMs;
  // Не дальше одного-двух интервалов: дольше без обновлений — плеер не играет.
  return reportedMs + Math.min(performance.now() - progressAt.at, 600);
}

/** Выполняет вызов плеера от имени мода: перехватчик его не примет за пользователя. */
function asMod<T>(call: () => T): T {
  internal = true;
  try {
    return call();
  } finally {
    internal = false;
  }
}

export function isModCall() {
  return internal;
}

function rootFiber(): any {
  const el = document.querySelector('section[data-test-id="PLAYERBAR_DESKTOP"]') ?? document.body.firstElementChild;
  if (!el) return null;
  const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
  if (!key) return null;
  let fiber = (el as any)[key];
  while (fiber?.return) fiber = fiber.return;
  return fiber;
}

function isFacade(value: any): boolean {
  return (
    !!value &&
    typeof value === "object" &&
    !!value.playbackController &&
    typeof value.setContext === "function" &&
    typeof value.setProgress === "function" &&
    typeof value.getState === "function"
  );
}

/** Фасад плеера, или null, если приложение ещё не отрисовало его. */
export function player(): any {
  if (facade) {
    try {
      facade.getState();
      return facade;
    } catch {
      facade = null;
    }
  }
  const root = rootFiber();
  if (!root) return null;
  const stack = [root];
  let visited = 0;
  while (stack.length && visited < 100_000) {
    const fiber = stack.pop();
    visited++;
    let hook = fiber.memoizedState;
    for (let i = 0; hook && i < 40; i++, hook = hook.next) {
      const state = hook.memoizedState;
      const candidate = Array.isArray(state) ? state[0] : state;
      if (isFacade(candidate)) {
        facade = candidate;
        watchProgress(facade);
        onFound?.(facade);
        return facade;
      }
    }
    if (fiber.child) stack.push(fiber.child);
    if (fiber.sibling) stack.push(fiber.sibling);
  }
  return null;
}

export function snapshot(): PlayerSnapshot | null {
  const p = player();
  if (!p) return null;
  const state = p.getState();
  const progress = state.playerState.progress.value ?? {};
  const entity = state.queueState.currentEntity.value?.entity;
  const context = state.currentContext?.value?.data;
  const id = entity?.data?.meta?.id;
  const status = String(state.playerState.status.value ?? "stopped");
  watchProgress(p);
  return {
    trackId: id !== undefined && id !== null ? String(id) : null,
    positionMs: livePositionMs(Math.max(0, (progress.position ?? 0) * 1000), status === "playing"),
    durationMs: Math.max(0, (progress.duration ?? 0) * 1000),
    status,
    contextType: context?.type ?? null,
    contextId: context?.meta?.id !== undefined ? String(context.meta.id) : null,
    index: state.queueState.index.value ?? 0,
  };
}

/** Треки текущей очереди плеера — то, что пользователь включил сам. */
export function queueTracks(): { tracks: TrackRef[]; missing: string[]; index: number } {
  const p = player();
  if (!p) return { tracks: [], missing: [], index: 0 };
  const state = p.getState();
  const list: any[] = state.queueState.entityList.value ?? [];
  const tracks: TrackRef[] = [];
  const missing: string[] = [];
  for (const item of list) {
    const meta = item?.entity?.data?.meta;
    if (!meta?.id) continue;
    const track = trackFromMeta(meta);
    if (track) tracks.push(track);
    else missing.push(String(meta.id));
  }
  return { tracks, missing, index: state.queueState.index.value ?? 0 };
}

/** TrackRef из метаданных трека, как их отдают плеер и API. Без длительности — null. */
export function trackFromMeta(meta: any): TrackRef | null {
  if (!meta?.id || !meta.durationMs) return null;
  const album = meta.albums?.[0];
  return {
    track_id: String(meta.id),
    album_id: album?.id !== undefined ? String(album.id) : undefined,
    album: album?.title,
    title: meta.version ? `${meta.title} (${meta.version})` : String(meta.title ?? ""),
    artist: (meta.artists ?? []).map((a: any) => a.name).join(", "),
    duration_ms: Number(meta.durationMs),
    cover_uri: meta.coverUri,
  };
}

function entityIds(state: any): string[] {
  const list: any[] = state.queueState.entityList.value ?? [];
  return list.map((item) => String(item?.entity?.data?.meta?.id ?? ""));
}

function unloaded(ids: string[]) {
  return ids.map((id) => ({ type: "unloaded", meta: { id } }));
}

/** Очередь плеера идёт по порядку списка: перемешивание плеера мы не включаем, но проверяем. */
function inListOrder(state: any): boolean {
  const order: number[] | undefined = state.queueState.order?.value;
  return !order || order.every((at, i) => at === i);
}

/**
 * Ставит очередь комнаты в плеер на треке `index`.
 *
 * Если в плеере уже наша очередь с теми же треками, плеер только переключает
 * трек — без перезагрузки контекста. Играл ли он до этого или стоял, так и
 * остаётся: ядро само скажет, что делать, когда комната стартует.
 */
export async function stageQueue(contextId: string, ids: string[], index: number): Promise<void> {
  const p = player();
  if (!p) throw new Error("плеер Яндекс Музыки ещё не готов");
  const state = p.getState();
  const current = String(state.currentContext?.value?.data?.meta?.id ?? "");
  const list = entityIds(state);
  // id контекста не сравнивается: очередь обновляется на месте (updateQueue), и
  // контекст с прежней ревизией несёт уже новую очередь.
  const sameList =
    current.startsWith(OUR_CONTEXT_PREFIX) &&
    inListOrder(state) &&
    list.length === ids.length &&
    list.every((id, i) => id === ids[i]);

  if (sameList) {
    if ((state.queueState.index.value ?? -1) !== index) await asMod(() => p.setEntityByIndex(index));
  } else {
    await asMod(() => p.pause());
    await asMod(() =>
      p.setContext({
        contextData: { type: "various", meta: { id: contextId }, from: "ymsync" },
        entitiesData: unloaded(ids),
        queueParams: { index },
        loadContextMeta: false,
      }),
    );
  }
}

/**
 * Приводит то, что плеер сыграет дальше, к очереди комнаты — не трогая трек,
 * который играет сейчас.
 *
 * Волна дописывает в очередь комнаты новые треки каждые несколько песен.
 * Раньше плеер узнавал о них только на следующей смене трека, через
 * pause + setContext — это был обрыв на каждой подгрузке волны, а в конце
 * старого списка плеер и вовсе останавливался. Теперь хвост очереди меняется
 * на месте (inject/remove очереди Sonata), и плеер сам переходит на следующий
 * трек комнаты.
 *
 * Возвращает false, если плеер сейчас не на треке комнаты: тогда очередь
 * поставит загрузка трека.
 */
export function updateQueue(ids: string[], roomIndex: number): boolean {
  const p = player();
  if (!p || typeof p.inject !== "function" || typeof p.remove !== "function") return false;
  const state = p.getState();
  const context = String(state.currentContext?.value?.data?.meta?.id ?? "");
  if (!context.startsWith(OUR_CONTEXT_PREFIX) || !inListOrder(state)) return false;
  const list = entityIds(state);
  const at: number = state.queueState.index.value ?? -1;
  if (at < 0 || list[at] === undefined || list[at] !== ids[roomIndex]) return false;

  const ahead = list.slice(at + 1);
  const wanted = ids.slice(roomIndex + 1);
  if (ahead.length === wanted.length && ahead.every((id, i) => id === wanted[i])) return true;

  asMod(() => {
    if (ahead.every((id, i) => id === wanted[i])) {
      // Обычный случай — подгрузка волны: в конец добавились треки.
      p.inject({ entitiesData: unloaded(wanted.slice(ahead.length)), position: list.length });
      return;
    }
    if (ahead.length) {
      p.remove(ahead.map((_, i) => at + 1 + i));
    }
    if (wanted.length) p.inject({ entitiesData: unloaded(wanted), position: at + 1 });
  });
  return true;
}

/**
 * Ждёт, пока плеер действительно встанет на трек.
 *
 * setEntityByIndex и setContext завершаются раньше, чем плеер подменит
 * источник звука: ещё ~0,4 с он показывает новый id, но длительность и
 * воспроизведение старого трека. Указания ядра, выполненные в это окно,
 * доставались старому треку — короткий кусок не того трека и повтор начала
 * нового. Признак, что подмена прошла: длительность совпала с длительностью
 * трека из очереди комнаты (или звук ещё не загружался вовсе).
 */
export async function waitUntilOn(
  trackId: string,
  durationMs: number,
  timeoutMs = 5000,
  cancelled: () => boolean = () => false,
): Promise<boolean> {
  const started = performance.now();
  while (performance.now() - started < timeoutMs && !cancelled()) {
    const now = snapshot();
    // 0 — звук ещё не грузился (после setContext плеер ждёт play): старого трека,
    // которому могли бы достаться указания, тоже нет.
    const shown = now?.durationMs ?? 0;
    const durationMatches = durationMs <= 0 || shown === 0 || Math.abs(shown - durationMs) < 1500;
    if (now?.trackId === trackId && now.status !== "loadingMediaSource" && durationMatches) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

export async function play() {
  const p = player();
  if (!p) return;
  const status = String(p.getState().playerState.status.value);
  // После setContext плеер стоит, а не на паузе: resume тогда ничего не делает.
  if (status === "stopped" || status === "ended" || status === "idle") await asMod(() => p.play());
  else await asMod(() => p.resume());
}

export async function pause() {
  const p = player();
  if (p) await asMod(() => p.pause());
}

export async function seek(ms: number) {
  const p = player();
  if (p) await asMod(() => p.setProgress(Math.max(0, ms) / 1000));
}

/**
 * Скорость воспроизведения, 1 — обычная. Так ядро догоняет комнату без
 * перемотки: перемотка у потокового плеера — это перебуферизация, то есть
 * обрыв звука. Высота тона сохраняется (Chromium по умолчанию, плеер её не трогает).
 */
export async function setRate(rate: number) {
  const p = player();
  if (!p || !Number.isFinite(rate) || rate <= 0) return;
  await asMod(() => p.setSpeed(rate));
}
