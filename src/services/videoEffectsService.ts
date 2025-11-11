import { secureSecretsStore } from './secureSecretsStore';

export type VideoEffectType = 'none' | 'blur' | 'background' | 'noise-suppression';

export interface VideoEffectSetting {
    id: string;
    type: Exclude<VideoEffectType, 'noise-suppression'>;
    intensity?: number;
    assetUrl?: string | null;
    enabled: boolean;
}

export interface AudioEffectSetting {
    id: string;
    type: Extract<VideoEffectType, 'noise-suppression'>;
    intensity?: number;
    enabled: boolean;
}

export interface VideoEffectsConfiguration {
    video: VideoEffectSetting[];
    audio: AudioEffectSetting[];
}

export interface VideoEffectsPreset extends VideoEffectsConfiguration {
    id: string;
    label: string;
    updatedAt: number;
}

export interface MediaEffectsController {
    readonly id: string;
    readonly stream: MediaStream;
    readonly isFallback: boolean;
    update(config: Partial<VideoEffectsConfiguration>): void;
    dispose(): void;
}

const DEFAULT_CONFIG: VideoEffectsConfiguration = {
    video: [],
    audio: [],
};

const PRESET_STORAGE_KEY = 'matrix-messenger::video-effects-presets';

let controllerId = 0;

const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';

interface VideoEffectAdapter {
    readonly id: string;
    apply(context: CanvasRenderingContext2D, canvas: HTMLCanvasElement, video: HTMLVideoElement): void;
    dispose?(): void;
}

class BlurEffectAdapter implements VideoEffectAdapter {
    readonly id: string;
    private readonly radius: number;

    constructor(setting: VideoEffectSetting) {
        this.id = setting.id;
        this.radius = typeof setting.intensity === 'number' ? Math.max(0, setting.intensity) : 6;
    }

    apply(context: CanvasRenderingContext2D, canvas: HTMLCanvasElement, video: HTMLVideoElement) {
        context.save();
        context.filter = `blur(${this.radius}px)`;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        context.restore();
    }
}

class BackgroundReplaceEffectAdapter implements VideoEffectAdapter {
    readonly id: string;
    private readonly assetUrl: string | null;
    private readonly intensity: number;
    private backgroundImage: HTMLImageElement | null = null;

    constructor(setting: VideoEffectSetting) {
        this.id = setting.id;
        this.assetUrl = setting.assetUrl ?? null;
        this.intensity = typeof setting.intensity === 'number' ? Math.min(Math.max(setting.intensity, 0), 1) : 1;
        if (this.assetUrl && isBrowser) {
            const image = new Image();
            image.crossOrigin = 'anonymous';
            image.src = this.assetUrl;
            image.onload = () => {
                this.backgroundImage = image;
            };
            image.onerror = () => {
                this.backgroundImage = null;
            };
        }
    }

    apply(context: CanvasRenderingContext2D, canvas: HTMLCanvasElement, video: HTMLVideoElement) {
        if (this.backgroundImage) {
            context.drawImage(this.backgroundImage, 0, 0, canvas.width, canvas.height);
        } else {
            const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
            gradient.addColorStop(0, 'rgba(28, 32, 52, 0.9)');
            gradient.addColorStop(1, 'rgba(60, 17, 90, 0.9)');
            context.fillStyle = gradient;
            context.fillRect(0, 0, canvas.width, canvas.height);
        }
        context.globalAlpha = this.intensity;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        context.globalAlpha = 1;
    }

    dispose() {
        this.backgroundImage = null;
    }
}

class CompositeEffectAdapter implements VideoEffectAdapter {
    readonly id: string;
    private readonly adapters: VideoEffectAdapter[];

    constructor(setting: VideoEffectSetting) {
        this.id = setting.id;
        this.adapters = [];
        if (setting.type === 'blur') {
            this.adapters.push(new BlurEffectAdapter(setting));
        } else if (setting.type === 'background') {
            this.adapters.push(new BackgroundReplaceEffectAdapter(setting));
        }
    }

