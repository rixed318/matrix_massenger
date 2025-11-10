export const VIDEO_RECORDER_MIME_CANDIDATES = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4;codecs=h264,aac',
    'video/mp4',
];

export const pickSupportedVideoMimeType = (candidates: string[] = VIDEO_RECORDER_MIME_CANDIDATES): string | undefined => {
    if (typeof window === 'undefined' || typeof MediaRecorder === 'undefined') {
        return undefined;
    }
    for (const candidate of candidates) {
        if (MediaRecorder.isTypeSupported(candidate)) {
            return candidate;
        }
    }
    return undefined;
};

export interface VideoThumbnailOptions {
    captureTime?: number;
    thumbnailMimeType?: string;
    thumbnailQuality?: number;
    maxThumbnailEdge?: number;
}

export interface VideoMetadataResult {
    durationMs: number;
    width: number;
    height: number;
    thumbnailBlob: Blob;
    thumbnailWidth: number;
    thumbnailHeight: number;
    thumbnailMimeType: string;
}

export const readVideoMetadata = async (blob: Blob, options: VideoThumbnailOptions = {}): Promise<VideoMetadataResult> => {
    const videoUrl = URL.createObjectURL(blob);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.src = videoUrl;

    const captureTime = options.captureTime ?? 0.1;
    const thumbnailMimeType = options.thumbnailMimeType ?? 'image/jpeg';
    const thumbnailQuality = options.thumbnailQuality ?? 0.82;
    const maxThumbnailEdge = options.maxThumbnailEdge ?? 512;

    const cleanup = () => {
        URL.revokeObjectURL(videoUrl);
    };

    const waitForBlob = (canvas: HTMLCanvasElement): Promise<Blob> => new Promise((resolve, reject) => {
        canvas.toBlob(blobResult => {
            if (blobResult) {
                resolve(blobResult);
            } else {
                reject(new Error('Не удалось создать миниатюру видео'));
            }
        }, thumbnailMimeType, thumbnailQuality);
    });

    return await new Promise<VideoMetadataResult>((resolve, reject) => {
        const handleError = () => {
            cleanup();
            reject(new Error('Не удалось прочитать метаданные видео'));
        };

        const handleCapture = async () => {
            try {
                const width = video.videoWidth || 0;
                const height = video.videoHeight || 0;
                const duration = Number.isFinite(video.duration) ? video.duration : 0;
                const scale = width && height ? Math.min(1, maxThumbnailEdge / Math.max(width, height)) : 1;
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(width * scale) || width || 1);
                canvas.height = Math.max(1, Math.round(height * scale) || height || 1);
                const context = canvas.getContext('2d');
                if (!context) {
                    throw new Error('Canvas 2D контекст недоступен для миниатюры видео');
                }
                context.drawImage(video, 0, 0, canvas.width, canvas.height);
                const thumbnailBlob = await waitForBlob(canvas);
                cleanup();
                resolve({
                    durationMs: Math.round(duration * 1000),
                    width,
                    height,
                    thumbnailBlob,
                    thumbnailWidth: canvas.width,
                    thumbnailHeight: canvas.height,
                    thumbnailMimeType,
                });
            } catch (error) {
                cleanup();
                reject(error instanceof Error ? error : new Error(String(error ?? 'unknown')));
            }
        };

        const handleLoadedData = () => {
            const target = Math.max(0, Math.min(captureTime, Number.isFinite(video.duration) ? video.duration : captureTime));
            if (target > 0 && Number.isFinite(video.duration) && video.duration > 0) {
                const seekListener = () => {
                    video.removeEventListener('seeked', seekListener);
                    void handleCapture();
                };
                video.addEventListener('seeked', seekListener);
                try {
                    video.currentTime = target;
                } catch (e) {
                    video.removeEventListener('seeked', seekListener);
                    void handleCapture();
                }
            } else {
                void handleCapture();
            }
        };

        video.addEventListener('error', handleError, { once: true });
        video.addEventListener('loadeddata', handleLoadedData, { once: true });
    });
};
