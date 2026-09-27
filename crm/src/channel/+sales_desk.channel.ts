import { channel } from '@norbital-ai/bolt';

/** The Telegram bot the `sales_desk` envoy answers on. */
export default channel({ transport: 'telegram' });