    apply(context: CanvasRenderingContext2D, canvas: HTMLCanvasElement, video: HTMLVideoElement) {
        if (this.adapters.length === 0) {
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            return;
        }
        this.adapters.forEach(adapter => adapter.apply(context, canvas, video));
    }

    dispose() {
        this.adapters.forEach(adapter => adapter.dispose?.());
    }
}

class AudioNoiseSuppressionAdapter {
    readonly id: string;
    private readonly intensity: number;
    private audioContext: AudioContext | null = null;
    private sourceNode: MediaStreamAudioSourceNode | null = null;
    private destinationNode: MediaStreamAudioDestinationNode | null = null;
    private filterNode: BiquadFilterNode | null = null;
    private analyser: DynamicsCompressorNode | null = null;

    constructor(setting: AudioEffectSetting) {
        this.id = setting.id;
        this.intensity = typeof setting.intensity === 'number' ? Math.min(Math.max(setting.intensity, 0), 1) : 0.7;
    }

    async initialise(stream: MediaStream): Promise<MediaStream | null> {
        if (typeof window === 'undefined' || typeof AudioContext === 'undefined') {
            return null;
        }
        if (!stream.getAudioTracks().length) {
            return null;
        }
        this.audioContext = new AudioContext();
        this.sourceNode = this.audioContext.createMediaStreamSource(stream);
        this.destinationNode = this.audioContext.createMediaStreamDestination();
        this.filterNode = this.audioContext.createBiquadFilter();
        this.filterNode.type = 'lowpass';
        const baseFrequency = 4000;
        this.filterNode.frequency.value = baseFrequency - this.intensity * 2000;
        this.analyser = this.audioContext.createDynamicsCompressor();
        this.analyser.threshold.value = -30 * this.intensity;
        this.analyser.knee.value = 30;
        this.analyser.ratio.value = 12;
        this.analyser.attack.value = 0.003;
        this.analyser.release.value = 0.25;
        this.sourceNode.connect(this.filterNode);
        this.filterNode.connect(this.analyser);
        this.analyser.connect(this.destinationNode);
        return this.destinationNode.stream;
    }

    dispose() {
        try {
            this.sourceNode?.disconnect();
            this.filterNode?.disconnect();
            this.analyser?.disconnect();
        } catch (error) {
            console.warn('AudioNoiseSuppressionAdapter dispose failed', error);
        }
        if (this.audioContext?.state !== 'closed') {
            void this.audioContext?.close().catch(() => undefined);
        }
        this.audioContext = null;
        this.sourceNode = null;
        this.destinationNode = null;
        this.filterNode = null;
        this.analyser = null;
    }
}

class CanvasMediaEffectsController implements MediaEffectsController {
    readonly id: string;
    readonly stream: MediaStream;
    readonly isFallback: boolean;
    private readonly originalStream: MediaStream;
    private readonly videoTrack: MediaStreamTrack | null;
    private readonly canvas: HTMLCanvasElement | null;
    private readonly context: CanvasRenderingContext2D | null;
    private readonly videoElement: HTMLVideoElement | null;
    private readonly adapters: VideoEffectAdapter[] = [];
    private audioAdapter: AudioNoiseSuppressionAdapter | null;
    private currentConfig: VideoEffectsConfiguration;
    private rafHandle: number | null = null;
    private disposed = false;

    constructor(stream: MediaStream, config: VideoEffectsConfiguration, canvas: HTMLCanvasElement | null) {
        this.id = `effects-${++controllerId}`;
        this.originalStream = stream;
        this.videoTrack = stream.getVideoTracks()[0] ?? null;
        this.canvas = canvas;
        this.context = canvas ? canvas.getContext('2d') : null;
        this.videoElement = isBrowser && this.videoTrack ? document.createElement('video') : null;
        this.isFallback = !this.canvas || !this.context || !this.videoElement;
        this.currentConfig = {
            video: [...config.video],
            audio: [...config.audio],
        };
        this.stream = this.isFallback ? stream : this.createOutputStream(stream, config);
        this.audioAdapter = config.audio.find(effect => effect.enabled && effect.type === 'noise-suppression')
            ? new AudioNoiseSuppressionAdapter(config.audio.find(effect => effect.enabled) as AudioEffectSetting)
            : null;
        if (!this.isFallback && this.videoElement && this.videoTrack) {
            this.bootstrapVideoElement(config);
        }
        if (this.audioAdapter && !this.isFallback) {
            void this.applyAudioEffect();
        }
    }

