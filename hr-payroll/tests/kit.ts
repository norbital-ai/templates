import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
	JobResult,
	TestWorkspace,
	type Caller,
	type Kit,
	type TestOptions,
	type TestPorts
} from '@norbital-ai/bolt-cli/test';
import { Effect, Predicate, Schema } from 'effect';
import { PlainDate, add_days, month_of } from '@norbital-ai/std/date';
import { input_schema, type Kind, type Value } from '@norbital-ai/std/kind';
import { Decimal } from '@norbital-ai/std/decimal';
import type { Id, ModelName, ReadAnswer, ReadRequest, ReadRequestBase } from '@norbital-ai/bolt';
import type { EngineManifest } from '@norbital-ai/bolt/engine';
import { ActRefused } from '@norbital-ai/bolt/errors';
import { accountsOf, type Accounts } from '../src/lib/ledger/core.ts';
import { JsonObject } from '../src/lib/payroll_engine/contracts.ts';
import { isJsonObject } from '../src/lib/payroll_engine/foundation.ts';
import { idOf, type Reader } from '../src/lib/payroll_engine/reads.ts';

/** One scoped real workspace over this template's source, seeded by the rows a test writes. */
export const workspace = <P extends TestPorts = never>(
	options: Omit<
		Extract<TestOptions<P>, { artifact?: never }>,
		'root' | 'manifest' | 'guest' | 'transforms'
	> = {}
) => TestWorkspace.layer({ root: process.cwd(), ...options });

const OPTIONS = new Set([
	'where',
	'fields',
	'order_by',
	'limit',
	'search',
	'aggregate',
	'output',
	'after',
	'as_of'
]);
/**
 * The request's answer as the running manifest shapes it: each root a page of rows, each field by its kind's own codec, a
 * ref layer in place of its key (the row or `null`) and a many-layer as its rows. Only a value this schema admits takes the
 * request's static answer type.
 */
const answer = <R extends ReadRequestBase>(m: EngineManifest, request: R) => {
	const value = (kind: Kind) => Schema.NullOr(Schema.toType(input_schema(kind)));
	const instant = Schema.toType(input_schema({ kind: 'instant' }));
	const system: Record<string, Schema.Top> = {
		revision: Schema.Int,
		created_at: instant,
		updated_at: instant,
		created_by: Schema.NullOr(Schema.String),
		updated_by: Schema.NullOr(Schema.String)
	};
	const row = (model: string, node: unknown): Schema.Top => {
		const layer = Predicate.isObject(node) ? node : {};
		const named = Array.isArray(layer['fields']) ? new Set(layer['fields'].map(String)) : undefined;
		const columns: Record<string, Schema.Top> = { id: Schema.String };
		const own: [string, Schema.Top][] = [
			...Object.entries(system),
			...Object.entries(m.models[model]?.fields ?? {}).map(([name, kind]): [string, Schema.Top] => [
				name,
				value(kind)
			]),
			...Object.entries(m.relationships).flatMap(([key, spec]): [string, Schema.Top][] =>
				key.startsWith(`${model}.`) && typeof spec.to === 'string'
					? [
							[
								key.slice(model.length + 1),
								spec.optional === true ? Schema.NullOr(Schema.String) : Schema.String
							]
						]
					: []
			)
		];
		for (const [name, value] of own)
			if (named === undefined || named.has(name))
				columns[name] = named === undefined ? Schema.optionalKey(value) : value;
		for (const [relation, child] of Object.entries(layer)) {
			if (OPTIONS.has(relation)) continue;
			const ref = m.relationships[`${model}.${relation}`];
			if (typeof ref?.to === 'string') {
				columns[relation] =
					ref.optional === true ? Schema.NullOr(row(ref.to, child)) : row(ref.to, child);
				continue;
			}
			const many = Object.entries(m.relationships).find(
				([key, spec]) => spec.to === model && spec.inverse === relation && key.includes('.')
			);
			if (many === undefined) throw new Error(`${model}.${relation}: no relation`);
			columns[relation] = Schema.Array(row(many[0].slice(0, many[0].indexOf('.')), child));
		}
		return Schema.StructWithRest(Schema.Struct(columns), [
			Schema.Record(Schema.String, Schema.Unknown)
		]);
	};
	const root = (model: string, node: unknown): Schema.Top =>
		Predicate.isObject(node) && 'aggregate' in node
			? Schema.Record(Schema.String, Schema.Unknown)
			: Schema.Struct({
					rows: Schema.Array(row(model, node)),
					next: Schema.optionalKey(Schema.NullOr(Schema.String)),
					total: Schema.optionalKey(Schema.Number)
				});
	const whole = Schema.Struct(
		Object.fromEntries(Object.entries(request).map(([name, node]) => [name, root(name, node)]))
	);
	return Schema.declare<ReadAnswer<R>>((input): input is ReadAnswer<R> => Schema.is(whole)(input));
};
/** A write callback's stored read (`t.stored_query`), answered as the request's typed tree. */
export const storedQuery = <const R extends ReadRequestBase>(t: Kit, request: ReadRequest<R>) =>
	t
		.stored_query(request)
		.pipe(Effect.flatMap(Schema.decodeUnknownEffect(answer<R>(t.manifest, request))));
