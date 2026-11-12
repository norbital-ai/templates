import type { MessageKey } from '@norbital-ai/bolt';
import type { PageContext } from '@norbital-ai/bolt/page';
import catalogue from '../../i18n/+messages.js';
/** A runtime key (a refusal's message, a composed key) in this workspace's catalogue, else the text as given. */
export const translated = (ctx: Pick<PageContext, 't'>, key: string) =>
	isMessageKey(key) ? ctx.t(key) : key;
const isMessageKey = (key: string): key is MessageKey => Object.hasOwn(catalogue, key);
