import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ClientEvent } from 'matrix-js-sdk';
import { formatDistanceToNowStrict } from 'date-fns';
import {
    type AutomationRule,
    type AutomationExecutionStatus,
    type MatrixClient,
    getAutomationRules,
    upsertAutomationRule,
    removeAutomationRule,
    toggleAutomationRule,
} from '@matrix-messenger/core';
import AutomationBuilderModal from '../AutomationBuilderModal';
import { listConnectorConfigs } from '../../services/botBridge';

const AUTOMATION_EVENT_TYPE = 'com.matrix_messenger.automation';

type AutomationRuleInput = Omit<AutomationRule, 'status' | 'lastRunAt' | 'lastError'> & { id?: string };

interface AutomationsPanelProps {
    client: MatrixClient;
}

const STATUS_LABELS: Record<AutomationExecutionStatus, string> = {
    idle: 'Ожидает',
    pending: 'В очереди',
    running: 'Выполняется',
    success: 'Успешно',
    error: 'Ошибка',
};

const STATUS_STYLES: Record<AutomationExecutionStatus, string> = {
    idle: 'bg-bg-tertiary text-text-secondary',
    pending: 'bg-amber-500/20 text-amber-300',
    running: 'bg-blue-500/20 text-blue-300',
    success: 'bg-emerald-500/20 text-emerald-300',
    error: 'bg-red-500/20 text-red-300',
};

const describeTrigger = (trigger: AutomationRule['triggers'][number]): string => {
    if (trigger.type === 'webhook') {
        return `Webhook «${trigger.event}»${trigger.connectorId ? ` (${trigger.connectorId})` : ''}`;
    }
    return `Matrix ${trigger.eventType}${trigger.roomId ? ` в ${trigger.roomId}` : ''}`;
};

const describeAction = (action: AutomationRule['actions'][number]): string => {
    switch (action.type) {
        case 'send_message':
            return `Сообщение${action.roomId ? ` → ${action.roomId}` : ''}`;
        case 'assign_role':
            return `Роль ${action.role} для ${action.userId}`;
        case 'invoke_plugin':
            return `Плагин ${action.pluginId}`;
        default:
            return action.type;
    }
};

