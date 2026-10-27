import customers from './customers.json' with { type: 'json' };
import dispatch_settings from './dispatch_settings.json' with { type: 'json' };
import helpers from './helpers.json' with { type: 'json' };
import services from './services.json' with { type: 'json' };
import type { BankReader, Id, PlainTime, SeedSource } from '@norbital-ai/bolt';
import { addDays, Instant } from '@norbital-ai/std/date';
import { inputSchema } from '@norbital-ai/std/kind';
import { localOf, utcOf } from '@norbital-ai/std/zone';
import { Schema } from 'effect';
import {
	occurrences,
	planBooking,
	type Busy,
	type Helper,
	type Point
} from '../src/lib/matching.js';

/**
 * The public pack is the files beside this one. The sample pack is the bank tree `on-demand-services`: a cleaning
 * company's desk, cleaners and customers, and booking intents dated by days from the build. Each intent is matched in
 * order by `planBooking`, the matching every booking uses, so the seeded week is what the desk would have built; the
 * cleaner marked `joined` was hired after those bookings, which leaves the desk something to optimise. Visits already
 * over are done, one under way is in progress, and each cleaner's last position is where they are now.
 */
const ZONE = 'Asia/Singapore';
const MINUTE = 60_000;
const Row = Schema.Record(Schema.String, Schema.Json);
type Row = Schema.Schema.Type<typeof Row>;
const Point = Schema.Struct({ lat: Schema.Number, lng: Schema.Number });
/** The bank's team ids, as this workspace's team handles. */
const TEAMS = { 'team-operations': 'operations', 'team-helpers': 'helpers' } as const;
const User = Schema.StructWithRest(
	Schema.Struct({ team: Schema.Literals(['team-operations', 'team-helpers']) }),
	[Row]
);
const Staff = Schema.StructWithRest(
	Schema.Struct({
		id: Schema.String,
		name: Schema.String,
		skills: Schema.Array(Schema.String),
		home_area: Schema.NullOr(Schema.String),
		home_location: Schema.NullOr(Point),
		work_days: Schema.Array(Schema.String),
		day_start: Schema.String,
		day_end: Schema.String,
		joined: Schema.optionalKey(Schema.Boolean)
	}),
	[Row]
);
type Bank = Schema.Schema.Type<typeof Staff>;
const Customer = Schema.StructWithRest(
	Schema.Struct({
		id: Schema.String,
		address: Schema.String,
		location: Point,
		area: Schema.String
	}),
	[Row]
);
const Intent = Schema.Struct({
	id: Schema.String,
	customer: Schema.String,
	service: Schema.String,
	repeat: Schema.String,
	day: Schema.Number,
	time: Schema.String
});
/** An on-day situation, minutes from the build: unanswered shift check, one still pending, a cleaner far away. */
const Scenario = Schema.Struct({
	id: Schema.String,
	helper: Schema.String,
	customer: Schema.String,
	service: Schema.String,
	/** Minutes from the build, on the quarter hour; or `at`, a wall time today. */
	in_minutes: Schema.optionalKey(Schema.Number),
	at: Schema.optionalKey(Schema.String),
	shift: Schema.Literals(['silent', 'pending', 'confirmed', 'mc']),
	far: Schema.optionalKey(Point)
});
/** What a cleaner writes when they finish, rotated over finished visits. */
const NOTES = [
	'All rooms done. Customer asked for the balcony next time.',
	'Kitchen degreased, bathrooms descaled. Keys left with the guard.',
	'Done on time. Extra 10 minutes on the oven, as requested.',
	'Finished. Customer away; photos of the living room sent to the desk.',
	'Ironing folded on the bed. Two shirts left on hangers.'
];
const startOf = (v: Row) =>
	Schema.decodeUnknownSync(Schema.Struct({ start: Schema.String }))(v['slot']).start;
