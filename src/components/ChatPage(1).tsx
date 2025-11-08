import React, { useEffect, useMemo, useState, useCallback } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';
import ChatHeader from './ChatHeader';
import { attachSelfDestructMarker, getRoomSelfDestructConfig, scheduleSelfDestructRedaction, ensureCryptoReady, startAutoBackupLoop, onDevicesUpdated } from '@matrix-messenger/core';
import { sendMessage } from '@matrix-messenger/core';

type Props = { client: MatrixClient; room: any; };

const ChatPage: React.FC<Props> = ({ client, room }) => {
  const roomId = room?.roomId as string;
  const [disposers, setDisposers] = useState<(() => void)[]>([]);

  // 1) E2EE bootstrap on mount
  useEffect(() => {
    let stopBackup: (() => void)|null = null;
    (async () => {
      await ensureCryptoReady(client, { setupNewSecretStorage: true, setupNewKeyBackup: true });
      stopBackup = startAutoBackupLoop(client, 'matrix_room_keys', async () => {
        // Provide passphrase to encrypt backup in Tauri secure store.
        // Replace with your UX.
        return 'change-me-dev-pass';
      });
    })();
    const offDevices = onDevicesUpdated(client, (userIds) => {
      console.log('Devices updated', userIds);
    });
    setDisposers([offDevices, () => stopBackup?.()]);

    return () => {
      for (const d of disposers) try { d(); } catch {}
    };
  }, [client]);

  // 2) Send message with TTL
  const handleSend = useCallback(async (text: string) => {
    const cfg = await getRoomSelfDestructConfig(client, roomId);
    let content = { body: text, msgtype: 'm.text' } as any;
    content = attachSelfDestructMarker(content, cfg.ttlSeconds);
    const { event_id } = await sendMessage(client, roomId, text);
    if (cfg.ttlSeconds) scheduleSelfDestructRedaction(client, roomId, event_id, cfg.ttlSeconds);
  }, [client, roomId]);

  return (
    <div className="flex flex-col h-full">
      <ChatHeader
        client={client}
        room={room}
        typingUsers={[]}
        canInvite={true}
        onOpenInvite={()=>{}}
      />
      <div className="flex-1" />
      <div className="p-3 border-t">
        <button className="px-3 py-1 border rounded" onClick={() => handleSend('Test message')}>Send test</button>
      </div>
    </div>
  );
};

export default ChatPage;
