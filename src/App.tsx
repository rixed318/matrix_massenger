import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import LoginPage from './components/LoginPage';
import ChatPage from './components/ChatPage';
import { MatrixClient } from './types';
import { initClient, findOrCreateSavedMessagesRoom } from './services/matrixService';

type StoredCredentials = {
    homeserver_url: string;
    user_id: string;
    access_token: string;
};

const LEGACY_CREDENTIALS_KEY = 'matrix-creds';

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
        await matrixClient.startClient({ initialSyncLimit: 10 });
        const smRoomId = await findOrCreateSavedMessagesRoom(matrixClient);
        setSavedMessagesRoomId(smRoomId);
        setClient(matrixClient);
    };

    useEffect(() => {
        const migrateLegacyCredentials = async () => {
            const storedCreds = localStorage.getItem(LEGACY_CREDENTIALS_KEY);
            if (!storedCreds) {
                return;
            }
            try {
                const { homeserverUrl, userId, accessToken } = JSON.parse(storedCreds);
                await invoke('save_credentials', {
                    creds: {
                        homeserver_url: homeserverUrl,
                        user_id: userId,
                        access_token: accessToken,
                    },
                });
            } catch (err) {
                console.warn('Failed to migrate legacy credentials', err);
            } finally {
                localStorage.removeItem(LEGACY_CREDENTIALS_KEY);
            }
        };

        const attemptAutoLogin = async () => {
            await migrateLegacyCredentials();
            try {
                const storedCreds = await invoke<StoredCredentials | null>('load_credentials');
                if (storedCreds) {
                    const matrixClient = initClient(
                        storedCreds.homeserver_url,
                        storedCreds.access_token,
                        storedCreds.user_id
                    );
                    await setupSession(matrixClient);
                }
            } catch (err: any) {
                console.error('Auto-login failed:', err);
                await invoke('clear_credentials').catch(clearErr =>
                    console.warn('Failed to clear credentials after auto-login error', clearErr)
                );
                if (err.message?.includes('M_UNKNOWN_TOKEN')) {
                    setError('Your session has expired. Please log in again.');
                } else {
                    setError('Failed to restore session. Please log in again.');
                }
            } finally {
                setIsLoading(false);
            }
        };
        attemptAutoLogin();
    }, []);

    const handleLoginSuccess = async (newClient: MatrixClient) => {
        await setupSession(newClient);
        const creds = {
            homeserver_url: newClient.getHomeserverUrl(),
            user_id: newClient.getUserId(),
            access_token: newClient.getAccessToken(),
        };
        try {
            await invoke('save_credentials', { creds });
        } catch (err) {
            console.error('Failed to persist credentials:', err);
        }
        setError(null);
    };

    const handleLogout = async () => {
        if(client) {
            await client.logout();
        }
        setClient(null);
        setSavedMessagesRoomId(null);
        try {
            await invoke('clear_credentials');
        } catch (err) {
            console.warn('Failed to clear credentials from secure store:', err);
        }
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