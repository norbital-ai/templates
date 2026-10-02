import { expect, it, vi } from 'vitest';

const captured = vi.hoisted(() => ({
	run: undefined as
		| undefined
		| ((
				input: { ids: string[] },
				ctx: {
					read: ReturnType<typeof vi.fn>;
					send: ReturnType<typeof vi.fn>;
					act: ReturnType<typeof vi.fn> & { try: ReturnType<typeof vi.fn> };
				}
		  ) => Promise<void>)
}));
vi.mock('@norbital-ai/bolt', () => ({
	automation: () => ({
		run: (run: NonNullable<typeof captured.run>) => {
			captured.run = run;
		}
	})
}));
await import('../src/automation/+deliver_notices.automation.ts');

it('a conflicting notice status write retries without sending WhatsApp twice', async () => {
	const conflict = {
		kind: 'conflict',
		records: [{ collection: 'customer_notices', id: 'notice', fields: [] }]
	};
	const committed = { kind: 'committed', records: [] };
	const write = vi.fn().mockResolvedValueOnce(conflict).mockResolvedValueOnce(committed);
	const act = Object.assign(
		vi.fn(async (...args: unknown[]) => {
			const result = await write(...args);
			if (result.kind === 'conflict') throw new Error(JSON.stringify(result));
			return result;
		}),
		{ try: write }
	);
	const ctx = {
		read: vi.fn().mockResolvedValue({
			rows: [
				{ id: 'notice', subject: 'Booked', body: 'Confirmed', customer: { phone: '6580000001' } }
			]
		}),
		send: vi.fn().mockResolvedValue(undefined),
		act
	};
	await captured.run!({ ids: ['notice'] }, ctx);
	expect(ctx.send).toHaveBeenCalledTimes(1);
	expect(write).toHaveBeenCalledTimes(2);
	expect(write.mock.calls[0]).toEqual([
		'customer_notices.update',
		[{ target: 'notice', set: { whatsapp: 'sent' } }]
	]);
	expect(write.mock.calls[1]).toEqual(write.mock.calls[0]);
});
