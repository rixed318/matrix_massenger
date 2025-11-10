import type { GifFavorite, MatrixUser } from '@matrix-messenger/core';

export const VIDEO_MAX_DURATION_SECONDS = 30;

export const formatFileSize = (size: number): string => {
  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (size >= 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${size} B`;
};

export const createAttachmentId = (): string => `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const mergeGifFavorites = (local: GifFavorite[], remote: GifFavorite[]): GifFavorite[] => {
  const map = new Map<string, GifFavorite>();
  for (const entry of local) {
    map.set(entry.id, entry);
  }
  for (const entry of remote) {
    const existing = map.get(entry.id);
    if (!existing) {
      map.set(entry.id, entry);
      continue;
    }
    const updated: GifFavorite = {
      ...existing,
      ...entry,
      addedAt: Math.max(existing.addedAt ?? 0, entry.addedAt ?? 0),
    };
    map.set(entry.id, updated);
  }
  return Array.from(map.values()).sort((a, b) => b.addedAt - a.addedAt);
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const renderMarkdown = (value: string, roomMembers: MatrixUser[]): string => {
  if (!value) {
    return '';
  }

  const memberByName = new Map<string, MatrixUser>();
  roomMembers.forEach(member => {
    if (member.displayName) {
      memberByName.set(member.displayName, member);
    }
    memberByName.set(member.userId, member);
  });

  let html = escapeHtml(value);

  html = html.replace(/\[([^\]]+)\]\((https?:[^\s)]+)\)/g, (_match, text: string, url: string) => {
    const safeText = text;
    const safeUrl = escapeHtml(url);
    return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeText}</a>`;
  });

  html = html.replace(/`([^`]+)`/g, (_match, content: string) => `<code>${content}</code>`);
  html = html.replace(/\*\*([^*]+)\*\*/g, (_match, text: string) => `<strong>${text}</strong>`);
  html = html.replace(/__([^_]+)__/g, (_match, text: string) => `<strong>${text}</strong>`);
  html = html.replace(/~~([^~]+)~~/g, (_match, text: string) => `<s>${text}</s>`);
  html = html.replace(/\*([^*]+)\*/g, (_match, text: string) => `<em>${text}</em>`);
  html = html.replace(/_([^_]+)_/g, (_match, text: string) => `<em>${text}</em>`);

  html = html.replace(/@([A-Za-z0-9._-]+)/g, (match: string, name: string) => {
    const member = memberByName.get(name);
    if (!member) {
      return match;
    }
    const display = escapeHtml(member.displayName ?? member.userId);
    return `<a href="https://matrix.to/#/${member.userId}" rel="noopener noreferrer">@${display}</a>`;
  });

  return html.replace(/\n/g, '<br/>');
};