const AutomationsPanel: React.FC<AutomationsPanelProps> = ({ client }) => {
    const [automations, setAutomations] = useState<AutomationRule[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingRule, setEditingRule] = useState<AutomationRule | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    const rooms = useMemo(() => {
        try {
            const visible = typeof (client as any).getVisibleRooms === 'function'
                ? (client as any).getVisibleRooms()
                : typeof client.getRooms === 'function'
                    ? client.getRooms()
                    : [];
            return (visible ?? [])
                .map((room: any) => {
                    const roomId = room?.roomId ?? '';
                    if (!roomId) {
                        return null;
                    }
                    let name: string | null = null;
                    if (typeof room?.name === 'function') {
                        name = room.name();
                    } else if (typeof room?.name === 'string') {
                        name = room.name;
                    } else if (typeof room?.getCanonicalAlias === 'function') {
                        name = room.getCanonicalAlias();
                    }
                    return { roomId, name: name || roomId };
                })
                .filter((room): room is { roomId: string; name: string } => Boolean(room));
        } catch (roomError) {
            console.warn('Failed to enumerate rooms for automations panel', roomError);
            return [];
        }
    }, [client]);

    const connectors = useMemo(() => (
        listConnectorConfigs().map(connector => ({
            id: connector.id,
            name: connector.manifest?.displayName ?? connector.id,
        }))
    ), []);

    const refresh = useCallback(() => {
        try {
            const rules = getAutomationRules(client);
            setAutomations(rules);
            setError(null);
        } catch (refreshError) {
            setError(refreshError instanceof Error ? refreshError.message : 'Не удалось загрузить автоматизации');
        }
    }, [client]);

    useEffect(() => {
        refresh();
    }, [refresh]);

    useEffect(() => {
        const handler = (event: any) => {
            if (event?.getType?.() !== AUTOMATION_EVENT_TYPE) {
                return;
            }
            refresh();
        };
        client.on(ClientEvent.AccountData as any, handler as any);
        return () => {
            client.removeListener(ClientEvent.AccountData as any, handler as any);
        };
    }, [client, refresh]);

    const handleCreate = () => {
        setEditingRule(null);
        setIsModalOpen(true);
    };

    const handleEdit = (rule: AutomationRule) => {
        setEditingRule(rule);
        setIsModalOpen(true);
    };

    const handleSave = async (input: AutomationRuleInput) => {
        setIsSaving(true);
        try {
            const baseRule: AutomationRule = {
                id: input.id ?? `automation_${Date.now()}`,
                name: input.name,
                description: input.description,
                enabled: input.enabled,
                triggers: input.triggers,
                conditions: input.conditions,
                actions: input.actions,
                status: editingRule?.status ?? 'idle',
                lastRunAt: editingRule?.lastRunAt,
                lastError: editingRule?.lastError,
            };
            await upsertAutomationRule(client, baseRule);
            refresh();
            setIsModalOpen(false);
            setEditingRule(null);
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : 'Не удалось сохранить автоматизацию');
        } finally {
            setIsSaving(false);
        }
    };

    const handleToggle = async (rule: AutomationRule, enabled: boolean) => {
        try {
            await toggleAutomationRule(client, rule.id, enabled);
            refresh();
        } catch (toggleError) {
            setError(toggleError instanceof Error ? toggleError.message : 'Не удалось обновить статус правила');
        }
    };

    const handleDelete = async (rule: AutomationRule) => {
        if (!window.confirm(`Удалить автоматизацию «${rule.name}»?`)) {
            return;
        }
        try {
            await removeAutomationRule(client, rule.id);
            refresh();
        } catch (deleteError) {
            setError(deleteError instanceof Error ? deleteError.message : 'Не удалось удалить правило');
        }
    };

    const renderStatus = (status: AutomationExecutionStatus | undefined) => {
        const effective = status ?? 'idle';
        const label = STATUS_LABELS[effective];
        const style = STATUS_STYLES[effective];
        return <span className={`px-2 py-1 rounded-full text-xs ${style}`}>{label}</span>;
    };

    return (
        <section className="space-y-4">
            <header className="flex items-start justify-between">
                <div>
                    <h3 className="text-lg font-semibold text-text-primary">Автоматизации</h3>
                    <p className="text-sm text-text-secondary">Настройте триггеры, фильтры и действия для автоматических реакций в Matrix Messenger.</p>
                </div>
                <button
                    type="button"
                    onClick={handleCreate}
                    className="px-4 py-2 bg-accent text-text-inverted rounded-md text-sm hover:bg-accent/90"
                >
                    Добавить правило
                </button>
            </header>

            {error && (
                <div className="p-3 rounded-md bg-red-500/10 text-sm text-red-400 border border-red-500/40">{error}</div>
            )}

            {automations.length === 0 ? (
                <div className="text-sm text-text-secondary">Правила автоматизации пока не созданы.</div>
            ) : (
                <div className="space-y-3">
                    {automations.map(rule => (
                        <div key={rule.id} className="border border-border-primary rounded-lg p-4 bg-bg-secondary/40 space-y-3">
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <h4 className="text-base font-semibold text-text-primary">{rule.name}</h4>
                                    {rule.description && (
                                        <p className="text-sm text-text-secondary">{rule.description}</p>
                                    )}
                                </div>
                                {renderStatus(rule.status)}
                            </div>
                            <div className="text-xs text-text-secondary space-y-1">
                                <div><span className="font-semibold text-text-primary">Триггеры:</span> {rule.triggers.map(describeTrigger).join(', ')}</div>
                                {rule.conditions.length > 0 && (
                                    <div><span className="font-semibold text-text-primary">Фильтры:</span> {rule.conditions.map(condition => `${condition.field} ${condition.operator} ${condition.value}`).join('; ')}</div>
                                )}
                                <div><span className="font-semibold text-text-primary">Действия:</span> {rule.actions.map(describeAction).join(', ')}</div>
                                {rule.lastRunAt && (
                                    <div>Последний запуск: {formatDistanceToNowStrict(rule.lastRunAt, { addSuffix: true })}</div>
                                )}
                                {rule.lastError && (
                                    <div className="text-red-300">Ошибка: {rule.lastError}</div>
                                )}
                            </div>
                            <div className="flex items-center gap-2 pt-2">
                                <button
                                    type="button"
                                    onClick={() => handleToggle(rule, !rule.enabled)}
                                    className="px-3 py-1 text-sm rounded-md border border-border-primary text-text-secondary hover:text-text-primary"
                                >
                                    {rule.enabled ? 'Выключить' : 'Включить'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleEdit(rule)}
                                    className="px-3 py-1 text-sm rounded-md border border-border-primary text-text-secondary hover:text-text-primary"
                                >
                                    Редактировать
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleDelete(rule)}
                                    className="px-3 py-1 text-sm rounded-md border border-border-primary text-red-300 hover:text-red-200"
                                >
                                    Удалить
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <AutomationBuilderModal
                isOpen={isModalOpen}
                onClose={() => {
                    if (!isSaving) {
                        setIsModalOpen(false);
                        setEditingRule(null);
                    }
                }}
                onSave={handleSave}
                initialRule={editingRule}
                availableRooms={rooms}
                availableConnectors={connectors}
                isSaving={isSaving}
            />
        </section>
    );
};

export default AutomationsPanel;

