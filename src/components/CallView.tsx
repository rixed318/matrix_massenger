import React, { useState, useEffect, useRef } from 'react';
import { MatrixCall, MatrixClient } from '../types';
import Avatar from './Avatar';
import { mxcToHttp } from '../services/matrixService';
// FIX: Use CallEvent enum for event listeners. CallState is not exported in this SDK version, so string literals will be used for state values.
import { CallEvent } from 'matrix-js-sdk';

interface CallViewProps {
    call: MatrixCall;
    onHangup: () => void;
    client: MatrixClient;
}

const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
    const secs = (seconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
};

const CallView: React.FC<CallViewProps> = ({ call, onHangup, client }) => {
    // FIX: Explicitly type callState as string because the 'state' event provides string literals.
    const [callState, setCallState] = useState<string>(call.state);
    const [duration, setDuration] = useState(0);
    const [isMuted, setIsMuted] = useState(call.isMicrophoneMuted());
    const [isVidMuted, setIsVidMuted] = useState(call.isLocalVideoMuted());
    const durationIntervalRef = useRef<number | null>(null);
    const localVideoRef = useRef<HTMLVideoElement>(null);
    const remoteVideoRef = useRef<HTMLVideoElement>(null);

    // FIX: The 'getPeerMember' method may not be in the MatrixCall type definition. Cast to 'any' to bypass the check.
    const peerMember = (call as any).getPeerMember();
    const peerName = peerMember?.name || 'Unknown User';
    const peerAvatar = mxcToHttp(client, peerMember?.getMxcAvatarUrl(), 128);
    const isVideoCall = call.type === 'video';

    useEffect(() => {
        if (isVideoCall) {
            if (localVideoRef.current) {
                // FIX: `setLocalVideoElement` is not in the MatrixCall type definition. Cast to `any`.
                (call as any).setLocalVideoElement(localVideoRef.current);
            }
            if (remoteVideoRef.current) {
                // FIX: `setRemoteVideoElement` is not in the MatrixCall type definition. Cast to `any`.
                (call as any).setRemoteVideoElement(remoteVideoRef.current);
            }
        }
    }, [call, isVideoCall]);


    useEffect(() => {
        // FIX: The type of newState from the 'state' event is a string literal (e.g., 'connected'), not the CallState enum.
        const onStateChanged = (newState: string) => {
            setCallState(newState);
            // FIX: Use string literal 'connected' instead of CallState.Connected.
            if (newState === 'connected') {
                if (durationIntervalRef.current) {
                    clearInterval(durationIntervalRef.current);
                }
                durationIntervalRef.current = window.setInterval(() => {
                    setDuration(prev => prev + 1);
                }, 1000);
            } else {
                if (durationIntervalRef.current) {
                    clearInterval(durationIntervalRef.current);
                    durationIntervalRef.current = null;
                }
            }
        };

        // FIX: Use CallEvent.State enum member for the 'state' event. Cast listener as a workaround for potential type mismatch since CallState cannot be imported.
        call.on(CallEvent.State, onStateChanged as any);
        
        // Initial state check
        // FIX: Use string literal 'connected' instead of CallState.Connected.
        if (call.state === 'connected') {
            onStateChanged('connected');
        }

        return () => {
            // FIX: Use CallEvent.State enum member for the 'state' event.
            call.removeListener(CallEvent.State, onStateChanged as any);
            if (durationIntervalRef.current) {
                clearInterval(durationIntervalRef.current);
            }
        };
    }, [call]);

    const toggleMute = () => {
        const newMutedState = !isMuted;
        call.setMicrophoneMuted(newMutedState);
        setIsMuted(newMutedState);
    };

    const toggleVideoMute = () => {
        const newVidMutedState = !isVidMuted;
        // FIX: `setVideoMuted` is not in the MatrixCall type definition. Cast to `any`.
        (call as any).setVideoMuted(newVidMutedState);
        setIsVidMuted(newVidMutedState);
    };

    const getStateText = () => {
        switch (callState) {
            // FIX: Use string literals instead of CallState enum.
            case 'connecting': return 'Connecting...';
            case 'ringing': return 'Ringing...';
            case 'connected': return formatDuration(duration);
            default: return callState.charAt(0).toUpperCase() + callState.slice(1);
        }
    };
    
    return (
        <div className="fixed inset-0 bg-gray-900/95 z-40 flex flex-col items-center justify-center animate-fade-in-fast">
            {isVideoCall && (
                <video
                    ref={remoteVideoRef}
                    autoPlay
                    playsInline
                    className="absolute top-0 left-0 w-full h-full object-cover"
                />
            )}

            <div className="relative text-center z-10">
                {!isVideoCall && <Avatar name={peerName} imageUrl={peerAvatar} size="md" />}
                <h2 className="text-3xl font-bold mt-4 text-shadow">{peerName}</h2>
                <p className="text-gray-300 text-lg mt-2 text-shadow">{getStateText()}</p>
            </div>

            {isVideoCall && (
                <video
                    ref={localVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className={`absolute bottom-40 right-8 w-48 h-auto rounded-lg shadow-lg border-2 border-gray-700 transition-opacity ${isVidMuted ? 'opacity-0' : 'opacity-100'}`}
                />
            )}
            
            <div className="absolute bottom-16 flex items-center gap-8 z-10">
                <button 
                    onClick={toggleMute} 
                    className={`h-16 w-16 rounded-full flex items-center justify-center transition-colors ${isMuted ? 'bg-indigo-500' : 'bg-gray-700 hover:bg-gray-600'}`}
                    title={isMuted ? 'Unmute' : 'Mute'}
                >
                    {isMuted ? (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" viewBox="0 0 20 20" fill="currentColor">
                           <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM12.293 7.293a1 1 0 011.414 0L15 8.586l1.293-1.293a1 1 0 111.414 1.414L16.414 10l1.293 1.293a1 1 0 01-1.414 1.414L15 11.414l-1.293 1.293a1 1 0 01-1.414-1.414L13.586 10l-1.293-1.293a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                    ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0a5 5 0 01-5 5V8a3 3 0 014.52-2.83A1 1 0 0015 4.93a3 3 0 01-6 0A1 1 0 008.48 5.17 3 3 0 0113 8v6.93zM5 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H7a1 1 0 100 2h6a1 1 0 100-2h-2v-2.07A7.001 7.001 0 005 8z" clipRule="evenodd" />
                        </svg>
                    )}
                </button>
                 {isVideoCall && (
                    <button 
                        onClick={toggleVideoMute} 
                        className={`h-16 w-16 rounded-full flex items-center justify-center transition-colors ${isVidMuted ? 'bg-indigo-500' : 'bg-gray-700 hover:bg-gray-600'}`}
                        title={isVidMuted ? 'Turn camera on' : 'Turn camera off'}
                    >
                         {isVidMuted ? (
                             <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" viewBox="0 0 20 20" fill="currentColor">
                                <path d="M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" />
                                <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.022 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
                            </svg>
                         ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" viewBox="0 0 20 20" fill="currentColor">
                                <path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 001.553.832l3-2a1 1 0 000-1.664l-3-2z" />
                            </svg>
                         )}
                    </button>
                 )}
                <button 
                    onClick={onHangup} 
                    className="h-20 w-20 rounded-full bg-red-600 hover:bg-red-700 flex items-center justify-center"
                    title="End call"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 transform -rotate-135" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" />
                    </svg>
                </button>
            </div>
        </div>
    );
};

export default CallView;