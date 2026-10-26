import type { InputFields } from '@norbital-ai/bolt';
/** The four 06:00 extracts keep each model's field kinds; refs and system columns ride along as JSON. */
export const digestOutput = <const F extends InputFields>(fields: F) =>
	({
		kind: 'object',
		fields: {
			generated_at: { kind: 'instant' },
			count: { kind: 'int' },
			rows: { kind: 'list', of: { kind: 'object', fields, rest: { kind: 'json' } } }
		}
	}) as const;
export const DAILY_0600 = { cron: '0 6 * * *' } as const;
