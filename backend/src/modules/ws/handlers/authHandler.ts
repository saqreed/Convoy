import type { WebSocket } from 'ws';
import jwt from 'jsonwebtoken';

type WsWithMeta = WebSocket & { userId?: string };

export function createAuthHandler(wsRaw: WebSocket, secret: string) {
  const ws = wsRaw as WsWithMeta;
  return function handle(msg: any) {
    if (msg?.type !== 'auth:init') return;
    try {
      const token = msg?.payload?.token as string | undefined;
      if (!token) throw new Error('no token');
      const decoded = jwt.verify(token, secret) as { userId: string };
      ws.userId = decoded.userId;
      ws.send(JSON.stringify({ success: true, data: { type: 'auth:ok', timestamp: Date.now() } }));
    } catch {
      ws.send(JSON.stringify({ success: false, error: { code: 'AUTH_ERROR', message: 'Invalid token' } }));
    }
  };
}
