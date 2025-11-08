
import React from 'react';

export interface Participant {
  id: string;
  name: string;
  isMuted?: boolean;
  isVideoMuted?: boolean;
  isScreenSharing?: boolean;
  avatarUrl?: string | null;
}

interface Props {
  participants: Participant[];
  onClose?: () => void;
}

const CallParticipantsPanel: React.FC<Props> = ({ participants, onClose }) => {
  return (
    <div className="fixed right-4 top-20 bottom-4 w-80 bg-bg-secondary border border-border-primary rounded-xl shadow-xl p-3 z-50 overflow-y-auto">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold">Участники</h3>
        {onClose && (
          <button className="text-sm px-2 py-1 rounded hover:bg-bg-tertiary" onClick={onClose}>Закрыть</button>
        )}
      </div>
      <ul className="space-y-2">
        {participants.map(p => (
          <li key={p.id} className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-full bg-bg-tertiary overflow-hidden">
              {p.avatarUrl ? <img src={p.avatarUrl} alt={p.name} className="h-full w-full object-cover" /> : null}
            </div>
            <div className="flex-1">
              <div className="text-sm font-medium">{p.name}</div>
              <div className="text-xs text-text-secondary">
                {p.isMuted ? '🔇' : '🎙️'} {p.isVideoMuted ? '📷 off' : '📷 on'} {p.isScreenSharing ? '🖥️' : ''}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default CallParticipantsPanel;
