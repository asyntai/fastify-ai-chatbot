'use strict';

/**
 * Tests for fastify-ai-chatbot, against a real Fastify app.
 *
 * Every test builds an app, registers the plugin the way a user does, and
 * sends a request with fastify.inject(). No network is used.
 *
 * Run: npm test   (needs fastify, @fastify/static and @fastify/compress installed)
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const Fastify = require('fastify');
const chatbot = require('../src/index.js');

const ID = 'asyntai_1a2b3c4d5e6f';
const PAGE = '<!doctype html><html><head><title>t</title></head><body><h1>Hi</h1></body></html>';

function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

async function appWith(options, routes) {
  const app = Fastify();
  await app.register(chatbot, options === undefined ? { widgetId: ID } : options);
  routes(app);
  await app.ready();
  return app;
}

// ---------------------------------------------------------------- options

test('a valid widget ID is accepted and trimmed', () => {
  assert.strictEqual(chatbot.validateOptions({ widgetId: '  ' + ID + ' ' }).widgetId, ID);
});

test('a missing widget ID stops startup with a clear message', async () => {
  const saved = process.env.ASYNTAI_WIDGET_ID;
  delete process.env.ASYNTAI_WIDGET_ID;
  try {
    const app = Fastify();
    app.register(chatbot, {});
    await assert.rejects(app.ready(), /widgetId" is required/);
  } finally {
    if (saved !== undefined) process.env.ASYNTAI_WIDGET_ID = saved;
  }
});

test('a wrong widget ID stops startup', async () => {
  const app = Fastify();
  app.register(chatbot, { widgetId: 'my-widget' });
  await assert.rejects(app.ready(), /does not look like a widget ID/);
});

test('the widget ID can come from ASYNTAI_WIDGET_ID', async () => {
  process.env.ASYNTAI_WIDGET_ID = 'asyntai_fromenv123';
  try {
    const app = await appWith({}, (a) => a.get('/', (req, reply) => reply.type('text/html').send(PAGE)));
    const res = await app.inject('/');
    assert.ok(res.body.includes('"asyntai_fromenv123"'));
  } finally {
    delete process.env.ASYNTAI_WIDGET_ID;
  }
});

test('the widgetId option wins over the environment variable', async () => {
  process.env.ASYNTAI_WIDGET_ID = 'asyntai_fromenv123';
  try {
    const app = await appWith({ widgetId: ID }, (a) => a.get('/', (req, reply) => reply.type('text/html').send(PAGE)));
    const res = await app.inject('/');
    assert.ok(res.body.includes('"' + ID + '"'));
    assert.ok(!res.body.includes('fromenv'));
  } finally {
    delete process.env.ASYNTAI_WIDGET_ID;
  }
});

test('shouldInject must be a function', async () => {
  const app = Fastify();
  app.register(chatbot, { widgetId: ID, shouldInject: 'admin' });
  await assert.rejects(app.ready(), /shouldInject" must be a function/);
});

// ---------------------------------------------------------------- HTML pages

test('an HTML string gets the loader once, just before </body>', async () => {
  const app = await appWith(undefined, (a) => a.get('/', (req, reply) => reply.type('text/html').send(PAGE)));
  const res = await app.inject('/');
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(count(res.body, 'data-asyntai-loader'), 1);
  assert.ok(res.body.indexOf('data-asyntai-loader') < res.body.indexOf('</body>'));
  assert.ok(res.body.includes('https://widget.asyntai.com/static/js/chat-widget.js'));
  assert.ok(res.body.includes('"' + ID + '"'));
});

test('the loader sets charset UTF-8 on the widget script', async () => {
  const app = await appWith(undefined, (a) => a.get('/', (req, reply) => reply.type('text/html').send(PAGE)));
  const res = await app.inject('/');
  assert.ok(res.body.includes('s.charset="UTF-8"'));
});

test('the Content-Length header matches the new body', async () => {
  const app = await appWith(undefined, (a) =>
    a.get('/', (req, reply) => reply.type('text/html; charset=utf-8').header('content-length', Buffer.byteLength(PAGE)).send(PAGE)),
  );
  const res = await app.inject('/');
  assert.strictEqual(Number(res.headers['content-length']), Buffer.byteLength(res.body));
  assert.ok(res.body.includes('data-asyntai-loader'));
});

test('an HTML Buffer gets the loader, and non-ASCII text survives', async () => {
  const page = PAGE.replace('Hi', 'Dobrý den, žluťoučký kůň');
  const app = await appWith(undefined, (a) => a.get('/', (req, reply) => reply.type('text/html; charset=utf-8').send(Buffer.from(page))));
  const res = await app.inject('/');
  assert.ok(res.body.includes('data-asyntai-loader'));
  assert.ok(res.body.includes('žluťoučký kůň'));
  assert.strictEqual(Number(res.headers['content-length']), Buffer.byteLength(res.body));
});

test('a page with an upper-case </BODY> is handled', async () => {
  const app = await appWith(undefined, (a) => a.get('/', (req, reply) => reply.type('text/html').send('<HTML><BODY>x</BODY></HTML>')));
  const res = await app.inject('/');
  assert.ok(res.body.indexOf('data-asyntai-loader') < res.body.indexOf('</BODY>'));
});

test('a page with no <body> gets the loader before </html>', async () => {
  const app = await appWith(undefined, (a) => a.get('/', (req, reply) => reply.type('text/html').send('<html><p>x</p></html>')));
  const res = await app.inject('/');
  assert.ok(res.body.indexOf('data-asyntai-loader') < res.body.indexOf('</html>'));
});

test('an HTML fragment (no </body>, no </html>) is left alone', async () => {
  const app = await appWith(undefined, (a) => a.get('/', (req, reply) => reply.type('text/html').send('<li>item</li>')));
  const res = await app.inject('/');
  assert.strictEqual(res.body, '<li>item</li>');
});

test('a page that already has the Asyntai snippet is left alone', async () => {
  const own = PAGE.replace('</body>', '<script async src="x" data-asyntai-id="' + ID + '"></script></body>');
  const app = await appWith(undefined, (a) => a.get('/', (req, reply) => reply.type('text/html').send(own)));
  const res = await app.inject('/');
  assert.strictEqual(res.body, own);
});

// ---------------------------------------------------------------- not HTML

test('JSON responses are not changed', async () => {
  const app = await appWith(undefined, (a) => a.get('/api', () => ({ html: '</body>' })));
  const res = await app.inject('/api');
  assert.deepStrictEqual(res.json(), { html: '</body>' });
});

test('plain text with </body> in it is not changed', async () => {
  const app = await appWith(undefined, (a) => a.get('/t', (req, reply) => reply.type('text/plain').send(PAGE)));
  const res = await app.inject('/t');
  assert.strictEqual(res.body, PAGE);
});

test('204 and 304 responses are not changed', async () => {
  const app = await appWith(undefined, (a) => {
    a.get('/204', (req, reply) => reply.code(204).send());
    a.get('/304', (req, reply) => reply.code(304).type('text/html').send());
  });
  assert.strictEqual((await app.inject('/204')).body, '');
  assert.strictEqual((await app.inject('/304')).body, '');
});

test('an HTML redirect body is not changed', async () => {
  const app = await appWith(undefined, (a) => a.get('/r', (req, reply) => reply.code(302).header('location', '/').type('text/html').send(PAGE)));
  const res = await app.inject('/r');
  assert.strictEqual(res.statusCode, 302);
  assert.ok(!res.body.includes('data-asyntai-loader'));
});

test('a HEAD request works and returns no body', async () => {
  const app = await appWith(undefined, (a) => a.get('/', (req, reply) => reply.type('text/html').send(PAGE)));
  const res = await app.inject({ method: 'HEAD', url: '/' });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body, '');
});

// ---------------------------------------------------------------- scope and options

test('routes in child plugins and prefixes get the chat too', async () => {
  const app = Fastify();
  await app.register(chatbot, { widgetId: ID });
  await app.register(async (child) => {
    child.get('/page', (req, reply) => reply.type('text/html').send(PAGE));
  }, { prefix: '/shop' });
  await app.ready();
  const res = await app.inject('/shop/page');
  assert.ok(res.body.includes('data-asyntai-loader'));
});

test('shouldInject can keep the chat off some pages', async () => {
  const app = await appWith(
    { widgetId: ID, shouldInject: (request) => !request.url.startsWith('/admin') },
    (a) => {
      a.get('/', (req, reply) => reply.type('text/html').send(PAGE));
      a.get('/admin', (req, reply) => reply.type('text/html').send(PAGE));
    },
  );
  assert.ok((await app.inject('/')).body.includes('data-asyntai-loader'));
  assert.ok(!(await app.inject('/admin')).body.includes('data-asyntai-loader'));
});

test('an HTML 404 page from setNotFoundHandler gets the chat', async () => {
  const app = await appWith(undefined, (a) => a.setNotFoundHandler((req, reply) => reply.code(404).type('text/html').send(PAGE)));
  const res = await app.inject('/missing');
  assert.strictEqual(res.statusCode, 404);
  assert.ok(res.body.includes('data-asyntai-loader'));
});

test('a custom scriptUrl is used and cannot break out of the <script>', async () => {
  const app = await appWith({ widgetId: ID, scriptUrl: 'https://cdn.example.com/w.js?</script><b>' }, (a) =>
    a.get('/', (req, reply) => reply.type('text/html').send(PAGE)),
  );
  const res = await app.inject('/');
  assert.ok(res.body.includes('https://cdn.example.com/w.js?\\u003c/script>\\u003cb>'));
  assert.strictEqual(count(res.body, '</script>'), 1);
});

// ---------------------------------------------------------------- with other plugins

function staticDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asyntai-fastify-'));
  fs.writeFileSync(path.join(dir, 'index.html'), PAGE);
  fs.writeFileSync(path.join(dir, 'about.html'), PAGE.replace('Hi', 'About'));
  fs.writeFileSync(path.join(dir, 'style.css'), 'body{color:red}');
  return dir;
}

test('@fastify/static HTML files get the chat, other files do not', async () => {
  const dir = staticDir();
  const app = Fastify();
  await app.register(chatbot, { widgetId: ID });
  await app.register(require('@fastify/static'), { root: dir });
  await app.ready();

  const home = await app.inject('/');
  assert.strictEqual(home.statusCode, 200);
  assert.strictEqual(count(home.body, 'data-asyntai-loader'), 1);
  assert.strictEqual(Number(home.headers['content-length']), Buffer.byteLength(home.body));

  const about = await app.inject('/about.html');
  assert.ok(about.body.includes('About'));
  assert.ok(about.body.includes('data-asyntai-loader'));

  const css = await app.inject('/style.css');
  assert.strictEqual(css.body, 'body{color:red}');
});

test('registered before @fastify/compress, gzip pages still get the chat', async () => {
  const app = Fastify();
  await app.register(chatbot, { widgetId: ID });
  await app.register(require('@fastify/compress'), { threshold: 0 });
  app.get('/', (req, reply) => reply.type('text/html').send(PAGE));
  await app.ready();
  const res = await app.inject({ url: '/', headers: { 'accept-encoding': 'gzip' } });
  assert.strictEqual(res.headers['content-encoding'], 'gzip');
  const html = zlib.gunzipSync(res.rawPayload).toString('utf8');
  assert.strictEqual(count(html, 'data-asyntai-loader'), 1);
});

test('registered after @fastify/compress, compressed pages are passed through unharmed', async () => {
  const app = Fastify();
  await app.register(require('@fastify/compress'), { threshold: 0 });
  await app.register(chatbot, { widgetId: ID });
  app.get('/', (req, reply) => reply.type('text/html').send(PAGE));
  await app.ready();
  const res = await app.inject({ url: '/', headers: { 'accept-encoding': 'gzip' } });
  assert.strictEqual(res.statusCode, 200);
  const html = zlib.gunzipSync(res.rawPayload).toString('utf8');
  assert.ok(html.includes('<h1>Hi</h1>'));
});
