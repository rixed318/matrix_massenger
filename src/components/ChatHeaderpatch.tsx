import React, { useEffect, useMemo, useState } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';
import { getRoomSelfDestructConfig, setRoomSelfDestructConfig, requestSelfVerification, startSas, bindVerificationListeners, type VerificationUIState } from '../services/e2eeService';

type Props = {
  client: MatrixClient;
  room: any;
  typingUsers: string[];
  canInvite: boolean;
  onOpenInvite: () => void;
  pinnedMessage?: any;
  onPinToggle?: () => void;
  scheduledMessageCount?: number;
  onOpenViewScheduled?: () => void;
  isDirectMessageRoom?: boolean;
  onPlaceCall?: () => void;
  onOpenSearch?: () => void;
};

const TTL_OPTIONS = [
  { label: 'Off', value: null },
  { label: '30s', value: 30 },
  { label: '1m', value: 60 },
  { label: '5m', value: 5 * 60 },
  { label: '1h', value: 60 * 60 },
  { label: '1d', value: 24 * 60 * 60 },
];

const ChatHeader: React.FC<Props> = (props) => {
  const { client, room } = props;
  const roomId = room?.roomId as string;

  // Self-destruct control
  const [ttl, setTtl] = useState<number|null>(null);
  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!roomId) return;
      const cfg = await getRoomSelfDestructConfig(client, roomId);
      if (mounted) setTtl(cfg.ttlSeconds);
    })();
    return () => { mounted = false; };
  }, [client, roomId]);

  const handleChangeTtl = async (value: number|null) => {
    setTtl(value);
    await setRoomSelfDestructConfig(client, roomId, { ttlSeconds: value, scope: 'all' });
  };

  // Device verification via SAS
  const [vState, setVState] = useState<VerificationUIState>({ phase: 'idle', request: null });
  useEffect(() => {
    return bindVerificationListeners(client, (req) => setVState({ phase: 'requested', request: req }));
  }, [client]);

  const startSelfVerify = async () => {
    const req = await requestSelfVerification(client);
    setVState({ phase: 'requested', request: req });
  };

  const startSasFlow = async () => {
    if (!vState.request) return;
    const { verifier, data } = await startSas(vState.request);
    setVState({ phase: 'sas', request: verifier, sas: data });
  };

  const confirmSas = async () => {
    try {
      await (vState.request as any)?.confirm?.();
      setVState({ phase: 'done', request: null });
    } catch {
      setVState({ phase: 'failed', request: null });
    }
  };

  const cancelSas = async () => {
    try { await (vState.request as any)?.cancel?.(); } catch {}
    setVState({ phase: 'canceled', request: null });
  };

  return (
    <div className="flex items-center justify-between px-4 py-2 border-b border-black/10 bg-white/60 backdrop-blur-sm">
      <div className="flex items-center gap-3">
        <div className="font-medium">{room?.name || roomId}</div>
        {props.typingUsers?.length ? (
          <div className="text-xs text-gray-500">{props.typingUsers.join(', ')} typing</div>
        ) : null}
      </div>

      <div className="flex items-center gap-3">
        {/* TTL selector */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">TTL</span>
          <select
            className="text-sm border rounded px-2 py-1 bg-white"
            value={ttl ?? ''}
            onChange={(e) => handleChangeTtl(e.target.value === '' ? null : Number(e.target.value))}
            title="Self-destruct timer for this room"
          >
            {TTL_OPTIONS.map(opt => (
              <option key={String(opt.value)} value={opt.value ?? ''}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Device verification controls */}
        <div className="flex items-center gap-2">
          <button
            className="text-sm border rounded px-2 py-1"
            onClick={startSelfVerify}
            title="Verify this session (SAS/Emoji)"
          >
            Verify session
          </button>
        </div>
      </div>

      {/* SAS modal minimal */}
      {vState.phase !== 'idle' && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center">
          <div className="bg-white rounded-xl p-4 w-[420px] shadow">
            {vState.phase === 'requested' && (
              <div className="space-y-3">
                <div className="font-medium">Verification requested</div>
                <div className="text-sm text-gray-600">Start SAS and compare emoji codes.</div>
                <div className="flex gap-2 justify-end">
                  <button className="px-3 py-1 border rounded" onClick={cancelSas}>Cancel</button>
                  <button className="px-3 py-1 border rounded bg-gray-100" onClick={startSasFlow}>Start</button>
                </div>
              </div>
            )}

            {vState.phase === 'sas' && (
              <div className="space-y-3">
                <div className="font-medium">Compare codes</div>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  {vState.sas?.emojis?.map(([emoji, name], i) => (
                    <div key={i} className="border rounded p-2 text-center">{emoji} <div className="text-xs text-gray-600">{name}</div></div>
                  ))}
                </div>
                {vState.sas?.decimals && (
                  <div className="text-sm text-center mt-2">Digits: {vState.sas.decimals.join(' ')}</div>
                )}
                <div className="flex gap-2 justify-end mt-2">
                  <button className="px-3 py-1 border rounded" onClick={cancelSas}>No match</button>
                  <button className="px-3 py-1 border rounded bg-gray-100" onClick={confirmSas}>Match</button>
                </div>
              </div>
            )}

            {vState.phase === 'done' && (
              <div className="space-y-3 text-center">
                <div className="font-medium">Verified</div>
                <button className="px-3 py-1 border rounded" onClick={() => setVState({ phase: 'idle', request: null })}>Close</button>
              </div>
            )}

            {vState.phase === 'canceled' && (
              <div className="space-y-3 text-center">
                <div className="font-medium">Canceled</div>
                <button className="px-3 py-1 border rounded" onClick={() => setVState({ phase: 'idle', request: null })}>Close</button>
              </div>
            )}

            {vState.phase === 'failed' && (
              <div className="space-y-3 text-center">
                <div className="font-medium">Failed</div>
                <button className="px-3 py-1 border rounded" onClick={() => setVState({ phase: 'idle', request: null })}>Close</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatHeader;