/** Matching consumes native values; the seed pack keeps their original JSON representations. */
const idOf = <C extends string>(model: C, value: string): Id<C> => {
	const schema = inputSchema({ kind: 'id', of: model });
	const decoded = Schema.decodeUnknownSync(schema)(value);
	return Schema.decodeUnknownSync(
		Schema.declare<Id<C>>((input): input is Id<C> => Schema.is(Schema.toType(schema))(input))
	)(decoded);
};
const timeOf = (value: string): PlainTime => {
	const schema = inputSchema({ kind: 'time' });
	const decoded = Schema.decodeUnknownSync(schema)(value);
	return Schema.decodeUnknownSync(
		Schema.declare<PlainTime>((input): input is PlainTime =>
			Schema.is(Schema.toType(schema))(input)
		)
	)(decoded);
};
const helperOf = (h: Bank): Helper => ({
	id: idOf('helpers', h.id),
	name: h.name,
	skills: h.skills,
	home_area: h.home_area,
	home_location: h.home_location,
	work_days: h.work_days,
	day_start: timeOf(h.day_start),
	day_end: timeOf(h.day_end),
	status: 'active'
});
const noteOf = (index: number): string => {
	const note = NOTES[index % NOTES.length];
	if (note === undefined) throw new Error(`No completion note for visit ${index}`);
	return note;
};