    private createOutputStream(stream: MediaStream, config: VideoEffectsConfiguration): MediaStream {
        if (!this.canvas) return stream;
        const capture = typeof this.canvas.captureStream === 'function' ? this.canvas.captureStream() : null;
        if (!capture) {
            return stream;
        }
        stream.getAudioTracks().forEach(track => {
            capture.addTrack(track);
        });
        this.updateAdapters(config.video);
        return capture;
    }

    private bootstrapVideoElement(config: VideoEffectsConfiguration) {
        if (!this.videoElement || !this.canvas || !this.context || !this.videoTrack) {
            return;
        }
        this.videoElement.srcObject = new MediaStream([this.videoTrack]);
        this.videoElement.muted = true;
        this.videoElement.playsInline = true;
        const settings = this.videoTrack.getSettings();
        this.canvas.width = settings.width ?? 1280;
        this.canvas.height = settings.height ?? 720;
        const pump = () => {
            if (this.disposed || !this.canvas || !this.context || !this.videoElement) return;
            this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
            if (this.adapters.length === 0) {
                this.context.drawImage(this.videoElement, 0, 0, this.canvas.width, this.canvas.height);
            } else {
                this.adapters.forEach(adapter => adapter.apply(this.context!, this.canvas!, this.videoElement!));
            }
            const element = this.videoElement as any;
            if (element && typeof element.requestVideoFrameCallback === 'function') {
                element.requestVideoFrameCallback(() => pump());
            } else {
                this.rafHandle = window.requestAnimationFrame(pump);
            }
        };
        const startPlayback = async () => {
            try {
                await this.videoElement!.play();
                pump();
            } catch (error) {
                console.warn('Failed to start preview playback', error);
            }
        };
        if (this.videoElement.readyState >= 2) {
            void startPlayback();
        } else {
            this.videoElement.addEventListener('loadeddata', () => void startPlayback(), { once: true });
        }
    }

    private async applyAudioEffect() {
        if (!this.audioAdapter) return;
        const processed = await this.audioAdapter.initialise(this.originalStream);
        if (!processed) return;
        const [track] = processed.getAudioTracks();
        if (!track) return;
        this.stream.getAudioTracks().forEach(existing => {
            this.stream.removeTrack(existing);
        });
        this.stream.addTrack(track);
    }

    private updateAdapters(settings: VideoEffectSetting[]) {
        this.adapters.forEach(adapter => adapter.dispose?.());
        this.adapters.length = 0;
        settings.filter(setting => setting.enabled).forEach(setting => {
            this.adapters.push(new CompositeEffectAdapter(setting));
        });
    }

    update(config: Partial<VideoEffectsConfiguration>): void {
        if (this.isFallback) return;
        const nextConfig: VideoEffectsConfiguration = {
            video: config.video ? [...config.video] : [...this.currentConfig.video],
            audio: config.audio ? [...config.audio] : [...this.currentConfig.audio],
        };
        this.currentConfig = nextConfig;
        this.updateAdapters(nextConfig.video);
        const audioSetting = nextConfig.audio.find(effect => effect.enabled && effect.type === 'noise-suppression');
        if (!audioSetting) {
            this.audioAdapter?.dispose();
            this.audioAdapter = null;
            this.stream.getAudioTracks().forEach(track => {
                this.stream.removeTrack(track);
            });
            this.originalStream.getAudioTracks().forEach(track => {
                if (!this.stream.getAudioTracks().includes(track)) {
                    this.stream.addTrack(track);
                }
            });
            return;
        }
        this.audioAdapter?.dispose();
        this.audioAdapter = new AudioNoiseSuppressionAdapter(audioSetting);
        void this.applyAudioEffect();
    }

