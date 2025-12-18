import type { WebSocket } from 'ws';
import { prisma } from '../../../db/client';

type WsWithMeta = WebSocket & { userId?: string };

export function createConvoyHandler(wsRaw: WebSocket, ctx: { addToRoom: (convoyId: string, ws: WsWithMeta) => void }) {
  const ws = wsRaw as WsWithMeta;
  return async function handle(msg: any) {
    if (msg?.type !== 'convoy:join') return;
    const convoyId = msg?.convoyId as string | undefined;
    if (!convoyId) return;

    if (!ws.userId) {
      ws.send(JSON.stringify({ success: false, error: { code: 'AUTH_REQUIRED', message: 'Auth required' } }));
      return;
    }

    const member = await prisma.convoyMember
      .findUnique({ where: { convoyId_userId: { convoyId, userId: ws.userId } } })
      .catch(() => null);

    if (!member) {
      ws.send(JSON.stringify({ success: false, error: { code: 'FORBIDDEN', message: 'Not a member of this convoy' } }));
      return;
    }

    ctx.addToRoom(convoyId, ws);
    ws.send(JSON.stringify({ success: true, data: { type: 'convoy:joined', convoyId, timestamp: Date.now() } }));
  };
}
