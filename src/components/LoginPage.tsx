import React, { useState, FormEvent, useEffect } from 'react';
import { MatrixClient } from '../types';
import { login } from '../services/matrixService';

interface LoginPageProps {
    onLoginSuccess: (client: MatrixClient) => void;
    initialError: string | null;
}

type ConnectionType = 'public' | 'secure' | 'selfhosted';

const ConnectionOption: React.FC<{ title: string; description: string; icon: React.ReactElement; onSelect: () => void; }> = ({ title, description, icon, onSelect }) => (
    <button
        onClick={onSelect}
        className="w-full text-left p-6 bg-bg-tertiary/50 hover:bg-bg-tertiary rounded-lg transition-all border border-border-primary hover:border-accent flex items-start space-x-4"
    >
        <div className="flex-shrink-0 text-accent bg-accent/20 rounded-lg p-3">{icon}</div>
        <div>
            <h3 className="text-lg font-bold text-text-primary">{title}</h3>
            <p className="text-sm text-text-secondary mt-1">{description}</p>
        </div>
    </button>
);

const LoginForm: React.FC<{ 
    connectionType: ConnectionType;
    onLogin: (homeserverUrl: string, username: string, password: string) => Promise<void>;
    isLoading: boolean;
    error: string | null;
    onBack: () => void;
}> = ({ connectionType, onLogin, isLoading, error, onBack }) => {
    
    const getInitialUrl = () => {
        switch(connectionType) {
            case 'public': return 'https://matrix.org';
            case 'secure': return 'https://matrix.secure-messenger.com'; // Placeholder for your secure server
            case 'selfhosted': return '';
            default: return '';
        }
    };
    
    const [homeserverUrl, setHomeserverUrl] = useState(getInitialUrl());
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');

    const handleSubmit = (e: FormEvent) => {
        e.preventDefault();
        onLogin(homeserverUrl, username, password);
    };

    return (
        <div className="animate-fade-in-fast">
            <button onClick={onBack} className="flex items-center text-sm text-text-accent hover:underline mb-4">
                 <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                Back to options
            </button>
            <form className="space-y-6" onSubmit={handleSubmit}>
                <div className="rounded-md shadow-sm -space-y-px">
                    <div>
                        <label htmlFor="homeserver" className="sr-only">Homeserver URL</label>
                        <input
                            id="homeserver"
                            name="homeserver"
                            type="text"
                            required
                            readOnly={connectionType !== 'selfhosted'}
                            className="appearance-none rounded-none relative block w-full px-3 py-2 border border-border-primary bg-bg-secondary text-text-primary placeholder-text-secondary rounded-t-md focus:outline-none focus:ring-ring-focus focus:border-ring-focus focus:z-10 sm:text-sm read-only:bg-bg-tertiary"
                            placeholder="Homeserver URL"
                            value={homeserverUrl}
                            onChange={(e) => setHomeserverUrl(e.target.value)}
                        />
                    </div>
                    <div>
                        <label htmlFor="username" className="sr-only">Username</label>
                        <input
                            id="username"
                            name="username"
                            type="text"
                            autoComplete="username"
                            required
                            className="appearance-none rounded-none relative block w-full px-3 py-2 border border-border-primary bg-bg-secondary text-text-primary placeholder-text-secondary focus:outline-none focus:ring-ring-focus focus:border-ring-focus focus:z-10 sm:text-sm"
                            placeholder="Username"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                        />
                    </div>
                    <div>
                        <label htmlFor="password" className="sr-only">Password</label>
                        <input
                            id="password"
                            name="password"
                            type="password"
                            autoComplete="current-password"
                            required
                            className="appearance-none rounded-none relative block w-full px-3 py-2 border border-border-primary bg-bg-secondary text-text-primary placeholder-text-secondary rounded-b-md focus:outline-none focus:ring-ring-focus focus:border-ring-focus focus:z-10 sm:text-sm"
                            placeholder="Password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                        />
                    </div>
                </div>

                {error && <p className="text-error text-sm text-center">{error}</p>}

                <div>
                    <button
                        type="submit"
                        disabled={isLoading || !homeserverUrl}
                        className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-text-inverted bg-accent hover:bg-accent-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-ring-focus disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isLoading ? (
                            <>
                                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-text-inverted" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                Signing In...
                            </>
                        ) : 'Sign In'}
                    </button>
                </div>
            </form>
        </div>
    );
};


const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess, initialError }) => {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(initialError);
    const [connectionType, setConnectionType] = useState<ConnectionType | null>(null);

    useEffect(() => {
        setError(initialError);
    }, [initialError]);

    const handleLogin = async (homeserverUrl: string, username: string, password: string) => {
        setError(null);
        setIsLoading(true);
        try {
            const client = await login(homeserverUrl, username, password);
            onLoginSuccess(client);
        } catch (err: any) {
            console.error(err);
            if (err.message?.includes('M_FORBIDDEN')) {
                setError('Login failed. Please check your username and password.');
            } else if (err.message?.includes('M_UNKNOWN_TOKEN')) {
                setError('Login failed. The access token is no longer valid.');
            } else {
                setError(err.message || 'Login failed. Please check your credentials and homeserver URL.');
            }
        } finally {
            setIsLoading(false);
        }
    };
    
    const renderContent = () => {
        if (connectionType) {
            return (
                <LoginForm 
                    connectionType={connectionType}
                    onLogin={handleLogin}
                    isLoading={isLoading}
                    error={error}
                    onBack={() => {
                        setError(null);
                        setConnectionType(null)
                    }}
                />
            )
        }
        
        return (
             <div className="space-y-6 animate-fade-in-fast">
                <div className="text-center">
                    <h2 className="text-3xl font-extrabold text-text-primary">Connect to Matrix</h2>
                    <p className="mt-2 text-text-secondary">
                       Choose how you want to connect. Your data belongs to you.
                    </p>
                </div>
                <div className="space-y-4">
                    <ConnectionOption
                        title="Matrix.org"
                        description="Quickly get started on the largest public Matrix server. Ideal for new users."
                        icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>}
                        onSelect={() => setConnectionType('public')}
                    />
                    <ConnectionOption
                        title="Secure Cloud"
                        description="Use our managed homeserver with built-in content protection and premium features."
                        icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" /></svg>}
                        onSelect={() => setConnectionType('secure')}
                    />
                    <ConnectionOption
                        title="Your Server (Self-hosted)"
                        description="Connect to your own homeserver for complete control and data ownership."
                        icon={<svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" /></svg>}
                        onSelect={() => setConnectionType('selfhosted')}
                    />
                </div>
                 {initialError && !error && <p className="text-error text-sm text-center">{initialError}</p>}
            </div>
        )
    };

    return (
        <div className="flex items-center justify-center h-full bg-bg-secondary">
            <div className="w-full max-w-md p-8 space-y-8 bg-bg-primary rounded-lg shadow-lg">
                {renderContent()}
            </div>
        </div>
    );
};

export default LoginPage;