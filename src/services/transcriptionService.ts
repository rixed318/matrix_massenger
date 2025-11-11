import { EventType, MsgType, RelationType } from 'matrix-js-sdk';
import type { MatrixClient } from '../types';
import type { MatrixEvent } from 'matrix-js-sdk/src/models/event';
import { applyTranscriptUpdate } from './mediaIndexService';

export type TranscriptStatus = 'pending' | 'completed' | 'error';

export interface TranscriptionSettings {
  enabled?: boolean;
  language?: string;
  maxDurationSec?: number;
  provider?: 'disabled' | 'local' | 'cloud';
  privacy?: 'local' | 'cloud';
  targetLanguage?: string;
}

export interface RuntimeTranscriptionConfig {
  enabled: boolean;
  provider: 'disabled' | 'local' | 'cloud';
  endpoint?: string;
  apiKey?: string;
  model?: string;
  defaultLanguage?: string;
  maxDurationSec?: number;
  retryLimit: number;
  liveChunkDurationMs?: number;
  defaultTargetLanguage?: string;
  privacy?: 'local' | 'cloud';
}

export interface MessageTranscript {
  status: TranscriptStatus;
  text?: string;
  language?: string;
  updatedAt?: number;
  error?: string;
  attempts?: number;
  eventId?: string;
  durationMs?: number;
}

export interface LiveTranscriptChunk {
  callId: string;
  chunkId: string;
  text: string;
  language?: string;
  timestamp: number;
  final: boolean;
  source: 'local' | 'remote';
  translatedText?: string;
  targetLanguage?: string;
}

export interface LiveTranscriptionSession {
  callId: string;
  stream: MediaStream;
  language?: string;
  lastSequence: number;
  recorder: MediaRecorder | null;
  listeners: Set<(chunk: LiveTranscriptChunk) => void>;
  pendingBlobs: Blob[];
  active: boolean;
}

export interface LiveTranscriptionOptions {
  language?: string;
  callId: string;
  chunkDurationMs?: number;
}

export interface CaptionTranslationContext {
  callId: string;
  text: string;
  sourceLanguage?: string;
  targetLanguage: string;
  signal?: AbortSignal;
}

export type CaptionTranslationProvider = (context: CaptionTranslationContext) => Promise<string | null | undefined>;

export interface TranslateCaptionOptions {
  providerPreference?: 'local' | 'cloud';
  signal?: AbortSignal;
}

const env = (typeof import.meta !== 'undefined' ? (import.meta as any).env : undefined) || (typeof process !== 'undefined' ? process.env : {});

const toBoolean = (value: unknown, fallback = false): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  }
  return fallback;
};

const toNumber = (value: unknown): number | undefined => {
  const num = typeof value === 'string' ? Number.parseFloat(value) : typeof value === 'number' ? value : Number.NaN;
  return Number.isFinite(num) ? num : undefined;
};

let runtimeConfig: RuntimeTranscriptionConfig = {
  enabled: toBoolean(env?.VITE_TRANSCRIPTION_ENABLED ?? env?.TRANSCRIPTION_ENABLED, false),
  provider: ((env?.VITE_TRANSCRIPTION_PROVIDER ?? env?.TRANSCRIPTION_PROVIDER) as string | undefined)?.toLowerCase() as RuntimeTranscriptionConfig['provider'] ?? 'disabled',
  endpoint: (env?.VITE_TRANSCRIPTION_ENDPOINT ?? env?.TRANSCRIPTION_ENDPOINT) as string | undefined,
  apiKey: (env?.VITE_TRANSCRIPTION_API_KEY ?? env?.TRANSCRIPTION_API_KEY) as string | undefined,
  model: (env?.VITE_TRANSCRIPTION_MODEL ?? env?.TRANSCRIPTION_MODEL) as string | undefined,
  defaultLanguage: (env?.VITE_TRANSCRIPTION_LANGUAGE ?? env?.TRANSCRIPTION_LANGUAGE) as string | undefined,
  maxDurationSec: toNumber(env?.VITE_TRANSCRIPTION_MAX_DURATION ?? env?.TRANSCRIPTION_MAX_DURATION),
  retryLimit: Math.max(1, Math.min(5, Number.parseInt((env?.VITE_TRANSCRIPTION_RETRY_LIMIT ?? env?.TRANSCRIPTION_RETRY_LIMIT) as string, 10) || 3)),
  liveChunkDurationMs: toNumber(env?.VITE_TRANSCRIPTION_LIVE_CHUNK_MS ?? env?.TRANSCRIPTION_LIVE_CHUNK_MS) ?? 5000,
  defaultTargetLanguage: (env?.VITE_TRANSCRIPTION_TARGET_LANGUAGE ?? env?.TRANSCRIPTION_TARGET_LANGUAGE) as string | undefined,
  privacy: ((env?.VITE_TRANSCRIPTION_PRIVACY ?? env?.TRANSCRIPTION_PRIVACY) as string | undefined)?.toLowerCase() === 'cloud'
    ? 'cloud'
    : 'local',
};

