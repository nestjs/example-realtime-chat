# Real-time chat backend with NestJS

This is the finished application of the tutorial [Build a real-time chat backend in Node.js](https://docs.nestjs.com/tutorials/realtime-chat) in the NestJS documentation. The tutorial builds it step by step and explains every decision; this repository is the result, ready to clone.

## What it does

A chat backend with rooms and members, on NestJS and Socket.IO:

- Socket.IO connections sign in with the same JWT access tokens as the REST routes, and the server closes each connection when its token expires.
- Every message is stored in PostgreSQL before it is broadcast, and the same `INSERT ... SELECT` that stores it checks that the sender is a member of the room.
- Every event a client sends is validated with a Zod schema. Refusals come back as an `exception` event with a status code.
- A room's history is served over REST, a page at a time, with keyset pagination.
- Presence (who has a room open) and typing indicators.
- Messages are rate-limited per user.

It starts from the API of [Build a REST API with JWT authentication](https://docs.nestjs.com/tutorials/rest-api-jwt-authentication): sign-up, access and refresh tokens, rate-limited sign-in, OpenAPI, health checks.

## Run it

You need Node.js 22 or later (22.18 or later to run `scripts/chat.ts`), and Docker for PostgreSQL.

```bash
git clone https://github.com/nestjs/example-realtime-chat.git
cd example-realtime-chat
npm install
cp .env.example .env              # then set JWT_SECRET: openssl rand -base64 32
docker compose up -d
npm run db:migrate
npm run start
```

The API listens on http://localhost:3000, with Swagger UI at http://localhost:3000/docs and the Socket.IO server on the same port.

Socket.IO has its own protocol, so curl can't join a room. `scripts/chat.ts` is a terminal client: it connects with an access token, joins a room, prints what the server sends, and sends each line you type as a message.

```bash
curl localhost:3000/auth/sign-up --json '{"email":"ada@example.com","password":"correct horse battery"}'
TOKEN=<accessToken> node scripts/chat.ts <room id>
```

The tutorial's [Try it](https://docs.nestjs.com/tutorials/realtime-chat#try-it) section walks through a full session with three users.

## Endpoints and events

| Endpoint or event | Section |
| --- | --- |
| `POST /auth/sign-up`, `POST /auth/token`, `POST /auth/token/refresh`, `POST /auth/token/revoke`, `GET /me`, `GET /health/live`, `GET /health/ready` | [Start from the JWT API](https://docs.nestjs.com/tutorials/realtime-chat#start-from-the-jwt-api) |
| `POST /rooms`, `GET /rooms`, `POST /rooms/:id/members`, `DELETE /rooms/:id/members/me`, `GET /rooms/:id/messages` | [Expose rooms and history over REST](https://docs.nestjs.com/tutorials/realtime-chat#expose-rooms-and-history-over-rest) |
| `join`, `leave`, `message` and `typing` events, sent by clients; `message`, `presence`, `typing` and `exception` events, sent by the server | [Add the WebSocket gateway](https://docs.nestjs.com/tutorials/realtime-chat#add-the-websocket-gateway) |
| `GET /docs` (Swagger UI) | [Build a REST API with JWT authentication](https://docs.nestjs.com/tutorials/rest-api-jwt-authentication#describe-the-api-with-openapi) |

Every route except `/auth/*` and `/health/*` needs `Authorization: Bearer <accessToken>`. Socket.IO clients send the token in the handshake: `io(url, { auth: { token } })`.

## Layout

| Path | What it holds |
| --- | --- |
| `src/main.ts` | bootstrap on the Node adapter, JSON logs in production, security headers, CORS, Swagger UI, shutdown hooks |
| `src/app.module.ts` | NestJS Observe, config, database, authentication, throttler, validation pipe |
| `src/config.ts` | the environment, as a Zod schema checked at startup |
| `src/database/schema.ts` | Drizzle tables: users, refresh_tokens, rooms, room_members, messages |
| `src/auth/` | sign-up and token endpoints, the JWT credential provider, the refresh-token store |
| `src/users/` | the users repository and `GET /me` |
| `src/chat/` | the Socket.IO gateway, rooms and messages services, presence, the REST controller, the exception filter and the throttler's tracker |
| `src/health/` | liveness and readiness |
| `scripts/chat.ts` | the terminal client from the tutorial |
| `test/` | the chat's e2e tests (real Socket.IO clients against a listening app, on PGlite), and the refresh-token store contract on PostgreSQL |
| `drizzle/` | migrations |

## Tests

```bash
TEST_DATABASE_URL=postgres://postgres:chat@localhost:5432/chat_test npm run test:e2e
```

The chat tests run on PGlite, in-process, and need no database. The refresh-token store test runs against `TEST_DATABASE_URL`, and is skipped without it. `docker compose` creates the `chat_test` database; the test truncates its tables, so never point it at your development database.

## Stack

[NestJS](https://nestjs.com) 12 on the Node adapter, [`@nestjs/websockets`](https://docs.nestjs.com/websockets/gateways) with [Socket.IO](https://socket.io), [Zod](https://zod.dev) validation, [`@nestjs/authentication`](https://docs.nestjs.com/security/authentication), [Drizzle](https://docs.nestjs.com/data/drizzle) and PostgreSQL, [`@nestjs/throttler`](https://docs.nestjs.com/security/rate-limiting), [`@nestjs/swagger`](https://docs.nestjs.com/openapi/introduction), [`@nestjs/terminus`](https://docs.nestjs.com/reliability/terminus), [NestJS Observe](https://docs.nestjs.com/observability/overview), and Vitest.

## Production

Read the tutorial's production checklist first: https://docs.nestjs.com/tutorials/realtime-chat#production-checklist. This app runs on one instance; [Run more than one instance](https://docs.nestjs.com/tutorials/realtime-chat#run-more-than-one-instance) lists what changes behind a load balancer.

`ObserveModule` is registered in `src/app.module.ts` and sends nothing until it has a key pair. `npx @nestjs/observe link` writes the pair (`OBSERVE_APP_KEY`, `OBSERVE_APP_SECRET`) into `.env`, and [NestJS Observe](https://docs.nestjs.com/observability/overview) then shows the requests, errors, slow queries and gateway messages of each route and event.

## License

MIT
