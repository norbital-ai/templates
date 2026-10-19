import type { QueryOutput, ReadSetAnswer, Select } from '@norbital-ai/bolt';
import { Instant } from '@norbital-ai/std/date';
import { fixtureId } from '../test-runtime.js';

const helperSelect = { name: true } as const satisfies Select<'helpers'>;
const todaySelect = {
	number: true,
	slot: true,
	address: true,
	location: true,
	status: true,
	shift_check: true,
	completed_at: true,
	booking: {
		select: {
			notes: true,
			service: { select: { name: true } },
			customer: { select: { name: true, phone: true } }
		}
	}
} as const satisfies Select<'visits'>;
const recoverySelect = {
	number: true,
	slot: true,
	status: true,
	helper: true,
	address: true,
	attention: true,
	proposed_helper: true,
	unavailable_helper: { select: { name: true } },
	booking: { select: { customer: { select: { name: true } }, service: { select: { name: true } } } }
} as const satisfies Select<'visits'>;

type FixtureReads = ReadSetAnswer<{
	helper: { collection: 'helpers'; select: typeof helperSelect; all: true };
	today: { collection: 'visits'; select: typeof todaySelect; all: true };
	recovery: { collection: 'visits'; select: typeof recoverySelect; all: true };
}>;

export const visitId = fixtureId('visits', '0d500004-0000-4000-8000-000000000001');
const helperId = fixtureId('helpers', '0d500002-0000-4000-8000-000000000001');
const replacementId = fixtureId('helpers', '0d500002-0000-4000-8000-000000000002');
const bookingId = fixtureId('bookings', '0d500005-0000-4000-8000-000000000001');
const customerId = fixtureId('customers', '0d500003-0000-4000-8000-000000000001');
const serviceId = fixtureId('services', '0d500001-0000-4000-8000-000000000001');

export const todayFixture = (): {
	helper: FixtureReads['helper']['rows'][number];
	visit: FixtureReads['today']['rows'][number];
} => ({
	helper: { id: helperId, name: 'Helper' },
	visit: {
		id: visitId,
		number: 'V-1',
		slot: {
			start: Instant(new Date().toISOString()),
			end: Instant(new Date(Date.now() + 3600000).toISOString())
		},
		address: 'Customer address',
		location: null,
		status: 'scheduled',
		shift_check: 'not_due',
		completed_at: null,
		booking: {
			id: bookingId,
			notes: null,
			service: { id: serviceId, name: 'Cleaning' },
			customer: { id: customerId, name: 'Customer', phone: '+6580000001' }
		}
	}
});

export const recoveryFixture = (): {
	visit: FixtureReads['recovery']['rows'][number];
	candidates: QueryOutput<'visits.candidates'>;
} => ({
	visit: {
		id: visitId,
		number: 'V-1',
		status: 'scheduled',
		helper: helperId,
		address: 'Address',
		attention: 'awaiting_approval',
		slot: { start: Instant('2099-01-01T02:00:00.000Z'), end: Instant('2099-01-01T05:00:00.000Z') },
		proposed_helper: replacementId,
		unavailable_helper: null,
		booking: {
			id: bookingId,
			customer: { id: customerId, name: 'Customer' },
			service: { id: serviceId, name: 'Cleaning' }
		}
	},
	candidates: [
		{
			helper: replacementId,
			name: 'Replacement',
			drive_minutes: 10,
			same_area: true,
			week_hours: 4
		}
	]
});
