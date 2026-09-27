import { channel } from '@norbital-ai/bolt';

/** The WhatsApp number the `field_ops_whatsapp` envoy answers contractors on. */
export default channel({ transport: 'whatsapp' });
