import React, { useState, useEffect, useRef } from 'react';
import { MatrixClient } from '@matrix-messenger/core';
import {
    mxcToHttp,
    getTranslationSettings,
    setTranslationSettings,
    getTranscriptionSettings,
    setTranscriptionSettings,
    getTranscriptionRuntimeConfig,
} from '@matrix-messenger/core';
import Avatar from './Avatar';
import SecuritySettings from './SecuritySettings';
import PluginsPanel from './Settings/PluginsPanel';
import AutomationsPanel from './Settings/AutomationsPanel';
import type { SendKeyBehavior } from '../types';

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
    sendKeyBehavior: SendKeyBehavior;
    onSetSendKeyBehavior: (behavior: SendKeyBehavior) => void;
    isPresenceHidden: boolean;
    onSetPresenceHidden: (hidden: boolean) => void;
    presenceRestricted: boolean;
    animatedReactionsEnabled: boolean;
    onSetAnimatedReactionsEnabled: (enabled: boolean) => void;
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

const TRANSCRIPTION_LANG_OPTIONS = [
    { value: '', label: 'Использовать по умолчанию' },
    { value: 'auto', label: 'Определять автоматически' },
    { value: 'ru', label: 'Русский' },
    { value: 'en', label: 'English' },
    { value: 'es', label: 'Español' },
    { value: 'de', label: 'Deutsch' },
    { value: 'fr', label: 'Français' },
    { value: 'uk', label: 'Українська' },
    { value: 'it', label: 'Italiano' },
];


