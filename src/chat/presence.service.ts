import { Injectable } from '@nestjs/common';

/** Who has each room open, on this instance: room id, then socket id, then user id. */
@Injectable()
export class PresenceService {
  private readonly rooms = new Map<string, Map<string, string>>();

  /** Whether this is the user's first socket in the room. */
  add(roomId: string, socketId: string, userId: string): boolean {
    const sockets = this.rooms.get(roomId) ?? new Map<string, string>();
    this.rooms.set(roomId, sockets);
    const first = !this.has(sockets, userId);
    sockets.set(socketId, userId);
    return first;
  }

  /** Removes one socket. Returns its user if that was their last socket in the room. */
  remove(roomId: string, socketId: string): string | undefined {
    const sockets = this.rooms.get(roomId);
    const userId = sockets?.get(socketId);
    if (!sockets || !userId) {
      return undefined;
    }
    sockets.delete(socketId);
    this.prune(roomId, sockets);
    return this.has(sockets, userId) ? undefined : userId;
  }

  /** Removes every socket of a user. Returns whether they had one. */
  removeUser(roomId: string, userId: string): boolean {
    const sockets = this.rooms.get(roomId);
    if (!sockets || !this.has(sockets, userId)) {
      return false;
    }
    for (const [socketId, user] of sockets) {
      if (user === userId) {
        sockets.delete(socketId);
      }
    }
    this.prune(roomId, sockets);
    return true;
  }

  online(roomId: string): string[] {
    return [...new Set(this.rooms.get(roomId)?.values())];
  }

  private has(sockets: Map<string, string>, userId: string): boolean {
    return [...sockets.values()].includes(userId);
  }

  private prune(roomId: string, sockets: Map<string, string>) {
    if (sockets.size === 0) {
      this.rooms.delete(roomId);
    }
  }
}
