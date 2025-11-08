

import React from 'react';
import { MatrixClient } from '@matrix-messenger/core';

interface WelcomeViewProps {
    client: MatrixClient;
}

const WelcomeView: React.FC<WelcomeViewProps> = ({ client }) => {
    const user = client.getUser(client.getUserId());
    const displayName = user?.displayName || client.getUserId();

    return (
        <div className="flex flex-col items-center justify-center h-full text-center text-text-secondary p-8">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-24 w-24 text-gray-500 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <h2 className="text-2xl font-bold text-text-primary">Welcome, {displayName}!</h2>
            <p className="mt-2 max-w-sm">
                Select a chat from the sidebar to start messaging. This client is connected to your Matrix homeserver.
            </p>
        </div>
    );
};

export default WelcomeView;