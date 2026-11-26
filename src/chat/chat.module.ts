import { Module } from '@nestjs/common';
import { ChatGateway } from './chat.gateway.js';
import { MessagesService } from './messages.service.js';
import { PresenceService } from './presence.service.js';
import { RoomsController } from './rooms.controller.js';
import { RoomsService } from './rooms.service.js';

@Module({
  controllers: [RoomsController],
  providers: [ChatGateway, RoomsService, MessagesService, PresenceService],
})
export class ChatModule {}
