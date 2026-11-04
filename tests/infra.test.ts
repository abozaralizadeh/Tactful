import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../server/config.js';
import { RotatingFile } from '../server/logger.js';
import { RateLimiter } from '../server/ratelimit.js';
import { makeApp } from './helpers.js';

test('the log file is size limited and keeps a fixed number of files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tactful-log-'));
  const file = path.join(dir, 'tactful.log');
  const log = new RotatingFile(file, 100, 3);
  for (let i = 0; i < 50; i++) log.write(`line ${String(i).padStart(3, '0')} ${'x'.repeat(20)}\n`);
  await new Promise<void>((r) => log.end(r));
  const files = fs.readdirSync(dir).sort();
  assert.deepEqual(files, ['tactful.log', 'tactful.log.1', 'tactful.log.2']);
  const total = files.reduce((n, f) => n + fs.statSync(path.join(dir, f)).size, 0);
  assert.ok(total <= 3 * 100 + 60, `total ${total} too big`);
  // the newest lines are in the live file
  assert.match(fs.readFileSync(file, 'utf8'), /line 049/);
  fs.rmSync(dir, { recursive: true });
});

test('config reads settings and rejects bad ones', () => {
  assert.equal(loadConfig({}).retentionDays, 30);
  assert.equal(loadConfig({ RETENTION_DAYS: '7' }).retentionDays, 7);
  assert.throws(() => loadConfig({ RETENTION_DAYS: 'abc' }), /RETENTION_DAYS/);
  assert.throws(() => loadConfig({ REWRITER: 'magic' }), /REWRITER/);
  assert.throws(() => loadConfig({ REWRITER: 'anthropic' }), /ANTHROPIC_API_KEY/);
  assert.equal(loadConfig({ REWRITER: 'anthropic', ANTHROPIC_API_KEY: 'k' }).rewriter, 'anthropic');
  assert.throws(() => loadConfig({ REWRITER: 'azure' }), /AZURE_OPENAI_ENDPOINT/);
  const az = loadConfig({ REWRITER: 'azure', AZURE_OPENAI_ENDPOINT: 'https://e', AZURE_OPENAI_API_KEY: 'k', AZURE_OPENAI_DEPLOYMENT: 'd' });
  assert.equal(az.azureFallback, null);
  assert.equal(loadConfig({ AZURE_OPENAI_FALLBACK_ENDPOINT: 'https://f', AZURE_OPENAI_FALLBACK_API_KEY: 'k', AZURE_OPENAI_FALLBACK_DEPLOYMENT: 'd' }).azureFallback?.deployment, 'd');
  assert.equal(loadConfig({}).trustProxy, false);
  assert.equal(loadConfig({ TRUST_PROXY: 'true' }).trustProxy, true);
  assert.equal(loadConfig({ TRUST_PROXY: '127.0.0.1' }).trustProxy, '127.0.0.1');
});

test('rate limiter sweeps quiet keys', () => {
  const l = new RateLimiter();
  assert.equal(l.allow('a', 1, 1000, 0), true);
  assert.equal(l.allow('a', 1, 1000, 500), false);
  l.sweep(1000, 2000);
  assert.equal(l.allow('a', 1, 1000, 2000), true);
});

test('the web app is served, with a fallback to index.html', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tactful-web-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<h1>home</h1>');
  fs.writeFileSync(path.join(dir, 'assets', 'app.js'), 'console.log(1)');
  fs.writeFileSync(path.join(os.tmpdir(), 'tactful-secret.txt'), 'secret');
  const t = makeApp({ config: { webDir: dir } });

  const home = await t.app.inject({ method: 'GET', url: '/' });
  assert.equal(home.statusCode, 200);
  assert.match(home.body, /home/);
  const js = await t.app.inject({ method: 'GET', url: '/assets/app.js' });
  assert.match(String(js.headers['content-type']), /javascript/);
  assert.match(String(js.headers['cache-control']), /immutable/);
  assert.match((await t.app.inject({ method: 'GET', url: '/privacy' })).body, /home/);
  // path traversal does not escape the web folder
  const escape = await t.app.inject({ method: 'GET', url: '/..%2Ftactful-secret.txt' });
  assert.doesNotMatch(escape.body, /secret/);
  const escape2 = await t.app.inject({ method: 'GET', url: '/%2e%2e/tactful-secret.txt' });
  assert.doesNotMatch(escape2.body, /secret/);
  // unknown api paths are json 404s, not the web app
  const api = await t.app.inject({ method: 'GET', url: '/api/nothing' });
  assert.equal(api.statusCode, 404);
  assert.equal(api.json().error, 'not_found');
  await t.app.close();
  fs.rmSync(dir, { recursive: true });
  fs.rmSync(path.join(os.tmpdir(), 'tactful-secret.txt'));
});
