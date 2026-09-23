import { defineChannel } from '@norbital-ai/bolt/authoring';

/** The in-app inbox: where leave approvals and late-arrival reminders reach a person. */
export default defineChannel({ transport: 'inbox' });