function sample(bank: BankReader) {
	const now = Date.now();
	const today = localOf(now, ZONE).date;
	const users = Schema.decodeUnknownSync(Schema.Array(User))(bank.json('user.json'));
	const staff = Schema.decodeUnknownSync(Schema.Array(Staff))(bank.json('helpers.json'));
	const people = Schema.decodeUnknownSync(Schema.Array(Customer))(bank.json('customers.json'));
	const busy: Busy[] = [];
	const pool = {
		helpers: staff.filter((h) => h.joined !== true).map(helperOf),
		busy,
		off: []
	};
	const service = new Map(services.map((s) => [s.id, s]));
	const who = new Map(people.map((c) => [c.id, c]));
	const bookings: Row[] = [];
	const visits: Row[] = [];
	const far = new Map<string, Point>();
	const scenarios = bank.has('scenarios.json')
		? Schema.decodeUnknownSync(Schema.Array(Scenario))(bank.json('scenarios.json'))
		: [];
	for (const [i, x] of scenarios.entries()) {
		const s = service.get(x.service);
		const c = who.get(x.customer);
		if (s === undefined || c === undefined)
			throw new Error(`Scenario ${x.id} names an unknown service or customer`);
		// on the quarter hour, as a desk would book it; or at a set time this morning
		const [ah = 0, am = 0] = (x.at ?? '').split(':').map(Number);
		const start =
			x.at !== undefined
				? utcOf(today, (ah * 60 + am) * MINUTE, ZONE)
				: Math.ceil((now + (x.in_minutes ?? 0) * MINUTE) / (15 * MINUTE)) * 15 * MINUTE;
		const slot = {
			start: Instant(new Date(start).toISOString()),
			end: Instant(new Date(start + s.duration_minutes * MINUTE).toISOString())
		};
		const id = `0d500005-0000-4000-8000-${String(900 + i).padStart(12, '0')}`;
		pool.busy.push({
			id: idOf('visits', id),
			helper: idOf('helpers', x.helper),
			slot,
			location: c.location
		});
		if (x.far !== undefined) far.set(x.helper, x.far);
		bookings.push({
			id: x.id,
			number: `BK-${today.slice(0, 4)}-${String(900 + i).padStart(4, '0')}`,
			customer: c.id,
			service: s.id,
			address: c.address,
			location: c.location,
			area: c.area,
			preference: 'any',
			repeat: 'once',
			status: 'active'
		});
		visits.push({
			id,
			booking: x.id,
			helper: x.helper,
			slot,
			address: c.address,
			location: c.location,
			area: c.area,
			skill: s.skill,
			...(start + s.duration_minutes * MINUTE <= now
				? {
						status: 'done',
						shift_check: 'confirmed',
						started_at: slot.start,
						completed_at: slot.end,
						completion_notes: noteOf(i)
					}
				: start <= now
					? { status: 'in_progress', shift_check: 'confirmed', started_at: slot.start }
					: {
							status: 'scheduled',
							// asked two hours ahead, as `shift_watch` does: silent has let the hour run out, pending has
							// not; mc already answered "can't come" with a certificate, for the next run to cover
							shift_check:
								x.shift === 'confirmed' ? 'confirmed' : x.shift === 'mc' ? 'declined' : 'asked',
							mc: x.shift === 'mc',
							shift_asked_at: new Date(
								x.shift === 'silent' ? now - 65 * MINUTE : now - 15 * MINUTE
							).toISOString()
						})
		});
	}
	for (const [i, intent] of Schema.decodeUnknownSync(Schema.Array(Intent))(
		bank.json('bookings.json')
	).entries()) {
		const s = service.get(intent.service);
		const c = who.get(intent.customer);
		if (s === undefined || c === undefined)
			throw new Error(`Booking ${intent.id} names an unknown service or customer`);
		const [h = 0, m = 0] = intent.time.split(':').map(Number);
		const first = Instant(
			new Date(utcOf(addDays(today, intent.day), (h * 60 + m) * MINUTE, ZONE)).toISOString()
		);
		const need = {
			skill: s.skill,
			location: c.location,
			area: c.area,
			minutes: s.duration_minutes
		};
		const plan = planBooking(need, occurrences(first, intent.repeat, 4, ZONE), pool, ZONE);
		if (plan.missing !== null) continue;
		bookings.push({
			id: intent.id,
			number: `BK-${today.slice(0, 4)}-${String(i + 1).padStart(4, '0')}`,
			customer: c.id,
			service: s.id,
			address: c.address,
			location: c.location,
			area: c.area,
			preference: 'any',
			repeat: intent.repeat,
			status: 'active'
		});
		for (const v of plan.visits) {
			const id = `0d500005-0000-4000-8000-${String(visits.length + 1).padStart(12, '0')}`;
			pool.busy.push({
				id: idOf('visits', id),
				helper: v.helper,
				slot: v.slot,
				location: c.location
			});
			const start = Date.parse(v.slot.start),
				end = Date.parse(v.slot.end);
			const status = end <= now ? 'done' : start <= now ? 'in_progress' : 'scheduled';
			visits.push({
				id,
				booking: intent.id,
				helper: v.helper,
				slot: v.slot,
				address: c.address,
				location: c.location,
				area: c.area,
				skill: s.skill,
				status,
				shift_check: status === 'scheduled' ? 'not_due' : 'confirmed',
				...(status === 'scheduled' ? {} : { started_at: v.slot.start }),
				...(status === 'done'
					? { completed_at: v.slot.end, completion_notes: noteOf(visits.length) }
					: {})
			});
		}
	}
	// numbered in start order, as the board lists a lane by number
	visits.sort((a, b) => startOf(a).localeCompare(startOf(b)));
	for (const [i, v] of visits.entries())
		Object.assign(v, { number: `V-${today.slice(0, 4)}-${String(i + 1).padStart(5, '0')}` });
	/** Where each cleaner is: at the visit under way, else the last one finished today, else home. */
	const here = (h: Bank) => {
		const mine = visits
			.filter(
				(v) =>
					v['helper'] === h.id &&
					v['status'] !== 'scheduled' &&
					localOf(Date.parse(startOf(v)), ZONE).date === today
			)
			.sort((a, b) => String(a['number']).localeCompare(String(b['number'])));
		const location = mine.at(-1)?.['location'];
		return location == null ? h.home_location : Schema.decodeUnknownSync(Point)(location);
	};
	return {
		sys_user: users.map(({ team, ...u }) => ({
			...u,
			kind: 'staff',
			admin: false,
			team: TEAMS[team]
		})),
		services,
		dispatch_settings,
		helpers: staff.map(({ joined: _, ...h }) => ({
			...h,
			last_location: far.get(h.id) ?? here(h),
			last_location_at: new Date(now - 3 * MINUTE).toISOString()
		})),
		customers: people,
		bookings,
		visits
	};
}

export default {
	bank: 'on-demand-services',
	rows: (bank) =>
		bank.has('helpers.json') ? sample(bank) : { customers, dispatch_settings, helpers, services }
} satisfies SeedSource;
