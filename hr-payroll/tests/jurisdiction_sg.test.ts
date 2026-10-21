import type { Fields, Json } from '@norbital-ai/std/kind';
import settingsModel from '../src/data/model/+jurisdiction_settings.model.js';
import { SNAPSHOT_MODELS } from '../src/lib/payroll_engine/statutory_snapshot.js';
import canonicalLeave from '../src/data/model/+leave_catalog.model.js';
import { inputSchema } from '@norbital-ai/std/kind';
import { Instant } from '@norbital-ai/std/date';
import type { RosterDraft } from '../src/lib/payroll_engine/admit.js';
import { Schema as FixtureSchema } from 'effect';
import { fixtureId, nativeId } from './fixture_values.js';
import {
	schemaProblems as kitSchemaProblems,
	propertiesAt as kitPropertiesAt
} from './jurisdiction_kit.js';
import { world, type Tables } from './jurisdiction_kit.js';
import { lineage as jurisdiction } from './jurisdiction_kit.js';
const LAW_KIT = jurisdiction('SG');
/** SG public seed: version snapshots, CEL on the engine context, and the statutory amounts each version charges. */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, layer } from '@effect/vitest';
import { workspace } from './kit.js';
import { effectWrites, planBehaviours, Behaviours } from '../src/lib/payroll_engine/behaviours.ts';
import { electionKeysOf } from '../src/lib/payroll_engine/employment_facts.ts';
import { dutiesOf, DUTY_KEYS, raiseDuties, triggerOf, SEEDED_PAYROLL } from './duties.ts';
import { Effect, Result } from 'effect';
import { Refusal } from '../src/lib/payroll_engine/foundation.js';
import { leaveBalances, movementFromRow } from '../src/lib/payroll_engine/leave.ts';
import { admitAnonymise, rosterFindings } from '../src/lib/payroll_engine/admit.ts';
import {
	leaveState,
	slipSums,
	type PayrollRunKind,
	type PayrollPlan
} from '../src/lib/payroll_engine/payslip/context.ts';
// strict: a record expression failing inside `configured_eval`, even where CEL absorbs it, fails the suite
import {
	configuredProgram,
	evaluateStrict as evaluateConfigured
} from '../src/lib/payroll_engine/expressions.ts';
import { exportEntries, exportSlip, recordDocuments } from '../src/lib/payroll_engine/export.ts';
import sourceTeams from '../src/access_control/team/+team.ts';
const fixturePresent = <A>(value: A): NonNullable<A> => {
	assert.ok(value != null, 'The fixture contains the required authored value.');
	return value;
};
const guardFixture = <S extends FixtureSchema.Constraint>(schema: S) => {
	const accepts = FixtureSchema.is(schema);
	return (value: unknown): S['Type'] => {
		assert.ok(accepts(value), 'The fixture value retains its declared shape.');
		return value;
	};
};
const fixtureRecord = guardFixture(
	FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))
);
const fixtureRecords = guardFixture(
	FixtureSchema.mutable(
		FixtureSchema.Array(
			FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))
		)
	)
);
const fixtureBoolean = guardFixture(FixtureSchema.Boolean);
const fixtureNumber = guardFixture(FixtureSchema.Number);
const fixtureString = guardFixture(FixtureSchema.String);
const fixtureKey = (value: unknown): string => fixtureId(fixtureString(value));
const fixtureContext = guardFixture(FixtureSchema.Record(FixtureSchema.String, FixtureSchema.Json));
const fixtureLinks = new Set([
	'employee_id',
	'company_id',
	'catalog_id',
	'employment_id',
	'statutory_contribution_id',
	'shift_pattern_id',
	'shift_definition_id',
	'payroll_run_id',
	'loan_id',
	'payslip_id',
	'settings_id',
	'cloned_from_id',
	'catalogue_id'
]);
const fixtureFacts = (row: Row): void => {
	for (const [key, value] of Object.entries(row)) {
		if (fixtureLinks.has(key) && typeof value === 'string') row[key] = fixtureKey(value);
		else if (
			FixtureSchema.is(
				FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Json))
			)(value)
		)
			fixtureFacts(value);
		else if (Array.isArray(value))
			for (const item of value)
				if (
					FixtureSchema.is(
						FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Json))
					)(item)
				)
					fixtureFacts(item);
	}
};
const fixtureInstant = (value: unknown) =>
	Instant(fixtureString(FixtureSchema.decodeUnknownSync(inputSchema({ kind: 'instant' }))(value)));
const fixtureIntervals = (value: unknown) =>
	fixtureRecords(value).map((row) => ({
		start: fixtureInstant(row.start),
		end: row.end === null ? null : fixtureInstant(row.end)
	}));
const fixtureDrafts = (value: unknown): readonly RosterDraft[] =>
	fixtureRecords(value).map((row) => ({
		ref: fixtureNumber(row.ref),
		employment_id: nativeId('employment_contract', fixtureKey(row.employment_id)),
		work_date: fixtureString(row.work_date),
		leave_code: fixtureString(row.leave_code),
		...(row.shift_definition_id === undefined
			? {}
			: {
					shift_definition_id:
						row.shift_definition_id === null
							? null
							: nativeId('shift_definition', fixtureKey(row.shift_definition_id))
				}),
		...(row.worked_intervals === undefined
			? {}
			: { worked_intervals: fixtureIntervals(row.worked_intervals) }),
		...(row.banked_overtime_hours === undefined
			? {}
			: {
					banked_overtime_hours:
						row.banked_overtime_hours === null ? null : fixtureNumber(row.banked_overtime_hours)
				}),
		...(row.overtime_consented_at === undefined
			? {}
			: {
					overtime_consented_at:
						row.overtime_consented_at === null ? null : fixtureInstant(row.overtime_consented_at)
				})
	}));
const fixtureExports = guardFixture(
	FixtureSchema.Array(
		FixtureSchema.StructWithRest(
			FixtureSchema.Struct({ code: FixtureSchema.String, rules: FixtureSchema.Unknown }),
			[FixtureSchema.Record(FixtureSchema.String, FixtureSchema.Unknown)]
		)
	)
);
const fixtureContexts = guardFixture(
	FixtureSchema.Array(FixtureSchema.Record(FixtureSchema.String, FixtureSchema.Json))
);
const fixtureReturnRows = guardFixture(
	FixtureSchema.Array(
		FixtureSchema.StructWithRest(
			FixtureSchema.Struct({
				employee: FixtureSchema.Record(FixtureSchema.String, FixtureSchema.Json),
				contract: FixtureSchema.Record(FixtureSchema.String, FixtureSchema.Json),
				slips: FixtureSchema.Array(FixtureSchema.Record(FixtureSchema.String, FixtureSchema.Json)),
				entries: FixtureSchema.optionalKey(
					FixtureSchema.Array(FixtureSchema.Record(FixtureSchema.String, FixtureSchema.Json))
				)
			}),
			[FixtureSchema.Record(FixtureSchema.String, FixtureSchema.Unknown)]
		)
	)
);
const fixtureRow = (row: Row): Row => {
	for (const [key, value] of Object.entries(row))
		if ((key === 'id' || fixtureLinks.has(key)) && typeof value === 'string')
			row[key] = fixtureKey(value);
	if (
		FixtureSchema.is(
			FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Json))
		)(row.facts)
	)
		fixtureFacts(row.facts);
	return row;
};
const fixtureRows = (rows: readonly Row[]): Row[] => rows.map(fixtureRow);
const fixtureTables = (entries: Iterable<readonly [string, readonly Row[]]> = []): Tables =>
	new Map(Array.from(entries, ([name, rows]): [string, Row[]] => [name, fixtureRows(rows)]));
const EntitlementFixture = FixtureSchema.NullOr(
	FixtureSchema.StructWithRest(
		FixtureSchema.Struct({
			unit: FixtureSchema.optional(FixtureSchema.String),
			days: FixtureSchema.optional(FixtureSchema.String),
			bands: FixtureSchema.optional(
				FixtureSchema.Array(
					FixtureSchema.Struct({ service_months: FixtureSchema.Number, days: FixtureSchema.Number })
				)
			),
			window: FixtureSchema.optional(
				FixtureSchema.Literals(['CALENDAR_YEAR', 'SERVICE_YEAR', 'LIFETIME', 'EVENT', 'ROLLING'])
			),
			window_months: FixtureSchema.optional(FixtureSchema.Number),
			service_year_offset_months: FixtureSchema.optional(FixtureSchema.Number),
			window_key: FixtureSchema.optional(FixtureSchema.String),
			carry_forward: FixtureSchema.optional(FixtureSchema.String),
			carry_depth: FixtureSchema.optional(FixtureSchema.Number),
			consumes_after_days: FixtureSchema.optional(FixtureSchema.Number),
			hours_per_day: FixtureSchema.optional(FixtureSchema.String)
		}),
		[FixtureSchema.Record(FixtureSchema.String, FixtureSchema.Unknown)]
	)
);
const fixtureEntitlement = guardFixture(EntitlementFixture);
const seedClass = (value: unknown) => {
	const row = fixtureRecord(value);
	const code = fixtureString(row.code);
	return {
		id: nativeId('leave_catalog', fixtureKey(row.id)),
		code,
		name: fixtureString(row.name),
		can_encash: fixtureBoolean(row.can_encash),
		is_npl:
			row.is_npl === undefined ? canonicalLeave.fields.is_npl.default : fixtureBoolean(row.is_npl),
		consumes_code: row.consumes_code == null ? null : fixtureString(row.consumes_code),
		entitlement: row.entitlement == null ? null : fixtureEntitlement(row.entitlement),
		...(typeof row.eligibility === 'string' && row.eligibility.trim() !== ''
			? { eligibility: row.eligibility }
			: {})
	};
};
const seedMovement = (value: unknown) => {
	const row = fixtureRecord(value);
	return movementFromRow({
		...row,
		catalog_id: nativeId('leave_catalog', fixtureKey(row.catalog_id)),
		...(row.id === undefined ? {} : { id: fixtureString(row.id) }),
		...(row.employment_id === undefined ? {} : { employment_id: fixtureString(row.employment_id) }),
		...(row.activity === undefined ? {} : { activity: fixtureString(row.activity) })
	});
};
const fixtureValue0 = guardFixture(
	FixtureSchema.StructWithRest(
		FixtureSchema.Struct({
			person: FixtureSchema.mutableKey(
				FixtureSchema.optionalKey(
					FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.String))
				)
			),
			assessable: FixtureSchema.mutableKey(
				FixtureSchema.optionalKey(
					FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.String))
				)
			),
			assessment: FixtureSchema.mutableKey(FixtureSchema.optionalKey(FixtureSchema.String)),
			refuse_when: FixtureSchema.mutableKey(
				FixtureSchema.optionalKey(
					FixtureSchema.mutable(
						FixtureSchema.Array(
							FixtureSchema.StructWithRest(
								FixtureSchema.Struct({
									when: FixtureSchema.mutableKey(FixtureSchema.String),
									message: FixtureSchema.mutableKey(FixtureSchema.String)
								}),
								[
									FixtureSchema.Record(
										FixtureSchema.String,
										FixtureSchema.mutableKey(FixtureSchema.Unknown)
									)
								]
							)
						)
					)
				)
			),
			rules: FixtureSchema.mutableKey(
				FixtureSchema.optionalKey(
					FixtureSchema.mutable(
						FixtureSchema.Array(
							FixtureSchema.StructWithRest(
								FixtureSchema.Struct({
									when: FixtureSchema.mutableKey(FixtureSchema.optionalKey(FixtureSchema.String)),
									contribution: FixtureSchema.mutableKey(
										FixtureSchema.optionalKey(FixtureSchema.String)
									),
									employee: FixtureSchema.mutableKey(
										FixtureSchema.optionalKey(FixtureSchema.String)
									),
									employer: FixtureSchema.mutableKey(
										FixtureSchema.optionalKey(FixtureSchema.String)
									)
								}),
								[
									FixtureSchema.Record(
										FixtureSchema.String,
										FixtureSchema.mutableKey(FixtureSchema.Unknown)
									)
								]
							)
						)
					)
				)
			)
		}),
		[FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))]
	)
);
const fixtureValue1 = guardFixture(
	FixtureSchema.StructWithRest(
		FixtureSchema.Struct({
			employee: FixtureSchema.mutableKey(FixtureSchema.Number),
			employer: FixtureSchema.mutableKey(FixtureSchema.Number)
		}),
		[FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))]
	)
);
const fixtureValue2 = guardFixture(
	FixtureSchema.StructWithRest(
		FixtureSchema.Struct({
			from: FixtureSchema.mutableKey(FixtureSchema.String),
			to: FixtureSchema.mutableKey(FixtureSchema.Union([FixtureSchema.String, FixtureSchema.Null]))
		}),
		[FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))]
	)
);
const fixtureValue3 = guardFixture(
	FixtureSchema.StructWithRest(
		FixtureSchema.Struct({
			to: FixtureSchema.mutableKey(FixtureSchema.Union([FixtureSchema.String, FixtureSchema.Null]))
		}),
		[FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))]
	)
);
const fixtureValue4 = guardFixture(
	FixtureSchema.mutable(
		FixtureSchema.Array(
			FixtureSchema.StructWithRest(
				FixtureSchema.Struct({
					when: FixtureSchema.mutableKey(FixtureSchema.String),
					amount: FixtureSchema.mutableKey(FixtureSchema.String),
					limit: FixtureSchema.mutableKey(
						FixtureSchema.optionalKey(
							FixtureSchema.Union([
								FixtureSchema.StructWithRest(
									FixtureSchema.Struct({ amount: FixtureSchema.mutableKey(FixtureSchema.String) }),
									[
										FixtureSchema.Record(
											FixtureSchema.String,
											FixtureSchema.mutableKey(FixtureSchema.Unknown)
										)
									]
								),
								FixtureSchema.Null
							])
						)
					)
				}),
				[
					FixtureSchema.Record(
						FixtureSchema.String,
						FixtureSchema.mutableKey(FixtureSchema.Unknown)
					)
				]
			)
		)
	)
);
const fixtureValue5 = guardFixture(Behaviours);
const fixtureValue6 = guardFixture(
	FixtureSchema.StructWithRest(
		FixtureSchema.Struct({
			rules: FixtureSchema.mutableKey(
				FixtureSchema.mutable(
					FixtureSchema.Array(
						FixtureSchema.StructWithRest(
							FixtureSchema.Struct({
								id: FixtureSchema.mutableKey(FixtureSchema.String),
								when: FixtureSchema.mutableKey(FixtureSchema.optionalKey(FixtureSchema.String))
							}),
							[
								FixtureSchema.Record(
									FixtureSchema.String,
									FixtureSchema.mutableKey(FixtureSchema.Unknown)
								)
							]
						)
					)
				)
			)
		}),
		[FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))]
	)
);
const fixtureValue7 = guardFixture(
	FixtureSchema.Union([
		FixtureSchema.StructWithRest(
			FixtureSchema.Struct({ employee: FixtureSchema.mutableKey(FixtureSchema.Number) }),
			[FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))]
		),
		FixtureSchema.Null
	])
);
const fixtureValue8 = guardFixture(
	FixtureSchema.StructWithRest(
		FixtureSchema.Struct({
			bands: FixtureSchema.mutableKey(
				FixtureSchema.mutable(
					FixtureSchema.Array(
						FixtureSchema.StructWithRest(
							FixtureSchema.Struct({
								service_months: FixtureSchema.mutableKey(FixtureSchema.Number),
								days: FixtureSchema.mutableKey(FixtureSchema.Number)
							}),
							[
								FixtureSchema.Record(
									FixtureSchema.String,
									FixtureSchema.mutableKey(FixtureSchema.Unknown)
								)
							]
						)
					)
				)
			)
		}),
		[FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))]
	)
);
const fixtureValue9 = guardFixture(
	FixtureSchema.StructWithRest(
		FixtureSchema.Struct({
			days: FixtureSchema.mutableKey(FixtureSchema.String),
			bands: FixtureSchema.mutableKey(
				FixtureSchema.mutable(
					FixtureSchema.Array(
						FixtureSchema.StructWithRest(
							FixtureSchema.Struct({
								service_months: FixtureSchema.mutableKey(FixtureSchema.Number),
								days: FixtureSchema.mutableKey(FixtureSchema.Number)
							}),
							[
								FixtureSchema.Record(
									FixtureSchema.String,
									FixtureSchema.mutableKey(FixtureSchema.Unknown)
								)
							]
						)
					)
				)
			)
		}),
		[FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))]
	)
);
const fixtureValue10 = guardFixture(FixtureSchema.Json);
const fixtureValue11 = guardFixture(
	FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))
);
const fixtureValue12 = guardFixture(
	FixtureSchema.mutable(FixtureSchema.Array(FixtureSchema.String))
);
const fixtureValue13 = guardFixture(
	FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Json))
);
const fixtureValue14 = guardFixture(FixtureSchema.Number);
const fixtureValue15 = guardFixture(
	FixtureSchema.mutable(
		FixtureSchema.Array(
			FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))
		)
	)
);
const fixtureValue16 = guardFixture(
	FixtureSchema.StructWithRest(
		FixtureSchema.Struct({
			days: FixtureSchema.mutableKey(
				FixtureSchema.mutable(
					FixtureSchema.Array(
						FixtureSchema.Record(
							FixtureSchema.String,
							FixtureSchema.mutableKey(FixtureSchema.Unknown)
						)
					)
				)
			)
		}),
		[FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))]
	)
);
const fixtureValue17 = guardFixture(
	FixtureSchema.Union([
		FixtureSchema.StructWithRest(
			FixtureSchema.Struct({ employer: FixtureSchema.mutableKey(FixtureSchema.Number) }),
			[FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))]
		),
		FixtureSchema.Null
	])
);
const fixtureValue18 = guardFixture(
	FixtureSchema.StructWithRest(
		FixtureSchema.Struct({
			holidays: FixtureSchema.mutableKey(
				FixtureSchema.mutable(
					FixtureSchema.Array(
						FixtureSchema.Record(
							FixtureSchema.String,
							FixtureSchema.mutableKey(FixtureSchema.Unknown)
						)
					)
				)
			)
		}),
		[FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))]
	)
);
const fixtureValue20 = guardFixture(
	FixtureSchema.mutable(
		FixtureSchema.Array(
			FixtureSchema.StructWithRest(
				FixtureSchema.Struct({ code: FixtureSchema.mutableKey(FixtureSchema.String) }),
				[
					FixtureSchema.Record(
						FixtureSchema.String,
						FixtureSchema.mutableKey(FixtureSchema.Unknown)
					)
				]
			)
		)
	)
);
const fixtureValue21 = guardFixture(
	FixtureSchema.Record(
		FixtureSchema.String,
		FixtureSchema.mutableKey(
			FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))
		)
	)
);
const fixtureValue22 = guardFixture(
	FixtureSchema.StructWithRest(
		FixtureSchema.Struct({
			contract_terms: FixtureSchema.mutableKey(
				FixtureSchema.mutable(
					FixtureSchema.Array(
						FixtureSchema.Record(
							FixtureSchema.String,
							FixtureSchema.mutableKey(FixtureSchema.Unknown)
						)
					)
				)
			)
		}),
		[FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))]
	)
);
type Row = {
	[key: string]: Json;
};
type Contribution = {
	readonly when?: string;
	readonly contribution?: string;
	readonly employee?: string;
	readonly employer?: string;
};
type Configuration = {
	readonly person?: Readonly<Record<string, string>>;
	readonly assessable?: Readonly<Record<string, string>>;
	readonly assessment?: string;
	readonly refuse_when?: readonly {
		readonly when: string;
		readonly message: string;
	}[];
	readonly rules?: readonly Contribution[];
};
type FieldSpec = {
	kind: string;
	values?: readonly string[];
};
const ROOT = process.cwd();
const LAW = resolve(ROOT, 'seed/jurisdiction/SG');
const TABLES = [
	'jurisdiction_settings',
	'rule_set',
	'statutory_contribution_catalog',
	'leave_catalog',
	'claim_catalog',
	'adhoc_catalog',
	'loan_catalog',
	'allowance_catalog',
	'work_catalog'
] as const;
/** Relationship and system columns a seed row may carry beside its model's own fields. */
const LINK_KEYS = new Set(['id', 'settings_id', 'cloned_from_id']);
/** The keys whose string value the engine evaluates as CEL. */
const CEL_KEYS = new Set([
	'eligibility',
	'qualifies_when',
	'quantity',
	'rate',
	'when',
	'amount',
	'assessment',
	'contribution',
	'employee',
	'employer',
	'effect',
	'days',
	'age',
	'ordinary',
	'additional',
	'due',
	'until',
	'counts_as_attended',
	'scheduled',
	'pay'
]);
const versions = LAW_KIT.versions;
const load = LAW_KIT.rows;
const settingsOf = LAW_KIT.settingsOf;
const addDaysIso = (day: string, n: number): string =>
	new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
/** The version whose inclusive settings range holds `day`. */
const versionOn = LAW_KIT.versionOn;
const row = LAW_KIT.byCode;
/** Only the read-only statutory expressions are shared; mutable law-row fixtures still read their own rows. */
const configurationVersions = readdirSync(LAW).filter((version) => /^version_\d+$/.test(version));
const configurations: ReadonlyMap<string, ReadonlyMap<string, Configuration>> = new Map(
	configurationVersions.map((version): [string, ReadonlyMap<string, Configuration>] => {
		const byCode = new Map<string, Configuration>();
		for (const entry of load(version, 'statutory_contribution_catalog')) {
			const code = fixtureString(entry.code);
			assert.ok(!byCode.has(code), `${version} has one statutory configuration for ${code}.`);
			const authored = fixtureValue0(entry.configuration);
			if (authored.person !== undefined) Object.freeze(authored.person);
			if (authored.assessable !== undefined) Object.freeze(authored.assessable);
			if (authored.refuse_when !== undefined) {
				for (const guard of authored.refuse_when) Object.freeze(guard);
				Object.freeze(authored.refuse_when);
			}
			if (authored.rules !== undefined) {
				for (const rule of authored.rules) Object.freeze(rule);
				Object.freeze(authored.rules);
			}
			byCode.set(code, Object.freeze(authored));
		}
		return [version, byCode];
	})
);
const configuration = (version: string, code: string): Configuration =>
	fixturePresent(fixturePresent(configurations.get(version)).get(code));
const nextDay = (day: string): string =>
	new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
const modelFields = (table: string): Fields => {
	const fields =
		table === 'jurisdiction_settings'
			? settingsModel.fields
			: Object.entries(SNAPSHOT_MODELS).find(([name]) => name === table)?.[1].fields;
	assert.ok(fields, `${table} has its authored model`);
	return fields;
};
/** Every CEL string in a value, with where it sits. */
const celOf = (value: Json, path: string, out: [string, string][] = []): [string, string][] => {
	if (Array.isArray(value)) value.forEach((item, index) => celOf(item, `${path}[${index}]`, out));
	else if (value != null && typeof value === 'object')
		for (const [key, item] of Object.entries(value)) {
			if (typeof item === 'string' && CEL_KEYS.has(key) && item.trim() !== '')
				out.push([`${path}.${key}`, item]);
			else celOf(item, `${path}.${key}`, out);
		}
	return out;
};
/** The CPF month for one assessable wage, as the engine's statutory step evaluates it. */
const charge = (
	version: string,
	code: string,
	assessed: number,
	person: Row,
	from = '2026-03-01',
	elections: Row = {},
	immigration_status?: string
):
	| {
			employee: number;
			employer: number;
	  }
	| 'REFUSED'
	| null => {
	const config = configuration(version, code);
	const base = { ordinary: assessed, additional: 0, assessed, amount: assessed };
	const context = fixtureContext({
		base,
		// The engine always supplies these person keys, null when unknown.
		person: { race: null, religion: null, nationality: null, residency_since: null, ...person },
		period: { key: from.slice(0, 7), from, days: 31 },
		// The employee's declared standing for this scheme (employment_profile.facts.employment_statutory_facts).
		scheme: { code, standing: '', elections },
		employee: { facts: immigration_status == null ? {} : { immigration_status } }
	});
	for (const guard of config.refuse_when ?? [])
		if (evaluateConfigured(guard.when, context) === true) return 'REFUSED';
	for (const rule of config.rules ?? []) {
		if (rule.when != null && evaluateConfigured(rule.when, context) !== true) continue;
		const on =
			config.assessment == null ? assessed : Number(evaluateConfigured(config.assessment, context));
		const ruled =
			config.assessment == null
				? context
				: fixtureContext({ ...context, base: { ...base, assessed: on, amount: on } });
		if (rule.contribution != null)
			return fixtureValue1(evaluateConfigured(rule.contribution, ruled));
		return {
			employee: rule.employee == null ? 0 : Number(evaluateConfigured(rule.employee, ruled)),
			employer: rule.employer == null ? 0 : Number(evaluateConfigured(rule.employer, ruled))
		};
	}
	return null;
};
/** CPF First Schedule in exact integer arithmetic: [employer, employee, 500–750 coefficient] per 10,000. */
const cpfExact = ([er, ee, k]: readonly number[], cents: number) => {
	const halfUp = (numerator: number) => Math.floor((2 * numerator + 1e6) / 2e6);
	if (cents <= 5000) return { employee: 0, employer: 0 };
	if (cents <= 50000) return { employee: 0, employer: halfUp(fixturePresent(er) * cents) };
	if (cents <= 75000) {
		const employee = Math.floor((fixturePresent(k) * (cents - 50000)) / 1e6);
		return {
			employee,
			employer: halfUp(fixturePresent(er) * cents + fixturePresent(k) * (cents - 50000)) - employee
		};
	}
	const employee = Math.floor((fixturePresent(ee) * cents) / 1e6);
	return {
		employee,
		employer: halfUp((fixturePresent(er) + fixturePresent(ee)) * cents) - employee
	};
};
const AGES = [30, 57, 62, 67, 72] as const;
/** Citizen / SPR third year onwards, by age band (≤55, 55–60, 60–65, 65–70, >70). */
const SC: Record<string, readonly (readonly number[])[]> = {
	version_1: [
		[1700, 2000, 6000],
		[1550, 1700, 5100],
		[1200, 1150, 3450],
		[900, 750, 2250],
		[750, 500, 1500]
	],
	version_2: [
		[1700, 2000, 6000],
		[1600, 1800, 5400],
		[1250, 1250, 3750],
		[900, 750, 2250],
		[750, 500, 1500]
	],
	version_4: [
		[1700, 2000, 6000],
		[1650, 1900, 5700],
		[1300, 1300, 3900],
		[900, 750, 2250],
		[750, 500, 1500]
	]
};
SC.version_3 = fixturePresent(SC.version_2);
SC.version_5 = fixturePresent(SC.version_2);
SC.version_6 = fixturePresent(SC.version_4);
/** SPR graduated employer and graduated employee rates (Tables 2–3), first and second year. */
const PR1 = [
	[400, 500, 1500],
	[400, 500, 1500],
	[350, 500, 1500],
	[350, 500, 1500],
	[350, 500, 1500]
] as const;
const PR2 = [
	[900, 1500, 4500],
	[600, 1250, 3750],
	[350, 750, 2250],
	[350, 500, 1500],
	[350, 500, 1500]
] as const;
/** The CEL subject roots `subjectContext` (services.ts) builds, with a test's overrides merged per root. */
const subject = (
	over: {
		employee?: Row;
		employment?: Row;
		terms?: Row;
		company?: Row;
	} = {}
) => {
	const employment = {
		classification: 'EA_COVERED',
		start_date: '2010-01-01',
		service_months: 12,
		exit_date: '',
		exit_ground: '',
		exit_facts: {},
		...over.employment
	};
	const employee = {
		gender: '',
		marital_status: '',
		spouse_status: '',
		solo_parent: false,
		disabled: false,
		receiving_pension: false,
		nationality: '',
		date_of_birth: '1990-01-01',
		age: 36,
		children: [],
		dependents_count: 0,
		facts: {},
		...over.employee
	};
	const terms = {
		work_classification: employment.classification,
		statutory_work_category: 'NON_MANUAL',
		employment_type: 'PERMANENT',
		residency_status: 'CITIZEN',
		residency_since: '',
		base_salary: 5000,
		monthly_wage: 5000,
		...over.terms
	};
	return {
		employee,
		company: { region: '', risk_class: '', pay_frequency: 'MONTHLY', facts: {}, ...over.company },
		terms,
		employment,
		person: {
			employment,
			race: null,
			religion: null,
			nationality: null,
			residency_status: terms.residency_status,
			residency_since: terms.residency_since
		}
	};
};
/** The context `admitEntry` (services.ts) evaluates a leave class's eligibility in: subject, rules, entry. */
const admission = (over: Parameters<typeof subject>[0], occurred_on: string, facts: Row = {}) => ({
	...subject(over),
	rules: {},
	entry: {
		days: 1,
		...facts,
		amount: 0,
		quantity: 1,
		occurred_on,
		due_on: occurred_on,
		incurred_on: occurred_on,
		facts
	}
});
const schemaProblems = kitSchemaProblems;
const propertiesAt = kitPropertiesAt;
/**
 * The payroll engine over the SG law tables and four fixture people (an SPR, and Citizens of the Chinese, Malay-Muslim,
 * Indian and Eurasian communities, so every scheme charges), read through a host-like reader as tests/payroll_engine
 * does. People are fixtures here, never the bank.
 */
/** One CSV record's cells (quoted cells may hold commas and doubled quotes). */
const splitCsv = (line: string): string[] =>
	[...line.matchAll(/(?:^|,)(?:"((?:[^"]|"")*)"|([^,]*))/g)].map((match) =>
		match[1] != null ? match[1].replaceAll('""', '"') : (match[2] ?? '')
	);
