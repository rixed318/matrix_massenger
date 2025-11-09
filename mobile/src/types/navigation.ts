export type RootStackParamList = {
  Login: undefined;
  Chats: undefined;
  Chat: { roomId: string; roomName: string };
  Call: { roomId: string; callId?: string };
};
