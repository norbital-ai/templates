import type { ActInput, PlainTime } from '@norbital-ai/bolt';
import { dec } from '@norbital-ai/std/decimal';
import { inputSchema } from '@norbital-ai/std/kind';
import { Effect, Schema } from 'effect';
import { present, type T } from './test-runtime.js';

const time = (input: string) => {
	const schema = inputSchema({ kind: 'time' });
	const decoded = Schema.decodeUnknownSync(schema)(input);
	return Schema.decodeUnknownSync(
		Schema.declare<PlainTime>((value): value is PlainTime =>
			Schema.is(Schema.toType(schema))(value)
		)
	)(decoded);
};

/** Only the scheduling inputs these mechanisms need, created through the same guarded model verbs. */
export const configureWorkflow = Effect.fnUntraced(function* (t: T) {
	const admin = t.as(t.admin);
	const services = [
		{
			name: 'Fixture home cleaning',
			skill: 'home_cleaning',
			duration_minutes: 180,
			price: dec(75)
		},
		{
			name: 'Fixture deep cleaning',
			skill: 'deep_cleaning',
			duration_minutes: 300,
			price: dec(180)
		},
		{
			name: 'Fixture move-in cleaning',
			skill: 'move_in_out',
			duration_minutes: 360,
			price: dec(260)
		}
	] satisfies Exclude<ActInput<'services.create'>, readonly unknown[]>[];
	const helpers = [
		{
			name: 'Fixture Helper Alpha',
			status: 'active',
			phone: '+6590000001',
			skills: ['home_cleaning', 'deep_cleaning'],
			home_area: 'east',
			home_location: { lat: 1.3526, lng: 103.9447 },
			work_days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
			day_start: time('08:00'),
			day_end: time('18:00')
		},
		{
			name: 'Fixture Helper Bravo',
			status: 'active',
			phone: '+6590000002',
			skills: ['home_cleaning', 'move_in_out'],
			home_area: 'west',
			home_location: { lat: 1.3404, lng: 103.709 },
			work_days: ['mon', 'tue', 'wed', 'thu', 'fri'],
			day_start: time('09:00'),
			day_end: time('19:00')
		},
		{
			name: 'Fixture Helper Charlie',
			status: 'active',
			phone: '+6590000003',
			skills: ['home_cleaning', 'deep_cleaning'],
			home_area: 'central',
			home_location: { lat: 1.3048, lng: 103.8318 },
			work_days: ['tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
			day_start: time('07:00'),
			day_end: time('16:00')
		}
	] satisfies Exclude<ActInput<'helpers.create'>, readonly unknown[]>[];
	const customers = [
		{
			name: 'Fixture Customer One',
			email: 'customer.one@example.test',
			phone: '+6580000001',
			address: '1 Example Avenue, Singapore 400001',
			location: { lat: 1.3236, lng: 103.9273 },
			area: 'east'
		},
		{
			name: 'Fixture Customer Two',
			email: 'customer.two@example.test',
			phone: '+6580000002',
			address: '2 Sample Road, Singapore 600002',
			location: { lat: 1.3329, lng: 103.7436 },
			area: 'west'
		}
	] satisfies Exclude<ActInput<'customers.create'>, readonly unknown[]>[];
	for (const answer of [
		yield* admin.act('services.create', services),
		yield* admin.act('helpers.create', helpers),
		yield* admin.act('customers.create', customers),
		yield* admin.act('dispatch_settings.create', {
			eta_limit_minutes: 30,
			eta_check_lead_minutes: 60,
			shift_check_lead_minutes: 120,
			shift_reply_minutes: 60,
			free_change_hours: 24
		})
	])
		if (answer.kind !== 'committed') throw new Error(`Fixture write ${answer.kind}`);
	const data = yield* admin.query({
		services: { from: 'services', select: { name: true }, all: true },
		helpers: { from: 'helpers', select: { name: true }, all: true },
		customers: { from: 'customers', select: { phone: true }, all: true }
	});
	return {
		HOME_CLEANING: present(data.services.rows.find((row) => row.name === 'Fixture home cleaning'))
			.id,
		DEEP_CLEANING: present(data.services.rows.find((row) => row.name === 'Fixture deep cleaning'))
			.id,
		MOVE_IN: present(data.services.rows.find((row) => row.name === 'Fixture move-in cleaning')).id,
		ALPHA: present(data.helpers.rows.find((row) => row.name === 'Fixture Helper Alpha')).id,
		BRAVO: present(data.helpers.rows.find((row) => row.name === 'Fixture Helper Bravo')).id,
		CHARLIE: present(data.helpers.rows.find((row) => row.name === 'Fixture Helper Charlie')).id,
		EAST_CUSTOMER: present(data.customers.rows.find((row) => row.phone === '+6580000001')).id,
		WEST_CUSTOMER: present(data.customers.rows.find((row) => row.phone === '+6580000002')).id
	};
});
