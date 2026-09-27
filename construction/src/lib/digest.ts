/**
 * The four 06:00 digests share one output: when the extract was taken, how many rows it holds, and the rows (the first
 * 25 in the digest's order), as today's JSON extract.
 */
export const digestOutput = {
	kind: 'object',
	fields: {
		generated_at: { kind: 'instant' },
		count: { kind: 'int' },
		rows: { kind: 'list', of: { kind: 'json' } }
	}
} as const;

export const DAILY_0600 = { cron: '0 6 * * *' } as const;
