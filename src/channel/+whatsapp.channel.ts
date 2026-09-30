import { channel } from '@norbital-ai/bolt';

/**
 * The business's WhatsApp account: customer notices and helper alerts go out on it. Link the account in the host's
 * channel settings; until then sends on it fail and are recorded on the notice.
 */
export default channel({ transport: 'whatsapp' });
