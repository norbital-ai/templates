import { model } from '@norbital-ai/bolt';
import { addDays } from '@norbital-ai/std/date';
import { utcOf } from '@norbital-ai/std/zone';
import { loadPool } from '../../../lib/dispatch.js';
import {
	AREAS,
	availableSlots,
	BOOKING_AHEAD,
	occurrences,
	REPEATS
} from '../../../lib/matching.js';
/**
 * One customer order: a service at an address, once or recurring, with or without preferred helpers. Each occurrence is
 * a visit; the booking holds what they share.
 *
 * `bookings_book` matches every visit before anything is written. With a preference the visits go to
 * the customer's helpers in their order; without one, ranking balances added travel and weekly load, with a small
 * continuity bonus for the previous recurring cleaner.
 */
export default model('bookings', {
	description:
		'A booking: customer, service, address, preference and repeat. Its visits are the occurrences.',
	icon: 'lucide:calendar-check',
	label: 'number',
	fields: {
		number: { kind: 'seq', pattern: 'BK-{yyyy}-{0000}' },
		customer: { kind: 'ref', to: 'customers', inverse: 'bookings' },
		service: { kind: 'ref', to: 'services', inverse: 'bookings' },
		address: { kind: 'text' },
		location: { kind: 'point', optional: true },
		area: { kind: 'enum', values: AREAS, optional: true },
		preference: { kind: 'enum', values: ['any', 'preferred'] },
		repeat: { kind: 'enum', values: REPEATS },
		status: {
			kind: 'state',
			initial: 'active',
			states: { active: { to: ['cancelled'] }, cancelled: { edit: 'none' } }
		},
		notes: { kind: 'text', optional: true },
		visit_count: { kind: 'count', of: 'visits' }
	},
	index: ['status'],
	read: 'all',
	create: {
		columns: [
			'customer',
			'service',
			'address',
			'location',
			'area',
			'preference',
			'repeat',
			'notes'
		],
		with: {
			preferred_helpers: { create: { columns: ['helper', 'rank'] } },
			visits: {
				create: {
					columns: ['slot', 'address', 'location', 'area', 'skill', 'helper', 'attention']
				}
			}
		}
	},
	update: { columns: ['notes', 'status'] },
	queries: {
		open_slots: {
			description:
				'Destination-specific starts after skills, preference, travel and the full recurring horizon are checked.',
			input: {
				customer: { kind: 'id', of: 'customers' },
				service: { kind: 'id', of: 'services' },
				preference: { kind: 'enum', values: ['any', 'preferred'] },
				helpers: { kind: 'list', of: { kind: 'id', of: 'helpers' }, max: 5, optional: true },
				repeat: { kind: 'enum', values: REPEATS },
				visits: { kind: 'int', min: 1, max: 26, optional: true },
				from: { kind: 'date' },
				days: { kind: 'int', min: 1, max: 14 }
			},
			output: {
				kind: 'list',
				of: {
					kind: 'object',
					fields: {
						day: { kind: 'date' },
						starts: { kind: 'list', of: { kind: 'instant' } }
					}
				}
			},
			run: function* (input, ctx) {
				const { customer, service } = yield* ctx.query({
					customer: { from: 'customers', id: input.customer },
					service: { from: 'services', id: input.service }
				});
				if (customer === null || service === null || !service.active)
					return yield* ctx.refuse('Pick a customer and an active service.');
				const preferred = input.preference === 'preferred' ? (input.helpers ?? []) : [];
				if (input.preference === 'preferred' && preferred.length === 0)
					return yield* ctx.refuse('Name at least one preferred helper.');
				const days = Array.from({ length: input.days }, (_, i) => addDays(input.from, i));
				const from = new Date(utcOf(days[0]!, 0, ctx.tz)).toISOString();
				const last = new Date(utcOf(days.at(-1)!, 0, ctx.tz)).toISOString();
				const end = occurrences(last, input.repeat, input.visits ?? BOOKING_AHEAD, ctx.tz).at(-1)!;
				const pool = yield* loadPool(ctx, from, end, [customer.location]);
				for (const id of preferred) {
					const h = pool.helpers.find((h) => h.id === id);
					if (h === undefined) return yield* ctx.refuse('The selected helper is not available.');
					if (!h.skills.includes(service.skill))
						return yield* ctx.refuse(`${h.name} cannot perform the selected service.`);
				}
				return availableSlots(
					{
						skill: service.skill,
						minutes: service.duration_minutes,
						location: customer.location,
						area: customer.area
					},
					days,
					pool,
					ctx.tz,
					ctx.now,
					input.repeat,
					input.visits ?? BOOKING_AHEAD,
					preferred
				);
			}
		}
	}
});
