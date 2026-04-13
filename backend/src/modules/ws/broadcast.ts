type ConvoyBroadcast = (convoyId: string, payload: unknown) => void;

let convoyBroadcast: ConvoyBroadcast | null = null;

export function setConvoyBroadcast(fn: ConvoyBroadcast) {
  convoyBroadcast = fn;
}

export function broadcastConvoyEvent(convoyId: string, payload: unknown) {
  convoyBroadcast?.(convoyId, payload);
}