const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, onSave, client, notificationsEnabled, onSetNotificationsEnabled, chatBackground, onSetChatBackground, onResetChatBackground, sendKeyBehavior, onSetSendKeyBehavior, isPresenceHidden, onSetPresenceHidden, presenceRestricted, animatedReactionsEnabled, onSetAnimatedReactionsEnabled }) => {
    const user = client.getUser(client.getUserId());
    const [displayName, setDisplayName] = useState(user?.displayName || '');
    const [avatarFile, setAvatarFile] = useState<File | null>(null);
    const [avatarPreview, setAvatarPreview] = useState<string | null>(mxcToHttp(client, user?.avatarUrl, 96));
    const [currentTheme, setCurrentTheme] = useState(document.documentElement.className || '');
    const [translationUrl, setTranslationUrl] = useState<string>('');
    const [translationApiKey, setTranslationApiKey] = useState<string>('');
    const runtimeTranscription = getTranscriptionRuntimeConfig();
    const transcriptionConfigured = Boolean(runtimeTranscription.endpoint);
    const [transcriptionEnabled, setTranscriptionEnabled] = useState<boolean>(runtimeTranscription.enabled);
    const [transcriptionLanguage, setTranscriptionLanguage] = useState<string>(runtimeTranscription.defaultLanguage ?? '');
    const [transcriptionMaxDuration, setTranscriptionMaxDuration] = useState<string>(
        typeof runtimeTranscription.maxDurationSec === 'number' ? String(runtimeTranscription.maxDurationSec) : ''
    );
    const [isSecurityOpen, setIsSecurityOpen] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const bgFileInputRef = useRef<HTMLInputElement>(null);


    useEffect(() => {
        setDisplayName(user?.displayName || '');
        setAvatarPreview(mxcToHttp(client, user?.avatarUrl, 96));
        setAvatarFile(null);
    }, [isOpen, user, client]);

    useEffect(() => {
        // Load translation settings from account data or localStorage
        try {
            const s = getTranslationSettings(client);
            setTranslationUrl((s?.baseUrl as string) || '');
            setTranslationApiKey((s?.apiKey as string) || '');
        } catch (_) {
            /* noop */
        }
    }, [isOpen, client]);

    // Persist translation settings to localStorage and Matrix account data
    useEffect(() => {
        const t = setTimeout(() => {
            const payload = {
                baseUrl: (translationUrl || '').trim(),
                apiKey: (translationApiKey || '').trim() || undefined,
            };
            setTranslationSettings(client, payload);
        }, 400);
        return () => clearTimeout(t);
    }, [translationUrl, translationApiKey, client]);

    useEffect(() => {
        if (!isOpen) return;
        try {
            const settings = getTranscriptionSettings(client);
            setTranscriptionEnabled(Boolean(settings?.enabled));
            setTranscriptionLanguage(settings?.language ?? '');
            setTranscriptionMaxDuration(
                typeof settings?.maxDurationSec === 'number' && Number.isFinite(settings.maxDurationSec)
                    ? String(settings.maxDurationSec)
                    : ''
            );
        } catch (_) {
            /* noop */
        }
    }, [isOpen, client]);

    useEffect(() => {
        if (!isOpen) return;
        const handle = setTimeout(() => {
            const maxDurationValue = transcriptionMaxDuration.trim();
            const parsed = maxDurationValue.length ? Number(maxDurationValue) : undefined;
            const safeDuration = typeof parsed === 'number' && Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
            void setTranscriptionSettings(client, {
                enabled: transcriptionEnabled,
                language: transcriptionLanguage || undefined,
                maxDurationSec: safeDuration,
            });
        }, 400);
        return () => clearTimeout(handle);
    }, [transcriptionEnabled, transcriptionLanguage, transcriptionMaxDuration, client, isOpen]);

    useEffect(() => {
        if (!isOpen) {
            setIsSecurityOpen(false);
        }
    }, [isOpen]);

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
                        <h3 className="text-lg font-semibold text-text-primary mb-3">Reactions</h3>
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm font-medium text-text-primary">Animated reactions</p>
                                <p className="text-xs text-text-secondary">Play playful animations whenever reactions are added.</p>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="sr-only peer"
                                    checked={animatedReactionsEnabled}
                                    onChange={(event) => onSetAnimatedReactionsEnabled(event.target.checked)}
                                />
                                <div className="w-11 h-6 bg-bg-tertiary peer-focus:outline-none rounded-full peer peer-checked:bg-accent transition-colors"></div>
                                <div className="absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-5"></div>
                            </label>
                        </div>
                    </div>

                    <div className="pt-6 border-t border-border-primary">
                        <h3 className="text-lg font-semibold text-text-primary mb-3">Message Sending</h3>
                        <div className="space-y-3">
                            <label className="flex items-start gap-3 cursor-pointer">
                                <input
                                    type="radio"
                                    name="sendKeyBehavior"
                                    value="enter"
                                    checked={sendKeyBehavior === 'enter'}
                                    onChange={() => onSetSendKeyBehavior('enter')}
                                    className="mt-1 h-4 w-4 text-accent focus:ring-ring-focus"
                                />
                                <span className="text-sm text-text-primary">
                                    Enter sends message (Shift+Enter for new line)
                                </span>
                            </label>
                            <label className="flex items-start gap-3 cursor-pointer">
                                <input
                                    type="radio"
                                    name="sendKeyBehavior"
                                    value="ctrlEnter"
                                    checked={sendKeyBehavior === 'ctrlEnter'}
                                    onChange={() => onSetSendKeyBehavior('ctrlEnter')}
                                    className="mt-1 h-4 w-4 text-accent focus:ring-ring-focus"
                                />
                                <span className="text-sm text-text-primary">
                                    Ctrl/⌘ + Enter sends message, Enter starts a new line
                                </span>
                            </label>
                            <label className="flex items-start gap-3 cursor-pointer">
                                <input
                                    type="radio"
                                    name="sendKeyBehavior"
                                    value="altEnter"
                                    checked={sendKeyBehavior === 'altEnter'}
                                    onChange={() => onSetSendKeyBehavior('altEnter')}
                                    className="mt-1 h-4 w-4 text-accent focus:ring-ring-focus"
                                />
                                <span className="text-sm text-text-primary">
                                    Alt + Enter sends message, Enter starts a new line
                                </span>
                            </label>
                        </div>
                    </div>

                    <div className="pt-6 border-t border-border-primary">
                        <h3 className="text-lg font-semibold text-text-primary mb-3">Security</h3>
                        <p className="text-sm text-text-secondary mb-4">
                            Управляйте доверенными устройствами, ключами шифрования и резервными копиями прямо из приложения.
                        </p>
                        <button
                            onClick={() => setIsSecurityOpen(true)}
                            className="px-4 py-2 rounded-md border border-border-primary text-sm font-medium text-text-primary hover:bg-bg-tertiary focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-ring-focus focus:ring-offset-bg-primary"
                        >
                            Открыть настройки безопасности
                        </button>
                    </div>

                    <div className="pt-6 border-t border-border-primary">
                        <h3 className="text-lg font-semibold text-text-primary mb-3">Транскрипция голосовых</h3>
                        <div className="space-y-4">
                            <div className="flex items-center justify-between gap-4">
                                <div>
                                    <p className="text-sm font-medium text-text-primary">Автоматическая расшифровка аудио и видео</p>
                                    <p className="text-xs text-text-secondary">
                                        {transcriptionConfigured
                                            ? `Провайдер: ${runtimeTranscription.provider === 'cloud' ? 'облачный сервис' : 'локальный Whisper.cpp'}`
                                            : 'Укажите endpoint в .env для активации сервиса.'}
                                    </p>
                                </div>
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input
                                        type="checkbox"
                                        className="sr-only peer"
                                        checked={transcriptionEnabled}
                                        onChange={(event) => setTranscriptionEnabled(event.target.checked)}
                                        disabled={!transcriptionConfigured}
                                    />
                                    <div className={`w-11 h-6 rounded-full transition-colors ${
                                        transcriptionEnabled && transcriptionConfigured ? 'bg-accent' : 'bg-bg-tertiary'
                                    }`}></div>
                                    <div className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${
                                        transcriptionEnabled && transcriptionConfigured ? 'translate-x-5' : ''
                                    }`}></div>
                                </label>
                            </div>
                            <div>
                                <label htmlFor="transcriptionLanguage" className="block text-sm font-medium text-text-secondary mb-1">
                                    Язык распознавания
                                </label>
                                <select
                                    id="transcriptionLanguage"
                                    value={transcriptionLanguage}
                                    onChange={(event) => setTranscriptionLanguage(event.target.value)}
                                    disabled={!transcriptionEnabled}
                                    className="block w-full px-3 py-2 border border-border-primary bg-bg-secondary text-text-primary rounded-md focus:outline-none focus:ring-ring-focus focus:border-ring-focus sm:text-sm disabled:opacity-60"
                                >
                                    {TRANSCRIPTION_LANG_OPTIONS.map(option => (
                                        <option key={option.value || 'default'} value={option.value}>{option.label}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label htmlFor="transcriptionMaxDuration" className="block text-sm font-medium text-text-secondary mb-1">
                                    Максимальная длительность, секунд
                                </label>
                                <input
                                    type="number"
                                    id="transcriptionMaxDuration"
                                    min={0}
                                    value={transcriptionMaxDuration}
                                    onChange={(event) => setTranscriptionMaxDuration(event.target.value)}
                                    disabled={!transcriptionEnabled}
                                    className="appearance-none block w-full px-3 py-2 border border-border-primary bg-bg-secondary text-text-primary placeholder-text-secondary rounded-md focus:outline-none focus:ring-ring-focus focus:border-ring-focus sm:text-sm disabled:opacity-60"
                                    placeholder="без ограничений"
                                />
                                <p className="text-xs text-text-secondary mt-1">Оставьте пустым, чтобы не ограничивать продолжительность записи.</p>
                            </div>
                        </div>
                    </div>

                    <div className="pt-6 border-t border-border-primary">
                        <h3 className="text-lg font-semibold text-text-primary mb-3">Перевод сообщений</h3>
                        <div className="space-y-4">
                            <div>
                                <label htmlFor="translationUrl" className="block text-sm font-medium text-text-secondary mb-1">
                                    Базовый URL
                                </label>
                                <input
                                    type="text"
                                    id="translationUrl"
                                    value={translationUrl}
                                    onChange={(e) => setTranslationUrl(e.target.value)}
                                    className="appearance-none block w-full px-3 py-2 border border-border-primary bg-bg-secondary text-text-primary placeholder-text-secondary rounded-md focus:outline-none focus:ring-ring-focus focus:border-ring-focus sm:text-sm"
                                    placeholder="https://example.com/api/translate"
                                />
                                <p className="text-xs text-text-secondary mt-1">Если пусто, перевод отключен.</p>
                            </div>
                            <div>
                                <label htmlFor="translationApiKey" className="block text-sm font-medium text-text-secondary mb-1">
                                    API‑ключ
                                </label>
                                <input
                                    type="text"
                                    id="translationApiKey"
                                    value={translationApiKey}
                                    onChange={(e) => setTranslationApiKey(e.target.value)}
                                    className="appearance-none block w-full px-3 py-2 border border-border-primary bg-bg-secondary text-text-primary placeholder-text-secondary rounded-md focus:outline-none focus:ring-ring-focus focus:border-ring-focus sm:text-sm"
                                    placeholder="опционально"
                                />
                                <p className="text-xs text-text-secondary mt-1">Синхронизируется с локальным хранилищем и Matrix Account Data.</p>
                            </div>
                        </div>
                    </div>

                    <div className="pt-6 border-t border-border-primary">
                        <PluginsPanel />
                    </div>

                    <div className="pt-6 border-t border-border-primary">
                        <AutomationsPanel client={client} />
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
        <SecuritySettings
            client={client}
            isOpen={isSecurityOpen}
            onClose={() => setIsSecurityOpen(false)}
            presenceHidden={isPresenceHidden}
            onSetPresenceHidden={onSetPresenceHidden}
            presenceRestricted={presenceRestricted}
        />
    </div>
    );
};

export default SettingsModal;