import { z } from 'zod';

// Over REST

export const createRoomSchema = z.object({
  name: z.string().trim().min(1).max(100),
});
export type CreateRoomDto = z.infer<typeof createRoomSchema>;

export const addMemberSchema = z.object({
  email: z.email(),
});
export type AddMemberDto = z.infer<typeof addMemberSchema>;

export const historyQuerySchema = z.object({
  // The oldest message id the client has; omit it for the newest page.
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type HistoryQuery = z.infer<typeof historyQuerySchema>;

// Over the socket

export const roomRefSchema = z.object({
  roomId: z.uuid(),
});
export type RoomRef = z.infer<typeof roomRefSchema>;

export const sendMessageSchema = z.object({
  roomId: z.uuid(),
  body: z.string().trim().min(1).max(4_000),
});
export type SendMessageDto = z.infer<typeof sendMessageSchema>;
