import { createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { PasswordHasher } from '@nestjs/authentication';
import { getDrizzleToken } from '@nestjs/drizzle';
import { NodeAdapter, type NestNodeApplication } from '@nestjs/platform-node';
import { Test } from '@nestjs/testing';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { io, type Socket } from 'socket.io-client';
import { AppModule, ObserveInstrument } from '../src/app.module.js';

describe('Chat (e2e)', () => {
  const pglite = new PGlite(); // PostgreSQL in-process: no server to start
  let app: NestNodeApplication;
  let url: string;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    const db = drizzle({ client: pglite });
    await migrate(db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
    // Instrumented as in main.ts, so NestJS Observe sees the gateway's handlers.
    const moduleRef = await Test.createTestingModule(
      { imports: [AppModule] },
      { instrument: ObserveInstrument },
    )
      .overrideProvider(getDrizzleToken())
      .useValue(db)
      // scrypt at the default cost takes 128 MiB and a few hundred ms per hash.
      .overrideProvider(PasswordHasher)
      .useValue(new PasswordHasher({ logN: 10 }))
      .compile();
    app = moduleRef.createNestApplication<NestNodeApplication>(new NodeAdapter());
    // A real server on a free port: the sockets connect to it like any client.
    await app.listen(0);
    url = await app.getUrl();
  });

  afterEach(() => {
    for (const socket of sockets.splice(0)) {
      socket.disconnect();
    }
  });

  afterAll(async () => {
    await app.close();
    await pglite.close();
  });

  let clients = 0;

  /** Signs a user up, and returns their id, the headers of their requests, and their access token. */
  async function signUp(name: string) {
    const signedUp = await app.inject({
      method: 'POST',
      url: '/auth/sign-up',
      payload: { email: `${name}@example.com`, password: 'correct horse battery' },
      // Sign-up is rate-limited per IP address: each user signs up from their own.
      remoteAddress: `10.0.0.${++clients}`,
    });
    const { accessToken } = signedUp.json<{ accessToken: string }>();
    const headers = { authorization: `Bearer ${accessToken}` };
    const { id } = (await app.inject({ method: 'GET', url: '/me', headers })).json<{ id: string }>();
    return { id, headers, accessToken };
  }

  /** A room with its creator and the other users as members. */
  async function createRoom(creator: Awaited<ReturnType<typeof signUp>>, ...members: string[]) {
    const res = await app.inject({
      method: 'POST',
      url: '/rooms',
      headers: creator.headers,
      payload: { name: 'general' },
    });
    const { id } = res.json<{ id: string }>();
    for (const name of members) {
      const added = await app.inject({
        method: 'POST',
        url: `/rooms/${id}/members`,
        headers: creator.headers,
        payload: { email: `${name}@example.com` },
      });
      expect(added.statusCode).toBe(204);
    }
    return id;
  }

  /** An access token like the API's own, that expires within two seconds. */
  function shortLivedToken(sub: string) {
    const now = Math.floor(Date.now() / 1000);
    const encode = (part: object) => Buffer.from(JSON.stringify(part)).toString('base64url');
    const claims = { sub, iss: 'chat-api', aud: 'chat-api', iat: now, exp: now + 2 };
    const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(claims)}`;
    return `${unsigned}.${createHmac('sha256', process.env.JWT_SECRET!).update(unsigned).digest('base64url')}`;
  }

  /** A socket.io client, as a browser would open it, with the access token in the handshake. */
  function open(token: string): Socket {
    const socket = io(url, { auth: { token }, transports: ['websocket'] });
    sockets.push(socket);
    return socket;
  }

  function connect(token: string): Promise<Socket> {
    const socket = open(token);
    return new Promise((resolve) => socket.on('connect', () => resolve(socket)));
  }

  /** The next `event` the socket receives. */
  function next<T = any>(socket: Socket, event: string): Promise<T> {
    return new Promise((resolve) => socket.once(event, resolve));
  }

  /** Sends a message and waits for the server's acknowledgment. */
  function send(socket: Socket, event: string, data: unknown) {
    return socket.timeout(2000).emitWithAck(event, data);
  }

  it('disconnects a client without a valid access token', async () => {
    const socket = open('not-a-token');
    expect(await next(socket, 'disconnect')).toBe('io server disconnect');
  });

  it('stores a message, then delivers it to the room', async () => {
    const ada = await signUp('ada');
    const bob = await signUp('bob');
    const roomId = await createRoom(ada, 'bob');
    const adaSocket = await connect(ada.accessToken);
    const bobSocket = await connect(bob.accessToken);
    await send(adaSocket, 'join', { roomId });
    const joined = await send(bobSocket, 'join', { roomId });
    expect(joined.online.sort()).toEqual([ada.id, bob.id].sort());

    const received = next(bobSocket, 'message');
    const ack = await send(adaSocket, 'message', { roomId, body: 'Hi Bob' });

    expect(await received).toEqual(ack);
    expect(ack).toMatchObject({ roomId, authorId: ada.id, body: 'Hi Bob' });
    const history = await app.inject({ method: 'GET', url: `/rooms/${roomId}/messages`, headers: bob.headers });
    expect(history.json().messages).toEqual([ack]);
  });

  it("refuses a non-member's message, and stores nothing", async () => {
    const carol = await signUp('carol');
    const eve = await signUp('eve');
    const roomId = await createRoom(carol);
    const eveSocket = await connect(eve.accessToken);

    const refused = next(eveSocket, 'exception');
    eveSocket.emit('message', { roomId, body: 'Let me in' });

    expect(await refused).toEqual({
      status: 'error',
      statusCode: 404,
      message: 'Room not found',
      error: 'Not Found',
      cause: { pattern: 'message', data: { roomId, body: 'Let me in' } },
    });
    const history = await app.inject({ method: 'GET', url: `/rooms/${roomId}/messages`, headers: carol.headers });
    expect(history.json().messages).toEqual([]);
    expect(
      (await app.inject({ method: 'GET', url: `/rooms/${roomId}/messages`, headers: eve.headers })).statusCode,
    ).toBe(404);
  });

  it('checks the membership on every message, not only on join', async () => {
    const dan = await signUp('dan');
    const fay = await signUp('fay');
    const roomId = await createRoom(dan, 'fay');
    const danSocket = await connect(dan.accessToken);
    const faySocket = await connect(fay.accessToken);
    await send(danSocket, 'join', { roomId });
    const cameOnline = next(danSocket, 'presence');
    await send(faySocket, 'join', { roomId });
    expect(await cameOnline).toEqual({ roomId, userId: fay.id, online: true });

    const wentOffline = next(danSocket, 'presence');
    const left = await app.inject({ method: 'DELETE', url: `/rooms/${roomId}/members/me`, headers: fay.headers });
    expect(left.statusCode).toBe(204);
    expect(await wentOffline).toEqual({ roomId, userId: fay.id, online: false });

    // Fay's socket is still connected, and still names the room.
    const refused = next(faySocket, 'exception');
    faySocket.emit('message', { roomId, body: 'Still here?' });
    expect(await refused).toMatchObject({ statusCode: 404 });

    // And it no longer receives the room's messages.
    const delivered: unknown[] = [];
    faySocket.on('message', (message) => delivered.push(message));
    await send(danSocket, 'message', { roomId, body: 'Bye Fay' });
    await send(faySocket, 'leave', { roomId }); // a round trip on Fay's connection
    expect(delivered).toEqual([]);
  });

  it('disconnects a client when its access token expires', async () => {
    const kim = await signUp('kim');
    const socket = open(shortLivedToken(kim.id));

    await next(socket, 'connect');
    expect(await next(socket, 'disconnect')).toBe('io server disconnect');
  });

  it('validates messages with the Zod schema', async () => {
    const gus = await signUp('gus');
    const roomId = await createRoom(gus);
    const socket = await connect(gus.accessToken);

    const refused = next(socket, 'exception');
    socket.emit('message', { roomId, body: '   ' });

    expect(await refused).toMatchObject({
      statusCode: 400,
      message: ['body: Too small: expected string to have >=1 characters'],
    });
  });

  it('pages through the history, newest first', async () => {
    const hal = await signUp('hal');
    const roomId = await createRoom(hal);
    const socket = await connect(hal.accessToken);
    const sent: number[] = [];
    for (const body of ['one', 'two', 'three', 'four', 'five']) {
      sent.push((await send(socket, 'message', { roomId, body })).id);
    }

    const ids: number[] = [];
    let before: number | null | undefined;
    do {
      const query = before ? `?limit=2&before=${before}` : '?limit=2';
      const page = await app.inject({ method: 'GET', url: `/rooms/${roomId}/messages${query}`, headers: hal.headers });
      const { messages, nextBefore } = page.json<{ messages: { id: number }[]; nextBefore: number | null }>();
      ids.push(...messages.map((message) => message.id));
      before = nextBefore;
    } while (before);

    expect(ids).toEqual(sent.reverse());
  });

  it('limits how fast each user sends messages', async () => {
    const ivy = await signUp('ivy');
    const jon = await signUp('jon');
    const roomId = await createRoom(ivy, 'jon');
    const ivySocket = await connect(ivy.accessToken);
    const jonSocket = await connect(jon.accessToken);

    const refused = next(ivySocket, 'exception');
    for (let i = 1; i <= 11; i++) {
      ivySocket.emit('message', { roomId, body: `Message ${i}` });
    }

    expect(await refused).toMatchObject({ statusCode: 429 });
    // Another user's messages are counted separately.
    expect(await send(jonSocket, 'message', { roomId, body: 'Hello' })).toMatchObject({ body: 'Hello' });
  });
});
