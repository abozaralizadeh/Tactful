export type HubEvent = 'message' | 'joined' | 'closed';
type Send = (event: HubEvent) => void;

/** Keeps track of open live connections per conversation. */
export class Hub {
  private subs = new Map<string, Set<Send>>();

  subscribe(conversationId: string, send: Send): () => void {
    let set = this.subs.get(conversationId);
    if (!set) this.subs.set(conversationId, (set = new Set()));
    set.add(send);
    return () => {
      set.delete(send);
      if (set.size === 0) this.subs.delete(conversationId);
    };
  }

  emit(conversationId: string, event: HubEvent) {
    this.subs.get(conversationId)?.forEach((send) => send(event));
  }

  count(conversationId: string): number {
    return this.subs.get(conversationId)?.size ?? 0;
  }
}
