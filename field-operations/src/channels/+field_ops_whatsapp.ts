import { defineChannel } from '@norbital-ai/bolt/authoring';

/** The WhatsApp number the `field_ops_whatsapp` envoy answers contractors on. */
export default defineChannel({ transport: 'whatsapp' });
