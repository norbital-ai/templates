import { defineChannel } from '@norbital-ai/bolt/authoring';

/** The Telegram bot the `sales_desk` envoy answers on. */
export default defineChannel({ transport: 'telegram' });
