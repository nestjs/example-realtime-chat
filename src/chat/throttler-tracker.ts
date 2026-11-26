import type { ExecutionContext } from '@nestjs/common';
import { normalizeIp } from '@nestjs/throttler';

/**
 * What the throttler counts by. Over WebSockets, `req` is the socket, which has no `ip`:
 * without this, every client's messages would share one counter.
 */
export function tracker(req: Record<string, any>, context: ExecutionContext): string {
  if (context.getType() === 'ws') {
    // The user that the handshake signed in, or the address until it has.
    return req.data.userId ?? normalizeIp(req.handshake.address);
  }
  return normalizeIp(req.ip);
}
