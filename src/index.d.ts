import { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';

export interface FastifyAiChatbotOptions {
  /**
   * Your Asyntai widget ID, for example "asyntai_1a2b3c4d5e6f".
   * Copy it from the Install page of your Asyntai dashboard.
   * If you leave it out, the plugin reads the ASYNTAI_WIDGET_ID environment variable.
   */
  widgetId?: string;
  /** Optional: return false to keep the chat off a page, for example an admin area. */
  shouldInject?: (request: FastifyRequest, reply: FastifyReply) => boolean;
  /** Optional: a different widget script address. Leave it out to use the default. */
  scriptUrl?: string;
}

declare const fastifyAiChatbot: FastifyPluginAsync<FastifyAiChatbotOptions>;

export default fastifyAiChatbot;
export { fastifyAiChatbot };

export declare function validateOptions(options?: FastifyAiChatbotOptions): {
  widgetId: string;
  scriptUrl: string;
  shouldInject: ((request: FastifyRequest, reply: FastifyReply) => boolean) | null;
};
export declare function buildLoader(widgetId: string, scriptUrl: string): string;
export declare function injectIntoHtml(html: string, tag: string): string;
export declare const DEFAULT_SCRIPT_URL: string;
