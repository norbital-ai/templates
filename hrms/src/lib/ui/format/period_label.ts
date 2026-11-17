import type { PageContext } from '@norbital-ai/bolt/page';
import { format } from '@norbital-ai/ui';

/** A pay cycle's key as people read it: its month, with its half for a half-month cycle, or its day. */
export const periodLabel = (ctx: PageContext, key: string): string =>
	key.length === 10
		? format({ kind: 'date' }, key, { locale: ctx.locale })
		: `${format({ kind: 'date', precision: 'month' }, `${key.slice(0, 7)}-01`, { locale: ctx.locale })}${
				key.length === 9
					? ` · ${ctx.t(key.endsWith('1') ? 'app.payroll.first_half' : 'app.payroll.second_half')}`
					: ''
			}`;
