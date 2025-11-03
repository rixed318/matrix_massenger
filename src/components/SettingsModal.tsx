import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MatrixClient } from '../types';
import { mxcToHttp } from '../services/matrixService';
import Avatar from './Avatar';
import { DeviceVerification } from 'matrix-js-sdk/lib/models/device';
import { CryptoEvent } from 'matrix-js-sdk/lib/crypto';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (newName: string, newAvatar: File | null) => void;
    client: MatrixClient;
    notificationsEnabled: boolean;
    onSetNotificationsEnabled: (enabled: boolean) => void;
    chatBackground: string;
    onSetChatBackground: (bgUrl: string) => void;
    onResetChatBackground: () => void;
}

const ThemeSwatch: React.FC<{ name: string; colors: { primary: string; secondary: string; accent: string; }; isActive: boolean; onClick: () => void; }> = ({ name, colors, isActive, onClick }) => (
    <div onClick={onClick} className={`cursor-pointer rounded-lg p-2 border-2 ${isActive ? 'border-accent' : 'border-transparent'} hover:border-text-secondary/50`}>
        <div className="flex items-center gap-2">
            <div className="flex -space-x-2">
                <div className="w-6 h-6 rounded-full border-2 border-bg-primary" style={{ backgroundColor: colors.primary }}></div>
                <div className="w-6 h-6 rounded-full border-2 border-bg-primary" style={{ backgroundColor: colors.secondary }}></div>
                <div className="w-6 h-6 rounded-full border-2 border-bg-primary" style={{ backgroundColor: colors.accent }}></div>
            </div>
            <span className="font-semibold text-text-primary">{name}</span>
        </div>
    </div>
);

const THEMES = {
    '': { name: 'Dark', colors: { primary: '#1f2937', secondary: '#111827', accent: '#4f46e5' } },
    'theme-light': { name: 'Light', colors: { primary: '#ffffff', secondary: '#f9fafb', accent: '#4f46e5' } },
    'theme-midnight': { name: 'Midnight', colors: { primary: '#0d1117', secondary: '#010409', accent: '#58a6ff' } },
};

const BACKGROUNDS = [
    'https://www.transparenttextures.com/patterns/asfalt-light.png',
    'https://www.transparenttextures.com/patterns/back-pattern.png',
    'https://www.transparenttextures.com/patterns/bamboo.png',
    'https://www.transparenttextures.com/patterns/brushed-alum.png'
];

interface SecurityDeviceSummary {
    deviceId: string;
    displayName: string;
    fingerprint?: string;
    verification: DeviceVerification;
    isCurrent: boolean;
}

interface SecurityState {
    loading: boolean;
    devices: SecurityDeviceSummary[];
    crossSigningReady: boolean;
    keyBackupEnabled: boolean;
    secretStorageReady: boolean;
    keyBackupVersion?: string | null;
    error?: string;
}


