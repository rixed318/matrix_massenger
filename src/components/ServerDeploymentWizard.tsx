import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface DeploymentConfig {
    server_ip: string;
    ssh_user: string;
    ssh_password: string;
    domain?: string;
    admin_username: string;
    admin_password: string;
}

interface DeploymentStatus {
    step: string;
    progress: number;
    message: string;
    success: boolean;
}

interface ServerDeploymentWizardProps {
    onClose: () => void;
    onDeploymentComplete: (homeserverUrl: string, username: string, password: string) => void;
}

const ServerDeploymentWizard: React.FC<ServerDeploymentWizardProps> = ({ onClose, onDeploymentComplete }) => {
    const [currentStep, setCurrentStep] = useState<'config' | 'deploying' | 'complete'>('config');
    const [isTauriAvailable, setIsTauriAvailable] = useState(false);

    useEffect(() => {
        setIsTauriAvailable(typeof window.__TAURI_INTERNALS__ !== 'undefined');
    }, []);

    const [config, setConfig] = useState<DeploymentConfig>({
        server_ip: '',
        ssh_user: 'root',
        ssh_password: '',
        domain: '',
        admin_username: 'admin',
        admin_password: '',
    });

    const [deploymentStatuses, setDeploymentStatuses] = useState<DeploymentStatus[]>([]);
    const [isTestingConnection, setIsTestingConnection] = useState(false);
    const [connectionTestResult, setConnectionTestResult] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const handleInputChange = (field: keyof DeploymentConfig, value: string) => {
        let cleanValue = value;

        // Clean server IP from protocol
        if (field === 'server_ip') {
            cleanValue = value
                .trim()
                .replace(/^https?:\/\//, '') // Remove http:// or https://
                .replace(/:\d+$/, ''); // Remove port if present
        }

        setConfig(prev => ({ ...prev, [field]: cleanValue }));
        setError(null);
        setConnectionTestResult(null);
    };

    const testConnection = async () => {
        if (!config.server_ip || !config.ssh_user || !config.ssh_password) {
            setError('Please fill in server IP, SSH user, and SSH password');
            return;
        }

        setIsTestingConnection(true);
        setConnectionTestResult(null);
        setError(null);

        try {
            if (!isTauriAvailable) {
                // Browser mode - show demo
                await new Promise(resolve => setTimeout(resolve, 1000));
                setConnectionTestResult(`[DEMO MODE] Connection would test to ${config.server_ip}\nIn desktop mode, this will perform real SSH test.`);
            } else {
                // Desktop mode - real SSH test
                const result = await invoke<string>('test_ssh_connection', {
                    serverIp: config.server_ip,
                    sshUser: config.ssh_user,
                    sshPassword: config.ssh_password,
                });
                setConnectionTestResult(result);
            }
        } catch (err) {
            const errorMessage = typeof err === 'string' ? err : (err as Error).message || 'Connection test failed';
            setError(errorMessage);
        } finally {
            setIsTestingConnection(false);
        }
    };

    const startDeployment = async () => {
        if (!isTauriAvailable) {
            setError('This feature is only available in desktop mode. Please build and run the Tauri app.');
            return;
        }

        if (!config.server_ip || !config.ssh_user || !config.ssh_password || !config.admin_username || !config.admin_password) {
            setError('Please fill in all required fields');
            return;
        }

        setCurrentStep('deploying');
        setError(null);
        setDeploymentStatuses([]);

        try {
            const statuses = await invoke<DeploymentStatus[]>('deploy_matrix_server', { config });
            setDeploymentStatuses(statuses);

            const lastStatus = statuses[statuses.length - 1];
            if (lastStatus && lastStatus.success) {
                setCurrentStep('complete');
            } else {
                setError('Deployment completed with errors. Please check the logs.');
            }
        } catch (err) {
            const errorMessage = typeof err === 'string' ? err : (err as Error).message || 'Deployment failed';
            setError(errorMessage);
            setCurrentStep('config');
        }
    };

    const handleComplete = () => {
        const homeserverUrl = config.domain
            ? `https://${config.domain}`
            : `http://${config.server_ip}:8008`;

        onDeploymentComplete(homeserverUrl, config.admin_username, config.admin_password);
    };

    const renderConfigStep = () => (
        <div className="space-y-6">
            <div>
                <h3 className="text-xl font-bold text-text-primary mb-2">🚀 Автоматическая установка Matrix сервера</h3>
                <p className="text-text-secondary text-sm">
                    Разверните собственный Matrix Synapse сервер за 5-10 минут
                </p>
            </div>

            {!isTauriAvailable && (
                <div className="bg-yellow-500/10 border border-yellow-500/50 rounded-lg p-4">
                    <p className="text-yellow-500 text-sm font-medium">⚠️ Требуется десктопное приложение</p>
                    <p className="text-yellow-400 text-xs mt-1">
                        Эта функция доступна только в десктопной версии. Соберите и запустите Tauri приложение:
                    </p>
                    <code className="block mt-2 text-xs bg-bg-tertiary p-2 rounded">npm run tauri dev</code>
                </div>
            )}

            {error && (
                <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-4">
                    <p className="text-red-500 text-sm">{error}</p>
                </div>
            )}

            {connectionTestResult && (
                <div className="bg-green-500/10 border border-green-500/50 rounded-lg p-4">
                    <p className="text-green-500 text-sm font-medium mb-1">✓ Connection Successful</p>
                    <pre className="text-text-secondary text-xs mt-2 overflow-x-auto">{connectionTestResult}</pre>
                </div>
            )}

            <div className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-text-primary mb-2">
                        Server IP Address *
                    </label>
                    <input
                        type="text"
                        value={config.server_ip}
                        onChange={(e) => handleInputChange('server_ip', e.target.value)}
                        placeholder="192.168.1.100 (только IP, без https://)"
                        className="w-full px-4 py-2 bg-bg-secondary text-text-primary rounded-lg border border-border-secondary focus:outline-none focus:border-text-accent"
                    />
                    <p className="text-text-secondary text-xs mt-1">
                        Введите только IP адрес (без http:// или https://)
                    </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-text-primary mb-2">
                            SSH Username *
                        </label>
                        <input
                            type="text"
                            value={config.ssh_user}
                            onChange={(e) => handleInputChange('ssh_user', e.target.value)}
                            placeholder="root"
                            className="w-full px-4 py-2 bg-bg-secondary text-text-primary rounded-lg border border-border-secondary focus:outline-none focus:border-text-accent"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-text-primary mb-2">
                            SSH Password *
                        </label>
                        <input
                            type="password"
                            value={config.ssh_password}
                            onChange={(e) => handleInputChange('ssh_password', e.target.value)}
                            placeholder="••••••••"
                            className="w-full px-4 py-2 bg-bg-secondary text-text-primary rounded-lg border border-border-secondary focus:outline-none focus:border-text-accent"
                        />
                    </div>
                </div>

                <div>
                    <label className="block text-sm font-medium text-text-primary mb-2">
                        Domain Name (optional)
                    </label>
                    <input
                        type="text"
                        value={config.domain}
                        onChange={(e) => handleInputChange('domain', e.target.value)}
                        placeholder="matrix.example.com (leave empty to use IP)"
                        className="w-full px-4 py-2 bg-bg-secondary text-text-primary rounded-lg border border-border-secondary focus:outline-none focus:border-text-accent"
                    />
                    <p className="text-text-secondary text-xs mt-1">
                        If provided, SSL certificate can be configured later
                    </p>
                </div>

                <div className="border-t border-border-secondary pt-4 mt-6">
                    <h4 className="text-sm font-medium text-text-primary mb-4">Matrix Admin Account</h4>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-text-primary mb-2">
                                Admin Username *
                            </label>
                            <input
                                type="text"
                                value={config.admin_username}
                                onChange={(e) => handleInputChange('admin_username', e.target.value)}
                                placeholder="admin"
                                className="w-full px-4 py-2 bg-bg-secondary text-text-primary rounded-lg border border-border-secondary focus:outline-none focus:border-text-accent"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-text-primary mb-2">
                                Admin Password *
                            </label>
                            <input
                                type="password"
                                value={config.admin_password}
                                onChange={(e) => handleInputChange('admin_password', e.target.value)}
                                placeholder="••••••••"
                                className="w-full px-4 py-2 bg-bg-secondary text-text-primary rounded-lg border border-border-secondary focus:outline-none focus:border-text-accent"
                            />
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex gap-3 pt-4">
                <button
                    onClick={testConnection}
                    disabled={isTestingConnection || !config.server_ip || !config.ssh_user || !config.ssh_password}
                    className="flex-1 px-6 py-3 bg-bg-tertiary text-text-primary rounded-lg hover:bg-bg-secondary transition-colors disabled:opacity-50"
                >
                    {isTestingConnection ? 'Testing...' : 'Test Connection (Optional)'}
                </button>
                <button
                    onClick={startDeployment}
                    disabled={!config.server_ip || !config.ssh_user || !config.ssh_password || !config.admin_username || !config.admin_password}
                    className="flex-1 px-6 py-3 bg-text-accent text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                    Start Deployment
                </button>
            </div>

            <button
                onClick={onClose}
                className="w-full px-6 py-2 text-text-secondary hover:text-text-primary transition-colors"
            >
                Cancel
            </button>
        </div>
    );

    const renderDeployingStep = () => (
        <div className="space-y-6">
            <div>
                <h3 className="text-xl font-bold text-text-primary mb-2">Deploying Matrix Server</h3>
                <p className="text-text-secondary text-sm">
                    This process may take 5-10 minutes. Please don't close this window.
                </p>
                <p className="text-yellow-500 text-xs mt-2">
                    💡 Check the terminal where you ran 'npm run tauri dev' for detailed logs
                </p>
            </div>

            <div className="space-y-3 max-h-96 overflow-y-auto">
                {deploymentStatuses.length === 0 && (
                    <div className="flex items-center gap-3 p-4 bg-bg-secondary rounded-lg">
                        <div className="animate-spin h-5 w-5 border-2 border-text-accent border-t-transparent rounded-full"></div>
                        <span className="text-text-primary">Initializing deployment...</span>
                    </div>
                )}

                {deploymentStatuses.map((status, index) => (
                    <div
                        key={index}
                        className={`p-4 rounded-lg border ${
                            status.success
                                ? 'bg-green-500/10 border-green-500/50'
                                : status.message.includes('failed') || status.message.includes('error')
                                ? 'bg-red-500/10 border-red-500/50'
                                : 'bg-blue-500/10 border-blue-500/50'
                        }`}
                    >
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-text-primary">
                                {status.success ? '✓' : '⏳'} {status.step.replace(/_/g, ' ').toUpperCase()}
                            </span>
                            <span className="text-xs text-text-secondary">{status.progress}%</span>
                        </div>
                        <p className="text-sm text-text-secondary whitespace-pre-wrap">{status.message}</p>
                    </div>
                ))}
            </div>

            {error && (
                <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-4">
                    <p className="text-red-500 text-sm font-bold mb-2">❌ Deployment Error</p>
                    <pre className="text-red-400 text-xs whitespace-pre-wrap overflow-x-auto max-h-40 bg-red-900/20 p-3 rounded">{error}</pre>
                    <button
                        onClick={() => setCurrentStep('config')}
                        className="mt-3 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
                    >
                        Back to Configuration
                    </button>
                </div>
            )}
        </div>
    );

    const renderCompleteStep = () => {
        const homeserverUrl = config.domain
            ? `https://${config.domain}`
            : `http://${config.server_ip}:8008`;

        return (
            <div className="space-y-6">
                <div className="text-center">
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-green-500/20 rounded-full mb-4">
                        <svg className="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                    </div>
                    <h3 className="text-2xl font-bold text-text-primary mb-2">Server Deployed Successfully!</h3>
                    <p className="text-text-secondary">
                        Your Matrix Synapse server is now running and ready to use
                    </p>
                </div>

                <div className="bg-bg-secondary rounded-lg p-6 space-y-3">
                    <div>
                        <label className="text-xs text-text-secondary uppercase tracking-wide">Homeserver URL</label>
                        <p className="text-text-primary font-mono">{homeserverUrl}</p>
                    </div>
                    <div>
                        <label className="text-xs text-text-secondary uppercase tracking-wide">Admin Username</label>
                        <p className="text-text-primary font-mono">@{config.admin_username}:{config.domain || config.server_ip}</p>
                    </div>
                </div>

                <div className="bg-blue-500/10 border border-blue-500/50 rounded-lg p-4">
                    <h4 className="text-sm font-medium text-text-primary mb-2">Next Steps:</h4>
                    <ul className="text-sm text-text-secondary space-y-1 list-disc list-inside">
                        {config.domain && (
                            <li>Configure SSL certificate: <code className="text-xs bg-bg-tertiary px-1 rounded">sudo certbot --nginx -d {config.domain}</code></li>
                        )}
                        <li>Configure firewall rules if needed</li>
                        <li>Consider setting up automatic backups</li>
                        <li>Review security settings in homeserver.yaml</li>
                    </ul>
                </div>

                <button
                    onClick={handleComplete}
                    className="w-full px-6 py-3 bg-text-accent text-white rounded-lg hover:opacity-90 transition-opacity"
                >
                    Connect to Server
                </button>
            </div>
        );
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-bg-primary rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                <div className="p-6">
                    {currentStep === 'config' && renderConfigStep()}
                    {currentStep === 'deploying' && renderDeployingStep()}
                    {currentStep === 'complete' && renderCompleteStep()}
                </div>
            </div>
        </div>
    );
};

export default ServerDeploymentWizard;
