import React, { useEffect, useMemo, useState } from 'react';
import {
    type AutomationAction,
    type AutomationActionAssignRole,
    type AutomationActionInvokePlugin,
    type AutomationActionSendMessage,
    type AutomationCondition,
    type AutomationConditionOperator,
    type AutomationRule,
    type AutomationTrigger,
} from '@matrix-messenger/core';

type AutomationRuleInput = Omit<AutomationRule, 'status' | 'lastRunAt' | 'lastError'> & {
    id?: string;
};

interface AutomationBuilderModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (rule: AutomationRuleInput) => Promise<void> | void;
    initialRule?: AutomationRule | null;
    availableRooms: Array<{ roomId: string; name: string }>;
    availableConnectors: Array<{ id: string; name: string }>;
    isSaving?: boolean;
}

const DEFAULT_EVENT_TYPE = 'm.room.message';

const AutomationBuilderModal: React.FC<AutomationBuilderModalProps> = ({
    isOpen,
    onClose,
    onSave,
    initialRule = null,
    availableRooms,
    availableConnectors,
    isSaving = false,
}) => {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [enabled, setEnabled] = useState(true);
    const [triggerType, setTriggerType] = useState<'room_event' | 'webhook'>('room_event');
    const [eventType, setEventType] = useState(DEFAULT_EVENT_TYPE);
    const [triggerRoomId, setTriggerRoomId] = useState('');
    const [webhookEvent, setWebhookEvent] = useState('');
    const [webhookConnectorId, setWebhookConnectorId] = useState('');
    const [conditions, setConditions] = useState<AutomationCondition[]>([]);
    const [includeSendMessage, setIncludeSendMessage] = useState(true);
    const [messageRoomId, setMessageRoomId] = useState('');
    const [messageBody, setMessageBody] = useState('Автоматическое сообщение');
    const [assignRoleEnabled, setAssignRoleEnabled] = useState(false);
    const [assignRoleRoomId, setAssignRoleRoomId] = useState('');
    const [assignRoleUserId, setAssignRoleUserId] = useState('');
    const [assignRoleRole, setAssignRoleRole] = useState('');
    const [assignRoleReason, setAssignRoleReason] = useState('');
    const [invokePluginEnabled, setInvokePluginEnabled] = useState(false);
    const [invokePluginId, setInvokePluginId] = useState('');
    const [invokePluginEvent, setInvokePluginEvent] = useState('');
    const [invokePluginPayload, setInvokePluginPayload] = useState('');
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!isOpen) {
            return;
        }
        if (!initialRule) {
            setName('');
            setDescription('');
            setEnabled(true);
            setTriggerType('room_event');
            setEventType(DEFAULT_EVENT_TYPE);
            setTriggerRoomId('');
            setWebhookEvent('');
            setWebhookConnectorId('');
            setConditions([]);
            setIncludeSendMessage(true);
            setMessageRoomId('');
            setMessageBody('Автоматическое сообщение');
            setAssignRoleEnabled(false);
            setAssignRoleRoomId('');
            setAssignRoleUserId('');
            setAssignRoleRole('');
            setAssignRoleReason('');
            setInvokePluginEnabled(false);
            setInvokePluginId('');
            setInvokePluginEvent('');
            setInvokePluginPayload('');
            setError(null);
            return;
        }
        setName(initialRule.name ?? '');
        setDescription(initialRule.description ?? '');
        setEnabled(initialRule.enabled !== false);
        const primaryTrigger = initialRule.triggers[0];
        if (primaryTrigger?.type === 'webhook') {
            setTriggerType('webhook');
            setWebhookEvent(primaryTrigger.event);
            setWebhookConnectorId(primaryTrigger.connectorId ?? '');
            setEventType(DEFAULT_EVENT_TYPE);
            setTriggerRoomId('');
        } else {
            setTriggerType('room_event');
            if (primaryTrigger?.type === 'room_event') {
                setEventType(primaryTrigger.eventType ?? DEFAULT_EVENT_TYPE);
                setTriggerRoomId(primaryTrigger.roomId ?? '');
            } else {
                setEventType(DEFAULT_EVENT_TYPE);
                setTriggerRoomId('');
            }
            setWebhookEvent('');
            setWebhookConnectorId('');
        }
        setConditions(initialRule.conditions?.map(condition => ({ ...condition })) ?? []);

        const sendMessageAction = initialRule.actions.find(action => action.type === 'send_message') as AutomationActionSendMessage | undefined;
        if (sendMessageAction) {
            setIncludeSendMessage(true);
            setMessageRoomId(sendMessageAction.roomId ?? '');
            setMessageBody(sendMessageAction.content?.plain ?? '');
        } else {
            setIncludeSendMessage(false);
            setMessageRoomId('');
            setMessageBody('Автоматическое сообщение');
        }

        const assignRoleAction = initialRule.actions.find(action => action.type === 'assign_role') as AutomationActionAssignRole | undefined;
        if (assignRoleAction) {
            setAssignRoleEnabled(true);
            setAssignRoleRoomId(assignRoleAction.roomId);
            setAssignRoleUserId(assignRoleAction.userId);
            setAssignRoleRole(assignRoleAction.role);
            setAssignRoleReason(assignRoleAction.reason ?? '');
        } else {
            setAssignRoleEnabled(false);
            setAssignRoleRoomId('');
            setAssignRoleUserId('');
            setAssignRoleRole('');
            setAssignRoleReason('');
        }

        const pluginAction = initialRule.actions.find(action => action.type === 'invoke_plugin') as AutomationActionInvokePlugin | undefined;
        if (pluginAction) {
            setInvokePluginEnabled(true);
            setInvokePluginId(pluginAction.pluginId);
            setInvokePluginEvent(pluginAction.event ?? '');
            setInvokePluginPayload(pluginAction.payload ? JSON.stringify(pluginAction.payload, null, 2) : '');
        } else {
            setInvokePluginEnabled(false);
            setInvokePluginId('');
            setInvokePluginEvent('');
            setInvokePluginPayload('');
        }
        setError(null);
    }, [isOpen, initialRule]);

    const roomOptions = useMemo(() => (
        [{ roomId: '', name: 'Любая комната' }, ...availableRooms]
    ), [availableRooms]);

    if (!isOpen) {
        return null;
    }

    const handleBackdropClick = (event: React.MouseEvent<HTMLDivElement>) => {
        if (event.target === event.currentTarget) {
            onClose();
        }
    };

    const addCondition = () => {
        setConditions(prev => ([...prev, { field: 'content.body', operator: 'contains', value: '' }]));
    };

    const updateCondition = (index: number, patch: Partial<AutomationCondition>) => {
        setConditions(prev => prev.map((condition, idx) => (
            idx === index
                ? { ...condition, ...patch }
                : condition
        )));
    };

    const removeCondition = (index: number) => {
        setConditions(prev => prev.filter((_, idx) => idx !== index));
    };

    const buildTriggers = (): AutomationTrigger[] => {
        if (triggerType === 'webhook') {
            return [{
                type: 'webhook',
                event: webhookEvent.trim(),
                connectorId: webhookConnectorId.trim() || undefined,
            }];
        }
        return [{
            type: 'room_event',
            eventType: eventType.trim() || DEFAULT_EVENT_TYPE,
            roomId: triggerRoomId || undefined,
        }];
    };

    const buildActions = (): AutomationAction[] => {
        const actions: AutomationAction[] = [];
        if (includeSendMessage) {
            actions.push({
                type: 'send_message',
                roomId: messageRoomId || undefined,
                content: {
                    plain: messageBody,
                    formatted: undefined,
                    attachments: [],
                    msgtype: 'm.text',
                },
            });
        }
        if (assignRoleEnabled) {
            actions.push({
                type: 'assign_role',
                roomId: assignRoleRoomId,
                userId: assignRoleUserId,
                role: assignRoleRole,
                reason: assignRoleReason || undefined,
            });
        }
        if (invokePluginEnabled) {
            let payload: Record<string, unknown> | undefined;
            if (invokePluginPayload.trim().length > 0) {
                try {
                    payload = JSON.parse(invokePluginPayload);
                } catch (parseError) {
                    throw new Error('Некорректный JSON в данных для плагина.');
                }
            }
            actions.push({
                type: 'invoke_plugin',
                pluginId: invokePluginId,
                event: invokePluginEvent || undefined,
                payload,
            });
        }
        return actions;
    };

    const handleSave = async () => {
        try {
            if (triggerType === 'webhook' && !webhookEvent.trim()) {
                setError('Укажите идентификатор события webhook.');
                return;
            }
            if (triggerType === 'room_event' && !eventType.trim()) {
                setError('Укажите тип события Matrix.');
                return;
            }
            if (assignRoleEnabled && (!assignRoleRoomId || !assignRoleUserId.trim() || !assignRoleRole.trim())) {
                setError('Заполните комнату, пользователя и роль для назначения.');
                return;
            }
            if (invokePluginEnabled && !invokePluginId.trim()) {
                setError('Укажите идентификатор плагина.');
                return;
            }
            const sanitizedConditions = conditions
                .map(condition => ({
                    field: condition.field.trim(),
                    operator: (condition.operator ?? 'equals') as AutomationConditionOperator,
                    value: condition.value,
                }))
                .filter(condition => condition.field.length > 0 && condition.value !== '');

            const actions = buildActions();
            if (actions.length === 0) {
                setError('Добавьте хотя бы одно действие.');
                return;
            }

            const triggers = buildTriggers();
            const rule: AutomationRuleInput = {
                id: initialRule?.id,
                name: name.trim() || 'Новая автоматизация',
                description: description.trim() || undefined,
                enabled,
                triggers,
                conditions: sanitizedConditions,
                actions,
            };
            setError(null);
            await onSave(rule);
            onClose();
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : 'Не удалось сохранить правило');
        }
    };

    const renderConditionRow = (condition: AutomationCondition, index: number) => (
        <div key={index} className="grid grid-cols-12 gap-2 items-center">
            <input
                type="text"
                value={condition.field}
                onChange={(event) => updateCondition(index, { field: event.target.value })}
                className="col-span-5 px-2 py-1 border border-border-primary rounded bg-bg-secondary text-sm"
                placeholder="content.body"
            />
            <select
                value={condition.operator}
                onChange={(event) => updateCondition(index, { operator: event.target.value as AutomationConditionOperator })}
                className="col-span-3 px-2 py-1 border border-border-primary rounded bg-bg-secondary text-sm"
            >
                <option value="equals">Равно</option>
                <option value="contains">Содержит</option>
                <option value="matches">Регулярное выражение</option>
            </select>
            <input
                type="text"
                value={condition.value}
                onChange={(event) => updateCondition(index, { value: event.target.value })}
                className="col-span-3 px-2 py-1 border border-border-primary rounded bg-bg-secondary text-sm"
                placeholder="значение"
            />
            <button
                type="button"
                className="col-span-1 text-sm text-text-secondary hover:text-red-400"
                onClick={() => removeCondition(index)}
            >
                ✕
            </button>
        </div>
    );

    return (
        <div className="fixed inset-0 bg-bg-secondary/70 flex items-center justify-center z-50" onClick={handleBackdropClick}>
            <div className="bg-bg-primary rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={event => event.stopPropagation()}>
                <header className="px-6 py-4 border-b border-border-primary flex items-center justify-between">
                    <div>
                        <h2 className="text-lg font-semibold text-text-primary">{initialRule ? 'Редактировать автоматизацию' : 'Новая автоматизация'}</h2>
                        <p className="text-sm text-text-secondary">Соберите правило для автоматического реагирования на события или вебхуки.</p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="text-text-secondary hover:text-text-primary"
                    >
                        ✕
                    </button>
                </header>

                <div className="px-6 py-4 space-y-6">
                    {error && (
                        <div className="p-3 rounded-md bg-red-500/10 text-sm text-red-400 border border-red-500/40">{error}</div>
                    )}

                    <section className="space-y-3">
                        <div className="flex flex-col gap-2">
                            <label className="text-sm font-medium text-text-secondary">Название</label>
                            <input
                                type="text"
                                value={name}
                                onChange={(event) => setName(event.target.value)}
                                className="px-3 py-2 border border-border-primary rounded-md bg-bg-secondary text-text-primary"
                                placeholder="Например, Ответ на ключевое слово"
                            />
                        </div>
                        <div className="flex flex-col gap-2">
                            <label className="text-sm font-medium text-text-secondary">Описание</label>
                            <textarea
                                value={description}
                                onChange={(event) => setDescription(event.target.value)}
                                className="px-3 py-2 border border-border-primary rounded-md bg-bg-secondary text-text-primary min-h-[72px]"
                                placeholder="Добавьте пояснение для коллег"
                            />
                        </div>
                        <label className="inline-flex items-center gap-2 text-sm text-text-primary">
                            <input
                                type="checkbox"
                                checked={enabled}
                                onChange={(event) => setEnabled(event.target.checked)}
                                className="h-4 w-4"
                            />
                            Автоматизация активна
                        </label>
                    </section>

                    <section className="space-y-4">
                        <div>
                            <h3 className="text-sm font-semibold text-text-primary mb-2">Источник</h3>
                            <div className="flex gap-4 text-sm">
                                <label className="flex items-center gap-2">
                                    <input
                                        type="radio"
                                        name="automationTriggerType"
                                        value="room_event"
                                        checked={triggerType === 'room_event'}
                                        onChange={() => setTriggerType('room_event')}
                                    />
                                    Событие Matrix
                                </label>
                                <label className="flex items-center gap-2">
                                    <input
                                        type="radio"
                                        name="automationTriggerType"
                                        value="webhook"
                                        checked={triggerType === 'webhook'}
                                        onChange={() => setTriggerType('webhook')}
                                    />
                                    Webhook Bot Bridge
                                </label>
                            </div>
                        </div>

                        {triggerType === 'room_event' ? (
                            <div className="space-y-3">
                                <div className="flex flex-col gap-1">
                                    <label className="text-xs text-text-secondary">Тип события</label>
                                    <input
                                        type="text"
                                        value={eventType}
                                        onChange={(event) => setEventType(event.target.value)}
                                        className="px-3 py-2 border border-border-primary rounded-md bg-bg-secondary text-sm"
                                        placeholder="m.room.message"
                                    />
                                </div>
                                <div className="flex flex-col gap-1">
                                    <label className="text-xs text-text-secondary">Комната</label>
                                    <select
                                        value={triggerRoomId}
                                        onChange={(event) => setTriggerRoomId(event.target.value)}
                                        className="px-3 py-2 border border-border-primary rounded-md bg-bg-secondary text-sm"
                                    >
                                        {roomOptions.map(room => (
                                            <option key={room.roomId || 'any'} value={room.roomId}>{room.name || room.roomId}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                <div className="flex flex-col gap-1">
                                    <label className="text-xs text-text-secondary">Webhook событие</label>
                                    <input
                                        type="text"
                                        value={webhookEvent}
                                        onChange={(event) => setWebhookEvent(event.target.value)}
                                        className="px-3 py-2 border border-border-primary rounded-md bg-bg-secondary text-sm"
                                        placeholder="invite"
                                    />
                                </div>
                                <div className="flex flex-col gap-1">
                                    <label className="text-xs text-text-secondary">Коннектор</label>
                                    <select
                                        value={webhookConnectorId}
                                        onChange={(event) => setWebhookConnectorId(event.target.value)}
                                        className="px-3 py-2 border border-border-primary rounded-md bg-bg-secondary text-sm"
                                    >
                                        <option value="">Любой</option>
                                        {availableConnectors.map(connector => (
                                            <option key={connector.id} value={connector.id}>{connector.name}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        )}
                    </section>

                    <section className="space-y-3">
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-semibold text-text-primary">Фильтры</h3>
                            <button
                                type="button"
                                className="text-xs text-accent hover:underline"
                                onClick={addCondition}
                            >
                                Добавить фильтр
                            </button>
                        </div>
                        {conditions.length === 0 ? (
                            <p className="text-xs text-text-secondary">Фильтры не заданы — правило будет срабатывать всегда.</p>
                        ) : (
                            <div className="space-y-2">
                                {conditions.map((condition, index) => renderConditionRow(condition, index))}
                            </div>
                        )}
                    </section>

                    <section className="space-y-4">
                        <h3 className="text-sm font-semibold text-text-primary">Действия</h3>
                        <div className="space-y-3">
                            <label className="flex items-center gap-2 text-sm text-text-primary">
                                <input
                                    type="checkbox"
                                    checked={includeSendMessage}
                                    onChange={(event) => setIncludeSendMessage(event.target.checked)}
                                />
                                Отправить сообщение
                            </label>
                            {includeSendMessage && (
                                <div className="space-y-2 border border-border-primary rounded-md p-3 bg-bg-secondary/40">
                                    <div className="flex flex-col gap-1">
                                        <label className="text-xs text-text-secondary">Комната для сообщения</label>
                                        <select
                                            value={messageRoomId}
                                            onChange={(event) => setMessageRoomId(event.target.value)}
                                            className="px-3 py-2 border border-border-primary rounded-md bg-bg-secondary text-sm"
                                        >
                                            {roomOptions.map(room => (
                                                <option key={room.roomId || 'any'} value={room.roomId}>{room.name || room.roomId}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="flex flex-col gap-1">
                                        <label className="text-xs text-text-secondary">Текст</label>
                                        <textarea
                                            value={messageBody}
                                            onChange={(event) => setMessageBody(event.target.value)}
                                            className="px-3 py-2 border border-border-primary rounded-md bg-bg-secondary text-sm min-h-[80px]"
                                        />
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="space-y-3">
                            <label className="flex items-center gap-2 text-sm text-text-primary">
                                <input
                                    type="checkbox"
                                    checked={assignRoleEnabled}
                                    onChange={(event) => setAssignRoleEnabled(event.target.checked)}
                                />
                                Выдать роль
                            </label>
                            {assignRoleEnabled && (
                                <div className="grid grid-cols-2 gap-3 border border-border-primary rounded-md p-3 bg-bg-secondary/40">
                                    <div className="flex flex-col gap-1">
                                        <label className="text-xs text-text-secondary">Комната</label>
                                        <select
                                            value={assignRoleRoomId}
                                            onChange={(event) => setAssignRoleRoomId(event.target.value)}
                                            className="px-3 py-2 border border-border-primary rounded-md bg-bg-secondary text-sm"
                                        >
                                            {availableRooms.map(room => (
                                                <option key={room.roomId} value={room.roomId}>{room.name || room.roomId}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="flex flex-col gap-1">
                                        <label className="text-xs text-text-secondary">Пользователь</label>
                                        <input
                                            type="text"
                                            value={assignRoleUserId}
                                            onChange={(event) => setAssignRoleUserId(event.target.value)}
                                            className="px-3 py-2 border border-border-primary rounded-md bg-bg-secondary text-sm"
                                            placeholder="@user:homeserver"
                                        />
                                    </div>
                                    <div className="flex flex-col gap-1">
                                        <label className="text-xs text-text-secondary">Роль</label>
                                        <input
                                            type="text"
                                            value={assignRoleRole}
                                            onChange={(event) => setAssignRoleRole(event.target.value)}
                                            className="px-3 py-2 border border-border-primary rounded-md bg-bg-secondary text-sm"
                                            placeholder="moderator"
                                        />
                                    </div>
                                    <div className="flex flex-col gap-1">
                                        <label className="text-xs text-text-secondary">Комментарий</label>
                                        <input
                                            type="text"
                                            value={assignRoleReason}
                                            onChange={(event) => setAssignRoleReason(event.target.value)}
                                            className="px-3 py-2 border border-border-primary rounded-md bg-bg-secondary text-sm"
                                            placeholder="Опционально"
                                        />
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="space-y-3">
                            <label className="flex items-center gap-2 text-sm text-text-primary">
                                <input
                                    type="checkbox"
                                    checked={invokePluginEnabled}
                                    onChange={(event) => setInvokePluginEnabled(event.target.checked)}
                                />
                                Вызвать плагин
                            </label>
                            {invokePluginEnabled && (
                                <div className="space-y-2 border border-border-primary rounded-md p-3 bg-bg-secondary/40">
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="flex flex-col gap-1">
                                            <label className="text-xs text-text-secondary">Идентификатор плагина</label>
                                            <input
                                                type="text"
                                                value={invokePluginId}
                                                onChange={(event) => setInvokePluginId(event.target.value)}
                                                className="px-3 py-2 border border-border-primary rounded-md bg-bg-secondary text-sm"
                                            />
                                        </div>
                                        <div className="flex flex-col gap-1">
                                            <label className="text-xs text-text-secondary">Событие</label>
                                            <input
                                                type="text"
                                                value={invokePluginEvent}
                                                onChange={(event) => setInvokePluginEvent(event.target.value)}
                                                className="px-3 py-2 border border-border-primary rounded-md bg-bg-secondary text-sm"
                                                placeholder="automation.trigger"
                                            />
                                        </div>
                                    </div>
                                    <div className="flex flex-col gap-1">
                                        <label className="text-xs text-text-secondary">Данные (JSON)</label>
                                        <textarea
                                            value={invokePluginPayload}
                                            onChange={(event) => setInvokePluginPayload(event.target.value)}
                                            className="px-3 py-2 border border-border-primary rounded-md bg-bg-secondary text-sm min-h-[80px] font-mono"
                                            placeholder="{ &quot;key&quot;: &quot;value&quot; }"
                                        />
                                    </div>
                                </div>
                            )}
                        </div>
                    </section>
                </div>

                <footer className="px-6 py-4 border-t border-border-primary flex justify-end gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 text-sm border border-border-primary rounded-md text-text-secondary hover:text-text-primary"
                        disabled={isSaving}
                    >
                        Отмена
                    </button>
                    <button
                        type="button"
                        onClick={handleSave}
                        className="px-4 py-2 text-sm bg-accent text-text-inverted rounded-md disabled:opacity-60"
                        disabled={isSaving}
                    >
                        {isSaving ? 'Сохранение…' : 'Сохранить'}
                    </button>
                </footer>
            </div>
        </div>
    );
};

export default AutomationBuilderModal;

