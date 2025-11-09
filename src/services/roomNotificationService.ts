import { MatrixClient, RoomNotificationMode } from '../types';

interface PushRule {
    rule_id: string;
    enabled?: boolean;
    actions?: any[];
    conditions?: any[];
}

interface PushRulesResponse {
    global?: {
        override?: PushRule[];
        room?: PushRule[];
    };
}

const DEFAULT_ROOM_RULE_ACTIONS = [
    'notify',
    { set_tweak: 'sound', value: 'default' },
    { set_tweak: 'highlight', value: false },
];

const findOverrideRule = (rules: PushRulesResponse | null, roomId: string): PushRule | undefined =>
    rules?.global?.override?.find(rule => rule.rule_id === roomId);

const findRoomRule = (rules: PushRulesResponse | null, roomId: string): PushRule | undefined =>
    rules?.global?.room?.find(rule => rule.rule_id === roomId);

const computeModeFromRules = (rules: PushRulesResponse | null, roomId: string): RoomNotificationMode => {
    const overrideRule = findOverrideRule(rules, roomId);
    if (overrideRule?.enabled) {
        return 'mute';
    }
    const roomRule = findRoomRule(rules, roomId);
    if (roomRule && roomRule.enabled === false) {
        return 'mentions';
    }
    return 'all';
};

export const getRoomNotificationMode = async (
    client: MatrixClient,
    roomId: string,
): Promise<RoomNotificationMode> => {
    try {
        const rules = await client.getPushRules?.();
        return computeModeFromRules(rules as PushRulesResponse, roomId);
    } catch (error) {
        console.warn('Failed to load push rules for room', roomId, error);
        return 'all';
    }
};

export const getRoomNotificationModes = async (
    client: MatrixClient,
    roomIds: string[],
): Promise<Record<string, RoomNotificationMode>> => {
    try {
        const rules = await client.getPushRules?.();
        const response = rules as PushRulesResponse;
        return roomIds.reduce<Record<string, RoomNotificationMode>>((acc, roomId) => {
            acc[roomId] = computeModeFromRules(response, roomId);
            return acc;
        }, {});
    } catch (error) {
        console.warn('Failed to load push rules', error);
        return roomIds.reduce<Record<string, RoomNotificationMode>>((acc, roomId) => {
            acc[roomId] = 'all';
            return acc;
        }, {});
    }
};

const ensureRoomRule = async (
    client: MatrixClient,
    roomId: string,
    rules: PushRulesResponse | null,
): Promise<PushRule | undefined> => {
    let roomRule = findRoomRule(rules, roomId);
    if (roomRule) {
        return roomRule;
    }
    if (typeof (client as any).addPushRule !== 'function') {
        return roomRule;
    }
    try {
        await (client as any).addPushRule('global', 'room', roomId, {
            actions: DEFAULT_ROOM_RULE_ACTIONS,
        });
    } catch (error: any) {
        if (error?.errcode !== 'M_UNKNOWN' && error?.errcode !== 'M_BAD_JSON') {
            console.warn('Failed to add room push rule', error);
        }
    }
    try {
        const refreshed = await client.getPushRules?.();
        roomRule = findRoomRule(refreshed as PushRulesResponse, roomId);
    } catch (error) {
        console.warn('Failed to refresh push rules after adding room rule', error);
    }
    return roomRule;
};

const ensureOverrideRule = async (
    client: MatrixClient,
    roomId: string,
    rules: PushRulesResponse | null,
): Promise<PushRule | undefined> => {
    let overrideRule = findOverrideRule(rules, roomId);
    if (overrideRule) {
        return overrideRule;
    }
    if (typeof (client as any).addPushRule !== 'function') {
        return overrideRule;
    }
    try {
        await (client as any).addPushRule('global', 'override', roomId, {
            actions: ['dont_notify'],
            conditions: [
                { kind: 'event_match', key: 'room_id', pattern: roomId },
            ],
        });
    } catch (error: any) {
        if (error?.errcode !== 'M_UNKNOWN' && error?.errcode !== 'M_BAD_JSON') {
            console.warn('Failed to add override push rule', error);
        }
    }
    try {
        const refreshed = await client.getPushRules?.();
        overrideRule = findOverrideRule(refreshed as PushRulesResponse, roomId);
    } catch (error) {
        console.warn('Failed to refresh push rules after adding override rule', error);
    }
    return overrideRule;
};

export const setRoomNotificationMode = async (
    client: MatrixClient,
    roomId: string,
    mode: RoomNotificationMode,
): Promise<void> => {
    try {
        const rules = await client.getPushRules?.();
        const response = rules as PushRulesResponse;
        let roomRule = findRoomRule(response, roomId);
        let overrideRule = findOverrideRule(response, roomId);

        if (mode === 'mute') {
            overrideRule = await ensureOverrideRule(client, roomId, response);
            if (overrideRule && typeof client.setPushRuleEnabled === 'function') {
                await client.setPushRuleEnabled('global', 'override', roomId, true);
            }
            roomRule = await ensureRoomRule(client, roomId, response);
            if (roomRule && typeof client.setPushRuleEnabled === 'function') {
                await client.setPushRuleEnabled('global', 'room', roomId, false);
            }
            if (overrideRule && typeof (client as any).setPushRuleActions === 'function') {
                await (client as any).setPushRuleActions('global', 'override', roomId, ['dont_notify']);
            }
            return;
        }

        if (overrideRule?.enabled && typeof client.setPushRuleEnabled === 'function') {
            await client.setPushRuleEnabled('global', 'override', roomId, false);
        }

        roomRule = await ensureRoomRule(client, roomId, response);

        if (!roomRule || typeof client.setPushRuleEnabled !== 'function') {
            return;
        }

        const enable = mode === 'all';
        await client.setPushRuleEnabled('global', 'room', roomId, enable);

        if (enable && typeof (client as any).setPushRuleActions === 'function') {
            await (client as any).setPushRuleActions('global', 'room', roomId, DEFAULT_ROOM_RULE_ACTIONS);
        }
    } catch (error) {
        console.error('Failed to update room notification mode', mode, roomId, error);
    }
};
