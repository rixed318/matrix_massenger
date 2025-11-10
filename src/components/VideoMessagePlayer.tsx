import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface VideoMessagePlayerProps {
    src: string;
    poster?: string | null;
    durationMs?: number;
}

const formatTime = (totalSeconds: number): string => {
    if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
        return '0:00';
    }
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

const VideoMessagePlayer: React.FC<VideoMessagePlayerProps> = ({ src, poster, durationMs }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [hasEnded, setHasEnded] = useState(false);
    const [progress, setProgress] = useState(0);
    const [durationSeconds, setDurationSeconds] = useState<number>(durationMs ? durationMs / 1000 : 0);

    useEffect(() => {
        setIsPlaying(false);
        setHasEnded(false);
        setProgress(0);
        setDurationSeconds(durationMs ? durationMs / 1000 : 0);
    }, [durationMs, src]);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        const handleLoadedMetadata = () => {
            if (!durationMs && Number.isFinite(video.duration) && video.duration > 0) {
                setDurationSeconds(video.duration);
            }
        };

        const handleTimeUpdate = () => {
            if (Number.isFinite(video.duration) && video.duration > 0) {
                setProgress(video.currentTime / video.duration);
            }
        };

        const handleEnded = () => {
            setIsPlaying(false);
            setHasEnded(true);
            setProgress(1);
        };

        video.addEventListener('loadedmetadata', handleLoadedMetadata);
        video.addEventListener('timeupdate', handleTimeUpdate);
        video.addEventListener('ended', handleEnded);

        return () => {
            video.removeEventListener('loadedmetadata', handleLoadedMetadata);
            video.removeEventListener('timeupdate', handleTimeUpdate);
            video.removeEventListener('ended', handleEnded);
        };
    }, [durationMs]);

    const togglePlayback = useCallback(() => {
        const video = videoRef.current;
        if (!video) return;
        if (isPlaying) {
            video.pause();
            setIsPlaying(false);
            return;
        }
        if (hasEnded) {
            video.currentTime = 0;
            setHasEnded(false);
        }
        video.play().then(() => {
            setIsPlaying(true);
        }).catch(error => {
            console.warn('Unable to play video message', error);
        });
    }, [hasEnded, isPlaying]);

    const controlLabel = isPlaying ? 'Пауза' : hasEnded ? 'Повторить' : 'Воспроизвести';

    const { circumference, dashOffset } = useMemo(() => {
        const radius = 44;
        const circ = 2 * Math.PI * radius;
        return {
            circumference: circ,
            dashOffset: circ * (1 - Math.min(1, Math.max(0, progress))),
        };
    }, [progress]);

    return (
        <div className="flex flex-col items-center gap-2">
            <div className="relative">
                <video
                    ref={videoRef}
                    src={src}
                    poster={poster ?? undefined}
                    className="w-28 h-28 rounded-full object-cover"
                    preload="metadata"
                    playsInline
                    controls={false}
                />
                <svg className="absolute inset-0 w-full h-full" viewBox="0 0 96 96" aria-hidden="true">
                    <circle cx="48" cy="48" r="44" strokeWidth="4" className="text-white/15" stroke="currentColor" fill="none" />
                    <circle
                        cx="48"
                        cy="48"
                        r="44"
                        strokeWidth="4"
                        className="text-accent"
                        strokeDasharray={circumference}
                        strokeDashoffset={dashOffset}
                        strokeLinecap="round"
                        stroke="currentColor"
                        fill="none"
                    />
                </svg>
                <button
                    type="button"
                    onClick={togglePlayback}
                    className="absolute inset-0 m-auto flex h-12 w-12 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/70"
                    aria-label={controlLabel}
                >
                    {isPlaying ? (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                    ) : hasEnded ? (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm2.536-10.536a1 1 0 00-1.414-1.414l-3 3a1 1 0 000 1.414l3 3a1 1 0 101.414-1.414L10.414 11H12a2 2 0 110 4H9a1 1 0 100 2h3a4 4 0 100-8h-.586l1.122-1.122z" clipRule="evenodd" />
                        </svg>
                    ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm-.445-10.832A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                        </svg>
                    )}
                </button>
            </div>
            <span className="text-xs text-text-secondary font-mono">{formatTime(durationSeconds)}</span>
        </div>
    );
};

export default VideoMessagePlayer;
