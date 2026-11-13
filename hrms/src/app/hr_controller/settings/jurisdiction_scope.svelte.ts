import type { PageContext } from '@norbital-ai/bolt/page';

/** The Settings app's scope is a law and a day. Every jurisdiction, live. Call during component initialisation. */
export const jurisdictions = (ctx: PageContext) =>
	ctx.query({ jurisdiction: { order_by: { code: 'asc' }, limit: 1000 } });
