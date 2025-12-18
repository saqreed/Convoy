const WS_BASE_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:3000/ws';

export type WsEventData = {
  type: string;
  [key: string]: unknown;
};

export type WsEvent = {
  success: true;
  cid?: string;
  data: WsEventData;
};

export type WsErrorEvent = { success: false; error: { code?: string; message?: string }; cid?: string };

type MessageHandler = (event: WsEvent) => void;

export class ConvoyWsClient {
  private socket: WebSocket | null = null;
  private token: string;
  private onMessage: MessageHandler;
  private pending: { resolve: () => void; reject: (err: Error) => void } | null = null;

  constructor(token: string, handler: MessageHandler) {
    this.token = token;
    this.onMessage = handler;
  }

  connect(): Promise<void> {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }
    if (this.socket && this.socket.readyState === WebSocket.CONNECTING) {
      return new Promise<void>((resolve, reject) => {
        const existing = this.pending;
        if (!existing) {
          this.pending = { resolve, reject };
          return;
        }
        const existingResolve = existing.resolve;
        const existingReject = existing.reject;
        this.pending = {
          resolve: () => {
            existingResolve();
            resolve();
          },
          reject: (err) => {
            existingReject(err);
            reject(err);
          }
        };
      });
    }
    const cid = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const ws = new WebSocket(`${WS_BASE_URL}?token=${encodeURIComponent(this.token)}&cid=${cid}`);
    ws.onopen = () => {
      if (this.pending) {
        this.pending.resolve();
        this.pending = null;
      }
    };
    ws.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as WsEvent | WsErrorEvent;
        if (!parsed.success) {
          console.error('WS error', parsed.error);
          return;
        }
        this.onMessage(parsed);
      } catch (e) {
        console.error('Failed to parse WS message', e);
      }
    };
    ws.onclose = () => {
      this.socket = null;
      setTimeout(() => this.connect(), 2000);
    };
    ws.onerror = () => {
      if (this.pending) {
        this.pending.reject(new Error('WebSocket error'));
        this.pending = null;
      }
    };
    this.socket = ws;
    return new Promise<void>((resolve, reject) => {
      this.pending = { resolve, reject };
    });
  }

  close() {
    this.socket?.close();
    this.socket = null;
  }

  send(data: { type: string; convoyId?: string; payload?: Record<string, unknown> }) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }
    const envelope = { data };
    this.socket.send(JSON.stringify(envelope));
  }
}
