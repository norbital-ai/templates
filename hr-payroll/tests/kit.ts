import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
	TestWorkspace,
	type Kit,
	type TestOptions,
	type TestPorts
} from '@norbital-ai/bolt-cli/test';
import { Effect, Schema } from 'effect';
import { PlainDate, addDays, monthOf } from '@norbital-ai/std/date';
import type { Id } from '@norbital-ai/bolt';
import { accountsOf, type Accounts } from '../src/lib/ledger/core.ts';
import { JsonObject } from '../src/lib/payroll_engine/contracts.ts';
import { isJsonObject, jsonObject } from '../src/lib/payroll_engine/foundation.ts';
import { idOf } from '../src/lib/payroll_engine/reads.ts';

/** One scoped real workspace over this template's source, seeded by the rows a test writes. */
export const workspace = <P extends TestPorts = never>(
	options: Omit<
		Extract<TestOptions<P>, { artifact?: never }>,
		'root' | 'manifest' | 'guest' | 'transforms'
	> = {}
) => TestWorkspace.layer({ root: process.cwd(), ...options });

export const uuid = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`;
export const ENTITY = idOf('entity', uuid(1));
export const PAY_GROUP = uuid(8);
export const WORK = uuid(11),
	REST = uuid(12),
	OFF = uuid(13);
const constantsByDirectory = new Map<string, ReadonlyMap<string, JsonObject>>();
/** The shared constants a version's settings row declares, keyed by settings id. */
const sharedConstants = (path: string): ReadonlyMap<string, JsonObject> => {
	const dir = dirname(path);
	const held = constantsByDirectory.get(dir);
	if (held !== undefined) return held;
	const map = new Map<string, JsonObject>();
	const settings = join(dir, 'jurisdiction_settings.json');
	if (existsSync(settings)) {
		const value: unknown = JSON.parse(readFileSync(settings, 'utf8'));
		const rows = Schema.decodeUnknownSync(Schema.Array(JsonObject))(
			Array.isArray(value) ? value : [value]
		);
		for (const row of rows) {
			const lookup = isJsonObject(row.lookup) ? row.lookup : {};
			const constants = isJsonObject(lookup.constants) ? lookup.constants : {};
			if (typeof row.id === 'string') map.set(row.id, constants);
		}
	}
	constantsByDirectory.set(dir, map);
	return map;
};
export const read = (path: string): readonly JsonObject[] => {
	const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
	const rows = Schema.decodeUnknownSync(Schema.Array(JsonObject))(
		Array.isArray(value) ? value : [value]
	);
	if (path.endsWith('jurisdiction_settings.json')) return rows;
	const constants = sharedConstants(path);
	return rows.map((row) => {
		const id = typeof row.settings_id === 'string' ? row.settings_id : null;
		const held = id === null ? undefined : constants.get(id);
		if (held === undefined || !isJsonObject(row.lookup)) return row;
		return { ...row, lookup: { ...held, ...row.lookup } };
	});
};
/** Fixtures may still write the old buckets; the contract stores the flat facts the schema now declares. */
const flattenExtension = (value: JsonObject): JsonObject => {
	const { facts, term_facts, exit_facts, ...rest } = value;
	const merged: Record<string, unknown> = {
		...(isJsonObject(facts) ? facts : {}),
		...(isJsonObject(term_facts) ? term_facts : {}),
		...(isJsonObject(exit_facts) ? exit_facts : {}),
		...rest
	};
	if (isJsonObject(merged.statutory))
		merged.statutory = Object.fromEntries(
			Object.entries(merged.statutory).map(([scheme, body]) => [
				scheme,
				isJsonObject(body) && isJsonObject(body.elections) ? { ...body, ...body.elections } : body
			])
		);
	return jsonObject(merged);
};
type Day = {
	readonly date: string;
	readonly shift: string;
	readonly hours: number;
	readonly overtime?: number;
};
type Holiday = { readonly date: string; readonly kind: string };
/** One jurisdiction's public law plus one employee, one roster and the holidays of a month, on the law `on` that day. */
export const pack = (
	code: string,
	zone: string,
	terms: JsonObject,
	extension: JsonObject,
	days: readonly Day[],
	holidays: readonly Holiday[],
	on = '2026-02-15'
): { readonly [model: string]: readonly JsonObject[] } => {
	const rows: { [model: string]: JsonObject[] } = {};
	// ordinary hours are terms (B2): a test contract states its own, or works the ordinary week
	terms = {
		normal_hours_per_day: 8,
		normal_hours_per_week: 40,
		normal_days_per_week: 5,
		...terms
	};
	const { events, work_region, family, nationality, birth_city, passport_number, ...statutory } =
		extension;
	terms = { ...terms, ...(work_region === undefined ? {} : { work_region }) };
	const root = join(process.cwd(), 'seed/public/jurisdiction', code);
	let settings = '';
	for (const version of readdirSync(root))
		for (const file of readdirSync(join(root, version))) {
			const own = read(join(root, version, file));
			(rows[file.replace('.json', '')] ??= []).push(...own);
			for (const row of own) {
				const { from, to } = Schema.decodeUnknownSync(
					Schema.Struct({ from: Schema.String, to: Schema.NullOr(Schema.String) })
				)(file === 'jurisdiction_settings.json' ? row.effective_range : { from: '9', to: '0' });
				if (from <= on && (to === null || on <= to)) settings = String(row.id);
			}
		}
	const instant = (date: string, hours: number) =>
		new Date(Date.parse(`${date}T00:00:00.000Z`) + hours * 3_600_000).toISOString();
	const shift = (id: string, name: string, variant: JsonObject) => ({
		id,
		entity_id: ENTITY,
		code: name,
		name,
		effective_range: { from: '2025-01-01', to: null },
		variant
	});
	return {
		...rows,
		entity: [
			{
				id: ENTITY,
				code: 'E1',
				name: 'Entity',
				settings_code: code
			}
		],
		// the company's one payroll: its schedule lives on the pay group
		pay_group: [
			{
				id: PAY_GROUP,
				entity_id: ENTITY,
				name: 'Monthly',
				payment_schedule: {
					frequency: 'MONTHLY',
					business_day: 'PREVIOUS',
					non_working_weekdays: [0, 6],
					short_month: 'LAST_DAY',
					pay_cutoff_day: 1,
					pay_days: [25]
				}
			}
		],
		entity_profile_version: [
			{
				id: uuid(2),
				entity_id: ENTITY,
				name: 'Entity',
				settings_code: code,
				input_schema_version_id: settings,
				effective_range: { from: '2025-01-01', to: null },
				time_zone: zone,
				entity_extension_data: {},
				status: 'SEALED'
			}
		],
		sys_user: [{ id: uuid(3), name: 'Worker', email: 'worker@example.test', kind: 'staff' }],
		employee_profile: [{ id: uuid(4), user_id: uuid(3), name: 'Worker' }],
		employee_balance: [{ id: uuid(5), employee_id: uuid(4), account: {} }],
		employee_contract: [
			{
				id: uuid(6),
				employee_id: uuid(4),
				entity_id: ENTITY,
				pay_group_id: PAY_GROUP,
				employee_number: 'W1',
				engagement: 'EMPLOYEE',
				status: 'SEALED',
				effective_range: { from: '2025-01-01', to: null },
				terms,
				...(events === undefined ? {} : { events }),
				...(family === undefined ? {} : { family }),
				payroll: {
					date_of_birth: '1990-01-01',
					gender: 'MALE',
					marital_status: 'SINGLE',
					...(nationality === undefined ? {} : { nationality }),
					...(birth_city === undefined ? {} : { birth_city }),
					...(passport_number === undefined ? {} : { passport_number })
				},
				bank: {
					bank_name: 'Bank',
					bank_code: '001',
					bank_account_number: '1',
					bank_account_name: 'Worker'
				},
				employee_extension_data: flattenExtension(statutory),
				service_started_on: '2025-01-01'
			}
		],
		shift_definition: [
			shift(WORK, 'DAY', {
				day_type: 'WORK',
				start_time: '08:00',
				end_time: '16:00',
				ends_next_day: false,
				breaks: []
			}),
			shift(REST, 'REST', { day_type: 'REST', ends_next_day: false, breaks: [] }),
			shift(OFF, 'OFF', { day_type: 'OFF', ends_next_day: false, breaks: [] })
		],
		holiday: holidays.map((holiday, index) => ({
			id: uuid(20 + index),
			entity_id: ENTITY,
			date: holiday.date,
			name: holiday.kind,
			kind: holiday.kind,
			given_to: 'EVERYONE',
			published_at: '2025-12-01T00:00:00.000Z'
		})),
		roster_entry: days.map((day, index) => ({
			id: uuid(100 + index),
			employment_id: uuid(6),
			work_date: day.date,
			shift_definition_id: day.shift,
			actual_worked_intervals:
				day.hours === 0 ? [] : [{ start: instant(day.date, 0), end: instant(day.date, day.hours) }],
			planned_overtime_intervals:
				day.shift === WORK && day.overtime === undefined
					? null
					: day.hours === 0
						? null
						: [
								{
									start: instant(day.date, day.hours - (day.overtime ?? day.hours)),
									end: instant(day.date, day.hours)
								}
							],
			findings: []
		}))
	};
};

/** A leave request carries `days`; the model stores them as owned child slots. */
export const leaveCreate = <
	T extends { readonly days: readonly { readonly date: string; readonly part: 'AM' | 'PM' }[] }
>(
	row: T
) => {
	const { days, ...rest } = row;
	return {
		...rest,
		leave_catalog_entry_day: days.map((day) => ({
			incurred_on: PlainDate(String(day.date)),
			part: day.part
		}))
	};
};

/** The original captured slots of a leave entry: what a reversal must select. */
export const reversalSlots = (t: Kit, entry: Id<'leave_catalog_entry'>) =>
	t
		.storedQuery({
			leave_catalog_entry_day: {
				where: { leave_entry_id: { eq: entry } },
				fields: ['incurred_on', 'part'],
				limit: 100
			}
		})
		.pipe(
			Effect.map(({ leave_catalog_entry_day }) =>
				leave_catalog_entry_day.rows.map((row) => ({
					date: String(row.incurred_on),
					part: row.part
				}))
			)
		);

/** A catalog row's id on the version in force on the pack's day. */
export const catalogRow = (seed: ReturnType<typeof pack>, model: string, code: string): string => {
	const version = seed.entity_profile_version?.[0]?.input_schema_version_id;
	const row = (seed[model] ?? []).find((r) => r.code === code && r.settings_id === version);
	if (row === undefined) throw new Error(`No ${code} on ${model}`);
	return String(row.id);
};
/** The whole days as half-day slots. */
export const wholeDays = (...dates: readonly string[]) =>
	dates.flatMap((date) => [
		{ date: PlainDate(date), part: 'AM' as const },
		{ date: PlainDate(date), part: 'PM' as const }
	]);
/** One person's balance as stored, `account[family][code][period][measure]`: the first when `employee` is not named. */
export const accountsIn = (t: Kit, employee?: string) =>
	t
		.storedQuery({ employee_balance: { limit: 100 } })
		.pipe(
			Effect.map(({ employee_balance }) =>
				accountsOf(
					employee_balance.rows.find(
						(row) => employee === undefined || row.employee_id === employee
					)?.account
				)
			)
		);
/** What a code holds of a measure, across its periods. */
export const measureOf = (accounts: Accounts, family: string, code: string, measure: string) =>
	Object.values(accounts[family]?.[code] ?? {}).reduce(
		(total, measures) => total + (measures[measure] ?? 0),
		0
	);
/** Every ledger row, as stored. */
export const ledgerRows = (t: Kit) =>
	t
		.storedQuery({ ledger_entry: { limit: 10000 } })
		.pipe(Effect.map(({ ledger_entry }) => ledger_entry.rows));
const line = (key: string, value: number) =>
	Math.abs(value) < 1e-6 ? [] : [`${key} ${value.toFixed(6)}`];
/** What the ledger says every key holds, summed by hand. */
export const projection = (t: Kit) =>
	ledgerRows(t).pipe(
		Effect.map((rows) => {
			const sums = new Map<string, number>();
			for (const row of rows) {
				const key = [row.account, row.code, row.period, row.measure].join('/');
				const amount = row.amount?.toNumber() ?? 0;
				sums.set(key, (sums.get(key) ?? 0) + (row.operation === 'DEDUCT' ? -amount : amount));
			}
			return [...sums].flatMap(([key, value]) => line(key, value)).toSorted();
		})
	);
/** A balance's figures, in the lines `projection` answers. */
export const flat = (accounts: Accounts) =>
	Object.entries(accounts)
		.flatMap(([family, codes]) =>
			Object.entries(codes).flatMap(([code, periods]) =>
				Object.entries(periods).flatMap(([period, measures]) =>
					Object.entries(measures).flatMap(([measure, value]) =>
						line([family, code, period, measure].join('/'), value)
					)
				)
			)
		)
		.toSorted();
const held = <Row>(rows: readonly Row[]) => {
	const [row] = rows;
	if (row === undefined) throw new Error('No sealed entry');
	return row;
};
/** The one entry a run has sealed, for a reversal to name. */
export const sealedAdhoc = (t: Kit) =>
	t
		.storedQuery({
			adhoc_catalog_entry: { where: { payroll_run_id: { isNull: false } }, limit: 1 }
		})
		.pipe(Effect.map(({ adhoc_catalog_entry }) => held(adhoc_catalog_entry.rows).id));
/** The one entry a run has sealed, for a reversal to name. */
export const sealedLeave = (t: Kit) =>
	t
		.storedQuery({
			leave_catalog_entry: { where: { payroll_run_id: { isNull: false } }, limit: 1 }
		})
		.pipe(Effect.map(({ leave_catalog_entry }) => held(leave_catalog_entry.rows).id));
/**
 * A new contract version with these dated facts, the way HR makes one: a draft from the first of the month `on` falls in,
 * the last version ending the day before, and the seal, which triggers sync. It answers the new version's id.
 */
export const sealEvents = (t: Kit, on: string, events: readonly JsonObject[], by = t.admin) =>
	Effect.gen(function* () {
		const from = String(monthOf(on).from);
		const admin = t.as(by);
		const stored = (status: 'SEALED' | 'DRAFT') =>
			t
				.storedQuery({ employee_contract: { where: { status: { eq: status } }, limit: 100 } })
				.pipe(Effect.map(({ employee_contract }) => employee_contract.rows));
		const held = (yield* stored('SEALED')).find((row) => row.effective_range.to === null);
		if (held === undefined) throw new Error('No open contract version');
		yield* admin.act('employee_contract.create', [
			{
				employee_id: held.employee_id,
				entity_id: held.entity_id,
				engagement: held.engagement,
				employee_number: held.employee_number,
				terms: held.terms,
				payroll: held.payroll,
				bank: held.bank,
				family: held.family,
				employee_extension_data: held.employee_extension_data,
				events: events.map((event) => ({
					...event,
					kind: String(event.kind ?? ''),
					on: PlainDate(String(event.on ?? '')),
					...(event.opened_on == null ? {} : { opened_on: PlainDate(String(event.opened_on)) }),
					...(event.ended_on == null ? {} : { ended_on: PlainDate(String(event.ended_on)) })
				})),
				service_started_on: held.service_started_on,
				effective_range: { from: PlainDate(from), to: null },
				signed_contract_period: held.signed_contract_period,
				status: 'DRAFT',
				reason: 'A dated fact changed'
			}
		]);
		const [draft] = yield* stored('DRAFT');
		if (draft === undefined) throw new Error('No draft version');
		yield* admin.act('employee_contract.update', [
			{
				target: held.id,
				set: {
					effective_range: { from: held.effective_range.from, to: addDays(PlainDate(from), -1) }
				}
			}
		]);
		yield* admin.act('employee_contract.update', [{ target: draft.id, set: { status: 'SEALED' } }]);
		return draft.id;
	});
/** Runs the `ledger` automation for everyone, and whatever it schedules. */
export const syncAll = (t: Kit) =>
	t.as(t.admin).start('ledger', {}).pipe(Effect.andThen(t.runDue()));
