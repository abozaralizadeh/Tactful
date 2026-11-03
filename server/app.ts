import fs from 'node:fs';
import path from 'node:path';
import type { Writable } from 'node:stream';
import Fastify, { LogController, type FastifyInstance, type FastifyRequest } from 'fastify';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { HttpError } from './errors.js';
import { Hub } from './hub.js';
import { RateLimiter } from './ratelimit.js';
import type { Rewriter } from './rewriter/index.js';
import { Service } from './service.js';

export interface AppDeps {
  config: Config;
  db: Db;
  rewriter: Rewriter;
  logStream?: Writable;
  clock?: () => number;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

const HOUR = 60 * 60 * 1000;

export function buildApp({ config, db, rewriter, logStream, clock }: AppDeps) {
  const app: FastifyInstance = Fastify({
    logger: logStream ? { level: 'info', stream: logStream } : false,
    trustProxy: config.trustProxy,
    bodyLimit: 16 * 1024,
    // Fastify's own request lines would include the url. We log our own line below, without query strings or bodies.
    logController: new LogController({ disableRequestLogging: true }),
  });
  const hub = new Hub();
  const limiter = new RateLimiter();
  const service = new Service(db, config, rewriter, hub, clock);

  const bearer = (req: FastifyRequest) => {
    const h = req.headers.authorization;
    return h?.startsWith('Bearer ') ? h.slice(7) : undefined;
  };
  const who = (req: FastifyRequest) => service.authenticate(bearer(req));
  const limit = (key: string, max: number, windowMs: number) => {
    if (!limiter.allow(key, max, windowMs, clock?.())) {
      throw new HttpError(429, 'rate_limited', 'Too many requests. Please wait a bit and try again.');
    }
  };

  const text = (max: number) => ({ type: 'string', minLength: 1, maxLength: max });
  const name = text(config.maxNameChars);
  const topic = text(config.maxTopicChars);
  const message = text(config.maxMessageChars);

  // ---- hooks ----

  const openStreams = new Set<() => void>();
  app.addHook('onClose', async () => {
    for (const finish of [...openStreams]) finish();
  });

  app.addHook('onResponse', async (req, reply) => {
    // Route pattern only. No url, query, headers or body, so tokens and message text stay out of the logs.
    req.log.info({ method: req.method, route: req.routeOptions?.url ?? 'unmatched', status: reply.statusCode, ms: Math.round(reply.elapsedTime) }, 'request');
  });

  app.addHook('onSend', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'");
    if (req.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
  });

  app.setErrorHandler((err: Error & { validation?: unknown; statusCode?: number }, req, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.status).send({ error: err.code, message: err.message });
    }
    if (err.validation || err.statusCode === 400 || err.statusCode === 413) {
      return reply.status(err.statusCode ?? 400).send({ error: 'bad_request', message: 'Please check what you entered and try again.' });
    }
    req.log.error({ route: req.routeOptions?.url ?? 'unmatched', errName: err.name }, 'unhandled error');
    return reply.status(500).send({ error: 'server_error', message: 'Something went wrong on our side.' });
  });

  // ---- routes ----

  app.get('/api/health', async () => ({ ok: true }));

  app.post('/api/conversations', { schema: { body: { type: 'object', required: ['name', 'topic'], additionalProperties: false, properties: { name, topic } } } }, async (req, reply) => {
    limit(`create:${req.ip}`, config.rateCreatePerHour, HOUR);
    const { name: n, topic: t } = req.body as { name: string; topic: string };
    return reply.status(201).send(service.createConversation(n, t));
  });

  app.get('/api/invites/:token', async (req) => {
    limit(`invite:${req.ip}`, 60, HOUR);
    return service.getInvite((req.params as { token: string }).token);
  });

  app.post(
    '/api/invites/:token/join',
    { schema: { body: { type: 'object', required: ['name', 'adult', 'consent'], additionalProperties: false, properties: { name, adult: { type: 'boolean' }, consent: { type: 'boolean' } } } } },
    async (req, reply) => {
      limit(`join:${req.ip}`, config.rateJoinPerHour, HOUR);
      const b = req.body as { name: string; adult: boolean; consent: boolean };
      return reply.status(201).send(service.join((req.params as { token: string }).token, b.name, b.adult, b.consent));
    },
  );

  app.get('/api/conversations/:id', async (req) => service.view(who(req), (req.params as { id: string }).id));

  app.post('/api/conversations/:id/invite', async (req) => service.newInvite(who(req), (req.params as { id: string }).id));

  app.post('/api/conversations/:id/close', async (req, reply) => {
    service.close(who(req), (req.params as { id: string }).id);
    return reply.status(204).send();
  });

  const textBody = { body: { type: 'object', required: ['text'], additionalProperties: false, properties: { text: message } } };

  app.post('/api/conversations/:id/drafts', { schema: textBody }, async (req) => {
    const p = who(req);
    limit(`draft:${p.id}`, config.rateDraftPerMinute, 60_000);
    return service.createDraft(p, (req.params as { id: string }).id, (req.body as { text: string }).text);
  });

  app.post('/api/drafts/:id/retry', async (req) => {
    const p = who(req);
    limit(`draft:${p.id}`, config.rateDraftPerMinute, 60_000);
    return service.retryDraft(p, (req.params as { id: string }).id);
  });

  app.patch('/api/drafts/:id', { schema: textBody }, async (req) => {
    const p = who(req);
    limit(`draft:${p.id}`, config.rateDraftPerMinute, 60_000);
    return service.editDraft(p, (req.params as { id: string }).id, (req.body as { text: string }).text);
  });

  app.post('/api/drafts/:id/send', async (req) => service.sendDraft(who(req), (req.params as { id: string }).id));

  app.delete('/api/drafts/:id', async (req, reply) => {
    service.cancelDraft(who(req), (req.params as { id: string }).id);
    return reply.status(204).send();
  });

  // Live delivery. EventSource can't set headers, so the token comes in the query string.
  // The request log never records query strings.
  app.get('/api/conversations/:id/events', async (req, reply) => {
    const p = service.authenticate((req.query as { t?: string }).t);
    const id = (req.params as { id: string }).id;
    if (p.conversationId !== id) throw new HttpError(404, 'not_found', 'Conversation not found.');
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');
    const off = hub.subscribe(id, (event) => res.write(`event: ${event}\ndata: {}\n\n`));
    const beat = setInterval(() => res.write(': ping\n\n'), 25_000);
    const end = () => {
      clearInterval(beat);
      off();
      openStreams.delete(finish);
    };
    const finish = () => {
      end();
      res.end();
    };
    openStreams.add(finish);
    req.raw.on('close', end);
  });

  // ---- the web app ----

  const webRoot = path.resolve(config.webDir);
  app.setNotFoundHandler(async (req, reply) => {
    if (req.url.startsWith('/api/')) return reply.status(404).send({ error: 'not_found', message: 'Not found.' });
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    let file = path.join(webRoot, urlPath);
    // Stay inside the web folder, and fall back to index.html for anything unknown.
    if (!file.startsWith(webRoot + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(webRoot, 'index.html');
    }
    if (!fs.existsSync(file)) return reply.status(404).send({ error: 'not_built', message: 'The web app is not built yet. Run npm run build.' });
    const immutable = file.includes(`${path.sep}assets${path.sep}`);
    return reply
      .header('Content-Type', MIME[path.extname(file)] ?? 'application/octet-stream')
      .header('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache')
      .send(fs.createReadStream(file));
  });

  return { app, limiter, service };
}
