'use strict';

/**
 * Asyntai AI chatbot for Fastify.
 *
 * Adds the Asyntai chat widget to every HTML page a Fastify app sends. It uses
 * an onSend hook, so it works for HTML from reply.send(), @fastify/view
 * templates and @fastify/static files alike: the plugin puts the ordinary
 * embed loader just before </body> and changes nothing else.
 *
 * Wrapped with fastify-plugin so the hook applies to the whole app, not only
 * to the routes registered inside the plugin's own scope.
 */

const fp = require('fastify-plugin');

const DEFAULT_SCRIPT_URL = 'https://widget.asyntai.com/static/js/chat-widget.js';
const WIDGET_ID_PATTERN = /^asyntai_[A-Za-z0-9]+$/;
const NAME = 'fastify-ai-chatbot';

/**
 * Fastify registers the plugin at startup, so a wrong option stops the app
 * with a clear message instead of serving a site with no chat on it.
 */
function validateOptions(options) {
  const opts = options || {};
  const fromEnv = process.env.ASYNTAI_WIDGET_ID;
  const raw = typeof opts.widgetId === 'string' && opts.widgetId.trim()
    ? opts.widgetId
    : (typeof fromEnv === 'string' ? fromEnv : '');
  const widgetId = raw.trim();

  if (!widgetId) {
    throw new Error(
      NAME +
        ': "widgetId" is required. Copy it from the Install page of your ' +
        'Asyntai dashboard, for example asyntai_1a2b3c4d5e6f, or set the ' +
        'ASYNTAI_WIDGET_ID environment variable.',
    );
  }
  if (!WIDGET_ID_PATTERN.test(widgetId)) {
    throw new Error(
      NAME +
        ': "' +
        widgetId +
        '" does not look like a widget ID. It starts with asyntai_, for ' +
        'example asyntai_1a2b3c4d5e6f.',
    );
  }
  if (opts.shouldInject !== undefined && typeof opts.shouldInject !== 'function') {
    throw new Error(NAME + ': "shouldInject" must be a function (request, reply) => boolean.');
  }

  const scriptUrl =
    typeof opts.scriptUrl === 'string' && opts.scriptUrl.trim()
      ? opts.scriptUrl.trim()
      : DEFAULT_SCRIPT_URL;

  return {
    widgetId,
    scriptUrl,
    shouldInject: opts.shouldInject || null,
  };
}

/** JSON.stringify, safe inside an HTML <script> element. */
function jsString(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/**
 * The loader waits for the page's load event before it fetches the widget.
 * An ordinary `<script async src>` holds the load event open until its own
 * fetch finishes, so an unreachable server would delay the host page. This
 * pattern cannot.
 */
function buildLoader(widgetId, scriptUrl) {
  return (
    '(function(){var l=function(){' +
    'if(document.querySelector("script[data-asyntai-id]"))return;' +
    'var s=document.createElement("script");' +
    's.src=' +
    jsString(scriptUrl) +
    // charset: the widget script is UTF-8. Without this, a page that does not
    // declare UTF-8 itself decodes the widget's texts in the wrong encoding.
    ';s.async=true;s.charset="UTF-8";' +
    's.setAttribute("data-asyntai-id",' +
    jsString(widgetId) +
    ');' +
    'document.head.appendChild(s)};' +
    'if(document.readyState==="complete"){l()}' +
    'else{window.addEventListener("load",l)}})();'
  );
}

/**
 * Puts the tag before the last </body>, or before </html> when the page has no
 * body tag. A fragment with neither is left alone: it is not a whole page.
 * A page that already carries an Asyntai snippet is left alone too.
 */
function injectIntoHtml(html, tag) {
  if (typeof html !== 'string' || html.includes('data-asyntai-id') || html.includes('data-asyntai-loader')) {
    return html;
  }
  const lower = html.toLowerCase();
  let at = lower.lastIndexOf('</body>');
  if (at === -1) {
    at = lower.lastIndexOf('</html>');
  }
  if (at === -1) {
    return html;
  }
  return html.slice(0, at) + tag + html.slice(at);
}

function isHtmlResponse(reply) {
  const type = reply.getHeader('content-type');
  return typeof type === 'string' && type.toLowerCase().includes('text/html');
}

/** True when the body is already encoded (gzip, br...) and cannot be edited as text. */
function isEncoded(reply) {
  const enc = reply.getHeader('content-encoding');
  return typeof enc === 'string' && enc.trim() !== '' && enc.toLowerCase() !== 'identity';
}

function isStream(payload) {
  return payload !== null && typeof payload === 'object' && typeof payload.pipe === 'function';
}

/** Reads a whole stream into one Buffer. HTML pages are small. */
function readStream(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

async function fastifyAiChatbot(fastify, options) {
  const settings = validateOptions(options);
  const tag =
    '<script data-asyntai-loader>' +
    buildLoader(settings.widgetId, settings.scriptUrl) +
    '</script>';

  fastify.addHook('onSend', async (request, reply, payload) => {
    if (payload === null || payload === undefined) return payload;
    if (request.method === 'HEAD') return payload;
    const status = reply.statusCode;
    if (status === 204 || status === 304 || status < 200 || (status >= 300 && status < 400)) return payload;
    if (!isHtmlResponse(reply) || isEncoded(reply)) return payload;
    if (settings.shouldInject && !settings.shouldInject(request, reply)) return payload;

    let html;
    if (typeof payload === 'string') {
      html = payload;
    } else if (Buffer.isBuffer(payload)) {
      html = payload.toString('utf8');
    } else if (isStream(payload)) {
      // @fastify/static sends files as streams. Read the page, then send it as text.
      html = (await readStream(payload)).toString('utf8');
    } else {
      return payload;
    }

    const out = injectIntoHtml(html, tag);
    if (out !== html || isStream(payload)) {
      // The body length changed (or was a stream): let Fastify set it again.
      reply.removeHeader('content-length');
    }
    return out;
  });
}

const plugin = fp(fastifyAiChatbot, {
  fastify: '4.x || 5.x',
  name: NAME,
});

module.exports = plugin;
module.exports.default = plugin;
module.exports.fastifyAiChatbot = plugin;
module.exports.validateOptions = validateOptions;
module.exports.buildLoader = buildLoader;
module.exports.injectIntoHtml = injectIntoHtml;
module.exports.DEFAULT_SCRIPT_URL = DEFAULT_SCRIPT_URL;
