import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { z } from 'zod';
import { ChatGateway } from './chat.gateway.js';
import {
  addMemberSchema,
  createRoomSchema,
  historyQuerySchema,
  type AddMemberDto,
  type CreateRoomDto,
  type HistoryQuery,
} from './chat.schemas.js';
import { MessagesService } from './messages.service.js';
import { RoomsService } from './rooms.service.js';

const roomId = { schema: z.uuid() };

@Controller('rooms')
export class RoomsController {
  constructor(
    private readonly roomsService: RoomsService,
    private readonly messagesService: MessagesService,
    private readonly chatGateway: ChatGateway,
  ) {}

  @Post()
  create(@CurrentUser('id') userId: string, @Body({ schema: createRoomSchema }) { name }: CreateRoomDto) {
    return this.roomsService.create(userId, name);
  }

  @Get()
  findMine(@CurrentUser('id') userId: string) {
    return this.roomsService.findMine(userId);
  }

  @Post(':id/members')
  @HttpCode(204)
  addMember(
    @CurrentUser('id') userId: string,
    @Param('id', roomId) id: string,
    @Body({ schema: addMemberSchema }) { email }: AddMemberDto,
  ) {
    return this.roomsService.addMember(userId, id, email);
  }

  @Delete(':id/members/me')
  @HttpCode(204)
  async leave(@CurrentUser('id') userId: string, @Param('id', roomId) id: string) {
    await this.roomsService.leave(userId, id);
    this.chatGateway.removeFromRoom(id, userId);
  }

  @Get(':id/messages')
  history(
    @CurrentUser('id') userId: string,
    @Param('id', roomId) id: string,
    @Query({ schema: historyQuerySchema }) query: HistoryQuery,
  ) {
    return this.messagesService.history(userId, id, query);
  }
}
