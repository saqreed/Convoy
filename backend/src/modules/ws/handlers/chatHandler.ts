import type { WebSocket } from 'ws';
import { z } from 'zod';
import { prisma } from '../../../db/client';

type WsWithMeta = WebSocket & { userId?: string; convoys?: Set<string> };

const ChatSendSchema = z.object({
  text: z.string().min(1).max(1000)
});

export function createChatHandler(
  wsRaw: WebSocket,
  ctx: {
    broadcastToRoom: (convoyId: string, payload: unknown) => void;
  }
) {
  const ws = wsRaw as WsWithMeta;
  return async function handle(msg: any) {
    const userId = ws.userId;
    const convoyId = msg?.convoyId as string | undefined;
    if (!userId || !convoyId) return;

    if (!ws.convoys?.has(convoyId)) {
      ws.send(JSON.stringify({ success: false, error: { code: 'NOT_JOINED', message: 'Join convoy first' } }));
      return;
    }

    if (msg?.type !== 'chat:send') return;
    const payload = ChatSendSchema.parse(msg?.payload || {});

    const created = await prisma.chatMessage.create({
      data: {
        convoyId,
        userId,
        text: payload.text
      }
    });
    const message = {
      id: created.id,
      convoyId: created.convoyId,
      userId: created.userId,
      text: created.text,
      createdAt: created.createdAt.toISOString()
    };

    ctx.broadcastToRoom(convoyId, {
      success: true,
      data: {
        type: 'chat:new',
        convoyId,
        userId,
        message
      }
    });
  };
}