if (!['disabled', 'local', 'cloud'].includes(runtimeConfig.provider)) {
  runtimeConfig.provider = runtimeConfig.enabled ? 'local' : 'disabled';
}

export const TRANSCRIPT_RELATION_KEY = 'econix.transcript';
export const TRANSCRIPT_EVENT_FIELD = 'econix.transcript';

interface InternalJob {
  id: string;
  roomId: string;
  eventId?: string;
  localId?: string;
  msgType: MsgType.Audio | MsgType.Video;
  mimeType?: string;
  durationMs?: number;
  client: MatrixClient;
  file?: Blob;
  mxcUrl?: string;
  attempts: number;
  settings?: TranscriptionSettings | null;
  sentPending?: boolean;
  cachedBlob?: Blob;
  status: 'idle' | 'processing';
}

const jobs: InternalJob[] = [];
const jobsByLocal = new Map<string, InternalJob>();
const jobsByEvent = new Map<string, InternalJob>();
let processing = false;

const liveSessions = new Map<string, LiveTranscriptionSession>();
const liveListeners = new Map<string, Set<(chunk: LiveTranscriptChunk) => void>>();
interface LiveChunkHistory {
  order: string[];
  entries: Map<string, LiveTranscriptChunk>;
}
const liveChunkHistory = new Map<string, LiveChunkHistory>();
const LIVE_CHUNK_HISTORY_LIMIT = 200;
const translationCaches = new Map<string, Map<string, { value: string; updatedAt: number }>>();

const translationProviders: Record<'local' | 'cloud', CaptionTranslationProvider | null> = {
  local: null,
  cloud: null,
};

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

const RETRY_BASE_DELAY = 2000;
const RETRY_MAX_DELAY = 20000;

const normalizeText = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    return value.map(part => (typeof part === 'string' ? part : '')).join(' ').trim() || undefined;
  }
  if (value && typeof value === 'object') {
    const maybe = (value as Record<string, unknown>).text;
    if (typeof maybe === 'string') return maybe.trim();
  }
  return undefined;
};

const runtimeEnabled = () => runtimeConfig.enabled && runtimeConfig.provider !== 'disabled' && Boolean(runtimeConfig.endpoint);

const effectiveEnabled = (job: InternalJob): boolean => {
  if (!runtimeEnabled()) return false;
  if (job.settings && job.settings.enabled === false) return false;
  if (job.settings && job.settings.enabled === true) return true;
  return runtimeConfig.enabled;
};

const effectiveLanguage = (job: InternalJob): string | undefined => {
  return job.settings?.language || runtimeConfig.defaultLanguage;
};

const effectiveMaxDuration = (job: InternalJob): number | undefined => {
  return job.settings?.maxDurationSec ?? runtimeConfig.maxDurationSec;
};

const effectiveRetryLimit = (): number => {
  return Math.max(1, runtimeConfig.retryLimit);
};

const computeRetryDelay = (attempt: number) => Math.min(RETRY_MAX_DELAY, RETRY_BASE_DELAY * Math.max(1, attempt));

const getLiveListeners = (callId: string) => {
  let listeners = liveListeners.get(callId);
  if (!listeners) {
    listeners = new Set();
    liveListeners.set(callId, listeners);
  }
  return listeners;
};

const getLiveChunkHistory = (callId: string): LiveChunkHistory => {
  let history = liveChunkHistory.get(callId);
  if (!history) {
    history = { order: [], entries: new Map() };
    liveChunkHistory.set(callId, history);
  }
  return history;
};

