// A terminal client for trying the chat: TOKEN=<access token> node scripts/chat.ts <room id>
import { createInterface } from 'node:readline';
import { io } from 'socket.io-client';

const roomId = process.argv[2];
const socket = io(process.env.CHAT_URL ?? 'http://localhost:3000', {
  // The access token, which JwtBearerProvider reads from the handshake.
  auth: { token: process.env.TOKEN },
  // Straight to a WebSocket, without long-polling first.
  transports: ['websocket'],
});

const print = (event: string) => (data: unknown) => console.log(event, JSON.stringify(data));

socket.on('connect', () => {
  // Rooms are opened per connection: open it again after every reconnect.
  socket.emit('join', { roomId }, print('joined'));
});
socket.on('message', print('message'));
socket.on('presence', print('presence'));
socket.on('typing', print('typing'));
socket.on('exception', print('exception'));
socket.on('disconnect', print('disconnect'));

// Each line is a message.
for await (const body of createInterface({ input: process.stdin })) {
  socket.emit('typing', { roomId });
  try {
    print('sent')(await socket.timeout(5000).emitWithAck('message', { roomId, body }));
  } catch {
    // Refused: the "exception" event says why.
  }
}
socket.close();
