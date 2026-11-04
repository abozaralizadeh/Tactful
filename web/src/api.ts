export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

// Paths are relative (api/...), so the app works at / and under a base path such as /tactful/.
async function call<T>(method: string, path: string, token?: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'network', 'Could not reach the server. Check your connection and try again.');
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'error', data.message ?? 'Something went wrong.');
  return data as T;
}

export interface Message {
  id: string;
  mine: boolean;
  senderName: string;
  text: string;
  sentAt: number;
}

export interface ConversationView {
  id: string;
  topic: string;
  status: 'waiting' | 'active' | 'closed';
  deleteAt: number;
  me: { id: string; name: string };
  other: { name: string } | null;
  messages: Message[];
}

export interface DraftReply {
  outcome: 'rewritten' | 'needs_clarity' | 'stopped';
  draft?: { id: string; text: string };
  reason?: string;
  showSupport?: boolean;
}

export const api = {
  start: (name: string, topic: string) => call<{ id: string; participantToken: string; inviteToken: string }>('POST', 'api/conversations', undefined, { name, topic }),
  invite: (token: string) => call<{ topic: string; inviterName: string }>('GET', `api/invites/${token}`),
  join: (token: string, name: string) => call<{ id: string; participantToken: string }>('POST', `api/invites/${token}/join`, undefined, { name, adult: true, consent: true }),
  view: (id: string, t: string) => call<ConversationView>('GET', `api/conversations/${id}`, t),
  newInvite: (id: string, t: string) => call<{ inviteToken: string }>('POST', `api/conversations/${id}/invite`, t),
  close: (id: string, t: string) => call<void>('POST', `api/conversations/${id}/close`, t),
  draft: (id: string, t: string, text: string) => call<DraftReply>('POST', `api/conversations/${id}/drafts`, t, { text }),
  retry: (draftId: string, t: string) => call<DraftReply>('POST', `api/drafts/${draftId}/retry`, t),
  edit: (draftId: string, t: string, text: string) => call<DraftReply>('PATCH', `api/drafts/${draftId}`, t, { text }),
  send: (draftId: string, t: string) => call<{ message: Message }>('POST', `api/drafts/${draftId}/send`, t),
  cancel: (draftId: string, t: string) => call<void>('DELETE', `api/drafts/${draftId}`, t),
};
