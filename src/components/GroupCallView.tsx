
import React, { useEffect, useRef } from 'react';
import CallParticipantsPanel, { Participant } from './CallParticipantsPanel';

export interface GroupCallState {
  roomId: string;
  url: string;
  participants: Participant[];
  layout: 'grid' | 'spotlight';
  isScreensharing: boolean;
}

interface Props {
  state: GroupCallState;
  onClose: () => void;
  onParticipantsUpdate: (list: Participant[]) => void;
  onToggleScreenshare: () => void;
  onLayoutChange: (layout: 'grid' | 'spotlight') => void;
  showParticipants: boolean;
  onHideParticipants: () => void;
}

/**
 * Generic group call container that embeds an SFU page via iframe.
 * Communicates via postMessage:
 *   { type: 'participants-update', participants: Participant[] }
 *   { type: 'layout-changed', layout: 'grid'|'spotlight' }
 */
const GroupCallView: React.FC<Props> = ({
  state, onClose, onParticipantsUpdate, onToggleScreenshare, onLayoutChange,
  showParticipants, onHideParticipants
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const handler = (ev: MessageEvent) => {
      if (!ev?.data || typeof ev.data !== 'object') return;
      if (ev.data.type === 'participants-update' && Array.isArray(ev.data.participants)) {
        onParticipantsUpdate(ev.data.participants);
      }
      if (ev.data.type === 'layout-changed' && (ev.data.layout === 'grid' || ev.data.layout === 'spotlight')) {
        onLayoutChange(ev.data.layout);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [onParticipantsUpdate, onLayoutChange]);

  const postToIframe = (msg: any) => {
    const win = iframeRef.current?.contentWindow;
    if (win) win.postMessage(msg, '*');
  };

  const toggleScreenShare = () => {
    postToIframe({ type: 'toggle-screen-share' });
    onToggleScreenshare();
  };

  const requestLayout = (layout: 'grid'|'spotlight') => {
    postToIframe({ type: 'set-layout', layout });
    onLayoutChange(layout);
  };

  return (
    <div className="fixed inset-0 bg-black/90 z-50">
      <div className="absolute top-4 left-4 right-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            className="px-3 py-1 rounded bg-bg-secondary hover:bg-bg-tertiary"
            onClick={() => requestLayout('grid')}
          >
            Сетка
          </button>
          <button
            className="px-3 py-1 rounded bg-bg-secondary hover:bg-bg-tertiary"
            onClick={() => requestLayout('spotlight')}
          >
            Фокус
          </button>
          <button
            className={`px-3 py-1 rounded ${state.isScreensharing ? 'bg-indigo-600 text-white' : 'bg-bg-secondary hover:bg-bg-tertiary'}`}
            onClick={toggleScreenShare}
            title="Демонстрация экрана"
          >
            Экран
          </button>
          <button
            className="px-3 py-1 rounded bg-bg-secondary hover:bg-bg-tertiary"
            onClick={() => postToIframe({ type: 'request-participants' })}
          >
            Обновить участников
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="px-3 py-1 rounded bg-bg-secondary hover:bg-bg-tertiary"
            onClick={() => postToIframe({ type: 'toggle-mute' })}
          >
            Микрофон
          </button>
          <button
            className="px-3 py-1 rounded bg-bg-secondary hover:bg-bg-tertiary"
            onClick={() => postToIframe({ type: 'toggle-camera' })}
          >
            Камера
          </button>
          <button className="px-3 py-1 rounded bg-red-600 text-white" onClick={onClose}>
            Выйти
          </button>
          <button
            className="px-3 py-1 rounded bg-bg-secondary hover:bg-bg-tertiary"
            onClick={() => (showParticipants ? onHideParticipants() : postToIframe({ type: 'request-participants' }))}
            title="Список участников"
          >
            👥
          </button>
        </div>
      </div>

      <iframe
        ref={iframeRef}
        src={state.url}
        className="absolute inset-0 w-full h-full border-0"
        allow="camera; microphone; display-capture; clipboard-read; clipboard-write"
      />

      {showParticipants && (
        <CallParticipantsPanel participants={state.participants} onClose={onHideParticipants} />
      )}
    </div>
  );
};

export default GroupCallView;
