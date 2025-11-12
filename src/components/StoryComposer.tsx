import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { MatrixClient, Story } from '@matrix-messenger/core';
import { publishStory, type StoryMediaKind } from '../services/matrixService';
import { readVideoMetadata } from '../utils/media';

export interface StoryComposerDraftMedia {
    file: File;
    kind: StoryMediaKind;
    previewUrl: string;
    mimeType?: string;
    size: number;
    width?: number;
    height?: number;
    durationMs?: number;
    thumbnail?: {
        blob: Blob;
        width: number;
        height: number;
        mimeType: string;
    } | null;
}

export interface StoryComposerDraft {
    caption: string;
    media: StoryComposerDraftMedia | null;
}

interface StoryComposerProps {
    client: MatrixClient;
    isOpen: boolean;
    draft: StoryComposerDraft | null;
    onDraftChange: (draft: StoryComposerDraft | null) => void;
    onClose: () => void;
    onPublished?: (story: Story) => void;
}

const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif'];
const SUPPORTED_VIDEO_PREFIX = 'video/';

const resolveMxcUrl = (uploadResult: any): string => {
    if (!uploadResult) {
        throw new Error('Пустой ответ загрузки');
    }
    return (
        uploadResult.content_uri
        || uploadResult.mxc_url
        || uploadResult.uri
        || uploadResult.url
    );
};

const readImageDimensions = async (file: File): Promise<{ width?: number; height?: number }> => {
    try {
        const objectUrl = URL.createObjectURL(file);
        const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
            const image = new Image();
            image.onload = () => {
                URL.revokeObjectURL(objectUrl);
                resolve({ width: image.naturalWidth, height: image.naturalHeight });
            };
            image.onerror = () => {
                URL.revokeObjectURL(objectUrl);
                reject(new Error('Не удалось прочитать изображение'));
            };
            image.src = objectUrl;
        });
        return dimensions;
    } catch {
        return { width: undefined, height: undefined };
    }
};

