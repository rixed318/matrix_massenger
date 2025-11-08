import { Sticker } from '../types';

// For this example, we'll use some locally available SVGs.
// In a real app, these would likely be hosted on a CDN or even on the Matrix homeserver.

export const STICKER_PACK: Sticker[] = [
  {
    id: 'smile',
    url: 'https://twemoji.maxcdn.com/v/latest/svg/1f60a.svg',
    body: '😊',
    info: { w: 128, h: 128, mimetype: 'image/svg+xml', size: 1024 }
  },
  {
    id: 'laugh',
    url: 'https://twemoji.maxcdn.com/v/latest/svg/1f602.svg',
    body: '😂',
    info: { w: 128, h: 128, mimetype: 'image/svg+xml', size: 1024 }
  },
  {
    id: 'wink',
    url: 'https://twemoji.maxcdn.com/v/latest/svg/1f609.svg',
    body: '😉',
    info: { w: 128, h: 128, mimetype: 'image/svg+xml', size: 1024 }
  },
  {
    id: 'heart_eyes',
    url: 'https://twemoji.maxcdn.com/v/latest/svg/1f60d.svg',
    body: '😍',
    info: { w: 128, h: 128, mimetype: 'image/svg+xml', size: 1024 }
  },
  {
    id: 'cool',
    url: 'https://twemoji.maxcdn.com/v/latest/svg/1f60e.svg',
    body: '😎',
    info: { w: 128, h: 128, mimetype: 'image/svg+xml', size: 1024 }
  },
  {
    id: 'cry',
    url: 'https://twemoji.maxcdn.com/v/latest/svg/1f622.svg',
    body: '😢',
    info: { w: 128, h: 128, mimetype: 'image/svg+xml', size: 1024 }
  },
   {
    id: 'angry',
    url: 'https://twemoji.maxcdn.com/v/latest/svg/1f621.svg',
    body: '😡',
    info: { w: 128, h: 128, mimetype: 'image/svg+xml', size: 1024 }
  },
  {
    id: 'thinking',
    url: 'https://twemoji.maxcdn.com/v/latest/svg/1f914.svg',
    body: '🤔',
    info: { w: 128, h: 128, mimetype: 'image/svg+xml', size: 1024 }
  },
  {
    id: 'celebrate',
    url: 'https://twemoji.maxcdn.com/v/latest/svg/1f389.svg',
    body: '🎉',
    info: { w: 128, h: 128, mimetype: 'image/svg+xml', size: 1024 }
  },
   {
    id: 'rocket',
    url: 'https://twemoji.maxcdn.com/v/latest/svg/1f680.svg',
    body: '🚀',
    info: { w: 128, h: 128, mimetype: 'image/svg+xml', size: 1024 }
  },
   {
    id: 'fire',
    url: 'https://twemoji.maxcdn.com/v/latest/svg/1f525.svg',
    body: '🔥',
    info: { w: 128, h: 128, mimetype: 'image/svg+xml', size: 1024 }
  },
   {
    id: 'ghost',
    url: 'https://twemoji.maxcdn.com/v/latest/svg/1f47b.svg',
    body: '👻',
    info: { w: 128, h: 128, mimetype: 'image/svg+xml', size: 1024 }
  },
];
