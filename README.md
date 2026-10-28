# fastify-ai-chatbot

Add the [Asyntai](https://asyntai.com) AI chat assistant to every HTML page of
your Fastify app. It answers visitor questions from your own content, in more
than 80 languages.

Full guide: https://asyntai.com/documentation/integrations/fastify/

## Install

```bash
npm install fastify-ai-chatbot
```

## Use

```js
const fastify = require('fastify')();

fastify.register(require('fastify-ai-chatbot'), {
  widgetId: 'asyntai_1a2b3c4d5e6f',
});

fastify.get('/', (request, reply) => {
  reply.type('text/html').send('<html><body><h1>Hello</h1></body></html>');
});

fastify.listen({ port: 3000 });
```

ES modules and TypeScript:

```js
import Fastify from 'fastify';
import aiChatbot from 'fastify-ai-chatbot';

const fastify = Fastify();
await fastify.register(aiChatbot, { widgetId: 'asyntai_1a2b3c4d5e6f' });
```

Open any page of your app. The chat bubble is in the corner.

## Where the widget ID comes from

Open the Install page in your [Asyntai dashboard](https://asyntai.com/dashboard).
The widget ID is the value of `data-asyntai-id` in the snippet. It starts with
`asyntai_`. If you leave `widgetId` out, the plugin reads the
`ASYNTAI_WIDGET_ID` environment variable.

## Options

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `widgetId` | string | `ASYNTAI_WIDGET_ID` | Your Asyntai widget ID |
| `shouldInject` | `(request, reply) => boolean` | every page | Return `false` to keep the chat off a page |
| `scriptUrl` | string | the Asyntai CDN | Advanced. Load the widget from another URL |

A missing or malformed widget ID stops the app at startup with a clear message.

Keep the chat off admin pages:

```js
fastify.register(require('fastify-ai-chatbot'), {
  widgetId: 'asyntai_1a2b3c4d5e6f',
  shouldInject: (request) => !request.url.startsWith('/admin'),
});
```

## How it works

The plugin adds an `onSend` hook and puts the Asyntai loader just before
`</body>` of every HTML response. It works for HTML from `reply.send()`,
`@fastify/view` templates and `@fastify/static` files, in every route and
prefix of the app. JSON, non-HTML files, redirects, `204` and `304` responses
are not changed. A page that already has the Asyntai snippet is left alone.

The loader waits for the page's `load` event, so your page always renders
first.

Register the plugin **before** `@fastify/compress`. Then the chat is added
first and the page is compressed after that.

## Compatibility

Fastify 4 and 5, Node 18 or later.

## Tests

```bash
npm install
npm test
```

## License

MIT