/** A caller's read (`caller.query`), answered as the request's typed tree. */
export const query = <const R extends ReadRequestBase>(
	t: Kit,
	caller: Caller,
	request: ReadRequest<R>
) =>
	caller
		.query(request)
		.pipe(Effect.flatMap(Schema.decodeUnknownEffect(answer<R>(t.manifest, request))));
const DecimalValue = Schema.declare((input): input is Decimal => input instanceof Decimal);
/** A decoded field value: JSON, with std's `Decimal` for decimals. */
const AnyValue: Schema.Codec<Value> = Schema.Union([
	Schema.Null,
	Schema.Boolean,
	Schema.Number,
	Schema.String,
	DecimalValue,
	Schema.Array(Schema.suspend((): Schema.Codec<Value> => AnyValue)),
	Schema.Record(
		Schema.String,
		Schema.suspend((): Schema.Codec<Value> => AnyValue)
	)
]);
const Values = Schema.Record(Schema.String, AnyValue);
const DynamicPage = Schema.Union([
	Schema.Struct({
		rows: Schema.Array(Schema.StructWithRest(Schema.Struct({ id: Schema.String }), [Values])),
		next: Schema.NullOr(Schema.String)
	}),
	Schema.Struct({
		rows: Schema.Array(
			Schema.StructWithRest(Schema.Struct({ key: Values, count: Schema.Number }), [Values])
		),
		next: Schema.NullOr(Schema.String)
	}),
	Schema.Struct({
		count: Schema.optionalKey(Schema.Number),
		sum: Schema.optionalKey(Schema.Record(Schema.String, Schema.NullOr(DecimalValue))),
		avg: Schema.optionalKey(Schema.Record(Schema.String, Schema.NullOr(DecimalValue))),
		min: Schema.optionalKey(Values),
		max: Schema.optionalKey(Values)
	})
]);
type DynamicAnswer = Effect.Success<ReturnType<Reader>>;
const DynamicAnswer = Schema.declare<DynamicAnswer>((input): input is DynamicAnswer =>
	Schema.is(Schema.Record(Schema.String, DynamicPage))(input)
);
/** `t.stored_query` as the source's `Reader` (`ctx.query(dynamic_read(…))`): what library reads take in a test. */
export const storedReader =
	(t: Kit): Reader =>
	(request) =>
		t
			.stored_query(request)
			.pipe(
				Effect.flatMap((answer) =>
					Schema.decodeUnknownEffect(DynamicAnswer)(answer).pipe(Effect.orDie)
				)
			);
