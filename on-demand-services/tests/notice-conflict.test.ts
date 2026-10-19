import { Effect } from 'effect';
import { ActConflict, ActRefused } from '@norbital-ai/bolt/errors';
import { expect, it, vi } from '@effect/vitest';
import { deliverNoticeRows } from '../src/lib/notice-delivery.js';
import { fixtureId } from './test-runtime.js';

const notice: Parameters<typeof deliverNoticeRows>[0][number] = {
	id: fixtureId('customer_notices', '0d500007-0000-4000-8000-000000000001'),
	subject: 'Booked',
	body: 'Confirmed',
	customer: { phone: '6580000001' }
};

it.live('a conflicting notice status write retries without sending WhatsApp twice', () =>
	Effect.gen(function* () {
		const send = vi.fn(() => Effect.void);
		const write = vi
			.fn<
				(
					callable: 'customer_notices.update',
					set: Parameters<Parameters<typeof deliverNoticeRows>[2]>[0]
				) => ReturnType<Parameters<typeof deliverNoticeRows>[2]>
			>()
			.mockReturnValueOnce(
				Effect.fail(
					new ActConflict({
						records: [{ collection: 'customer_notices', id: notice.id, fields: [] }]
					})
				)
			)
			.mockReturnValueOnce(Effect.void);
		yield* deliverNoticeRows([notice], send, (set) => write('customer_notices.update', set));
		expect(send).toHaveBeenCalledTimes(1);
		expect(write).toHaveBeenCalledTimes(2);
		expect(write.mock.calls[0]).toEqual([
			'customer_notices.update',
			[{ target: notice.id, set: { whatsapp: 'sent' } }]
		]);
		expect(write.mock.calls[1]).toEqual(write.mock.calls[0]);
	})
);

it.live('a refused notice status write is not retried', () =>
	Effect.gen(function* () {
		const send = vi.fn(() => Effect.void);
		const write = vi.fn(() =>
			Effect.fail(new ActRefused({ code: 'forbidden', message: 'Cannot record delivery' }))
		);
		expect(yield* Effect.flip(deliverNoticeRows([notice], send, write))).toMatchObject({
			_tag: 'ActRefused'
		});
		expect(send).toHaveBeenCalledTimes(1);
		expect(write).toHaveBeenCalledTimes(1);
	})
);