    dispose(): void {
        this.disposed = true;
        if (this.rafHandle) {
            window.cancelAnimationFrame(this.rafHandle);
            this.rafHandle = null;
        }
        this.adapters.forEach(adapter => adapter.dispose?.());
        if (this.videoElement) {
            this.videoElement.pause();
            this.videoElement.srcObject = null;
        }
        if (!this.isFallback) {
            this.stream.getTracks().forEach(track => {
                if (this.originalStream.getTracks().includes(track)) return;
                track.stop();
            });
        }
        this.audioAdapter?.dispose();
    }
}

const createCanvas = (): HTMLCanvasElement | null => {
    if (!isBrowser) return null;
    try {
        return document.createElement('canvas');
    } catch (error) {
        console.warn('Canvas creation failed', error);
        return null;
    }
};

const createController = (stream: MediaStream, config: VideoEffectsConfiguration): MediaEffectsController => {
    const canvas = createCanvas();
    return new CanvasMediaEffectsController(stream, config, canvas);
};

const loadFromSecureStore = async (): Promise<VideoEffectsPreset[]> => {
    try {
        const raw = await secureSecretsStore.get(PRESET_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw) as VideoEffectsPreset[];
        return parsed.map(preset => ({ ...DEFAULT_CONFIG, ...preset }));
    } catch (error) {
        console.warn('Failed to load video effect presets', error);
        return [];
    }
};

const saveToSecureStore = async (presets: VideoEffectsPreset[]): Promise<void> => {
    try {
        await secureSecretsStore.set(PRESET_STORAGE_KEY, JSON.stringify(presets));
    } catch (error) {
        console.warn('Failed to persist video effect presets', error);
    }
};

export const videoEffectsService = {
    async create(stream: MediaStream, config?: Partial<VideoEffectsConfiguration>): Promise<MediaEffectsController> {
        const merged: VideoEffectsConfiguration = {
            video: config?.video ?? DEFAULT_CONFIG.video,
            audio: config?.audio ?? DEFAULT_CONFIG.audio,
        };
        return createController(stream, merged);
    },

    async loadPresets(): Promise<VideoEffectsPreset[]> {
        const presets = await loadFromSecureStore();
        if (presets.length) {
            return presets;
        }
        return [
            {
                id: 'preset-blur',
                label: 'Размытие',
                video: [
                    {
                        id: 'blur-default',
                        type: 'blur',
                        intensity: 8,
                        enabled: true,
                    },
                ],
                audio: [],
                updatedAt: Date.now(),
            },
            {
                id: 'preset-studio',
                label: 'Студия',
                video: [
                    {
                        id: 'background-gradient',
                        type: 'background',
                        assetUrl: null,
                        intensity: 0.9,
                        enabled: true,
                    },
                    {
                        id: 'blur-soft',
                        type: 'blur',
                        intensity: 4,
                        enabled: true,
                    },
                ],
                audio: [
                    {
                        id: 'noise-soft',
                        type: 'noise-suppression',
                        intensity: 0.5,
                        enabled: true,
                    },
                ],
                updatedAt: Date.now(),
            },
        ];
    },

    async savePreset(preset: VideoEffectsPreset): Promise<void> {
        const presets = await loadFromSecureStore();
        const idx = presets.findIndex(item => item.id === preset.id);
        if (idx >= 0) {
            presets[idx] = { ...preset, updatedAt: Date.now() };
        } else {
            presets.push({ ...preset, updatedAt: Date.now() });
        }
        await saveToSecureStore(presets);
    },

    async deletePreset(id: string): Promise<void> {
        const presets = await loadFromSecureStore();
        const next = presets.filter(preset => preset.id !== id);
        await saveToSecureStore(next);
    },

    getDefaultConfiguration(): VideoEffectsConfiguration {
        return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    },
};

export type VideoEffectsService = typeof videoEffectsService;
