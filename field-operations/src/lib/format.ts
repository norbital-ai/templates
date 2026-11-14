import type { MessageKey } from '@norbital-ai/bolt';
import catalog from '../i18n/+messages.js';
/** Whether `key` is one of the workspace's messages, such as an enum value's `models.<model>.fields.<field>.<value>`. */
export const isMessageKey = (key: string): key is MessageKey => Object.hasOwn(catalog, key);
