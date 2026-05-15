export type CatAction = 'feed' | 'pet' | 'wash';

export type CatProfile = {
  userId: number;
  name: string;
  kotost: number;
  fedCount: number;
  pettedCount: number;
  washedCount: number;
  pendingName: number;
  lastMessageId: number | null;
  lastInteractionAt: number;
  lastReminderAt: number | null;
};
