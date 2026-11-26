import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { roomMembers, rooms, users, type Room } from '../database/schema.js';

@Injectable()
export class RoomsService {
  constructor(@InjectDrizzle() private readonly db: NodePgDatabase) {}

  /** Creates a room with its creator as the first member. */
  create(userId: string, name: string): Promise<Room> {
    return this.db.transaction(async (tx) => {
      const [room] = await tx.insert(rooms).values({ name }).returning();
      await tx.insert(roomMembers).values({ roomId: room.id, userId });
      return room;
    });
  }

  findMine(userId: string): Promise<Room[]> {
    return this.db
      .select({ id: rooms.id, name: rooms.name, createdAt: rooms.createdAt })
      .from(rooms)
      .innerJoin(roomMembers, eq(roomMembers.roomId, rooms.id))
      .where(eq(roomMembers.userId, userId))
      .orderBy(asc(rooms.name), asc(rooms.id));
  }

  /** A member adds another user, by email. Adding a member twice changes nothing. */
  async addMember(userId: string, roomId: string, email: string): Promise<void> {
    // One statement: the caller must be a member, and the user must exist.
    const added = await this.db
      .insert(roomMembers)
      .select((qb) =>
        qb
          .select({ roomId: roomMembers.roomId, userId: users.id })
          .from(roomMembers)
          .innerJoin(users, eq(users.email, normalize(email)))
          .where(this.membership(userId, roomId)),
      )
      .onConflictDoNothing()
      .returning({ userId: roomMembers.userId });
    if (added.length === 0) {
      // Not added: find out why, for the status code.
      await this.assertMember(userId, roomId);
      const [user] = await this.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, normalize(email)));
      if (!user) {
        throw new NotFoundException('User not found');
      }
      // Otherwise, they were a member already.
    }
  }

  async leave(userId: string, roomId: string): Promise<void> {
    const left = await this.db
      .delete(roomMembers)
      .where(this.membership(userId, roomId))
      .returning({ userId: roomMembers.userId });
    if (left.length === 0) {
      notFound();
    }
  }

  /** 404 unless the user is a member: other people's rooms are as missing as rooms that don't exist. */
  async assertMember(userId: string, roomId: string): Promise<void> {
    const [member] = await this.db
      .select({ one: sql`1` })
      .from(roomMembers)
      .where(this.membership(userId, roomId));
    if (!member) {
      notFound();
    }
  }

  private membership(userId: string, roomId: string) {
    return and(eq(roomMembers.roomId, roomId), eq(roomMembers.userId, userId));
  }
}

function notFound(): never {
  throw new NotFoundException('Room not found');
}

const normalize = (email: string) => email.trim().normalize('NFC').toLowerCase();