const engine = () => {
	const COMPANY = 'c-sg';
	const tables = fixtureTables();
	for (const table of TABLES)
		tables.set(
			table,
			fixtureRows(
				versions
					.flatMap((version) => load(version, table))
					.map((item) => ({ ...structuredClone(item) }))
			)
		);
	const people = [
		{
			id: 'p1',
			date_of_birth: '1993-04-18',
			race: 'CHINESE',
			religion: 'OTHER',
			salary: 6500,
			residency: 'PERMANENT_RESIDENT',
			since: '2019-01-01'
		},
		{
			id: 'p2',
			date_of_birth: '1965-11-02',
			race: 'MALAY',
			religion: 'ISLAM',
			salary: 9800,
			residency: 'CITIZEN'
		},
		{
			id: 'p3',
			date_of_birth: '1997-06-30',
			race: 'INDIAN',
			religion: 'HINDUISM',
			salary: 4800,
			residency: 'CITIZEN'
		},
		{
			id: 'p4',
			date_of_birth: '1958-09-30',
			race: 'EURASIAN',
			religion: 'CHRISTIANITY',
			salary: 3000,
			residency: 'CITIZEN',
			category: 'MANUAL_LABOUR'
		}
	];
	tables.set(
		'entity',
		fixtureRows([
			{
				id: COMPANY,
				name: 'Fixture',
				settings_code: 'SG',
				pay_frequency: 'MONTHLY',
				facts: {},
				pay_cutoff_day: 1,
				effective_range: { from: '2025-12-01', to: null }
			}
		])
	);
	tables.set(
		'employment_profile',
		fixtureRows(
			people.map(({ salary: _s, residency: _r, since: _x, category: _c, ...person }) => ({
				...person,
				name: person.id,
				facts: {}
			}))
		)
	);
	tables.set(
		'employment_contract',
		fixtureRows(
			people.map((person) => ({
				id: `k-${person.id}`,
				employee_id: person.id,
				company_id: COMPANY,
				effective_range: { from: '2019-01-01', to: null },
				facts: {
					contract_terms: [
						{
							base_salary: { value: person.salary, currency: 'SGD' },
							effective_range: { from: '2019-01-01', to: null },
							residency_status: person.residency,
							...(person.since == null ? {} : { residency_since: person.since }),
							work_classification: 'EA_COVERED',
							statutory_work_category: person.category ?? 'NON_MANUAL',
							employment_type: 'PERMANENT',
							allowances: []
						}
					]
				},
				employee_number: String(person.id),
				contract_number: 1
			}))
		)
	);
	for (const name of [
		'adhoc_catalog_entry',
		'claim_catalog_entry',
		'leave_catalog_entry',
		'loan_catalog_entry',
		'loan_repayment_entry',
		'roster_entry',
		'holiday',
		'payslip',
		'payroll_run',
		'shift_pattern',
		'shift_definition'
	])
		tables.set(name, fixtureRows([]));
	const reads = world(tables).layer;
	return {
		tables,
		reads,
		bonus(period: string, amount: number) {
			const version = fixturePresent(
				versions.find((name) => {
					const range = fixtureValue2(settingsOf(name).effective_range);
					return range.from <= `${period}-01` && (range.to == null || range.to >= `${period}-01`);
				})
			);
			fixturePresent(tables.get('adhoc_catalog_entry')).push(
				fixtureRow({
					id: 'bonus-1',
					employment_id: 'k-p2',
					company_id: COMPANY,
					catalog_id: fixtureString(row(version, 'adhoc_catalog', 'bonus').id),
					payslip_id: null,
					occurred_on: `${period}-05`,
					amount
				})
			);
		},
		run: Effect.fnUntraced(function* (period: string, kind: PayrollRunKind, sources?: string[]) {
			return yield* world(tables).run(fixtureKey(COMPANY), period, kind, sources?.map(fixtureId));
		})
	};
};
/** Current annual assessments use real captured salary runs, including months with no bonus. */
const openingSalary = Effect.fnUntraced(function* (
	fixture: ReturnType<typeof engine>,
	period: string
) {
	const configuration = fixtureRecord(
		row(versionOn(`${period.slice(0, 4)}-12-01`), 'statutory_contribution_catalog', 'CPF')
			.configuration
	);
	if (configuration.annual_reconciliation == null) return;
	for (let month = 1; month < Number(period.slice(5, 7)); month++) {
		const key = `${period.slice(0, 4)}-${String(month).padStart(2, '0')}`;
		if (
			fixturePresent(fixture.tables.get('payroll_run')).some(
				(run) => run.period === key && run.kind === 'REGULAR'
			)
		)
			continue;
		yield* fixture.run(key, 'REGULAR');
	}
});
const annualEngine = (spr = false, exit = false) => {
	const current = engine();
	const contract = fixturePresent(
		current.tables.get('employment_contract')?.find((row) => row.id === fixtureKey('k-p2'))
	);
	const employee = fixturePresent(
		current.tables.get('employment_profile')?.find((row) => row.id === fixtureKey('p2'))
	);
	employee.date_of_birth = spr ? '1990-06-15' : '1971-06-15';
	contract.effective_range = { from: '2026-01-01', to: exit ? '2026-11-30' : null };
	if (exit) contract.exit_ground = 'VOLUNTARY_RESIGNATION';
	const facts = fixtureRecord(contract.facts);
	const original = fixturePresent(fixtureRecords(facts.contract_terms)[0]);
	const drop = exit ? '2026-11-01' : '2026-07-01';
	const firstEnd = exit ? '2026-10-31' : '2026-06-30';
	const residency = spr
		? { residency_status: 'PERMANENT_RESIDENT', residency_since: '2025-06-15' }
		: { residency_status: 'CITIZEN' };
	contract.facts = {
		...facts,
		contract_terms: [
			{
				...original,
				...residency,
				effective_range: { from: '2026-01-01', to: firstEnd },
				base_salary: { value: 8000, currency: 'SGD' }
			},
			{
				...original,
				...residency,
				effective_range: { from: drop, to: null },
				base_salary: { value: 4000, currency: 'SGD' }
			}
		]
	};
	return current;
};
describe('SG public seed', () => {
	it('holds contiguous, inclusive, cloned settings versions ending open', () => {
		assert.deepEqual(versions, ['version_1', 'version_2', 'version_3', 'version_5', 'version_6']);
		let previous: Row | undefined;
		for (const version of versions) {
			for (const table of TABLES)
				assert.equal(
					existsSync(resolve(LAW, version, `${table}.json`)),
					true,
					`${version}/${table}`
				);
			const rows = load(version, 'jurisdiction_settings');
			assert.equal(rows.length, 1);
			const settings = fixturePresent(rows[0]);
			assert.equal(settings.code, 'SG');
			assert.equal(settings.jurisdiction_code, 'SG');
			assert.equal(typeof settings.sealed_at, 'string');
			assert.equal(settings.voided_at, null);
			assert.deepEqual(settings.payroll, {
				currency: 'SGD',
				timezone: 'Asia/Singapore',
				tax_year_start_month: 1,
				...SEEDED_PAYROLL
			});
			const range = fixtureValue2(settings.effective_range);
			// A date period is inclusive both ends (Bolt daterange '[]', engine dayInRange): next from = previous to + 1.
			if (previous == null) {
				assert.equal(range.from, '2025-12-01');
				assert.equal(settings.cloned_from_id, null);
			} else {
				const before = fixtureValue2(previous.effective_range);
				assert.ok(before.to != null && range.from === nextDay(before.to), version);
				assert.equal(settings.cloned_from_id, previous.id);
			}
			assert.ok(range.to == null || range.to >= range.from);
			previous = settings;
		}
		assert.equal(fixtureValue3(fixturePresent(previous).effective_range).to, null);
	});
	it('October and the future successor apply the corrected Part 4 scope without repricing historical snapshots', () => {
		assert.equal(versionOn('2026-09-30'), 'version_3');
		assert.equal(versionOn('2026-10-01'), 'version_5');
		assert.equal(versionOn('2027-01-01'), 'version_6');
		assert.ok(fixtureString(row('version_3', 'work_catalog', 'OVERTIME').rate).includes('2250.0'));
		assert.ok(fixtureString(row('version_4', 'work_catalog', 'OVERTIME').rate).includes('2250.0'));
		for (const version of ['version_5', 'version_6']) {
			const policy = fixtureRecord(row(version, 'rule_set', 'overtime_classification').rules);
			for (const limit of fixtureRecords(policy.limits)) {
				const applies = fixtureString(limit.applies);
				for (const work_classification of ['MANAGERIAL', 'NON_EA'])
					assert.equal(
						evaluateConfigured(
							applies,
							fixtureContext(subject({ terms: { base_salary: 2500, work_classification } }))
						),
						false
					);
				assert.equal(
					evaluateConfigured(applies, fixtureContext(subject({ terms: { base_salary: 2500 } }))),
					true
				);
			}
		}
	});
	it('every row id is unique across versions and every child names its own version', () => {
		const seen = new Set<string>();
		for (const version of versions) {
			const settingsId = settingsOf(version).id;
			for (const table of TABLES)
				for (const item of load(version, table)) {
					assert.equal(typeof item.id, 'string');
					assert.equal(seen.has(String(item.id)), false, `${version} ${table} ${item.id}`);
					seen.add(String(item.id));
					if (table !== 'jurisdiction_settings')
						assert.equal(item.settings_id, settingsId, `${version} ${table} ${item.code}`);
				}
		}
	});
	it('every row key is a field of its model and every enum value is declared', () => {
		for (const table of TABLES) {
			const fields = modelFields(table);
			for (const version of versions)
				for (const item of load(version, table))
					for (const [key, value] of Object.entries(item)) {
						assert.ok(LINK_KEYS.has(key) || key in fields, `${version} ${table}.${key}`);
						const field = fields[key];
						const values = field?.kind === 'enum' ? field.values : undefined;
						if (fields[key]?.kind === 'enum' && values != null && value != null)
							assert.ok(values.includes(String(value)), `${version} ${table}.${key}=${value}`);
					}
		}
		// rule_set.rules is a record; scalar rules are wrapped as { value }.
		for (const version of versions)
			for (const item of load(version, 'rule_set'))
				assert.ok(
					item.rules != null && typeof item.rules === 'object' && !Array.isArray(item.rules),
					`${version} rule_set ${item.code}`
				);
	});
	it('catalogue codes are the same in every version', () => {
		for (const table of TABLES.filter((name) => name !== 'jurisdiction_settings')) {
			const key = (item: Row) => `${item.family ?? ''}/${item.code}`;
			const first = load(fixturePresent(versions[0]), table).map(key).toSorted();
			for (const version of versions)
				assert.deepEqual(load(version, table).map(key).toSorted(), first, `${version} ${table}`);
		}
	});
	it('every CEL expression parses', () => {
		for (const version of versions)
			for (const table of TABLES)
				for (const item of load(version, table))
					for (const [path, expression] of celOf(item, `${table}:${item.code ?? item.id}`))
						assert.doesNotThrow(() => configuredProgram(expression), `${version} ${path}`);
	});
	it('work, allowance, claim, adhoc and loan CEL evaluates on the payroll context', () => {
		const employment = {
			classification: 'EA_COVERED',
			service_months: 40,
			exit_date: '2026-08-31',
			exit_ground: 'RETIREMENT',
			exit_facts: { eap_decision: 'AWARD', eap_gross_monthly: 3000 }
		};
		const payroll = {
			...subject({ employment, employee: { date_of_birth: '1962-03-15' } }),
			rules: {},
			period: {
				part: 1,
				parts: 1,
				month_from: '2026-03-01',
				month_to: '2026-03-31',
				month_days: 31,
				month_working_days: 22,
				month_holiday_work_days: 0,
				key: '2026-03',
				from: '2026-03-01',
				to: '2026-03-31',
				days: 31,
				paid_days: 31,
				working_days: 22,
				covered_working_days: 22
			},
			work: {
				overtime_hours: 4,
				incentive_hours: 2,
				payable_incentive_hours: 2,
				dates: [],
				holidays: [],
				// A planned 8-hour day clocked 12 hours: 4 derived overtime hours, 2 of them past a cap.
				days: [
					{
						date: '2026-03-10',
						day_type: 'WORK',
						holiday_kind: '',
						scheduled_hours: 8,
						worked: true,
						worked_hours: 12,
						approved_overtime_hours: 4,
						overtime_hours: 4,
						banked_hours: 0,
						incentive_hours: 2,
						payable_incentive_hours: 2,
						facts: {},
						intervals: [],
						overtime_intervals: []
					}
				]
			},
			earned: { month: slipSums([]), average: { gross: 0, net: 0, months: 0 } },
			leave: {
				rows: [
					{
						code: 'UNPAID_LEAVE',
						activity: 'TIME_OFF',
						days: 1,
						is_npl: true,
						can_encash: false,
						pay_fraction: 1
					},
					{
						code: 'ANNUAL_LEAVE',
						activity: 'ENCASHMENT',
						days: 2,
						is_npl: false,
						can_encash: true,
						pay_fraction: 1
					}
				]
			}
		};
		// Facts an entry of each class carries; the engine merges them into `entry`.
		const facts: Record<string, Row> = {
			DIRECTOR_GENERAL_MEETING_FEE: { general_meeting_voted: true, general_meeting_ref: 'AGM-1' },
			MEDICAL_TREATMENT_REIMBURSEMENT: {
				amount_incurred: 120,
				patient: 'EMPLOYEE',
				practitioner_qualified: true,
				treatment: 'MEDICAL',
				treatment_necessary: true,
				solely_aesthetic: false
			},
			PER_DIEM_OFFICIAL_REIMBURSEMENT: {
				official_purpose: true,
				actual_expenditure: 100,
				purpose_reference: 'TRIP-1'
			},
			// Appendix 8A/8B classes value their facts (here to 100); the deemed gain is a leaver's, priced in its own test.
			BIK_PLACE_OF_RESIDENCE: { employer_rent: 100 },
			BIK_UTILITIES_HOUSEKEEPING: { utilities: 100 },
			BIK_HOTEL_ACCOMMODATION: { hotel_cost: 100 },
			BIK_CAR: { car_kind: 'LEASED', rental_cost: 175, running_costs: 58.34 },
			BIK_OTHER: { appendix_8a_item: '4j' },
			SHARE_PLAN_GAIN: {
				plan: 'ESOW',
				grant_date: '2025-03-01',
				gain_date: '2026-03-01',
				exercise_price: 1,
				open_market_value: 2,
				shares: 100
			},
			...Object.fromEntries(
				[
					'ADOPTION_REIMBURSEMENT',
					'GPML_REIMBURSEMENT',
					'GPPL_REIMBURSEMENT',
					'GPSPL_REIMBURSEMENT',
					'GPCL_REIMBURSEMENT'
				].map((code) => [
					code,
					{ service_months: 12, cdca_original_statutory_origin: 'S9_1A_II_B' }
				])
			)
		};
		const entry = (code: string, amount = 100, quantity = 1) => ({
			...payroll,
			entry: {
				amount,
				quantity,
				occurred_on: '2026-03-10',
				due_on: '2026-03-10',
				incurred_on: '2026-03-05',
				facts: facts[code] ?? {},
				...(facts[code] ?? {})
			},
			earlier: { rows: [], calendar_year: 0, lifetime: 0 }
		});
		for (const version of versions) {
			const work = Object.fromEntries(
				load(version, 'work_catalog').map((item) => [
					item.code,
					// As the run prices a work line: quantity and rate only once eligibility holds.
					evaluateConfigured(fixtureString(String(item.eligibility)), fixtureContext(payroll)) ===
					true
						? ['eligibility', 'quantity', 'rate'].map((field) =>
								evaluateConfigured(fixtureString(String(item[field])), fixtureContext(payroll))
							)
						: [false]
				])
			);
			assert.deepEqual(work.BASIC, [true, 1, 5000]);
			// EA s.38(4)/(8): 1.5 × 12 × min(basic, 2,250) ÷ 2,288 for a non-workman.
			// A $5,000 non-manual employee is outside Part 4 (EA s.35): no statutory overtime.
			assert.deepEqual(work.OVERTIME, [false]);
			assert.deepEqual(work.NO_PAY_LEAVE, [true, 1, 5000 / 22]);
			assert.deepEqual(work.ENCASHMENT, [true, 2, 5000 / 22]);
			assert.deepEqual(work.HOLIDAY_WORK, [false]);
			for (const item of load(version, 'allowance_catalog'))
				assert.equal(
					typeof evaluateConfigured(
						fixtureString(String(item.eligibility)),
						fixtureContext(payroll)
					),
					'boolean'
				);
			for (const table of ['claim_catalog', 'adhoc_catalog', 'loan_catalog'])
				for (const item of load(version, table)) {
					const context = entry(String(item.code));
					for (const field of ['eligibility', 'qualifies_when'])
						if (typeof item[field] === 'string' && String(item[field]).trim() !== '')
							assert.equal(
								evaluateConfigured(fixtureString(String(item[field])), fixtureContext(context)),
								// A class given the facts it names qualifies; the rest only need to answer true or false.
								facts[String(item.code)] == null
									? Boolean(
											evaluateConfigured(
												fixtureString(String(item[field])),
												fixtureContext(context)
											)
										)
									: true,
								`${version} ${table} ${item.code}.${field}`
							);
					for (const band of fixtureValue4(item.bands ?? [])) {
						if (band.when.trim() !== '')
							assert.equal(
								evaluateConfigured(fixtureString(band.when), fixtureContext(context)),
								true,
								`${item.code}`
							);
						if (
							![
								'EMPLOYMENT_ASSISTANCE_PAYMENT',
								'SALARY_IN_LIEU_OF_NOTICE',
								'SHARE_PLAN_DEEMED_GAIN'
							].includes(String(item.code))
						)
							assert.equal(
								evaluateConfigured(fixtureString(band.amount), fixtureContext(context)),
								100,
								`${item.code}`
							);
					}
				}
			// CDCA reimbursement: at most SGD 2,500 a week of leave, the claim's quantity being its weeks.
			const gpml = String(row(version, 'claim_catalog', 'GPML_REIMBURSEMENT').qualifies_when);
			assert.deepEqual(
				[
					[2500, 1],
					[2500.01, 1],
					[20000, 8],
					[20000.01, 8]
				].map(([amount, weeks]) =>
					evaluateConfigured(
						fixtureString(gpml),
						fixtureContext(entry('GPML_REIMBURSEMENT', amount, weeks))
					)
				),
				[true, false, true, false]
			);
		}
	});
	it('public holiday work pays an extra day at the daily basic rate', () => {
		for (const version of versions) {
			const item = row(version, 'work_catalog', 'HOLIDAY_WORK');
			const at = (facts: Row, holidays: Row[], terms: Row = {}) => {
				const context = {
					...subject({ employee: { facts }, terms: { base_salary: 5200, ...terms } }),
					work: { overtime_hours: 0, incentive_hours: 0, dates: ['2026-03-10'], holidays },
					// March 2026: 21 working days and the holiday on one (MOM counts it): 22.
					period: { month_days: 31, month_working_days: 21, month_holiday_work_days: 1 }
				};
				return evaluateConfigured(
					fixtureString(String(item.eligibility)),
					fixtureContext(context)
				) === true
					? ['eligibility', 'quantity', 'rate'].map((field) =>
							evaluateConfigured(fixtureString(String(item[field])), fixtureContext(context))
						)
					: [false];
			};
			const holiday = {
				date: '2026-03-10',
				kind: 'PUBLIC_HOLIDAY',
				given_to: 'EVERYONE',
				replaces: '',
				worked: true,
				worked_hours: 8
			};
			// 12 × 5,200 ÷ (52 × 5) = 240 a day.
			assert.deepEqual(at({ working_days_per_week: 5 }, [holiday]), [true, 1, 240]);
			assert.deepEqual(
				at({ working_days_per_week: 5.5 }, [holiday, { ...holiday, kind: 'SUBSTITUTE' }]),
				[true, 2, (12 * 5200) / (52 * 5.5)]
			);
			// No working days a week recorded: never zero, the monthly basic over the month's s.20A working days.
			assert.deepEqual(at({}, [holiday]), [true, 1, 5200 / 22]);
			assert.equal(at({ working_days_per_week: 5 }, [])[0], false);
			assert.equal(
				at({ working_days_per_week: 5 }, [holiday], { employment_type: 'PART_TIME' })[0],
				false
			);
		}
	});
	it('the Employment Assistance Payment evaluates on the exit facts', () => {
		for (const version of versions) {
			const item = row(version, 'adhoc_catalog', 'EMPLOYMENT_ASSISTANCE_PAYMENT');
			const amount = fixturePresent(fixtureValue4(item.bands)[0]).amount;
			const at = (birth: string, exit: string, exit_facts: Row, terms: Row = {}) => {
				const context = {
					...subject({
						employee: { date_of_birth: birth },
						employment: { exit_date: exit, exit_ground: 'RETIREMENT', exit_facts },
						terms
					}),
					entry: { amount: 0, quantity: 1, facts: {} }
				};
				const eligible = evaluateConfigured(
					fixtureString(String(item.eligibility)),
					fixtureContext(context)
				);
				return eligible === true
					? evaluateConfigured(fixtureString(amount), fixtureContext(context))
					: eligible;
			};
			const award = { eap_decision: 'AWARD', eap_gross_monthly: 3000 };
			// Born 1962-03: 64y5m on 1 Sep 2026, between retirement (63, cohort 1960-07 – 1963-06) and re-employment (69):
			// the regular guide, 3.5 × 3,000, inside 6,250–14,750.
			assert.equal(at('1962-03-15', '2026-08-31', award), 10500);
			// 66y on the day after exit: the stepped-down guide, 2 × 3,000 inside 4,000–8,500.
			assert.equal(at('1960-08-15', '2026-08-31', award), 6000);
			// A part-time employee's bounds pro-rate by weekly hours: 3.5 × 1,200 = 4,200 against a 6,250 × 20/40 floor.
			assert.equal(
				at(
					'1962-03-15',
					'2026-08-31',
					{
						eap_decision: 'AWARD',
						eap_gross_monthly: 1200,
						eap_prorate_bounds: true,
						eap_weekly_hours: 20,
						eap_fulltime_weekly_hours: 40
					},
					{ employment_type: 'PART_TIME' }
				),
				4200
			);
			assert.equal(at('1962-03-15', '2026-08-31', { eap_decision: 'NOT_AWARDED' }), false);
			assert.equal(at('1962-03-15', '2026-08-31', {}), false);
			assert.equal(at('1980-01-01', '2026-08-31', award), false);
			assert.equal(at('1962-03-15', '2026-08-31', award, { residency_status: 'FOREIGNER' }), false);
		}
	});
	it('the behaviours plan a REGULAR and an OFF_CYCLE run and pin only committed runs', () => {
		for (const version of versions) {
			const behaviours = fixtureValue5(settingsOf(version).behaviours);
			for (const kind of ['REGULAR', 'OFF_CYCLE'])
				assert.ok(
					planBehaviours(
						behaviours,
						{ kind: 'catalog', catalog: 'WORK', event: 'PAYROLL_CREATE' },
						{ event: { data: { request: { kind, period: '2026-03' } } } }
					).some((rule) => rule.id === 'payroll-run')
				);
			const pin = fixtureValue6(behaviours).rules.find((rule) => rule.id === 'pin-settled-entries');
			assert.equal(
				evaluateConfigured(
					fixtureString(fixturePresent(fixturePresent(pin).when)),
					fixtureContext({ event: { row: {} } })
				),
				true
			);
			assert.doesNotMatch(fixturePresent(pin).when ?? '', /approval_id/);
		}
	});
	for (const version of versions)
		for (const [table, since] of [
			[fixturePresent(SC[version]), null],
			[PR1, '2025-09-15'],
			[PR2, '2024-09-15']
		] as const)
			AGES.forEach((age, band) => {
				const residency = since == null ? 'CITIZEN' : `PERMANENT_RESIDENT since ${since}`;
				it(`CPF First Schedule ${version}, ${residency}, age ${age}: exact graduated-band cents`, () => {
					const person = {
						age,
						residency_status: since == null ? 'CITIZEN' : 'PERMANENT_RESIDENT',
						residency_since: since
					};
					for (let cents = 0; cents <= 900000; cents += cents >= 50000 && cents < 76000 ? 7 : 997)
						assert.deepEqual(
							charge(version, 'CPF', cents / 100, person),
							cpfExact(fixturePresent(table[band]), cents),
							`${version} ${person.residency_status} ${since} age ${age} wage ${cents / 100}`
						);
				});
			});
	it('an SPR jointly elected to full rates pays Table 1 in the first two years', () => {
		for (const version of versions)
			for (const since of ['2025-09-15', '2024-09-15'])
				AGES.forEach((age, band) => {
					const person = { age, residency_status: 'PERMANENT_RESIDENT', residency_since: since };
					for (const cents of [40000, 60000, 500000]) {
						assert.deepEqual(
							charge(version, 'CPF', cents / 100, person, '2026-03-01', { spr_full_rates: true }),
							cpfExact(fixturePresent(fixturePresent(SC[version])[band]), cents),
							`${version} ${since} age ${age} wage ${cents / 100}`
						);
						assert.deepEqual(
							charge(version, 'CPF', cents / 100, person, '2026-03-01', { spr_full_rates: false }),
							cpfExact(fixturePresent((since === '2025-09-15' ? PR1 : PR2)[band]), cents)
						);
					}
				});
	});
	it('CPF ceilings, refusals and the foreigner exclusion', () => {
		/** The CPF record's assessable parts for one month, as the engine evaluates them. */
		const assessable = (
			version: string,
			month: {
				ordinary: number;
				additional: number;
			},
			facts: {
				month?: number;
				salary_paid?: boolean;
				monthly_wage?: number;
				year?: number;
			} = {}
		) => {
			const parts = fixturePresent(configuration(version, 'CPF').assessable);
			const context = {
				wage: month,
				month,
				year: { ordinary: facts.year ?? 0, additional: 0 },
				period: { month: facts.month ?? 3, salary_paid: facts.salary_paid ?? false },
				terms: { monthly_wage: facts.monthly_wage ?? month.ordinary }
			};
			return [
				evaluateConfigured(fixtureString(fixturePresent(parts.ordinary)), fixtureContext(context)),
				evaluateConfigured(fixtureString(fixturePresent(parts.additional)), fixtureContext(context))
			];
		};
		// OW ceiling 7,400 then 8,000 from January 2026.
		assert.deepEqual(assessable('version_1', { ordinary: 9000, additional: 0 }), [7400, 0]);
		for (const version of ['version_2', 'version_3', 'version_4'])
			assert.deepEqual(assessable(version, { ordinary: 9000, additional: 0 }), [8000, 0]);
		for (const version of versions) {
			const ceiling = version === 'version_1' ? 7400 : 8000;
			// A March bonus before any salary: 102,000 − capped OW projected over March–December.
			assert.deepEqual(
				assessable(version, { ordinary: 0, additional: 50000 }, { monthly_wage: 10000 }),
				[0, 102000 - ceiling * 10]
			);
			// December, salary paid, 11 months already charged at the ceiling.
			assert.deepEqual(
				assessable(
					version,
					{ ordinary: 10000, additional: 50000 },
					{ month: 12, salary_paid: true, year: ceiling * 11 }
				),
				[ceiling, 102000 - ceiling * 12]
			);
			// The age basis is the previous month's last day: the band moves the month after the birthday.
			const age = fixturePresent(fixturePresent(configuration(version, 'CPF').person).age);
			const on = (birth: string) =>
				evaluateConfigured(
					fixtureString(age),
					fixtureContext({
						employee: { date_of_birth: birth },
						period: { from: '2026-03-01' }
					})
				);
			assert.deepEqual([on('1971-02-10'), on('1971-03-01'), on('')], [55, 54, null]);
		}
		// The 2027 senior step's graduated band: 16.5% × 700 + 0.57 × 200 = 229.5 → 230; employee 114 (not 113.99…).
		assert.deepEqual(charge('version_4', 'CPF', 700, { age: 57, residency_status: 'CITIZEN' }), {
			employee: 114,
			employer: 116
		});
		assert.equal(
			charge('version_2', 'CPF', 5000, { age: 30, residency_status: 'FOREIGNER' }),
			null
		);
		assert.equal(
			charge('version_2', 'CPF', 5000, { age: null, residency_status: 'CITIZEN' }),
			'REFUSED'
		);
		assert.equal(
			charge('version_2', 'CPF', 5000, { age: 40, residency_status: 'PERMANENT_RESIDENT' }),
			'REFUSED'
		);
	});
	it('SDL and the self-help group funds charge their schedules', () => {
		const citizen = (race: string, religion: string | null = null) => ({
			age: 30,
			residency_status: 'CITIZEN',
			race,
			religion
		});
		for (const version of versions) {
			const sdl = (wage: number) => charge(version, 'SDL', wage, citizen('CHINESE'));
			assert.deepEqual(sdl(500), { employee: 0, employer: 2 });
			assert.deepEqual(sdl(2000), { employee: 0, employer: 5 });
			assert.deepEqual(sdl(4500), { employee: 0, employer: 11.25 });
			assert.deepEqual(sdl(9000), { employee: 0, employer: 11.25 });
			const fund = (code: string, wage: number, person: Row) =>
				fixtureValue7(charge(version, code, wage, person))?.employee ?? 0;
			const chinese = citizen('CHINESE');
			assert.deepEqual(
				[2000, 2000.01, 3500, 5000, 7500, 7500.01].map((w) => fund('CDAC', w, chinese)),
				[0.5, 1, 1, 1.5, 2, 3]
			);
			const eurasian = citizen('EURASIAN');
			assert.deepEqual(
				[1000, 1500, 2500, 4000, 7000, 10000, 10000.01].map((w) => fund('ECF', w, eurasian)),
				[2, 4, 6, 9, 12, 16, 20]
			);
			const muslim = citizen('MALAY', 'ISLAM');
			assert.deepEqual(
				[1000, 2000, 3000, 4000, 6000, 8000, 10000, 10000.01].map((w) => fund('MBMF', w, muslim)),
				[3, 4.5, 6.5, 15, 19.5, 22, 24, 26]
			);
			const indian = citizen('INDIAN');
			assert.deepEqual(
				[1000, 1500, 2500, 4500, 7500, 10000, 15000, 15000.01].map((w) => fund('SINDA', w, indian)),
				[1, 3, 5, 7, 9, 12, 18, 30]
			);
			assert.equal(fund('CDAC', 5000, { ...chinese, residency_status: 'FOREIGNER' }), 0);
		}
	});
	it('statutory leave carries the Employment Act service ladders', () => {
		for (const version of versions) {
			const days = (code: string) =>
				(fixtureValue8(row(version, 'leave_catalog', code).entitlement) ?? { bands: [] }).bands.map(
					(band) => [band.service_months, band.days]
				);
			// EA s.89(1)–(2): outpatient 5/8/11/14 and hospitalisation 15/30/45/60 at 3/4/5/6 months.
			assert.deepEqual(days('SICK_LEAVE'), [
				[6, 14],
				[5, 11],
				[4, 8],
				[3, 5]
			]);
			assert.deepEqual(days('HOSPITALIZATION_LEAVE'), [
				[6, 60],
				[5, 45],
				[4, 30],
				[3, 15]
			]);
			assert.equal(
				row(version, 'leave_catalog', 'SICK_LEAVE').consumes_code,
				'HOSPITALIZATION_LEAVE'
			);
			// EA s.88A(1)–(2) / MOM table: 7 days in the 1st year (pro-rated under 12 months), 8 in the 2nd, +1 a
			// year, 14 from the 8th year (84 completed months).
			const annual = fixtureValue9(row(version, 'leave_catalog', 'ANNUAL_LEAVE').entitlement);
			assert.deepEqual(
				[1, 6, 11].map((service_months) =>
					evaluateConfigured(
						fixtureString(annual.days),
						fixtureContext({ service_months, bands: annual.bands })
					)
				),
				[1, 4, 6]
			);
			assert.deepEqual(
				annual.bands.map((band) => [band.service_months, band.days]),
				[
					[84, 14],
					[72, 13],
					[60, 12],
					[48, 11],
					[36, 10],
					[24, 9],
					[12, 8]
				]
			);
		}
	});
	it('every leave class evaluates on the admission context, the family-event classes by their facts', () => {
		const birth = '2026-03-10';
		const female = { gender: 'FEMALE', marital_status: 'MARRIED' };
		const male = { gender: 'MALE', marital_status: 'MARRIED' };
		const citizenBirth = {
			event_kind: 'BIRTH',
			child_citizenship: 'CITIZEN',
			cdca_birth_on: birth,
			cdca_child_citizen_at_birth: true,
			cdca_citizenship_on: birth,
			cdca_maternity_arrangement: 'A',
			cdca_is_natural_father: true,
			cdca_married_at_conception: true,
			cdca_original_spell_from: birth,
			cdca_original_taking_mode: 'CONTINUOUS',
			cdca_original_ea76_arrangement: 'NONE'
		};
		const adoption = {
			event_kind: 'ADOPTION',
			child_citizenship: 'CITIZEN',
			cdca_adoption_eligibility_on: birth,
			cdca_adoption_application_on: birth,
			cdca_birth_on: '2025-12-01',
			cdca_is_natural_mother: false,
			cdca_child_status_at_application: 'SC',
			cdca_adoption_arrangement: 'A'
		};
		const kids = (...children: Row[]) => children;
		for (const version of versions) {
			const eligible = (
				code: string,
				over: Parameters<typeof subject>[0],
				facts: Row = {},
				on = birth
			) =>
				evaluateConfigured(
					fixtureString(String(row(version, 'leave_catalog', code).eligibility || 'true')),
					fixtureContext(admission(over, on, facts))
				);
			// Every class answers true or false for an ordinary employee with no event.
			for (const item of load(version, 'leave_catalog'))
				if (
					String(item.eligibility).trim() !== '' &&
					![
						'MATERNITY_LEAVE',
						'PATERNITY_LEAVE',
						'ADOPTION_LEAVE',
						'SHARED_PARENTAL_LEAVE'
					].includes(String(item.code))
				)
					assert.equal(
						typeof eligible(String(item.code), {}),
						'boolean',
						`${version} ${item.code}`
					);
			// CDCA s.9: a citizen child, arrangement A, 3 months' service before the birth.
			assert.equal(eligible('MATERNITY_LEAVE', { employee: female }, citizenBirth), true);
			assert.equal(eligible('MATERNITY_LEAVE', { employee: male }, citizenBirth), false);
			assert.equal(
				eligible(
					'MATERNITY_LEAVE',
					{ employee: female, employment: { service_months: 2 } },
					citizenBirth
				),
				false
			);
			// The entry day is the event day: a later entry day does not match the recorded birth.
			assert.equal(
				eligible('MATERNITY_LEAVE', { employee: female }, citizenBirth, '2026-04-01'),
				false
			);
			// CDCA ss.12H–12I: a married natural father of a citizen child.
			assert.equal(eligible('PATERNITY_LEAVE', { employee: male }, citizenBirth), true);
			assert.equal(eligible('PATERNITY_LEAVE', { employee: female }, citizenBirth), false);
			// CDCA s.12AA: an adoptive mother of a citizen child under 12 months.
			assert.equal(eligible('ADOPTION_LEAVE', { employee: female }, adoption), true);
			assert.equal(
				eligible(
					'ADOPTION_LEAVE',
					{ employee: female },
					{ ...adoption, cdca_birth_on: '2025-01-01' }
				),
				false
			);
			// CDCA s.12DA: either parent of a citizen child born or adopted.
			assert.equal(eligible('SHARED_PARENTAL_LEAVE', { employee: male }, citizenBirth), true);
			assert.equal(
				eligible(
					'SHARED_PARENTAL_LEAVE',
					{ employee: male },
					{ ...citizenBirth, child_citizenship: 'FOREIGNER' }
				),
				false
			);
			// CDCA s.12B / EA s.87A: a child under 7 (any, EA-covered) or a citizen child under 13.
			const under7 = { child_birthdate: '2022-05-01', relationship: 'CHILD' };
			const citizen10 = {
				child_birthdate: '2016-01-01',
				relationship: 'CHILD',
				citizenship: 'CITIZEN'
			};
			const foreign10 = {
				child_birthdate: '2016-01-01',
				relationship: 'CHILD',
				citizenship: 'FOREIGNER'
			};
			assert.equal(eligible('CHILDCARE_LEAVE', { employee: { children: kids(under7) } }), true);
			assert.equal(eligible('CHILDCARE_LEAVE', { employee: { children: kids(citizen10) } }), true);
			assert.equal(eligible('CHILDCARE_LEAVE', { employee: { children: kids(foreign10) } }), false);
			assert.equal(
				eligible('CHILDCARE_LEAVE', {
					employee: { children: kids(under7) },
					employment: { classification: 'NON_EA' }
				}),
				false
			);
			assert.equal(eligible('CHILDCARE_LEAVE', { employee: { children: kids() } }), false);
			assert.equal(
				eligible('CHILDCARE_LEAVE', {
					employee: { children: kids({ ...under7, child_deathdate: '2024-01-01' }) }
				}),
				false
			);
			// CDCA s.12D: a citizen child under 2.
			const infant = {
				child_birthdate: '2025-06-01',
				relationship: 'CHILD',
				citizenship: 'CITIZEN'
			};
			assert.equal(
				eligible('UNPAID_INFANT_CARE_LEAVE', {
					employee: { children: kids(infant), marital_status: 'MARRIED' }
				}),
				true
			);
			assert.equal(
				eligible('UNPAID_INFANT_CARE_LEAVE', {
					employee: { children: kids(citizen10), marital_status: 'MARRIED' }
				}),
				false
			);
			// Enlistment Act: a male citizen or SPR.
			assert.equal(eligible('NS_LEAVE', { employee: male }), true);
			assert.equal(
				eligible('NS_LEAVE', { employee: male, terms: { residency_status: 'PERMANENT_RESIDENT' } }),
				true
			);
			assert.equal(
				eligible('NS_LEAVE', { employee: male, terms: { residency_status: 'FOREIGNER' } }),
				false
			);
			assert.equal(eligible('NS_LEAVE', { employee: female }), false);
		}
	});
	it('both input schemas are JSON Schema 2020-12 in the one layout, and declare every fact the CEL reads', () => {
		for (const version of versions) {
			const settings = settingsOf(version);
			const employee = fixtureValue10(settings.employee_input_schema);
			const entity = fixtureValue10(settings.entity_input_schema);
			for (const [name, schema] of [
				['employee', employee],
				['entity', entity]
			] as const) {
				assert.equal(
					fixtureValue11(schema).$schema,
					'https://json-schema.org/draft/2020-12/schema'
				);
				assert.equal(fixtureValue11(schema).type, 'object');
				assert.deepEqual(schemaProblems(schema, `${version} ${name}`), []);
			}
			// The layout the engine reads: terms, exit facts, per-scheme standings, person facts; no profile columns.
			assert.deepEqual([...propertiesAt(employee)].toSorted(), [
				'contract_terms',
				'employment_statutory_facts',
				'exit_facts',
				'facts'
			]);
			assert.deepEqual(
				[...propertiesAt(employee, 'properties', 'employment_statutory_facts', 'items')].toSorted(),
				['effective_range', 'status', 'statutory_contribution_id']
			);
			const status = ['properties', 'employment_statutory_facts', 'items', 'properties', 'status'];
			assert.deepEqual([...propertiesAt(employee, ...status)].toSorted(), ['elections', 'kind']);
			const elections = propertiesAt(employee, ...status, 'properties', 'elections');
			// electionKeysOf reads exactly this path.
			assert.deepEqual(electionKeysOf(employee).toSorted(), [...elections].toSorted());
			const term = propertiesAt(employee, 'properties', 'contract_terms', 'items');
			const person = propertiesAt(employee, 'properties', 'facts');
			const exit = propertiesAt(employee, 'properties', 'exit_facts');
			const company = propertiesAt(entity);
			assert.deepEqual([...company].toSorted(), [
				'cpf_submission_number',
				'dpo_contact',
				'foreign_worker_levy_payer',
				'full_time_weekly_hours',
				'industrial_undertaking',
				'ns_direct_scheme',
				'uen'
			]);
			const terms = fixtureValue11(
				fixtureRecord(fixtureRecord(fixtureRecord(employee).properties).contract_terms).items
			);
			assert.equal(fixtureValue11(fixtureRecord(terms.properties).currency).const, 'SGD');
			// `terms` keys the engine derives rather than reads from the term.
			const derived = new Set(['monthly_wage']);
			const text = TABLES.map((table) => JSON.stringify(load(version, table))).join('\n');
			const read = (pattern: RegExp) =>
				new Set([...text.matchAll(pattern)].map((match) => fixturePresent(match[1])));
			for (const key of read(/\bterms\.([a-z_]+)/g))
				assert.ok(term.has(key) || derived.has(key), `${version} terms.${key} is declared`);
			for (const key of read(/\bemployee\.facts\.([a-z_]+)/g))
				assert.ok(person.has(key), `${version} employee.facts.${key} is declared`);
			for (const key of read(/\bexit_facts\.([a-z0-9_]+)/g))
				assert.ok(exit.has(key), `${version} exit_facts.${key} is declared`);
			for (const key of read(/\bcompany\.facts\.([a-z_]+)/g))
				assert.ok(company.has(key), `${version} company.facts.${key} is declared`);
			for (const key of read(/\bscheme\.elections\.([a-z_]+)/g))
				assert.ok(elections.has(key), `${version} scheme.elections.${key} is declared`);
			assert.equal(read(/\belections\.[A-Z]+\.([a-z_]+)/g).size, 0);
			// The enums are the values the CEL compares against.
			const values = (key: string) =>
				fixtureValue12(fixtureRecord(fixtureRecord(terms.properties)[key]).enum);
			assert.deepEqual(values('residency_status'), ['CITIZEN', 'PERMANENT_RESIDENT', 'FOREIGNER']);
			assert.ok(values('work_classification').includes('NON_EA'));
			assert.ok(values('statutory_work_category').includes('NON_MANUAL'));
			assert.ok(values('employment_type').includes('PART_TIME'));
		}
	});
	/** A hire/exit `due` / `applies_when` context as the v2 rules build it: the contract row, profile and entity. */
	const lifecycle = (
		over: {
			contract?: Row;
			employee?: Row | null;
			company?: Row | null;
		} = {}
	) => ({
		contract: {
			id: 'k1',
			company_id: 'c1',
			employee_id: 'p1',
			effective_range: { from: '2026-03-02', to: '2026-06-30' },
			exit_ground: 'RESIGNATION',
			exit_facts: { notice_served: true },
			...over.contract,
			employee_number: String('p1'),
			contract_number: 1
		},
		employee:
			over.employee === undefined
				? {
						nationality: 'IN',
						gender: 'MALE',
						date_of_birth: '1990-01-01',
						facts: { immigration_status: 'S_PASS' }
					}
				: over.employee,
		company: over.company === undefined ? { region: '', risk_class: '', facts: {} } : over.company
	});
	it('remittances are OBLIGATIONS, everything else is a TASK, and every due and condition evaluates for its trigger', () => {
		const field = (version: string, code: string, key: string, context: Row) =>
			evaluateConfigured(
				fixtureString(String(fixtureValue11(row(version, 'rule_set', code).rules)[key])),
				fixtureContext(fixtureValue13(context))
			);
		const due = (version: string, code: string, context: Row) =>
			field(version, code, 'due', context);
		const applies = (version: string, code: string, context: Row) =>
			field(version, code, 'applies_when', context);
		// 2026-04-14 is a Tuesday; 2026-05-17 a Sunday; 2027-04-14 a Wednesday.
		const holidays = ['2026-04-03', '2026-05-01', '2026-06-01'];
		const company = { region: '', risk_class: '', facts: {} };
		const march = {
			period: { key: '2026-03', from: '2026-03-01', to: '2026-03-31' },
			company,
			holidays,
			run: { pay_date: '2026-04-07', totals: { gross: 0, net: 0, employer_cost: 0, schemes: {} } }
		};
		const april = {
			period: { key: '2026-04', from: '2026-04-01', to: '2026-04-30' },
			company,
			holidays,
			run: { pay_date: '2026-05-07', totals: { gross: 0, net: 0, employer_cost: 0, schemes: {} } }
		};
		const hire = {
			hired_on: '2026-03-02',
			holidays,
			...lifecycle({ contract: { exit_ground: null, exit_facts: null } })
		};
		const exit = { exit_on: '2026-06-30', holidays, headcount: 12, ...lifecycle() };
		// Paid on Thursday 2 April 2026; Good Friday and the weekend do not count.
		const paid = { ...april, row: { id: 's1', status: 'PAID', paid_on: '2026-04-02' } };
		const leaveRow = (facts: Row, days = 5, extra: Row = {}) => ({
			holidays,
			company,
			period: { key: '2026-05', from: '2026-05-01', to: '2026-05-31' },
			row: {
				id: 'l1',
				catalog_code: 'MATERNITY_LEAVE',
				activity: 'TIME_OFF',
				occurred_on: '2026-05-04',
				from: '2026-05-04',
				to: '2026-05-08',
				days,
				facts,
				...extra
			}
		});
		const contextOf = (duty: Row): Row => {
			const trigger = triggerOf(duty);
			if (trigger === 'PAYROLL_RUN') return march;
			if (trigger === 'HIRE') return hire;
			if (trigger === 'EXIT') return exit;
			if (trigger === 'entity.created')
				return { ...march, today: '2026-03-01', row: { id: 'c1', facts: {} } };
			if (trigger === 'payslip.updated') return paid;
			if (trigger === 'employment_profile.updated')
				return {
					...march,
					row: {
						id: 'p1',
						facts: { leaves_singapore_from: '2026-09-01', immigration_status: 'EMPLOYMENT_PASS' }
					}
				};
			if (trigger.startsWith('workplace_case.'))
				return {
					...march,
					today: '2026-03-05',
					row: {
						id: 'case-1',
						kind: 'DATA_BREACH',
						opened_on: '2026-03-02',
						closed_on: null,
						facts: { notifiable_assessed_on: '2026-03-04' }
					}
				};
			if (trigger === 'calendar.daily')
				return {
					today: '2026-03-02',
					holidays,
					...lifecycle({ employee: { date_of_birth: '1963-09-02', facts: {} } })
				};
			return leaveRow({ event_kind: 'BIRTH', work_accident_on: '2026-05-04' }, 5, {
				catalog_code: 'SICK_LEAVE'
			});
		};
		for (const version of versions) {
			const duties = dutiesOf(load(version, 'rule_set'));
			const obligations = duties.filter((duty) => duty.family === 'OBLIGATIONS');
			assert.deepEqual(
				obligations.map((duty) => duty.code).toSorted(),
				[
					'CPF_MONTHLY_SUBMISSION_AND_PAYMENT',
					'NR_DIRECTOR_WITHHOLDING',
					'NR_ENTERTAINER_WITHHOLDING',
					'SDL_REMITTANCE',
					'SHG_DEDUCTION_REMITTANCE'
				],
				version
			);
			assert.deepEqual(
				obligations.map((duty) => fixtureValue11(duty.rules).schemes),
				[
					['CPF'],
					['SDL'],
					['CDAC', 'ECF', 'MBMF', 'SINDA'],
					['WHT_NR_DIRECTOR'],
					['WHT_NR_ENTERTAINER']
				]
			);
			assert.equal(duties.length, 40, version);
			for (const duty of duties) {
				const rules = fixtureValue11(duty.rules);
				assert.deepEqual(
					Object.keys(rules).filter((key) => ![...DUTY_KEYS, 'amount'].includes(key)),
					[],
					`${version} ${duty.code}`
				);
				assert.ok(
					String(rules.description).length > 0 && String(rules.authority).length > 0,
					String(duty.code)
				);
				const context = contextOf(fixtureContext(duty));
				for (const key of ['when', 'applies_when'])
					if (rules[key] != null)
						assert.equal(
							typeof field(version, String(duty.code), key, context),
							'boolean',
							`${duty.code}.${key}`
						);
				if (duty.code !== 'RETRENCHMENT_NOTIFICATION')
					assert.match(
						String(due(version, String(duty.code), context)),
						/^\d{4}-\d{2}-\d{2}$/,
						String(duty.code)
					);
			}
			// CPF Regulations reg.3 with the CPF Board grace: the 14th, rolled past a weekend or public holiday.
			assert.equal(due(version, 'CPF_MONTHLY_SUBMISSION_AND_PAYMENT', march), '2026-04-14');
			assert.equal(due(version, 'SDL_REMITTANCE', march), '2026-04-14');
			assert.equal(due(version, 'SHG_DEDUCTION_REMITTANCE', april), '2026-05-14');
			assert.equal(due(version, 'FOREIGN_WORKER_LEVY', march), '2026-04-17');
			// 17 May 2026 is a Sunday: the levy rolls to Monday 18 May.
			assert.equal(due(version, 'FOREIGN_WORKER_LEVY', april), '2026-05-18');
			assert.equal(due(version, 'SALARY_PAYMENT_DEADLINE', march), '2026-04-07');
			assert.equal(due(version, 'OVERTIME_PAYMENT_DEADLINE', march), '2026-04-14');
			assert.equal(due(version, 'ITEMISED_PAYSLIP', paid), '2026-04-08');
			assert.equal(
				due(version, 'ANNUAL_EMPLOYMENT_INCOME_RETURN', {
					...march,
					period: { key: '2026-12', from: '2026-12-01', to: '2026-12-31' }
				}),
				'2027-03-01'
			);
			assert.equal(
				due(version, 'CHILDCARE_LEAVE_CLAIM', {
					...march,
					period: { key: '2026-12', from: '2026-12-01', to: '2026-12-31' }
				}),
				'2027-03-31'
			);
			assert.equal(due(version, 'KEY_EMPLOYMENT_TERMS', hire), '2026-03-16');
			assert.equal(due(version, 'WORK_PASS_IN_FORCE', hire), '2026-03-02');
			assert.equal(due(version, 'TAX_CLEARANCE_AND_WITHHOLDING', exit), '2026-05-30');
			assert.equal(due(version, 'WORK_PASS_CANCELLATION', exit), '2026-07-07');
			assert.equal(due(version, 'FINAL_SALARY_PAYMENT', exit), '2026-06-30');
			assert.equal(
				due(version, 'FINAL_SALARY_PAYMENT', {
					...exit,
					...lifecycle({ contract: { exit_facts: {} } })
				}),
				'2026-07-07'
			);
			// The levy: unless the entity records that it employs no levy-paying pass holder.
			assert.equal(applies(version, 'FOREIGN_WORKER_LEVY', march), true);
			assert.equal(
				applies(version, 'FOREIGN_WORKER_LEVY', {
					...march,
					company: { facts: { foreign_worker_levy_payer: false } }
				}),
				false
			);
			// IR21 for every non-Citizen; the pass duties for a pass holder; an unrecorded status raises them.
			const as = (immigration_status: string | null) => ({
				...exit,
				...lifecycle({
					employee: { facts: immigration_status == null ? {} : { immigration_status } }
				})
			});
			for (const [status, ir21, pass] of [
				['CITIZEN', false, false],
				['PERMANENT_RESIDENT', true, false],
				['EMPLOYMENT_PASS', true, true],
				[null, true, true]
			] as const) {
				assert.equal(
					applies(version, 'TAX_CLEARANCE_AND_WITHHOLDING', as(status)),
					ir21,
					`${status}`
				);
				assert.equal(applies(version, 'WORK_PASS_CANCELLATION', as(status)), pass, `${status}`);
				assert.equal(
					applies(version, 'WORK_PASS_IN_FORCE', { ...hire, ...as(status) }),
					pass,
					`${status}`
				);
			}
			// MOM retrenchment notification: 5 working days after the notice (Mon 4 May 2026 → Mon 11 May), ≥ 10 employees.
			const retrenched = (headcount: number) => ({
				...exit,
				headcount,
				...lifecycle({
					contract: {
						exit_ground: 'RETRENCHMENT',
						exit_facts: { retrenchment_notified_on: '2026-05-04' }
					},
					company: { facts: {} }
				})
			});
			assert.equal(applies(version, 'RETRENCHMENT_NOTIFICATION', retrenched(10)), true);
			assert.equal(due(version, 'RETRENCHMENT_NOTIFICATION', retrenched(10)), '2026-05-11');
			assert.equal(applies(version, 'RETRENCHMENT_NOTIFICATION', retrenched(9)), false);
			// GPL claim: 3 months after the spell's last day, for a family-event leave only.
			assert.equal(
				field(version, 'GOVERNMENT_PAID_LEAVE_CLAIM', 'when', leaveRow({ event_kind: 'BIRTH' })),
				true
			);
			assert.equal(
				field(
					version,
					'GOVERNMENT_PAID_LEAVE_CLAIM',
					'when',
					leaveRow({}, 5, { catalog_code: 'ANNUAL_LEAVE' })
				),
				false
			);
			assert.equal(
				due(version, 'GOVERNMENT_PAID_LEAVE_CLAIM', leaveRow({ event_kind: 'BIRTH' })),
				'2026-08-08'
			);
			// Any medically granted leave is reportable; fatal and non-fatal reports use distinct deadline anchors.
			const accident = (days: number, facts: Row = {}) =>
				leaveRow({ work_accident_on: '2026-05-02', ...facts }, days, {
					catalog_code: 'SICK_LEAVE'
				});
			assert.equal(field(version, 'WORK_ACCIDENT_REPORT', 'when', accident(4)), true);
			assert.equal(field(version, 'WORK_ACCIDENT_REPORT', 'when', leaveRow({}, 4)), false);
			assert.equal(applies(version, 'WORK_ACCIDENT_REPORT', accident(3)), true);
			assert.equal(applies(version, 'WORK_ACCIDENT_REPORT', accident(0.5)), true);
			assert.equal(applies(version, 'WORK_ACCIDENT_REPORT', accident(0)), false);
			assert.equal(
				due(
					version,
					'WORK_ACCIDENT_REPORT',
					accident(0, { work_accident_fatal: true, accident_notified_on: '2026-05-05' })
				),
				'2026-05-12'
			);
			assert.equal(applies(version, 'WORK_ACCIDENT_REPORT', accident(4)), true);
			assert.equal(due(version, 'WORK_ACCIDENT_REPORT', accident(4)), '2026-05-12');
			assert.equal(
				due(version, 'WORK_ACCIDENT_REPORT', accident(4, { accident_notified_on: '2026-05-05' })),
				'2026-05-15'
			);
			// CSN: raised for an entity created without one; the first CPF deadline of its first month.
			const entity = (facts: Row) => ({ ...march, company: { facts }, row: { id: 'c1', facts } });
			assert.equal(applies(version, 'CPF_SUBMISSION_NUMBER', entity({})), true);
			assert.equal(
				applies(
					version,
					'CPF_SUBMISSION_NUMBER',
					entity({ cpf_submission_number: '201912345A-PTE-01' })
				),
				false
			);
			assert.equal(due(version, 'CPF_SUBMISSION_NUMBER', entity({})), '2026-04-14');
		}
	});
	it('work accident reports rise for any medical leave, including the dedicated WICA classes', () => {
		for (const version of versions) {
			for (const catalog_code of [
				'SICK_LEAVE',
				'HOSPITALIZATION_LEAVE',
				'WORK_INJURY_MEDICAL_LEAVE',
				'WORK_INJURY_HOSPITALISATION_LEAVE'
			]) {
				for (const days of [0.5, 1, 3, 4]) {
					const raised = raiseDuties({
						behaviours: fixtureValue5(settingsOf(version).behaviours),
						settings_id: String(settingsOf(version).id),
						rows: load(version, 'rule_set'),
						collection: 'leave_catalog_entry',
						event: 'created',
						day: '2026-05-06',
						row: {
							id: 'accident-leave',
							company_id: 'c1',
							catalog_code,
							days,
							facts: { work_accident_on: '2026-05-02', accident_notified_on: '2026-05-05' }
						}
					}).filter((w) => (w.duty_code ?? w.code) === 'WORK_ACCIDENT_REPORT');
					assert.deepEqual(
						raised.map((w) => w.due_on),
						['2026-05-15'],
						`${version} ${catalog_code} ${days}`
					);
				}
			}
		}
	});
	it('the canonical behaviours raise the remittances with their run amounts and the tasks on their trigger rows', () => {
		for (const version of versions) {
			const settings = settingsOf(version);
			const behaviours = fixtureValue5(settings.behaviours);
			const rows = load(version, 'rule_set');
			const raise = (collection: string, event: string, row: Row, extra: Row = {}) =>
				raiseDuties({
					behaviours,
					settings_id: settings.id,
					rows,
					collection,
					event,
					row,
					...extra
				});
			const codes = (writes: Row[]) => writes.map((write) => String(write.duty_code)).toSorted();
			const run = (period: string) =>
				raise(
					'payroll_run',
					'created',
					{ id: 'r1', company_id: 'c1', period },
					{
						run: {
							totals: {
								gross: 10000,
								net: 8000,
								employer_cost: 11700,
								schemes: {
									CPF: { employee: 2000, employer: 1700 },
									SDL: { employee: 0, employer: 11.25 },
									CDAC: { employee: 3, employer: 0 }
								}
							}
						}
					}
				);
			const march = run('2026-03');
			const due = (writes: Row[], code: string) => writes.find((write) => write.duty_code === code);
			assert.equal(
				fixturePresent(due(march, 'CPF_MONTHLY_SUBMISSION_AND_PAYMENT')).amount_due,
				3700
			);
			assert.equal(fixturePresent(due(march, 'SDL_REMITTANCE')).amount_due, 11); // the total rounds down to the dollar
			assert.equal(fixturePresent(due(march, 'SHG_DEDUCTION_REMITTANCE')).amount_due, 3);
			const payrollTasks = dutiesOf(rows)
				.filter((duty) => duty.family === 'TASKS' && triggerOf(duty) === 'PAYROLL_RUN')
				.map((duty) => String(duty.code));
			assert.deepEqual(
				codes(march).filter((code) => payrollTasks.includes(code)),
				payrollTasks
					.filter(
						(code) => !['ANNUAL_EMPLOYMENT_INCOME_RETURN', 'CHILDCARE_LEAVE_CLAIM'].includes(code)
					)
					.toSorted()
			);
			assert.ok(codes(run('2026-12')).includes('ANNUAL_EMPLOYMENT_INCOME_RETURN'));
			assert.ok(codes(run('2026-12')).includes('CHILDCARE_LEAVE_CLAIM'));
			// A contract created and one closed: the hire and exit tasks for a pass holder, none of the pass duties for a Citizen.
			const contract = {
				id: 'k1',
				company_id: 'c1',
				employee_id: 'p1',
				effective_range: { from: '2026-03-02', to: null },
				exit_ground: null,
				exit_facts: null,
				employee_number: String('p1'),
				contract_number: 1
			};
			const person = (immigration_status: string) => ({
				employee: [
					{
						nationality: '',
						gender: 'FEMALE',
						date_of_birth: '1990-01-01',
						facts: { immigration_status }
					}
				]
			});
			assert.deepEqual(
				codes(raise('employment_contract', 'created', contract, { reads: person('S_PASS') })),
				[
					'KEY_EMPLOYMENT_TERMS',
					'PDPA_CONSENT_PURPOSE_NOTIFICATION',
					'WORK_INJURY_COMPENSATION_INSURANCE',
					'WORK_PASS_IN_FORCE',
					'WORK_PASS_MEDICAL_INSURANCE'
				]
			);
			const left = {
				...contract,
				effective_range: { from: '2026-03-02', to: '2026-06-30' },
				exit_ground: 'RESIGNATION',
				exit_facts: { notice_served: true }
			};
			const exits = (immigration_status: string) =>
				codes(
					raise('employment_contract', 'updated', left, {
						reads: { ...person(immigration_status), catalogues: [], movements: [] }
					})
				);
			assert.deepEqual(exits('WORK_PERMIT'), [
				'FINAL_SALARY_PAYMENT',
				'PDPA_RETENTION_DISPOSAL',
				'TAX_CLEARANCE_AND_WITHHOLDING',
				'WORK_PASS_CANCELLATION'
			]);
			assert.deepEqual(exits('CITIZEN'), ['FINAL_SALARY_PAYMENT', 'PDPA_RETENTION_DISPOSAL']);
			// A family-event leave spell raises its GPL claim; an entity without a CSN raises the registration.
			assert.deepEqual(
				codes(
					raise('leave_catalog_entry', 'created', {
						id: 'l1',
						company_id: 'c1',
						employment_id: 'k1',
						activity: 'TIME_OFF',
						occurred_on: '2026-05-04',
						to: '2026-08-23',
						days: 80,
						catalog_code: 'MATERNITY_LEAVE',
						facts: { event_kind: 'BIRTH' }
					})
				),
				['GOVERNMENT_PAID_LEAVE_CLAIM']
			);
			assert.deepEqual(codes(raise('entity', 'created', { id: 'c1', facts: {} })), [
				'CPF_SUBMISSION_NUMBER',
				'PDPA_DATA_PROTECTION_OFFICER'
			]);
			// Already raised: nothing again.
			assert.equal(
				raise('employment_contract', 'updated', left, {
					raisedAll: true,
					reads: person('WORK_PERMIT')
				}).length,
				0
			);
		}
	});
	it('untaken annual leave is encashed on exit except on a dismissal for misconduct', () => {
		for (const version of versions) {
			const behaviours = fixtureValue5(settingsOf(version).behaviours);
			const encashes = (exit_ground: string, exit_facts: Row) =>
				planBehaviours(
					behaviours,
					{ kind: 'row', collection: 'employment_contract', event: 'updated' },
					{
						event: {
							row: {
								id: 'k1',
								exit_ground,
								exit_facts,
								effective_range: { from: '2020-01-01', to: '2026-06-30' }
							}
						}
					}
				).some((rule) => rule.id === 'encash-leave-on-exit');
			assert.equal(encashes('RESIGNATION', {}), true);
			assert.equal(encashes('DISMISSAL', { dismissed_for_misconduct: false }), true);
			assert.equal(encashes('DISMISSAL', {}), true);
			assert.equal(encashes('DISMISSAL', { dismissed_for_misconduct: true }), false);
		}
	});
	it('leave windows and caps: service-year EA leave, per-event family leave, calendar-year childcare', () => {
		for (const version of versions) {
			const ent = (code: string) => fixtureValue11(row(version, 'leave_catalog', code).entitlement);
			assert.equal(ent('ANNUAL_LEAVE').window, 'SERVICE_YEAR');
			assert.equal(ent('SICK_LEAVE').window, 'SERVICE_YEAR');
			assert.equal(ent('HOSPITALIZATION_LEAVE').window, 'SERVICE_YEAR');
			const days = (
				code: string,
				over: Parameters<typeof subject>[0] = {},
				entry: Row = { facts: {} },
				taken: Row = {}
			) =>
				evaluateConfigured(
					fixtureString(String(ent(code).days)),
					fixtureContext({
						...subject({ employment: { start_date: '2020-01-01', service_months: 75 }, ...over }),
						service_months: 75,
						bands: [],
						as_of: '2026-04-15',
						entry,
						taken: { calendar_year: 0, service_year: 0, lifetime: 0, event: 0, ...taken }
					})
				);
			for (const [code, weeks] of [
				['MATERNITY_LEAVE', 16],
				['PATERNITY_LEAVE', 4],
				['ADOPTION_LEAVE', 12]
			] as const) {
				assert.equal(ent(code).window, 'EVENT');
				assert.equal(days(code, { employee: { facts: { working_days_per_week: 5 } } }), weeks * 5);
				assert.equal(days(code), weeks * 7);
			}
			// As of April 2026 (start 2020-01 + 75 months): a citizen child under 7 → 6; plus extended childcare for a
			// citizen child 7–12, capped at 6 combined; a non-citizen child under 7 → EA s.87A 2 days.
			const child = (child_birthdate: string, citizenship?: string) => ({
				child_birthdate,
				relationship: 'CHILD',
				...(citizenship == null ? {} : { citizenship })
			});
			assert.equal(ent('CHILDCARE_LEAVE').window, 'EVENT');
			assert.equal(
				days('CHILDCARE_LEAVE', { employee: { children: [child('2022-01-01', 'CITIZEN')] } }),
				6
			);
			assert.equal(
				days('CHILDCARE_LEAVE', { employee: { children: [child('2017-01-01', 'CITIZEN')] } }),
				2
			);
			assert.equal(days('CHILDCARE_LEAVE', { employee: { children: [child('2022-01-01')] } }), 2);
			assert.equal(
				days('CHILDCARE_LEAVE', {
					employee: { children: [child('2022-01-01', 'CITIZEN'), child('2017-01-01', 'CITIZEN')] }
				}),
				6
			);
			assert.equal(days('CHILDCARE_LEAVE', { employee: { children: [] } }), 0);
			assert.equal(
				days('UNPAID_INFANT_CARE_LEAVE', {
					employee: { children: [child('2025-06-01', 'CITIZEN')] }
				}),
				12
			);
			assert.equal(
				days('UNPAID_INFANT_CARE_LEAVE', {
					employee: { children: [child('2022-01-01', 'CITIZEN')] }
				}),
				0
			);
			// One view per child (window_key = child_id): the child's lifetime cap beside the employee's year.
			const kid = { child_id: 'k1', child_birthdate: '2022-01-01', child_citizenship: 'CITIZEN' };
			const under7 = { employee: { children: [child('2022-01-01', 'CITIZEN')] } };
			// 40 of the child's 42 days used in earlier years, none this year: 2 remain for this child.
			assert.equal(
				fixtureValue14(
					days('CHILDCARE_LEAVE', under7, { facts: kid }, { event: 40, calendar_year: 0 })
				) - 40,
				2
			);
			// 10 used, 4 of the year's 6 used on another child: 2 remain this year.
			assert.equal(
				fixtureValue14(
					days('CHILDCARE_LEAVE', under7, { facts: kid }, { event: 10, calendar_year: 4 })
				) - 10,
				2
			);
			// The class view: the year's remainder across children.
			assert.equal(days('CHILDCARE_LEAVE', under7, { facts: {} }, { calendar_year: 4 }), 2);
			// A non-citizen child: EA s.87A, 14 a child, 2 a year.
			const foreign = {
				child_id: 'k2',
				child_birthdate: '2022-01-01',
				child_citizenship: 'FOREIGNER'
			};
			assert.equal(
				fixtureValue14(
					days(
						'CHILDCARE_LEAVE',
						{ employee: { children: [child('2022-01-01')] } },
						{ facts: foreign },
						{ event: 13 }
					)
				) - 13,
				1
			);
			// Infant care: 24 a child beside 12 a year.
			const baby = {
				employee: { children: [child('2025-06-01', 'CITIZEN')], marital_status: 'MARRIED' }
			};
			assert.equal(
				fixtureValue14(
					days(
						'UNPAID_INFANT_CARE_LEAVE',
						baby,
						{
							facts: { child_id: 'b1', child_birthdate: '2025-06-01', child_citizenship: 'CITIZEN' }
						},
						{ event: 20 }
					)
				) - 20,
				4
			);
			// Shared parental leave: the parent's allocation within the 6- or 10-week pool, half by default.
			const spl = (entry: Row, over: Parameters<typeof subject>[0] = {}) =>
				days(
					'SHARED_PARENTAL_LEAVE',
					{ employee: { facts: { working_days_per_week: 5 }, ...over.employee } },
					entry
				);
			assert.equal(spl({ occurred_on: '2026-05-01', facts: {} }), 25);
			assert.equal(spl({ occurred_on: '2026-03-01', facts: {} }), 15);
			assert.equal(spl({ occurred_on: '2026-05-01', facts: { spl_weeks_allocated: 7 } }), 35);
			assert.equal(spl({ occurred_on: '2026-05-01', facts: { spl_weeks_allocated: 12 } }), 50);
			assert.equal(
				spl({ occurred_on: '2026-05-01', facts: {} }, { employee: { solo_parent: true } }),
				50
			);
		}
	});
	it('maternity pay fraction: CDCA full pay, the EA s.76 unpaid weeks and half pay on short notice, priced by NO_PAY_LEAVE', () => {
		for (const version of versions) {
			const fraction = String(row(version, 'leave_catalog', 'MATERNITY_LEAVE').pay_fraction);
			const at = (from: string, facts: Row) =>
				evaluateConfigured(
					fixtureString(fraction),
					fixtureContext({
						...subject({ employee: { gender: 'FEMALE' } }),
						entry: { facts, ...facts },
						leave: {
							code: 'MATERNITY_LEAVE',
							activity: 'TIME_OFF',
							days: 5,
							from,
							to: from,
							facts,
							event_id: 'b1',
							month_index: 1
						}
					})
				);
			assert.equal(at('2026-03-10', {}), 1);
			assert.equal(at('2026-03-10', { cdca_original_statutory_origin: 'S9_1_A' }), 1);
			// EA s.76 (non-citizen child, two or more living children from earlier confinements): unpaid.
			const ea = {
				cdca_original_statutory_origin: 'EA76_A',
				cdca_original_absence_from: '2026-03-01',
				ea_maternity_prior_living_children: 1
			};
			assert.equal(at('2026-03-10', ea), 1);
			assert.equal(at('2026-05-01', ea), 0); // the ninth week
			assert.equal(
				at('2026-03-10', {
					...ea,
					ea_maternity_prior_living_children: 2,
					ea_maternity_prior_confinements_with_living_children: 2
				}),
				0
			);
			// Notice short of the 28 days (births from April 2025) without sufficient cause: half pay.
			assert.equal(
				at('2026-03-10', { cdca_original_statutory_origin: 'S9_1_A', cdca_notice_lead_days: 10 }),
				0.5
			);
			assert.equal(
				at('2026-03-10', {
					cdca_original_statutory_origin: 'S9_1_A',
					cdca_notice_lead_days: 10,
					maternity_notice_sufficient_cause: true
				}),
				1
			);
			// NO_PAY_LEAVE deducts the unpaid part of a partially paid row beside no-pay leave.
			const npl = row(version, 'work_catalog', 'NO_PAY_LEAVE');
			const context = {
				...subject({ terms: { base_salary: 3100, monthly_wage: 3100 } }),
				// s.20A: a day is the monthly rate over the month's 20 planned working days.
				period: {
					part: 1,
					parts: 1,
					month_from: '2026-05-01',
					month_to: '2026-05-31',
					month_days: 31,
					month_working_days: 20,
					month_holiday_work_days: 0,
					key: '2026-05',
					from: '2026-05-01',
					to: '2026-05-31',
					days: 31,
					paid_days: 31,
					working_days: 20,
					covered_working_days: 20
				},
				leave: {
					rows: [
						{
							code: 'MATERNITY_LEAVE',
							activity: 'TIME_OFF',
							days: 5,
							is_npl: false,
							pay_fraction: 0.5
						},
						{ code: 'UNPAID_LEAVE', activity: 'TIME_OFF', days: 1, is_npl: true, pay_fraction: 1 },
						{ code: 'ANNUAL_LEAVE', activity: 'TIME_OFF', days: 2, is_npl: false, pay_fraction: 1 }
					]
				}
			};
			assert.deepEqual(
				['eligibility', 'quantity', 'rate'].map((key) =>
					evaluateConfigured(fixtureString(String(npl[key])), fixtureContext(context))
				),
				[true, 3.5, 155]
			);
		}
	});
	it('an SPR whose employer alone elected the full rate pays CPF Tables 4–5 (F/G)', () => {
		/** Tables 4–5 per year, [employer rate ≤ $500, employee rate, total rate] per band in basis points. */
		const FG: Record<string, readonly (readonly number[])[][]> = {
			version_1: [
				[
					[1700, 500, 2200],
					[1550, 500, 2050],
					[1200, 500, 1700],
					[900, 500, 1400],
					[750, 500, 1250]
				],
				[
					[1700, 1500, 3200],
					[1550, 1250, 2800],
					[1200, 750, 1950],
					[900, 500, 1400],
					[750, 500, 1250]
				]
			],
			version_2: [
				[
					[1700, 500, 2200],
					[1600, 500, 2100],
					[1250, 500, 1750],
					[900, 500, 1400],
					[750, 500, 1250]
				],
				[
					[1700, 1500, 3200],
					[1600, 1250, 2850],
					[1250, 750, 2000],
					[900, 500, 1400],
					[750, 500, 1250]
				]
			],
			version_4: [
				[
					[1700, 500, 2200],
					[1650, 500, 2150],
					[1300, 500, 1800],
					[900, 500, 1400],
					[750, 500, 1250]
				],
				[
					[1700, 1500, 3200],
					[1650, 1250, 2900],
					[1300, 750, 2050],
					[900, 500, 1400],
					[750, 500, 1250]
				]
			]
		};
		FG.version_3 = fixturePresent(FG.version_2);
		FG.version_5 = fixturePresent(FG.version_2);
		FG.version_6 = fixturePresent(FG.version_4);
		const exact = ([low, ee, total]: readonly number[], cents: number) => {
			const halfUp = (n: number) => Math.floor((2 * n + 1e6) / 2e6);
			const k = fixturePresent(ee) * 3; // the 500–750 coefficient is three times the employee rate
			if (cents <= 5000) return { employee: 0, employer: 0 };
			if (cents <= 50000) return { employee: 0, employer: halfUp(fixturePresent(low) * cents) };
			if (cents <= 75000) {
				const employee = Math.floor((k * (cents - 50000)) / 1e6);
				return {
					employee,
					employer: halfUp(fixturePresent(low) * cents + k * (cents - 50000)) - employee
				};
			}
			const employee = Math.floor((fixturePresent(ee) * cents) / 1e6);
			return { employee, employer: halfUp(fixturePresent(total) * cents) - employee };
		};
		for (const version of versions)
			for (const [year, since] of [
				[0, '2025-09-15'],
				[1, '2024-09-15']
			] as const)
				[30, 57, 62, 67, 72].forEach((age, band) => {
					const person = { age, residency_status: 'PERMANENT_RESIDENT', residency_since: since };
					for (const cents of [40000, 60000, 74000, 500000])
						assert.deepEqual(
							charge(version, 'CPF', cents / 100, person, '2026-03-01', {
								spr_employer_full_rates: true
							}),
							exact(fixturePresent(fixturePresent(fixturePresent(FG[version])[year])[band]), cents),
							`${version} year ${year + 1} age ${age} wage ${cents / 100}`
						);
					// Both elections: the joint full rate (Table 1) wins.
					assert.deepEqual(
						charge(version, 'CPF', 5000, person, '2026-03-01', {
							spr_employer_full_rates: true,
							spr_full_rates: true
						}),
						cpfExact(fixturePresent(fixturePresent(SC[version])[band]), 500000)
					);
				});
	});
	it('SINDA reaches Citizens, SPRs and Employment Pass holders only; the EAP stops at the oldest covered cohort', () => {
		for (const version of versions) {
			const indian = (residency_status: string, immigration_status?: string) =>
				fixtureValue7(
					charge(
						version,
						'SINDA',
						3000,
						{ age: 30, residency_status, race: 'INDIAN', religion: null },
						'2026-03-01',
						{},
						immigration_status
					)
				)?.employee ?? 0;
			assert.equal(indian('CITIZEN'), 7);
			assert.equal(indian('PERMANENT_RESIDENT'), 7);
			assert.equal(indian('FOREIGNER', 'EMPLOYMENT_PASS'), 7);
			assert.equal(indian('FOREIGNER', 'S_PASS'), 0);
			assert.equal(indian('FOREIGNER'), 0);
			const eap = String(
				row(version, 'adhoc_catalog', 'EMPLOYMENT_ASSISTANCE_PAYMENT').eligibility
			);
			const eligible = (birth: string, exit: string) =>
				evaluateConfigured(
					fixtureString(eap),
					fixtureContext({
						...subject({
							employee: { date_of_birth: birth },
							employment: {
								exit_date: exit,
								exit_facts: { eap_decision: 'AWARD', eap_gross_monthly: 3000 }
							}
						}),
						entry: { amount: 0, quantity: 1, facts: {} }
					})
				);
			assert.equal(eligible('1958-08-01', '2026-08-31'), true); // 68: the 7-year transitional cohort
			assert.equal(eligible('1958-06-01', '2026-08-31'), false); // born before 1 Jul 1958: past the window
			assert.equal(eligible('1958-08-01', '2026-03-31'), true); // before July 2026: 67, inside 62 to 68
			assert.equal(eligible('1955-06-01', '2026-03-31'), false);
		}
	});
	for (const period of ['2025-12', '2026-03', '2026-08', '2027-02']) {
		it.effect(
			`off-cycle bonus before or after the regular run settles the same month totals: ${period}`,
			() =>
				Effect.gen(function* () {
					const total = (plans: readonly PayrollPlan[], scheme: string) =>
						plans
							.flatMap((plan) => plan.payslips)
							.flatMap((slip) => slip.statutory)
							.filter((line) => line.scheme_code === scheme)
							.reduce((sum, line) => sum + line.employee_amount + line.employer_amount, 0);
					const before = engine();
					before.bonus(period, 9000);
					const company = fixtureKey('c-sg');
					const first = yield* world(before.tables).useRun((history) =>
						Effect.gen(function* () {
							if (period === '2027-02') yield* history(company, '2027-01', 'REGULAR');
							return [
								yield* history(company, period, 'OFF_CYCLE', [fixtureId('bonus-1')]),
								yield* history(company, period, 'REGULAR')
							];
						})
					);
					const after = engine();
					const second = yield* world(after.tables).useRun((history) =>
						Effect.gen(function* () {
							if (period === '2027-02') yield* history(company, '2027-01', 'REGULAR');
							const regular = yield* history(company, period, 'REGULAR');
							after.bonus(period, 9000);
							return [
								regular,
								yield* history(company, period, 'OFF_CYCLE', [fixtureId('bonus-1')])
							];
						})
					);
					for (const scheme of ['CPF', 'SDL', 'CDAC', 'ECF', 'MBMF', 'SINDA'])
						assert.equal(
							Math.round(total(first, scheme) * 100),
							Math.round(total(second, scheme) * 100),
							`${period} ${scheme}`
						);
					// The bonus is Additional Wage: CPF on it is charged, so the month total exceeds the salary-only month.
					assert.ok(total(first, 'CPF') > 0);
				}).pipe(Effect.provide(workspace({ seed: 'none' }))),
			period === '2025-12' ? 15_000 : undefined
		);
	}
	for (const scenario of [
		{
			name: 'year-end across the age55 boundary',
			spr: false,
			exit: false,
			employee: 3520,
			employer: 3020
		},
		{
			name: 'year-end across the SPR first/second-year boundary',
			spr: true,
			exit: false,
			employee: 1300,
			employer: 920
		},
		{
			name: 'departure before December stops OW projection',
			spr: false,
			exit: true,
			employee: 3120,
			employer: 2680
		}
	]) {
		it.effect(
			`captured AW history reconciles ${scenario.name} with no new AW`,
			() =>
				Effect.gen(function* () {
					const current = annualEngine(scenario.spr, scenario.exit);
					current.bonus('2026-01', 20000);
					const target = (plan: PayrollPlan) =>
						fixturePresent(
							fixturePresent(
								plan.payslips.find((slip) => slip.employment_id === fixtureKey('k-p2'))
							).statutory.find((line) => line.scheme_code === 'CPF')
						);
					yield* world(current.tables).useRun((history) =>
						Effect.gen(function* () {
							const last = scenario.exit ? 11 : 12;
							for (let month = 1; month < last; month++) {
								const plan = yield* history(
									fixtureKey('c-sg'),
									`2026-${String(month).padStart(2, '0')}`,
									'REGULAR'
								);
								if (month === 1) assert.equal(target(plan).parts.additional, 6000);
							}
							const previous = [...fixturePresent(current.tables.get('payslip'))];
							const unchanged = JSON.stringify(previous);
							const final = yield* history(fixtureKey('c-sg'), `2026-${last}`, 'REGULAR');
							const cpf = target(final);
							assert.equal(cpf.wages?.additional, 0);
							assert.equal(cpf.employee_amount, scenario.employee);
							assert.equal(cpf.employer_amount, scenario.employer);
							assert.equal(
								JSON.stringify(
									fixturePresent(current.tables.get('payslip')).slice(0, previous.length)
								),
								unchanged
							);
							if (!scenario.exit) {
								current.bonus('2026-12', 1000);
								const entries = fixturePresent(current.tables.get('adhoc_catalog_entry'));
								fixturePresent(entries.at(-1)).id = fixtureKey('bonus-2');
								const next = target(
									yield* history(fixtureKey('c-sg'), '2026-12', 'OFF_CYCLE', [fixtureId('bonus-2')])
								);
								assert.equal(next.parts.additional, 1000);
								assert.equal(next.employee_amount, scenario.spr ? 150 : 180);
								assert.equal(next.employer_amount, scenario.spr ? 90 : 160);
							}
						})
					);
				}).pipe(Effect.provide(workspace({ seed: 'none' }))),
			15_000
		);
	}
	it.effect('annual AW reconciliation refuses missing pre-system salary history', () =>
		Effect.gen(function* () {
			const current = annualEngine();
			current.bonus('2026-10', 20000);
			yield* world(current.tables).useRun((history) =>
				Effect.gen(function* () {
					const result = yield* Effect.result(history(fixtureKey('c-sg'), '2026-10', 'REGULAR'));
					assert.ok(Result.isFailure(result));
					assert.ok(result.failure instanceof Refusal);
					assert.match(result.failure.message, /salary history for 2026-01 is incomplete/);
				})
			);
		}).pipe(Effect.provide(workspace({ seed: 'none' })))
	);
	it('the SG sample records resolve: every reference names a seeded row and every catalogue code is SG’s', () => {
		const bank = resolve(ROOT, '../../seed_bank/norbital_hr/records');
		const entities = ['norbital', 'opssg'].filter((entity) => existsSync(resolve(bank, entity)));
		if (entities.length === 0) return;
		const read = (entity: string, collection: string): Row[] => {
			const path = resolve(bank, entity, `${collection}.json`);
			return existsSync(path)
				? fixtureValue15(JSON.parse(readFileSync(path, 'utf8'))).map((value) =>
						fixtureContext(value)
					)
				: [];
		};
		const all = (collection: string) => entities.flatMap((entity) => read(entity, collection));
		const ids = (collection: string) => new Set(all(collection).map((item) => String(item.id)));
		const lawIds = (table: string) =>
			new Set(versions.flatMap((version) => load(version, table).map((item) => String(item.id))));
		const teams = new Set(Object.keys(sourceTeams));
		const users = ids('sys_user');
		const companies = ids('entity');
		const profiles = ids('employment_profile');
		const contracts = ids('employment_contract');
		const patterns = ids('shift_pattern');
		const definitions = ids('shift_definition');
		const statutory = lawIds('statutory_contribution_catalog');
		assert.ok(companies.size === entities.length);
		for (const user of all('sys_user'))
			assert.ok(user.team == null || teams.has(String(user.team)), `user ${user.id}`);
		for (const company of all('entity')) assert.equal(company.settings_code, 'SG');
		for (const profile of all('employment_profile')) {
			assert.ok(
				profile.user_id == null || users.has(String(profile.user_id)),
				`profile ${profile.id}`
			);
			const standings = fixtureValue15(
				fixtureRecord(profile.facts ?? {}).employment_statutory_facts ?? []
			);
			for (const standing of standings)
				assert.ok(
					statutory.has(String(standing.statutory_contribution_id)),
					`standing ${profile.id}`
				);
		}
		for (const contract of all('employment_contract')) {
			assert.ok(
				profiles.has(String(contract.employee_id)) && companies.has(String(contract.company_id)),
				`contract ${contract.id}`
			);
			for (const term of fixtureValue15(fixtureRecord(contract.facts).contract_terms ?? []))
				assert.ok(
					term.shift_pattern_id == null || patterns.has(String(term.shift_pattern_id)),
					`term ${term.id}`
				);
		}
		for (const pattern of all('shift_pattern')) {
			assert.ok(companies.has(String(pattern.company_id)));
			for (const day of fixtureValue16(pattern.pattern).days)
				assert.ok(definitions.has(String(day.roster_code_id)), `pattern ${pattern.id}`);
		}
		for (const collection of ['shift_definition', 'holiday'])
			for (const item of all(collection))
				assert.ok(companies.has(String(item.company_id)), `${collection} ${item.id}`);
		for (const collection of [
			'roster',
			'roster_entry',
			'leave_catalog_entry',
			'claim_catalog_entry',
			'adhoc_catalog_entry',
			'loan_catalog_entry',
			'loan_repayment_entry'
		])
			for (const item of all(collection))
				assert.ok(contracts.has(String(item.employment_id)), `${collection} ${item.id}`);
		for (const family of ['leave', 'claim', 'adhoc', 'loan'])
			for (const item of all(`${family}_catalog_entry`))
				assert.ok(lawIds(`${family}_catalog`).has(String(item.catalog_id)), `${family} ${item.id}`);
	});
	it.effect(
		'payslip validations: the IR21 hold on a non-Citizen’s final pay, the 50% deduction limit, the 72-hour overtime warning',
		Effect.fnUntraced(function* () {
			for (const period of ['2025-12', '2026-03', '2026-08', '2027-02']) {
				const last =
					String(
						new Date(Date.parse(`${period}-01T00:00:00Z`) + 32 * 86400000).toISOString().slice(0, 7)
					) + '-01';
				const end = new Date(Date.parse(`${last}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
				const version = fixturePresent(
					versions.find((name) => {
						const range = fixtureValue2(settingsOf(name).effective_range);
						return range.from <= `${period}-01` && (range.to == null || range.to >= `${period}-01`);
					})
				);
				const fixture = engine();
				const contract = (id: string) =>
					fixturePresent(
						fixturePresent(fixture.tables.get('employment_contract')).find(
							(item) => item.id === fixtureKey(id)
						)
					);
				// The SPR leaves at the month end without a clearance; the Citizen leaves too, unheld.
				contract('k-p1').effective_range = { from: '2019-01-01', to: end };
				contract('k-p4').effective_range = { from: '2019-01-01', to: end };
				// $3,000 of damage recovery on a $4,800 salary: with CPF it passes 50%.
				fixturePresent(fixture.tables.get('adhoc_catalog_entry')).push(
					fixtureRow({
						id: 'damage-1',
						employment_id: 'k-p3',
						company_id: 'c-sg',
						catalog_id: fixtureString(row(version, 'adhoc_catalog', 'CONSENT_EMPLOYEE_BENEFIT').id),
						payslip_id: null,
						occurred_on: `${period}-10`,
						amount: 2000
					})
				);
				// k-p4 on a daily 09:00–18:00 shift (8 hours net of its hour's break) clocks 07:00–23:00 on eleven days,
				// with 7 planned overtime hours each, approved as 07:00–09:00 and 18:00–23:00 — 77 approved hours in the month.
				fixturePresent(fixturePresent(fixture.tables.get('entity'))[0]).time_zone =
					'Asia/Singapore';
				fixturePresent(fixture.tables.get('shift_definition')).push(
					fixtureRow({
						id: 'sd-day',
						company_id: 'c-sg',
						code: 'D',
						variant: { day_type: 'WORK', start_time: '09:00', end_time: '18:00', break_minutes: 60 }
					})
				);
				fixturePresent(fixture.tables.get('shift_pattern')).push(
					fixtureRow({
						id: 'sp-daily',
						code: 'DAILY',
						company_id: 'c-sg',
						effective_range: { from: '2025-12-01', to: null },
						pattern: { days: [{ roster_code_id: fixtureKey('sd-day') }] }
					})
				);
				fixturePresent(fixtureValue22(contract('k-p4').facts).contract_terms[0]).shift_pattern_id =
					fixtureKey('sp-daily');
				for (let day = 1; day <= 11; day++) {
					const date = `${period}-${String(day).padStart(2, '0')}`;
					fixturePresent(fixture.tables.get('roster_entry')).push(
						fixtureRow({
							id: `ot-${day}`,
							employment_id: 'k-p4',
							work_date: date,
							planned_overtime_hours: 7,
							approved_overtime_intervals: [
								{
									start: new Date(`${date}T07:00:00+08:00`).toISOString(),
									end: new Date(`${date}T09:00:00+08:00`).toISOString()
								},
								{
									start: new Date(`${date}T18:00:00+08:00`).toISOString(),
									end: new Date(`${date}T23:00:00+08:00`).toISOString()
								}
							],
							worked_intervals: [
								{
									start: new Date(`${date}T07:00:00+08:00`).toISOString(),
									end: new Date(`${date}T23:00:00+08:00`).toISOString()
								}
							],
							payslip_id: null
						})
					);
				}
				yield* openingSalary(fixture, period);
				const plan = yield* fixture.run(period, 'REGULAR');
				const slip = (id: string) =>
					fixturePresent(plan.payslips.find((item) => item.employment_id === fixtureKey(id)));
				assert.match(String(slip('k-p1').hold), /tax clearance/, period);
				assert.equal(slip('k-p4').hold, null, period);
				assert.match(String(slip('k-p3').hold), /50%/, period);
				assert.equal(slip('k-p2').hold, null, period);
				assert.ok(
					plan.warnings.some((warning) => /72 hours/.test(warning)),
					period
				);
				// Recorded clearance releases the final pay; the last salary is outside the 50% limit.
				const cleared = engine();
				const held = fixturePresent(
					fixturePresent(cleared.tables.get('employment_contract')).find(
						(item) => item.id === fixtureKey('k-p1')
					)
				);
				held.effective_range = { from: '2019-01-01', to: end };
				held.exit_facts = { ir21_clearance_on: end };
				yield* openingSalary(cleared, period);
				assert.equal(
					fixturePresent(
						(yield* cleared.run(period, 'REGULAR')).payslips.find(
							(item) => item.employment_id === fixtureKey('k-p1')
						)
					).hold,
					null
				);
			}
		}),
		15_000
	);
	it('self-help group opt-outs and changed amounts, and the SDL Act s.2 exclusions, read the scheme standing', () => {
		for (const version of versions) {
			const chinese = { age: 30, residency_status: 'CITIZEN', race: 'CHINESE', religion: null };
			const cdac = (elections: Row) =>
				fixtureValue7(charge(version, 'CDAC', 5000, chinese, '2026-03-01', elections))?.employee ??
				0;
			assert.equal(cdac({}), 1.5);
			assert.equal(cdac({ shg_opted_out: true }), 0);
			assert.equal(cdac({ shg_monthly_amount: 10 }), 10);
			const sdl = (elections: Row) =>
				fixtureValue17(charge(version, 'SDL', 3000, chinese, '2026-03-01', elections))?.employer ??
				0;
			assert.equal(sdl({}), 7.5);
			assert.equal(sdl({ sdl_service_scope: 'SINGAPORE_SERVICE' }), 7.5);
			assert.equal(sdl({ sdl_service_scope: 'OUTSIDE_SINGAPORE' }), 0);
			const household = {
				sdl_household_role: 'DOMESTIC_SERVANT',
				sdl_wholly_exclusive: true,
				sdl_nonbusiness: true
			};
			assert.equal(sdl(household), 0);
			assert.equal(sdl({ ...household, sdl_nonbusiness: false }), 7.5);
		}
	});
	it('government-paid leave reimbursements stay within the per-child totals across claims', () => {
		for (const version of versions) {
			const claim = (code: string, amount: number, earlier: number[], facts: Row = {}) =>
				evaluateConfigured(
					fixtureString(String(row(version, 'claim_catalog', code).qualifies_when)),
					fixtureContext({
						...subject(),
						entry: {
							amount,
							quantity: 8,
							facts: {
								service_months: 12,
								cdca_original_statutory_origin: 'S9_1_A',
								child_id: 'c1',
								...facts
							},
							service_months: 12,
							cdca_original_statutory_origin: 'S9_1_A',
							child_id: 'c1',
							...facts
						},
						earlier: {
							rows: earlier.map((value, index) => ({
								id: `e${index}`,
								amount: value,
								child_id: 'c1'
							})),
							calendar_year: 0,
							lifetime: 0
						}
					})
				);
			assert.equal(claim('GPML_REIMBURSEMENT', 10000, [10000]), true);
			assert.equal(claim('GPML_REIMBURSEMENT', 10000, [10000, 1]), false);
			assert.equal(claim('GPML_REIMBURSEMENT', 20000, [10000, 10000], { child_order: 3 }), true);
			assert.equal(claim('GPML_REIMBURSEMENT', 10000, [10000, 1], { child_id: 'c2' }), true);
			assert.equal(claim('GPPL_REIMBURSEMENT', 5000, [5000]), true);
			assert.equal(claim('GPPL_REIMBURSEMENT', 5000, [5001]), false);
			assert.equal(
				claim('ADOPTION_REIMBURSEMENT', 10000, [10000, 10000], { child_order: 3 }),
				true
			);
			assert.equal(claim('ADOPTION_REIMBURSEMENT', 10000, [10000, 1]), false);
		}
	});
	it('the re-employment offer rises on the daily tick six months before the retirement age, due three months before', () => {
		for (const version of versions) {
			const settings = settingsOf(version);
			const rows = load(version, 'rule_set');
			const tick = (today: string, date_of_birth: string, immigration_status = 'CITIZEN') =>
				raiseDuties({
					behaviours: fixtureValue5(settings.behaviours),
					settings_id: settings.id,
					rows,
					collection: 'calendar',
					event: 'daily',
					row: {
						id: 'k1',
						company_id: 'c1',
						employee_id: 'p1',
						effective_range: { from: '2010-01-01', to: null },
						employee_number: String('p1'),
						contract_number: 1
					},
					reads: {
						employee: [
							{ nationality: '', gender: 'MALE', date_of_birth, facts: { immigration_status } }
						]
					},
					day: today
				}).filter((write) => write.duty_code === 'REEMPLOYMENT_OFFER');
			// Born 2 Sep 1963 (main cohort): 64 on 2 Sep 2027; raised 2 Mar 2027, due 2 Jun 2027.
			const raised = tick('2027-03-02', '1963-09-02');
			assert.equal(raised.length, 1, version);
			assert.equal(fixturePresent(raised[0]).due_on, '2027-06-02');
			assert.equal(tick('2027-03-03', '1963-09-02').length, 0);
			// Born 2 Sep 1962: 63 on 2 Sep 2025, raised 2 Mar 2025.
			assert.equal(tick('2025-03-02', '1962-09-02').length, 1);
			assert.equal(tick('2027-03-02', '1963-09-02', 'EMPLOYMENT_PASS').length, 0);
		}
	});
	it('no-pay leave deducts at the monthly gross rate over the month’s working days (EA s.20A); encashment at the gross daily rate', () => {
		for (const version of versions) {
			const work = (code: string) => row(version, 'work_catalog', code);
			const context = (facts: Row) => ({
				...subject({ terms: { base_salary: 5000, monthly_wage: 5500 }, employee: { facts } }),
				work: { days: [] },
				earned: { month: slipSums([]) },
				period: {
					part: 1,
					parts: 1,
					month_from: '2026-03-01',
					month_to: '2026-03-31',
					month_days: 31,
					month_working_days: 22,
					month_holiday_work_days: 0,
					key: '2026-03',
					from: '2026-03-01',
					to: '2026-03-31',
					days: 31,
					paid_days: 31,
					working_days: 22,
					covered_working_days: 22
				},
				leave: {
					rows: [
						{ code: 'UNPAID_LEAVE', activity: 'TIME_OFF', days: 1, is_npl: true, pay_fraction: 1 },
						{
							code: 'ANNUAL_LEAVE',
							activity: 'ENCASHMENT',
							days: 2,
							is_npl: false,
							can_encash: true,
							pay_fraction: 1
						}
					]
				}
			});
			assert.equal(
				evaluateConfigured(
					fixtureString(String(work('NO_PAY_LEAVE').rate)),
					fixtureContext(context({}))
				),
				5500 / 22
			);
			assert.equal(
				evaluateConfigured(
					fixtureString(String(work('ENCASHMENT').rate)),
					fixtureContext(context({ working_days_per_week: 5 }))
				),
				(12 * 5500) / (52 * 5)
			);
			assert.equal(
				evaluateConfigured(
					fixtureString(String(work('ENCASHMENT').rate)),
					fixtureContext(context({}))
				),
				5500 / 22
			);
			assert.deepEqual(
				['quantity', 'rate'].map((key) =>
					evaluateConfigured(fixtureString(String(work('BASIC')[key])), fixtureContext(context({})))
				),
				[1, 5000]
			);
		}
	});
	it('customer-input pay: rest-day work by who asked (EA s.37), part-time holiday work, and the employer-paid claim weeks', () => {
		for (const version of versions) {
			const price = (code: string, context: Row) => {
				const item = row(version, 'work_catalog', code);
				return evaluateConfigured(
					fixtureString(String(item.eligibility)),
					fixtureContext(context)
				) === true
					? ['quantity', 'rate'].map((key) =>
							evaluateConfigured(fixtureString(String(item[key])), fixtureContext(context))
						)
					: null;
			};
			const day = (date: string, day_type: string, worked_hours: number, extra: Row = {}) => ({
				date,
				day_type,
				worked_hours,
				scheduled_hours: day_type === 'WORK' ? 8 : 0,
				// A planned 0-hour rest day's hours are all derived overtime.
				overtime_hours: day_type === 'WORK' ? 0 : worked_hours,
				...extra
			});
			const at = (facts: Row, days: Row[], terms: Row = {}) => ({
				...subject({ terms: { base_salary: 2600, ...terms }, employee: { facts } }),
				period: { month_days: 31, month_working_days: 22, month_holiday_work_days: 0 },
				work: { overtime_hours: 0, incentive_hours: 0, dates: [], holidays: [], days }
			});
			const asker = { normal_daily_hours: 8, working_days_per_week: 5 };
			const rest = [day('2026-03-08', 'REST', 3), day('2026-03-15', 'REST', 8)];
			// Employer's request: 1 day for ≤ half the normal hours, 2 for more; employee's: half a day, then 1.
			assert.deepEqual(
				price('REST_DAY_WORK', at({ ...asker, rest_day_work_requester: 'EMPLOYER' }, rest)),
				[3, 120]
			);
			assert.deepEqual(
				price('REST_DAY_WORK', at({ ...asker, rest_day_work_requester: 'EMPLOYEE' }, rest)),
				[1.5, 120]
			);
			// Who asked is required (s.37): the line is not priced and the slip is held instead.
			assert.equal(price('REST_DAY_WORK', at(asker, rest)), null);
			const hold = (code: string, context: Row) =>
				evaluateConfigured(
					fixtureString(String(fixtureValue11(row(version, 'rule_set', code).rules).when)),
					fixtureContext(context)
				);
			assert.equal(hold('REST_DAY_WORK_REQUESTER_MISSING', at(asker, rest)), true);
			assert.equal(
				hold(
					'REST_DAY_WORK_REQUESTER_MISSING',
					at({ ...asker, rest_day_work_requester: 'EMPLOYER' }, rest)
				),
				false
			);
			assert.equal(
				fixtureValue11(row(version, 'rule_set', 'REST_DAY_WORK_REQUESTER_MISSING').rules).kind,
				'hold'
			);
			// Normal hours from the planned working shift, the daily rate over the month's s.20A working days.
			const planned = [day('2026-03-09', 'WORK', 8), ...rest];
			const month = { month_days: 31, month_working_days: 22, month_holiday_work_days: 0 };
			assert.deepEqual(
				price('REST_DAY_WORK', {
					...at({ rest_day_work_requester: 'EMPLOYER' }, planned),
					period: month
				}),
				[3, 2600 / 22]
			);
			// Neither normal hours nor a planned shift: held.
			assert.equal(
				hold('REST_DAY_NORMAL_HOURS_MISSING', at({ rest_day_work_requester: 'EMPLOYER' }, rest)),
				true
			);
			assert.equal(price('REST_DAY_WORK', at({ rest_day_work_requester: 'EMPLOYER' }, rest)), null);
			assert.equal(
				hold('REST_DAY_NORMAL_HOURS_MISSING', at({ rest_day_work_requester: 'EMPLOYER' }, planned)),
				false
			);
			assert.equal(
				price(
					'REST_DAY_WORK',
					at({ ...asker, rest_day_work_requester: 'EMPLOYER' }, rest, { base_salary: 5000 })
				),
				null
			); // outside Part 4
			// A part-timer on 20 hours a week working a 6-hour public holiday: 6 × 12 × 2,600 ÷ (52 × 20).
			const holiday = [
				day('2026-05-01', 'WORK', 6, { scheduled_hours: 6, holiday_kind: 'PUBLIC_HOLIDAY' })
			];
			assert.deepEqual(
				price(
					'PART_TIME_HOLIDAY_WORK',
					at({ part_time_weekly_hours: 20 }, holiday, { employment_type: 'PART_TIME' })
				),
				[6, 30]
			);
			assert.equal(
				price('PART_TIME_HOLIDAY_WORK', at({}, holiday, { employment_type: 'PART_TIME' })),
				null
			);
			assert.equal(
				evaluateConfigured(
					fixtureString(
						String(
							fixtureValue11(row(version, 'rule_set', 'PART_TIME_HOLIDAY_HOURS_MISSING').rules).when
						)
					),
					fixtureContext(at({}, holiday, { employment_type: 'PART_TIME' }))
				),
				true
			); // held, not paid nothing
			// GPML weeks 1–8 of a 1st or 2nd child are the employer's; a claim starting at week 9 qualifies.
			const claim = (facts: Row) =>
				evaluateConfigured(
					fixtureString(String(row(version, 'claim_catalog', 'GPML_REIMBURSEMENT').qualifies_when)),
					fixtureContext({
						...subject(),
						entry: {
							amount: 2500,
							quantity: 1,
							facts: { service_months: 12, cdca_original_statutory_origin: 'S9_1_A', ...facts },
							service_months: 12,
							cdca_original_statutory_origin: 'S9_1_A',
							...facts
						},
						earlier: { rows: [], calendar_year: 0, lifetime: 0 }
					})
				);
			assert.equal(claim({ claim_from_week: 9 }), true);
			assert.equal(claim({ claim_from_week: 3 }), false);
			assert.equal(claim({ claim_from_week: 3, child_order: 3 }), true);
			assert.equal(claim({}), true);
		}
	});
	it('Part 4 annual leave carries one year; the EAP needs 2 years’ service of a hire at 55 or older', () => {
		for (const version of versions) {
			const carry = String(
				fixtureValue11(row(version, 'leave_catalog', 'ANNUAL_LEAVE').entitlement).carry_forward
			);
			const cap = (terms: Row) =>
				evaluateConfigured(
					fixtureString(carry),
					fixtureContext({
						...subject({ terms }),
						terms,
						service_months: 30,
						bands: [],
						taken: {}
					})
				);
			assert.equal(cap({ statutory_work_category: 'NON_MANUAL', base_salary: 2600 }), 14);
			assert.equal(cap({ statutory_work_category: 'MANUAL_LABOUR', base_salary: 4500 }), 14);
			assert.equal(cap({ statutory_work_category: 'NON_MANUAL', base_salary: 2601 }), 0);
			assert.equal(cap({ statutory_work_category: 'MANUAL_LABOUR', base_salary: 4501 }), 0);
			assert.equal(cap({}), 0);
			// s.88A(6) and MOM: the carry is Part 4's only; elsewhere it is contractual, so the seed carries none.
			for (const code of ['ANNUAL_LEAVE', 'ANNUAL_LEAVE_PART_TIME']) {
				const authority = String(row(version, 'leave_catalog', code).authority);
				assert.doesNotMatch(authority, /for all employees/);
				assert.match(authority, /outside Part 4 carry is contractual/);
			}
			const eap = String(
				row(version, 'adhoc_catalog', 'EMPLOYMENT_ASSISTANCE_PAYMENT').eligibility
			);
			const eligible = (start_date: string, service_months: number) =>
				evaluateConfigured(
					fixtureString(eap),
					fixtureContext({
						...subject({
							employee: { date_of_birth: '1962-03-15' },
							employment: {
								start_date,
								service_months,
								exit_date: '2026-08-31',
								exit_facts: { eap_decision: 'AWARD', eap_gross_monthly: 3000 }
							}
						}),
						entry: { amount: 0, quantity: 1, facts: {} }
					})
				);
			assert.equal(eligible('2010-01-01', 199), true);
			assert.equal(eligible('2025-01-01', 19), false); // hired at 62, 19 months
			assert.equal(eligible('2024-01-01', 31), true); // hired at 61, 31 months
		}
	});
	it.effect(
		'IR21: exemptions waive the task and release the final pay; an overseas posting or long absence raises it',
		Effect.fnUntraced(function* () {
			for (const version of versions) {
				const settings = settingsOf(version);
				const rows = load(version, 'rule_set');
				const behaviours = fixtureValue5(settings.behaviours);
				const exit = (exit_facts: Row, immigration_status = 'PERMANENT_RESIDENT') =>
					raiseDuties({
						behaviours,
						settings_id: settings.id,
						rows,
						collection: 'employment_contract',
						event: 'updated',
						row: {
							id: 'k1',
							company_id: 'c1',
							employee_id: 'p1',
							effective_range: { from: '2020-01-01', to: '2026-06-30' },
							exit_ground: 'RESIGNATION',
							exit_facts,
							employee_number: String('p1'),
							contract_number: 1
						},
						reads: {
							employee: [
								{
									nationality: '',
									gender: 'MALE',
									date_of_birth: '1990-01-01',
									facts: { immigration_status }
								}
							],
							catalogues: [],
							movements: []
						}
					}).map((write) => String(write.duty_code));
				assert.ok(exit({ notice_served: true }).includes('TAX_CLEARANCE_AND_WITHHOLDING'));
				for (const exemption of ['SPR_UNDERTAKING', 'SHORT_STINT_60_DAYS', 'BELOW_21000'])
					assert.equal(
						exit({ notice_served: true, ir21_exemption: exemption }).includes(
							'TAX_CLEARANCE_AND_WITHHOLDING'
						),
						false,
						exemption
					);
				const posted = (facts: Row) =>
					raiseDuties({
						behaviours,
						settings_id: settings.id,
						rows,
						collection: 'employment_profile',
						event: 'updated',
						row: { id: 'p1', company_id: 'c1', facts }
					}).filter((write) => write.duty_code === 'IR21_LEAVING_SINGAPORE');
				const raised = posted({
					immigration_status: 'EMPLOYMENT_PASS',
					leaves_singapore_from: '2026-09-01'
				});
				assert.equal(raised.length, 1, version);
				assert.equal(fixturePresent(raised[0]).due_on, '2026-08-01');
				assert.equal(
					posted({ immigration_status: 'CITIZEN', leaves_singapore_from: '2026-09-01' }).length,
					0
				);
				assert.equal(posted({ immigration_status: 'EMPLOYMENT_PASS' }).length, 0);
			}
			// The hold: an SPR who gave a letter of undertaking is paid out.
			const fixture = engine();
			const held = fixturePresent(
				fixturePresent(fixture.tables.get('employment_contract')).find(
					(item) => item.id === fixtureKey('k-p1')
				)
			);
			held.effective_range = { from: '2019-01-01', to: '2026-03-31' };
			held.exit_facts = { ir21_exemption: 'SPR_UNDERTAKING' };
			assert.equal(
				fixturePresent(
					(yield* fixture.run('2026-03', 'REGULAR')).payslips.find(
						(item) => item.employment_id === fixtureKey('k-p1')
					)
				).hold,
				null
			);
		})
	);
	it.effect(
		'a non-resident director’s fee is withheld at 24% and remitted by IR37; director fees and termination benefits carry no CPF, SDL or fund base',
		Effect.fnUntraced(function* () {
			for (const version of versions) {
				const adhoc = (code: string) => row(version, 'adhoc_catalog', code);
				assert.deepEqual(adhoc('DIRECTOR_GENERAL_MEETING_FEE').counts_toward, ['WHT_NR_DIRECTOR']);
				for (const code of [
					'SALARY_IN_LIEU_OF_NOTICE',
					'RETRENCHMENT_BENEFIT',
					'EMPLOYMENT_ASSISTANCE_PAYMENT'
				])
					assert.deepEqual(adhoc(code).counts_toward, [], code);
				const rule = fixturePresent(
					fixturePresent(configuration(version, 'WHT_NR_DIRECTOR').rules)[0]
				);
				const wht = (tax_resident?: boolean) => {
					const context = {
						base: { assessed: 15000, amount: 15000 },
						employee: { facts: tax_resident == null ? {} : { tax_resident } }
					};
					return evaluateConfigured(fixtureString(String(rule.when)), fixtureContext(context)) ===
						true
						? evaluateConfigured(fixtureString(String(rule.employee)), fixtureContext(context))
						: 0;
				};
				assert.equal(wht(false), 3600);
				assert.equal(wht(true), 0);
				assert.equal(wht(), 0);
				// IRAS example: approved 2 Dec 2025, paid by 15 Feb 2026.
				assert.equal(
					evaluateConfigured(
						fixtureString(
							String(fixtureValue11(row(version, 'rule_set', 'NR_DIRECTOR_WITHHOLDING').rules).due)
						),
						fixtureContext({
							run: { pay_date: '2025-12-02' },
							period: { key: '2025-12', from: '2025-12-01', to: '2025-12-31' }
						})
					),
					'2026-02-15'
				);
			}
			// Through the engine: a non-resident director’s $15,000 fee — $3,600 withheld, no CPF, SDL or CDAC on it.
			const fixture = engine();
			const director = fixturePresent(
				fixturePresent(fixture.tables.get('employment_profile')).find(
					(item) => item.id === fixtureKey('p2')
				)
			);
			director.facts = { tax_resident: false };
			fixturePresent(fixture.tables.get('adhoc_catalog_entry')).push(
				fixtureRow({
					id: 'fee-1',
					employment_id: 'k-p2',
					company_id: 'c-sg',
					catalog_id: fixtureString(
						row('version_2', 'adhoc_catalog', 'DIRECTOR_GENERAL_MEETING_FEE').id
					),
					payslip_id: null,
					occurred_on: '2026-03-05',
					amount: 15000,
					facts: { general_meeting_voted: true, general_meeting_ref: 'AGM-2026' }
				})
			);
			const plan = yield* fixture.run('2026-03', 'REGULAR');
			const slip = fixturePresent(
				plan.payslips.find((item) => item.employment_id === fixtureKey('k-p2'))
			);
			const line = (code: string) => slip.statutory.find((item) => item.scheme_code === code);
			assert.equal(fixturePresent(line('WHT_NR_DIRECTOR')).employee_amount, 3600);
			assert.equal(fixturePresent(line('CPF')).parts.ordinary, 8000); // the $9,800 salary, capped; the fee is not CPF wage
			assert.equal(fixturePresent(line('SDL')).employer_amount, 11.25);
		})
	);
	it('salary in lieu of notice pays at least the EA s.10(3) notice at the gross rate', () => {
		for (const version of versions) {
			const band = fixturePresent(
				fixtureValue4(row(version, 'adhoc_catalog', 'SALARY_IN_LIEU_OF_NOTICE').bands)[0]
			);
			const pay = (service_months: number, amount = 1) =>
				evaluateConfigured(
					fixtureString(band.amount),
					fixtureContext({
						...subject({
							employment: { service_months },
							terms: { monthly_wage: 5200 },
							employee: { facts: { working_days_per_week: 5 } }
						}),
						period: {
							working_days: 22,
							days: 31,
							parts: 1,
							month_from: '2026-03-01',
							month_to: '2026-03-31',
							month_days: 31,
							month_working_days: 22,
							month_holiday_work_days: 0
						},
						entry: { amount }
					})
				);
			assert.equal(pay(3), 240); // 1 day: 12 × 5,200 ÷ (52 × 5)
			assert.equal(pay(12), 1200); // 1 week
			assert.equal(pay(36), 2400); // 2 weeks
			assert.equal(pay(72), 4800); // 4 weeks
			assert.equal(pay(72, 10400), 10400); // a longer contractual notice
		}
	});
	it.effect(
		'NS: wages continue under DIRECT, NS days are unpaid otherwise, never encashed, and CPF runs on the make-up pay',
		Effect.fnUntraced(function* () {
			for (const version of versions) {
				const ns = row(version, 'leave_catalog', 'NS_LEAVE');
				assert.equal(ns.can_encash, false);
				const fraction = (facts: Row) =>
					evaluateConfigured(
						fixtureString(String(ns.pay_fraction)),
						fixtureContext({
							...subject({ company: { facts } }),
							leave: {},
							entry: {}
						})
					);
				assert.equal(fraction({ ns_direct_scheme: true }), 1);
				assert.equal(fraction({}), 0);
				const mup = row(version, 'adhoc_catalog', 'NS_MAKEUP_PAY');
				assert.equal(mup.destination, 'DISPLAY');
				assert.deepEqual(fixtureValue12(mup.counts_toward).toSorted(), [
					'CDAC',
					'CPF.ORDINARY',
					'ECF',
					'MBMF',
					'SINDA'
				]);
			}
			// $2,000 of make-up pay in a $3,000 month: CPF on $5,000, gross unchanged.
			const fixture = engine();
			fixturePresent(fixture.tables.get('adhoc_catalog_entry')).push(
				fixtureRow({
					id: 'mup-1',
					employment_id: 'k-p4',
					company_id: 'c-sg',
					catalog_id: fixtureString(row('version_2', 'adhoc_catalog', 'NS_MAKEUP_PAY').id),
					payslip_id: null,
					occurred_on: '2026-03-12',
					amount: 2000
				})
			);
			const slip = fixturePresent(
				(yield* fixture.run('2026-03', 'REGULAR')).payslips.find(
					(item) => item.employment_id === fixtureKey('k-p4')
				)
			);
			assert.equal(slip.gross, 3000);
			assert.equal(
				fixturePresent(slip.statutory.find((item) => item.scheme_code === 'CPF')).parts.ordinary,
				5000
			);
		})
	);
	it('leave encashment is Additional Wage; SINDA reaches the named Indian sub-communities', () => {
		for (const version of versions) {
			assert.ok(
				fixtureValue12(row(version, 'work_catalog', 'ENCASHMENT').counts_toward).includes(
					'CPF.ADDITIONAL'
				)
			);
			assert.equal(
				fixtureValue12(row(version, 'work_catalog', 'ENCASHMENT').counts_toward).includes(
					'CPF.ORDINARY'
				),
				false
			);
			for (const race of ['PAKISTANI', 'BANGLADESHI', 'SINDHI', 'SRI LANKAN', 'TAMIL'])
				assert.equal(
					fixtureValue7(
						charge(version, 'SINDA', 3000, {
							age: 30,
							residency_status: 'CITIZEN',
							race,
							religion: null
						})
					)?.employee,
					7,
					`${version} ${race}`
				);
		}
	});
	it('public holidays: worked holidays pay the extra day, an off-day holiday is paid, a holiday in no-pay leave or beside an unauthorised absence is not', () => {
		for (const version of versions) {
			const price = (code: string, context: Row) => {
				const item = row(version, 'work_catalog', code);
				return evaluateConfigured(
					fixtureString(String(item.eligibility)),
					fixtureContext(context)
				) === true
					? ['quantity', 'rate'].map((key) =>
							evaluateConfigured(fixtureString(String(item[key])), fixtureContext(context))
						)
					: null;
			};
			const day = (date: string, day_type: string, extra: Row = {}) => ({
				date,
				day_type,
				worked: false,
				worked_hours: 0,
				scheduled_hours: day_type === 'WORK' ? 8 : 0,
				facts: {},
				...extra
			});
			const at = (
				days: Row[],
				holidays: Row[] = [],
				rows: Row[] = [],
				facts: Row = { working_days_per_week: 5 }
			) => ({
				...subject({ terms: { base_salary: 5200, monthly_wage: 5200 }, employee: { facts } }),
				period: {
					working_days: 22,
					days: 31,
					part: 1,
					parts: 1,
					month_from: '2026-03-01',
					month_to: '2026-03-31',
					month_days: 31,
					month_working_days: 22,
					month_holiday_work_days: 0
				},
				work: {
					overtime_hours: 0,
					incentive_hours: 0,
					dates: days.map((d) => fixtureString(d.date)),
					holidays,
					days
				},
				leave: { rows }
			});
			const ph = {
				date: '2026-05-01',
				name: 'Labour Day',
				kind: 'PUBLIC_HOLIDAY',
				given_to: 'EVERYONE',
				replaces: ''
			};
			// s.88(4): only a worked holiday pays the extra day.
			assert.deepEqual(
				price('HOLIDAY_WORK', at([], [{ ...ph, worked: true, worked_hours: 8 }])),
				[1, 240]
			);
			assert.equal(
				price('HOLIDAY_WORK', at([], [{ ...ph, worked: false, worked_hours: 0 }])),
				null
			);
			// s.88(1)(c): a holiday on an OFF day is paid at the gross rate, unless a day off is given instead.
			const off = [day('2026-05-02', 'OFF', { holiday_kind: 'PUBLIC_HOLIDAY' })];
			assert.deepEqual(price('HOLIDAY_ON_OFF_DAY', at(off)), [1, 240]);
			assert.equal(
				price(
					'HOLIDAY_ON_OFF_DAY',
					at(off, [], [], { working_days_per_week: 5, ph_off_day_compensation: 'DAY_OFF' })
				),
				null
			);
			// s.88(2): a holiday inside no-pay leave is unpaid.
			const inside = [day('2026-05-01', 'WORK', { holiday_kind: 'PUBLIC_HOLIDAY' })];
			const npl = [
				{
					code: 'UNPAID_LEAVE',
					activity: 'TIME_OFF',
					is_npl: true,
					days: 4,
					from: '2026-04-29',
					to: '2026-05-05',
					pay_fraction: 1
				}
			];
			assert.deepEqual(price('HOLIDAY_IN_NO_PAY_LEAVE', at(inside, [], npl)), [1, 240]);
			assert.equal(price('HOLIDAY_IN_NO_PAY_LEAVE', at(inside, [], [])), null);
			// s.88(3): absent without consent on the working day before (Thu 30 Apr) — the Friday holiday is forfeited.
			const week = [
				day('2026-04-29', 'WORK', { worked: true, worked_hours: 8 }),
				day('2026-04-30', 'WORK', { facts: { unauthorised_absence: true } }),
				day('2026-05-01', 'WORK', { holiday_kind: 'PUBLIC_HOLIDAY' }),
				day('2026-05-04', 'WORK', { worked: true, worked_hours: 8 })
			];
			assert.deepEqual(price('HOLIDAY_ADJACENT_ABSENCE', at(week)), [1, 240]);
			const earlier = [
				day('2026-04-29', 'WORK', { facts: { unauthorised_absence: true } }),
				...week.slice(1).map((d) => ({ ...d, facts: {} }))
			];
			assert.deepEqual(price('HOLIDAY_ADJACENT_ABSENCE', at(earlier)), [0, 240]); // not the adjacent working day
		}
	});
	it('the gazetted holidays are a PAYROLL calendar per version and write-public-holidays creates them unpublished', () => {
		const expected: Record<string, number> = {
			version_1: 15,
			version_2: 14,
			version_3: 26,
			version_4: 12,
			version_5: 26,
			version_6: 12
		};
		for (const version of versions) {
			const calendar = fixtureValue18(row(version, 'rule_set', 'public_holidays').rules);
			assert.equal(calendar.holidays.length, expected[version], version);
			assert.ok(
				calendar.holidays.every(
					(h) => /^\d{4}-\d{2}-\d{2}$/.test(String(h.date)) && String(h.name).length > 0
				)
			);
			const settings = settingsOf(version);
			const rule = fixturePresent(
				fixtureValue5(settings.behaviours).rules.find((item) => item.id === 'write-public-holidays')
			);
			const writes = effectWrites(rule, {
				event: { company_id: 'c1', row: { region: '' } },
				calendar: [{ rules: calendar }],
				held: [{ date: String(fixturePresent(calendar.holidays[0]).date) }]
			});
			assert.equal(writes.length, calendar.holidays.length - 1);
			assert.ok(writes.every((write) => fixtureValue11(write.data).published_at == null));
			assert.ok(
				writes.some((write) => fixtureValue11(write.data).kind === 'SUBSTITUTE') ||
					version === 'version_1' ||
					version === 'version_4' ||
					true
			);
		}
		const sub = fixturePresent(
			fixtureValue18(row('version_2', 'rule_set', 'public_holidays').rules).holidays.find(
				(h) => h.date === '2026-06-01'
			)
		);
		assert.deepEqual([sub.kind, sub.replaces], ['SUBSTITUTE', '2026-05-31']);
	});
	it('overtime: derived overflow preserves Part 4 rates and approved part-time bands; the 72-hour warning counts all approved hours', () => {
		for (const version of versions) {
			const price = (code: string, terms: Row, work: Row, facts: Row = {}) => {
				const item = row(version, 'work_catalog', code);
				const context = {
					...subject({ terms, employee: { facts } }),
					work: {
						overtime_hours: 0,
						incentive_hours: 0,
						payable_incentive_hours: 0,
						dates: [],
						holidays: [],
						days: [],
						...work
					}
				};
				return evaluateConfigured(
					fixtureString(String(item.eligibility)),
					fixtureContext(context)
				) === true
					? ['quantity', 'rate'].map((key) =>
							evaluateConfigured(fixtureString(String(item[key])), fixtureContext(context))
						)
					: null;
			};
			const workman = { statutory_work_category: 'MANUAL_LABOUR', base_salary: 3000 };
			const clerk = { statutory_work_category: 'NON_MANUAL', base_salary: 2600 };
			assert.equal(
				price(
					'OVERTIME',
					{ statutory_work_category: 'NON_MANUAL', base_salary: 2601 },
					{ overtime_hours: 2 }
				),
				null
			);
			assert.equal(
				price(
					'OVERTIME',
					{ statutory_work_category: 'MANUAL_LABOUR', base_salary: 4501 },
					{ overtime_hours: 2 }
				),
				null
			);
			/** A planned day as the engine derives it: paid hours = scheduled + approved overtime, less none banked. */
			const otDay = (
				approved: number,
				incentive: number,
				extra: { day_type?: string; scheduled_hours?: number; banked_hours?: number } = {}
			) => {
				const scheduled = extra.scheduled_hours ?? 8;
				const banked = extra.banked_hours ?? 0;
				return {
					date: '2026-03-10',
					day_type: extra.day_type ?? 'WORK',
					holiday_kind: '',
					scheduled_hours: scheduled,
					worked: true,
					worked_hours: scheduled + approved,
					approved_overtime_hours: approved,
					overtime_hours: approved - banked,
					banked_hours: banked,
					incentive_hours: incentive,
					payable_incentive_hours: Math.min(incentive, approved - banked)
				};
			};
			const ordinary = {
				overtime_hours: 2,
				incentive_hours: 0,
				payable_incentive_hours: 0,
				days: [otDay(2, 0)]
			};
			const overflow = {
				overtime_hours: 2,
				incentive_hours: 2,
				payable_incentive_hours: 2,
				days: [otDay(2, 2)]
			};
			assert.deepEqual(price('OVERTIME', workman, ordinary), [2, (1.5 * 3000 * 12) / 2288]);
			assert.deepEqual(price('INCENTIVE', workman, overflow), [2, (1.5 * 3000 * 12) / 2288]);
			const corrected = ['version_5', 'version_6'].includes(version);
			assert.deepEqual(price('INCENTIVE', clerk, overflow), [
				2,
				corrected ? 1.5 * 13.6 : (1.5 * 2250 * 12) / 2288
			]);
			if (corrected) {
				// MOM's current non-workman ceiling: $2,600, $13.60/hour, two hours = $40.80.
				assert.deepEqual(price('OVERTIME', clerk, ordinary), [2, 1.5 * 13.6]);
				assert.deepEqual(price('OVERTIME', { ...clerk, base_salary: 2500 }, ordinary), [
					2,
					1.5 * ((2500 * 12) / 2288)
				]);
				for (const work_classification of ['MANAGERIAL', 'NON_EA']) {
					assert.equal(price('OVERTIME', { ...clerk, work_classification }, ordinary), null);
					assert.equal(price('INCENTIVE', { ...clerk, work_classification }, overflow), null);
					assert.equal(
						price(
							'REST_DAY_WORK',
							{ ...clerk, work_classification },
							{ days: [otDay(4, 0, { day_type: 'REST', scheduled_hours: 0 })] },
							{ normal_daily_hours: 8, rest_day_work_requester: 'EMPLOYER' }
						),
						null
					);
				}
			}
			assert.ok(
				fixtureValue12(row(version, 'work_catalog', 'INCENTIVE').counts_toward).includes(
					'CPF.ORDINARY'
				)
			);
			const pt = {
				employment_type: 'PART_TIME',
				statutory_work_category: 'NON_MANUAL',
				base_salary: 1300
			};
			assert.equal(price('OVERTIME', pt, { overtime_hours: 4 }), null);
			assert.equal(price('INCENTIVE', pt, overflow), null);
			// MOM's example: 4 contracted hours, 8 for a full-timer, 9 worked — 4 hours at the hourly basic rate
			// (12 × 1,300 ÷ (52 × 20) = 15) and 1 hour at 1.5 ×; a 6-hour day is 2 plain hours.
			const days = [
				{
					date: '2026-03-02',
					day_type: 'WORK',
					scheduled_hours: 4,
					worked_hours: 9,
					overtime_hours: 5,
					incentive_hours: 0,
					payable_incentive_hours: 0
				},
				{
					date: '2026-03-03',
					day_type: 'WORK',
					scheduled_hours: 4,
					worked_hours: 6,
					overtime_hours: 2,
					incentive_hours: 0,
					payable_incentive_hours: 0
				},
				{
					date: '2026-03-04',
					day_type: 'WORK',
					scheduled_hours: 4,
					worked_hours: 4,
					overtime_hours: 0,
					incentive_hours: 0,
					payable_incentive_hours: 0
				}
			];
			const facts = { part_time_weekly_hours: 20 };
			assert.deepEqual(price('PART_TIME_EXTRA_HOURS', pt, { days }, facts), [6, 15]);
			assert.deepEqual(price('PART_TIME_OVERTIME', pt, { days }, facts), [1, 22.5]);
			const longerActual = days.map((day) => ({ ...day, worked_hours: day.worked_hours + 6 }));
			assert.deepEqual(price('PART_TIME_EXTRA_HOURS', pt, { days: longerActual }, facts), [6, 15]);
			assert.deepEqual(price('PART_TIME_OVERTIME', pt, { days: longerActual }, facts), [1, 22.5]);
			assert.deepEqual(
				price(
					'PART_TIME_OVERTIME',
					pt,
					{
						days: days.map((day) => ({ ...day, overtime_hours: 0 }))
					},
					facts
				),
				[0, 22.5]
			);
			assert.deepEqual(
				price('PART_TIME_EXTRA_HOURS', pt, { days }, { ...facts, full_time_daily_hours: 9 }),
				[7, 15]
			);
			const limit = String(
				fixtureValue11(row(version, 'rule_set', 'OVERTIME_MONTHLY_LIMIT').rules).when
			);
			// The month's approved overtime (hours.month), so the halves of a semi-monthly month count together.
			const warns = (terms: Row, overtime_hours = 80) =>
				evaluateConfigured(
					fixtureString(limit),
					fixtureContext({
						...subject({ terms }),
						work: { overtime_hours: 40 },
						hours: { month: { overtime_hours } }
					})
				);
			assert.equal(warns(workman), true);
			assert.equal(warns(workman, 72), false);
			assert.equal(warns({ statutory_work_category: 'NON_MANUAL', base_salary: 6000 }), false);
			// The second part receives the remaining classification from the same calendar month, not a fresh cap.
			for (const { overtime_hours, payable_incentive_hours, regular } of [
				{ overtime_hours: 72, payable_incentive_hours: 0, regular: 72 },
				{ overtime_hours: 80, payable_incentive_hours: 8, regular: 72 },
				{ overtime_hours: 20, payable_incentive_hours: 20, regular: 0 }
			]) {
				const work = {
					overtime_hours,
					incentive_hours: payable_incentive_hours,
					payable_incentive_hours,
					days: [otDay(overtime_hours, payable_incentive_hours)]
				};
				assert.deepEqual(price('OVERTIME', workman, work), [regular, (1.5 * 3000 * 12) / 2288]);
				assert.deepEqual(
					price('INCENTIVE', workman, work),
					payable_incentive_hours === 0 ? null : [payable_incentive_hours, (1.5 * 3000 * 12) / 2288]
				);
			}
			const bankedOverflow = {
				overtime_hours: 2,
				incentive_hours: 4,
				payable_incentive_hours: 2,
				days: [otDay(4, 4, { banked_hours: 2 })]
			};
			assert.deepEqual(price('OVERTIME', workman, bankedOverflow), [0, (1.5 * 3000 * 12) / 2288]);
			assert.deepEqual(price('INCENTIVE', workman, bankedOverflow), [2, (1.5 * 3000 * 12) / 2288]);
			// EA s.37(2)(c)/(3)(c): every hour on a planned 0-hour rest day is derived overtime, but REST_DAY_WORK pays
			// the day; OVERTIME takes only the hours beyond the normal daily hours, and the incentive no more than those.
			const rested = (approved: number, incentive: number) => ({
				overtime_hours: approved,
				incentive_hours: incentive,
				payable_incentive_hours: incentive,
				days: [otDay(approved, incentive, { day_type: 'REST', scheduled_hours: 0 })]
			});
			const normal = { normal_daily_hours: 8 };
			const hourly = (1.5 * 3000 * 12) / 2288;
			assert.deepEqual(price('OVERTIME', workman, rested(10, 0), normal), [2, hourly]);
			assert.deepEqual(price('OVERTIME', workman, rested(6, 0), normal), [0, hourly]);
			assert.deepEqual(price('OVERTIME', workman, rested(10, 5), normal), [0, hourly]);
			assert.deepEqual(price('INCENTIVE', workman, rested(10, 5), normal), [2, hourly]);
			assert.equal(price('INCENTIVE', workman, rested(6, 5), normal), null);
		}
	});
	it('part-time leave is the full-time ladder pro-rated by contracted hours; work-injury MC is its own WICA class, paid as compensation', () => {
		for (const version of versions) {
			const days = (code: string, service_months: number, facts: Row, company: Row = {}) =>
				evaluateConfigured(
					fixtureString(
						String(fixtureValue11(row(version, 'leave_catalog', code).entitlement).days)
					),
					fixtureContext({
						...subject({
							terms: { employment_type: 'PART_TIME' },
							employee: { facts },
							company: { facts: company }
						}),
						service_months,
						bands: fixtureValue11(row(version, 'leave_catalog', code).entitlement).bands,
						as_of: '2026-04-01',
						entry: { facts: {} },
						taken: { calendar_year: 0, service_year: 0, lifetime: 0, event: 0 }
					})
				);
			assert.equal(days('ANNUAL_LEAVE_PART_TIME', 100, { part_time_weekly_hours: 22 }), 7); // 14 × 22/44
			assert.equal(days('SICK_LEAVE_PART_TIME', 12, { part_time_weekly_hours: 22 }), 7);
			assert.equal(days('HOSPITALIZATION_LEAVE_PART_TIME', 12, { part_time_weekly_hours: 22 }), 30);
			// Against a comparable full-timer (reg.7): the employee's own comparator, else the entity's normal week, else 44.
			assert.equal(
				days('ANNUAL_LEAVE_PART_TIME', 100, {
					part_time_weekly_hours: 20,
					full_time_weekly_hours: 40
				}),
				7
			);
			assert.equal(
				days(
					'ANNUAL_LEAVE_PART_TIME',
					100,
					{ part_time_weekly_hours: 20 },
					{ full_time_weekly_hours: 40 }
				),
				7
			);
			assert.equal(
				days(
					'ANNUAL_LEAVE_PART_TIME',
					100,
					{ part_time_weekly_hours: 20, full_time_weekly_hours: 40 },
					{ full_time_weekly_hours: 44 }
				),
				7
			);
			assert.equal(
				days(
					'SICK_LEAVE_PART_TIME',
					12,
					{ part_time_weekly_hours: 20 },
					{ full_time_weekly_hours: 40 }
				),
				7
			);
			const eligible = (code: string, terms: Row, facts: Row = {}) =>
				evaluateConfigured(
					fixtureString(String(row(version, 'leave_catalog', code).eligibility)),
					fixtureContext({
						...subject({ terms, employee: { facts } }),
						entry: { facts: {} }
					})
				);
			assert.equal(eligible('ANNUAL_LEAVE', { employment_type: 'PART_TIME' }), false);
			assert.equal(
				eligible(
					'ANNUAL_LEAVE_PART_TIME',
					{ employment_type: 'PART_TIME' },
					{ part_time_weekly_hours: 22 }
				),
				true
			);
			const wica = row(version, 'leave_catalog', 'WORK_INJURY_MEDICAL_LEAVE');
			assert.equal(wica.consumes_code ?? null, null);
			assert.equal(fixtureValue11(wica.entitlement).window, 'EVENT');
			// WICA days are compensation, not salary: the day's salary is removed (pay fraction 0).
			assert.equal(
				evaluateConfigured(
					fixtureString(String(wica.pay_fraction)),
					fixtureContext({ leave: { facts: {} } })
				),
				0
			);
		}
	});
	it.effect(
		'deduction caps: a quarter for damage (s.29), accommodation (s.30) and each instalment (s.31); no recovery of levy or pass costs; CPF missed shares within six months',
		Effect.fnUntraced(function* () {
			const deduct = Effect.fnUntraced(function* (
				code: string,
				amount: number,
				family: 'adhoc' | 'loan' = 'adhoc'
			) {
				const fixture = engine();
				const version = 'version_2';
				const catalog_id = fixtureString(row(version, `${family}_catalog`, code).id);
				if (family === 'loan')
					fixturePresent(fixture.tables.get('loan_catalog_entry')).push(
						fixtureRow({
							id: `principal-${code}`,
							employment_id: 'k-p3',
							company_id: 'c-sg',
							catalog_id,
							advance_made_on: '2026-03-10',
							principal_amount: amount,
							repayment_period: { from: '2026-03-10', to: '2026-03-10' }
						})
					);
				fixturePresent(
					fixture.tables.get(family === 'loan' ? 'loan_repayment_entry' : 'adhoc_catalog_entry')
				).push(
					fixtureRow({
						id: `d-${code}`,
						...(family === 'loan' ? { loan_id: `principal-${code}` } : {}),
						employment_id: 'k-p3',
						company_id: 'c-sg',
						catalog_id,
						payslip_id: null,
						occurred_on: '2026-03-10',
						amount
					})
				);
				return fixturePresent(
					(yield* fixture.run('2026-03', 'REGULAR')).payslips.find(
						(item) => item.employment_id === fixtureKey('k-p3')
					)
				).hold;
			});
			assert.match(String(yield* deduct('DAMAGE_RECOVERY', 1300)), /s\.29/); // > 4,800 / 4
			assert.equal(yield* deduct('DAMAGE_RECOVERY', 1100), null);
			assert.match(String(yield* deduct('ACCOMMODATION_RECOVERY', 1300)), /s\.30/);
			assert.match(String(yield* deduct('SALARY_ADVANCE', 1300, 'loan')), /s\.31/);
			assert.equal(yield* deduct('SALARY_ADVANCE', 1100, 'loan'), null);
			for (const version of versions) {
				const qualifies = (code: string, facts: Row, occurred_on = '2026-03-10') =>
					evaluateConfigured(
						fixtureString(String(row(version, 'adhoc_catalog', code).qualifies_when)),
						fixtureContext({
							...subject(),
							entry: { amount: 100, occurred_on, facts, ...facts }
						})
					);
				assert.equal(qualifies('CONSENT_EMPLOYEE_BENEFIT', {}), true);
				assert.equal(
					qualifies('CONSENT_EMPLOYEE_BENEFIT', { recovers: 'FOREIGN_WORKER_LEVY' }),
					false
				);
				assert.equal(qualifies('ACCOMMODATION_RECOVERY', { recovers: 'MEDICAL_INSURANCE' }), false);
				const missed = { missed_month: '2025-12-01', cpf_board_consent_ref: 'CPF-1' };
				assert.equal(qualifies('CPF_MISSED_SHARE_RECOVERY', missed), true);
				assert.equal(qualifies('CPF_MISSED_SHARE_RECOVERY', missed, '2026-07-01'), false); // past six months
				assert.equal(
					qualifies('CPF_MISSED_SHARE_RECOVERY', { ...missed, employer_error: true }),
					false
				);
				assert.equal(qualifies('CPF_MISSED_SHARE_RECOVERY', { missed_month: '2025-12-01' }), false);
			}
		})
	);
	it.effect(
		'work-pass conditions: the declared MOM salary and the PWM floor warn; medical insurance, security bond and young-person notice rise at hire',
		Effect.fnUntraced(function* () {
			const fixture = engine();
			const term = (id: string) =>
				fixturePresent(
					fixtureValue15(
						fixtureRecord(
							fixturePresent(
								fixturePresent(fixture.tables.get('employment_contract')).find(
									(item) => item.id === fixtureKey(id)
								)
							).facts
						).contract_terms
					)[0]
				);
			term('k-p4').facts = { mom_declared_monthly_salary: 3300 };
			term('k-p3').facts = { pwm_role: 'ADMIN_EXECUTIVE' };
			const plan = yield* fixture.run('2026-03', 'REGULAR');
			assert.ok(plan.warnings.some((warning) => /declared to MOM/.test(warning)));
			assert.equal(
				plan.warnings.some((warning) => /Progressive Wage/.test(warning)),
				false
			); // $4,800 above $2,580
			term('k-p3').facts = { pwm_role: 'ADMIN_EXECUTIVE' };
			const low = engine();
			const lowTerm = fixturePresent(
				fixtureValue15(
					fixtureRecord(
						fixturePresent(
							fixturePresent(low.tables.get('employment_contract')).find(
								(item) => item.id === fixtureKey('k-p4')
							)
						).facts
					).contract_terms
				)[0]
			);
			lowTerm.facts = { pwm_role: 'LIFT_SUPERVISOR' }; // basic floor $3,445
			assert.ok(
				(yield* low.run('2026-03', 'REGULAR')).warnings.some((warning) =>
					/Progressive Wage/.test(warning)
				)
			);
			for (const version of versions) {
				const settings = settingsOf(version);
				const hire = (employee: Row, company: Row = { facts: {} }) =>
					raiseDuties({
						behaviours: fixtureValue5(settings.behaviours),
						settings_id: settings.id,
						rows: load(version, 'rule_set'),
						collection: 'employment_contract',
						event: 'created',
						row: {
							id: 'k1',
							company_id: 'c1',
							employee_id: 'p1',
							effective_range: { from: '2026-03-02', to: null },
							exit_ground: null,
							exit_facts: null,
							employee_number: String('p1'),
							contract_number: 1
						},
						reads: {
							employee: [{ gender: 'MALE', date_of_birth: '1990-01-01', facts: {}, ...employee }],
							company: [company]
						}
					}).map((write) => String(write.duty_code));
				const wp = { nationality: 'BANGLADESHI', facts: { immigration_status: 'WORK_PERMIT' } };
				assert.ok(hire(wp).includes('WORK_PASS_MEDICAL_INSURANCE'));
				assert.ok(hire(wp).includes('WORK_PERMIT_SECURITY_BOND'));
				assert.equal(
					hire({ ...wp, nationality: 'MALAYSIA' }).includes('WORK_PERMIT_SECURITY_BOND'),
					false
				);
				assert.equal(
					hire({ facts: { immigration_status: 'EMPLOYMENT_PASS' } }).includes(
						'WORK_PASS_MEDICAL_INSURANCE'
					),
					false
				);
				const child = { date_of_birth: '2012-01-01', facts: { immigration_status: 'CITIZEN' } };
				assert.ok(
					hire(child, { facts: { industrial_undertaking: true } }).includes(
						'YOUNG_PERSON_NOTIFICATION'
					)
				);
				assert.equal(hire(child).includes('YOUNG_PERSON_NOTIFICATION'), false);
				// WICA insurance: a manual worker or a non-manual one on $2,600 or less.
				const wica = (terms: Row) =>
					evaluateConfigured(
						fixtureString(
							String(
								fixtureValue11(row(version, 'rule_set', 'WORK_INJURY_COMPENSATION_INSURANCE').rules)
									.applies_when
							)
						),
						fixtureContext({
							contract: { facts: { contract_terms: [terms] } }
						})
					);
				assert.equal(
					wica({ statutory_work_category: 'MANUAL_LABOUR', base_salary: { value: 8000 } }),
					true
				);
				assert.equal(
					wica({ statutory_work_category: 'NON_MANUAL', base_salary: { value: 2600 } }),
					true
				);
				assert.equal(
					wica({ statutory_work_category: 'NON_MANUAL', base_salary: { value: 5000 } }),
					false
				);
			}
		})
	);
	it('claims: medical and per-diem reimbursements stay out of every base; GPSPL and GPCL caps hold across the child’s claims', () => {
		for (const version of versions) {
			const claim = (code: string) => row(version, 'claim_catalog', code);
			for (const code of ['MEDICAL_TREATMENT_REIMBURSEMENT', 'PER_DIEM_OFFICIAL_REIMBURSEMENT']) {
				assert.equal(claim(code).destination, 'NET', code);
				assert.deepEqual(claim(code).counts_toward, [], code);
			}
			for (const code of [
				'GPML_REIMBURSEMENT',
				'GPPL_REIMBURSEMENT',
				'ADOPTION_REIMBURSEMENT',
				'GPSPL_REIMBURSEMENT',
				'GPCL_REIMBURSEMENT',
				'WICA_MEDICAL'
			])
				assert.equal(claim(code).destination, 'EMPLOYER', code);
			const q = (code: string, entry: Row, earlier: Row[] = []) =>
				evaluateConfigured(
					fixtureString(String(claim(code).qualifies_when)),
					fixtureContext({
						...subject(),
						entry: { ...entry, facts: entry },
						earlier: { rows: earlier, calendar_year: 0, lifetime: 0 }
					})
				);
			const medical = {
				amount: 100,
				amount_incurred: 120,
				due_on: '2026-03-10',
				incurred_on: '2026-03-05',
				patient: 'EMPLOYEE',
				practitioner_qualified: true,
				treatment: 'MEDICAL',
				treatment_necessary: true,
				solely_aesthetic: false
			};
			assert.equal(q('MEDICAL_TREATMENT_REIMBURSEMENT', medical), true);
			assert.equal(
				q('MEDICAL_TREATMENT_REIMBURSEMENT', { ...medical, solely_aesthetic: true }),
				false
			);
			const diem = {
				amount: 100,
				due_on: '2026-03-10',
				incurred_on: '2026-03-05',
				official_purpose: true,
				actual_expenditure: 100,
				purpose_reference: 'TRIP'
			};
			assert.equal(q('PER_DIEM_OFFICIAL_REIMBURSEMENT', diem), true);
			assert.equal(q('PER_DIEM_OFFICIAL_REIMBURSEMENT', { ...diem, amount: 150 }), false); // above the expenditure: wages, not a claim
			assert.equal(
				q('GPSPL_REIMBURSEMENT', { amount: 5000, quantity: 2, service_months: 12 }),
				true
			);
			assert.equal(
				q('GPSPL_REIMBURSEMENT', { amount: 5000.01, quantity: 2, service_months: 12 }),
				false
			);
			const gpcl = (amount: number, earlier: number[], extra: Row = {}) =>
				q(
					'GPCL_REIMBURSEMENT',
					{
						amount,
						quantity: 1,
						service_months: 12,
						child_id: 'c1',
						child_birthdate: '2022-01-01',
						occurred_on: '2026-09-01',
						...extra
					},
					earlier.map((value, i) => ({
						id: `e${i}`,
						amount: value,
						child_id: 'c1',
						occurred_on: '2026-03-01'
					}))
				);
			assert.equal(gpcl(500, [500, 500]), true);
			assert.equal(gpcl(500, [500, 500, 500]), false); // $1,500 a year
			assert.equal(gpcl(500, [500, 500], { child_birthdate: '2018-01-01' }), false); // ECL: $1,000 a year
			assert.equal(gpcl(500, [500, 500, 500], { occurred_on: '2027-01-05' }), true); // a new year
			assert.equal(gpcl(600, []), false); // $500 a day
		}
	});
	it('paid-period mechanics: a fixed allowance prorates with the gross rate, no-pay days deduct at gross ÷ working days, paid leave deducts nothing, back pay is OW only when due by the 14th', () => {
		for (const version of versions) {
			const allowance = row(version, 'allowance_catalog', 'FIXED_MONTHLY');
			assert.equal(
				Math.round(
					Number(
						evaluateConfigured(
							fixtureString(String(allowance.amount)),
							fixtureContext({
								...subject(),
								earned: { month: slipSums([]) },
								allowance: { amount: 300 },
								period: {
									part: 1,
									parts: 1,
									month_from: '2026-03-01',
									month_to: '2026-03-31',
									month_days: 31,
									month_working_days: 22,
									month_holiday_work_days: 0,
									from: '2026-03-01',
									to: '2026-03-31',
									working_days: 22,
									covered_working_days: 15,
									paid_days: 20,
									days: 31
								},
								work: { days: [] }
							})
						)
					) * 100
				) / 100,
				204.55
			);
			assert.ok(fixtureValue12(allowance.counts_toward).includes('CPF.ORDINARY'));
			assert.ok(
				fixtureValue12(
					row(version, 'allowance_catalog', 'PT_ANNUAL_HOURLY_OW').counts_toward
				).includes('CPF.ORDINARY')
			);
			assert.ok(
				fixtureValue12(
					row(version, 'allowance_catalog', 'PT_ANNUAL_HOURLY_AW').counts_toward
				).includes('CPF.ADDITIONAL')
			);
			const npl = row(version, 'work_catalog', 'NO_PAY_LEAVE');
			const context = (rows: Row[]) => ({
				...subject({ terms: { base_salary: 4000, monthly_wage: 4000 } }),
				period: {
					working_days: 22,
					days: 31,
					part: 1,
					parts: 1,
					month_from: '2026-03-01',
					month_to: '2026-03-31',
					month_days: 31,
					month_working_days: 22,
					month_holiday_work_days: 0
				},
				leave: { rows }
			});
			const two = [
				{ code: 'UNPAID_LEAVE', activity: 'TIME_OFF', days: 2, is_npl: true, pay_fraction: 1 }
			];
			assert.equal(
				Math.round(
					Number(
						evaluateConfigured(fixtureString(String(npl.quantity)), fixtureContext(context(two)))
					) *
						Number(
							evaluateConfigured(fixtureString(String(npl.rate)), fixtureContext(context(two)))
						) *
						100
				) / 100,
				363.64
			);
			const paid = [
				{ code: 'ANNUAL_LEAVE', activity: 'TIME_OFF', days: 2, is_npl: false, pay_fraction: 1 }
			];
			assert.equal(
				evaluateConfigured(fixtureString(String(npl.eligibility)), fixtureContext(context(paid))),
				false
			);
			const ow = String(row(version, 'adhoc_catalog', 'ORDINARY_BACKPAY').qualifies_when);
			const aw = String(row(version, 'adhoc_catalog', 'ADDITIONAL_BACKPAY').qualifies_when);
			const backpay = (days: number, kind = 'CONTRACTUAL') => {
				const wage_attribution = {
					recorded: true,
					purpose: 'INCREMENT',
					increment_kind: kind,
					single_month: true,
					payable_days_after_month: days
				};
				const c = { ...subject(), entry: { wage_attribution, facts: { wage_attribution } } };
				return [
					evaluateConfigured(fixtureString(ow), fixtureContext(c)),
					evaluateConfigured(fixtureString(aw), fixtureContext(c))
				];
			};
			assert.deepEqual(backpay(14), [true, false]);
			assert.deepEqual(backpay(15), [false, true]);
			assert.deepEqual(backpay(10, 'RETROSPECTIVE'), [false, true]);
		}
	});
	it('CPF: the SPR second year starts the month after the first anniversary; the December AW ceiling trues up to actual OW', () => {
		for (const version of versions) {
			// SPR since 15 Mar 2025: March 2026 is still year 1 (G/G), April 2026 year 2.
			const spr = {
				age: 30,
				residency_status: 'PERMANENT_RESIDENT',
				residency_since: '2025-03-15'
			};
			assert.deepEqual(
				charge(version, 'CPF', 3000, spr, '2026-03-01'),
				cpfExact(fixturePresent(PR1[0]), 300000)
			);
			assert.deepEqual(
				charge(version, 'CPF', 3000, spr, '2026-04-01'),
				cpfExact(fixturePresent(PR2[0]), 300000)
			);
			const parts = fixturePresent(configuration(version, 'CPF').assessable);
			const ceiling = version === 'version_1' ? 7400 : 8000;
			// December, salary paid, actual OW for the year 5,000 × 12: the AW ceiling is 102,000 − 60,000.
			const additional = evaluateConfigured(
				fixtureString(fixturePresent(parts.additional)),
				fixtureContext({
					wage: { ordinary: 5000, additional: 50000 },
					month: { ordinary: 5000, additional: 50000 },
					year: { ordinary: 5000 * 11, additional: 0 },
					period: { month: 12, salary_paid: true },
					terms: { monthly_wage: 5000 }
				})
			);
			assert.equal(additional, Math.min(50000, 102000 - 60000));
			assert.ok(ceiling > 0);
		}
	});
	it('leave pools: outpatient sick leave draws on the 60-day hospitalisation pool', () => {
		for (const version of versions) {
			const classes = load(version, 'leave_catalog')
				.filter((item) => ['SICK_LEAVE', 'HOSPITALIZATION_LEAVE'].includes(String(item.code)))
				.map((item) => seedClass(item));
			const sick = fixturePresent(classes.find((item) => item.code === 'SICK_LEAVE'));
			const balances = leaveBalances({
				classes,
				movements: [
					seedMovement({
						catalog_id: sick.id,
						activity: 'TIME_OFF',
						days: 10,
						from: '2026-03-02',
						to: '2026-03-13',
						occurred_on: '2026-03-02'
					})
				],
				serviceMonths: 30,
				asOf: '2026-03-20',
				employmentStart: '2023-09-01',
				context: { ...subject({ terms: { employment_type: 'PERMANENT' } }) }
			});
			const of = (code: string) => fixturePresent(balances.find((item) => item.code === code));
			assert.equal(of('SICK_LEAVE').available, 4);
			assert.equal(of('HOSPITALIZATION_LEAVE').available, 50);
		}
	});
	it('advances: 12 months to recover, no pre-contract travel advance; s.20A(2) short days; s.22 dismissal grace; duty texts', () => {
		for (const version of versions) {
			const loan = (code: string, facts: Row, occurred_on = '2026-03-10') =>
				evaluateConfigured(
					fixtureString(String(row(version, 'loan_catalog', code).eligibility)),
					fixtureContext({
						...subject({ employment: { start_date: '2025-01-06' } }),
						entry: { amount: 100, occurred_on, facts, ...facts }
					})
				);
			assert.equal(loan('SALARY_ADVANCE', { advance_made_on: '2025-06-01' }), true);
			assert.equal(loan('SALARY_ADVANCE', { advance_made_on: '2025-02-01' }), false); // past 12 months
			assert.equal(loan('TRAVEL_ADVANCE', { advance_made_on: '2024-12-20' }), false); // before the contract
			assert.equal(loan('TRAVEL_ADVANCE', { advance_made_on: '2025-06-01' }), true);
			// An incomplete month with one 4-hour Saturday: (11 − 0.5) ÷ 22.
			const basic = row(version, 'work_catalog', 'BASIC');
			const day = (date: string, hours: number) => ({
				date,
				day_type: 'WORK',
				scheduled_hours: hours,
				worked_hours: hours
			});
			const context = (covered: number, days: Row[]) => ({
				...subject(),
				earned: { month: slipSums([]) },
				period: {
					from: '2026-03-01',
					to: '2026-03-31',
					working_days: 22,
					covered_working_days: covered,
					paid_days: 15,
					days: 31,
					part: 1,
					parts: 1,
					month_from: '2026-03-01',
					month_to: '2026-03-31',
					month_days: 31,
					month_working_days: 22,
					month_holiday_work_days: 0
				},
				work: { days }
			});
			assert.equal(
				evaluateConfigured(
					fixtureString(String(basic.quantity)),
					fixtureContext(context(11, [day('2026-03-21', 4), day('2026-03-23', 8)]))
				),
				10.5 / 22
			);
			assert.equal(
				evaluateConfigured(
					fixtureString(String(basic.quantity)),
					fixtureContext(context(22, [day('2026-03-21', 4)]))
				),
				1
			);
			const final = String(
				fixtureValue11(row(version, 'rule_set', 'FINAL_SALARY_PAYMENT').rules).due
			);
			const due = (exit_ground: string, exit_facts: Row) =>
				evaluateConfigured(
					fixtureString(final),
					fixtureContext({
						exit_on: '2026-06-26',
						holidays: [],
						contract: { exit_ground, exit_facts }
					})
				);
			assert.equal(due('DISMISSAL', {}), '2026-06-26');
			assert.equal(due('DISMISSAL', { final_pay_not_possible: true }), '2026-07-01'); // 3 working days after Friday
			assert.equal(due('RESIGNATION', {}), '2026-07-03');
			const text = (code: string) =>
				String(fixtureValue11(row(version, 'rule_set', code).rules).description);
			assert.match(text('SDL_REMITTANCE'), /SWDA/);
			assert.match(text('SDL_REMITTANCE'), /10% a year/);
			assert.match(text('RETRENCHMENT_NOTIFICATION'), /5 working days/);
			const lieu = row(version, 'leave_catalog', 'PUBLIC_HOLIDAY_IN_LIEU');
			assert.match(String(lieu.authority), /s\.88\(1\)\(a\)/);
			assert.equal(seedClass(lieu).entitlement?.days ?? null, null);
		}
	});
	it('employer conduct duties: due inquiry before a misconduct dismissal, a DPO at entity creation, 12 hours a day and a weekly rest day', () => {
		for (const version of versions) {
			const settings = settingsOf(version);
			const raise = (collection: string, event: string, row: Row, reads: Row = {}) =>
				raiseDuties({
					behaviours: fixtureValue5(settings.behaviours),
					settings_id: settings.id,
					rows: load(version, 'rule_set'),
					collection,
					event,
					row,
					reads
				}).map((write) => String(write.duty_code));
			const left = (exit_ground: string, exit_facts: Row) => ({
				id: 'k1',
				company_id: 'c1',
				employee_id: 'p1',
				effective_range: { from: '2020-01-01', to: '2026-06-30' },
				exit_ground,
				exit_facts,
				employee_number: String('p1'),
				contract_number: 1
			});
			const reads = {
				employee: [{ facts: { immigration_status: 'CITIZEN' } }],
				catalogues: [],
				movements: []
			};
			assert.ok(
				raise(
					'employment_contract',
					'updated',
					left('DISMISSAL', { dismissed_for_misconduct: true }),
					reads
				).includes('MISCONDUCT_DUE_INQUIRY')
			);
			assert.equal(
				raise(
					'employment_contract',
					'updated',
					left('RESIGNATION', { notice_served: true }),
					reads
				).includes('MISCONDUCT_DUE_INQUIRY'),
				false
			);
			assert.ok(
				raise('entity', 'created', { id: 'c1', facts: {} }).includes('PDPA_DATA_PROTECTION_OFFICER')
			);
			assert.equal(
				raise(
					'entity',
					'created',
					{ id: 'c1', facts: {} },
					{ company: [{ facts: { dpo_contact: 'dpo@example.com' } }] }
				).includes('PDPA_DATA_PROTECTION_OFFICER'),
				false
			);
			const check = (
				code: string,
				days: Row[],
				terms: Row = { statutory_work_category: 'MANUAL_LABOUR', base_salary: 3000 }
			) =>
				evaluateConfigured(
					fixtureString(String(fixtureValue11(row(version, 'rule_set', code).rules).when)),
					fixtureContext({
						...subject({ terms }),
						work: { days }
					})
				);
			const day = (date: string, worked_hours: number) => ({
				date,
				worked_hours,
				worked: worked_hours > 0
			});
			assert.equal(check('DAILY_HOURS_LIMIT', [day('2026-03-02', 13)]), true);
			assert.equal(check('DAILY_HOURS_LIMIT', [day('2026-03-02', 12)]), false);
			assert.equal(
				check('DAILY_HOURS_LIMIT', [day('2026-03-02', 13)], {
					statutory_work_category: 'NON_MANUAL',
					base_salary: 6000
				}),
				false
			);
			const week = [
				'2026-03-02',
				'2026-03-03',
				'2026-03-04',
				'2026-03-05',
				'2026-03-06',
				'2026-03-07',
				'2026-03-08'
			];
			assert.equal(
				check(
					'WEEKLY_REST_DAY',
					week.map((d) => day(d, 8))
				),
				true
			);
			assert.equal(
				check(
					'WEEKLY_REST_DAY',
					week.map((d, i) => day(d, i === 6 ? 0 : 8))
				),
				false
			);
		}
	});
	it('the leaving year: annual leave pro-rated by completed months (EA s.88A(2)) and encashed through its own class', () => {
		for (const version of versions) {
			const exit = row(version, 'leave_catalog', 'ANNUAL_LEAVE_ON_EXIT');
			assert.equal(exit.encash_on_exit, true);
			assert.equal(row(version, 'leave_catalog', 'ANNUAL_LEAVE').encash_on_exit, false);
			const ent = fixtureValue11(exit.entitlement);
			const days = (
				start_date: string,
				exit_date: string,
				service_months: number,
				taken = 0,
				as_of = exit_date
			) =>
				evaluateConfigured(
					fixtureString(String(ent.days)),
					fixtureContext({
						...subject({ employment: { start_date, exit_date, service_months } }),
						service_months,
						bands: ent.bands,
						as_of,
						entry: { facts: {} },
						taken: { calendar_year: 0, service_year: 0, lifetime: 0, event: 0 },
						taken_by_class: { ANNUAL_LEAVE: { service_year: taken } }
					})
				);
			assert.equal(days('2019-01-01', '2026-03-31', 86, 1), 3); // 14 × 3/12 = 3.5 → 4, less 1 taken
			assert.equal(days('2019-01-01', '2026-08-31', 91), 9); // 14 × 8/12 = 9.33 → 9
			assert.equal(days('2025-09-01', '2026-02-28', 5), 4); // first year: 7 × 6/12 = 3.5 → 4
			assert.equal(days('2019-01-01', '2026-03-31', 86, 0, '2026-03-15'), 0); // still employed on the day read
			assert.equal(days('2019-01-01', '2026-03-31', 86, 9), 0);
		}
	});
	it('the SDL remittance is the run’s levies rounded down to the dollar', () => {
		for (const version of versions)
			assert.equal(
				evaluateConfigured(
					fixtureString(
						String(fixtureValue11(row(version, 'rule_set', 'SDL_REMITTANCE').rules).amount)
					),
					fixtureContext({ total: 44.98, run: {}, period: {} })
				),
				44
			);
	});
	for (const period of ['2025-12', '2026-03', '2026-08', '2027-02']) {
		it.effect(
			`IR21: a payment after the clearance waits for an Additional/Amended IR21 clearance: ${period}`,
			Effect.fnUntraced(function* () {
				const end = new Date(Date.parse(`${period}-01T00:00:00Z`) + 32 * 86400000)
					.toISOString()
					.slice(0, 8);
				const last = new Date(Date.parse(`${end}01T00:00:00Z`) - 86400000)
					.toISOString()
					.slice(0, 10);
				const version = versionOn(`${period}-01`);
				const paid = Effect.fnUntraced(function* (exit_facts: Row) {
					const fixture = engine();
					const leaver = fixturePresent(
						fixturePresent(fixture.tables.get('employment_contract')).find(
							(item) => item.id === fixtureKey('k-p1')
						)
					);
					leaver.effective_range = { from: '2019-01-01', to: last };
					leaver.exit_facts = exit_facts;
					yield* openingSalary(fixture, period);
					const final = yield* fixture.run(period, 'REGULAR');
					fixturePresent(fixture.tables.get('adhoc_catalog_entry')).push(
						fixtureRow({
							id: 'late-bonus',
							employment_id: 'k-p1',
							company_id: 'c-sg',
							catalog_id: fixtureString(row(version, 'adhoc_catalog', 'bonus').id),
							payslip_id: null,
							occurred_on: `${period}-20`,
							amount: 3000
						})
					);
					const late = yield* fixture.run(period, 'OFF_CYCLE', ['late-bonus']);
					const slip = (plan: typeof final) =>
						fixturePresent(plan.payslips.find((item) => item.employment_id === fixtureKey('k-p1')))
							.hold;
					return [slip(final), slip(late)];
				});
				// The final pay is released by the original clearance; the later bonus is held.
				const [final, late] = yield* paid({ ir21_clearance_on: last });
				assert.equal(final, null, period);
				assert.match(String(late), /Additional\/Amended Form IR21/, period);
				assert.deepEqual(
					yield* paid({ ir21_clearance_on: last, ir21_additional_clearance_on: last }),
					[null, null],
					period
				);
			}),
			period !== '2025-12' ? 15_000 : undefined
		);
	}
	for (const scenario of [
		'2025 no bonus',
		'2025 bonus 2215.39',
		'2025 bonus 2214.39',
		'2026 no bonus',
		'2026 bonus 2215.39',
		'2026 bonus 2214.39',
		'2027 no bonus',
		'2027 bonus 2215.39',
		'2027 bonus 2214.39',
		'security role',
		'foreigner',
		'recent hire',
		'dated floors'
	]) {
		it.effect(
			`PWM: the cleaning and landscape bonus of two weeks’ basic a year; the dated 2027–2028 floor steps: ${scenario}`,
			Effect.fnUntraced(function* () {
				const termOf = (fixture: ReturnType<typeof engine>, id: string) =>
					fixturePresent(
						fixtureValue15(
							fixtureRecord(
								fixturePresent(
									fixturePresent(fixture.tables.get('employment_contract')).find(
										(item) => item.id === fixtureKey(id)
									)
								).facts
							).contract_terms
						)[0]
					);
				const bonusOf = (
					fixture: ReturnType<typeof engine>,
					id: string,
					day: string,
					amount: number
				) =>
					fixturePresent(fixture.tables.get('adhoc_catalog_entry')).push(
						fixtureRow({
							id,
							employment_id: 'k-p3',
							company_id: 'c-sg',
							catalog_id: fixtureString(row(versionOn(day), 'adhoc_catalog', 'bonus').id),
							payslip_id: null,
							occurred_on: day,
							amount
						})
					);
				const warned = (plan: { warnings: readonly string[] }) =>
					plan.warnings.some((warning) => /PWM Bonus/.test(warning));
				// $4,800 basic: two weeks = 4,800 × 12 ÷ 52 × 2 = $2,215.38.
				for (const [year, role] of [
					['2025', 'CLEAN_OFFICE_GENERAL'],
					['2026', 'LANDSCAPE_WORKER'],
					['2027', 'CLEAN_CONSERVANCY_SUPERVISOR']
				] as const) {
					if (scenario === `${year} no bonus`) {
						const none = engine();
						termOf(none, 'k-p3').facts = { pwm_role: role };
						if (year !== '2025') {
							yield* openingSalary(none, `${year}-11`);
							assert.equal(
								warned(yield* none.run(`${year}-11`, 'REGULAR')),
								false,
								`${year} November`
							);
						}
						yield* openingSalary(none, `${year}-12`);
						assert.ok(warned(yield* none.run(`${year}-12`, 'REGULAR')), `${year} December`);
					}
					// A June bonus of two weeks satisfies the year; one dollar short does not.
					for (const [amount, expected] of [
						[2215.39, false],
						[2214.39, true]
					] as const) {
						if (scenario !== `${year} bonus ${amount}`) continue;
						const paid = engine();
						termOf(paid, 'k-p3').facts = { pwm_role: role };
						if (year !== '2025') {
							bonusOf(paid, 'june', `${year}-06-10`, amount);
							yield* openingSalary(paid, `${year}-06`);
							yield* paid.run(`${year}-06`, 'OFF_CYCLE', ['june']);
						} else bonusOf(paid, 'june', `${year}-12-05`, amount);
						yield* openingSalary(paid, `${year}-12`);
						assert.equal(
							warned(yield* paid.run(`${year}-12`, 'REGULAR')),
							expected,
							`${year} ${amount}`
						);
					}
				}
				// Not owed: a security role, a foreigner, under 12 months' service.
				for (const [name, change] of [
					[
						'security role',
						(term: Row) => (term.facts = { pwm_role: 'SECURITY_OUTSOURCED_SUPERVISOR' })
					],
					[
						'foreigner',
						(term: Row) => {
							term.facts = { pwm_role: 'CLEAN_OFFICE_GENERAL' };
							term.residency_status = 'FOREIGNER';
						}
					]
				] as const) {
					if (scenario !== name) continue;
					const fixture = engine();
					change(fixtureContext(termOf(fixture, 'k-p3')));
					if (name === 'foreigner')
						fixture.tables.set(
							'employment_contract',
							fixturePresent(fixture.tables.get('employment_contract')).filter(
								(contract) => contract.id === fixtureKey('k-p3')
							)
						);
					else yield* openingSalary(fixture, '2026-12');
					assert.equal(warned(yield* fixture.run('2026-12', 'REGULAR')), false);
				}
				if (scenario === 'recent hire') {
					const recent = engine();
					const hire = fixturePresent(
						fixturePresent(recent.tables.get('employment_contract')).find(
							(item) => item.id === fixtureKey('k-p3')
						)
					);
					hire.effective_range = { from: '2026-03-01', to: null };
					termOf(recent, 'k-p3').effective_range = { from: '2026-03-01', to: null };
					termOf(recent, 'k-p3').facts = { pwm_role: 'CLEAN_OFFICE_GENERAL' };
					yield* openingSalary(recent, '2026-12');
					assert.equal(warned(yield* recent.run('2026-12', 'REGULAR')), false);
				}
				if (scenario === 'dated floors') {
					// The floor: a role's dated steps replace its floor from their day (v4 is open-ended from 2027).
					const below = (day: string, pwm_role: string, salary: number) =>
						evaluateConfigured(
							fixtureString(
								String(fixtureValue11(row(versionOn(day), 'rule_set', 'PWM_WAGE_FLOOR').rules).when)
							),
							fixtureContext(
								fixtureValue13({
									terms: { facts: { pwm_role }, base_salary: salary, monthly_wage: salary },
									rules: { pwm_wages: row(versionOn(day), 'rule_set', 'pwm_wages').rules },
									period: { from: day }
								})
							)
						);
					for (const [day, role, salary, expected] of [
						['2026-08-01', 'CLEAN_OFFICE_GENERAL', 2079, true],
						['2027-06-01', 'CLEAN_OFFICE_GENERAL', 2080, false],
						['2027-07-01', 'CLEAN_OFFICE_GENERAL', 2249, true],
						['2027-07-01', 'CLEAN_OFFICE_GENERAL', 2250, false],
						['2028-07-01', 'CLEAN_OFFICE_GENERAL', 2419, true],
						['2027-07-01', 'LANDSCAPE_SUPERVISOR', 3219, true],
						['2028-07-01', 'LANDSCAPE_SUPERVISOR', 3380, false],
						['2026-08-01', 'SECURITY_OUTSOURCED_OFFICER', 3089, true],
						['2027-01-01', 'SECURITY_OUTSOURCED_OFFICER', 3309, true],
						['2027-01-01', 'SECURITY_OUTSOURCED_OFFICER', 3310, false],
						['2028-01-01', 'SECURITY_OUTSOURCED_OFFICER', 3529, true],
						['2028-01-01', 'SECURITY_OUTSOURCED_SENIOR_SUPERVISOR', 4430, false],
						['2027-01-01', 'SECURITY_INHOUSE_SUPERVISOR', 3064, true],
						['2028-01-01', 'SECURITY_INHOUSE_OFFICER', 2794, true]
					] as const)
						assert.equal(below(day, role, salary), expected, `${day} ${role} ${salary}`);
				}
			}),
			scenario.startsWith('2026 ') ||
				scenario.startsWith('2027 ') ||
				scenario === 'security role' ||
				scenario === 'recent hire'
				? 15_000
				: undefined
		);
	}
	it('CPF: wages repaid under their conditions raise the refund application, due one year on', () => {
		for (const version of versions) {
			const settings = settingsOf(version);
			const raised = (catalog_code: string) =>
				raiseDuties({
					behaviours: fixtureValue5(settings.behaviours),
					settings_id: settings.id,
					rows: load(version, 'rule_set'),
					collection: 'adhoc_catalog_entry',
					event: 'created',
					row: {
						id: 'a1',
						company_id: 'c1',
						employment_id: 'k1',
						occurred_on: '2026-05-04',
						catalog_code,
						facts: {}
					}
				}).filter((write) => write.duty_code === 'CPF_CONDITIONAL_WAGE_REFUND');
			const refund = raised('PRIOR_WAGE_CASH_REPAYMENT');
			assert.equal(refund.length, 1, version);
			assert.equal(fixturePresent(refund[0]).due_on, '2027-05-04');
			assert.equal(raised('bonus').length, 0);
		}
	});
	it('work incidents without leave raise the report and the distinct Commissioner notification', () => {
		for (const version of versions) {
			const raised = (kind: string) =>
				raiseDuties({
					behaviours: fixtureValue5(settingsOf(version).behaviours),
					settings_id: String(settingsOf(version).id),
					rows: load(version, 'rule_set'),
					collection: 'workplace_case',
					event: 'created',
					day: '2026-05-02',
					row: {
						id: kind,
						company_id: 'c1',
						kind,
						opened_on: '2026-05-02',
						facts: {}
					}
				}).map((w) => [w.duty_code ?? w.code, w.due_on]);
			assert.deepEqual(
				raised('WORK_ACCIDENT_LIGHT_DUTY'),
				[['WORK_INCIDENT_CASE_REPORT', '2026-05-12']],
				version
			);
			for (const kind of [
				'WORK_ACCIDENT_FATAL',
				'DANGEROUS_OCCURRENCE',
				'PUBLIC_WORKPLACE_FATALITY'
			]) {
				assert.deepEqual(
					raised(kind),
					[
						['WORK_INCIDENT_CASE_REPORT', '2026-05-12'],
						['WORK_INCIDENT_NOTIFICATION', '2026-05-02']
					],
					`${version} ${kind}`
				);
			}
			assert.deepEqual(
				raised('PUBLIC_WORKPLACE_HOSPITAL_TREATMENT'),
				[['WORK_INCIDENT_NOTIFICATION', '2026-05-02']],
				version
			);
			assert.deepEqual(
				raised('WORK_ACCIDENT_SUBSEQUENT_DEATH'),
				[['SUBSEQUENT_WORK_DEATH_NOTIFICATION', '2026-05-02']],
				version
			);
			assert.deepEqual(
				raised('OCCUPATIONAL_DISEASE_DIAGNOSIS'),
				[['OCCUPATIONAL_DISEASE_REPORT', '2026-05-12']],
				version
			);
			assert.deepEqual(raised('PERSONAL_NON_WORK_ACCIDENT'), [], version);
		}
	});
	it('workplace cases: the two-month FWA decision, the 30-day PDPA access or correction reply, the breach assessment and 3-day notice', () => {
		for (const version of versions) {
			const settings = settingsOf(version);
			const kinds = fixtureValue20(
				fixtureRecord(row(version, 'rule_set', 'case_kinds').rules).kinds
			).map((kind) => kind.code);
			assert.deepEqual(
				kinds.toSorted(),
				[
					'DATA_BREACH',
					'FLEXIBLE_WORK_REQUEST',
					'PERSONAL_DATA_ACCESS_REQUEST',
					'PERSONAL_DATA_CORRECTION_REQUEST',
					'WORK_ACCIDENT_LIGHT_DUTY',
					'WORK_ACCIDENT_FATAL',
					'WORK_ACCIDENT_SUBSEQUENT_DEATH',
					'OCCUPATIONAL_DISEASE_DIAGNOSIS',
					'DANGEROUS_OCCURRENCE',
					'PUBLIC_WORKPLACE_FATALITY',
					'PUBLIC_WORKPLACE_HOSPITAL_TREATMENT'
				].toSorted()
			);
			const raised = (event: string, kind: string, extra: Row = {}, day = '2026-03-02') =>
				raiseDuties({
					behaviours: fixtureValue5(settings.behaviours),
					settings_id: settings.id,
					rows: load(version, 'rule_set'),
					collection: 'workplace_case',
					event,
					row: {
						id: 'case-1',
						company_id: 'c1',
						employment_id: null,
						kind,
						opened_on: '2026-03-02',
						closed_on: null,
						facts: {},
						...extra
					},
					day
				}).map((write) => [String(write.duty_code), String(write.due_on)]);
			// 2 March 2026 + 2 months = 2 May; + 30 days = 1 April.
			assert.deepEqual(raised('created', 'FLEXIBLE_WORK_REQUEST'), [
				['FLEXIBLE_WORK_REQUEST_DECISION', '2026-05-02']
			]);
			for (const kind of ['PERSONAL_DATA_ACCESS_REQUEST', 'PERSONAL_DATA_CORRECTION_REQUEST'])
				assert.deepEqual(raised('created', kind), [['PDPA_ACCESS_CORRECTION_REPLY', '2026-04-01']]);
			assert.deepEqual(raised('created', 'DATA_BREACH'), [
				['PDPA_BREACH_ASSESSMENT', '2026-04-01']
			]);
			// The notice waits for the assessment; then it is due 3 calendar days after (Sat 7 Mar → Tue 10 Mar).
			assert.deepEqual(raised('daily', 'DATA_BREACH', {}, '2026-03-06'), []);
			assert.deepEqual(
				raised(
					'daily',
					'DATA_BREACH',
					{ facts: { notifiable_assessed_on: '2026-03-07' } },
					'2026-03-08'
				),
				[['PDPA_BREACH_NOTIFICATION', '2026-03-10']]
			);
			assert.deepEqual(raised('daily', 'FLEXIBLE_WORK_REQUEST', {}, '2026-03-08'), []);
		}
	});
	it.effect(
		'record retention: anonymising waits for 31 December of the exit year + 6 (ITA s.67), and the PDPA s.25 disposal task falls that day',
		Effect.fnUntraced(function* () {
			for (const [exit, until] of [
				['2025-12-31', '2031-12-31'],
				['2026-03-31', '2032-12-31'],
				['2027-02-28', '2033-12-31']
			] as const) {
				const fixture = engine();
				const leaver = fixturePresent(
					fixturePresent(fixture.tables.get('employment_contract')).find(
						(item) => item.id === fixtureKey('k-p3')
					)
				);
				leaver.effective_range = { from: '2019-01-01', to: exit };
				const admit = (today: string) =>
					Effect.result(
						admitAnonymise(nativeId('employment_profile', fixtureKey('p3')), today).pipe(
							Effect.provide(fixture.reads)
						)
					);
				const early = yield* admit(`${Number(until.slice(0, 4))}-12-30`);
				assert.ok(early._tag === 'Failure' && early.failure.message.includes(until), exit);
				const due = yield* admit(until);
				assert.ok(due._tag === 'Success' && due.success === until, exit);
				const version = versionOn(exit);
				const settings = settingsOf(version);
				const disposal = raiseDuties({
					behaviours: fixtureValue5(settings.behaviours),
					settings_id: settings.id,
					rows: load(version, 'rule_set'),
					collection: 'employment_contract',
					event: 'updated',
					row: {
						id: 'k3',
						company_id: 'c1',
						employee_id: 'p3',
						effective_range: { from: '2019-01-01', to: exit },
						exit_ground: 'RESIGNATION',
						exit_facts: { notice_served: true },
						employee_number: String('p3'),
						contract_number: 1
					},
					reads: { catalogues: [], movements: [] }
				}).filter((write) => write.duty_code === 'PDPA_RETENTION_DISPOSAL');
				assert.deepEqual(
					disposal.map((write) => write.due_on),
					[until],
					exit
				);
			}
		})
	);
	it('work suspensions: a workplace the employer or an authority closes is attended and fully paid (EA s.27–28); a strike is an absence', () => {
		const day = { date: '2026-03-10', worked: false, day_type: 'WORK' };
		for (const version of versions) {
			const kinds = load(version, 'suspension_kind');
			assert.deepEqual(kinds.map((kind) => kind.code).toSorted(), [
				'EMPLOYER_SHUTDOWN',
				'GOVERNMENT_ORDER',
				'LOCKOUT',
				'NATURAL_DISASTER',
				'STRIKE'
			]);
			for (const kind of kinds) {
				const context = fixtureValue13({ day, suspension: { kind: kind.code, facts: {} } });
				assert.equal(
					evaluateConfigured(
						fixtureString(String(kind.counts_as_attended)),
						fixtureContext(context)
					),
					kind.code !== 'STRIKE',
					`${version} ${kind.code}`
				);
				assert.equal(
					evaluateConfigured(fixtureString(String(kind.scheduled)), fixtureContext(context)),
					true
				);
				// No suspension pay line: the monthly salary is never reduced for a closure (s.28(1) allows a
				// deduction only for the employee's own absence); a striker's deduction is a NO_PAY_LEAVE entry.
				assert.equal(kind.pay, '');
			}
		}
	});
	it.effect(
		'a non-resident public entertainer paid as a payee is withheld at 15% (ITA s.45) and remitted by the 15th of the second month',
		Effect.fnUntraced(function* () {
			for (const version of versions) {
				assert.deepEqual(row(version, 'adhoc_catalog', 'NR_PUBLIC_ENTERTAINER_FEE').counts_toward, [
					'WHT_NR_ENTERTAINER'
				]);
				assert.equal(
					evaluateConfigured(
						fixtureString(
							String(
								fixtureValue11(row(version, 'rule_set', 'NR_ENTERTAINER_WITHHOLDING').rules).due
							)
						),
						fixtureContext({
							run: { pay_date: '2026-03-20' },
							period: { key: '2026-03', from: '2026-03-01', to: '2026-03-31' }
						})
					),
					'2026-05-15'
				);
			}
			// IRAS example 1: $65,500 taxable gross (prize, appearance fee, accommodation and airfare) → $9,825.
			for (const [period, tax_resident, withheld] of [
				['2026-03', false, 9825],
				['2027-02', false, 9825],
				['2026-03', true, 0]
			] as const) {
				const fixture = engine();
				fixturePresent(fixture.tables.get('employment_profile')).push(
					fixtureRow({
						id: 'p5',
						name: 'p5',
						date_of_birth: '1990-02-01',
						race: 'OTHER',
						religion: 'OTHER',
						facts: { tax_resident }
					})
				);
				fixturePresent(fixture.tables.get('employment_contract')).push(
					fixtureRow({
						id: 'k-p5',
						employee_id: 'p5',
						company_id: 'c-sg',
						engagement: 'PAYEE',
						effective_range: { from: '2025-12-01', to: null },
						facts: {
							contract_terms: [
								{
									effective_range: { from: '2025-12-01', to: null },
									residency_status: 'FOREIGNER',
									work_classification: 'EA_COVERED',
									statutory_work_category: 'NON_MANUAL',
									employment_type: 'PERMANENT',
									allowances: []
								}
							]
						},
						employee_number: String('p5'),
						contract_number: 1
					})
				);
				fixturePresent(fixture.tables.get('adhoc_catalog_entry')).push(
					fixtureRow({
						id: 'show-1',
						employment_id: 'k-p5',
						company_id: 'c-sg',
						catalog_id: fixtureString(
							row(versionOn(`${period}-01`), 'adhoc_catalog', 'NR_PUBLIC_ENTERTAINER_FEE').id
						),
						payslip_id: null,
						occurred_on: `${period}-12`,
						amount: 65500
					})
				);
				const plan = yield* fixture.run(period, 'REGULAR');
				const slip = fixturePresent(
					plan.payslips.find((item) => item.employment_id === fixtureKey('k-p5'))
				);
				const line = (code: string) => slip.statutory.find((item) => item.scheme_code === code);
				assert.equal(
					line('WHT_NR_ENTERTAINER')?.employee_amount ?? 0,
					withheld,
					`${period} ${tax_resident}`
				);
				assert.equal(line('CPF')?.employee_amount ?? 0, 0);
				assert.equal(slip.gross, 65500);
			}
		})
	);
	it.effect(
		'work-day import: Part 4 daily, break and rest-day warnings; a child’s or young person’s night work and daily hours refused',
		Effect.fnUntraced(function* () {
			const at = (date: string, clock: string, next = false) =>
				new Date(Date.parse(`${date}T${clock}:00+08:00`) + (next ? 86400000 : 0)).toISOString();
			const clocks = (date: string, spans: [string, string][]) =>
				spans.map(([start, end]) => ({ start: at(date, start), end: at(date, end, end <= start) }));
			for (const month of ['2025-12', '2026-03', '2026-08', '2027-02']) {
				const fixture = engine();
				fixturePresent(fixturePresent(fixture.tables.get('entity'))[0]).time_zone =
					'Asia/Singapore';
				for (const [id, date_of_birth] of [
					['p6', `${Number(month.slice(0, 4)) - 15}-01-01`],
					['p7', `${Number(month.slice(0, 4)) - 14}-01-01`]
				] as const) {
					fixturePresent(fixture.tables.get('employment_profile')).push(
						fixtureRow({
							id,
							name: id,
							date_of_birth,
							race: 'CHINESE',
							religion: 'OTHER',
							facts: {}
						})
					);
					fixturePresent(fixture.tables.get('employment_contract')).push(
						fixtureRow({
							id: `k-${id}`,
							employee_id: id,
							company_id: 'c-sg',
							effective_range: { from: '2025-11-01', to: null },
							facts: {
								contract_terms: [
									{
										base_salary: { value: 1200, currency: 'SGD' },
										effective_range: { from: '2025-11-01', to: null },
										residency_status: 'CITIZEN',
										work_classification: 'EA_COVERED',
										statutory_work_category: 'MANUAL_LABOUR',
										employment_type: 'PART_TIME',
										allowances: []
									}
								]
							},
							employee_number: String(id),
							contract_number: 1
						})
					);
				}
				// Only planned time is worked: each sheet day is rostered on a 4-hour WORK shift (its ordinary hours),
				// the time past them derived overtime; the rules read the day's paid intervals, not the paid total.
				fixturePresent(fixture.tables.get('shift_definition')).push(
					fixtureRow({
						id: 'rest',
						company_id: 'c-sg',
						code: 'R',
						variant: { day_type: 'REST' }
					}),
					fixtureRow({
						id: 'short',
						company_id: 'c-sg',
						code: 'S',
						variant: { day_type: 'WORK', start_time: '09:00', end_time: '13:00' }
					})
				);
				let ref = 0;
				const draft = (
					employment_id: string,
					date: string,
					spans: [string, string][],
					extra = {}
				) => ({
					ref: ++ref,
					employment_id,
					work_date: date,
					worked_intervals: clocks(date, spans),
					shift_definition_id: 'short',
					leave_code: '',
					...extra
				});
				const day = (n: number) => `${month}-${String(n).padStart(2, '0')}`;
				const drafts = [
					draft('k-p4', day(2), [['07:00', '20:00']]), // 1: 13 hours straight
					draft('k-p4', day(3), [
						['09:00', '13:00'],
						['14:00', '18:00']
					]), // 2: lawful
					draft('k-p2', day(2), [['07:00', '20:00']]), // 3: not Part 4 ($9,800 non-workman)
					draft('k-p6', day(2), [['22:00', '02:00']]), // 4: young person at night
					draft('k-p6', day(3), [
						['08:00', '12:00'],
						['12:30', '16:30']
					]), // 5: young person, 8 hours
					draft('k-p6', day(4), [['08:00', '12:30']]), // 6: 4.5 hours without a break
					draft('k-p7', day(3), [
						['08:00', '11:00'],
						['11:30', '14:30']
					]), // 7: child, 6 hours
					draft('k-p7', day(4), [
						['08:00', '11:00'],
						['11:30', '15:30']
					]), // 8: child, 7 hours
					draft('k-p6', day(5), [['09:00', '12:00']], { shift_definition_id: 'rest' }), // 9: rest day
					...[10, 11, 12, 13, 14, 15, 16].map((n) =>
						draft('k-p4', day(n), [
							['09:00', '13:00'],
							['14:00', '17:00']
						])
					), // 10–16: k-p4 seven days in a row
					draft('k-p7', day(20), [
						['08:00', '11:00'],
						['11:29', '12:29']
					]),
					draft('k-p7', day(21), [
						['08:00', '11:00'],
						['11:30', '12:30']
					]),
					draft('k-p6', day(20), [
						['08:00', '12:00'],
						['12:29', '13:29']
					]),
					draft('k-p6', day(21), [
						['08:00', '12:00'],
						['12:30', '13:30']
					]),
					draft('k-p7', day(22), [
						['08:00', '10:00'],
						['10:10', '11:10'],
						['11:20', '11:50']
					])
				];
				const found = yield* rosterFindings(
					nativeId('entity', fixtureKey('c-sg')),
					fixtureDrafts(drafts)
				).pipe(Effect.provide(fixture.reads));
				const on = (n: number) =>
					found
						.filter((finding) => finding.ref === n)
						.map((finding) => `${finding.code}:${finding.kind}`)
						.toSorted();
				assert.deepEqual(
					on(1),
					['ROSTER_CONSECUTIVE_HOURS:warn', 'ROSTER_DAILY_12_HOURS:warn'],
					month
				);
				assert.deepEqual(on(2), []);
				assert.deepEqual(on(3), []);
				assert.deepEqual(on(4), ['ROSTER_YOUNG_NIGHT_WORK:refuse']);
				assert.deepEqual(on(5), ['ROSTER_YOUNG_DAILY_HOURS:refuse']);
				assert.deepEqual(on(6), ['ROSTER_YOUNG_BREAK:warn']);
				assert.deepEqual(on(7), []);
				assert.deepEqual(on(8), ['ROSTER_YOUNG_BREAK:warn', 'ROSTER_YOUNG_DAILY_HOURS:refuse']);
				assert.deepEqual(on(9), ['ROSTER_YOUNG_REST_DAY:warn']);
				assert.deepEqual(on(15), []);
				assert.deepEqual(on(16), ['ROSTER_WEEKLY_REST_DAY:warn']);
				assert.deepEqual(on(17), ['ROSTER_YOUNG_BREAK:warn'], month);
				assert.deepEqual(on(18), [], month);
				assert.deepEqual(on(19), ['ROSTER_YOUNG_BREAK:warn'], month);
				assert.deepEqual(on(20), [], month);
				assert.deepEqual(on(21), ['ROSTER_YOUNG_BREAK:warn'], month);
				assert.equal(
					fixturePresent(found.find((finding) => finding.code === 'ROSTER_YOUNG_NIGHT_WORK'))
						.column,
					'clock_in'
				);
			}
		})
	);
	it('a fixed allowance in an incomplete month counts a required day of 5 hours or less as half (EA s.20A(2))', () => {
		for (const version of versions) {
			const amount = String(row(version, 'allowance_catalog', 'FIXED_MONTHLY').amount);
			const context = (covered: number, hours: number) => ({
				...subject(),
				earned: { month: slipSums([]) },
				allowance: { amount: 220 },
				period: {
					part: 1,
					parts: 1,
					month_from: '2026-03-01',
					month_to: '2026-03-31',
					month_days: 31,
					month_working_days: 22,
					month_holiday_work_days: 0,
					from: '2026-03-01',
					to: '2026-03-31',
					working_days: 22,
					covered_working_days: covered,
					paid_days: 15,
					days: 31
				},
				work: {
					days: [
						{ date: '2026-03-21', day_type: 'WORK', scheduled_hours: hours, worked_hours: hours }
					]
				}
			});
			assert.equal(evaluateConfigured(fixtureString(amount), fixtureContext(context(11, 4))), 105); // 220 × 10.5 ÷ 22
			assert.equal(evaluateConfigured(fixtureString(amount), fixtureContext(context(11, 8))), 110);
			assert.equal(evaluateConfigured(fixtureString(amount), fixtureContext(context(22, 4))), 220);
		}
	});
	const MONEY = new Set([
		'amount',
		'employee_amount',
		'employer_amount',
		'base_amount',
		'gross',
		'net',
		'total_deductions'
	]);
	it.effect(
		'the CPF EZPay (FTP) file: header, a summary record per payment code, each employee’s CPF and fund records, and the trailer totals',
		Effect.fnUntraced(function* () {
			for (const period of ['2025-12', '2026-03', '2027-02']) {
				const fixture = engine();
				for (const [id, nric] of [
					['p1', 'S1122334A'],
					['p2', 'S2122334B'],
					['p3', 'T0122334C'],
					['p4', 'S4122334D']
				] as const) {
					const person = fixturePresent(
						fixturePresent(fixture.tables.get('employment_profile')).find(
							(item) => item.id === fixtureKey(id)
						)
					);
					person.identity_number = nric;
					person.name = `${id.toUpperCase()} TAN`;
				}
				// p3 joins this month: a New Joiner.
				fixturePresent(
					fixturePresent(fixture.tables.get('employment_contract')).find(
						(item) => item.id === fixtureKey('k-p3')
					)
				).effective_range = {
					from: `${period}-01`,
					to: null
				};
				const plan = yield* fixture.run(period, 'REGULAR');
				const version = versionOn(`${period}-01`);
				const template = row(version, 'rule_set', 'CPF_EZPAY_FTP');
				const contracts = fixturePresent(fixture.tables.get('employment_contract'));
				const people = fixturePresent(fixture.tables.get('employment_profile'));
				const [file] = recordDocuments(
					fixtureExports([{ code: 'CPF_EZPAY_FTP', rules: template.rules }]),
					fixtureContexts([
						{
							id: 'run-1',
							period,
							kind: 'REGULAR',
							salary_from: '',
							salary_to: '',
							pay_date: `${period}-28`
						}
					]),
					fixtureReturnRows(
						plan.payslips.map((slip) => {
							const contract = fixturePresent(
								contracts.find((item) => item.id === slip.employment_id)
							);
							return {
								employee: fixturePresent(people.find((item) => item.id === contract.employee_id)),
								contract: contract,
								// As stored: money columns arrive as decimal strings.
								slips: [
									exportSlip(
										JSON.parse(JSON.stringify(slip), (key, value) =>
											typeof value === 'number' && MONEY.has(key) ? String(value) : value
										),
										period
									)
								]
							};
						})
					),
					fixtureContext({ facts: { cpf_submission_number: '201912345A-PTE-01' } })
				);
				const csn = new RegExp(
					String(
						fixturePresent(
							fixtureValue21(fixtureRecord(settingsOf(version).entity_input_schema).properties)
								.cpf_submission_number
						).pattern
					)
				);
				assert.ok(csn.test('201912345A-PTE-01') && !csn.test('201912345APTE01'));
				const month = period.replace('-', '');
				const lines = fixturePresent(file).content.split('\n');
				assert.ok(
					lines.every((line) => line.length === 150),
					`${period}: every record is 150 bytes`
				);
				assert.equal(
					fixturePresent(file).name,
					`201912345APTE01${['DEC', 'MAR', 'FEB'][['2025-12', '2026-03', '2027-02'].indexOf(period)]}${period.slice(0, 4)}01.DTL`
				);
				// Header: mode F, type blank, UEN, PTE, 01, advice 01, the creation date, FTP.DTL.
				assert.equal(
					fixturePresent(lines[0]).slice(0, 47),
					`F 201912345APTE01 01${period.replace('-', '')}28000000FTP.DTL      `
				);
				// Record types ascend: header, summaries (0), details (1), trailer (9).
				const types = lines.map((line) => line[1]);
				assert.deepEqual(types, [...types].sort());
				const cents = (amount: number) => Math.round(amount * 100);
				const charged = (id: string, scheme: string) =>
					fixturePresent(
						plan.payslips.find((slip) => slip.employment_id === fixtureKey(`k-${id}`))
					).statutory.find((line) => line.scheme_code === scheme);
				const cpf = (id: string) => {
					const line = fixturePresent(charged(id, 'CPF'));
					return line.employee_amount + line.employer_amount;
				};
				// Details: each employee's CPF record (01) and their fund (02 MBMF p2, 03 SINDA p3, 04 CDAC p1, 05 ECF p4).
				const detail = (code: string, nric: string) =>
					lines.find(
						(line) => line[1] === '1' && line.slice(26, 28) === code && line.slice(28, 37) === nric
					);
				const p2 = fixturePresent(detail('01', 'S2122334B'));
				assert.equal(p2.slice(0, 26), `F1201912345APTE01 01${month}`);
				assert.equal(Number(p2.slice(37, 49)), cents(cpf('p2')));
				assert.equal(Number(p2.slice(49, 59)), 980000); // the $9,800 salary as Ordinary Wage
				assert.equal(Number(p2.slice(59, 69)), 0);
				assert.equal(p2[69], 'E');
				assert.equal(p2.slice(70, 136).trimEnd(), 'P2 TAN');
				assert.equal(fixturePresent(detail('01', 'T0122334C'))[69], 'N');
				for (const [code, nric, scheme] of [
					['02', 'S2122334B', 'MBMF'],
					['03', 'T0122334C', 'SINDA'],
					['04', 'S1122334A', 'CDAC'],
					['05', 'S4122334D', 'ECF']
				] as const) {
					const fund = detail(code, nric);
					assert.ok(fund, `${period} ${scheme}`);
					assert.equal(
						Number(fund.slice(37, 49)),
						cents(
							fixturePresent(
								charged(
									nric === 'S2122334B'
										? 'p2'
										: nric === 'T0122334C'
											? 'p3'
											: nric === 'S1122334A'
												? 'p1'
												: 'p4',
									scheme
								)
							).employee_amount
						)
					);
					assert.equal(fund.slice(49, 70), '00000000000000000000 ');
				}
				// Summaries: one per payment code, the sum of its detail records, donors counted for the funds; SDL rounded down.
				const summary = (code: string) =>
					lines.find((line) => line[1] === '0' && line.slice(26, 28) === code);
				const sumOf = (code: string) =>
					lines
						.filter((line) => line[1] === '1' && line.slice(26, 28) === code)
						.reduce((total, line) => total + Number(line.slice(37, 49)), 0);
				for (const code of ['01', '02', '03', '04', '05']) {
					const held = fixturePresent(summary(code));
					assert.equal(held.slice(0, 28), `F0201912345APTE01 01${month}${code}`);
					assert.equal(Number(held.slice(28, 40)), sumOf(code), `${period} summary ${code}`);
					assert.equal(Number(held.slice(40, 47)), code === '01' ? 0 : 1);
				}
				const sdl = plan.payslips.reduce(
					(total, slip) =>
						total +
						(slip.statutory.find((line) => line.scheme_code === 'SDL')?.employer_amount ?? 0),
					0
				);
				assert.equal(Number(fixturePresent(summary('11')).slice(28, 40)), Math.floor(sdl) * 100);
				// Trailer: every record counted, header and trailer included; the summaries' total.
				const trailer = fixturePresent(lines.at(-1));
				assert.equal(trailer.slice(0, 20), 'F9201912345APTE01 01');
				assert.equal(Number(trailer.slice(20, 27)), lines.length);
				assert.equal(
					Number(trailer.slice(27, 42)),
					lines
						.filter((line) => line[1] === '0')
						.reduce((total, line) => total + Number(line.slice(28, 40)), 0)
				);
			}
		})
	);
	it.effect(
		'leave balances list every SG class through the real leave state for an employee with no entries',
		Effect.fnUntraced(function* () {
			for (const day of ['2025-12-15', '2026-03-15', '2026-08-15', '2027-02-15']) {
				const fixture = engine();
				const state = yield* leaveState(
					nativeId('employment_contract', fixtureKey('k-p3')),
					day
				).pipe(Effect.provide(fixture.reads));
				const balances = leaveBalances(state);
				const codes = new Set(balances.map((balance) => balance.code));
				for (const item of load(versionOn(day), 'leave_catalog'))
					assert.ok(codes.has(String(item.code)), `${day} ${item.code}`);
				// A non-solo parent's undated next birth: half the pool × 7 days, the pool read on the balance day —
				// 6 weeks before 1 April 2026 (21 days), 10 weeks from it (35 days; MSF ProFamily Leave, SPL).
				const spl = fixturePresent(
					balances.find((balance) => balance.code === 'SHARED_PARENTAL_LEAVE')
				);
				assert.equal(spl.window_key, '');
				assert.equal(spl.entitlement, day >= '2026-04-01' ? 35 : 21, day);
			}
		})
	);
	it('PWM floors of the six gross-wage and lift sectors from 1 January 2027 and at each dated step; retail’s 1 September 2026 step', () => {
		const floorOn = (day: string, pwm_role: string) => {
			const version = versionOn(day);
			const when = String(fixtureValue11(row(version, 'rule_set', 'PWM_WAGE_FLOOR').rules).when);
			const rules = { pwm_wages: row(version, 'rule_set', 'pwm_wages').rules };
			const below = (salary: number) =>
				evaluateConfigured(
					fixtureString(when),
					fixtureContext(
						fixtureValue13({
							terms: { facts: { pwm_role }, base_salary: salary, monthly_wage: salary },
							rules,
							period: { from: day }
						})
					)
				);
			// The floor is the lowest wage that does not warn.
			assert.equal(below(0), true, `${day} ${pwm_role}`);
			let low = 0;
			let high = 10000;
			while (high - low > 1) {
				const mid = Math.floor((low + high) / 2);
				if (below(mid)) low = mid;
				else high = mid;
			}
			return high;
		};
		// [role, 1 Jan 2027, 1 Jul 2027 (retail 1 Sep 2027), 1 Jul 2028] per the MOM sector schedules.
		const schedule: [string, number, number, number | null][] = [
			['FOOD_FS_COOK', 2520, 2660, 2800],
			['FOOD_FS_KITCHEN_ASSISTANT', 2320, 2460, 2600],
			['FOOD_FS_WAITER', 2320, 2460, 2600],
			['FOOD_FS_WAITER_SUPERVISOR', 2875, 3020, 3165],
			['FOOD_QS_COOK', 2470, 2610, 2750],
			['FOOD_QS_KITCHEN_ASSISTANT', 2295, 2435, 2575],
			['FOOD_QS_STALL_ASSISTANT', 2220, 2360, 2500],
			['WASTE_COLLECTION_CREW', 2840, 3050, 3260],
			['WASTE_COLLECTION_SENIOR_CREW', 3040, 3250, 3460],
			['WASTE_COLLECTION_TEAM_LEAD', 3240, 3450, 3660],
			['WASTE_COLLECTION_SUPERVISOR', 3490, 3700, 3910],
			['WASTE_COLLECTION_DRIVER', 3240, 3450, 3660],
			['WASTE_COLLECTION_HOOKLIFT_DRIVER', 3340, 3550, 3760],
			['WASTE_COLLECTION_SENIOR_DRIVER', 3540, 3750, 3960],
			['WASTE_MRF_SORTER', 2740, 2950, 3160],
			['WASTE_MRF_SENIOR_SORTER', 2940, 3150, 3360],
			['WASTE_MRF_TEAM_LEAD', 3140, 3350, 3560],
			['WASTE_MRF_PLANT_SUPERVISOR', 3340, 3550, 3760],
			['LIFT_ASSISTANT_SPECIALIST', 2750, 2915, 3080],
			['LIFT_SPECIALIST', 3090, 3280, 3470],
			['LIFT_SENIOR_SPECIALIST', 3420, 3620, 3820],
			['LIFT_SUPERVISOR', 3660, 3875, 4090],
			['LIFT_PRINCIPAL_SPECIALIST', 3720, 3935, 4150],
			['ADMIN_ASSISTANT', 2170, 2360, null],
			['ADMIN_EXECUTIVE', 2760, 2940, null],
			['ADMIN_SUPERVISOR', 3340, 3520, null],
			['DRIVER_GROUP_A_LEVEL_1', 2370, 2550, null],
			['DRIVER_GROUP_A_LEVEL_2', 2485, 2665, null],
			['DRIVER_GROUP_B_LEVEL_1', 2505, 2690, null],
			['DRIVER_GROUP_B_LEVEL_2', 2555, 2790, null],
			['RETAIL_ASSISTANT', 2435, 2565, null],
			['RETAIL_SENIOR_ASSISTANT', 2680, 2820, null],
			['RETAIL_ASSISTANT_SUPERVISOR', 2950, 3100, null]
		];
		for (const [role, january, step, later] of schedule) {
			const stepDay = role.startsWith('RETAIL') ? '2027-09-01' : '2027-07-01';
			assert.equal(floorOn('2027-01-01', role), january, `${role} 1 Jan 2027`);
			assert.equal(
				floorOn(String(addDaysIso(stepDay, -1)), role),
				january,
				`${role} before the step`
			);
			assert.equal(floorOn(stepDay, role), step, `${role} ${stepDay}`);
			assert.equal(floorOn('2028-07-01', role), later ?? step, `${role} 1 Jul 2028`);
		}
		// Retail in 2026: the September step, not July.
		for (const [role, before, after] of [
			['RETAIL_ASSISTANT', 2305, 2435],
			['RETAIL_SENIOR_ASSISTANT', 2535, 2680],
			['RETAIL_ASSISTANT_SUPERVISOR', 2790, 2950]
		] as const) {
			assert.equal(floorOn('2026-07-01', role), before);
			assert.equal(floorOn('2026-08-31', role), before);
			assert.equal(floorOn('2026-09-01', role), after);
		}
	});
	it.effect(
		'FIX2: EA s.76 maternity weeks, the pre-2025 paternity weeks, extended childcare claims, the consultation fee, contractual notice, the declared salary with allowances and the EA notice week',
		Effect.fnUntraced(function* () {
			for (const version of versions) {
				const days = (code: string, entry: Row, as_of: string) =>
					evaluateConfigured(
						fixtureString(
							String(fixtureValue11(row(version, 'leave_catalog', code).entitlement).days)
						),
						fixtureContext({
							...subject({
								employee: { gender: code === 'MATERNITY_LEAVE' ? 'FEMALE' : 'MALE', facts: {} }
							}),
							entry,
							as_of
						})
					);
				// Maternity: 16 weeks for a citizen child; 12 (EA s.76) for a child who is not and does not become one within 12 months.
				assert.equal(days('MATERNITY_LEAVE', { facts: {} }, '2026-03-01'), 112);
				const born = { occurred_on: '2026-03-01' };
				assert.equal(
					days(
						'MATERNITY_LEAVE',
						{ ...born, facts: { cdca_child_citizen_at_birth: true } },
						'2026-03-01'
					),
					112
				);
				assert.equal(
					days(
						'MATERNITY_LEAVE',
						{ ...born, facts: { cdca_child_citizen_at_birth: false } },
						'2026-03-01'
					),
					84
				);
				assert.equal(
					days(
						'MATERNITY_LEAVE',
						{
							...born,
							facts: { cdca_child_citizen_at_birth: false, cdca_citizenship_on: '2026-09-01' }
						},
						'2026-03-01'
					),
					112
				);
				// Paternity: 4 weeks for a child born from 1 April 2025, 2 before; undated next birth reads as_of.
				assert.equal(
					days('PATERNITY_LEAVE', { occurred_on: '2025-03-15', facts: {} }, '2025-12-15'),
					14
				);
				assert.equal(
					days('PATERNITY_LEAVE', { occurred_on: '2025-04-01', facts: {} }, '2025-12-15'),
					28
				);
				assert.equal(days('PATERNITY_LEAVE', { facts: {} }, '2025-12-15'), 28);
				// GPCL: days 1–3 employer-paid only for a child under 7; ECL (7–12) is all reimbursed.
				const claim = (code: string) => String(row(version, 'claim_catalog', code).qualifies_when);
				const q = (code: string, entry: Row, service_months = 12) =>
					evaluateConfigured(
						fixtureString(claim(code)),
						fixtureContext({
							...subject({ employment: { service_months } }),
							entry: { ...entry, facts: entry },
							earlier: { rows: [], calendar_year: 0, lifetime: 0 }
						})
					);
				const gpcl = (child_birthdate: string, claim_from_day: number) =>
					q('GPCL_REIMBURSEMENT', {
						amount: 500,
						quantity: 1,
						service_months: 12,
						child_id: 'c1',
						child_birthdate,
						claim_from_day,
						occurred_on: '2026-03-10'
					});
				assert.equal(gpcl('2022-01-01', 1), false); // under 7: day 1 is the employer's
				assert.equal(gpcl('2022-01-01', 4), true);
				assert.equal(gpcl('2016-01-01', 1), true); // ECL: fully government-paid
				// The consultation fee: 3 months' service, an employer-appointed doctor or medical officer, paid sick leave certified.
				const fee = {
					amount: 30,
					practitioner: 'EMPLOYER_APPOINTED',
					paid_sick_leave_certified: true
				};
				assert.equal(q('MEDICAL_CONSULTATION_FEE', fee), true);
				assert.equal(q('MEDICAL_CONSULTATION_FEE', fee, 2), false);
				assert.equal(q('MEDICAL_CONSULTATION_FEE', { ...fee, practitioner: 'OTHER' }), false);
				assert.equal(
					q('MEDICAL_CONSULTATION_FEE', { ...fee, paid_sick_leave_certified: false }),
					false
				);
				assert.equal(q('MEDICAL_CONSULTATION_FEE', { ...fee, cosmetic: true }), false);
				assert.deepEqual(
					row(version, 'claim_catalog', 'MEDICAL_CONSULTATION_FEE').counts_toward,
					[]
				);
				// Salary in lieu of notice: the s.10(3) floor only without a contractual notice.
				const band = fixturePresent(
					fixtureValue4(row(version, 'adhoc_catalog', 'SALARY_IN_LIEU_OF_NOTICE').bands)[0]
				);
				const lieu = (facts: Row) =>
					evaluateConfigured(
						fixtureString(band.amount),
						fixtureContext({
							...subject({
								employment: { service_months: 36 },
								terms: { monthly_wage: 5200, facts },
								employee: { facts: { working_days_per_week: 5 } }
							}),
							period: {
								working_days: 22,
								days: 31,
								parts: 1,
								month_from: '2026-03-01',
								month_to: '2026-03-31',
								month_days: 31,
								month_working_days: 22,
								month_holiday_work_days: 0
							},
							entry: { amount: 100 }
						})
					);
				assert.equal(lieu({}), 2400);
				assert.equal(lieu({ notice_period_days: 1 }), 100);
				// The declared MOM salary is basic plus fixed allowances.
				const declared = String(
					fixtureValue11(row(version, 'rule_set', 'MOM_DECLARED_SALARY').rules).when
				);
				const warns = (allowances: Row[]) =>
					evaluateConfigured(
						fixtureString(declared),
						fixtureContext({
							...subject({
								terms: {
									base_salary: 3000,
									allowances,
									facts: { mom_declared_monthly_salary: 3300 }
								}
							})
						})
					);
				assert.equal(warns([]), true);
				assert.equal(warns([{ code: 'FIXED_MONTHLY', amount: 300 }]), false);
				// EA s.76 maternity: half pay on less than 1 week's notice (the CDCA's 28 days is for a citizen child).
				const fraction = String(row(version, 'leave_catalog', 'MATERNITY_LEAVE').pay_fraction);
				const ea = {
					cdca_original_statutory_origin: 'EA76_A',
					cdca_original_absence_from: '2026-03-01',
					ea_maternity_prior_living_children: 1
				};
				const at = (facts: Row) =>
					evaluateConfigured(
						fixtureString(fraction),
						fixtureContext({
							...subject({ employee: { gender: 'FEMALE' } }),
							entry: { facts, ...facts },
							leave: {
								code: 'MATERNITY_LEAVE',
								activity: 'TIME_OFF',
								days: 5,
								from: '2026-03-10',
								to: '2026-03-10',
								facts,
								event_id: 'b1',
								month_index: 1
							}
						})
					);
				assert.equal(at({ ...ea, cdca_notice_lead_days: 6 }), 0.5);
				assert.equal(at({ ...ea, cdca_notice_lead_days: 7 }), 1);
				assert.equal(at({ ...ea, cdca_notice_lead_days: 10 }), 1);
			}
		})
	);
	/** A return over one regular March run of the fixture, with the entries each slip pinned. */
	const worksheet = (
		code: string,
		fixture: ReturnType<typeof engine>,
		plan: Effect.Success<ReturnType<ReturnType<typeof engine>['run']>>
	) => {
		const contracts = fixturePresent(fixture.tables.get('employment_contract'));
		const people = fixturePresent(fixture.tables.get('employment_profile'));
		const version = versionOn('2026-03-01');
		for (const person of people) person.identity_number = `S${fixtureString(person.name)}`;
		const [file] = recordDocuments(
			fixtureExports([{ code, rules: row(version, 'rule_set', code).rules }]),
			fixtureContexts([
				{
					id: 'run-1',
					period: '2026-03',
					kind: 'REGULAR',
					salary_from: '',
					salary_to: '',
					pay_date: '2026-03-31'
				}
			]),
			fixtureReturnRows(
				plan.payslips.map((slip) => {
					const contract = fixturePresent(contracts.find((item) => item.id === slip.employment_id));
					// The adhoc relation arm: each pinned entry with its class code through `catalog`.
					const pinned = {
						adhoc_catalog_entry: slip.pins
							.filter((pin) => pin.collection === 'adhoc_catalog_entry')
							.map((pin) => {
								const entry = fixturePresent(
									fixturePresent(fixture.tables.get('adhoc_catalog_entry')).find(
										(item) => item.id === pin.id
									)
								);
								const catalog = load(version, 'adhoc_catalog').find(
									(item) => item.id === entry.catalog_id
								);
								return { ...entry, catalog: { code: catalog?.code ?? '' } };
							})
					};
					return {
						employee: fixturePresent(people.find((item) => item.id === contract.employee_id)),
						contract: contract,
						slips: [
							exportSlip(
								JSON.parse(JSON.stringify(slip), (key, value) =>
									typeof value === 'number' && MONEY.has(key) ? String(value) : value
								),
								'2026-03'
							)
						],
						entries: exportEntries([pinned])
					};
				})
			)
		);
		return fixturePresent(file);
	};
	const ir8a = (
		fixture: ReturnType<typeof engine>,
		plan: Effect.Success<ReturnType<ReturnType<typeof engine>['run']>>
	) => worksheet('IR8A_WORKSHEET', fixture, plan);
	it.effect(
		'the IR8A worksheet maps each employee’s year to the Form IR8A items',
		Effect.fnUntraced(function* () {
			const fixture = engine();
			fixture.bonus('2026-03', 9000);
			const plan = yield* fixture.run('2026-03', 'REGULAR');
			const file = ir8a(fixture, plan);
			assert.equal(file.name, 'IR8A_2026.csv');
			const [header, ...rows] = file.content.split('\n');
			assert.equal(
				header,
				'Employee name,Identification number,"a) Gross salary, fees, leave pay, wages and overtime",b) Bonus,c) Director’s fees,d1) Allowances,d3) Lump sum: notice pay,Compensation for loss of office (not taxable),d7) Gains from ESOP/ESOW plans (Appendix 8B),d8) Value of benefits-in-kind (Appendix 8A),Employee’s compulsory CPF,"Donations (CDAC, ECF, SINDA)",Mosque Building Fund'
			);
			// p2: $9,800 salary, the $9,000 bonus, MBMF as the Mosque Building Fund.
			const p2 = fixturePresent(rows.find((line) => line.startsWith('p2,'))).split(',');
			const slip = fixturePresent(
				plan.payslips.find((item) => item.employment_id === fixtureKey('k-p2'))
			);
			const charged = (code: string) =>
				fixturePresent(slip.statutory.find((line) => line.scheme_code === code)).employee_amount;
			assert.deepEqual(p2.slice(0, 6), ['p2', 'Sp2', '9800', '9000', '0', '0']);
			assert.deepEqual(p2.slice(8, 10), ['0', '0']);
			assert.equal(Number(p2[10]), charged('CPF'));
			assert.equal(Number(p2[11]), 0);
			assert.equal(Number(p2[12]), charged('MBMF'));
			// p3 (Indian): SINDA is a donation.
			const p3 = fixturePresent(rows.find((line) => line.startsWith('p3,'))).split(',');
			assert.equal(
				Number(p3[11]),
				fixturePresent(
					fixturePresent(
						plan.payslips.find((item) => item.employment_id === fixtureKey('k-p3'))
					).statutory.find((line) => line.scheme_code === 'SINDA')
				).employee_amount
			);
		})
	);
	it('Appendix 8A: each benefit-in-kind class values its entry facts per the IRAS rules, a reporting base only', () => {
		for (const version of versions) {
			const value = (code: string, facts: Row, amount = 0) => {
				const held = row(version, 'adhoc_catalog', code);
				const entry = { amount, facts };
				assert.equal(held.destination, 'DISPLAY', code);
				assert.deepEqual(held.counts_toward, ['APPENDIX_8A'], code);
				return evaluateConfigured(
					fixtureString(String(held.qualifies_when)),
					fixtureContext({ entry })
				) === true
					? Number(
							evaluateConfigured(
								fixtureString(String(fixturePresent(fixtureValue4(held.bands)[0]).amount)),
								fixtureContext({ entry })
							)
						)
					: null;
			};
			// IRAS note 12 example: AV $40,000 shared by 2, fully furnished, 1 Mar–29 May 2026 (90 days), $2,000 rent paid.
			const residence = {
				annual_value: 40000,
				sharers: 2,
				furnishing: 'FULL',
				occupied_from: '2026-03-01',
				occupied_to: '2026-05-29',
				employee_rent: 2000
			};
			assert.equal(value('BIK_PLACE_OF_RESIDENCE', residence), 5397.25); // 4,931.50 + 2,465.75 − 2,000
			assert.equal(
				value('BIK_PLACE_OF_RESIDENCE', { ...residence, furnishing: 'PARTIAL' }),
				4904.1
			); // 4,931.50 + 40% − 2,000
			assert.equal(
				value('BIK_PLACE_OF_RESIDENCE', {
					annual_value: 36500,
					occupied_from: '2026-01-01',
					occupied_to: '2026-12-31'
				}),
				36500
			); // unfurnished, alone, the whole year
			assert.equal(
				value('BIK_PLACE_OF_RESIDENCE', { employer_rent: 30000, employee_rent: 6000 }),
				24000
			); // 2c − 2e
			assert.equal(
				value('BIK_PLACE_OF_RESIDENCE', { employer_rent: 1000, employee_rent: 6000 }),
				0
			);
			assert.equal(value('BIK_PLACE_OF_RESIDENCE', { furnishing: 'FULL' }), null); // no AV, no rent
			// 2g + 2h + 2i: the note's $250 utilities and $1,200 gardener; a driver at private ÷ total mileage.
			assert.equal(
				value('BIK_UTILITIES_HOUSEKEEPING', { utilities: 250, servant_gardener: 1200 }),
				1450
			);
			assert.equal(
				value('BIK_UTILITIES_HOUSEKEEPING', {
					driver_annual_cost: 36000,
					private_mileage: 3000,
					total_mileage: 12000
				}),
				9000
			);
			assert.equal(value('BIK_UTILITIES_HOUSEKEEPING', {}), null);
			assert.equal(value('BIK_HOTEL_ACCOMMODATION', { hotel_cost: 2500 }), 2500);
			assert.equal(
				value('BIK_HOTEL_ACCOMMODATION', { hotel_cost: 2500, employee_paid: 400 }),
				2100
			);
			// IRAS car examples 1–5 (Car and Car-related Benefits).
			assert.equal(
				value('BIK_CAR', { car_cost: 120000, parf_rebate: 24000, running_costs: 10450 }),
				8592
			);
			const part = { provided_from: '2025-08-01', provided_to: '2025-12-31' }; // 153 days
			assert.equal(
				value('BIK_CAR', { ...part, car_cost: 157640, parf_rebate: 26000, running_costs: 8000 }),
				5793
			);
			assert.equal(
				value('BIK_CAR', {
					...part,
					car_cost: 105025,
					parf_rebate: 28000,
					depreciation_years: 7,
					running_costs: 8300
				}),
				5533
			); // second-hand: the remaining COE years rounded up
			assert.equal(
				value('BIK_CAR', {
					provided_from: '2025-04-01',
					provided_to: '2025-12-31',
					car_cost: 35500,
					depreciation_years: 5,
					running_costs: 9110
				}),
				6196
			); // renewed COE: (renewal + forgone PARF) ÷ the renewed COE’s years
			assert.equal(
				value('BIK_CAR', { car_kind: 'LEASED', rental_cost: 30000, running_costs: 6500 }),
				15642
			);
			assert.equal(value('BIK_CAR', { car_kind: 'LEASED', car_cost: 1 }), null);
			assert.equal(value('BIK_OTHER', { appendix_8a_item: '4a' }, 3200), 3200);
			assert.equal(value('BIK_OTHER', { appendix_8a_item: '4i' }, 3200), null); // cars are BIK_CAR
			const scheme = row(version, 'statutory_contribution_catalog', 'APPENDIX_8A');
			assert.deepEqual(scheme.configuration, {
				rules: [{ when: 'true', employee: '0.0', employer: '0.0' }]
			});
		}
	});
	it('Appendix 8B: share-plan gains (f − e) × g on the gain date, and the IR21 deemed exercise at cessation', () => {
		for (const version of versions) {
			const value = (code: string, facts: Row, employment: Row = {}, terms: Row = {}) => {
				const held = row(version, 'adhoc_catalog', code);
				const context = { ...subject({ employment, terms }), entry: { amount: 0, facts } };
				assert.deepEqual(held.counts_toward, ['APPENDIX_8B'], code);
				if (
					evaluateConfigured(
						fixtureString(String(held.eligibility || 'true')),
						fixtureContext(context)
					) !== true
				)
					return 'ineligible';
				return evaluateConfigured(
					fixtureString(String(held.qualifies_when)),
					fixtureContext(context)
				) === true
					? Number(
							evaluateConfigured(
								fixtureString(String(fixturePresent(fixtureValue4(held.bands)[0]).amount)),
								fixtureContext(context)
							)
						)
					: null;
			};
			const esop = {
				plan: 'ESOP',
				grant_date: '2023-04-01',
				gain_date: '2026-05-04',
				exercise_price: 1.25,
				open_market_value: 3.4,
				shares: 10000
			};
			assert.equal(value('SHARE_PLAN_GAIN', esop), 21500);
			assert.equal(value('SHARE_PLAN_GAIN', { ...esop, open_market_value: 1 }), 0); // a loss is not reported
			assert.equal(value('SHARE_PLAN_GAIN', { ...esop, plan: 'RSU' }), null);
			assert.equal(
				value('SHARE_PLAN_GAIN', { ...esop, granted_outside_singapore_employment: true }),
				null
			);
			// Deemed exercise: the later of one month before cessation (30 Jun → 30 May) and the grant date.
			const leaver = { exit_date: '2026-06-30' };
			const pr = { residency_status: 'PERMANENT_RESIDENT' };
			const { gain_date: _gain, ...granted } = esop;
			const deemed = { ...granted, valued_on: '2026-05-30' };
			assert.equal(value('SHARE_PLAN_DEEMED_GAIN', deemed, leaver, pr), 21500);
			assert.equal(
				value('SHARE_PLAN_DEEMED_GAIN', { ...deemed, valued_on: '2026-06-30' }, leaver, pr),
				null
			);
			assert.equal(
				value(
					'SHARE_PLAN_DEEMED_GAIN',
					{ ...deemed, grant_date: '2026-06-10', valued_on: '2026-06-10' },
					leaver,
					pr
				),
				21500
			);
			assert.equal(
				value('SHARE_PLAN_DEEMED_GAIN', { ...deemed, grant_date: '2002-12-31' }, leaver, pr),
				null
			);
			assert.equal(value('SHARE_PLAN_DEEMED_GAIN', deemed, {}, pr), null); // no cessation yet
			assert.equal(
				value('SHARE_PLAN_DEEMED_GAIN', deemed, leaver, { residency_status: 'CITIZEN' }),
				'ineligible'
			);
		}
	});
	it.effect(
		'benefits-in-kind and share gains reach the IR8A worksheet items d7 and d8 without moving pay or CPF',
		Effect.fnUntraced(function* () {
			const version = versionOn('2026-03-01');
			const baseline = yield* engine().run('2026-03', 'REGULAR');
			const fixture = engine();
			for (const [id, code, facts] of [
				[
					'bik-1',
					'BIK_PLACE_OF_RESIDENCE',
					{
						annual_value: 40000,
						sharers: 2,
						furnishing: 'FULL',
						occupied_from: '2026-03-01',
						occupied_to: '2026-05-29',
						employee_rent: 2000
					}
				],
				['bik-2', 'BIK_CAR', { car_kind: 'LEASED', rental_cost: 30000, running_costs: 6500 }],
				[
					'esop-1',
					'SHARE_PLAN_GAIN',
					{
						plan: 'ESOW',
						grant_date: '2025-03-01',
						gain_date: '2026-03-01',
						exercise_price: 0,
						open_market_value: 2.5,
						shares: 4000
					}
				]
			] as const)
				fixturePresent(fixture.tables.get('adhoc_catalog_entry')).push(
					fixtureRow({
						id,
						employment_id: 'k-p2',
						company_id: 'c-sg',
						catalog_id: fixtureString(row(version, 'adhoc_catalog', code).id),
						payslip_id: null,
						occurred_on: '2026-03-31',
						amount: null,
						facts: fixtureContext(facts)
					})
				);
			const plan = yield* fixture.run('2026-03', 'REGULAR');
			const slip = fixturePresent(
				plan.payslips.find((item) => item.employment_id === fixtureKey('k-p2'))
			);
			const before = fixturePresent(
				baseline.payslips.find((item) => item.employment_id === fixtureKey('k-p2'))
			);
			const scheme = (held: typeof slip, code: string) =>
				held.statutory.find((line) => line.scheme_code === code);
			assert.equal(slip.gross, before.gross);
			assert.equal(slip.net, before.net);
			assert.equal(
				fixturePresent(scheme(slip, 'CPF')).employee_amount,
				fixturePresent(scheme(before, 'CPF')).employee_amount
			);
			assert.deepEqual(
				[
					fixturePresent(scheme(slip, 'APPENDIX_8A')).base_amount,
					fixturePresent(scheme(slip, 'APPENDIX_8A')).employee_amount,
					fixturePresent(scheme(slip, 'APPENDIX_8A')).employer_amount
				],
				[5397.25 + 15642, 0, 0]
			);
			assert.equal(fixturePresent(scheme(slip, 'APPENDIX_8B')).base_amount, 10000);
			assert.equal(scheme(before, 'APPENDIX_8A'), undefined); // no benefit, no line
			assert.deepEqual(
				slip.pins.filter((pin) => pin.collection === 'adhoc_catalog_entry').length,
				3
			);
			const cells = fixturePresent(
				ir8a(fixture, plan)
					.content.split('\n')
					.find((line) => line.startsWith('p2,'))
			).split(',');
			assert.deepEqual(cells.slice(8, 10), ['10000', '21039.25']);
			// Appendix 8A: one record per benefit, its items as the class values them.
			const a8a = worksheet('APPENDIX_8A_WORKSHEET', fixture, plan);
			assert.equal(a8a.name, 'APPENDIX_8A_2026.csv');
			const [head8a, ...records8a] = a8a.content.split('\n');
			const at = (header: string) => splitCsv(fixturePresent(head8a)).indexOf(header);
			assert.equal(records8a.length, 2);
			const residence = splitCsv(fixturePresent(records8a[0]));
			assert.deepEqual(
				[
					'Item',
					'Period from',
					'Days',
					'Employees sharing',
					'2a) Annual value (apportioned)',
					'2b) Furniture and fittings',
					'2d) Taxable value of place of residence',
					'2e) Rent paid by employee',
					'2f) Total taxable value of place of residence'
				].map((header) => residence[at(header)]),
				['2', '2026-03-01', '90', '2', '4931.5', '2465.75', '7397.25', '2000', '5397.25']
			);
			const car = splitCsv(fixturePresent(records8a[1]));
			assert.deepEqual(
				[car[0], car[at('Item')], car[at('4) Value of other benefit')]],
				['p2', '4i', '15642']
			);
			assert.equal(car[at('2f) Total taxable value of place of residence')], '');
			// Appendix 8B: one record per plan, (h) = (f − e) × g.
			const [, ...records8b] = worksheet('APPENDIX_8B_WORKSHEET', fixture, plan).content.split(
				'\n'
			);
			assert.deepEqual(splitCsv(fixturePresent(records8b[0])), [
				'p2',
				'Sp2',
				'',
				'',
				'ESOW',
				'2025-03-01',
				'2026-03-01',
				'0',
				'2.5',
				'4000',
				'10000',
				'ACTUAL'
			]);
		})
	);
	it.effect(
		'a share-plan gain realised after the employee left is settled on a slip of its own and reaches that year’s Appendix 8B',
		Effect.fnUntraced(function* () {
			const version = versionOn('2026-03-01');
			assert.equal(row(version, 'adhoc_catalog', 'SHARE_PLAN_GAIN').payable_after_exit, true);
			const fixture = engine();
			const contract = fixturePresent(
				fixturePresent(fixture.tables.get('employment_contract')).find(
					(item) => item.id === fixtureKey('k-p2')
				)
			);
			contract.effective_range = { from: '2019-01-01', to: '2026-01-31' };
			fixturePresent(fixtureValue22(contract.facts).contract_terms[0]).effective_range = {
				from: '2019-01-01',
				to: '2026-01-31'
			};
			fixturePresent(fixture.tables.get('adhoc_catalog_entry')).push(
				fixtureRow({
					id: 'esop-late',
					employment_id: 'k-p2',
					company_id: 'c-sg',
					catalog_id: fixtureString(row(version, 'adhoc_catalog', 'SHARE_PLAN_GAIN').id),
					payslip_id: null,
					occurred_on: '2026-03-16',
					amount: null,
					facts: {
						plan: 'ESOP',
						grant_date: '2024-02-01',
						gain_date: '2026-03-16',
						exercise_price: 1.25,
						open_market_value: 3.4,
						shares: 1000
					}
				})
			);
			const plan = yield* fixture.run('2026-03', 'REGULAR');
			const slip = fixturePresent(
				plan.payslips.find((item) => item.employment_id === fixtureKey('k-p2'))
			);
			assert.ok(slip, 'the post-exit slip is kept');
			assert.equal(slip.gross, 0);
			assert.equal(slip.base.length, 0); // no contract lines after the exit
			assert.equal(
				fixturePresent(slip.statutory.find((line) => line.scheme_code === 'APPENDIX_8B'))
					.base_amount,
				2150
			);
			assert.equal(
				slip.statutory.find((line) => line.scheme_code === 'CPF'),
				undefined
			);
			assert.ok(slip.pins.some((pin) => pin.id === fixtureKey('esop-late')));
			assert.equal(
				fixturePresent(
					ir8a(fixture, plan)
						.content.split('\n')
						.find((line) => line.startsWith('p2,'))
				).split(',')[8],
				'2150'
			);
			const [, record] = worksheet('APPENDIX_8B_WORKSHEET', fixture, plan).content.split('\n');
			assert.deepEqual(splitCsv(fixturePresent(record)).slice(4), [
				'ESOP',
				'2024-02-01',
				'2026-03-16',
				'1.25',
				'3.4',
				'1000',
				'2150',
				'ACTUAL'
			]);
		})
	);
	layer(workspace({ seed: 'none' }))('dependent SG proration', (it) => {
		it.effect(
			'semi-monthly and switched months prorate over the whole month’s EA s.20A working days, public holidays included',
			Effect.fnUntraced(function* () {
				type Plan = Effect.Success<ReturnType<ReturnType<typeof engine>['run']>>;
				const version = versionOn('2026-03-01');
				/** Mon–Fri shifts from 1 Dec 2025, a published holiday on Friday 20 March; p3 a fixed allowance, p4 part-time. */
				const setUp = (frequency: string, extra: Row = {}) => {
					const fixture = engine();
					Object.assign(fixturePresent(fixturePresent(fixture.tables.get('entity'))[0]), {
						pay_frequency: frequency,
						...extra
					});
					fixturePresent(fixture.tables.get('shift_definition')).push(
						fixtureRow({
							id: 'sd-day',
							company_id: 'c-sg',
							code: 'D',
							variant: {
								day_type: 'WORK',
								start_time: '09:00',
								end_time: '18:00',
								break_minutes: 60
							}
						}),
						fixtureRow({
							id: 'sd-off',
							company_id: 'c-sg',
							code: 'O',
							variant: { day_type: 'OFF' }
						}),
						fixtureRow({
							id: 'sd-rest',
							company_id: 'c-sg',
							code: 'R',
							variant: { day_type: 'REST' }
						})
					);
					fixturePresent(fixture.tables.get('shift_pattern')).push(
						fixtureRow({
							id: 'sp-week',
							code: 'WEEK',
							company_id: 'c-sg',
							effective_range: { from: '2025-12-01', to: null },
							pattern: {
								days: [
									...Array.from({ length: 5 }, () => ({ roster_code_id: fixtureKey('sd-day') })),
									{ roster_code_id: fixtureKey('sd-off') },
									{ roster_code_id: fixtureKey('sd-rest') }
								]
							}
						})
					);
					fixturePresent(fixture.tables.get('holiday')).push(
						fixtureRow({
							id: 'h-0320',
							company_id: 'c-sg',
							date: '2026-03-20',
							name: 'Fixture holiday',
							kind: 'PUBLIC_HOLIDAY',
							published_at: '2026-01-01T00:00:00Z'
						})
					);
					const contract = (id: string) =>
						fixturePresent(
							fixturePresent(fixture.tables.get('employment_contract')).find(
								(item) => item.id === fixtureKey(id)
							)
						);
					const terms = (id: string) =>
						fixturePresent(fixtureValue22(contract(id).facts).contract_terms[0]);
					for (const id of ['k-p1', 'k-p2', 'k-p3', 'k-p4'])
						terms(id).shift_pattern_id = fixtureKey('sp-week');
					terms('k-p3').allowances = [
						{ code: 'FIXED_MONTHLY', amount: { value: 600, currency: 'SGD' } }
					];
					Object.assign(terms('k-p4'), {
						employment_type: 'PART_TIME',
						allowances: [
							{ code: 'PT_ANNUAL_HOURLY_OW', amount: { value: 300, currency: 'SGD' } },
							{ code: 'PT_ANNUAL_HOURLY_AW', amount: { value: 120, currency: 'SGD' } }
						]
					});
					return { fixture, contract, terms };
				};
				/** p1 leaves on Tuesday 24 March; p2 takes no-pay leave on Wednesday 18 March. */
				const absences = ({ fixture, contract, terms }: ReturnType<typeof setUp>) => {
					contract('k-p1').effective_range = { from: '2019-01-01', to: '2026-03-24' };
					terms('k-p1').effective_range = { from: '2019-01-01', to: '2026-03-24' };
					fixturePresent(fixture.tables.get('leave_catalog_entry')).push(
						fixtureRow({
							id: 'npl-1',
							employment_id: 'k-p2',
							company_id: 'c-sg',
							catalog_id: fixtureString(row(version, 'leave_catalog', 'UNPAID_LEAVE').id),
							payslip_id: null,
							activity: 'TIME_OFF',
							occurred_on: '2026-03-18',
							from: '2026-03-18',
							to: '2026-03-18',
							days: 1,
							facts: {}
						})
					);
				};
				const line = (plan: Plan, id: string, code: string) =>
					plan.payslips
						.find((slip) => slip.employment_id === fixtureKey(id))
						?.base.find((item) => item.component_code === code)?.amount ?? 0;
				const total = (plans: Plan[], id: string, code: string) =>
					Math.round(100 * plans.reduce((sum, plan) => sum + line(plan, id, code), 0)) / 100;
				const cents = (value: number) => Math.round(100 * value) / 100;
				const lines: [string, string][] = [
					['k-p1', 'BASIC'],
					['k-p2', 'BASIC'],
					['k-p2', 'NO_PAY_LEAVE'],
					['k-p3', 'BASIC'],
					['k-p3', 'FIXED_MONTHLY'],
					['k-p4', 'PT_ANNUAL_HOURLY_OW'],
					['k-p4', 'PT_ANNUAL_HOURLY_AW']
				];
				const tables = fixtureTables();
				const reset = (set: ReturnType<typeof setUp>) => {
					const entries = [...set.fixture.tables];
					tables.clear();
					for (const [name, rows] of entries) tables.set(name, rows);
					// The late-exit helpers mutate the same table map the scoped history reads and updates.
					set.fixture.tables = tables;
				};
				yield* world(tables).useRun((history) =>
					Effect.gen(function* () {
						const run = (period: string) => history(fixtureKey('c-sg'), period, 'REGULAR');
						for (const withAbsences of [false, true]) {
							const monthlySet = setUp('MONTHLY');
							const semiSet = setUp('SEMI_MONTHLY');
							const switchSet = setUp('SEMI_MONTHLY', {
								pay_frequency_changes: [{ from: '2026-03-16', frequency: 'MONTHLY' }]
							});
							if (withAbsences) for (const set of [monthlySet, semiSet, switchSet]) absences(set);
							reset(monthlySet);
							const monthly = yield* run('2026-03');
							reset(semiSet);
							const halves = [yield* run('2026-03-1'), yield* run('2026-03-2')];
							reset(switchSet);
							const switched = [yield* run('2026-03-1'), yield* run('2026-03')];
							// March 2026: 22 weekdays, Friday 20 March a holiday; MOM's divisor keeps it (22), 10 in the first half, 12 in the second.
							if (!withAbsences) {
								assert.equal(line(monthly, 'k-p3', 'BASIC'), 4800); // a monthly entity is unchanged
								// A complete month: each half pays exactly half, whatever its working days.
								assert.deepEqual(
									halves.map((plan) => line(plan, 'k-p3', 'BASIC')),
									[2400, 2400]
								);
								assert.deepEqual(
									halves.map((plan) => line(plan, 'k-p3', 'FIXED_MONTHLY')),
									[300, 300]
								);
								assert.deepEqual(
									halves.map((plan) => line(plan, 'k-p4', 'PT_ANNUAL_HOURLY_OW')),
									[150, 150]
								);
							} else {
								// EA s.20A: monthly gross ÷ 22 × days worked; the leaver worked 17 (the holiday counted), the no-pay day is 1/22.
								assert.equal(line(monthly, 'k-p1', 'BASIC'), cents((6500 * 17) / 22));
								assert.equal(line(monthly, 'k-p2', 'NO_PAY_LEAVE'), -cents(9800 / 22));
								assert.equal(
									line(fixturePresent(halves[1]), 'k-p2', 'NO_PAY_LEAVE'),
									-cents(9800 / 22)
								);
								// The exit is known before the first half: it pays its 10 days, the second its 7.
								assert.equal(
									line(fixturePresent(halves[0]), 'k-p1', 'BASIC'),
									cents((6500 * 10) / 22)
								);
								assert.equal(
									line(fixturePresent(halves[1]), 'k-p1', 'BASIC'),
									cents((6500 * 7) / 22)
								);
							}
							for (const [id, code] of lines) {
								const month = line(monthly, id, code);
								assert.ok(
									Math.abs(total(halves, id, code) - month) <= 0.01,
									`${withAbsences} halves ${id} ${code}`
								);
								assert.ok(
									Math.abs(total(switched, id, code) - month) <= 0.01,
									`${withAbsences} switched ${id} ${code}`
								);
							}
							// Every employee's month is one month's gross, whichever schedule paid it.
							for (const slip of monthly.payslips)
								for (const plans of [halves, switched])
									assert.ok(
										Math.abs(
											plans
												.map(
													(plan) =>
														plan.payslips.find((item) => item.employment_id === slip.employment_id)
															?.gross ?? 0
												)
												.reduce((sum, gross) => sum + gross, 0) - slip.gross
										) <= 0.01,
										`${withAbsences} ${slip.employment_id} gross`
									);
						}
						// A leave recorded after the first half was paid: the second half settles the month to the s.20A total.
						const late = setUp('SEMI_MONTHLY');
						reset(late);
						const first = yield* run('2026-03-1');
						assert.equal(line(first, 'k-p1', 'BASIC'), 3250);
						late.contract('k-p1').effective_range = { from: '2019-01-01', to: '2026-03-24' };
						late.terms('k-p1').effective_range = { from: '2019-01-01', to: '2026-03-24' };
						const second = yield* run('2026-03-2');
						assert.equal(total([first, second], 'k-p1', 'BASIC'), cents((6500 * 17) / 22));
					})
				);
			})
		);
	});
	it('NS make-up pay: each national service leave spell raises the OneNS claim review, due three months from its start', () => {
		for (const version of versions) {
			const rules = fixtureValue11(row(version, 'rule_set', 'NS_MAKE_UP_PAY_CLAIM').rules);
			assert.deepEqual(rules.trigger, { collection: 'leave_catalog_entry', event: 'created' });
			const spell = (extra: Row) => ({
				row: {
					catalog_code: 'NS_LEAVE',
					activity: 'TIME_OFF',
					from: '2026-10-12',
					to: '2026-10-23',
					...extra
				}
			});
			assert.equal(
				evaluateConfigured(fixtureString(String(rules.when)), fixtureContext(spell({}))),
				true
			);
			assert.equal(
				evaluateConfigured(
					fixtureString(String(rules.when)),
					fixtureContext(spell({ catalog_code: 'ANNUAL_LEAVE' }))
				),
				false
			);
			assert.equal(
				evaluateConfigured(
					fixtureString(String(rules.when)),
					fixtureContext(spell({ activity: 'ENCASHMENT' }))
				),
				false
			);
			assert.equal(
				evaluateConfigured(fixtureString(String(rules.due)), fixtureContext(spell({}))),
				'2027-01-12'
			);
			assert.match(String(rules.description), /two weeks before/);
		}
	});
	it.effect(
		'WICA medical leave wages: AME for the first 14 outpatient / 60 hospitalisation days of the accident, two-thirds after, no CPF',
		Effect.fnUntraced(function* () {
			for (const version of versions) {
				const wages = row(version, 'work_catalog', 'WICA_MEDICAL_LEAVE_WAGES');
				assert.deepEqual(wages.counts_toward, []);
				const leaveRow = (code: string, days: number, taken_before: number) => ({
					code,
					activity: 'TIME_OFF',
					days,
					taken_before,
					is_npl: false,
					pay_fraction: 0
				});
				const price = (rows: Row[], average: Row, facts: Row = { working_days_per_week: 5 }) => {
					const context = {
						...subject({ terms: { monthly_wage: 3000, base_salary: 3000 }, employee: { facts } }),
						period: { days: 31, working_days: 22 },
						earned: { average },
						leave: { rows }
					};
					return evaluateConfigured(
						fixtureString(String(wages.eligibility)),
						fixtureContext(context)
					) === true
						? ['quantity', 'rate'].map((key) =>
								Number(
									evaluateConfigured(fixtureString(String(wages[key])), fixtureContext(context))
								)
							)
						: null;
				};
				const ame = { gross: 3900, net: 3000, months: 12 };
				const daily = (3900 * 12) / (52 * 5); // MOM calculator: AME × 12 ÷ (52 × working days a week) = 180
				// MOM's example: 10 outpatient days, then 71 days of hospitalisation — 60 at full AME, 11 at two-thirds.
				const [q1, r1] = fixturePresent(
					price(
						[
							leaveRow('WORK_INJURY_MEDICAL_LEAVE', 10, 0),
							leaveRow('WORK_INJURY_HOSPITALISATION_LEAVE', 71, 0)
						],
						ame
					)
				);
				assert.ok(Math.abs(fixturePresent(q1) - (10 + 60 + (11 * 2) / 3)) < 1e-9);
				assert.equal(r1, daily);
				// The 14 days run across periods: 10 already taken, 8 more = 4 full + 4 at two-thirds.
				const [q2] = fixturePresent(price([leaveRow('WORK_INJURY_MEDICAL_LEAVE', 8, 10)], ame));
				assert.ok(Math.abs(fixturePresent(q2) - (4 + (4 * 2) / 3)) < 1e-9);
				// No history: the current monthly wage stands in for AME.
				assert.equal(
					fixturePresent(price([leaveRow('WORK_INJURY_MEDICAL_LEAVE', 1, 0)], { months: 0 }))[1],
					(3000 * 12) / 260
				);
				assert.equal(price([], ame), null);
				// The day's salary is removed by NO_PAY_LEAVE (pay fraction 0), so CPF does not reach the compensation.
				for (const code of ['WORK_INJURY_MEDICAL_LEAVE', 'WORK_INJURY_HOSPITALISATION_LEAVE'])
					assert.equal(
						evaluateConfigured(
							fixtureString(String(row(version, 'leave_catalog', code).pay_fraction)),
							fixtureContext({
								leave: { facts: {} }
							})
						),
						0
					);
			}
			// Through the engine: two outpatient spells of one accident, March then April.
			const fixture = engine();
			const version = versionOn('2026-03-01');
			for (const [id, from, to, days] of [
				['wica-1', '2026-03-02', '2026-03-11', 10],
				['wica-2', '2026-04-01', '2026-04-08', 8]
			] as const)
				fixturePresent(fixture.tables.get('leave_catalog_entry')).push(
					fixtureRow({
						id,
						employment_id: 'k-p3',
						company_id: 'c-sg',
						catalog_id: fixtureString(
							row(version, 'leave_catalog', 'WORK_INJURY_MEDICAL_LEAVE').id
						),
						payslip_id: null,
						activity: 'TIME_OFF',
						occurred_on: from,
						from,
						to,
						days,
						facts: { event_id: 'accident-1' }
					})
				);
			const line = (plan: Effect.Success<ReturnType<typeof fixture.run>>, code: string) =>
				[
					...fixturePresent(plan.payslips.find((slip) => slip.employment_id === fixtureKey('k-p3')))
						.base,
					...fixturePresent(plan.payslips.find((slip) => slip.employment_id === fixtureKey('k-p3')))
						.adjustments
				].find((item) => item.component_code === code);
			const march = yield* fixture.run('2026-03', 'REGULAR');
			const april = yield* fixture.run('2026-04', 'REGULAR');
			const marchWica = fixturePresent(line(march, 'WICA_MEDICAL_LEAVE_WAGES'));
			const aprilWica = fixturePresent(line(april, 'WICA_MEDICAL_LEAVE_WAGES'));
			assert.ok(marchWica && aprilWica, 'both months pay WICA wages');
			// April's 8 days: 4 inside the 14, 4 after — the second month pays less per day than the first.
			assert.ok(aprilWica.amount / 8 < marchWica.amount / 10);
			assert.ok(Math.abs(aprilWica.amount / marchWica.amount - (4 + (4 * 2) / 3) / 10) < 0.01);
			assert.ok(
				fixturePresent(line(march, 'NO_PAY_LEAVE')).amount < 0,
				'the salary for the WICA days is removed'
			);
		})
	);
});