const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, onSave, client, notificationsEnabled, onSetNotificationsEnabled, chatBackground, onSetChatBackground, onResetChatBackground }) => {
    const user = client.getUser(client.getUserId());
    const [displayName, setDisplayName] = useState(user?.displayName || '');
    const [avatarFile, setAvatarFile] = useState<File | null>(null);
    const [avatarPreview, setAvatarPreview] = useState<string | null>(mxcToHttp(client, user?.avatarUrl, 96));
    const [currentTheme, setCurrentTheme] = useState(document.documentElement.className || '');
    const fileInputRef = useRef<HTMLInputElement>(null);
    const bgFileInputRef = useRef<HTMLInputElement>(null);
    const [securityState, setSecurityState] = useState<SecurityState>({
        loading: true,
        devices: [],
        crossSigningReady: false,
        keyBackupEnabled: false,
        secretStorageReady: false,
        keyBackupVersion: null,
    });
    const [securityMessage, setSecurityMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const loadSecurityState = useCallback(async () => {
        const crypto = client.getCrypto?.();
        const userId = client.getUserId();
        if (!crypto || !userId) {
            setSecurityState(prev => ({
                ...prev,
                loading: false,
                devices: [],
                crossSigningReady: false,
                keyBackupEnabled: false,
                secretStorageReady: false,
                keyBackupVersion: null,
                error: crypto ? undefined : 'Encryption engine is not initialised.',
            }));
            return;
        }

        setSecurityState(prev => ({ ...prev, loading: true, error: undefined }));
        try {
            const deviceInfoMap = await crypto.getUserDeviceInfo([userId], true);
            const userDevices = deviceInfoMap.get(userId);
            const devices: SecurityDeviceSummary[] = userDevices
                ? Array.from(userDevices.values()).map(device => ({
                    deviceId: device.deviceId,
                    displayName: device.displayName || 'Unnamed device',
                    fingerprint: device.getFingerprint(),
                    verification: device.verified,
                    isCurrent: device.deviceId === client.getDeviceId(),
                }))
                : [];

            const crossSigningReady = typeof crypto.isCrossSigningReady === 'function' ? await crypto.isCrossSigningReady() : false;
            const secretStorageReady = typeof client.isSecretStorageReady === 'function' ? await client.isSecretStorageReady() : false;
            let keyBackupVersion: string | null = null;
            let keyBackupEnabled = false;
            try {
                keyBackupEnabled = Boolean(client.getKeyBackupEnabled());
                const version = await client.getKeyBackupVersion();
                keyBackupVersion = version?.version ?? null;
            } catch (error) {
                console.warn('Failed to query key backup status', error);
            }

            setSecurityState({
                loading: false,
                devices,
                crossSigningReady,
                keyBackupEnabled,
                secretStorageReady,
                keyBackupVersion,
            });
        } catch (error: any) {
            console.error('Failed to load device verification state', error);
            setSecurityState(prev => ({
                ...prev,
                loading: false,
                devices: [],
                error: error?.message || 'Unable to load security status.',
            }));
        }
    }, [client]);


    useEffect(() => {
        setDisplayName(user?.displayName || '');
        setAvatarPreview(mxcToHttp(client, user?.avatarUrl, 96));
        setAvatarFile(null);
    }, [isOpen, user, client]);

    useEffect(() => {
        if (isOpen) {
            loadSecurityState();
        }
    }, [isOpen, loadSecurityState]);

    useEffect(() => {
        if (!isOpen) {
            return;
        }
        const handler = () => loadSecurityState();
        client.on(CryptoEvent.DeviceVerificationChanged, handler);
        return () => {
            client.removeListener(CryptoEvent.DeviceVerificationChanged, handler);
        };
    }, [client, isOpen, loadSecurityState]);

    if (!isOpen) return null;

    const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setAvatarFile(file);
            const reader = new FileReader();
            reader.onloadend = () => {
                setAvatarPreview(reader.result as string);
            };
            reader.readAsDataURL(file);
        }
    };

    const handleBackgroundUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file && file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (event) => {
                const dataUrl = event.target?.result as string;
                onSetChatBackground(dataUrl);
            };
            reader.readAsDataURL(file);
        }
    };

    const verificationLabel = (verification: DeviceVerification): string => {
        switch (verification) {
            case DeviceVerification.Verified:
                return 'Verified';
            case DeviceVerification.Blocked:
                return 'Blocked';
            default:
                return 'Unverified';
        }
    };

    const verificationBadgeClass = (verification: DeviceVerification): string => {
        switch (verification) {
            case DeviceVerification.Verified:
                return 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30';
            case DeviceVerification.Blocked:
                return 'bg-error/10 text-error border border-error/30';
            default:
                return 'bg-amber-500/10 text-amber-300 border border-amber-400/30';
        }
    };

    const handleRequestVerification = async (deviceId: string) => {
        if (!client.getUserId()) {
            return;
        }
        try {
            await client.requestVerification(client.getUserId()!, [deviceId]);
            setSecurityMessage({ type: 'success', text: 'Verification request sent. Approve it on the other device to trust keys.' });
        } catch (error: any) {
            console.error('Failed to request verification', error);
            setSecurityMessage({ type: 'error', text: error?.message || 'Unable to send verification request.' });
        }
    };

    const handleRequestKeys = async () => {
        try {
            await client.checkOwnCrossSigningTrust({ allowPrivateKeyRequests: true });
            setSecurityMessage({ type: 'success', text: 'Requested encryption keys from trusted devices.' });
        } catch (error: any) {
            console.error('Failed to request cross-signing secrets', error);
            setSecurityMessage({ type: 'error', text: error?.message || 'Unable to request keys.' });
        }
    };

    const handleBootstrapCrossSigning = async () => {
        try {
            await client.bootstrapCrossSigning({ setupNewKeyBackup: true });
            setSecurityMessage({ type: 'success', text: 'Cross-signing has been initialised. Verify this device from a trusted session.' });
            await loadSecurityState();
        } catch (error: any) {
            console.error('Failed to bootstrap cross-signing', error);
            setSecurityMessage({ type: 'error', text: error?.message || 'Unable to bootstrap cross-signing.' });
        }
    };

    const handleSave = () => {
        onSave(displayName, avatarFile);
    };

    const handleThemeChange = (themeClassName: string) => {
        document.documentElement.className = themeClassName;
        localStorage.setItem('matrix-theme', themeClassName);
        setCurrentTheme(themeClassName);
    };

    return (
        <div className="fixed inset-0 bg-bg-secondary/60 flex items-center justify-center z-50 animate-fade-in-fast" onClick={onClose}>
            <div className="bg-bg-primary rounded-lg shadow-xl w-full max-w-md animate-slide-up" onClick={e => e.stopPropagation()}>
                <div className="p-6 border-b border-border-primary">
                    <h2 className="text-xl font-bold">Settings</h2>
                </div>
                <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
                    <h3 className="text-lg font-semibold text-text-primary">Profile</h3>
                    <div className="flex items-center gap-4">
                        <div className="relative cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                            <Avatar name={displayName} imageUrl={avatarPreview} size="md" />
                            <div className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                            </div>
                        </div>
                        <input
                            type="file"
                            ref={fileInputRef}
                            className="hidden"
                            accept="image/png, image/jpeg"
                            onChange={handleAvatarChange}
                        />
                        <p className="text-text-secondary text-sm">Click avatar to upload a new image.<br/>(PNG, JPG)</p>
                    </div>
                    <div>
                        <label htmlFor="displayName" className="block text-sm font-medium text-text-secondary mb-1">
                            Display Name
                        </label>
                        <input
                            type="text"
                            id="displayName"
                            value={displayName}
                            onChange={(e) => setDisplayName(e.target.value)}
                            className="appearance-none block w-full px-3 py-2 border border-border-primary bg-bg-secondary text-text-primary placeholder-text-secondary rounded-md focus:outline-none focus:ring-ring-focus focus:border-ring-focus sm:text-sm"
                            placeholder="Your name"
                        />
                    </div>

                    <div className="pt-6 border-t border-border-primary">
                        <h3 className="text-lg font-semibold text-text-primary mb-3">Appearance</h3>
                        <div className="space-y-2">
                            {Object.entries(THEMES).map(([className, { name, colors }]) => (
                                <ThemeSwatch
                                    key={className}
                                    name={name}
                                    colors={colors}
                                    isActive={currentTheme === className}
                                    onClick={() => handleThemeChange(className)}
                                />
                            ))}
                        </div>
                    </div>

                    <div className="pt-6 border-t border-border-primary">
                        <h3 className="text-lg font-semibold text-text-primary mb-3">Chat Background</h3>
                         <input
                            type="file"
                            ref={bgFileInputRef}
                            className="hidden"
                            accept="image/png, image/jpeg, image/gif"
                            onChange={handleBackgroundUpload}
                        />
                        <div className="grid grid-cols-4 gap-3">
                             {BACKGROUNDS.map(bg => (
                                <div 
                                    key={bg} 
                                    onClick={() => onSetChatBackground(bg)} 
                                    className={`cursor-pointer aspect-square rounded-md bg-cover bg-center border-2 ${chatBackground === bg ? 'border-accent' : 'border-transparent'} hover:border-text-secondary/50`}
                                    style={{backgroundImage: `url(${bg})`, backgroundRepeat: 'repeat' }} 
                                />
                            ))}
                        </div>
                        <div className="flex gap-4 mt-4">
                             <button
                                onClick={() => bgFileInputRef.current?.click()}
                                className="w-full py-2 px-4 border border-border-primary rounded-md text-sm font-medium text-text-primary hover:bg-bg-tertiary focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-ring-focus focus:ring-offset-bg-primary"
                            >
                                Upload Image
                            </button>
                             <button
                                onClick={onResetChatBackground}
                                className="w-full py-2 px-4 border border-border-primary rounded-md text-sm font-medium text-text-primary hover:bg-bg-tertiary focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-ring-focus focus:ring-offset-bg-primary"
                            >
                                Reset
                            </button>
                        </div>
                    </div>

                    <div className="pt-6 border-t border-border-primary">
                        <h3 className="text-lg font-semibold text-text-primary mb-3">Notifications</h3>
                        <div className="relative flex items-start">
                            <div className="flex items-center h-5">
                                <input
                                    id="notifications"
                                    name="notifications"
                                    type="checkbox"
                                    checked={notificationsEnabled}
                                    onChange={(e) => onSetNotificationsEnabled(e.target.checked)}
                                    className="focus:ring-ring-focus h-4 w-4 text-accent border-border-primary rounded bg-bg-secondary"
                                />
                            </div>
                            <div className="ml-3 text-sm">
                                <label htmlFor="notifications" className="font-medium text-text-primary">Enable Desktop Notifications</label>
                                <p className="text-text-secondary">Show a system notification for new messages and calls when the app is in the background.</p>
                            </div>
                        </div>
                    </div>

                    <div className="pt-6 border-t border-border-primary">
                        <h3 className="text-lg font-semibold text-text-primary mb-3">Security &amp; Devices</h3>
                        {securityMessage && (
                            <div className={`rounded-md p-3 text-sm mb-3 ${securityMessage.type === 'success' ? 'bg-emerald-500/10 text-emerald-200 border border-emerald-500/30' : 'bg-error/10 text-error border border-error/40'}`}>
                                {securityMessage.text}
                            </div>
                        )}
                        {securityState.error && (
                            <div className="rounded-md p-3 text-sm mb-3 bg-error/10 text-error border border-error/40">
                                {securityState.error}
                            </div>
                        )}
                        {securityState.loading ? (
                            <div className="flex items-center gap-2 text-text-secondary text-sm">
                                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                </svg>
                                Loading device security status...
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <div className="grid grid-cols-1 gap-3">
                                    <div className={`p-3 rounded-md border ${securityState.crossSigningReady ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-amber-500/40 bg-amber-500/10'}`}>
                                        <p className="text-sm font-semibold text-text-primary">Cross-signing</p>
                                        <p className="text-xs text-text-secondary mt-1">
                                            {securityState.crossSigningReady
                                                ? 'Cross-signing keys are available on this device.'
                                                : 'Cross-signing isn\'t trusted yet. Bootstrap it and verify from a trusted session.'}
                                        </p>
                                    </div>
                                    <div className={`p-3 rounded-md border ${securityState.keyBackupEnabled ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-amber-500/40 bg-amber-500/10'}`}>
                                        <p className="text-sm font-semibold text-text-primary">Secure backup</p>
                                        <p className="text-xs text-text-secondary mt-1">
                                            {securityState.keyBackupEnabled
                                                ? `Key backup is active${securityState.keyBackupVersion ? ` (version ${securityState.keyBackupVersion})` : ''}.`
                                                : 'Key backup is disabled. Complete the recovery flow to protect message keys.'}
                                        </p>
                                    </div>
                                    <div className={`p-3 rounded-md border ${securityState.secretStorageReady ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-amber-500/40 bg-amber-500/10'}`}>
                                        <p className="text-sm font-semibold text-text-primary">Secret storage</p>
                                        <p className="text-xs text-text-secondary mt-1">
                                            {securityState.secretStorageReady
                                                ? 'Secret storage is ready and holds your recovery secrets.'
                                                : 'Secret storage is not initialised yet. Back up your recovery key to finish setup.'}
                                        </p>
                                    </div>
                                </div>

                                {(!securityState.crossSigningReady || !securityState.keyBackupEnabled || !securityState.secretStorageReady) && (
                                    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
                                        <p className="font-semibold mb-2">Complete verification to keep encrypted history safe:</p>
                                        <ul className="list-disc ml-4 space-y-1">
                                            <li>Accept verification requests from another trusted session or start one below.</li>
                                            <li>Store the generated recovery key somewhere safe; you&apos;ll need it when restoring keys.</li>
                                            <li>Keep at least one additional verified device available to share keys on demand.</li>
                                        </ul>
                                    </div>
                                )}

                                <div>
                                    <h4 className="text-sm font-semibold text-text-primary mb-2">Your devices</h4>
                                    <div className="space-y-3">
                                        {securityState.devices.map(device => (
                                            <div key={device.deviceId} className="border border-border-primary rounded-md p-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between bg-bg-tertiary/40">
                                                <div>
                                                    <p className="font-medium text-text-primary">
                                                        {device.displayName}
                                                        {device.isCurrent && <span className="text-xs text-accent ml-2">(This device)</span>}
                                                    </p>
                                                    <p className="text-xs text-text-secondary mt-1 break-all">ID: {device.deviceId}</p>
                                                    {device.fingerprint && (
                                                        <p className="text-xs text-text-secondary break-all">Fingerprint: {device.fingerprint}</p>
                                                    )}
                                                </div>
                                                <div className="flex flex-col items-start md:items-end gap-2 w-full md:w-auto">
                                                    <span className={`text-xs font-semibold px-2 py-1 rounded-full ${verificationBadgeClass(device.verification)}`}>
                                                        {verificationLabel(device.verification)}
                                                    </span>
                                                    {device.verification === DeviceVerification.Unverified && (
                                                        <button
                                                            onClick={() => handleRequestVerification(device.deviceId)}
                                                            className="text-xs font-medium px-3 py-1 rounded-md border border-accent text-accent hover:bg-accent/10 transition"
                                                        >
                                                            Request verification
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                        {securityState.devices.length === 0 && (
                                            <p className="text-sm text-text-secondary">No other devices yet. Sign in elsewhere to see them listed here.</p>
                                        )}
                                    </div>
                                </div>

                                <div className="flex flex-wrap gap-2">
                                    <button
                                        onClick={handleBootstrapCrossSigning}
                                        className="px-3 py-2 text-sm font-medium rounded-md border border-border-primary hover:bg-bg-tertiary transition"
                                    >
                                        Bootstrap cross-signing
                                    </button>
                                    <button
                                        onClick={handleRequestKeys}
                                        className="px-3 py-2 text-sm font-medium rounded-md border border-border-primary hover:bg-bg-tertiary transition"
                                    >
                                        Request keys from my devices
                                    </button>
                                    <button
                                        onClick={loadSecurityState}
                                        className="px-3 py-2 text-sm font-medium rounded-md border border-border-primary hover:bg-bg-tertiary transition"
                                    >
                                        Refresh status
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
                <div className="bg-bg-hover px-6 py-4 flex justify-end gap-3 rounded-b-lg">
                    <button
                        onClick={onClose}
                        className="py-2 px-4 border border-border-primary rounded-md text-sm font-medium text-text-primary hover:bg-bg-tertiary focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-ring-focus focus:ring-offset-bg-primary"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        className="py-2 px-4 border border-transparent rounded-md text-sm font-medium text-text-inverted bg-accent hover:bg-accent-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-ring-focus focus:ring-offset-bg-primary"
                    >
                        Save Changes
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SettingsModal;