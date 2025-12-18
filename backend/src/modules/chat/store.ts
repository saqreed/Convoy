import crypto from 'crypto';

export type ChatMessage = {
  id: string;
  convoyId: string;
  userId: string;
  text: string;
  createdAt: string;
};

class ChatStore {
  private byConvoy = new Map<string, ChatMessage[]>();

  add(convoyId: string, userId: string, text: string) {
    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      convoyId,
      userId,
      text,
      createdAt: new Date().toISOString()
    };
    const arr = this.byConvoy.get(convoyId) || [];
    arr.push(msg);

    const MAX = 500;
    if (arr.length > MAX) {
      arr.splice(0, arr.length - MAX);
    }

    this.byConvoy.set(convoyId, arr);
    return msg;
  }

  list(convoyId: string, opts: { since?: Date; limit?: number } = {}) {
    const arr = this.byConvoy.get(convoyId) || [];
    const sinceMs = opts.since ? opts.since.getTime() : null;
    let out = arr;
    if (sinceMs !== null) {
      out = out.filter((m) => {
        const ms = Date.parse(m.createdAt);
        return Number.isFinite(ms) && ms >= sinceMs;
      });
    }
    const limit = Math.max(1, Math.min(Number(opts.limit || 50), 200));
    return out.slice(Math.max(0, out.length - limit));
  }
}

export const chatStore = new ChatStore();
