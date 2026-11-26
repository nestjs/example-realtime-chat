import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, desc, eq, lt, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { messages, roomMembers, type Message } from '../database/schema.js';
import type { HistoryQuery } from './chat.schemas.js';
import { RoomsService } from './rooms.service.js';

export interface MessagePage {
  /** Newest first. */
  messages: Message[];
  /** Pass as `before` for the next, older page; `null` on the oldest page. */
  nextBefore: number | null;
}

@Injectable()
export class MessagesService {
  constructor(
    @InjectDrizzle() private readonly db: NodePgDatabase,
    private readonly roomsService: RoomsService,
  ) {}

  /** Stores a message, if its author is a member of the room. */
  async post(authorId: string, roomId: string, body: string): Promise<Message> {
    // The membership row is the source of the insert: a non-member's message,
    // or one sent the moment its author left, inserts nothing.
    const [message] = await this.db
      .insert(messages)
      .select((qb) =>
        qb
          .select({ roomId: roomMembers.roomId, authorId: roomMembers.userId, body: sql<string>`${body}`.as('body') })
          .from(roomMembers)
          .where(and(eq(roomMembers.roomId, roomId), eq(roomMembers.userId, authorId))),
      )
      .returning();
    if (!message) {
      throw new NotFoundException('Room not found');
    }
    return message;
  }

  /** A page of a room's history, older than `before`. */
  async history(userId: string, roomId: string, { before, limit }: HistoryQuery): Promise<MessagePage> {
    await this.roomsService.assertMember(userId, roomId);
    const rows = await this.db
      .select()
      .from(messages)
      .where(and(eq(messages.roomId, roomId), before ? lt(messages.id, before) : undefined))
      .orderBy(desc(messages.id))
      // One more than asked for: whether it comes back says if there's an older page.
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    return { messages: page, nextBefore: rows.length > limit ? page[page.length - 1].id : null };
  }
}
