import React from 'react';
import { MatrixCall, MatrixClient } from '../types';
import Avatar from './Avatar';
import { mxcToHttp } from '../services/matrixService';

interface IncomingCallModalProps {
    call: MatrixCall;
    onAccept: () => void;
    onDecline: () => void;
    client: MatrixClient;
}

const IncomingCallModal: React.FC<IncomingCallModalProps> = ({ call, onAccept, onDecline, client }) => {
    // FIX: The 'getPeerMember' method may not be in the MatrixCall type definition. Cast to 'any' to bypass the check.
    const peerMember = (call as any).getPeerMember();
    const peerName = peerMember?.name || 'Unknown User';
    const peerAvatar = mxcToHttp(client, peerMember?.getMxcAvatarUrl(), 96);
    const isVideoCall = call.type === 'video';

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 animate-fade-in-fast">
            <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-sm p-8 text-center animate-slide-up">
                <h2 className="text-2xl font-bold mb-2 flex items-center justify-center gap-2">
                    {isVideoCall && <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor"><path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 001.553.832l3-2a1 1 0 000-1.664l-3-2z" /></svg>}
                    Incoming {isVideoCall ? 'Video' : 'Voice'} Call
                </h2>
                <div className="flex flex-col items-center my-6">
                    <Avatar name={peerName} imageUrl={peerAvatar} size="md" />
                    <p className="mt-4 text-xl font-semibold">{peerName}</p>
                </div>
                <div className="flex justify-center gap-4">
                     <button
                        onClick={onDecline}
                        className="flex-1 py-3 px-4 border border-transparent rounded-md text-sm font-medium text-white bg-red-600 hover:bg-red-700"
                    >
                        Decline
                    </button>
                    <button
                        onClick={onAccept}
                        className="flex-1 py-3 px-4 border border-transparent rounded-md text-sm font-medium text-white bg-green-600 hover:bg-green-700"
                    >
                        Accept
                    </button>
                </div>
            </div>
        </div>
    );
};

export default IncomingCallModal;