const StoryComposer: React.FC<StoryComposerProps> = ({
    client,
    isOpen,
    draft,
    onDraftChange,
    onClose,
    onPublished,
}) => {
    const [caption, setCaption] = useState('');
    const [media, setMedia] = useState<StoryComposerDraftMedia | null>(null);
    const [isPublishing, setIsPublishing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!isOpen) {
            return;
        }
        setCaption(draft?.caption ?? '');
        setMedia(draft?.media ?? null);
    }, [draft, isOpen]);

    const handleDraftChange = useCallback((next: StoryComposerDraft | null) => {
        onDraftChange(next);
    }, [onDraftChange]);

    const handleCaptionChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
        const value = event.target.value;
        setCaption(value);
        handleDraftChange({ caption: value, media });
    }, [handleDraftChange, media]);

    const handlePickMedia = useCallback(() => {
        fileInputRef.current?.click();
    }, []);

    const handleMediaSelected = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) {
            return;
        }
        const mimeType = file.type || undefined;
        const isImage = mimeType ? SUPPORTED_IMAGE_TYPES.includes(mimeType) || mimeType.startsWith('image/') : file.name.match(/\.(png|jpe?g|gif|webp|heic|heif)$/i);
        const isVideo = mimeType ? mimeType.startsWith(SUPPORTED_VIDEO_PREFIX) : file.name.match(/\.(mp4|mov|mkv|webm)$/i);
        if (!isImage && !isVideo) {
            setError('Поддерживаются только изображения и видео.');
            return;
        }
        setError(null);
        let nextMedia: StoryComposerDraftMedia | null = null;
        const previewUrl = URL.createObjectURL(file);
        if (isImage) {
            const dimensions = await readImageDimensions(file);
            nextMedia = {
                file,
                kind: 'image',
                previewUrl,
                mimeType,
                size: file.size,
                width: dimensions.width,
                height: dimensions.height,
                thumbnail: null,
            };
        } else {
            try {
                const metadata = await readVideoMetadata(file);
                nextMedia = {
                    file,
                    kind: 'video',
                    previewUrl,
                    mimeType,
                    size: file.size,
                    width: metadata.width,
                    height: metadata.height,
                    durationMs: metadata.durationMs,
                    thumbnail: {
                        blob: metadata.thumbnailBlob,
                        width: metadata.thumbnailWidth,
                        height: metadata.thumbnailHeight,
                        mimeType: metadata.thumbnailMimeType,
                    },
                };
            } catch (videoError) {
                console.warn('Failed to read video metadata', videoError);
                nextMedia = {
                    file,
                    kind: 'video',
                    previewUrl,
                    mimeType,
                    size: file.size,
                    thumbnail: null,
                };
            }
        }
        if (media?.previewUrl) {
            URL.revokeObjectURL(media.previewUrl);
        }
        setMedia(nextMedia);
        handleDraftChange({ caption, media: nextMedia });
    }, [caption, handleDraftChange, media]);

    const handleRemoveMedia = useCallback(() => {
        if (media?.previewUrl) {
            URL.revokeObjectURL(media.previewUrl);
        }
        setMedia(null);
        handleDraftChange({ caption, media: null });
    }, [caption, handleDraftChange, media]);

    const handlePublish = useCallback(async () => {
        if (!media) {
            setError('Добавьте изображение или видео, чтобы опубликовать историю.');
            return;
        }
        setIsPublishing(true);
        setError(null);
        try {
            const uploadResult = await client.uploadContent(media.file, {
                name: media.file.name,
                type: media.mimeType,
                size: media.size,
            } as any);
            const mxcUrl = resolveMxcUrl(uploadResult);
            let thumbnailMxcUrl: string | undefined;
            if (media.thumbnail?.blob) {
                try {
                    const thumbnailUpload = await client.uploadContent(media.thumbnail.blob, {
                        name: `thumbnail-${Date.now()}.jpg`,
                        type: media.thumbnail.mimeType,
                    } as any);
                    thumbnailMxcUrl = resolveMxcUrl(thumbnailUpload);
                } catch (thumbnailError) {
                    console.warn('Failed to upload story thumbnail', thumbnailError);
                }
            }
            const story = await publishStory(client, {
                caption: caption.trim() ? caption.trim() : undefined,
                media: {
                    kind: media.kind,
                    mxcUrl,
                    thumbnailMxcUrl,
                    mimeType: media.mimeType,
                    width: media.width,
                    height: media.height,
                    durationMs: media.durationMs,
                    sizeBytes: media.size,
                },
            });
            if (media.previewUrl) {
                URL.revokeObjectURL(media.previewUrl);
            }
            setCaption('');
            setMedia(null);
            handleDraftChange(null);
            onPublished?.(story);
            onClose();
        } catch (publishError) {
            console.error('Failed to publish story', publishError);
            setError(publishError instanceof Error ? publishError.message : 'Не удалось опубликовать историю');
        } finally {
            setIsPublishing(false);
        }
    }, [caption, client, handleDraftChange, media, onClose, onPublished]);

    if (!isOpen) {
        return null;
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
            <div className="w-full max-w-xl rounded-lg bg-bg-primary shadow-xl border border-border-primary">
                <div className="flex items-center justify-between px-6 py-4 border-b border-border-secondary">
                    <h2 className="text-lg font-semibold text-text-primary">Новая история</h2>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-full p-2 text-text-secondary hover:text-text-primary hover:bg-bg-secondary transition"
                        aria-label="Закрыть редактор историй"
                        disabled={isPublishing}
                    >
                        ✕
                    </button>
                </div>
                <div className="px-6 py-4 space-y-4">
                    <div className="space-y-2">
                        <label className="block text-sm font-medium text-text-secondary">Медиа</label>
                        {media ? (
                            <div className="relative rounded-lg overflow-hidden border border-border-secondary bg-bg-tertiary">
                                {media.kind === 'image' ? (
                                    <img src={media.previewUrl} alt="Предпросмотр истории" className="w-full h-72 object-cover" />
                                ) : (
                                    <video
                                        src={media.previewUrl}
                                        className="w-full h-72 object-cover"
                                        controls
                                        preload="metadata"
                                        playsInline
                                    />
                                )}
                                <button
                                    type="button"
                                    onClick={handleRemoveMedia}
                                    className="absolute top-2 right-2 rounded-full bg-black/60 text-white px-3 py-1 text-xs hover:bg-black/80"
                                    disabled={isPublishing}
                                >
                                    Удалить
                                </button>
                            </div>
                        ) : (
                            <button
                                type="button"
                                onClick={handlePickMedia}
                                className="w-full h-48 rounded-lg border border-dashed border-border-secondary text-text-secondary hover:text-text-primary hover:border-text-primary flex flex-col items-center justify-center gap-2"
                                disabled={isPublishing}
                            >
                                <span className="text-3xl">+</span>
                                <span className="text-sm">Выберите изображение или видео для истории</span>
                            </button>
                        )}
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*,video/*"
                            className="hidden"
                            onChange={handleMediaSelected}
                            disabled={isPublishing}
                        />
                    </div>
                    <div className="space-y-2">
                        <label htmlFor="story-caption" className="block text-sm font-medium text-text-secondary">
                            Подпись (необязательно)
                        </label>
                        <textarea
                            id="story-caption"
                            value={caption}
                            onChange={handleCaptionChange}
                            placeholder="Поделитесь мыслями..."
                            rows={3}
                            className="w-full resize-none rounded-md border border-border-secondary bg-bg-tertiary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
                            maxLength={500}
                            disabled={isPublishing}
                        />
                    </div>
                    {error && <div className="text-sm text-status-danger">{error}</div>}
                </div>
                <div className="flex items-center justify-between px-6 py-4 border-t border-border-secondary bg-bg-secondary">
                    <div className="text-xs text-text-tertiary">
                        Истории доступны вашим контактам в течение 24 часов.
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-md border border-border-secondary px-4 py-2 text-sm text-text-secondary hover:text-text-primary hover:border-text-primary"
                            disabled={isPublishing}
                        >
                            Отмена
                        </button>
                        <button
                            type="button"
                            onClick={handlePublish}
                            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-text-inverted hover:bg-accent-hover disabled:opacity-60"
                            disabled={isPublishing || !media}
                        >
                            {isPublishing ? 'Публикация…' : 'Опубликовать'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default StoryComposer;
