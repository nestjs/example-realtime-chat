import { UseFilters } from '@nestjs/common';
import { CurrentUser, WsAuthenticator, type JwtClaims } from '@nestjs/authentication';
import { Throttle, seconds } from '@nestjs/throttler';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type { User } from '../users/user.js';
import { ChatExceptionFilter } from './chat-exception.filter.js';
import { roomRefSchema, sendMessageSchema, type RoomRef, type SendMessageDto } from './chat.schemas.js';
import { MessagesService } from './messages.service.js';
import { PresenceService } from './presence.service.js';
import { RoomsService } from './rooms.service.js';

/** The socket.io room of a chat room: its open sockets, which receive its messages. */
const roomChannel = (roomId: string) => `room:${roomId}`;
/** Every socket of one user, on every instance. */
const userChannel = (userId: string) => `user:${userId}`;

@UseFilters(new ChatExceptionFilter())
@WebSocketGateway()
export class ChatGateway implements OnGatewayConnection {
  @WebSocketServer()
  private readonly server: Server;

  constructor(
    private readonly wsAuthenticator: WsAuthenticator,
    private readonly roomsService: RoomsService,
    private readonly messagesService: MessagesService,
    private readonly presence: PresenceService,
  ) {}

  async handleConnection(client: Socket) {
    // Registered first: socket.io empties `client.rooms` before "disconnect".
    client.on('disconnecting', () => this.closeRooms(client));
    // Closes the connection (and returns null) unless the handshake carries a valid access token.
    const auth = await this.wsAuthenticator.authenticateConnection(client);
    if (!auth) {
      return;
    }
    const { id } = auth.user as User;
    client.data.userId = id;
    await client.join(userChannel(id));
    // A connection lasts as long as its access token. The client then
    // reconnects with a fresh one, as it would send one with a request.
    const { exp } = auth.session as JwtClaims;
    if (exp) {
      const expiry = setTimeout(() => client.disconnect(true), exp * 1000 - Date.now());
      client.on('disconnect', () => clearTimeout(expiry));
    }
  }

  /** Opens a room: the socket receives its messages, typing and presence. */
  @SubscribeMessage('join')
  async join(
    @CurrentUser('id') userId: string,
    @ConnectedSocket() client: Socket,
    @MessageBody({ schema: roomRefSchema }) { roomId }: RoomRef,
  ) {
    await this.roomsService.assertMember(userId, roomId);
    await client.join(roomChannel(roomId));
    if (this.presence.add(roomId, client.id, userId)) {
      client.to(roomChannel(roomId)).emit('presence', { roomId, userId, online: true });
    }
    return { roomId, online: this.presence.online(roomId) };
  }

  /** Closes a room on this socket. The user stays a member. */
  @SubscribeMessage('leave')
  async leave(@ConnectedSocket() client: Socket, @MessageBody({ schema: roomRefSchema }) { roomId }: RoomRef) {
    await client.leave(roomChannel(roomId));
    this.wentAway(roomId, this.presence.remove(roomId, client.id));
    return { roomId };
  }

  @Throttle({ default: { limit: 10, ttl: seconds(10) } })
  @SubscribeMessage('message')
  async message(
    @CurrentUser('id') userId: string,
    @ConnectedSocket() client: Socket,
    @MessageBody({ schema: sendMessageSchema }) { roomId, body }: SendMessageDto,
  ) {
    // Stored first, then broadcast: nobody sees a message that a restart could lose.
    const message = await this.messagesService.post(userId, roomId, body);
    client.to(roomChannel(roomId)).emit('message', message);
    // The acknowledgment: the sender learns the message's id.
    return message;
  }

  @SubscribeMessage('typing')
  typing(
    @CurrentUser('id') userId: string,
    @ConnectedSocket() client: Socket,
    @MessageBody({ schema: roomRefSchema }) { roomId }: RoomRef,
  ) {
    // Only from a socket that opened the room, which checked the membership.
    if (client.rooms.has(roomChannel(roomId))) {
      client.to(roomChannel(roomId)).emit('typing', { roomId, userId });
    }
  }

  /** After a user leaves a room over REST: their open sockets stop receiving it. */
  removeFromRoom(roomId: string, userId: string) {
    this.server.in(userChannel(userId)).socketsLeave(roomChannel(roomId));
    if (this.presence.removeUser(roomId, userId)) {
      this.wentAway(roomId, userId);
    }
  }

  private closeRooms(client: Socket) {
    for (const channel of client.rooms) {
      if (channel.startsWith('room:')) {
        const roomId = channel.slice('room:'.length);
        this.wentAway(roomId, this.presence.remove(roomId, client.id));
      }
    }
  }

  private wentAway(roomId: string, userId: string | undefined) {
    if (userId) {
      this.server.to(roomChannel(roomId)).emit('presence', { roomId, userId, online: false });
    }
  }
}