/** A stored row as a write targets it: its id at its current revision. */
export const current = <C extends ModelName>(t: Kit, model: C, id: Id<C>) =>
	t.db
		.value(Schema.Int, { text: `SELECT revision FROM ${model} WHERE id = $1`, params: [id] })
		.pipe(Effect.map((revision) => ({ id, revision })));
/** The refusal a write fails with: its catalogue `key`, `values` and rendered `message`; anything else fails the test. */
export const refusal = <A, E>(write: Effect.Effect<A, E>) =>
	Effect.flip(write).pipe(
		Effect.map((error) => {
			if (!(error instanceof ActRefused)) throw new Error(`Not a refusal: ${String(error)}`);
			return error;
		})
	);

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
				employee_extension_data: statutory,
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

/** The half-day slots a leave entry holds. */
export const slotsOf = (t: Kit, entry: Id<'leave_catalog_entry'>) =>
	storedQuery(t, {
		leave_catalog_entry_day: {
			where: { leave_entry_id: { eq: entry } },
			fields: ['incurred_on', 'part'],
			limit: 100
		}
	}).pipe(
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
	storedQuery(t, { employee_balance: { limit: 100 } }).pipe(
		Effect.map(({ employee_balance }) =>
			accountsOf(
				employee_balance.rows.find((row) => employee === undefined || row.employee_id === employee)
					?.account
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
	storedQuery(t, { ledger_entry: { limit: 10000 } }).pipe(
		Effect.map(({ ledger_entry }) => ledger_entry.rows)
	);
const line = (key: string, value: number) =>
	Math.abs(value) < 1e-6 ? [] : [`${key} ${value.toFixed(6)}`];
/** What the ledger says every key holds, summed by hand. */
export const projection = (t: Kit) =>
	ledgerRows(t).pipe(
		Effect.map((rows) => {
			const sums = new Map<string, number>();
			for (const row of rows) {
				const key = [row.account, row.code, row.period, row.measure].join('/');
				const amount = row.amount?.to_number() ?? 0;
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
/** The one leave entry a run has sealed. */
export const sealedLeave = (t: Kit) =>
	storedQuery(t, {
		leave_catalog_entry: { where: { payroll_run_id: { is_null: false } }, limit: 1 }
	}).pipe(Effect.map(({ leave_catalog_entry }) => held(leave_catalog_entry.rows).id));
/**
 * A new contract version with these dated facts, the way HR makes one: a draft from the first of the month `on` falls in,
 * the last version ending the day before, and the seal, which triggers sync. It answers the new version's id.
 */
export const sealEvents = (t: Kit, on: string, events: readonly JsonObject[], by = t.admin) =>
	Effect.gen(function* () {
		const from = String(month_of(on).from);
		const admin = yield* t.as(by);
		const stored = (status: 'SEALED' | 'DRAFT') =>
			storedQuery(t, {
				employee_contract: { where: { status: { eq: status } }, limit: 100 }
			}).pipe(Effect.map(({ employee_contract }) => employee_contract.rows));
		const held = (yield* stored('SEALED')).find((row) => row.effective_range.to === null);
		if (held === undefined) throw new Error('No open contract version');
		yield* admin.act({
			'employee_contract.create': [
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
			]
		});
		const [draft] = yield* stored('DRAFT');
		if (draft === undefined) throw new Error('No draft version');
		yield* admin.act({
			'employee_contract.update': [
				{
					target: held,
					set: {
						effective_range: { from: held.effective_range.from, to: add_days(PlainDate(from), -1) }
					}
				}
			]
		});
		yield* admin.act({
			'employee_contract.update': [{ target: draft, set: { status: 'SEALED' } }]
		});
		return draft.id;
	});
/** Runs the `ledger` automation for everyone, and whatever it schedules. */
export const syncAll = (t: Kit) =>
	t.as(t.admin).pipe(
		Effect.andThen((admin) => admin.run('ledger', {}, JobResult)),
		Effect.andThen(t.run_due())
	);