const storeLiveChunk = (chunk: LiveTranscriptChunk): LiveTranscriptChunk => {
  const history = getLiveChunkHistory(chunk.callId);
  const stored: LiveTranscriptChunk = { ...chunk };
  if (!history.entries.has(stored.chunkId)) {
    history.order.push(stored.chunkId);
  }
  history.entries.set(stored.chunkId, stored);
  while (history.order.length > LIVE_CHUNK_HISTORY_LIMIT) {
    const expired = history.order.shift();
    if (expired) {
      history.entries.delete(expired);
    }
  }
  return stored;
};

const dispatchLiveChunk = (chunk: LiveTranscriptChunk) => {
  const stored = storeLiveChunk(chunk);
  const listeners = liveListeners.get(chunk.callId);
  if (!listeners || listeners.size === 0) return;
  listeners.forEach(listener => {
    try {
      listener({ ...stored });
    } catch (error) {
      console.warn('Live transcription listener failed', error);
    }
  });
};

const normalizeLanguage = (value?: string) => {
  if (!value || typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.toLowerCase();
};

const captionCacheKey = (text: string, targetLanguage: string, sourceLanguage?: string) =>
  `${normalizeLanguage(sourceLanguage) || 'auto'}:${normalizeLanguage(targetLanguage) || 'auto'}:${text}`;

const getTranslationCache = (callId: string) => {
  let cache = translationCaches.get(callId);
  if (!cache) {
    cache = new Map();
    translationCaches.set(callId, cache);
  }
  return cache;
};

const pruneTranslationCache = (callId: string, limit = 200) => {
  const cache = translationCaches.get(callId);
  if (!cache || cache.size <= limit) return;
  const sorted = Array.from(cache.entries()).sort((a, b) => a[1].updatedAt - b[1].updatedAt);
  while (sorted.length > limit) {
    const entry = sorted.shift();
    if (!entry) break;
    cache.delete(entry[0]);
  }
};

const ensurePendingEvent = async (job: InternalJob) => {
  if (!job.eventId || job.sentPending) return;
  const client = job.client;
  const language = effectiveLanguage(job);
  const content: any = {
    msgtype: 'm.text',
    body: '[transcription pending]',
    'm.relates_to': {
      rel_type: RelationType.Annotation,
      event_id: job.eventId,
      key: TRANSCRIPT_RELATION_KEY,
    },
    [TRANSCRIPT_EVENT_FIELD]: {
      status: 'pending',
      language,
      attempts: job.attempts,
      durationMs: job.durationMs,
      updatedAt: Date.now(),
    },
  };
  try {
    await client.sendEvent(job.roomId, EventType.RoomMessage, content);
    applyTranscriptUpdate(job.roomId, job.eventId, {
      status: 'pending',
      language,
      updatedAt: Date.now(),
      attempts: job.attempts,
      durationMs: job.durationMs,
    });
  } catch (error) {
    console.warn('Failed to send pending transcript event', error);
  }
  job.sentPending = true;
};

const sendTranscriptEvent = async (
  job: InternalJob,
  status: TranscriptStatus,
  data: { text?: string; error?: string },
) => {
  if (!job.eventId) return;
  const client = job.client;
  const language = effectiveLanguage(job);
  const content: any = {
    msgtype: 'm.text',
    body: status === 'completed' ? (data.text ?? '') : `[transcription ${status}]`,
    'm.relates_to': {
      rel_type: RelationType.Annotation,
      event_id: job.eventId,
      key: TRANSCRIPT_RELATION_KEY,
    },
    [TRANSCRIPT_EVENT_FIELD]: {
      status,
      text: status === 'completed' ? data.text : undefined,
      language,
      attempts: job.attempts,
      error: status === 'error' ? (data.error || 'Transcription failed') : undefined,
      updatedAt: Date.now(),
      durationMs: job.durationMs,
    },
  };
  try {
    await client.sendEvent(job.roomId, EventType.RoomMessage, content);
  } catch (error) {
    console.warn('Failed to send transcript event', error);
  }
  applyTranscriptUpdate(job.roomId, job.eventId, {
    status,
    text: status === 'completed' ? data.text : undefined,
    language,
    error: status === 'error' ? (data.error || 'Transcription failed') : undefined,
    updatedAt: Date.now(),
    attempts: job.attempts,
    durationMs: job.durationMs,
  });
};

const resolveEventContent = async (job: InternalJob): Promise<{ blob: Blob; mimeType: string; mxcUrl: string } | null> => {
  if (!job.eventId) return null;
  const room = job.client.getRoom(job.roomId);
  let event: MatrixEvent | null | undefined = room?.findEventById(job.eventId);
  if (!event) {
    try {
      const raw = await job.client.fetchRoomEvent(job.roomId, job.eventId);
      const mapper = job.client.getEventMapper();
      event = mapper(raw) as MatrixEvent;
    } catch (error) {
      console.warn('Failed to fetch room event for transcription', error);
      return null;
    }
  }
  if (!event) return null;
  const content: any = event.getContent?.() ?? {};
  const info = content.info || {};
  const url = content.file?.url || content.url;
  if (typeof url !== 'string') {
    console.warn('Transcription event missing MXC url');
    return null;
  }
  const mimeType = job.mimeType || info.mimetype || 'application/octet-stream';
  try {
    const response = await job.client.downloadContent(url);
    const data = (response as any)?.data ?? response;
    const arrayBuffer = data instanceof ArrayBuffer ? data : (data?.buffer ? data.buffer : undefined);
    if (arrayBuffer) {
      return { blob: new Blob([arrayBuffer], { type: mimeType }), mimeType, mxcUrl: url };
    }
    if (response instanceof Blob) {
      return { blob: response, mimeType, mxcUrl: url };
    }
    if (data?.arrayBuffer) {
      const buf = await data.arrayBuffer();
      return { blob: new Blob([buf], { type: mimeType }), mimeType, mxcUrl: url };
    }
  } catch (error) {
    console.warn('Failed to download content for transcription', error);
  }
  return null;
};

const buildFormData = (blob: Blob, job?: InternalJob, language?: string) => {
  const form = new FormData();
  const fileName = job?.msgType === MsgType.Video
    ? 'video-message.webm'
    : job?.msgType === MsgType.Audio
      ? 'audio-message.ogg'
      : 'audio-stream.webm';
  form.append('file', blob, fileName);
  const lang = normalizeLanguage(language ?? (job ? effectiveLanguage(job) : runtimeConfig.defaultLanguage));
  if (lang) form.append('language', lang);
  if (runtimeConfig.model) form.append('model', runtimeConfig.model);
  form.append('response_format', 'json');
  return form;
};

const performBlobTranscription = async (blob: Blob, job?: InternalJob, language?: string): Promise<string> => {
  if (!runtimeConfig.endpoint) {
    throw new Error('Transcription endpoint is not configured');
  }
  const form = buildFormData(blob, job, language);

  const headers: Record<string, string> = {};
  if (runtimeConfig.apiKey) {
    headers.Authorization = `Bearer ${runtimeConfig.apiKey}`;
  }

  const response = await fetch(runtimeConfig.endpoint, {
    method: 'POST',
    body: form,
    headers,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Transcription failed (${response.status}): ${text || response.statusText}`);
  }
  let payload: any = null;
  try {
    payload = await response.json();
  } catch (error) {
    throw new Error('Transcription response was not valid JSON');
  }
  const text = normalizeText(payload?.text ?? payload?.segments);
  if (!text) {
    throw new Error('Transcription response did not include text');
  }
  return text;
};

const performTranscription = async (job: InternalJob, blob: Blob): Promise<string> => {
  if (!runtimeConfig.endpoint) {
    throw new Error('Transcription endpoint is not configured');
  }
  return performBlobTranscription(blob, job, effectiveLanguage(job));
};

const runJob = async (job: InternalJob) => {
  if (!effectiveEnabled(job)) {
    return;
  }
  const maxDuration = effectiveMaxDuration(job);
  if (typeof maxDuration === 'number' && typeof job.durationMs === 'number' && job.durationMs > maxDuration * 1000) {
    throw new Error('Duration exceeds configured limit');
  }
  if (!job.cachedBlob) {
    if (job.file) {
      job.cachedBlob = job.file;
    } else {
      const resolved = await resolveEventContent(job);
      if (!resolved) throw new Error('Unable to download media for transcription');
      job.cachedBlob = resolved.blob;
      job.mimeType = resolved.mimeType;
      job.mxcUrl = resolved.mxcUrl;
    }
  }
  if (!job.cachedBlob) {
    throw new Error('No media available for transcription');
  }
  const text = await performTranscription(job, job.cachedBlob);
  await sendTranscriptEvent(job, 'completed', { text });
};

const removeJob = (job: InternalJob) => {
  const idx = jobs.indexOf(job);
  if (idx >= 0) jobs.splice(idx, 1);
  if (job.localId) jobsByLocal.delete(job.localId);
  if (job.eventId) jobsByEvent.delete(job.eventId);
};

const processQueue = async () => {
  if (processing) return;
  processing = true;
  try {
    while (true) {
      const next = jobs.find(j => j.eventId && j.status === 'idle');
      if (!next) break;
      next.status = 'processing';
      try {
        await ensurePendingEvent(next);
        await runJob(next);
        removeJob(next);
      } catch (error) {
        next.attempts += 1;
        next.status = 'idle';
        const limit = effectiveRetryLimit();
        if (next.attempts >= limit) {
          console.warn('Transcription job reached retry limit', error);
          await sendTranscriptEvent(next, 'error', { error: error instanceof Error ? error.message : String(error) });
          removeJob(next);
        } else {
          const delayMs = computeRetryDelay(next.attempts);
          await delay(delayMs);
        }
      }
    }
  } finally {
    processing = false;
  }
};

export interface TranscriptionJobInput {
  client: MatrixClient;
  roomId: string;
  eventId?: string;
  localId?: string;
  msgType: MsgType.Audio | MsgType.Video;
  mimeType?: string;
  durationMs?: number;
  file?: Blob;
  mxcUrl?: string;
  settings?: TranscriptionSettings | null;
}

export const enqueueTranscriptionJob = (input: TranscriptionJobInput) => {
  const job: InternalJob = {
    id: input.eventId || input.localId || Math.random().toString(36).slice(2),
    roomId: input.roomId,
    eventId: input.eventId,
    localId: input.localId,
    msgType: input.msgType,
    mimeType: input.mimeType,
    durationMs: input.durationMs,
    client: input.client,
    file: input.file,
    mxcUrl: input.mxcUrl,
    attempts: 0,
    settings: input.settings,
    status: 'idle',
  };
  if (job.localId) {
    jobsByLocal.set(job.localId, job);
  }
  if (job.eventId) {
    jobsByEvent.set(job.eventId, job);
  }
  jobs.push(job);
  if (job.eventId) {
    void ensurePendingEvent(job).finally(() => processQueue());
  }
};

export const confirmTranscriptionJob = (localId: string, params: { eventId: string; client: MatrixClient; roomId: string; content?: any }) => {
  const job = jobsByLocal.get(localId);
  if (!job) return;
  job.eventId = params.eventId;
  job.client = params.client;
  job.roomId = params.roomId;
  job.status = 'idle';
  if (params.content) {
    const info = params.content?.info;
    const url = params.content?.file?.url || params.content?.url;
    if (typeof url === 'string') {
      job.mxcUrl = url;
    }
    if (!job.mimeType && info?.mimetype) {
      job.mimeType = info.mimetype;
    }
  }
  jobsByEvent.set(params.eventId, job);
  void ensurePendingEvent(job).finally(() => processQueue());
};

export const cancelTranscriptionJob = (localId: string | undefined, eventId?: string) => {
  let job: InternalJob | undefined;
  if (localId) {
    job = jobsByLocal.get(localId);
  }
  if (!job && eventId) {
    job = jobsByEvent.get(eventId);
  }
  if (!job) return;
  removeJob(job);
};

export const updateRuntimeTranscriptionConfig = (config: Partial<RuntimeTranscriptionConfig>) => {
  runtimeConfig = { ...runtimeConfig, ...config };
};

export const getTranscriptionRuntimeConfig = (): RuntimeTranscriptionConfig => ({ ...runtimeConfig });

export const registerCaptionTranslationProvider = (
  type: 'local' | 'cloud',
  provider: CaptionTranslationProvider | null,
) => {
  translationProviders[type] = provider ?? null;
};

const resolveTranslationProvider = (preferred?: 'local' | 'cloud'): CaptionTranslationProvider | null => {
  if (preferred && translationProviders[preferred]) {
    return translationProviders[preferred];
  }
  if (runtimeConfig.provider !== 'disabled') {
    const candidate = translationProviders[runtimeConfig.provider];
    if (candidate) return candidate;
  }
  return translationProviders.cloud ?? translationProviders.local ?? null;
};

export const translateCaption = async (
  callId: string,
  text: string,
  targetLanguage: string,
  sourceLanguage?: string,
  options?: TranslateCaptionOptions,
): Promise<string | null> => {
  const normalizedTarget = normalizeLanguage(targetLanguage);
  const normalizedSource = normalizeLanguage(sourceLanguage);
  if (!callId || !text || !normalizedTarget) return null;
  const key = captionCacheKey(text, normalizedTarget, normalizedSource);
  const cache = getTranslationCache(callId);
  const cached = cache.get(key);
  if (cached) {
    return cached.value;
  }
  const provider = resolveTranslationProvider(options?.providerPreference);
  if (!provider) {
    return null;
  }
  try {
    const result = await provider({
      callId,
      text,
      sourceLanguage: normalizedSource,
      targetLanguage: normalizedTarget,
      signal: options?.signal,
    });
    if (typeof result === 'string' && result.trim().length) {
      cache.set(key, { value: result, updatedAt: Date.now() });
      pruneTranslationCache(callId);
      return result;
    }
  } catch (error) {
    console.warn('Caption translation provider failed', error);
  }
  return null;
};

export const clearCaptionTranslationCache = (callId?: string) => {
  if (callId) {
    translationCaches.delete(callId);
    return;
  }
  translationCaches.clear();
};

export const pickLatestTranscript = (relations: MatrixEvent[] | undefined): MessageTranscript | null => {
  if (!relations || !relations.length) return null;
  const relevant = relations.filter(ev => {
    const rel = ev.getRelation?.();
    return rel?.key === TRANSCRIPT_RELATION_KEY;
  });
  if (!relevant.length) return null;
  const sorted = relevant.sort((a, b) => (a.getTs?.() || 0) - (b.getTs?.() || 0));
  const latest = sorted[sorted.length - 1];
  const content: any = latest.getContent?.() ?? {};
  const meta: any = content?.[TRANSCRIPT_EVENT_FIELD] ?? {};
  const status: TranscriptStatus = typeof meta.status === 'string' && ['pending', 'completed', 'error'].includes(meta.status)
    ? meta.status as TranscriptStatus
    : 'completed';
  const text = typeof meta.text === 'string' ? meta.text : (typeof content.body === 'string' ? content.body : undefined);
  const transcript: MessageTranscript = {
    status,
    text: status === 'completed' ? text : undefined,
    language: typeof meta.language === 'string' ? meta.language : undefined,
    updatedAt: typeof meta.updatedAt === 'number' ? meta.updatedAt : latest.getTs?.(),
    error: typeof meta.error === 'string' ? meta.error : undefined,
    attempts: typeof meta.attempts === 'number' ? meta.attempts : undefined,
    eventId: latest.getId?.() ?? undefined,
    durationMs: typeof meta.durationMs === 'number' ? meta.durationMs : undefined,
  };
  if (status === 'error' && !transcript.error && typeof content.body === 'string') {
    transcript.error = content.body;
  }
  return transcript;
};

export const __resetTranscriptionQueueForTests = () => {
  jobs.length = 0;
  jobsByLocal.clear();
  jobsByEvent.clear();
  processing = false;
  liveSessions.forEach(session => {
    try {
      session.recorder?.stop();
    } catch (_) {
      /* noop */
    }
  });
  liveSessions.clear();
  liveListeners.clear();
  liveChunkHistory.clear();
  translationCaches.clear();
};

export const __waitForTranscriptionIdle = async () => {
  while (processing || jobs.some(job => job.status !== 'idle')) {
    await delay(5);
  }
};

const handleLiveBlob = (session: LiveTranscriptionSession, blob: Blob) => {
  if (!session.active || !blob || blob.size === 0) return;
  const sequence = session.lastSequence + 1;
  session.lastSequence = sequence;
  const chunkId = `${session.callId}:${sequence}`;
  const timestamp = Date.now();
  const base: LiveTranscriptChunk = {
    callId: session.callId,
    chunkId,
    text: '',
    language: session.language,
    timestamp,
    final: false,
    source: 'local',
  };
  dispatchLiveChunk(base);
  session.pendingBlobs.push(blob);
  void performBlobTranscription(blob, undefined, session.language)
    .then(text => {
      const chunk: LiveTranscriptChunk = {
        ...base,
        text,
        final: true,
      };
      dispatchLiveChunk(chunk);
    })
    .catch(error => {
      const chunk: LiveTranscriptChunk = {
        ...base,
        text: `[transcription error] ${(error instanceof Error ? error.message : String(error))}`,
        final: true,
      };
      dispatchLiveChunk(chunk);
    });
};

const stopLiveRecorder = (session: LiveTranscriptionSession) => {
  try {
    session.recorder?.stop();
  } catch (error) {
    console.warn('Failed to stop live transcription recorder', error);
  }
  session.recorder = null;
  session.active = false;
};

export const startLiveTranscriptionSession = (
  stream: MediaStream,
  options: LiveTranscriptionOptions,
): LiveTranscriptionSession | null => {
  if (!stream) {
    return null;
  }
  const callId = options.callId;
  if (!callId) {
    throw new Error('callId is required for live transcription');
  }
  if (!runtimeEnabled()) {
    console.warn('Live transcription is disabled by runtime configuration');
    return null;
  }
  const existing = liveSessions.get(callId);
  if (existing) {
    return existing;
  }
  if (typeof MediaRecorder === 'undefined') {
    console.warn('MediaRecorder API is not available for live transcription');
    return null;
  }
  const session: LiveTranscriptionSession = {
    callId,
    stream,
    language: normalizeLanguage(options.language ?? runtimeConfig.defaultLanguage),
    lastSequence: 0,
    recorder: null,
    listeners: getLiveListeners(callId),
    pendingBlobs: [],
    active: false,
  };
  try {
    const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    recorder.ondataavailable = event => {
      const data = event.data as Blob;
      handleLiveBlob(session, data);
    };
    recorder.onerror = event => {
      console.warn('Live transcription recorder error', event);
      stopLiveRecorder(session);
    };
    const chunkDuration = Math.max(1000, options.chunkDurationMs ?? runtimeConfig.liveChunkDurationMs ?? 5000);
    recorder.start(chunkDuration);
    session.recorder = recorder;
    session.active = true;
  } catch (error) {
    console.warn('Failed to start live transcription', error);
    return null;
  }
  liveSessions.set(callId, session);
  return session;
};

export const stopLiveTranscriptionSession = (callId: string) => {
  const session = liveSessions.get(callId);
  if (!session) return;
  stopLiveRecorder(session);
  liveSessions.delete(callId);
  liveListeners.delete(callId);
  liveChunkHistory.delete(callId);
  translationCaches.delete(callId);
};

export const subscribeLiveTranscription = (
  callId: string,
  listener: (chunk: LiveTranscriptChunk) => void,
): (() => void) => {
  if (!callId || !listener) {
    return () => undefined;
  }
  const listeners = getLiveListeners(callId);
  listeners.add(listener);
  const history = liveChunkHistory.get(callId);
  if (history) {
    history.order.forEach(chunkId => {
      const stored = history.entries.get(chunkId);
      if (stored) {
        try {
          listener({ ...stored });
        } catch (error) {
          console.warn('Live transcription history listener failed', error);
        }
      }
    });
  }
  return () => {
    const target = liveListeners.get(callId);
    target?.delete(listener);
  };
};

export const emitRemoteLiveTranscriptionChunk = (chunk: LiveTranscriptChunk) => {
  if (!chunk?.callId || !chunk.chunkId) {
    return;
  }
  dispatchLiveChunk({
    ...chunk,
    source: chunk.source ?? 'remote',
  });
};

export const getLiveTranscriptionSession = (callId: string): LiveTranscriptionSession | null => {
  return liveSessions.get(callId) ?? null;
};
