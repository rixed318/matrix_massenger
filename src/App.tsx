import React, { useState, useEffect } from 'react';
import LoginPage from './components/LoginPage';
import ChatPage from './components/ChatPage';
import { MatrixClient } from './types';
import { initClient, findOrCreateSavedMessagesRoom, ensureCryptoIsReady } from './services/matrixService';

const App: React.FC = () => {
    const [client, setClient] = useState<MatrixClient | null>(null);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [savedMessagesRoomId, setSavedMessagesRoomId] = useState<string | null>(null);

    useEffect(() => {
        const savedTheme = localStorage.getItem('matrix-theme') || '';
        document.documentElement.className = savedTheme;
    }, []);

    const setupSession = async (matrixClient: MatrixClient) => {
        await ensureCryptoIsReady(matrixClient);
        await matrixClient.startClient({ initialSyncLimit: 10 });
        const smRoomId = await findOrCreateSavedMessagesRoom(matrixClient);
        setSavedMessagesRoomId(smRoomId);
        setClient(matrixClient);
    };

    useEffect(() => {
        const attemptAutoLogin = async () => {
            const storedCreds = localStorage.getItem('matrix-creds');
            if (storedCreds) {
                try {
                    const { homeserverUrl, userId, accessToken, deviceId } = JSON.parse(storedCreds);
                    const matrixClient = initClient(homeserverUrl, accessToken, userId, deviceId);
                    await setupSession(matrixClient);
                } catch (err: any) {
                    console.error("Auto-login failed:", err);
                    localStorage.removeItem('matrix-creds');
                     if (err.message?.includes('M_UNKNOWN_TOKEN')) {
                        setError("Your session has expired. Please log in again.");
                    } else {
                        setError("Failed to restore session. Please log in again.");
                    }
                }
            }
            setIsLoading(false);
        };
        attemptAutoLogin();
    }, []);
    
    const handleLoginSuccess = async (newClient: MatrixClient) => {
        await setupSession(newClient);
        const creds = {
            homeserverUrl: newClient.getHomeserverUrl(),
            userId: newClient.getUserId(),
            accessToken: newClient.getAccessToken(),
            deviceId: newClient.getDeviceId(),
        };
        localStorage.setItem('matrix-creds', JSON.stringify(creds));
        setError(null);
    };

    const handleLogout = async () => {
        if(client) {
            await client.logout();
        }
        setClient(null);
        setSavedMessagesRoomId(null);
        localStorage.removeItem('matrix-creds');
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-screen bg-bg-secondary text-text-primary">
                <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-blue-500"></div>
                <span className="ml-4 text-xl">Loading Session...</span>
            </div>
        );
    }

    return (
        <div className="h-screen w-screen bg-bg-primary text-text-primary font-sans">
            {client && savedMessagesRoomId ? (
                <ChatPage client={client} onLogout={handleLogout} savedMessagesRoomId={savedMessagesRoomId} />
            ) : (
                <LoginPage onLoginSuccess={handleLoginSuccess} initialError={error} />
            )}
        </div>
    );
};

export default App;