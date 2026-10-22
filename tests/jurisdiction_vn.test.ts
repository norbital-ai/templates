import canonicalLeave from '../src/data/model/+leave_catalog.model.js';
import { Schema as FixtureSchema } from 'effect';
import { fixtureId, nativeId } from './fixture_values.js';
import { modelFields } from './jurisdiction_kit.js';
import { refuse } from '../src/lib/payroll_engine/foundation.js';
import { citationText, world, type Tables } from './jurisdiction_kit.js';
import { lineage as jurisdiction } from './jurisdiction_kit.js';
import { readSeedRows } from './seed_values.js';
const LAW_KIT = jurisdiction('VN');
/** VN public lineage: snapshot structure, CEL on the engine context and statutory amounts per version. */
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from '@effect/vitest';
import { effectWrites, planBehaviours, Behaviours } from '../src/lib/payroll_engine/behaviours.js';
// strict: a record expression failing inside `configured_eval`, even where CEL absorbs it, fails the suite
import {
	configuredProgram,
	evaluateStrict as evaluateConfigured
} from '../src/lib/payroll_engine/expressions.js';
import {
	entitlementDays,
	leaveBalances,
	movementFromRow,
	serviceMonthsAt,
	type AttendanceDay
} from '../src/lib/payroll_engine/leave.js';
import { DUTY_KEYS, dutiesOf, raiseDuties, triggerOf, SEEDED_PAYROLL } from './duties.ts';
import { Effect } from 'effect';
import { type PayrollRunKind } from '../src/lib/payroll_engine/payslip/context.js';
import { recordDocuments } from '../src/lib/payroll_engine/export.js';
import { runEngine } from '../src/lib/payroll_engine/foundation.js';
import { planRosterImport } from '../src/lib/payroll_engine/roster_import.js';
import type { SheetRecord } from '../src/lib/payroll_engine/roster_sheet.js';
const EntitlementFixture = FixtureSchema.NullOr(
	FixtureSchema.StructWithRest(
		FixtureSchema.Struct({
			unit: FixtureSchema.optional(FixtureSchema.String),
			days: FixtureSchema.optional(FixtureSchema.String),
			overdraw: FixtureSchema.optional(FixtureSchema.String),
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
const ExportRowsFixture = FixtureSchema.Array(
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
);
const fixturePresent = <A>(value: A): NonNullable<A> => {
	assert.ok(value != null, 'The fixture contains the required authored value.');
	return value;
};
const guardFixture =
	<S extends FixtureSchema.Constraint>(schema: S) =>
	(value: unknown): S['Type'] => {
		const accepts = FixtureSchema.is(schema);
		assert.ok(accepts(value), 'The fixture value retains its declared shape.');
		return value;
	};
const fixtureRecord = guardFixture(
	FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))
);
const fixtureBoolean = guardFixture(FixtureSchema.Boolean);
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
				FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))
			)(value)
		)
			fixtureFacts(value);
		else if (Array.isArray(value))
			for (const item of value)
				if (
					FixtureSchema.is(
						FixtureSchema.Record(
							FixtureSchema.String,
							FixtureSchema.mutableKey(FixtureSchema.Unknown)
						)
					)(item)
				)
					fixtureFacts(item);
	}
};
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
			FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))
		)(row.facts)
	)
		fixtureFacts(row.facts);
	return row;
};
const fixtureRows = (rows: readonly Row[]): Row[] => rows.map(fixtureRow);
const fixtureTables = (entries: Iterable<readonly [string, readonly Row[]]> = []): Tables =>
	new Map(Array.from(entries, ([name, rows]): [string, Row[]] => [name, fixtureRows(rows)]));
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
			configuration: FixtureSchema.mutableKey(
				FixtureSchema.StructWithRest(
					FixtureSchema.Struct({
						assessment: FixtureSchema.mutableKey(FixtureSchema.optionalKey(FixtureSchema.String)),
						assessable: FixtureSchema.mutableKey(
							FixtureSchema.optionalKey(
								FixtureSchema.StructWithRest(
									FixtureSchema.Struct({
										ordinary: FixtureSchema.mutableKey(
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
						),
						rules: FixtureSchema.mutableKey(
							FixtureSchema.optionalKey(
								FixtureSchema.mutable(
									FixtureSchema.Array(
										FixtureSchema.StructWithRest(
											FixtureSchema.Struct({
												when: FixtureSchema.mutableKey(
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
						),
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
		}),
		[FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))]
	)
);
const fixtureValue1 = guardFixture(
	FixtureSchema.mutable(
		FixtureSchema.Tuple([
			FixtureSchema.String,
			FixtureSchema.mutable(
				FixtureSchema.Array(
					FixtureSchema.Record(
						FixtureSchema.String,
						FixtureSchema.mutableKey(FixtureSchema.Unknown)
					)
				)
			)
		])
	)
);
const fixtureValue2 = guardFixture(
	FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))
);
const fixtureValue3 = guardFixture(
	FixtureSchema.Union([
		FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown)),
		FixtureSchema.Undefined
	])
);
const fixtureValue4 = guardFixture(
	FixtureSchema.StructWithRest(
		FixtureSchema.Struct({
			from: FixtureSchema.mutableKey(FixtureSchema.optionalKey(FixtureSchema.String)),
			to: FixtureSchema.mutableKey(
				FixtureSchema.optionalKey(FixtureSchema.Union([FixtureSchema.String, FixtureSchema.Null]))
			)
		}),
		[FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))]
	)
);
const fixtureValue5 = guardFixture(
	FixtureSchema.mutable(
		FixtureSchema.Array(
			FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))
		)
	)
);
const fixtureValue6 = guardFixture(
	FixtureSchema.StructWithRest(
		FixtureSchema.Struct({
			from: FixtureSchema.mutableKey(FixtureSchema.String),
			to: FixtureSchema.mutableKey(FixtureSchema.Union([FixtureSchema.String, FixtureSchema.Null]))
		}),
		[FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))]
	)
);
const fixtureValue7 = guardFixture(
	FixtureSchema.StructWithRest(
		FixtureSchema.Struct({ to: FixtureSchema.mutableKey(FixtureSchema.Unknown) }),
		[FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))]
	)
);
const fixtureValue8 = guardFixture(
	FixtureSchema.StructWithRest(
		FixtureSchema.Struct({
			properties: FixtureSchema.mutableKey(
				FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))
			)
		}),
		[FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))]
	)
);
const fixtureValue9 = guardFixture(
	FixtureSchema.mutable(
		FixtureSchema.Array(
			FixtureSchema.StructWithRest(
				FixtureSchema.Struct({
					when: FixtureSchema.mutableKey(FixtureSchema.optionalKey(FixtureSchema.String)),
					amount: FixtureSchema.mutableKey(FixtureSchema.String)
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
const fixtureValue10 = guardFixture(
	FixtureSchema.StructWithRest(
		FixtureSchema.Struct({
			by_region: FixtureSchema.mutableKey(
				FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))
			)
		}),
		[FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))]
	)
);
const fixtureValue11 = guardFixture(EntitlementFixture);
const fixtureValue12 = guardFixture(Behaviours);
const fixtureValue13 = guardFixture(
	FixtureSchema.mutable(
		FixtureSchema.Array(
			FixtureSchema.StructWithRest(
				FixtureSchema.Struct({ amount: FixtureSchema.mutableKey(FixtureSchema.String) }),
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
const fixtureValue14 = guardFixture(
	FixtureSchema.StructWithRest(
		FixtureSchema.Struct({ days: FixtureSchema.mutableKey(FixtureSchema.Number) }),
		[FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))]
	)
);
const fixtureValue15 = guardFixture(
	FixtureSchema.StructWithRest(
		FixtureSchema.Struct({
			trigger: FixtureSchema.mutableKey(FixtureSchema.String),
			months: FixtureSchema.mutableKey(
				FixtureSchema.optionalKey(FixtureSchema.mutable(FixtureSchema.Array(FixtureSchema.String)))
			),
			applies_when: FixtureSchema.mutableKey(FixtureSchema.optionalKey(FixtureSchema.String)),
			due: FixtureSchema.mutableKey(FixtureSchema.String),
			description: FixtureSchema.mutableKey(FixtureSchema.String)
		}),
		[FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))]
	)
);
const fixtureValue16 = guardFixture(
	FixtureSchema.mutable(FixtureSchema.Array(FixtureSchema.String))
);
const fixtureValue17 = guardFixture(
	FixtureSchema.StructWithRest(
		FixtureSchema.Struct({
			site: FixtureSchema.mutableKey(FixtureSchema.String),
			kind: FixtureSchema.mutableKey(FixtureSchema.String),
			when: FixtureSchema.mutableKey(FixtureSchema.String),
			message: FixtureSchema.mutableKey(FixtureSchema.String)
		}),
		[FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))]
	)
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
const fixtureValue19 = guardFixture(
	FixtureSchema.mutable(
		FixtureSchema.Array(
			FixtureSchema.StructWithRest(
				FixtureSchema.Struct({
					code: FixtureSchema.mutableKey(FixtureSchema.String),
					rules: FixtureSchema.mutableKey(FixtureSchema.Unknown)
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
const fixtureValue20 = guardFixture(ExportRowsFixture);
const fixtureValue21 = guardFixture(
	FixtureSchema.StructWithRest(
		FixtureSchema.Struct({
			items: FixtureSchema.mutableKey(
				FixtureSchema.StructWithRest(
					FixtureSchema.Struct({
						properties: FixtureSchema.mutableKey(
							FixtureSchema.Record(
								FixtureSchema.String,
								FixtureSchema.mutableKey(FixtureSchema.Unknown)
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
		}),
		[FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))]
	)
);
const fixtureValue22 = guardFixture(
	FixtureSchema.Union([FixtureSchema.Literal('employee'), FixtureSchema.Literal('company')])
);
type Row = {
	[key: string]: unknown;
};
type Rule = {
	when?: string;
	employee?: string;
	employer?: string;
};
type Configuration = {
	assessment?: string;
	assessable?: {
		ordinary?: string;
	};
	rules?: Rule[];
	refuse_when?: {
		when: string;
		message: string;
	}[];
};
const root = resolve(process.cwd(), 'seed/jurisdiction');
const lineage = resolve(root, 'VN');
const FILES = [
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
const versionsOf = (directory: string) =>
	readdirSync(directory)
		.filter((name) => name.startsWith('version_'))
		.toSorted((left, right) => Number(left.slice(8)) - Number(right.slice(8)));
const VERSIONS = LAW_KIT.versions;
const load = (directory: string, file: string): Row[] =>
	readSeedRows(resolve(directory), file).map((row) => ({ ...row }));
const rows = LAW_KIT.rows;
const settings = (version: string): Row => {
	const [row] = rows(version, 'jurisdiction_settings');
	assert.ok(row);
	return row;
};
const scheme = (
	version: string,
	code: string
): Row & {
	configuration: Configuration;
} => {
	const row = rows(version, 'statutory_contribution_catalog').find((item) => item.code === code);
	assert.ok(row, `${version} ${code}`);
	return fixtureValue0(row);
};
const rows_ = (version: string, file: string) => rows(version, file);
/** A work-day sheet import planned against the lineage's own versions: the `roster` validations run as HR would see them. */
const rosterImport = (
	people: {
		number: string;
		profile: Row;
		terms?: Row;
	}[],
	rows: SheetRecord[]
) => {
	const law = (file: string) => VERSIONS.flatMap((version) => rows_(version, file));
	const tables = fixtureTables([
		[
			'entity',
			[
				{
					id: 'c1',
					name: 'Acme',
					settings_code: 'VN',
					time_zone: 'Asia/Ho_Chi_Minh',
					region: 'I',
					facts: {},
					pay_cutoff_day: 1,
					effective_range: { from: '2025-12-01', to: null }
				}
			]
		],
		['jurisdiction_settings', law('jurisdiction_settings')],
		['rule_set', law('rule_set')],
		['leave_catalog', law('leave_catalog')],
		[
			'employment_contract',
			people.map((person, i) => ({
				id: `k${i}`,
				company_id: 'c1',
				employee_id: `p${i}`,
				employee_number: person.number,
				effective_range: { from: '2026-01-01', to: null },
				facts: {
					contract_terms: [
						{
							effective_range: { from: '2026-01-01', to: null },
							base_salary: { value: 26000000, currency: 'VND' },
							allowances: [],
							employment_type: 'PERMANENT',
							work_classification: 'ORDINARY',
							facts: {},
							...person.terms
						}
					]
				},
				contract_number: 1
			}))
		],
		[
			'employment_profile',
			people.map((person, i) => ({
				id: `p${i}`,
				name: person.number,
				children: [],
				facts: {},
				...person.profile
			}))
		],
		[
			'shift_definition',
			[
				{
					id: 'D',
					company_id: 'c1',
					code: 'D',
					variant: { day_type: 'WORK', start_time: '08:00', end_time: '17:00' }
				},
				{ id: 'R', company_id: 'c1', code: 'R', variant: { day_type: 'REST' } }
			]
		],
		...[
			'shift_pattern',
			'holiday',
			'roster_entry',
			'leave_catalog_entry',
			'payslip',
			'payroll_run',
			'work_suspension'
		].map((name) => fixtureValue1([name, []]))
	]);
	return world(tables).withRead((read) =>
		Effect.gen(function* () {
			return yield* runEngine(
				planRosterImport(
					{
						company_id: nativeId('entity', fixtureKey('c1')),
						rows,
						now: '2026-10-20T00:00:00.000Z'
					},
					read
				),
				read,
				(message) => refuse(message)
			);
		})
	);
};
const payrollRule = (version: string, code: string) =>
	fixtureValue2(
		rows(version, 'rule_set').find((row) => row.family === 'PAYROLL' && row.code === code)?.rules
	);
const minimumWage = (version: string) => payrollRule(version, 'minimum_wage');
/** The 2026 PIT scales (Law 109/2025 art.9): monthly, and annual (twelve times the bands). */
const MONTH_BANDS: [number, number][] = [
	[10000000, 0.05],
	[30000000, 0.1],
	[60000000, 0.2],
	[100000000, 0.3],
	[Infinity, 0.35]
];
const ladderAt = (scale: number) => (taxable: number) => {
	let tax = 0;
	let lower = 0;
	for (const [upper, rate] of MONTH_BANDS) {
		tax += Math.max(0, Math.min(taxable, upper * scale) - lower) * rate;
		lower = upper * scale;
		if (taxable <= lower) break;
	}
	return tax;
};
const ladderMonth = ladderAt(1);
const ladderYear = ladderAt(12);
const payrollRules = (version: string) => ({
	minimum_wage: minimumWage(version),
	working_time: payrollRule(version, 'working_time'),
	night_window: payrollRule(version, 'night_window')
});
/** The month's charge the way `assessStatutory` makes it for a salary-only month. */
type Subject = {
	employee?: Row;
	company?: Row;
	/** This scheme's standing elections (`scheme.elections`). */
	elections?: Row;
	/** The SI standing's elections (`elections.SI`), read by the other schemes. */
	siElections?: Row;
	employment?: Row;
	terms?: Row;
	/** Unpaid working days as one no-pay leave row. */
	unpaid?: number;
	leave?: Row[];
	/** The `earned` history root (months[]). */
	earned?: Row;
	period?: Row;
	/** PIT wage parts beside `ordinary`: meal, housing, pension. */
	parts?: Row;
	year?: Row;
	chargedYear?: Row;
	/** Charges of earlier slips of the month, by scheme code. */
	chargedMonth?: Row;
};
/** The month's charge the way `assessStatutory` makes it for one slip. */
const charge = (
	version: string,
	code: string,
	wage: number,
	person: Row = { residency_status: 'CITIZEN' },
	subject: Subject = {}
): {
	employee: number;
	employer: number;
} => {
	const { configuration } = scheme(version, code);
	// PIT deducts what SI, HI and UI charged this month; the State-sector union dues also read PIT (catalogue order).
	const before: {
		[code: string]: string[];
	} = {
		PIT: ['SI', 'HI', 'UI'],
		UNION_DUES: ['SI', 'HI', 'UI', 'PIT']
	};
	const charged = {
		month: Object.fromEntries(
			(before[code] ?? []).map((other) => [
				other,
				charge(version, other, wage, person, { ...subject, elections: {} })
			])
		),
		...(subject.chargedMonth == null ? {} : { month: subject.chargedMonth }),
		year: subject.chargedYear ?? {}
	};
	const employee = {
		gender: 'FEMALE',
		nationality: 'VN',
		date_of_birth: '1990-01-01',
		age: 36,
		children: [],
		facts: {},
		...subject.employee
	};
	const company = { region: '', facts: {}, ...subject.company };
	const terms = {
		base_salary: wage,
		monthly_wage: wage,
		employment_type: 'PERMANENT',
		work_classification: 'ORDINARY',
		residency_status: String(person.residency_status ?? 'CITIZEN'),
		allowances: [],
		facts: {},
		...subject.terms
	};
	const elections = subject.elections ?? {};
	const rows =
		subject.leave ??
		(subject.unpaid
			? [
					{
						code: 'UNPAID_LEAVE',
						is_npl: true,
						pay_fraction: 1,
						period_working_days: subject.unpaid,
						to: '2026-10-31'
					}
				]
			: []);
	const leave = { rows };
	const roots = {
		employee,
		company,
		terms,
		rules: payrollRules(version),
		charged,
		leave,
		earned: { months: [], month: {}, ...subject.earned },
		employment: {
			start_date: '2020-01-01',
			exit_date: '',
			service_months: 60,
			...subject.employment
		},
		elections: { [code]: elections, SI: subject.siElections ?? {} },
		scheme: { code, standing: '', elections }
	};
	const month: Row = { ordinary: wage, ...subject.parts };
	const scope = { month, ...roots };
	const parts: {
		[part: string]: number;
	} = {};
	for (const [part, paid] of Object.entries(month)) {
		const expression = fixtureValue3(configuration.assessable)?.[part];
		parts[part] = Math.max(
			0,
			expression == null
				? Number(paid)
				: Number(evaluateConfigured(fixtureString(String(expression)), fixtureContext(scope)))
		);
	}
	const total = Object.values(parts).reduce((sum, value) => sum + value, 0);
	const base = { ...parts, assessed: total, amount: total };
	const held = {
		base,
		...roots,
		person: {
			age: 30,
			nationality: null,
			residency_since: null,
			...person
		},
		period: {
			key: '2026-10',
			from: '2026-10-01',
			to: '2026-10-31',
			month: 10,
			days: 31,
			working_days: 22,
			month_working_days: 22,
			month_holiday_work_days: 0,
			previous_month_working_days: 22,
			previous_month_holiday_work_days: 0,
			covered_working_days: 22,
			unpaid_working_days: subject.unpaid ?? 0,
			// a salary-run slip unless the subject says otherwise
			salary_paid: false,
			salary_run: true,
			...subject.period
		},
		month,
		year: subject.year ?? { ordinary: 0 }
	};
	// the scheme's person facts, as the engine adds them before the rules
	const facts: Row = {};
	for (const [fact, expression] of Object.entries(
		fixtureRecord(fixtureRecord(configuration).person ?? {})
	))
		facts[fact] = evaluateConfigured(
			fixtureString(expression),
			fixtureContext({ ...held, person: { ...held.person, ...facts } })
		);
	const context = { ...held, person: { ...held.person, ...facts } };
	for (const guard of configuration.refuse_when ?? [])
		if (evaluateConfigured(fixtureString(guard.when), fixtureContext(context)) === true)
			throw new Error(guard.message);
	for (const rule of configuration.rules ?? []) {
		if (
			rule.when != null &&
			evaluateConfigured(fixtureString(rule.when), fixtureContext(context)) !== true
		)
			continue;
		const assessed = Number(
			evaluateConfigured(
				fixtureString(configuration.assessment ?? 'base.assessed'),
				fixtureContext(context)
			)
		);
		const ruled = { ...context, base: { ...base, assessed, amount: assessed } };
		return {
			employee: Number(
				evaluateConfigured(fixtureString(rule.employee ?? '0.0'), fixtureContext(ruled))
			),
			employer: Number(
				evaluateConfigured(fixtureString(rule.employer ?? '0.0'), fixtureContext(ruled))
			)
		};
	}
	return { employee: 0, employer: 0 };
};
/** Every employee and entity fact the VN CEL reads, set. */
const SUBJECT_ALL = {
	employee: { gender: 'FEMALE', facts: {} },
	elections: { union_member: true, dependants: 2 },
	company: {
		region: 'II',
		facts: {
			occupational_accident_reduced: true,
			union_fee_suspended: false,
			union_fee_reduction_percent: 20,
			stoppage_pay_percent: 70
		}
	}
};
/** The subject roots a leave entitlement reads (services.leaveState builds them). */
const LEAVE_SUBJECT = {
	terms: { work_classification: 'ORDINARY', facts: {} },
	employee: { age: 30, facts: {} },
	employment: { start_date: '2020-01-01' },
	// No attendance days read: the first-year months fall back to completed service months.
	attendance: { window: { months: [] }, previous: { months: [] } }
};
/** `withBalances` from tests/duties.ts, with the subject roots the VN entitlements read. */
const withSubjectBalances = <
	C extends {
		event: Row;
		catalogues?: unknown;
		movements?: unknown;
	}
>(
	context: C
): C => {
	const row = fixtureValue2(context.event.row);
	const range = fixtureValue4(row.effective_range ?? {});
	const asOf = range.to ?? range.from ?? '2026-01-01';
	return {
		...context,
		event: {
			...context.event,
			leave_balances: leaveBalances({
				classes: fixtureValue5(context.catalogues ?? []).map((held) => seedClass(held)),
				movements: fixtureValue5(context.movements ?? []).map((held) => seedMovement(held)),
				serviceMonths: serviceMonthsAt(range.from ?? null, asOf, row.prior_service_months),
				asOf,
				employmentStart: range.from ?? null,
				context: LEAVE_SUBJECT
			})
		}
	};
};
/** The entity, contract and profile rows the obligation behaviours read. */
const COMPANY = { id: 'co1', region: 'I', risk_class: '', facts: {} };
const CONTRACT = {
	id: 'c1',
	company_id: 'co1',
	employee_id: 'e1',
	exit_ground: 'END_OF_CONTRACT',
	exit_facts: {},
	effective_range: { from: '2026-10-15', to: '2026-10-31' },
	employee_number: String('e1'),
	contract_number: 1
};
const PROFILE = {
	id: 'e1',
	nationality: 'VN',
	gender: 'FEMALE',
	date_of_birth: '1990-01-01',
	facts: {}
};
const employment = {
	classification: 'ORDINARY',
	service_months: 40,
	start_date: '2023-06-01',
	exit_date: '',
	exit_ground: '',
	exit_facts: {}
};
const entry = (facts: Row) => ({
	amount: 20000000,
	quantity: 1,
	occurred_on: '2026-10-15',
	due_on: '2026-10-15',
	incurred_on: '2026-10-15',
	...facts,
	facts
});
/** The payslip build context (`buildPayslip`) and the entry admission context (`admitEntry`). */
const salaryContext = {
	employee: {
		gender: 'FEMALE',
		nationality: 'VN',
		date_of_birth: '1990-01-01',
		age: 36,
		children: [],
		facts: {}
	},
	company: { region: 'I', facts: {} },
	rules: payrollRules('version_4'),
	earned: { previous_month: { base_salary: 26000000 } },
	hours: { month: {}, year: {} },
	period: {
		key: '2026-10',
		from: '2026-10-01',
		to: '2026-10-31',
		days: 31,
		paid_days: 31,
		working_days: 26,
		month_working_days: 26,
		month_holiday_work_days: 0,
		previous_month_working_days: 26,
		previous_month_holiday_work_days: 0,
		covered_working_days: 26,
		covered_days: 31,
		part: 1,
		parts: 1
	},
	terms: {
		base_salary: 26000000,
		monthly_wage: 26000000,
		allowances: [],
		facts: {},
		effective_from: '2023-06-01',
		effective_to: '',
		work_classification: 'ORDINARY',
		statutory_work_category: '',
		employment_type: 'PERMANENT',
		residency_status: 'CITIZEN'
	},
	employment,
	person: { employment },
	work: {
		overtime_hours: 4,
		incentive_hours: 0,
		dates: ['2026-03-10', '2026-03-11'],
		holidays: [{ date: '2026-03-10', kind: 'PUBLIC_HOLIDAY', given_to: 'EVERYONE', replaces: '' }],
		days: [
			{
				date: '2026-03-10',
				day_type: 'WORK',
				holiday_kind: 'PUBLIC_HOLIDAY',
				scheduled_hours: 8,
				worked_hours: 8,
				overtime_hours: 0,
				banked_hours: 0,
				intervals: [{ start: '2026-03-10T08:00', end: '2026-03-10T16:00' }],
				overtime_intervals: []
			},
			{
				date: '2026-03-11',
				day_type: 'WORK',
				holiday_kind: '',
				scheduled_hours: 8,
				worked_hours: 12,
				overtime_hours: 4,
				banked_hours: 0,
				intervals: [{ start: '2026-03-11T08:00', end: '2026-03-11T20:00' }],
				overtime_intervals: [{ start: '2026-03-11T16:00', end: '2026-03-11T20:00' }]
			}
		]
	},
	leave: {
		rows: [
			{ code: 'UNPAID_LEAVE', activity: 'TIME_OFF', days: 2, is_npl: true, can_encash: false },
			{ code: 'ANNUAL_LEAVE', activity: 'ENCASHMENT', days: 3, is_npl: false, can_encash: true }
		]
	}
};
const ENTRY_FACTS = { qualifying_months: 40, late_days: 20, deposit_rate_percent: 4.5 };
const payslipContext = { ...salaryContext, entry: entry(ENTRY_FACTS) };
const admitContext = {
	employee: {
		gender: 'FEMALE',
		nationality: 'VN',
		date_of_birth: '1990-01-01',
		age: 36,
		children: [],
		facts: {}
	},
	company: { region: 'I', facts: {} },
	employment,
	person: { employment },
	terms: {
		base_salary: 26000000,
		monthly_wage: 26000000,
		employment_type: 'PERMANENT',
		allowances: [],
		facts: {}
	},
	entry: entry(ENTRY_FACTS)
};
const fieldsOf = modelFields;
describe('VN jurisdiction seed', () => {
	it('every version holds settings, rule_set and every catalogue file', () => {
		assert.deepEqual(VERSIONS, ['version_1', 'version_2', 'version_3', 'version_4']);
		for (const version of VERSIONS)
			for (const file of FILES)
				assert.equal(
					existsSync(resolve(lineage, version, `${file}.json`)),
					true,
					`${version}/${file}`
				);
	});
	it('ids are unique across every lineage and version, and each row names its own version', () => {
		const seen = new Map<string, string>();
		for (const code of readdirSync(root))
			for (const version of versionsOf(resolve(root, code)))
				for (const file of readdirSync(resolve(root, code, version)).filter((name) =>
					name.endsWith('.json')
				))
					for (const row of load(resolve(root, code, version), file.slice(0, -5))) {
						const where = `${code}/${version}/${file}:${String(row.code)}`;
						assert.equal(
							seen.has(String(row.id)),
							false,
							`${where} reuses ${seen.get(String(row.id))}`
						);
						seen.set(String(row.id), where);
					}
		for (const version of VERSIONS) {
			const id = settings(version).id;
			for (const file of FILES.slice(1))
				for (const row of rows(version, file))
					assert.equal(row.settings_id, id, `${version}/${file}`);
		}
	});
	it('versions chain by cloned_from_id and cover time without a gap or an overlap', () => {
		let previous: Row | undefined;
		for (const version of VERSIONS) {
			const row = settings(version);
			const range = fixtureValue6(row.effective_range);
			assert.equal(row.code, 'VN');
			assert.equal(row.jurisdiction_code, 'VN');
			assert.ok(row.sealed_at, `${version} is sealed`);
			assert.equal(row.voided_at, null);
			assert.match(range.from, /^\d{4}-\d{2}-\d{2}$/);
			if (previous === undefined) assert.equal(row.cloned_from_id, undefined);
			else {
				const before = fixtureValue6(previous.effective_range);
				assert.equal(row.cloned_from_id, previous.id);
				assert.ok(before.to);
				const next = new Date(`${before.to}T00:00:00Z`);
				next.setUTCDate(next.getUTCDate() + 1);
				assert.equal(
					range.from,
					next.toISOString().slice(0, 10),
					`${version} starts the day after`
				);
			}
			previous = row;
		}
		assert.equal(fixtureValue7(previous?.effective_range).to, null);
	});
	it.effect(
		'every row key exists on its target model',
		Effect.fnUntraced(function* () {
			for (const file of FILES) {
				const fields = fieldsOf(file);
				for (const version of VERSIONS)
					for (const row of rows(version, file))
						for (const key of Object.keys(row))
							assert.equal(fields.has(key), true, `${version}/${file}:${String(row.code)}.${key}`);
			}
		})
	);
	it('settings declare both input schemas and the current reference tables only', () => {
		for (const version of VERSIONS) {
			const row = settings(version);
			const employee = fixtureValue8(row.employee_input_schema);
			const entity = fixtureValue8(row.entity_input_schema);
			assert.ok(employee.properties.contract_terms);
			assert.ok(employee.properties.employment_statutory_facts);
			assert.ok(employee.properties.facts);
			assert.ok(entity.properties.occupational_accident_reduced);
			assert.equal(row.reference_tables, undefined);
			assert.deepEqual(row.payroll, {
				currency: 'VND',
				timezone: 'Asia/Ho_Chi_Minh',
				tax_year_start_month: 1,
				...SEEDED_PAYROLL
			});
		}
	});
	it('catalogue codes are the same in every version', () => {
		// rule_set codes move with the law: Decree 13/2023 gave way to the PDP Law 91/2025 on 1 January 2026.
		for (const file of FILES.slice(2)) {
			// The 2025 overtime split and the non-resident lines to 30 June 2026 exist only in their versions, as does the
			// night-wage exemption from 1 July 2026 (Decree 253/2026 art.26(1)).
			const codes = (version: string) =>
				rows(version, file)
					.map((row) => String(row.code))
					.filter((code) => !code.includes('TAXABLE') && code !== 'NIGHT_WAGE_EXEMPT');
			for (const version of VERSIONS) assert.deepEqual(codes(version), codes('version_1'), file);
		}
	});
	it('every catalogue and statutory CEL evaluates on the engine context', () => {
		const bool = (expression: unknown, context: Row, where: string) => {
			if (expression == null || String(expression).trim() === '') return;
			assert.equal(
				typeof evaluateConfigured(fixtureString(String(expression)), fixtureContext(context)),
				'boolean',
				where
			);
		};
		const number = (expression: unknown, context: Row, where: string) =>
			assert.equal(
				typeof evaluateConfigured(fixtureString(String(expression)), fixtureContext(context)),
				'number',
				where
			);
		for (const version of VERSIONS) {
			for (const row of rows(version, 'work_catalog')) {
				const where = `${version} work ${String(row.code)}`;
				bool(row.eligibility, salaryContext, where);
				number(row.quantity ?? '1.0', salaryContext, where);
				number(row.rate ?? '0.0', salaryContext, where);
			}
			for (const row of rows(version, 'allowance_catalog'))
				bool(row.eligibility, salaryContext, `${version} allowance ${String(row.code)}`);
			for (const file of ['adhoc_catalog', 'claim_catalog', 'loan_catalog'])
				for (const row of rows(version, file)) {
					const where = `${version} ${file} ${String(row.code)}`;
					for (const context of [admitContext, payslipContext]) {
						bool(row.eligibility, context, where);
						bool(row.qualifies_when, context, where);
					}
					for (const band of fixtureValue9(row.bands ?? [])) {
						bool(band.when, payslipContext, where);
						number(band.amount, payslipContext, where);
					}
				}
			for (const row of rows(version, 'leave_catalog')) {
				bool(row.eligibility, admitContext, `${version} leave ${String(row.code)}`);
				if (String(row.pay_fraction ?? '') !== '')
					number(row.pay_fraction, salaryContext, `${version} leave ${String(row.code)}`);
			}
			for (const code of ['SI', 'HI', 'UI', 'UNION_FEE', 'UNION_DUES', 'PIT'])
				for (const [person, subject] of [
					[{ residency_status: 'CITIZEN' }, {}],
					[{ residency_status: 'NON_RESIDENT' }, { company: { region: 'IV' } }],
					[{ residency_status: 'RESIDENT' }, SUBJECT_ALL]
				] as const)
					for (const wage of [1000000, 30000000, 200000000]) {
						const { employee, employer } = charge(version, code, wage, person, subject);
						assert.ok(Number.isFinite(employee) && Number.isFinite(employer), `${version} ${code}`);
					}
			// Rule-set records carry no engine context; their CEL must still parse.
			const walk = (value: unknown, where: string): void => {
				if (Array.isArray(value)) value.forEach((item, index) => walk(item, `${where}[${index}]`));
				else if (value != null && typeof value === 'object')
					for (const [key, item] of Object.entries(value)) {
						if ((key === 'when' || key === 'due') && typeof item === 'string' && item.trim() !== '')
							assert.doesNotThrow(() => configuredProgram(item), `${where}.${key}`);
						else walk(item, `${where}.${key}`);
					}
			};
			for (const row of rows(version, 'rule_set'))
				walk(row.rules, `${version} ${String(row.code)}`);
		}
	});
	it('work lines price VN overtime, holiday work, no-pay leave and encashment', () => {
		const amount = (code: string) => {
			const row = rows('version_4', 'work_catalog').find((item) => item.code === code);
			assert.ok(row);
			return (
				Number(
					evaluateConfigured(fixtureString(String(row.quantity)), fixtureContext(salaryContext))
				) *
				Number(evaluateConfigured(fixtureString(String(row.rate)), fixtureContext(salaryContext)))
			);
		};
		assert.equal(amount('OVERTIME'), 4 * 1.5 * 125000);
		assert.equal(amount('HOLIDAY_WORK'), 8 * 3 * 125000);
		// Every paid hour of a holiday at 300%, counted once: the shift's 8 and the 2 overtime hours past it. Banked hours
		// are not paid; an unworked holiday is no holiday work (the attendance window lists every date).
		const holidayWork = fixturePresent(
			rows('version_4', 'work_catalog').find((item) => item.code === 'HOLIDAY_WORK')
		);
		const holidayHours = (extra: Row) =>
			Number(
				evaluateConfigured(
					fixtureString(String(holidayWork.quantity)),
					fixtureContext({
						...salaryContext,
						work: {
							...salaryContext.work,
							days: [{ ...fixturePresent(salaryContext.work.days[0]), ...extra }]
						}
					})
				)
			);
		assert.equal(holidayHours({ worked_hours: 10, overtime_hours: 2 }), 10);
		assert.equal(holidayHours({ worked_hours: 10, overtime_hours: 1, banked_hours: 1 }), 9);
		assert.equal(holidayHours({ worked_hours: 0, intervals: [] }), 0);
		// Day wage = monthly ÷ the period's 26 planned working days (Decree 145/2020 art.54(1)(a3)).
		assert.equal(Math.round(amount('NO_PAY_LEAVE')), 2000000);
		assert.equal(Math.round(amount('ENCASHMENT')), 3000000);
		// Decree 145/2020 art.67(3): the cash-out day is the previous month's wage over the previous month's normal
		// working days — 26,000,000 over September's 21 + 1 holiday = 22, not October's 26.
		const encash = fixturePresent(
			rows('version_4', 'work_catalog').find((item) => item.code === 'ENCASHMENT')
		);
		const september = {
			...salaryContext,
			period: {
				...salaryContext.period,
				previous_month_working_days: 21,
				previous_month_holiday_work_days: 1
			}
		};
		assert.equal(
			Math.round(
				Number(
					evaluateConfigured(fixtureString(String(encash.quantity)), fixtureContext(september))
				) *
					Number(evaluateConfigured(fixtureString(String(encash.rate)), fixtureContext(september)))
			),
			Math.round((3 * 26000000) / 22)
		);
		const counts = (version: string, code: string) =>
			rows(version, 'work_catalog').find((item) => item.code === code)?.counts_toward;
		assert.deepEqual(counts('version_1', 'OVERTIME'), []);
		assert.deepEqual(counts('version_1', 'OVERTIME_TAXABLE_PART'), ['PIT']);
		assert.deepEqual(counts('version_2', 'OVERTIME'), []);
		assert.deepEqual(counts('version_4', 'ENCASHMENT'), []);
		// Decree 145/2020 art.55(1)(a), art.67(3): the premium and cash-out wage is the base salary plus the job-related wage
		// allowance (FIXED_ALLOWANCE); the meal allowance stays out. 26,000,000 + 2,000,000 over 26 days of 8 hours.
		const allowed = {
			...salaryContext,
			terms: {
				...salaryContext.terms,
				allowances: [
					{ code: 'FIXED_ALLOWANCE', amount: 2000000 },
					{ code: 'MEAL_ALLOWANCE', amount: 500000 }
				]
			}
		};
		const rateOf = (version: string, code: string) =>
			Number(
				evaluateConfigured(
					fixtureString(
						String(
							fixturePresent(rows(version, 'work_catalog').find((item) => item.code === code)).rate
						)
					),
					fixtureContext(allowed)
				)
			);
		for (const version of VERSIONS) {
			assert.equal(
				Math.round(rateOf(version, 'OVERTIME')),
				Math.round((1.5 * 28000000) / 26 / 8),
				version
			);
			assert.equal(
				Math.round(rateOf(version, 'HOLIDAY_WORK')),
				Math.round((3 * 28000000) / 26 / 8),
				version
			);
			assert.equal(
				Math.round(rateOf(version, 'NIGHT_WORK')),
				Math.round((0.3 * 28000000) / 26 / 8),
				version
			);
			assert.equal(Math.round(rateOf(version, 'ENCASHMENT')), Math.round(28000000 / 26), version);
		}
	});
	it('overtime ladders, night work and the working-day divisor read the planned days', () => {
		const day = (date: string, extra: Row) => ({
			date,
			day_type: 'WORK',
			holiday_kind: '',
			scheduled_hours: 8,
			worked_hours: 0,
			overtime_hours: 0,
			banked_hours: 0,
			intervals: [],
			overtime_intervals: [],
			...extra
		});
		const context = {
			...salaryContext,
			period: {
				...salaryContext.period,
				working_days: 22,
				month_working_days: 22,
				month_holiday_work_days: 0
			},
			work: {
				...salaryContext.work,
				dates: ['2026-10-03', '2026-10-05', '2026-10-06'],
				holidays: [],
				days: [
					// Six planned and approved Saturday rest-day hours at 200%; attendance does not grant them.
					day('2026-10-03', {
						day_type: 'REST',
						scheduled_hours: 0,
						worked_hours: 6,
						overtime_hours: 6,
						intervals: [{ start: '2026-10-03T08:00', end: '2026-10-03T14:00' }],
						overtime_intervals: [{ start: '2026-10-03T08:00', end: '2026-10-03T14:00' }]
					}),
					// A normal day 08:00-24:00: eight normal hours, eight overtime from 16:00, two of them at night.
					day('2026-10-05', {
						worked_hours: 16,
						overtime_hours: 8,
						intervals: [{ start: '2026-10-05T08:00', end: '2026-10-06T00:00' }],
						overtime_intervals: [{ start: '2026-10-05T16:00', end: '2026-10-06T00:00' }]
					}),
					// A night shift 22:00-06:00 with no overtime: eight night hours at +30%.
					day('2026-10-06', {
						worked_hours: 8,
						intervals: [{ start: '2026-10-06T22:00', end: '2026-10-07T06:00' }]
					})
				]
			}
		};
		const amount = (version: string, code: string) => {
			const row = rows(version, 'work_catalog').find((item) => item.code === code);
			assert.ok(row, code);
			if (
				evaluateConfigured(fixtureString(String(row.eligibility)), fixtureContext(context)) !== true
			)
				return 0;
			return Math.round(
				Number(evaluateConfigured(fixtureString(String(row.quantity)), fixtureContext(context))) *
					Number(evaluateConfigured(fixtureString(String(row.rate)), fixtureContext(context)))
			);
		};
		const hour = 26000000 / 22 / 8;
		for (const version of VERSIONS) {
			assert.equal(amount(version, 'OVERTIME'), Math.round(8 * 1.5 * hour), version);
			assert.equal(amount(version, 'REST_DAY_OVERTIME'), Math.round(6 * 2 * hour), version);
			assert.equal(amount(version, 'NIGHT_WORK'), Math.round((2 + 8) * 0.3 * hour), version);
			// Two night overtime hours on a day with day-time overtime: 20% of the 150% hour.
			assert.equal(amount(version, 'NIGHT_OVERTIME'), Math.round(2 * 1.5 * 0.2 * hour), version);
			assert.equal(amount(version, 'NO_PAY_LEAVE'), Math.round((2 * 26000000) / 22), version);
		}
		// Night overtime starts where the planned hours run out: a 22:00 arrival worked to 10:00 has its 8 normal hours at
		// night and its 4 overtime hours in the morning — no night overtime, 8 normal night hours (art.57(1)(b)).
		const dawn = {
			...context,
			work: {
				...context.work,
				days: [
					day('2026-10-07', {
						worked_hours: 12,
						overtime_hours: 4,
						intervals: [{ start: '2026-10-07T22:00', end: '2026-10-08T10:00' }],
						overtime_intervals: [{ start: '2026-10-08T06:00', end: '2026-10-08T10:00' }]
					})
				]
			}
		};
		const quantityOn = (version: string, code: string, on: Row) =>
			Number(
				evaluateConfigured(
					fixtureString(
						String(
							fixturePresent(rows(version, 'work_catalog').find((item) => item.code === code))
								.quantity
						)
					),
					fixtureContext(on)
				)
			);
		for (const version of VERSIONS)
			assert.equal(quantityOn(version, 'NIGHT_OVERTIME', dawn), 0, version);
		assert.equal(quantityOn('version_4', 'NIGHT_WAGE_EXEMPT', dawn), 8);
		// Decree 253/2026 art.26(1), from 1 July 2026: the night-work wage itself leaves the PIT base — the 8 normal night
		// hours at the normal hour wage (the 2 night overtime hours are overtime); an EMPLOYER line, not paid again.
		assert.equal(amount('version_4', 'NIGHT_WAGE_EXEMPT'), Math.round(8 * hour));
		const exempt = fixturePresent(
			rows('version_4', 'work_catalog').find((item) => item.code === 'NIGHT_WAGE_EXEMPT')
		);
		assert.deepEqual(
			[exempt.destination, exempt.direction, exempt.counts_toward],
			['EMPLOYER', 'SUBTRACT', ['PIT']]
		);
		// A rest-day or holiday night shift is paid inside REST_DAY_OVERTIME / HOLIDAY_WORK, already outside PIT: it is
		// not exempted a second time — only the normal day's 8 night hours leave the base.
		const nightOn = (extra: Row) => ({
			...context,
			work: {
				...context.work,
				days: [
					...context.work.days,
					day('2026-10-10', {
						worked_hours: 8,
						scheduled_hours: 0,
						intervals: [{ start: '2026-10-10T22:00', end: '2026-10-11T06:00' }],
						...extra
					})
				]
			}
		});
		for (const extra of [{ day_type: 'REST' }, { holiday_kind: 'PUBLIC_HOLIDAY' }])
			assert.equal(
				Math.round(
					Number(
						evaluateConfigured(
							fixtureString(String(exempt.quantity)),
							fixtureContext(nightOn(extra))
						)
					) *
						Number(
							evaluateConfigured(fixtureString(String(exempt.rate)), fixtureContext(nightOn(extra)))
						)
				),
				Math.round(8 * hour),
				JSON.stringify(extra)
			);
		for (const version of ['version_1', 'version_2', 'version_3'])
			assert.equal(
				rows(version, 'work_catalog').some((item) => item.code === 'NIGHT_WAGE_EXEMPT'),
				false
			);
		// Without planned shifts the record's fallback divisor is 26 days of 8 hours.
		const unplanned = {
			...salaryContext,
			period: {
				...salaryContext.period,
				working_days: 0,
				month_working_days: 0,
				month_holiday_work_days: 0
			},
			work: {
				...salaryContext.work,
				days: [day('2026-10-05', { day_type: '', overtime_hours: 2 })]
			}
		};
		const ot = fixturePresent(
			rows('version_4', 'work_catalog').find((item) => item.code === 'OVERTIME')
		);
		assert.equal(
			Number(evaluateConfigured(fixtureString(String(ot.rate)), fixtureContext(unplanned))),
			1.5 * 125000
		);
	});
	it('ordinary and rest-day overtime quantities use approvals independently of actual attendance', () => {
		for (const version of VERSIONS) {
			for (const planned of [
				{ code: 'OVERTIME', day_type: 'WORK', multiplier: 1.5 },
				{ code: 'REST_DAY_OVERTIME', day_type: 'REST', multiplier: 2 }
			]) {
				const row = fixturePresent(
					rows(version, 'work_catalog').find((item) => item.code === planned.code)
				);
				for (const worked_hours of [0, 3, 8, 16]) {
					const day = {
						...fixturePresent(salaryContext.work.days[1]),
						day_type: planned.day_type,
						worked_hours,
						overtime_hours: 2
					};
					const context = {
						...salaryContext,
						rules: payrollRules(version),
						work: { ...salaryContext.work, holidays: [], days: [day] }
					};
					const quantity = Number(
						evaluateConfigured(fixtureString(String(row.quantity)), fixtureContext(context))
					);
					assert.equal(quantity, 2, `${version} ${planned.code}: actual ${worked_hours}`);
					assert.equal(
						quantity *
							Number(evaluateConfigured(fixtureString(String(row.rate)), fixtureContext(context))),
						2 * planned.multiplier * 125000
					);
					const unapproved = {
						...context,
						work: { ...context.work, days: [{ ...day, overtime_hours: 0 }] }
					};
					assert.equal(
						Number(
							evaluateConfigured(fixtureString(String(row.quantity)), fixtureContext(unapproved))
						),
						0
					);
					assert.equal(
						evaluateConfigured(fixtureString(String(row.eligibility)), fixtureContext(unapproved)),
						false
					);
				}
			}
		}
	});
	it('SI, HI and the union fee follow the reference-level cap and floor of each version', () => {
		assert.deepEqual(charge('version_1', 'SI', 10000000), {
			employee: 800000,
			employer: 1750000
		});
		assert.deepEqual(charge('version_1', 'SI', 60000000), {
			employee: 3744000,
			employer: 8190000
		});
		assert.deepEqual(charge('version_3', 'SI', 60000000), {
			employee: 3744000,
			employer: 8190000
		});
		assert.deepEqual(charge('version_4', 'SI', 60000000), {
			employee: 4048000,
			employer: 8855000
		});
		assert.deepEqual(charge('version_1', 'SI', 1000000), {
			employee: 187200,
			employer: 409500
		});
		assert.deepEqual(charge('version_1', 'HI', 60000000), {
			employee: 702000,
			employer: 1404000
		});
		assert.deepEqual(charge('version_4', 'HI', 60000000), {
			employee: 759000,
			employer: 1518000
		});
		assert.deepEqual(charge('version_2', 'UNION_FEE', 60000000), {
			employee: 0,
			employer: 936000
		});
		assert.deepEqual(charge('version_4', 'UNION_FEE', 60000000), {
			employee: 0,
			employer: 1012000
		});
	});
	it('unemployment insurance covers citizens on 20 regional minimum wages', () => {
		assert.deepEqual(charge('version_1', 'UI', 120000000), {
			employee: 992000,
			employer: 992000
		});
		assert.deepEqual(charge('version_2', 'UI', 120000000), {
			employee: 1062000,
			employer: 1062000
		});
		assert.deepEqual(
			charge(
				'version_2',
				'UI',
				120000000,
				{ residency_status: 'RESIDENT' },
				{ employee: { nationality: 'JAPANESE' } }
			),
			{
				employee: 0,
				employer: 0
			}
		);
	});
	it('union dues charge members only: 0.5% within 10% of the reference level', () => {
		const citizen = { residency_status: 'CITIZEN' };
		const member = { elections: { union_member: true } };
		assert.deepEqual(charge('version_1', 'UNION_DUES', 30000000), { employee: 0, employer: 0 });
		assert.deepEqual(charge('version_1', 'UNION_DUES', 30000000, citizen, member), {
			employee: 150000,
			employer: 0
		});
		assert.equal(charge('version_1', 'UNION_DUES', 60000000, citizen, member).employee, 234000);
		assert.equal(charge('version_4', 'UNION_DUES', 60000000, citizen, member).employee, 253000);
	});
	it('PIT: the 2025 seven-rung scale, the 2026 five-rung scale and the 20% non-resident rate', () => {
		assert.equal(charge('version_1', 'PIT', 30000000).employee, 1627500);
		assert.equal(charge('version_2', 'PIT', 30000000).employee, 635000);
		assert.equal(charge('version_4', 'PIT', 30000000).employee, 635000);
		assert.equal(
			charge(
				'version_4',
				'PIT',
				50000000,
				{ residency_status: 'CITIZEN' },
				{ elections: { dependants: 1 } }
			).employee,
			1805000
		);
		assert.equal(charge('version_4', 'PIT', 15000000).employee, 0);
		assert.equal(
			charge('version_4', 'PIT', 30000000, { residency_status: 'NON_RESIDENT' }).employee,
			6000000
		);
		assert.throws(() => charge('version_4', 'PIT', 30000000, { residency_status: 'FOREIGNER' }));
	});
	it('PIT from July 2026: voluntary pension deduction, 10% on short contracts above 5,000,000', () => {
		const citizen = { residency_status: 'CITIZEN' };
		const base = charge('version_4', 'PIT', 30000000, citizen).employee;
		assert.equal(base, 635000);
		// At most 3,000,000 off taxable income: 11,350,000 falls to 8,350,000, all in the 5% rung.
		assert.equal(
			charge('version_4', 'PIT', 30000000, citizen, {
				elections: { voluntary_pension_contribution: 5000000 }
			}).employee,
			417500
		);
		// A fixed-term (CONTRACT) engagement with no recorded term, served under three months.
		const short = {
			employment: { start_date: '2026-08-01', exit_date: '2026-09-30' },
			terms: { employment_type: 'CONTRACT' }
		};
		assert.equal(charge('version_4', 'PIT', 30000000, citizen, short).employee, 3000000);
		// PERMANENT is an indefinite-term contract (Labour Code art.20(1)(a)): a leaver in month 2 with no term facts is
		// on the progressive scale, 30,000,000 − 3,150,000 − 15,500,000 = 11,350,000 → 635,000 (Decree 253/2026 art.50(2)).
		assert.equal(
			charge('version_4', 'PIT', 30000000, citizen, {
				employment: short.employment,
				terms: { employment_type: 'PERMANENT' }
			}).employee,
			635000
		);
		assert.equal(charge('version_4', 'PIT', 4000000, citizen, short).employee, 0);
		// The threshold is per payment ("từ 05 triệu đồng/lần trở lên", Decree 253/2026 art.50(2)), each slip on its own:
		// a 4,000,000 bonus after a 6,000,000 payment of the month is under it (the month stays at the 600,000 withheld),
		// a 6,000,000 one after a 4,000,000 payment is withheld 600,000.
		const paid = (base: number, withheld: number) => ({
			...short,
			earned: {
				months: [],
				month: { statutory: { PIT: { employee: withheld, employer: 0, base } } }
			},
			chargedMonth: { PIT: { employee: withheld, employer: 0 } }
		});
		assert.equal(
			charge('version_4', 'PIT', 10000000, citizen, paid(6000000, 600000)).employee,
			600000
		);
		assert.equal(charge('version_4', 'PIT', 10000000, citizen, paid(4000000, 0)).employee, 600000);
		assert.equal(
			charge('version_4', 'PIT', 30000000, citizen, {
				...short,
				elections: { commitment_form: true }
			}).employee,
			0
		);
		// Three months or longer is withheld on the progressive scale.
		const quarter = { employment: { start_date: '2026-07-01', exit_date: '2026-09-30' } };
		assert.equal(charge('version_4', 'PIT', 30000000, citizen, quarter).employee, base);
		assert.equal(
			charge('version_4', 'PIT', 30000000, { residency_status: 'NON_RESIDENT' }, short).employee,
			6000000
		);
		// Decree 253/2026 art.50(2): the contract's agreed term, not the exit date — an indefinite contract left in
		// month 2 is on the progressive scale; a genuine 2-month contract is 10%, a 12-month one left early is not.
		for (const version of ['version_1', 'version_4']) {
			const early = (facts: Row) => ({ ...short, terms: { facts } });
			const progressive = charge(version, 'PIT', 30000000, citizen).employee;
			assert.equal(
				charge(version, 'PIT', 30000000, citizen, early({ contract_type: 'INDEFINITE' })).employee,
				progressive,
				version
			);
			assert.equal(
				charge(
					version,
					'PIT',
					30000000,
					citizen,
					early({ contract_type: 'FIXED', agreed_term_months: 12 })
				).employee,
				progressive,
				version
			);
			assert.equal(
				charge(
					version,
					'PIT',
					30000000,
					citizen,
					early({ contract_type: 'FIXED', agreed_term_months: 2 })
				).employee,
				3000000,
				version
			);
			// A 2-month contract still in force (no exit yet) is short too.
			assert.equal(
				charge(version, 'PIT', 30000000, citizen, {
					terms: { facts: { contract_type: 'FIXED', agreed_term_months: 2 } }
				}).employee,
				3000000,
				version
			);
		}
	});
	it('the regional minimum wage per version', () => {
		const wage = (version: string) =>
			fixtureValue10(
				rows(version, 'rule_set').find(
					(row) => row.family === 'PAYROLL' && row.code === 'minimum_wage'
				)?.rules
			).by_region;
		assert.deepEqual(wage('version_1'), {
			I: 4960000,
			II: 4410000,
			III: 3860000,
			IV: 3450000
		});
		for (const version of ['version_2', 'version_3', 'version_4'])
			assert.deepEqual(wage(version), {
				I: 5310000,
				II: 4730000,
				III: 4140000,
				IV: 3700000
			});
	});
	it('annual leave: 12 days, pro rata in the first year, one more day every five years', () => {
		const annual = rows('version_4', 'leave_catalog').find((row) => row.code === 'ANNUAL_LEAVE');
		const entitlement = fixtureValue11(annual?.entitlement);
		assert.equal(
			entitlementDays(fixtureEntitlement(entitlement), 6, fixtureContext(LEAVE_SUBJECT)),
			6
		);
		assert.equal(
			entitlementDays(fixtureEntitlement(entitlement), 12, fixtureContext(LEAVE_SUBJECT)),
			12
		);
		assert.equal(
			entitlementDays(fixtureEntitlement(entitlement), 59, fixtureContext(LEAVE_SUBJECT)),
			12
		);
		assert.equal(
			entitlementDays(fixtureEntitlement(entitlement), 60, fixtureContext(LEAVE_SUBJECT)),
			13
		);
		assert.equal(
			entitlementDays(fixtureEntitlement(entitlement), 130, fixtureContext(LEAVE_SUBJECT)),
			14
		);
		assert.equal(annual?.entitlement && fixtureValue2(annual.entitlement).window, 'CALENDAR_YEAR');
		// Labour Code art.113(1): 14 days for arduous work, a minor or a disabled employee, 16 for especially arduous.
		const as = (terms: Row, employee: Row = {}) => ({
			...LEAVE_SUBJECT,
			terms: { ...LEAVE_SUBJECT.terms, ...terms },
			employee: { ...LEAVE_SUBJECT.employee, ...employee }
		});
		assert.equal(
			entitlementDays(
				fixtureEntitlement(entitlement),
				70,
				fixtureContext(as({ work_classification: 'ARDUOUS' }))
			),
			15
		);
		assert.equal(
			entitlementDays(
				fixtureEntitlement(entitlement),
				24,
				fixtureContext(as({ work_classification: 'ESPECIALLY_ARDUOUS' }))
			),
			16
		);
		assert.equal(
			entitlementDays(fixtureEntitlement(entitlement), 24, fixtureContext(as({}, { age: 17 }))),
			14
		);
		assert.equal(
			entitlementDays(
				fixtureEntitlement(entitlement),
				6,
				fixtureContext(as({ facts: { disabled: true } }))
			),
			7
		);
		// Law 41/2024 art.43(1): sick days a year by years of SI contribution, 10 more for arduous work.
		const sick = rows('version_4', 'leave_catalog').find(
			(row) => row.code === 'SICK_LEAVE'
		)?.entitlement;
		assert.equal(fixturePresent(fixtureEntitlement(sick)).window, 'CALENDAR_YEAR');
		const sickDays = (years: number | null, terms: Row = {}) =>
			entitlementDays(
				fixtureEntitlement(sick),
				40,
				fixtureContext(as(terms, { facts: years == null ? {} : { si_contribution_years: years } }))
			);
		assert.equal(sickDays(10), 30);
		assert.equal(sickDays(15), 40);
		assert.equal(sickDays(30), 60);
		assert.equal(sickDays(10, { work_classification: 'ARDUOUS' }), 40);
		// Unrecorded contribution years: the least band, 30 days (Law 41/2024 art.43(1)).
		assert.equal(sickDays(null), 30);
		// Labour Code art.115: paid personal leave is a grant per event.
		for (const [code, grant] of [
			['MARRIAGE_LEAVE', 3],
			['CHILD_MARRIAGE_LEAVE', 1],
			['BEREAVEMENT_LEAVE', 3],
			['BEREAVEMENT_LEAVE_UNPAID', 1]
		] as const) {
			const row = rows('version_4', 'leave_catalog').find((item) => item.code === code);
			const held = row?.entitlement;
			assert.equal(fixturePresent(fixtureEntitlement(held)).window, 'EVENT', code);
			assert.equal(
				entitlementDays(fixtureEntitlement(held), 40, fixtureContext(LEAVE_SUBJECT)),
				grant,
				code
			);
		}
		for (const version of VERSIONS)
			for (const row of rows(version, 'leave_catalog'))
				assert.equal(row.can_encash, row.code === 'ANNUAL_LEAVE', `${version} ${String(row.code)}`);
	});
	it('first-year annual leave counts a month worked or paid on at least half its normal days (Decree 145/2020 art.66)', () => {
		for (const version of VERSIONS) {
			const annual = fixturePresent(
				rows(version, 'leave_catalog').find((row) => row.code === 'ANNUAL_LEAVE')
			);
			const cls = seedClass(annual);
			// Hired 16 March 2026; weekdays scheduled. March: 12 weekdays, 6 worked + 1 annual-leave day = 7 (counts);
			// April: absent from the 13th (8 of 22, does not count); May–June worked; read on 30 June.
			const days: AttendanceDay[] = [];
			for (let t = Date.parse('2026-03-16'); t <= Date.parse('2026-06-30'); t += 86400000) {
				const date = new Date(t).toISOString().slice(0, 10);
				const weekday = new Date(t).getUTCDay();
				const scheduled = weekday !== 0 && weekday !== 6;
				const leave = date === '2026-03-26' ? ['ANNUAL_LEAVE'] : [];
				const worked =
					scheduled &&
					leave.length === 0 &&
					!(date >= '2026-03-24' && date < '2026-03-26') &&
					!(date >= '2026-03-27' && date <= '2026-03-31') &&
					!(date >= '2026-04-13' && date <= '2026-04-30');
				days.push({ date, scheduled, worked, holiday: false, leave });
			}
			const balance = (asOf: string) =>
				fixturePresent(
					leaveBalances({
						classes: [cls],
						movements: [],
						serviceMonths: serviceMonthsAt('2026-03-16', asOf, 0),
						asOf,
						employmentStart: '2026-03-16',
						attendanceDays: days.filter((day) => day.date <= asOf),
						context: { ...LEAVE_SUBJECT, employment: { start_date: '2026-03-16' } }
					})[0]
				).entitlement;
			// March, May and June count: 12 × 3 / 12. On 31 March no month is complete, yet March counts (art.66(2)).
			assert.equal(balance('2026-06-30'), 3, version);
			assert.equal(balance('2026-03-31'), 1, version);
			assert.equal(balance('2026-04-30'), 1, version);
		}
	});
	it('annual leave combined by agreement over up to three years (Labour Code art.113(4))', () => {
		for (const version of VERSIONS) {
			const annual = fixturePresent(
				rows(version, 'leave_catalog').find((row) => row.code === 'ANNUAL_LEAVE')
			);
			assert.equal(fixtureValue2(annual.entitlement).carry_depth, 2, version);
			const balance = (combined: boolean | undefined, asOf = '2026-03-01') =>
				fixturePresent(
					leaveBalances({
						classes: [seedClass(annual)],
						movements: [
							seedMovement({
								catalog_id: annual.id,
								id: 'm1',
								activity: 'TIME_OFF',
								occurred_on: '2025-06-02',
								days: 4
							})
						],
						serviceMonths: serviceMonthsAt('2020-01-01', asOf, 0),
						asOf,
						employmentStart: '2020-01-01',
						context: {
							...LEAVE_SUBJECT,
							terms: {
								...LEAVE_SUBJECT.terms,
								facts: combined == null ? {} : { annual_leave_combined: combined }
							}
						}
					})[0]
				);
			// 2024: 12 days (59 months of service at its end); 2025 and 2026: 13 each (one more after five years);
			// 4 taken in 2025.
			assert.equal(balance(undefined).carried, 0, version);
			assert.equal(balance(false).available, 13, version);
			// Agreed: 2026 holds 2025's 9 unused and 2024's 12 — three years at once.
			assert.equal(balance(true).carried, 21, version);
			assert.equal(balance(true).available, 34, version);
			// In 2027 the 2024 days have lapsed: 2026's 13 and 2025's 9 carry in (not 35).
			assert.equal(balance(true, '2027-03-01').carried, 22, version);
		}
	});
	it('work suspensions: each Labour Code cause sets attendance and the day pay; the slip pays the difference', () => {
		// 26,000,000 over 26 working days is 1,000,000 a day; region I minimum 4,960,000 / 26 = 190,769.23.
		const day = (date: string, day_type = 'WORK') => ({ date, worked: false, day_type });
		const days = (kind: string, n: number) =>
			Array.from({ length: n }, (_, i) => ({
				...day(`2026-10-${String(i + 1).padStart(2, '0')}`),
				suspended: { kind, facts: {} }
			}));
		for (const version of VERSIONS) {
			const kinds = new Map(rows(version, 'suspension_kind').map((row) => [String(row.code), row]));
			assert.deepEqual(
				[...kinds.keys()],
				[
					'EMPLOYER_FAULT',
					'WORKER_FAULT',
					'COWORKER_FAULT',
					'OBJECTIVE_CAUSE',
					'STRIKE_PARTICIPANT',
					'STRIKE_NON_PARTICIPANT'
				],
				version
			);
			const context = (code: string, facts: Row, company: Row, index: number) => {
				const work = { days: days(code, 20) };
				return {
					...salaryContext,
					rules: payrollRules(version),
					company: { ...salaryContext.company, facts: company },
					work,
					day: work.days[index - 1],
					suspension: { kind: code, facts, working_days_elapsed: index }
				};
			};
			const pay = (code: string, facts: Row = {}, company: Row = {}, index = 1) =>
				Number(
					evaluateConfigured(
						fixtureString(String(fixturePresent(kinds.get(code)).pay)),
						fixtureContext(context(code, facts, company, index))
					)
				);
			const attended = (code: string) =>
				evaluateConfigured(
					fixtureString(String(fixturePresent(kinds.get(code)).counts_as_attended)),
					fixtureContext(context(code, {}, {}, 1))
				);
			const min = Number(fixtureValue10(payrollRules(version).minimum_wage).by_region.I) / 26;
			// art.99(1): the full wage, counted service (Decree 145/2020 art.65(9)).
			assert.equal(pay('EMPLOYER_FAULT'), 1000000);
			assert.equal(attended('EMPLOYER_FAULT'), true);
			// art.99(2): the worker at fault is unpaid and the days are not service.
			assert.equal(pay('WORKER_FAULT'), 0);
			assert.equal(attended('WORKER_FAULT'), false);
			// art.99(2): co-workers get the agreed share, floored at the minimum wage.
			assert.equal(pay('COWORKER_FAULT', { agreed_pay_percent: 70 }), 700000);
			assert.equal(pay('COWORKER_FAULT', { agreed_pay_percent: 10 }), min);
			assert.equal(attended('COWORKER_FAULT'), true);
			// art.99(3): the floor holds for the first 14 working days only, counted from the suspension's start
			// across pay periods (working_days_elapsed): its 14th day is floored, its 15th is not.
			assert.equal(pay('OBJECTIVE_CAUSE', {}, { stoppage_pay_percent: 10 }, 14), min);
			assert.equal(pay('OBJECTIVE_CAUSE', {}, { stoppage_pay_percent: 10 }, 15), 100000);
			assert.equal(attended('OBJECTIVE_CAUSE'), true);
			// art.207: strikers unpaid unless agreed; those stopped by the strike as art.99(2).
			assert.equal(pay('STRIKE_PARTICIPANT'), 0);
			assert.equal(pay('STRIKE_PARTICIPANT', { agreed_pay_percent: 50 }), 500000);
			assert.equal(attended('STRIKE_PARTICIPANT'), false);
			assert.equal(pay('STRIKE_NON_PARTICIPANT', { agreed_pay_percent: 10 }), min);
			assert.equal(attended('STRIKE_NON_PARTICIPANT'), true);
			// A rest day pays nothing extra; every kind stays scheduled.
			assert.equal(
				evaluateConfigured(
					fixtureString(String(fixturePresent(kinds.get('EMPLOYER_FAULT')).pay)),
					fixtureContext({
						...context('EMPLOYER_FAULT', {}, {}, 1),
						day: day('2026-10-04', 'REST')
					})
				),
				0
			);
			for (const kind of kinds.values())
				assert.equal(
					evaluateConfigured(
						fixtureString(String(kind.scheduled)),
						fixtureContext(context(String(kind.code), {}, {}, 1))
					),
					true,
					String(kind.code)
				);
			// The slip keeps the base and subtracts what the suspended days do not pay.
			const line = fixturePresent(
				rows(version, 'work_catalog').find((row) => row.code === 'SUSPENSION_PAY_ADJUSTMENT')
			);
			const slip = {
				...salaryContext,
				rules: payrollRules(version),
				work: {
					days: [
						{ ...day('2026-10-01'), suspended: { kind: 'WORKER_FAULT', pay: 0 } },
						{ ...day('2026-10-02'), suspended: { kind: 'COWORKER_FAULT', pay: 700000 } },
						{ ...day('2026-10-03'), suspended: { kind: 'EMPLOYER_FAULT', pay: 1000000 } },
						day('2026-10-05')
					]
				}
			};
			assert.equal(
				evaluateConfigured(fixtureString(String(line.eligibility)), fixtureContext(slip)),
				true
			);
			assert.equal(
				evaluateConfigured(fixtureString(String(line.rate)), fixtureContext(slip)),
				1300000
			);
			assert.equal(line.direction, 'SUBTRACT');
		}
	});
	it('record retention: anonymise 10 years after the exit year; PDPL disposal on the exit; breaches are cases', () => {
		for (const version of VERSIONS) {
			const rule = payrollRule(version, 'record_retention');
			assert.equal(
				evaluateConfigured(
					fixtureString(String(rule.until)),
					fixtureContext({ employment: { exit_date: '2026-10-31' } })
				),
				'2036-12-31',
				version
			);
			const disposal = dutiesOf(rows(version, 'rule_set')).find(
				(row) => row.code === 'PERSONAL_DATA_DISPOSAL'
			);
			// A data-protection violation is a workplace case: notice within 72 hours of its discovery (opening).
			const breach = raiseDuties({
				behaviours: fixtureValue12(settings(version).behaviours),
				settings_id: settings(version).id,
				rows: rows(version, 'rule_set'),
				collection: 'workplace_case',
				event: 'created',
				row: {
					id: 'case-1',
					company_id: 'co1',
					kind: 'PERSONAL_DATA_BREACH',
					opened_on: '2026-03-02'
				},
				day: '2026-03-02'
			}).map((write) => [write.duty_code, write.due_on]);
			assert.deepEqual(breach, [
				[
					version === 'version_1' ? 'DPD_BREACH_NOTIFICATION' : 'PDPL_BREACH_NOTIFICATION',
					'2026-03-05'
				]
			]);
			// Law 91/2025 is in force from 1 January 2026: the December 2025 version has no disposal duty.
			assert.equal(disposal == null, version === 'version_1', version);
			if (disposal)
				assert.equal(
					evaluateConfigured(
						fixtureString(String(fixtureValue2(disposal.rules).due)),
						fixtureContext({ exit_on: '2026-10-31' })
					),
					evaluateConfigured(
						fixtureString(String(rule.until)),
						fixtureContext({ employment: { exit_date: '2026-10-31' } })
					)
				);
		}
	});
	it.effect(
		'work-day sheet: the Labour Code working-time limits warn, a child under 13 refuses the file',
		Effect.fnUntraced(function* () {
			const adult = { number: 'E1', profile: { date_of_birth: '1990-01-01' } };
			// 5 October 2026: 07:00–19:00 on the 9-hour 08:00–17:00 shift: 9 normal hours (art.105) and 3 derived overtime
			// hours, within half the day's normal hours.
			const long = yield* rosterImport(
				[adult],
				[
					{
						row: 2,
						employee_number: 'E1',
						work_date: '2026-10-05',
						shift_code: 'D',
						clock_in: '07:00',
						clock_out: '19:00'
					}
				]
			);
			assert.deepEqual(long.errors, []);
			assert.deepEqual(
				long.warnings.map((finding) => [finding.row, finding.message]),
				[
					[
						2,
						'normal hours above 8 in the day (10 under a weekly arrangement) (Labour Code art.105).'
					]
				]
			);
			// A child of 11 on the sheet refuses it (art.145(3)); with the provincial approval it does not.
			const child = { number: 'E2', profile: { date_of_birth: '2015-03-01' } };
			const day = {
				row: 2,
				employee_number: 'E2',
				work_date: '2026-10-05',
				shift_code: 'D',
				clock_in: '09:00',
				clock_out: '12:00'
			};
			const refused = yield* rosterImport([child], [day]);
			assert.deepEqual(
				refused.errors.map((finding) => finding.row),
				[2]
			);
			assert.match(fixturePresent(refused.errors[0]).message, /under 13/);
			const approved = yield* rosterImport(
				[{ ...child, terms: { facts: { child_arts_sports_approved: true } } }],
				[day]
			);
			assert.deepEqual(approved.errors, []);
			// Each rule on its own day context, tripped and not.
			for (const version of VERSIONS) {
				const rule = (code: string) => {
					const row = fixturePresent(rows(version, 'rule_set').find((item) => item.code === code));
					const rules = fixtureValue2(row.rules);
					assert.equal(rules.site, 'roster', code);
					assert.ok(citationText(row.references).includes('Labour Code 2019'), code);
					return (context: Row) =>
						evaluateConfigured(
							fixtureString(String(rules.when)),
							fixtureContext({
								rules: payrollRules(version),
								company: { facts: {} },
								terms: { facts: {} },
								employee: { date_of_birth: '1990-01-01', children: [], facts: {} },
								week: { worked_hours: 40, overtime_hours: 0, worked_days: 5 },
								...context,
								day: {
									date: '2026-10-05',
									worked: true,
									worked_hours: 8,
									overtime_hours: 0,
									scheduled_hours: 8,
									intervals: [],
									rest_hours_before: null,
									...(context.day === undefined ? {} : fixtureValue2(context.day))
								}
							})
						);
				};
				const kind = (code: string) =>
					fixtureValue2(
						fixturePresent(rows(version, 'rule_set').find((item) => item.code === code)).rules
					).kind;
				assert.equal(rule('ROSTER_NORMAL_HOURS_DAY')({ day: { scheduled_hours: 9 } }), true);
				// The planned hours are the normal hours: overtime past the shift is not normal time.
				assert.equal(
					rule('ROSTER_NORMAL_HOURS_DAY')({ day: { worked_hours: 11, overtime_hours: 3 } }),
					false
				);
				assert.equal(
					rule('ROSTER_NORMAL_HOURS_DAY')({
						day: { scheduled_hours: 9 },
						terms: { facts: { normal_hours_arrangement: 'WEEKLY' } }
					}),
					false
				);
				assert.equal(
					rule('ROSTER_NORMAL_HOURS_WEEK')({
						week: { worked_hours: 50, overtime_hours: 1, worked_days: 6 }
					}),
					true
				);
				assert.equal(
					rule('ROSTER_NORMAL_HOURS_WEEK')({
						week: { worked_hours: 50, overtime_hours: 2, worked_days: 6 }
					}),
					false
				);
				assert.equal(
					rule('ROSTER_OVERTIME_DAY')({ day: { worked_hours: 13, overtime_hours: 5 } }),
					true
				);
				assert.equal(
					rule('ROSTER_OVERTIME_DAY')({ day: { worked_hours: 12, overtime_hours: 4 } }),
					false
				);
				assert.equal(
					rule('ROSTER_OVERTIME_DAY')({
						day: { worked_hours: 13, overtime_hours: 3 },
						terms: { facts: { normal_hours_arrangement: 'WEEKLY' } }
					}),
					true
				);
				assert.equal(rule('ROSTER_SHIFT_CHANGE_REST')({ day: { rest_hours_before: 10 } }), true);
				assert.equal(rule('ROSTER_SHIFT_CHANGE_REST')({ day: { rest_hours_before: 14 } }), false);
				assert.equal(
					rule('ROSTER_WEEKLY_REST')({
						week: { worked_hours: 56, overtime_hours: 0, worked_days: 7 }
					}),
					true
				);
				assert.equal(
					rule('ROSTER_WEEKLY_REST')({
						week: { worked_hours: 56, overtime_hours: 0, worked_days: 7 },
						company: { facts: { rest_averaged_monthly: true } }
					}),
					false
				);
				const night = [{ start: '2026-10-05T21:00', end: '2026-10-05T23:00' }];
				const minor = { employee: { date_of_birth: '2010-01-01', children: [], facts: {} } };
				assert.equal(
					rule('ROSTER_MINOR_WORKING_TIME')({
						...minor,
						day: { intervals: night, worked_hours: 2 }
					}),
					true
				);
				assert.equal(
					rule('ROSTER_MINOR_WORKING_TIME')({ ...minor, day: { worked_hours: 8 } }),
					false
				);
				assert.equal(
					rule('ROSTER_MINOR_WORKING_TIME')({
						employee: { date_of_birth: '2012-01-01', children: [], facts: {} },
						day: { worked_hours: 5 }
					}),
					true
				);
				const mother = (facts: Row = {}) => ({
					employee: {
						date_of_birth: '1990-01-01',
						children: [{ child_birthdate: '2026-03-01' }],
						facts
					}
				});
				assert.equal(
					rule('ROSTER_MATERNITY_NIGHT_OVERTIME')({ ...mother(), day: { overtime_hours: 1 } }),
					true
				);
				// Consent is the day's (the sheet's per-day column, owner ruling), never an employee fact.
				assert.equal(
					rule('ROSTER_MATERNITY_NIGHT_OVERTIME')({
						...mother(),
						day: { overtime_hours: 1, overtime_consented: true }
					}),
					false
				);
				assert.equal(
					rule('ROSTER_MATERNITY_NIGHT_OVERTIME')({
						...mother({ night_overtime_consent: true }),
						day: { overtime_hours: 1, overtime_consented: false }
					}),
					true
				);
				assert.equal(
					rule('ROSTER_UNDER_13')({
						employee: { date_of_birth: '2015-01-01', children: [], facts: {} }
					}),
					true
				);
				assert.deepEqual(
					[
						'ROSTER_NORMAL_HOURS_DAY',
						'ROSTER_NORMAL_HOURS_WEEK',
						'ROSTER_OVERTIME_DAY',
						'ROSTER_SHIFT_CHANGE_REST',
						'ROSTER_WEEKLY_REST',
						'ROSTER_MINOR_WORKING_TIME',
						'ROSTER_MATERNITY_NIGHT_OVERTIME',
						'ROSTER_UNDER_13'
					].map(kind),
					['warn', 'warn', 'warn', 'warn', 'warn', 'warn', 'warn', 'refuse']
				);
			}
		})
	);
	it('severance is half a month per year, odd months rounded to a half or a whole year', () => {
		const severance = (code: string, months: number) => {
			const row = rows('version_4', 'adhoc_catalog').find((item) => item.code === code);
			const [band] = fixtureValue13(row?.bands);
			assert.ok(band);
			return evaluateConfigured(
				fixtureString(band.amount),
				fixtureContext({
					...payslipContext,
					entry: entry({ qualifying_months: months })
				})
			);
		};
		assert.equal(severance('SEVERANCE_ALLOWANCE', 36), 0.5 * 20000000 * 3);
		assert.equal(severance('SEVERANCE_ALLOWANCE', 41), 0.5 * 20000000 * 3.5);
		// Decree 145/2020 art.8(3): a remainder of up to six months is half a year, more than six a full year.
		assert.equal(severance('SEVERANCE_ALLOWANCE', 42), 0.5 * 20000000 * 3.5);
		assert.equal(severance('SEVERANCE_ALLOWANCE', 43), 0.5 * 20000000 * 4);
		assert.equal(severance('JOB_LOSS_ALLOWANCE', 13), 20000000 * 2);
		assert.equal(severance('JOB_LOSS_ALLOWANCE', 48), 20000000 * 4);
	});
	it('behaviours admit payroll, and exit encashment prices VN annual leave', () => {
		for (const version of VERSIONS) {
			const behaviours = fixtureValue12(settings(version).behaviours);
			const planned = planBehaviours(
				behaviours,
				{ kind: 'catalog', catalog: 'WORK', event: 'PAYROLL_CREATE' },
				{ event: { data: { request: { kind: 'REGULAR', period: '2026-10' } } } }
			);
			assert.ok(planned.some((rule) => rule.id === 'payroll-run'));
			const annual = rows(version, 'leave_catalog').find((row) => row.code === 'ANNUAL_LEAVE');
			assert.ok(annual);
			const encash = behaviours.rules.find((rule) => rule.id === 'encash-leave-on-exit');
			assert.ok(encash);
			const days = (from: string, to: string, taken: number) =>
				effectWrites(
					encash,
					withSubjectBalances({
						event: {
							settings_id: settings(version).id,
							row: {
								id: 'c1',
								exit_facts: {},
								prior_service_months: 0,
								effective_range: { from, to }
							}
						},
						catalogues: [
							{
								...annual,
								id: annual.id,
								code: 'ANNUAL_LEAVE',
								unit: 'DAY',
								entitlement: annual.entitlement
							}
						],
						movements: [
							// Annual leave meters the calendar year: the days taken fall in the leaving year.
							{
								catalog_id: annual.id,
								activity: 'TIME_OFF',
								days: taken,
								reference: 'x',
								from: '2026-03-02',
								to: '2026-03-03',
								occurred_on: '2026-03-02'
							}
						]
					})
				).map((write) => fixtureValue14(write.data).days);
			assert.deepEqual(days('2026-01-01', '2026-07-31', 2), [4]);
			assert.deepEqual(days('2020-01-01', '2026-07-31', 3), [10]);
		}
	});
	it('the UI cap follows the entity region; SI and the union fee read the entity facts', () => {
		const citizen = { residency_status: 'CITIZEN' };
		assert.deepEqual(charge('version_4', 'UI', 120000000, citizen, { company: { region: 'IV' } }), {
			employee: 740000,
			employer: 740000
		});
		assert.equal(
			charge('version_1', 'UI', 120000000, citizen, { company: { region: 'II' } }).employee,
			882000
		);
		assert.equal(charge('version_4', 'UI', 120000000).employee, 1062000);
		assert.equal(
			charge('version_4', 'PIT', 120000000, citizen, { company: { region: 'IV' } }).employee,
			20185900
		);
		assert.equal(charge('version_4', 'PIT', 120000000).employee, 20089300);
		const reduced = { company: { facts: { occupational_accident_reduced: true } } };
		for (const version of VERSIONS)
			assert.equal(charge(version, 'SI', 10000000, citizen, reduced).employer, 1730000);
		const cut = { company: { facts: { union_fee_reduction_percent: 20 } } };
		const suspended = { company: { facts: { union_fee_suspended: true } } };
		for (const version of ['version_3', 'version_4']) {
			assert.equal(charge(version, 'UNION_FEE', 10000000, citizen, cut).employer, 160000);
			assert.equal(charge(version, 'UNION_FEE', 10000000, citizen, suspended).employer, 0);
		}
		assert.equal(charge('version_2', 'UNION_FEE', 10000000, citizen, suspended).employer, 200000);
	});
	it('statutory is never deferred: an off-cycle slip before the salary run is charged at the margin above the regular pay', () => {
		const citizen = { residency_status: 'CITIZEN' };
		// 40,000,000 paid off-cycle before the salary run of a 30,000,000 contract; inside the salary run (70,000,000);
		// the regular pay alone (30,000,000).
		const terms = { base_salary: 30000000, monthly_wage: 30000000 };
		const before = { terms, period: { salary_run: false } };
		for (const version of VERSIONS)
			for (const [rule, subject] of [
				['progressive', {}],
				['net of tax', { terms: { ...terms, facts: { net_of_tax: true } } }],
				[
					'December finalisation',
					{
						elections: { finalisation_authorised: true },
						period: { key: '2026-12', from: '2026-12-01', to: '2026-12-31', month: 12 },
						year: { ordinary: 330000000 },
						chargedYear: {
							SI: { employee: 26400000, employer: 0 },
							HI: { employee: 4950000, employer: 0 },
							UI: { employee: 3300000, employer: 0 },
							PIT: { employee: 7315000, employer: 0 }
						}
					}
				]
			] as const) {
				const at = (wage: number, extra: Subject) => {
					const { employee, employer } = charge(version, 'PIT', wage, citizen, {
						...subject,
						...extra,
						terms: { ...terms, ...('terms' in subject ? subject.terms : {}) },
						period: { ...('period' in subject ? subject.period : {}), ...extra.period }
					});
					return employee + employer;
				};
				const offCycle = at(40000000, before);
				// each month charge is rounded to the dong: at most 1 apart
				assert.ok(
					Math.abs(offCycle - (at(70000000, {}) - at(30000000, {}))) <= 1,
					`${version} ${rule}`
				);
				assert.ok(offCycle > 0, `${version} ${rule}`);
			}
		// The month's insurance rides on the regular pay: nothing on the off-cycle slip before it, all of it after.
		for (const version of VERSIONS)
			for (const code of ['SI', 'HI', 'UI', 'UNION_FEE']) {
				const { employee, employer } = charge(version, code, 40000000, citizen, before);
				assert.equal(employee + employer, 0, `${version} ${code}`);
				const paid = charge(version, code, 40000000, citizen, {
					terms,
					period: { salary_run: false, salary_paid: true }
				});
				assert.ok(paid.employee + paid.employer > 0, `${version} ${code}`);
			}
	});
	it('maternity leave admits women and paternity leave men', () => {
		for (const version of VERSIONS) {
			const eligible = (code: string, gender: string) => {
				const row = rows(version, 'leave_catalog').find((item) => item.code === code);
				assert.ok(row);
				return evaluateConfigured(
					fixtureString(String(row.eligibility)),
					fixtureContext({
						...admitContext,
						employee: { ...admitContext.employee, gender }
					})
				);
			};
			assert.equal(eligible('MATERNITY_LEAVE', 'FEMALE'), true);
			assert.equal(eligible('MATERNITY_LEAVE', 'MALE'), false);
			assert.equal(eligible('PATERNITY_LEAVE', 'MALE'), true);
			assert.equal(eligible('PATERNITY_LEAVE', 'FEMALE'), false);
		}
	});
	it('stoppage for a co-worker or an objective cause pays the agreed share, floored at the regional minimum', () => {
		const line = (version: string, percent: number | null, region = 'I') => {
			const row = rows(version, 'work_catalog').find((item) => item.code === 'STOPPAGE_REDUCTION');
			assert.ok(row);
			const context = {
				...salaryContext,
				rules: payrollRules(version),
				company: { region, facts: percent == null ? {} : { stoppage_pay_percent: percent } },
				leave: {
					rows: [
						{
							code: 'STOPPAGE_OBJECTIVE',
							activity: 'TIME_OFF',
							days: 2,
							is_npl: false,
							can_encash: false
						},
						{
							code: 'STOPPAGE_EMPLOYER_FAULT',
							activity: 'TIME_OFF',
							days: 3,
							is_npl: false,
							can_encash: false
						}
					]
				}
			};
			if (
				evaluateConfigured(fixtureString(String(row.eligibility)), fixtureContext(context)) !== true
			)
				return 0;
			return Math.round(
				Number(evaluateConfigured(fixtureString(String(row.quantity)), fixtureContext(context))) *
					Number(evaluateConfigured(fixtureString(String(row.rate)), fixtureContext(context)))
			);
		};
		const day = 26000000 / 26;
		assert.equal(line('version_4', null), 0);
		assert.equal(line('version_4', 100), 0);
		assert.equal(line('version_4', 70), Math.round(2 * (day - 0.7 * day)));
		assert.equal(line('version_4', 10), Math.round(2 * (day - 5310000 / 26)));
		assert.equal(line('version_1', 10, 'IV'), Math.round(2 * (day - 3450000 / 26)));
	});
	it('obligations are rule_set rows whose due date evaluates for their trigger', () => {
		const contexts: {
			[trigger: string]: Row;
		} = {
			PAYROLL_RUN: {
				period: { key: '2026-12', from: '2026-12-01', to: '2026-12-31' },
				company: COMPANY,
				headcount: 12
			},
			'leave_catalog_entry.created': {
				row: { catalog_code: 'SICK_LEAVE', from: '2026-10-05', to: '2026-10-09' },
				today: '2026-10-05',
				holidays: [],
				company: COMPANY
			},
			HIRE: {
				hired_on: '2026-10-15',
				contract: CONTRACT,
				employee: PROFILE,
				company: COMPANY,
				holidays: []
			},
			EXIT: {
				exit_on: '2026-10-31',
				contract: CONTRACT,
				employee: PROFILE,
				company: COMPANY,
				holidays: []
			},
			'entity.created': {
				row: COMPANY,
				period: { key: '2026-10', from: '2026-10-01', to: '2026-10-31' },
				company: COMPANY
			},
			'calendar.daily': {
				today: '2026-09-01',
				contract: {
					...CONTRACT,
					facts: { contract_terms: [{ facts: { work_permit_valid_until: '2026-10-16' } }] }
				},
				holidays: []
			},
			'workplace_case.created': {
				row: { kind: 'PERSONAL_DATA_BREACH', opened_on: '2026-12-28' },
				company: COMPANY,
				holidays: []
			}
		};
		const duties = (version: string) =>
			new Map(
				dutiesOf(rows(version, 'rule_set')).map((row) => [
					String(row.code),
					fixtureValue15({ ...fixtureRecord(row.rules), trigger: triggerOf(row) })
				])
			);
		for (const version of VERSIONS) {
			const all = duties(version);
			assert.equal(
				all.size,
				{ version_1: 44, version_2: 45, version_3: 45, version_4: 46 }[version],
				version
			);
			for (const [code, rules] of all) {
				const where = `${version} ${code}`;
				for (const key of Object.keys(rules)) assert.ok(DUTY_KEYS.includes(key), `${where}.${key}`);
				assert.ok(
					rules.description.length > 0 &&
						citationText(
							fixturePresent(rows(version, 'rule_set').find((row) => row.code === code)).references
						).length > 0,
					where
				);
				const context = contexts[rules.trigger];
				assert.ok(context, `${where} trigger ${rules.trigger}`);
				for (const month of rules.months ?? []) assert.match(month, /^(0[1-9]|1[0-2])$/, where);
				assert.match(
					String(evaluateConfigured(fixtureString(rules.due), fixtureContext(context))),
					/^\d{4}-\d{2}-\d{2}$/,
					where
				);
				if (rules.applies_when !== undefined)
					assert.equal(
						typeof evaluateConfigured(fixtureString(rules.applies_when), fixtureContext(context)),
						'boolean',
						where
					);
			}
		}
		const due = (version: string, code: string, context: Row) => {
			const rules = duties(version).get(code);
			assert.ok(rules, code);
			return evaluateConfigured(fixtureString(rules.due), fixtureContext(context));
		};
		const period = (key: string, company: Row = COMPANY) => ({
			company,
			period: {
				key,
				from: `${key}-01`,
				to: String(evaluateConfigured(fixtureString(`month_end("${key}-01")`), fixtureContext({})))
			}
		});
		assert.equal(due('version_4', 'SI_HI_UI_MONTHLY_REMITTANCE', period('2026-10')), '2026-11-30');
		assert.equal(due('version_4', 'UNION_FEE_REMITTANCE', period('2026-10')), '2026-11-30');
		assert.equal(due('version_1', 'PIT_WITHHOLDING_DECLARATION', period('2025-12')), '2026-01-20');
		assert.equal(due('version_4', 'PIT_WITHHOLDING_DECLARATION', period('2026-09')), '2026-10-31');
		// A remittance raised every month; each month's tax is due with its quarter's return.
		assert.equal(due('version_4', 'PIT_WITHHOLDING_DECLARATION', period('2026-07')), '2026-10-31');
		assert.equal(due('version_4', 'PIT_WITHHOLDING_DECLARATION', period('2026-12')), '2027-01-31');
		assert.equal(due('version_4', 'DEPENDANT_TAX_REGISTRATION', period('2026-12')), '2026-12-31');
		assert.equal(due('version_2', 'LABOUR_USE_DECLARATION', period('2026-02')), '2026-03-03');
		assert.equal(due('version_4', 'PIT_ANNUAL_FINALISATION', period('2026-12')), '2027-03-31');
		assert.equal(due('version_4', 'LABOUR_USE_REPORT', period('2026-05')), '2026-06-04');
		assert.equal(due('version_4', 'LABOUR_USE_REPORT', period('2026-11')), '2026-12-04');
		// Decree 39/2016 art.24(1): the half-year accident report before 5 July, the annual one before 10 January.
		assert.equal(due('version_4', 'OCCUPATIONAL_ACCIDENT_REPORT', period('2026-06')), '2026-07-04');
		assert.equal(due('version_1', 'OCCUPATIONAL_ACCIDENT_REPORT', period('2025-12')), '2026-01-09');
		assert.deepEqual(
			fixturePresent(duties('version_4').get('OCCUPATIONAL_ACCIDENT_REPORT')).months,
			['06', '12']
		);
		assert.deepEqual(fixturePresent(duties('version_4').get('OSH_ANNUAL_REPORT')).months, ['12']);
		assert.equal(
			due('version_4', 'SI_HI_UI_REGISTRATION', { hired_on: '2026-10-15' }),
			'2026-11-14'
		);
		assert.equal(
			due('version_4', 'PIT_TAX_REGISTRATION', { hired_on: '2026-10-15' }),
			'2027-01-31'
		);
		const exitOn = (exit_facts: Row) => ({
			exit_on: '2026-10-31',
			contract: { ...CONTRACT, exit_facts },
			holidays: []
		});
		// Labour Code art.48(1): 14 working days after 31 October 2026 (a Saturday) is Thursday 19 November.
		assert.equal(due('version_4', 'FINAL_SETTLEMENT', exitOn({})), '2026-11-19');
		assert.equal(
			due('version_4', 'FINAL_SETTLEMENT', exitOn({ final_settlement_extended: true })),
			'2026-11-30'
		);
		const quarterly = { ...COMPANY, facts: { pit_quarterly_filer: true } };
		assert.equal(
			due('version_3', 'PIT_WITHHOLDING_DECLARATION', period('2026-06', quarterly)),
			'2026-07-31'
		);
		const applies = (version: string, code: string, context: Row) => {
			const rules = duties(version).get(code);
			assert.ok(rules?.applies_when, code);
			return evaluateConfigured(fixtureString(rules.applies_when), fixtureContext(context));
		};
		assert.equal(
			due('version_3', 'PIT_WITHHOLDING_DECLARATION', period('2026-05', quarterly)),
			'2026-07-31'
		);
		assert.equal(due('version_3', 'PIT_WITHHOLDING_DECLARATION', period('2026-05')), '2026-06-20');
		const hire = (nationality: string) => ({
			hired_on: '2026-10-15',
			contract: CONTRACT,
			employee: { ...PROFILE, nationality },
			company: COMPANY
		});
		assert.equal(applies('version_4', 'FOREIGN_WORK_PERMIT', hire('VN')), false);
		assert.equal(applies('version_4', 'FOREIGN_WORK_PERMIT', hire('JAPANESE')), true);
		const leaving = (exit_ground: string) => ({
			exit_on: '2026-10-31',
			contract: { ...CONTRACT, exit_ground },
			employee: PROFILE,
			company: COMPANY
		});
		assert.equal(applies('version_4', 'RESTRUCTURING_LABOUR_PLAN', leaving('RETRENCHMENT')), true);
		assert.equal(applies('version_4', 'RESTRUCTURING_LABOUR_PLAN', leaving('RESIGNATION')), false);
		assert.equal(applies('version_4', 'TERMINATION_NOTICE', leaving('DEATH')), false);
		assert.equal(applies('version_4', 'TERMINATION_NOTICE', leaving('END_OF_CONTRACT')), true);
		assert.equal(applies('version_4', 'TERMINATION_NOTICE', leaving('IMPRISONMENT')), false);
		assert.equal(applies('version_4', 'TERMINATION_NOTICE', leaving('EMPLOYER_CLOSURE')), false);
		assert.equal(applies('version_4', 'OCCUPATIONAL_HEALTH_CHECK', period('2026-06')), false);
		assert.equal(
			applies(
				'version_4',
				'OCCUPATIONAL_HEALTH_CHECK',
				period('2026-06', { ...COMPANY, facts: { six_monthly_health_checks: true } })
			),
			true
		);
		assert.equal(
			applies(
				'version_4',
				'PDPL_IMPACT_ASSESSMENT',
				period('2026-12', { ...COMPANY, facts: { pdpl_exempt: true } })
			),
			false
		);
		assert.equal(
			applies(
				'version_4',
				'UNION_FEE_REMITTANCE',
				period('2026-10', { ...COMPANY, facts: { union_fee_suspended: true } })
			),
			false
		);
	});
	it('the canonical duty behaviours raise one obligation or task per duty, once', () => {
		for (const version of VERSIONS) {
			const row = settings(version);
			const behaviours = fixtureValue12(row.behaviours);
			const ruleRows = rows(version, 'rule_set');
			const duties = dutiesOf(ruleRows).map((item) => ({
				code: item.code,
				rules: fixtureValue2({ ...fixtureRecord(item.rules), trigger: triggerOf(item) })
			}));
			const of = (trigger: string) => duties.filter((duty) => duty.rules.trigger === trigger);
			const company = [COMPANY];
			const employee = [{ ...PROFILE, nationality: 'JAPANESE' }];
			const raise = (collection: string, event: string, data: Row, raised: Row[] = []) =>
				raiseDuties({
					behaviours,
					settings_id: row.id,
					rows: ruleRows,
					collection,
					event,
					row: { id: 'c1', company_id: 'co1', ...data },
					headcount: 12,
					reads: { company, employee, raised }
				});
			const run = (period: string, raised: Row[] = []) =>
				raise('payroll_run', 'created', { period }, raised);
			const december = run('2026-12');
			// COMPANY sets no fact, so every December or monthly duty applies (health checks: December only).
			const monthly = of('PAYROLL_RUN').filter((duty) => duty.rules.months == null);
			assert.equal(
				december.length,
				of('PAYROLL_RUN').filter(
					(duty) => duty.rules.months == null || fixtureValue16(duty.rules.months).includes('12')
				).length
			);
			assert.equal(run('2026-10').length, monthly.length);
			for (const data of december) assert.match(String(data.due_on), /^\d{4}-\d{2}-\d{2}$/);
			const [first] = december;
			assert.ok(first);
			assert.equal(run('2026-12', [{ duty_code: first.duty_code }]).length, december.length - 1);
			const range = { from: '2026-10-15', to: '2026-12-31' };
			const hire = raise('employment_contract', 'created', {
				effective_range: range,
				exit_facts: null
			});
			assert.equal(hire.length, of('HIRE').length);
			assert.ok(hire.every((data) => data.triggered_on === '2026-10-15'));
			const exits = raise('employment_contract', 'updated', {
				effective_range: range,
				exit_facts: {},
				exit_ground: 'RETRENCHMENT',
				facts: { contract_terms: [{ facts: { work_permit_valid_until: '2027-06-30' } }] }
			});
			assert.equal(exits.length, of('EXIT').length);
			assert.ok(exits.every((data) => data.triggered_on === '2026-12-31'));
			const opened = raise('entity', 'created', { id: 'co1', facts: {}, created_on: '2026-10-07' });
			assert.deepEqual(
				opened.map((data) => data.code ?? data.duty_code),
				['LABOUR_USE_DECLARATION']
			);
		}
	});
	it('validations: the regional minimum wage on contract terms, overtime limits and the 30% damage deduction', () => {
		const check = (version: string, code: string) => {
			const row = rows(version, 'rule_set').find(
				(item) => item.family === 'VALIDATIONS' && item.code === code
			);
			assert.ok(row, `${version} ${code}`);
			return { ...fixtureValue17(row.rules), citation: citationText(row.references) };
		};
		for (const version of VERSIONS)
			for (const code of [
				'MINIMUM_WAGE_FLOOR',
				'OVERTIME_MONTHLY_CAP',
				'OVERTIME_DAILY_CAP',
				'DAMAGE_DEDUCTION_CEILING'
			]) {
				const rules = check(version, code);
				assert.ok(
					['contract', 'payslip'].includes(rules.site) && rules.message && rules.citation,
					code
				);
			}
		const floor = check('version_4', 'MINIMUM_WAGE_FLOOR');
		assert.equal(floor.site, 'contract');
		assert.equal(floor.kind, 'refuse');
		const term = (base_salary: number, region: string, employment_type = 'PERMANENT') => {
			const terms = { base_salary, employment_type, work_classification: 'ORDINARY', facts: {} };
			return evaluateConfigured(
				fixtureString(floor.when),
				fixtureContext({
					terms,
					term: terms,
					company: { region, facts: {} },
					rules: payrollRules('version_4'),
					employment: { start_date: '2024-01-01' }
				})
			);
		};
		assert.equal(term(5000000, 'I'), true);
		assert.equal(term(5310000, 'I'), false);
		assert.equal(term(4000000, 'III'), true);
		// An unrecorded region is refused outright by REGION_REQUIRED; the floor itself reads Region I.
		assert.equal(term(5000000, ''), true);
		assert.equal(term(2000000, 'I', 'PART_TIME'), false);
		// Decree 293/2025 art.5(5): an incumbent whose worksite moved down keeps the prior region's 2025 floor.
		const reclassified = (start_date: string) =>
			evaluateConfigured(
				fixtureString(floor.when),
				fixtureContext({
					terms: {
						base_salary: 4800000,
						employment_type: 'PERMANENT',
						facts: { prior_floor_region: 'I', prior_floor_reclassified: true }
					},
					company: { region: 'II', facts: {} },
					rules: payrollRules('version_4'),
					employment: { start_date }
				})
			);
		assert.equal(reclassified('2024-01-01'), true);
		assert.equal(reclassified('2026-02-01'), false);
		assert.equal(
			evaluateConfigured(
				fixtureString(check('version_1', 'MINIMUM_WAGE_FLOOR').when),
				fixtureContext({
					terms: { base_salary: 5000000, employment_type: 'PERMANENT', facts: {} },
					company: { region: 'I', facts: {} },
					rules: payrollRules('version_1'),
					employment: { start_date: '2024-01-01' }
				})
			),
			false
		);
		const day = (overtime_hours: number, extra: Row = {}) => ({
			date: '2026-10-05',
			day_type: 'WORK',
			holiday_kind: '',
			scheduled_hours: 8,
			worked_hours: 8 + overtime_hours,
			overtime_hours,
			intervals: [],
			...extra
		});
		const slip = (days: Row[], facts: Row = {}, payslip: Row = {}) => ({
			...salaryContext,
			terms: { ...salaryContext.terms, facts },
			work: { ...salaryContext.work, holidays: [], days },
			payslip: { gross: 30000000, statutory_employee: 3000000, lines: {}, ...payslip }
		});
		const trips = (code: string, context: Row) =>
			evaluateConfigured(fixtureString(check('version_4', code).when), fixtureContext(context));
		assert.equal(
			trips('OVERTIME_MONTHLY_CAP', slip(Array.from({ length: 10 }, () => day(4)))),
			false
		);
		assert.equal(
			trips(
				'OVERTIME_MONTHLY_CAP',
				slip([
					...Array.from({ length: 10 }, () => day(4)),
					day(1, { day_type: 'REST', scheduled_hours: 0, worked_hours: 1 })
				])
			),
			true
		);
		assert.equal(trips('OVERTIME_DAILY_CAP', slip([day(4)])), false);
		assert.equal(trips('OVERTIME_DAILY_CAP', slip([day(5)])), true);
		assert.equal(
			trips(
				'OVERTIME_DAILY_CAP',
				slip([day(4, { scheduled_hours: 9 })], { normal_hours_arrangement: 'WEEKLY' })
			),
			true
		);
		assert.equal(check('version_4', 'DAMAGE_DEDUCTION_CEILING').kind, 'hold');
		assert.equal(
			trips(
				'DAMAGE_DEDUCTION_CEILING',
				slip([], {}, { lines: { PROPERTY_DAMAGE_COMPENSATION: -8100000 } })
			),
			false
		);
		assert.equal(
			trips(
				'DAMAGE_DEDUCTION_CEILING',
				slip([], {}, { lines: { PROPERTY_DAMAGE_COMPENSATION: -8200000 } })
			),
			true
		);
	});
	it('tasks read the headcount and the leave class; a half-month pays half the month', () => {
		for (const version of VERSIONS) {
			const row = settings(version);
			const ruleRows = rows(version, 'rule_set');
			const raise = (collection: string, event: string, data: Row, headcount: number) =>
				raiseDuties({
					behaviours: fixtureValue12(row.behaviours),
					settings_id: row.id,
					rows: ruleRows,
					collection,
					event,
					row: { id: 'r1', company_id: 'co1', ...data },
					headcount,
					reads: { company: [COMPANY], employee: [PROFILE], raised: [] }
				}).map((data) => String(data.code ?? data.duty_code));
			assert.ok(
				raise('payroll_run', 'created', { period: '2026-12' }, 10).includes('INTERNAL_LABOUR_RULES')
			);
			assert.ok(
				!raise('payroll_run', 'created', { period: '2026-12' }, 9).includes('INTERNAL_LABOUR_RULES')
			);
			const leave = (catalog_code: string) =>
				raise(
					'leave_catalog_entry',
					'created',
					{
						catalog_code,
						employment_id: 'k1',
						from: '2026-10-05',
						to: '2026-10-09',
						occurred_on: '2026-10-05'
					},
					3
				);
			assert.deepEqual(leave('SICK_LEAVE'), ['SI_BENEFIT_CLAIMS']);
			assert.deepEqual(leave('ANNUAL_LEAVE'), []);
			const claim = fixturePresent(
				dutiesOf(ruleRows).find((duty) => duty.code === 'SI_BENEFIT_CLAIMS')
			);
			assert.equal(
				evaluateConfigured(
					fixtureString(String(fixtureValue2(claim.rules).due)),
					fixtureContext({
						row: { to: '2026-10-09' },
						today: '2026-10-05',
						holidays: []
					})
				),
				'2026-10-20'
			);
		}
		const half = {
			...salaryContext,
			period: {
				...salaryContext.period,
				key: '2026-10-1',
				from: '2026-10-01',
				to: '2026-10-15',
				days: 15,
				paid_days: 15,
				working_days: 13,
				month_working_days: 26,
				month_holiday_work_days: 0,
				previous_month_working_days: 26,
				previous_month_holiday_work_days: 0,
				covered_working_days: 13,
				part: 1,
				parts: 2
			}
		};
		const amount = (code: string) => {
			const line = fixturePresent(
				rows('version_4', 'work_catalog').find((item) => item.code === code)
			);
			return Math.round(
				Number(evaluateConfigured(fixtureString(String(line.quantity)), fixtureContext(half))) *
					Number(evaluateConfigured(fixtureString(String(line.rate)), fixtureContext(half)))
			);
		};
		assert.equal(amount('BASIC'), 13000000);
		assert.equal(amount('NO_PAY_LEAVE'), 2000000); // two days of 26,000,000 ÷ 26 working days
	});
	it('14 unpaid working days, the annual overtime cap, per-birth paternity and the customer-input facts', () => {
		const citizen = { residency_status: 'CITIZEN' };
		for (const version of VERSIONS) {
			for (const code of ['SI', 'UI', 'UNION_FEE'])
				assert.deepEqual(
					charge(version, code, 10000000, citizen, { unpaid: 14 }),
					{ employee: 0, employer: 0 },
					`${version} ${code}`
				);
			assert.notEqual(charge(version, 'SI', 10000000, citizen, { unpaid: 13 }).employee, 0);
			// Continued SI by agreement keeps SI; UI stays exempt (Law 74/2025 art.33(4)).
			assert.notEqual(
				charge(version, 'SI', 10000000, citizen, {
					unpaid: 14,
					elections: { unpaid_leave_continuation: true }
				}).employee,
				0
			);
			assert.equal(
				charge(version, 'UI', 10000000, citizen, {
					unpaid: 14,
					elections: { unpaid_leave_continuation: true }
				}).employee,
				0
			);
			// HI stays charged in an unpaid month: Law 41/2024 art.33(5) waives SI only, and neither the HI Law (as amended by
			// Law 51/2024) nor Decree 188/2025 arts.6–8 waives HI; Decision 366/QĐ-BHXH Điều 4(2)(b) follows the statutes. The
			// D02-LT unpaid reduction says so in column 19 ("BHYT tiếp tục đóng"), so payslip and list agree.
			assert.notEqual(charge(version, 'HI', 10000000, citizen, { unpaid: 20 }).employee, 0);
			// The State-sector dues base: 0.5% of take-home pay after SI, HI, UI and PIT.
			const member = { elections: { union_member: true } };
			const soe = charge(version, 'UNION_DUES', 10000000, citizen, {
				...member,
				company: { facts: { state_owned_enterprise: true } }
			});
			assert.equal(soe.employee, Math.round((10000000 - 1050000) * 0.005));
		}
		const annual = fixtureValue2(
			fixturePresent(
				rows('version_4', 'rule_set').find((row) => row.code === 'OVERTIME_ANNUAL_CAP')
			).rules
		);
		const year = (overtime: number, rest: number, facts: Row = {}) =>
			evaluateConfigured(
				fixtureString(String(annual.when)),
				fixtureContext({
					company: { region: 'I', facts },
					hours: {
						year: {
							overtime_hours: overtime + rest,
							day_type: { WORK: { overtime_hours: overtime }, REST: { worked_hours: rest } },
							holiday_kind: {}
						}
					}
				})
			);
		assert.equal(year(190, 10), false);
		assert.equal(year(190, 11), true);
		assert.equal(year(250, 0, { overtime_300h_sector: true }), false);
		// A holiday on a working shift: its overtime is already in the year's overtime, only its planned hours add.
		const holiday = (worked_hours: number) =>
			evaluateConfigured(
				fixtureString(String(annual.when)),
				fixtureContext({
					company: { region: 'I', facts: {} },
					hours: {
						year: {
							overtime_hours: 190,
							day_type: { WORK: { overtime_hours: 190 } },
							holiday_kind: { PUBLIC_HOLIDAY: { worked_hours, overtime_hours: 4 } }
						}
					}
				})
			);
		assert.equal(holiday(14), false);
		assert.equal(holiday(15), true);
		assert.equal(
			evaluateConfigured(
				fixtureString(String(annual.when)),
				fixtureContext({
					company: { facts: {} },
					hours: {
						year: { worked_hours: 0, overtime_hours: 0, paid_overtime_hours: 0, incentive_hours: 0 }
					}
				})
			),
			false
		);
		const paternity = (version: string, facts: Row) =>
			entitlementDays(
				fixtureEntitlement(
					fixtureValue11(
						fixturePresent(
							rows(version, 'leave_catalog').find((row) => row.code === 'PATERNITY_LEAVE')
						).entitlement
					)
				),
				12,
				fixtureContext({ ...LEAVE_SUBJECT, entry: { facts } })
			);
		assert.equal(paternity('version_4', {}), 5);
		assert.equal(paternity('version_4', { caesarean: true }), 7);
		assert.equal(paternity('version_4', { premature_under_32_weeks: true }), 7);
		assert.equal(paternity('version_4', { children_born: 2 }), 10);
		assert.equal(paternity('version_4', { children_born: 3 }), 13);
		assert.equal(paternity('version_4', { children_born: 2, caesarean: true }), 14);
		assert.equal(paternity('version_4', { second_child: true }), 10);
		assert.equal(paternity('version_3', { second_child: true }), 5);
		const remit = fixtureValue2(
			fixturePresent(
				rows('version_4', 'rule_set').find((row) => row.code === 'UNION_FEE_REMITTANCE')
			).rules
		);
		const due = (facts: Row) =>
			evaluateConfigured(
				fixtureString(String(remit.due)),
				fixtureContext({
					period: { key: '2026-07', from: '2026-07-01', to: '2026-07-31' },
					company: { facts }
				})
			);
		assert.equal(due({}), '2026-08-31');
		assert.equal(due({ union_fee_quarterly: true }), '2026-10-31');
	});
	it('coverage: pensioners, domestic workers, short and part-time contracts, foreign employees, probation and the disabled-hire UI relief', () => {
		const citizen = { residency_status: 'CITIZEN' };
		const pay = (version: string, code: string, subject: Subject = {}, wage = 10000000) =>
			charge(version, code, wage, citizen, subject);
		const none = { employee: 0, employer: 0 };
		for (const version of VERSIONS) {
			const pensioner = { terms: { facts: { receiving_pension: true } } };
			for (const code of ['SI', 'HI', 'UI', 'UNION_FEE'])
				assert.deepEqual(pay(version, code, pensioner), none, `${version} pensioner ${code}`);
			const domestic = { terms: { employment_type: 'DOMESTIC' } };
			assert.deepEqual(pay(version, 'SI', domestic), none);
			assert.deepEqual(pay(version, 'UI', domestic), none);
			assert.notEqual(pay(version, 'HI', domestic).employee, 0);
			const shortTerm = {
				employment: { start_date: '2026-10-01', exit_date: '2026-10-20' },
				terms: { employment_type: 'CONTRACT' }
			};
			// PERMANENT is indefinite (Labour Code art.20(1)(a)): a leaver after 20 days with no term facts stays insured.
			assert.equal(
				pay(version, 'SI', { employment: shortTerm.employment }).employee,
				800000,
				`${version} PERMANENT under one month SI`
			);
			for (const code of ['SI', 'HI', 'UI'])
				assert.deepEqual(pay(version, code, shortTerm), none, `${version} under one month ${code}`);
			const partLow = { terms: { employment_type: 'PART_TIME', monthly_wage: 2000000 } };
			assert.deepEqual(pay(version, 'SI', partLow, 2000000), none);
			assert.deepEqual(pay(version, 'UI', partLow, 2000000), none);
			// A part-timer at or above the lowest SI base is charged on the month's pay.
			assert.equal(
				pay(
					version,
					'SI',
					{
						terms: {
							employment_type: 'PART_TIME',
							base_salary: 20000000,
							monthly_wage: 6000000
						}
					},
					6000000
				).employee,
				480000
			);
			const foreign = (employment: Row, extra: Subject = {}) => ({
				employee: { nationality: 'JAPANESE', gender: 'MALE', date_of_birth: '1985-01-01' },
				employment,
				...extra
			});
			// A fixed-term (CONTRACT) foreigner with no recorded term who leaves in month 6 is outside; a PERMANENT one is
			// on an indefinite contract and keeps SI, HI and the union fee (Law 41/2024 art.2(2)).
			const sixMonths = { start_date: '2026-01-01', exit_date: '2026-06-30' };
			assert.deepEqual(
				pay(version, 'SI', foreign(sixMonths, { terms: { employment_type: 'CONTRACT' } })),
				none
			);
			assert.deepEqual(pay(version, 'SI', foreign(sixMonths)), {
				employee: 800000,
				employer: 1750000
			});
			assert.notEqual(pay(version, 'HI', foreign(sixMonths)).employee, 0);
			assert.notEqual(pay(version, 'UNION_FEE', foreign(sixMonths)).employer, 0);
			// Decree 135/2020 art.4 with Annex I: the retirement age is the age of the year it is reached, by birth month —
			// a man born 7/1964 retires at 61y3m in 10/2025: signing on 15 October 2025 he is at it (outside SI), on
			// 15 September 2025 he is not; a woman born 1/1970 reaches 57y4m in 5/2027.
			const older = (date_of_birth: string, gender: string, start_date: string) => ({
				employee: { nationality: 'JAPANESE', gender, date_of_birth },
				employment: { start_date, exit_date: '2028-12-31' },
				terms: { facts: { contract_type: 'INDEFINITE' } }
			});
			assert.deepEqual(pay(version, 'SI', older('1964-07-01', 'MALE', '2025-10-15')), none);
			assert.equal(pay(version, 'SI', older('1964-07-01', 'MALE', '2025-09-15')).employee, 800000);
			assert.deepEqual(pay(version, 'SI', older('1970-01-01', 'FEMALE', '2027-05-15')), none);
			assert.equal(
				pay(version, 'SI', older('1970-01-01', 'FEMALE', '2027-04-15')).employee,
				800000
			);
			// Law 41/2024 art.2(2): the contract's term of 12 months or more, not the months served — a foreigner on an
			// indefinite or 24-month contract who leaves in month 6 is insured; a 6-month contract is not.
			for (const facts of [
				{ contract_type: 'INDEFINITE' },
				{ contract_type: 'FIXED', agreed_term_months: 24 }
			])
				assert.equal(
					pay(
						version,
						'SI',
						foreign({ start_date: '2026-01-01', exit_date: '2026-06-30' }, { terms: { facts } })
					).employee,
					800000,
					version
				);
			assert.deepEqual(
				pay(
					version,
					'SI',
					foreign(
						{ start_date: '2026-01-01', exit_date: '' },
						{ terms: { facts: { contract_type: 'FIXED', agreed_term_months: 6 } } }
					)
				),
				none
			);
			assert.equal(
				pay(version, 'SI', foreign({ start_date: '2026-01-01', exit_date: '2027-12-31' })).employee,
				800000
			);
			assert.equal(
				pay(version, 'SI', foreign({ start_date: '2026-01-01', exit_date: '' })).employee,
				800000
			);
			assert.deepEqual(
				pay(
					version,
					'SI',
					foreign(
						{ start_date: '2026-01-01', exit_date: '' },
						{ terms: { facts: { pass_type: 'INTRA_COMPANY_TRANSFER' } } }
					)
				),
				none
			);
			assert.deepEqual(
				pay(
					version,
					'SI',
					foreign(
						{ start_date: '2026-01-01', exit_date: '' },
						{ siElections: { si_treaty_exempt: true } }
					)
				),
				none
			);
			// Decree 135/2020 art.4: a man signing in 2026 at 66 is past the 61 years 6 months retirement age.
			assert.deepEqual(
				pay(version, 'SI', {
					employee: { nationality: 'JAPANESE', gender: 'MALE', date_of_birth: '1960-01-01' },
					employment: { start_date: '2026-01-01', exit_date: '' }
				}),
				none
			);
			assert.deepEqual(
				pay(version, 'UI', foreign({ start_date: '2026-01-01', exit_date: '' })),
				none
			);
			// Vietnamese nationality, not tax residence, decides UI.
			assert.equal(
				charge(version, 'UI', 10000000, { residency_status: 'NON_RESIDENT' }).employee,
				100000
			);
			assert.deepEqual(pay(version, 'UI', { terms: { employment_type: 'PROBATION' } }), none);
			assert.notEqual(pay(version, 'SI', { terms: { employment_type: 'PROBATION' } }).employee, 0);
			assert.deepEqual(pay(version, 'UI', { elections: { pension_qualified: true } }), none);
			// Enterprise managers and the like are compulsory participants (Law 41/2024 art.2(1)(i)).
			assert.equal(
				pay(version, 'SI', { terms: { work_classification: 'MANAGERIAL' } }).employee,
				800000
			);
		}
		const hire = {
			terms: { facts: { disabled: true } },
			employment: { start_date: '2026-03-01', exit_date: '', service_months: 7 }
		};
		assert.deepEqual(
			pay('version_4', 'UI', { ...hire, elections: { disabled_new_hire_relief: true } }),
			{ employee: 100000, employer: 0 }
		);
		assert.deepEqual(pay('version_4', 'UI', hire), { employee: 100000, employer: 100000 });
		assert.deepEqual(
			pay('version_1', 'UI', { ...hire, elections: { disabled_new_hire_relief: true } }),
			{ employee: 100000, employer: 100000 }
		);
		// A member outside compulsory SI pays the minimum dues: 0.5% of the reference level.
		assert.equal(
			pay('version_4', 'UNION_DUES', {
				elections: { union_member: true },
				terms: { facts: { receiving_pension: true } }
			}).employee,
			12650
		);
	});
	it('the SI base is the contractual wage; 14 days off, the first-month sickness rule, maternity and fund-paid HI months', () => {
		const citizen = { residency_status: 'CITIZEN' };
		const si = (subject: Subject, wage = 5000000) =>
			charge('version_4', 'SI', wage, citizen, subject).employee;
		const contract = {
			terms: {
				base_salary: 20000000,
				monthly_wage: 22500000,
				allowances: [
					{ code: 'FIXED_ALLOWANCE', amount: 2000000 },
					{ code: 'MEAL_ALLOWANCE', amount: 500000 }
				]
			}
		};
		// A month paid 5,000,000 after unpaid days is still assessed on 20,000,000 + the fixed 2,000,000.
		assert.equal(si(contract), 1760000);
		assert.equal(si({ ...contract, unpaid: 10 }), 1760000);
		// Phone, travel and uniform support is a welfare support outside the insurance salary (Circular 10/2020 art.3(5)(c)).
		const supported = {
			terms: {
				...contract.terms,
				allowances: [
					...contract.terms.allowances,
					{ code: 'WORK_EXPENSE_ALLOWANCE', amount: 1000000 }
				]
			}
		};
		for (const version of VERSIONS)
			for (const code of ['SI', 'HI', 'UI', 'UNION_FEE'])
				assert.deepEqual(
					charge(version, code, 5000000, citizen, supported),
					charge(version, code, 5000000, citizen, contract),
					`${version} ${code}`
				);
		assert.equal(si({ ...contract, unpaid: 14 }), 0);
		assert.equal(si({ ...contract, period: { working_days: 22, covered_working_days: 8 } }), 0);
		assert.equal(
			si({ ...contract, period: { working_days: 22, covered_working_days: 9 } }),
			1760000
		);
		const sick = (to: string) => [
			{ code: 'SICK_LEAVE', is_npl: true, pay_fraction: 1, period_working_days: 15, to }
		];
		// Fifteen sick days in the hire month still contribute (art.33(6)); in a later month they waive it.
		assert.equal(
			si({ ...contract, leave: sick('2026-10-30'), employment: { start_date: '2026-10-01' } }),
			1760000
		);
		assert.equal(si({ ...contract, leave: sick('2026-11-20') }), 0);
		assert.equal(si({ ...contract, leave: sick('2026-10-20') }), 1760000);
		const maternity = [
			{
				code: 'MATERNITY_LEAVE',
				is_npl: true,
				pay_fraction: 1,
				period_working_days: 22,
				to: '2027-03-31'
			}
		];
		assert.equal(si({ ...contract, leave: maternity }), 0);
		assert.deepEqual(
			charge('version_4', 'UNION_FEE', 5000000, citizen, { ...contract, leave: maternity }),
			{ employee: 0, employer: 0 }
		);
		assert.deepEqual(
			charge('version_4', 'HI', 5000000, citizen, { ...contract, leave: maternity }),
			{ employee: 0, employer: 0 }
		);
		assert.deepEqual(
			charge('version_4', 'HI', 5000000, citizen, { ...contract, leave: sick('2026-11-20') }),
			{ employee: 0, employer: 0 }
		);
		const shortSick = [
			{
				code: 'SICK_LEAVE',
				is_npl: true,
				pay_fraction: 1,
				period_working_days: 10,
				to: '2026-11-20'
			}
		];
		assert.equal(
			charge('version_4', 'HI', 5000000, citizen, { ...contract, leave: shortSick }).employee,
			330000
		);
		// Every scheme on the contract is assessed even when the month paid no wage.
		for (const code of ['SI', 'HI', 'UI', 'UNION_FEE', 'UNION_DUES'])
			assert.equal(
				fixtureBoolean(fixtureRecord(scheme('version_4', code).configuration).assess_without_wage),
				true,
				code
			);
	});
	it('PIT: meal and housing caps, employer pension contributions, short contracts in 2025-26, the December finalisation and net-of-tax gross-up', () => {
		const citizen = { residency_status: 'CITIZEN' };
		const pit = (version: string, wage: number, subject: Subject = {}) =>
			charge(version, 'PIT', wage, citizen, subject);
		const v4 = (wage: number) => pit('version_4', wage).employee;
		// Meal above 1,200,000 only (2026-07 on); 730,000 before.
		assert.equal(
			pit('version_4', 30000000, { parts: { meal: 2000000 } }).employee,
			v4(30000000) + 80000
		);
		assert.equal(
			pit('version_2', 30000000, { parts: { meal: 1000000 } }).employee,
			pit('version_2', 30000000).employee + 27000
		);
		// Housing at most 15% of the other taxable income: 15% of 20,000,000 = 3,000,000 of 10,000,000.
		assert.equal(
			pit('version_4', 20000000, { parts: { housing: 10000000 } }).employee,
			pit('version_4', 23000000, { terms: { base_salary: 20000000, monthly_wage: 20000000 } })
				.employee
		);
		// An employer pension contribution is income and, with the employee's, deducted to the cap.
		assert.equal(
			pit('version_4', 30000000, { parts: { pension: 2000000 } }).employee,
			v4(30000000)
		);
		assert.equal(
			pit('version_4', 30000000, { parts: { pension: 4000000 } }).employee,
			v4(30000000) + 100000
		);
		assert.equal(
			pit('version_2', 30000000, { parts: { pension: 2000000 } }).employee,
			pit('version_2', 30000000).employee + 100000
		);
		// Circular 111/2013 art.25(1)(i): 10% from 2,000,000 a payment without a contract or under three months.
		const service = { terms: { employment_type: 'SERVICE' } };
		assert.equal(pit('version_2', 3000000, service).employee, 300000);
		assert.equal(pit('version_2', 1900000, service).employee, 0);
		assert.equal(
			pit('version_1', 10000000, {
				employment: { start_date: '2025-12-01', exit_date: '2026-01-31' },
				terms: { employment_type: 'CONTRACT' }
			}).employee,
			1000000
		);
		assert.equal(pit('version_4', 4000000, service).employee, 0);
		assert.equal(pit('version_4', 6000000, service).employee, 600000);
		// December finalisation: annual table on the year's income, less the tax already withheld.
		const december = {
			period: { key: '2026-12', from: '2026-12-01', to: '2026-12-31', month: 12 },
			elections: { finalisation_authorised: true }
		};
		const monthly = v4(30000000);
		// Eleven months of 30,000,000 already assessed and taxed at the monthly table: the year settles to twelve months' tax.
		const yearIns = 11 * (2400000 + 450000 + 300000);
		assert.equal(
			pit('version_4', 30000000, {
				...december,
				year: { ordinary: 330000000 },
				chargedYear: {
					PIT: { employee: 11 * monthly },
					SI: { employee: 11 * 2400000 },
					HI: { employee: 11 * 450000 },
					UI: { employee: 11 * 300000 }
				}
			}).employee,
			Math.round(ladderYear(12 * 30000000 - 12 * 3150000 - 12 * 15500000) - 11 * monthly)
		);
		assert.ok(yearIns > 0);
		// Under-withheld earlier in the year: December collects the difference.
		assert.ok(
			pit('version_4', 30000000, {
				...december,
				year: { ordinary: 330000000 },
				chargedYear: { PIT: { employee: 0 } }
			}).employee > monthly
		);
		// Decree 253/2026 art.46(2)(a): the year's pension deduction sums each month, capped at that month's limit —
		// 1,000,000 a month all year is 12,000,000. Circular 111/2013 art.9(1)(c): a dependant
		// registered from July counts 6 months, not 12.
		const months = Array.from({ length: 11 }, (_, i) => ({
			month: `2026-${String(i + 1).padStart(2, '0')}`,
			statutory: { PIT: { employee: 0, employer: 0, base: 30000000, parts: {} } }
		}));
		const finalise = (elections: Row, earned: Row = { months }) =>
			pit('version_4', 30000000, {
				...december,
				elections: { ...december.elections, ...elections },
				year: { ordinary: 330000000 },
				chargedYear: {
					PIT: { employee: 0 },
					SI: { employee: 11 * 2400000 },
					HI: { employee: 11 * 450000 },
					UI: { employee: 11 * 300000 }
				},
				earned
			}).employee;
		const insured = 12 * 3150000;
		assert.equal(
			finalise({ voluntary_pension_contribution: 1000000 }),
			Math.round(ladderYear(360000000 - insured - 12000000 - 186000000))
		);
		// Decree 253/2026 art.69(1)(a): the salary rules apply from tax period 2026, so the finalisation caps every 2026
		// month at 3,000,000 — January to June included (art.70(2): the old-rule months settle here): 36,000,000.
		assert.equal(
			finalise({ voluntary_pension_contribution: 3000000 }),
			Math.round(ladderYear(360000000 - insured - 36000000 - 186000000))
		);
		assert.equal(
			finalise({ dependants: 1, dependants_registered_from: ['2026-07'] }),
			Math.round(ladderYear(360000000 - insured - 186000000 - 6 * 6200000))
		);
		assert.equal(
			finalise({ dependants: 1 }),
			Math.round(ladderYear(360000000 - insured - 186000000 - 74400000))
		);
		// Net-of-tax: the employer bears the tax on the grossed-up income; the employee pays nothing.
		const net = charge('version_4', 'PIT', 40000000, citizen, {
			terms: { facts: { net_of_tax: true } }
		});
		assert.equal(net.employee, 0);
		const taxableNet = 40000000 - 4200000 - 15500000;
		const grossed = taxableNet + net.employer;
		assert.equal(Math.round(grossed - ladderMonth(grossed)), taxableNet);
	});
	it('work: the 2025 taxable overtime part, the 2026 non-resident lines, suspension pay and part-month BASIC', () => {
		const at = (version: string, code: string, context: Row) => {
			const line = rows(version, 'work_catalog').find((item) => item.code === code);
			assert.ok(line, `${version} ${code}`);
			if (
				evaluateConfigured(fixtureString(String(line.eligibility)), fixtureContext(context)) !==
				true
			)
				return 0;
			return Math.round(
				Number(evaluateConfigured(fixtureString(String(line.quantity)), fixtureContext(context))) *
					Number(evaluateConfigured(fixtureString(String(line.rate)), fixtureContext(context)))
			);
		};
		const day = (extra: Row) => ({
			date: '2026-03-11',
			day_type: 'WORK',
			holiday_kind: '',
			scheduled_hours: 8,
			worked_hours: 12,
			worked: true,
			overtime_hours: 4,
			intervals: [],
			...extra
		});
		const context = {
			...salaryContext,
			work: { ...salaryContext.work, holidays: [], days: [day({})] }
		};
		const line = fixturePresent(
			rows('version_1', 'work_catalog').find((item) => item.code === 'OVERTIME_TAXABLE_PART')
		);
		assert.equal(line.destination, 'EMPLOYER');
		assert.equal(at('version_1', 'OVERTIME_TAXABLE_PART', context), 4 * 125000);
		const nonResident = {
			...context,
			terms: { ...context.terms, residency_status: 'NON_RESIDENT' }
		};
		assert.equal(at('version_2', 'OVERTIME_TAXABLE_PART_NONRESIDENT', nonResident), 4 * 125000);
		assert.equal(at('version_2', 'OVERTIME_TAXABLE_PART_NONRESIDENT', context), 0);
		for (const worked_hours of [0, 8, 20]) {
			const rest = {
				...context,
				work: { ...context.work, days: [day({ day_type: 'REST', worked_hours })] }
			};
			assert.equal(at('version_1', 'OVERTIME_TAXABLE_PART', rest), 4 * 125000);
			for (const version of ['version_2', 'version_3']) {
				const nonResidentRest = {
					...rest,
					terms: { ...rest.terms, residency_status: 'NON_RESIDENT' }
				};
				assert.equal(at(version, 'OVERTIME_TAXABLE_PART_NONRESIDENT', nonResidentRest), 4 * 125000);
				assert.equal(
					at(version, 'OVERTIME_TAXABLE_PART_NONRESIDENT', {
						...nonResidentRest,
						work: {
							...nonResidentRest.work,
							days: [day({ day_type: 'REST', worked_hours, overtime_hours: 0 })]
						}
					}),
					0
				);
			}
		}
		assert.equal(at('version_3', 'ENCASHMENT_TAXABLE_NONRESIDENT', nonResident), 3000000);
		assert.equal(at('version_3', 'ENCASHMENT_TAXABLE_NONRESIDENT', context), 0);
		const suspended = {
			...salaryContext,
			leave: {
				rows: [
					{ code: 'SUSPENSION_PENDING_DISCIPLINE', activity: 'TIME_OFF', days: 4, is_npl: false }
				]
			}
		};
		assert.equal(at('version_4', 'SUSPENSION_ADVANCE', suspended), 2000000);
		const hired = {
			...salaryContext,
			period: {
				...salaryContext.period,
				working_days: 22,
				month_working_days: 22,
				month_holiday_work_days: 0,
				previous_month_working_days: 22,
				previous_month_holiday_work_days: 0,
				covered_working_days: 12
			}
		};
		assert.equal(at('version_4', 'BASIC', hired), Math.round((26000000 * 12) / 22));
		const unplanned = {
			...salaryContext,
			period: {
				...salaryContext.period,
				working_days: 0,
				month_working_days: 0,
				month_holiday_work_days: 0,
				previous_month_working_days: 0,
				previous_month_holiday_work_days: 0,
				covered_working_days: 0,
				paid_days: 15,
				days: 30
			}
		};
		assert.equal(at('version_4', 'BASIC', unplanned), 13000000);
		// Leave class flags: paid stoppage and foreign national days are not deducted; worker-fault stoppage and unpaid leave are.
		const npl = (code: string) =>
			fixturePresent(rows('version_4', 'leave_catalog').find((row) => row.code === code)).is_npl;
		assert.deepEqual(
			[
				'STOPPAGE_EMPLOYER_FAULT',
				'STOPPAGE_WORKER_FAULT',
				'FOREIGN_NATIONAL_LEAVE',
				'UNPAID_LEAVE',
				'OCCUPATIONAL_ACCIDENT_LEAVE',
				'CHILD_SICK_CARE'
			].map(npl),
			[false, true, false, true, false, true]
		);
		assert.equal(
			at('version_4', 'NO_PAY_LEAVE', {
				...salaryContext,
				leave: { rows: [{ code: 'UNPAID_LEAVE', activity: 'TIME_OFF', days: 3, is_npl: true }] }
			}),
			3000000
		);
	});
	it('ad hoc: severance and job-loss eligibility by exit ground, unlawful termination, occupational accidents, bonus, deductions and the insurance equivalent', () => {
		const admits = (code: string, employment: Row) => {
			const row = fixturePresent(
				rows('version_4', 'adhoc_catalog').find((item) => item.code === code)
			);
			return evaluateConfigured(
				fixtureString(String(row.eligibility)),
				fixtureContext({
					...payslipContext,
					employment: { ...payslipContext.employment, service_months: 40, ...employment }
				})
			);
		};
		// Art.46(1) with art.34(4) (imprisonment, a court ban) and art.34(7) (the employer's closure).
		for (const ground of [
			'END_OF_CONTRACT',
			'MUTUAL',
			'DEATH',
			'RESIGNATION',
			'UNILATERAL',
			'EMPLOYER_CLOSURE',
			'IMPRISONMENT'
		])
			assert.equal(
				admits('SEVERANCE_ALLOWANCE', { exit_ground: ground, exit_facts: {} }),
				true,
				ground
			);
		for (const ground of ['DISMISSAL', 'REDUNDANCY', 'RETRENCHMENT', 'RETIREMENT'])
			assert.equal(
				admits('SEVERANCE_ALLOWANCE', { exit_ground: ground, exit_facts: {} }),
				false,
				ground
			);
		assert.equal(
			admits('SEVERANCE_ALLOWANCE', {
				exit_ground: 'RESIGNATION',
				exit_facts: { pension_eligible: true }
			}),
			false
		);
		assert.equal(
			admits('SEVERANCE_ALLOWANCE', {
				exit_ground: 'UNILATERAL',
				exit_facts: { absent_five_days: true }
			}),
			false
		);
		assert.equal(
			admits('SEVERANCE_ALLOWANCE', {
				exit_ground: 'RESIGNATION',
				exit_facts: { unlawful_resignation: true }
			}),
			false
		);
		assert.equal(
			admits('SEVERANCE_ALLOWANCE', {
				exit_ground: 'RESIGNATION',
				exit_facts: {},
				service_months: 11
			}),
			false
		);
		assert.equal(admits('JOB_LOSS_ALLOWANCE', { exit_ground: 'REDUNDANCY', exit_facts: {} }), true);
		assert.equal(
			admits('JOB_LOSS_ALLOWANCE', { exit_ground: 'RESIGNATION', exit_facts: {} }),
			false
		);
		const priced = (code: string, facts: Row, amount = 20000000) => {
			const row = fixturePresent(
				rows('version_4', 'adhoc_catalog').find((item) => item.code === code)
			);
			const [band] = fixtureValue13(row.bands);
			return Number(
				evaluateConfigured(
					fixtureString(fixturePresent(band).amount),
					fixtureContext({ ...payslipContext, entry: { ...entry(facts), amount } })
				)
			);
		};
		const day = 26000000 / 26;
		assert.equal(
			priced('UNLAWFUL_TERMINATION_COMPENSATION', {
				days_not_worked: 10,
				notice_shortfall_days: 5
			}),
			2 * 26000000 + 15 * day
		);
		assert.equal(
			priced('EMPLOYEE_UNLAWFUL_TERMINATION', { notice_shortfall_days: 6 }),
			13000000 + 6 * day
		);
		assert.equal(priced('TRAINING_COST_REFUND', {}, 7000000), 7000000);
		assert.equal(
			priced('OCCUPATIONAL_ACCIDENT_COMPENSATION', { capacity_loss_percent: 8 }),
			1.5 * 26000000
		);
		assert.equal(
			priced('OCCUPATIONAL_ACCIDENT_COMPENSATION', { capacity_loss_percent: 20 }),
			5.5 * 26000000
		);
		assert.equal(
			priced('OCCUPATIONAL_ACCIDENT_COMPENSATION', { capacity_loss_percent: 85 }),
			30 * 26000000
		);
		assert.equal(
			priced('OCCUPATIONAL_ACCIDENT_COMPENSATION', {
				capacity_loss_percent: 85,
				worker_at_fault: true
			}),
			12 * 26000000
		);
		// Late wages: 10,000,000 twenty days late at a 4.5% deposit rate, rounded up.
		assert.equal(
			priced('LATE_WAGE_COMPENSATION', { late_days: 20, deposit_rate_percent: 4.5 }, 10000000),
			24658
		);
		const counts = (code: string) =>
			fixturePresent(rows('version_4', 'adhoc_catalog').find((row) => row.code === code))
				.counts_toward;
		assert.deepEqual(counts('BONUS'), ['PIT']);
		for (const code of [
			'SEVERANCE_ALLOWANCE',
			'JOB_LOSS_ALLOWANCE',
			'UNLAWFUL_TERMINATION_COMPENSATION',
			'OCCUPATIONAL_ACCIDENT_COMPENSATION',
			'OCCUPATIONAL_ACCIDENT_MEDICAL',
			'NON_ACCUMULATING_INSURANCE',
			'TRAINING_SUPPORT'
		])
			assert.deepEqual(counts(code), [], code);
		assert.deepEqual(counts('EMPLOYER_PENSION_CONTRIBUTION'), ['PIT.PENSION']);
		const dest = (file: string, code: string) => {
			const row = fixturePresent(rows('version_4', file).find((item) => item.code === code));
			return `${String(row.destination)} ${String(row.direction)}`;
		};
		assert.equal(dest('adhoc_catalog', 'PROPERTY_DAMAGE_COMPENSATION'), 'NET SUBTRACT');
		assert.equal(dest('loan_catalog', 'SALARY_ADVANCE'), 'NET SUBTRACT');
		assert.deepEqual(
			fixturePresent(rows('version_4', 'loan_catalog').find((row) => row.code === 'SALARY_ADVANCE'))
				.bands,
			[]
		);
		// The insurance equivalent: the employer rates of each scheme the employee is outside.
		const equivalent = (subject: Row) => {
			const row = fixturePresent(
				rows('version_4', 'allowance_catalog').find((item) => item.code === 'INSURANCE_EQUIVALENT')
			);
			const context = { ...salaryContext, ...subject, allowance: { amount: 0 } };
			return evaluateConfigured(fixtureString(String(row.eligibility)), fixtureContext(context)) ===
				true
				? Math.round(
						Number(evaluateConfigured(fixtureString(String(row.amount)), fixtureContext(context)))
					)
				: 0;
		};
		assert.equal(
			equivalent({
				employment: { ...employment, start_date: '2026-10-01', exit_date: '2026-10-20' },
				terms: { ...salaryContext.terms, employment_type: 'CONTRACT' }
			}),
			Math.round(26000000 * 0.215)
		);
		// A PERMANENT contract is indefinite: a 20-day leaver is insured, so no equivalent is paid.
		assert.equal(
			equivalent({
				employment: { ...employment, start_date: '2026-10-01', exit_date: '2026-10-20' },
				terms: { ...salaryContext.terms, employment_type: 'PERMANENT' }
			}),
			0
		);
		assert.equal(
			equivalent({ terms: { ...salaryContext.terms, employment_type: 'PROBATION' } }),
			Math.round(26000000 * 0.01)
		);
		assert.equal(equivalent({}), 0);
		const fixed = fixturePresent(
			rows('version_4', 'allowance_catalog').find((row) => row.code === 'FIXED_ALLOWANCE')
		);
		assert.deepEqual(fixed.counts_toward, ['SI', 'UNION_DUES', 'HI', 'UI', 'UNION_FEE', 'PIT']);
		assert.equal(
			evaluateConfigured(
				fixtureString(String(fixed.amount)),
				fixtureContext({
					...salaryContext,
					allowance: { amount: 2000000 },
					// Half the month's working days in the employment: half the allowance (BASIC's working-day basis).
					period: { ...salaryContext.period, paid_days: 15, days: 30, covered_working_days: 13 }
				})
			),
			1000000
		);
		// A semi-monthly entity pays each half its share of the monthly amount (period.parts), every version and
		// every allowance; a half with half its working days covered pays a quarter.
		for (const version of VERSIONS)
			for (const row of rows(version, 'allowance_catalog').filter(
				(item) => item.code !== 'INSURANCE_EQUIVALENT'
			)) {
				const half = (covered_working_days: number) =>
					evaluateConfigured(
						fixtureString(String(row.amount)),
						fixtureContext({
							...salaryContext,
							allowance: { amount: 2000000 },
							period: {
								...salaryContext.period,
								days: 15,
								paid_days: 15,
								working_days: 13,
								covered_working_days,
								part: 1,
								parts: 2
							}
						})
					);
				assert.equal(half(13), 1000000, `${version} ${String(row.code)}`);
				// A part half at the monthly day wage: 6.5 of the month's 26 working days is a quarter.
				assert.equal(half(6.5), 500000, `${version} ${String(row.code)}`);
			}
		const halfEquivalent = (parts: number) =>
			equivalent({
				employment: { ...employment, start_date: '2026-10-01', exit_date: '2026-10-20' },
				terms: { ...salaryContext.terms, employment_type: 'CONTRACT' },
				period: { ...salaryContext.period, days: 15, paid_days: 15, part: 1, parts }
			});
		assert.equal(halfEquivalent(2), Math.round((26000000 * 0.215) / 2));
		assert.equal(halfEquivalent(1), Math.round(26000000 * 0.215));
		// VN-SETTINGS-7: a semi-monthly October with unequal halves (12 and 14 of the month's 26 working days) adds up to
		// exactly the monthly run, and every day and hour rate — work lines and the suspension kinds' day pay — is the
		// monthly wage over period.month_working_days in either half and in a monthly slice of the same month (a month
		// the entity switches pay frequency prices the same day the same way).
		for (const version of VERSIONS) {
			const context = (slice: Row) => ({
				...salaryContext,
				// The minimum-wage floor binds the stoppage and suspension rows.
				company: { ...salaryContext.company, facts: { stoppage_pay_percent: 0 } },
				period: { ...salaryContext.period, ...slice },
				day: { date: '2026-10-05', day_type: 'WORK' },
				suspension: { facts: {}, working_days_elapsed: 3 }
			});
			const half = (part: number) => ({
				days: part === 1 ? 15 : 16,
				paid_days: part === 1 ? 15 : 16,
				covered_days: part === 1 ? 15 : 16,
				working_days: part === 1 ? 12 : 14,
				covered_working_days: part === 1 ? 12 : 14,
				month_working_days: 25,
				month_holiday_work_days: 1,
				previous_month_working_days: 25,
				previous_month_holiday_work_days: 1,
				part,
				parts: 2
			});
			const month = {};
			const work = rows(version, 'work_catalog');
			const basic = fixturePresent(work.find((row) => row.code === 'BASIC'));
			const pay = (slice: Row) =>
				Number(
					evaluateConfigured(fixtureString(String(basic.rate)), fixtureContext(context(slice)))
				) *
				Number(
					evaluateConfigured(fixtureString(String(basic.quantity)), fixtureContext(context(slice)))
				);
			assert.ok(
				Math.abs(pay(half(1)) + pay(half(2)) - pay(month)) < 1e-6,
				`${version} BASIC halves`
			);
			// A part half pays its working days at the monthly day wage, 26,000,000 / 26 = 1,000,000 a day: a second-half
			// joiner covering 7 of its 14 working days is paid 7,000,000 (not 13,000,000 × 7/14); a first-half joiner
			// covering 6 of 12 is paid 6,000,000 (not 6,500,000). A full half stays 13,000,000.
			assert.equal(Math.round(pay({ ...half(2), covered_working_days: 7 })), 7000000, version);
			assert.equal(Math.round(pay({ ...half(1), covered_working_days: 6 })), 6000000, version);
			assert.equal(Math.round(pay(half(1))), 13000000, version);
			// A monthly part month is unchanged: 12 of 26 working days.
			assert.equal(
				Math.round(pay({ covered_working_days: 12 })),
				Math.round((26000000 * 12) / 26),
				version
			);
			const rates = [
				...work
					.filter((row) => String(row.rate ?? '').includes('month_working_days'))
					.map((row) => [`work ${String(row.code)}`, String(row.rate)] as const),
				...rows(version, 'suspension_kind')
					.filter((row) => String(row.pay ?? '').includes('month_working_days'))
					.map((row) => [`suspension ${String(row.code)}`, String(row.pay)] as const)
			];
			for (const code of [
				'NO_PAY_LEAVE',
				'OVERTIME',
				'NIGHT_WORK',
				'HOLIDAY_WORK',
				'STOPPAGE_REDUCTION',
				'SUSPENSION_ADVANCE',
				'ENCASHMENT'
			])
				assert.ok(
					rates.some(([name]) => name === `work ${code}`),
					`${version} ${code}`
				);
			for (const code of [
				'EMPLOYER_FAULT',
				'COWORKER_FAULT',
				'OBJECTIVE_CAUSE',
				'STRIKE_PARTICIPANT',
				'STRIKE_NON_PARTICIPANT'
			])
				assert.ok(
					rates.some(([name]) => name === `suspension ${code}`),
					`${version} ${code}`
				);
			for (const [name, expression] of rates) {
				const rate = (slice: Row) =>
					Number(evaluateConfigured(fixtureString(expression), fixtureContext(context(slice))));
				assert.ok(Math.abs(rate(half(1)) - rate(month)) < 1e-6, `${version} ${name} first half`);
				assert.ok(Math.abs(rate(half(2)) - rate(month)) < 1e-6, `${version} ${name} second half`);
			}
			// The no-pay day is the monthly wage over the month's 26 normal working days — 25 plus a public holiday on a
			// working day (Decree 145/2020 art.54(1)(a)(a3); the holiday is a paid day off, Labour Code art.112(1)) — in both halves.
			const npl = fixturePresent(work.find((row) => row.code === 'NO_PAY_LEAVE'));
			assert.equal(
				Number(
					evaluateConfigured(fixtureString(String(npl.rate)), fixtureContext(context(half(1))))
				),
				1000000
			);
		}
	});
	it('leave: maternity months and cases, child care, prenatal, miscarriage, contraception, convalescence, suspension and foreign national days', () => {
		const grant = (version: string, code: string, entryRow: Row) =>
			entitlementDays(
				fixtureEntitlement(
					fixtureValue11(
						fixturePresent(rows(version, 'leave_catalog').find((row) => row.code === code))
							.entitlement
					)
				),
				24,
				fixtureContext({ ...LEAVE_SUBJECT, entry: { facts: {}, ...entryRow } })
			);
		assert.equal(grant('version_4', 'MATERNITY_LEAVE', { from: '2026-01-10' }), 181);
		assert.equal(
			grant('version_4', 'MATERNITY_LEAVE', { from: '2026-01-10', facts: { children_born: 2 } }),
			212
		);
		assert.equal(
			grant('version_4', 'MATERNITY_LEAVE', { from: '2026-08-01', facts: { second_child: true } }),
			212
		);
		assert.equal(
			grant('version_3', 'MATERNITY_LEAVE', { from: '2026-06-01', facts: { second_child: true } }),
			183
		);
		// Second-child twins: seven months plus the multiple-birth month, eight (Labour Code art.139(1) as amended by Population
		// Law 113/2025 art.29(1); Ministry of Home Affairs answer).
		assert.equal(
			grant('version_4', 'MATERNITY_LEAVE', {
				from: '2026-08-01',
				facts: { second_child: true, children_born: 2 }
			}),
			243
		);
		assert.equal(
			grant('version_4', 'MATERNITY_LEAVE', {
				from: '2026-09-01',
				facts: { maternity_case: 'ADOPTION', child_birthdate: '2026-08-15' }
			}),
			167
		);
		const eligible = (code: string, employee: Row, facts: Row) =>
			evaluateConfigured(
				fixtureString(
					String(
						fixturePresent(rows('version_4', 'leave_catalog').find((row) => row.code === code))
							.eligibility
					)
				),
				fixtureContext({
					...admitContext,
					employee: { ...admitContext.employee, ...employee },
					entry: { ...entry(facts), occurred_on: '2026-10-15' }
				})
			);
		assert.equal(eligible('MATERNITY_LEAVE', { gender: 'MALE' }, {}), false);
		for (const maternity_case of ['ADOPTION', 'MOTHER_DIED', 'COMMISSIONING_FATHER'])
			assert.equal(
				eligible('MATERNITY_LEAVE', { gender: 'MALE' }, { maternity_case }),
				true,
				maternity_case
			);
		assert.equal(
			grant('version_4', 'CHILD_SICK_CARE', {
				from: '2026-10-01',
				facts: { child_birthdate: '2025-01-01' }
			}),
			20
		);
		assert.equal(
			grant('version_4', 'CHILD_SICK_CARE', {
				from: '2026-10-01',
				facts: { child_birthdate: '2021-01-01' }
			}),
			15
		);
		assert.equal(eligible('CHILD_SICK_CARE', {}, { child_birthdate: '2018-01-01' }), false);
		assert.equal(eligible('CHILD_SICK_CARE', {}, { child_birthdate: '2021-01-01' }), true);
		assert.equal(grant('version_4', 'PRENATAL_CHECKUP', {}), 5);
		assert.equal(
			grant('version_4', 'PRENATAL_CHECKUP', { facts: { remote_or_pathological: true } }),
			10
		);
		assert.deepEqual(
			[3, 8, 15, 25].map((gestation_weeks) =>
				grant('version_4', 'MISCARRIAGE_LEAVE', { facts: { gestation_weeks } })
			),
			[10, 20, 40, 50]
		);
		assert.equal(grant('version_4', 'CONTRACEPTION_LEAVE', {}), 7);
		assert.equal(
			grant('version_4', 'CONTRACEPTION_LEAVE', { facts: { method: 'STERILISATION' } }),
			15
		);
		assert.deepEqual(
			['LONG_TERM_ILLNESS', 'CAESAREAN', 'ILLNESS'].map((after) =>
				grant('version_4', 'CONVALESCENCE_LEAVE', { facts: { after } })
			),
			[10, 7, 5]
		);
		assert.equal(grant('version_4', 'SUSPENSION_PENDING_DISCIPLINE', {}), 15);
		assert.equal(
			grant('version_4', 'SUSPENSION_PENDING_DISCIPLINE', { facts: { special_case: true } }),
			90
		);
		assert.equal(grant('version_4', 'FOREIGN_NATIONAL_LEAVE', {}), 2);
		assert.equal(eligible('FOREIGN_NATIONAL_LEAVE', { nationality: 'KOREAN' }, {}), true);
		assert.equal(eligible('FOREIGN_NATIONAL_LEAVE', { nationality: 'VN' }, {}), false);
	});
	it('validations: region, hourly minimum, probation wage and length, pregnant and infant workers, minors and weekly rest', () => {
		const rule = (code: string) =>
			fixtureValue2(
				fixturePresent(
					rows('version_4', 'rule_set').find(
						(row) => row.family === 'VALIDATIONS' && row.code === code
					)
				).rules
			);
		const trips = (code: string, context: Row) =>
			evaluateConfigured(fixtureString(String(rule(code).when)), fixtureContext(context));
		const contract = (terms: Row, region = 'I') => ({
			terms: {
				base_salary: 10000000,
				employment_type: 'PERMANENT',
				facts: {},
				effective_from: '2026-10-01',
				effective_to: '',
				...terms
			},
			company: { region, facts: {} },
			rules: payrollRules('version_4')
		});
		assert.equal(rule('REGION_REQUIRED').kind, 'refuse');
		assert.equal(trips('REGION_REQUIRED', contract({}, '')), true);
		assert.equal(trips('REGION_REQUIRED', contract({}, 'III')), false);
		assert.equal(trips('HOURLY_MINIMUM_WAGE', contract({ facts: { hourly_rate: 25000 } })), true);
		assert.equal(
			trips('HOURLY_MINIMUM_WAGE', contract({ facts: { hourly_rate: 25000 } }, 'II')),
			false
		);
		assert.equal(
			trips(
				'PROBATION_WAGE',
				contract({
					employment_type: 'PROBATION',
					base_salary: 8400000,
					facts: { probation_job_wage: 10000000 }
				})
			),
			true
		);
		assert.equal(
			trips(
				'PROBATION_WAGE',
				contract({
					employment_type: 'PROBATION',
					base_salary: 8500000,
					facts: { probation_job_wage: 10000000 }
				})
			),
			false
		);
		const probation = (probation_class: string, effective_to: string) =>
			trips(
				'PROBATION_PERIOD',
				contract({
					employment_type: 'PROBATION',
					effective_from: '2026-10-05',
					effective_to,
					facts: { probation_class }
				})
			);
		assert.equal(probation('COLLEGE_OR_ABOVE', '2026-12-03'), false);
		assert.equal(probation('COLLEGE_OR_ABOVE', '2026-12-04'), true);
		assert.equal(probation('INTERMEDIATE_OR_TECHNICAL', '2026-11-04'), true);
		assert.equal(probation('OTHER', '2026-10-12'), false);
		assert.equal(probation('OTHER', '2026-10-13'), true);
		assert.equal(probation('ENTERPRISE_MANAGER', '2027-04-02'), false);
		const slip = (employee: Row, days: Row[], extra: Row = {}) => ({
			...salaryContext,
			employee: { ...salaryContext.employee, ...employee },
			work: { ...salaryContext.work, days },
			...extra
		});
		const workDay = (date: string, extra: Row = {}) => ({
			date,
			day_type: 'WORK',
			holiday_kind: '',
			scheduled_hours: 8,
			worked_hours: 8,
			worked: true,
			overtime_hours: 0,
			intervals: [],
			...extra
		});
		const ot = [workDay('2026-10-05', { overtime_hours: 2 })];
		assert.equal(
			trips(
				'PREGNANT_OR_INFANT_NIGHT_OVERTIME',
				slip({ children: [{ child_birthdate: '', estimated_delivery_date: '2026-12-20' }] }, ot)
			),
			true
		);
		assert.equal(
			trips(
				'PREGNANT_OR_INFANT_NIGHT_OVERTIME',
				slip({ children: [{ child_birthdate: '', estimated_delivery_date: '2027-03-20' }] }, ot)
			),
			false
		);
		assert.equal(
			trips(
				'PREGNANT_OR_INFANT_NIGHT_OVERTIME',
				slip({ children: [{ child_birthdate: '2026-03-01' }] }, ot)
			),
			true
		);
		// Consent is per day (work.days[].overtime_consented, owner ruling): a consented day passes, an
		// employee fact does not, and one unconsented night shift in the period still warns.
		const infant = { children: [{ child_birthdate: '2026-03-01' }] };
		assert.equal(
			trips(
				'PREGNANT_OR_INFANT_NIGHT_OVERTIME',
				slip(infant, [workDay('2026-10-05', { overtime_hours: 2, overtime_consented: true })])
			),
			false
		);
		assert.equal(
			trips(
				'PREGNANT_OR_INFANT_NIGHT_OVERTIME',
				slip({ ...infant, facts: { night_overtime_consent: true } }, ot)
			),
			true
		);
		assert.equal(
			trips(
				'PREGNANT_OR_INFANT_NIGHT_OVERTIME',
				slip(infant, [
					workDay('2026-10-05', { overtime_hours: 2, overtime_consented: true }),
					workDay('2026-10-06', {
						overtime_consented: false,
						intervals: [{ start: '2026-10-06T22:00', end: '2026-10-07T02:00' }]
					})
				])
			),
			true
		);
		// The child's first birthday is read on each day: overtime after it needs no consent.
		assert.equal(
			trips(
				'PREGNANT_OR_INFANT_NIGHT_OVERTIME',
				slip({ children: [{ child_birthdate: '2025-10-03' }] }, ot)
			),
			false
		);
		assert.equal(
			trips('MINOR_WORKING_TIME', slip({ age: 16 }, [workDay('2026-10-05', { worked_hours: 9 })])),
			true
		);
		assert.equal(trips('MINOR_WORKING_TIME', slip({ age: 16 }, [workDay('2026-10-05')])), false);
		assert.equal(
			trips('MINOR_WORKING_TIME', slip({ age: 19 }, [workDay('2026-10-05', { worked_hours: 9 })])),
			false
		);
		const week = (rest: boolean) =>
			Array.from({ length: 7 }, (_, i) =>
				workDay(
					`2026-10-0${i + 1}`,
					rest && i === 6 ? { worked: false, worked_hours: 0, day_type: 'REST' } : {}
				)
			);
		assert.equal(
			trips('WEEKLY_REST', slip({}, week(false), { company: { region: 'I', facts: {} } })),
			true
		);
		assert.equal(
			trips('WEEKLY_REST', slip({}, week(true), { company: { region: 'I', facts: {} } })),
			false
		);
	});
	it('public holidays: the national calendar per version, with substitute days', () => {
		const holidays = (version: string) =>
			fixtureValue18(
				fixturePresent(
					rows(version, 'rule_set').find(
						(row) => row.family === 'PAYROLL' && row.code === 'public_holidays'
					)
				).rules
			).holidays;
		assert.deepEqual(holidays('version_1'), []);
		assert.deepEqual(holidays('version_3'), []);
		const v2 = holidays('version_2');
		assert.deepEqual(
			v2.filter((h) => h.name === 'Tết Âm lịch').map((h) => h.date),
			['2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20']
		);
		assert.deepEqual(
			v2.find((h) => h.date === '2026-04-27'),
			{
				date: '2026-04-27',
				name: 'Giỗ Tổ Hùng Vương (nghỉ bù)',
				kind: 'SUBSTITUTE',
				replaces: '2026-04-26',
				given_to: 'ONLY_IF_OFF_ON_REPLACED_DATE',
				source:
					'Labour Code 2019 art.111(3) https://congbaocdn.chinhphu.vn/CongBaoCP/VanBan/2019/11/30232/29070-1-2019993-99445-2019-qh14.pdf'
			}
		);
		assert.equal(v2.length, 10);
		const v4 = holidays('version_4').map((h) => h.date);
		assert.ok(
			v4.includes('2026-09-01') &&
				v4.includes('2026-09-02') &&
				v4.includes('2026-11-24') &&
				v4.includes('2027-05-03')
		);
		// Hùng Kings 2027: 10/3 lunar = Friday 16 April 2027, fixed by Labour Code art.112(1)(c) (no substitute day).
		assert.deepEqual(
			holidays('version_4').find((h) => h.date === '2027-04-16'),
			{
				date: '2027-04-16',
				name: 'Giỗ Tổ Hùng Vương',
				kind: 'PUBLIC_HOLIDAY',
				source:
					'Labour Code 2019 art.112(1) https://congbaocdn.chinhphu.vn/CongBaoCP/VanBan/2019/11/30232/29070-1-2019993-99445-2019-qh14.pdf'
			}
		);
		assert.equal(new Date('2027-04-16T00:00:00Z').getUTCDay(), 5);
		// Tết and 2 September 2027 per Bộ Nội vụ Thông báo 11483/TB-BNV (9 October 2026): the enterprise option the notice
		// aligns with the civil service — 4–8 February, Saturday 6 and Sunday 7 given back on 9 and 10 February — and 3 September.
		const v4rows = holidays('version_4');
		assert.deepEqual(
			v4rows.filter((h) => h.name === 'Tết Âm lịch').map((h) => h.date),
			['2027-02-04', '2027-02-05', '2027-02-06', '2027-02-07', '2027-02-08']
		);
		assert.deepEqual(
			v4rows
				.filter((h) => h.kind === 'SUBSTITUTE' && String(h.date).startsWith('2027-02'))
				.map((h) => [h.date, h.replaces, h.given_to]),
			[
				['2027-02-09', '2027-02-06', 'ONLY_IF_OFF_ON_REPLACED_DATE'],
				['2027-02-10', '2027-02-07', 'ONLY_IF_OFF_ON_REPLACED_DATE']
			]
		);
		assert.ok(v4.includes('2027-09-02') && v4.includes('2027-09-03'));
		assert.ok(
			v4rows
				.filter((h) => String(h.date).startsWith('2027-02') || h.date === '2027-09-03')
				.every((h) => String(h.source).includes('11483/TB-BNV'))
		);
		for (const version of VERSIONS) {
			const range = fixtureValue6(settings(version).effective_range);
			for (const h of holidays(version)) {
				assert.ok(
					String(h.date) >= range.from && (range.to == null || String(h.date) <= range.to),
					`${version} ${String(h.date)}`
				);
				assert.match(String(h.source), /https:\/\//, `${version} ${String(h.date)} source`);
			}
			assert.ok(
				fixtureValue12(settings(version).behaviours).rules.some(
					(rule) => rule.id === 'write-public-holidays'
				)
			);
		}
	});
	it('every duty falls due on its statutory day', () => {
		const run = (key: string) => ({
			period: {
				key,
				from: `${key}-01`,
				to: String(evaluateConfigured(fixtureString(`month_end("${key}-01")`), fixtureContext({})))
			},
			company: COMPANY,
			headcount: 12,
			holidays: []
		});
		const hire = {
			hired_on: '2026-10-15',
			contract: CONTRACT,
			employee: PROFILE,
			company: COMPANY,
			holidays: []
		};
		const exit = (exit_ground = 'END_OF_CONTRACT') => ({
			exit_on: '2026-10-31',
			contract: { ...CONTRACT, exit_ground },
			employee: PROFILE,
			company: COMPANY,
			holidays: []
		});
		const contexts: {
			[trigger: string]: Row;
		} = {
			PAYROLL_RUN: run('2026-12'),
			HIRE: hire,
			EXIT: exit(),
			'entity.created': { ...run('2026-10'), row: COMPANY },
			'workplace_case.created': {
				row: { kind: 'PERSONAL_DATA_BREACH', opened_on: '2026-12-28' },
				company: COMPANY,
				holidays: []
			},
			'calendar.daily': {
				today: '2026-09-01',
				contract: {
					...CONTRACT,
					facts: { contract_terms: [{ facts: { work_permit_valid_until: '2026-10-16' } }] }
				},
				employee: PROFILE,
				company: COMPANY,
				holidays: []
			},
			'leave_catalog_entry.created': {
				row: { catalog_code: 'SICK_LEAVE', to: '2026-10-09' },
				today: '2026-10-05',
				holidays: [],
				company: COMPANY
			}
		};
		const expected: {
			[version: string]: {
				[code: string]: string;
			};
		} = {
			version_4: {
				SI_HI_UI_REGISTRATION: '2026-11-14',
				SI_HI_UI_CHANGE_DECLARATION: '2027-01-31',
				SI_HI_UI_MONTHLY_REMITTANCE: '2027-01-31',
				SI_BENEFIT_CLAIMS: '2026-10-20',
				INSURANCE_EQUIVALENT_PAYMENT: '2026-12-31',
				LABOUR_CONTRACT: '2026-10-15',
				LABOUR_MANAGEMENT_BOOK: '2026-10-15',
				LABOUR_USE_REPORT: '2027-01-04',
				INTERNAL_LABOUR_RULES: '2026-12-31',
				WAGE_SCALE_AND_NORMS: '2026-12-31',
				MINIMUM_WAGE: '2026-12-31',
				WAGE_PAYMENT_TIMING: '2026-12-31',
				WAGE_STATEMENT: '2026-12-31',
				WAGE_DEDUCTION_LIMIT: '2026-12-31',
				OVERTIME_CONSENT_AND_LIMITS: '2026-12-31',
				NIGHT_OVERTIME_STATEMENT: '2026-12-31',
				ANNUAL_LEAVE_SCHEDULE: '2026-12-31',
				WORKPLACE_DIALOGUE: '2026-12-31',
				TERMINATION_NOTICE: '2026-10-31',
				RESTRUCTURING_LABOUR_PLAN: '2026-10-01',
				FINAL_SETTLEMENT: '2026-11-19',
				SI_CONFIRMATION_ON_TERMINATION: '2026-11-19',
				PIT_TAX_REGISTRATION: '2027-01-31',
				PIT_WITHHOLDING_DECLARATION: '2027-01-31',
				PIT_SHORT_CONTRACT_COMMITMENT: '2026-12-31',
				PIT_ANNUAL_FINALISATION: '2027-03-31',
				PIT_WITHHOLDING_CERTIFICATE: '2026-10-31',
				UNION_FEE_REMITTANCE: '2027-01-31',
				UNION_DUES_TRANSFER: '2026-12-31',
				FOREIGN_WORK_PERMIT: '2026-10-15',
				WORK_PERMIT_EXTENSION: '2026-10-06',
				WORK_PERMIT_RETURN: '2026-11-15',
				OCCUPATIONAL_HEALTH_CHECK: '2026-12-31',
				OCCUPATIONAL_ACCIDENT_REPORT: '2027-01-09',
				OSH_ANNUAL_REPORT: '2027-01-09',
				PERSONAL_DATA_DISPOSAL: '2036-12-31',
				RECORD_RETENTION: '2027-12-31',
				PDPL_CONSENT: '2026-10-15',
				PDPL_RECRUITMENT_AND_EMPLOYMENT: '2026-10-31',
				PDPL_IMPACT_ASSESSMENT: '2026-12-31',
				PDPL_BREACH_NOTIFICATION: '2026-12-31',
				PDPL_DATA_PROTECTION_PERSONNEL: '2026-12-31',
				DEPENDANT_TAX_REGISTRATION: '2026-12-31',
				LABOUR_USE_DECLARATION: '2026-10-31',
				FOREIGN_EXIT_PIT_FINALISATION: '2026-10-31',
				OSH_INDUCTION_TRAINING: '2026-10-15'
			}
		};
		expected.version_1 = {
			...expected.version_4,
			PIT_TAX_REGISTRATION: '2026-10-25',
			PIT_WITHHOLDING_DECLARATION: '2027-01-20',
			DPD_CONSENT_AND_NOTICE: '2026-10-15',
			DPD_DELETION_ON_REQUEST: '2026-10-31',
			DPD_IMPACT_ASSESSMENT: '2026-12-14',
			DPD_BREACH_NOTIFICATION: '2026-12-31',
			DPD_SENSITIVE_DATA_PERSONNEL: '2026-12-31'
		};
		for (const code of [
			'PDPL_CONSENT',
			'PDPL_RECRUITMENT_AND_EMPLOYMENT',
			'PDPL_IMPACT_ASSESSMENT',
			'PDPL_BREACH_NOTIFICATION',
			'PDPL_DATA_PROTECTION_PERSONNEL',
			'DEPENDANT_TAX_REGISTRATION',
			'PERSONAL_DATA_DISPOSAL'
		])
			delete expected.version_1[code];
		for (const version of ['version_1', 'version_4']) {
			const duties = new Map(
				dutiesOf(rows(version, 'rule_set')).map((row) => [String(row.code), row])
			);
			assert.deepEqual(
				[...duties.keys()].toSorted(),
				Object.keys(fixturePresent(expected[version])).toSorted(),
				version
			);
			for (const [code, row] of duties)
				assert.equal(
					evaluateConfigured(
						fixtureString(String(fixtureValue2(row.rules).due)),
						fixtureContext(fixturePresent(contexts[triggerOf(row)]))
					),
					fixturePresent(expected[version])[code],
					`${version} ${code}`
				);
		}
		// Decree 219/2025 art.28(1): extension filed 10 to 45 days before expiry, raised on the window's first day;
		// art.31(1): a permit holder's permit is returned within 15 days of the exit.
		for (const version of VERSIONS) {
			const duty = (code: string) =>
				fixtureValue2(
					fixturePresent(dutiesOf(rows(version, 'rule_set')).find((row) => row.code === code)).rules
				);
			const permit = (
				today: string,
				terms: Row[] = [{ facts: { work_permit_valid_until: '2026-10-16' } }]
			) => ({
				today,
				contract: { ...CONTRACT, facts: { contract_terms: terms } }
			});
			const extension = duty('WORK_PERMIT_EXTENSION');
			assert.deepEqual(extension.trigger, { collection: 'calendar', events: ['daily'] });
			assert.equal(
				evaluateConfigured(
					fixtureString(String(extension.when)),
					fixtureContext(permit('2026-09-01'))
				),
				true,
				version
			);
			assert.equal(
				evaluateConfigured(
					fixtureString(String(extension.when)),
					fixtureContext(permit('2026-09-02'))
				),
				false,
				version
			);
			assert.equal(
				evaluateConfigured(
					fixtureString(String(extension.when)),
					fixtureContext(permit('2026-09-01', [{ facts: {} }]))
				),
				false
			);
			assert.equal(
				evaluateConfigured(
					fixtureString(String(extension.due)),
					fixtureContext(permit('2026-09-01'))
				),
				'2026-10-06'
			);
			const back = duty('WORK_PERMIT_RETURN');
			assert.equal(
				evaluateConfigured(
					fixtureString(String(back.applies_when)),
					fixtureContext(permit('2026-10-31'))
				),
				true
			);
			assert.equal(
				evaluateConfigured(
					fixtureString(String(back.applies_when)),
					fixtureContext(permit('2026-10-31', [{ facts: {} }]))
				),
				false
			);
		}
		// The employer's unilateral termination gives 45 days' notice before the exit (Labour Code art.36(2)(a)).
		const notice = fixturePresent(
			dutiesOf(rows('version_4', 'rule_set')).find((row) => row.code === 'TERMINATION_NOTICE')
		);
		assert.equal(
			evaluateConfigured(
				fixtureString(String(fixtureValue2(notice.rules).due)),
				fixtureContext(exit('UNILATERAL'))
			),
			'2026-09-16'
		);
		// Art.36(2): 45 days for an indefinite contract, 30 for 12–36 months, 3 working days under 12 months.
		const termed = (terms: Row[]) => ({
			...exit('UNILATERAL'),
			contract: { ...CONTRACT, exit_ground: 'UNILATERAL', facts: { contract_terms: terms } }
		});
		const due = (terms: Row[]) =>
			evaluateConfigured(
				fixtureString(String(fixtureValue2(notice.rules).due)),
				fixtureContext(termed(terms))
			);
		assert.equal(due([{ employment_type: 'PERMANENT' }]), '2026-09-16');
		assert.equal(
			due([
				{ employment_type: 'CONTRACT', facts: { contract_type: 'FIXED', agreed_term_months: 24 } }
			]),
			'2026-10-01'
		);
		// 31 October 2026 is a Saturday: three working days back (Sunday the rest day) is Wednesday 28 October.
		assert.equal(
			due([
				{ employment_type: 'CONTRACT', facts: { contract_type: 'FIXED', agreed_term_months: 6 } }
			]),
			'2026-10-28'
		);
		assert.equal(due([{ employment_type: 'CONTRACT' }]), '2026-09-16');
		// Art.36(2)(c): a long illness (art.36(1)(b)) takes 3 working days whatever the term.
		assert.equal(
			evaluateConfigured(
				fixtureString(String(fixtureValue2(notice.rules).due)),
				fixtureContext({
					...termed([{ employment_type: 'PERMANENT' }]),
					contract: {
						...CONTRACT,
						exit_ground: 'UNILATERAL',
						exit_facts: { long_illness: true },
						facts: { contract_terms: [{ employment_type: 'PERMANENT' }] }
					}
				})
			),
			'2026-10-28'
		);
		// Decree 145/2020 art.7 special roles: 120 days, or a quarter of a term under 12 months (184 days ÷ 4 = 46).
		assert.equal(
			due([{ employment_type: 'PERMANENT', facts: { special_role_notice: true } }]),
			'2026-07-03'
		);
		assert.equal(
			due([
				{
					employment_type: 'CONTRACT',
					facts: { contract_type: 'FIXED', agreed_term_months: 24, special_role_notice: true }
				}
			]),
			'2026-07-03'
		);
		assert.equal(
			due([
				{
					employment_type: 'CONTRACT',
					facts: { contract_type: 'FIXED', agreed_term_months: 6, special_role_notice: true }
				}
			]),
			'2026-09-15'
		);
	});
	it('PIT: work-expense allowances above the internal limit and overtime pay above the statutory hours are taxable', () => {
		const citizen = { residency_status: 'CITIZEN' };
		const base = charge('version_4', 'PIT', 30000000, citizen).employee;
		assert.equal(
			charge('version_4', 'PIT', 30000000, citizen, {
				parts: { work_expense: 2000000 },
				company: { facts: { work_expense_limit: 1500000 } }
			}).employee,
			base + 50000
		);
		assert.equal(
			charge('version_4', 'PIT', 30000000, citizen, {
				parts: { work_expense: 1000000 },
				company: { facts: { work_expense_limit: 1500000 } }
			}).employee,
			base
		);
		const line = fixturePresent(
			rows('version_4', 'work_catalog').find((item) => item.code === 'OVERTIME_ABOVE_LIMIT_TAXABLE')
		);
		const hours = (month: number, year: number) => ({
			month: {
				paid_overtime_hours: month,
				day_type: { WORK: { overtime_hours: month, paid_overtime_hours: month } },
				holiday_kind: {},
				day_type_holiday_kind: {}
			},
			year: {
				paid_overtime_hours: year,
				day_type: { WORK: { overtime_hours: year, paid_overtime_hours: year } },
				holiday_kind: {},
				day_type_holiday_kind: {}
			}
		});
		const at = (h: Row) => {
			const context = { ...salaryContext, hours: h };
			if (
				evaluateConfigured(fixtureString(String(line.eligibility)), fixtureContext(context)) !==
				true
			)
				return 0;
			return Number(
				evaluateConfigured(fixtureString(String(line.quantity)), fixtureContext(context))
			);
		};
		assert.equal(at(hours(30, 150)), 0);
		assert.equal(at(hours(45, 150)), 5);
		assert.equal(at(hours(30, 210)), 10);
		assert.equal(at(hours(30, 250)), 30);
		// Decree 253/2026 art.26(3): the hours above the cap are taxed at the pay actually received — 200% for rest-day
		// and 300% for holiday hours, drawn pro rata from the month's mix: 30 working-day and 20 holiday hours (50, 10
		// over 40) are at (30 × 150% + 20 × 300%) / 50 = 210% of the hour wage; 50 rest-day hours at 200%.
		const hour = 26000000 / 26 / 8;
		const priced = (h: Row) => {
			const context = { ...salaryContext, hours: h };
			return (
				Number(evaluateConfigured(fixtureString(String(line.quantity)), fixtureContext(context))) *
				Number(evaluateConfigured(fixtureString(String(line.rate)), fixtureContext(context)))
			);
		};
		const mixed = {
			month: {
				paid_overtime_hours: 50,
				day_type: { WORK: { overtime_hours: 50, paid_overtime_hours: 50 } },
				holiday_kind: { PUBLIC_HOLIDAY: { worked_hours: 20, paid_overtime_hours: 20 } },
				day_type_holiday_kind: { WORK: { PUBLIC_HOLIDAY: { paid_overtime_hours: 20 } } }
			},
			year: {
				paid_overtime_hours: 50,
				day_type: { WORK: { overtime_hours: 50, paid_overtime_hours: 50 } },
				holiday_kind: { PUBLIC_HOLIDAY: { worked_hours: 20, paid_overtime_hours: 20 } },
				day_type_holiday_kind: { WORK: { PUBLIC_HOLIDAY: { paid_overtime_hours: 20 } } }
			}
		};
		assert.equal(Math.round(priced(mixed)), Math.round(10 * 2.1 * hour));
		const rest = {
			month: {
				paid_overtime_hours: 50,
				day_type: { REST: { worked_hours: 50, paid_overtime_hours: 50 } },
				holiday_kind: {},
				day_type_holiday_kind: {}
			},
			year: {
				paid_overtime_hours: 50,
				day_type: { REST: { worked_hours: 50, paid_overtime_hours: 50 } },
				holiday_kind: {},
				day_type_holiday_kind: {}
			}
		};
		assert.equal(Math.round(priced(rest)), Math.round(10 * 2.0 * hour));
		assert.equal(Math.round(priced(hours(45, 150))), Math.round(5 * 1.5 * hour));
		// A holiday on a rest day belongs to the 300% class once; actual attendance and banked hours cannot
		// increase the cash overtime that this tax-only line classifies.
		for (const version of ['version_2', 'version_3', 'version_4']) {
			const tax = fixturePresent(
				rows(version, 'work_catalog').find((item) => item.code === 'OVERTIME_ABOVE_LIMIT_TAXABLE')
			);
			for (const worked_hours of [0, 50, 200]) {
				const approved = {
					paid_overtime_hours: 50,
					overtime_hours: 70,
					worked_hours,
					day_type: { REST: { paid_overtime_hours: 50, overtime_hours: 70, worked_hours } },
					holiday_kind: {
						PUBLIC_HOLIDAY: { paid_overtime_hours: 50, overtime_hours: 70, worked_hours }
					},
					day_type_holiday_kind: {
						REST: { PUBLIC_HOLIDAY: { paid_overtime_hours: 50, overtime_hours: 70, worked_hours } }
					}
				};
				const context = {
					...salaryContext,
					rules: payrollRules(version),
					hours: { month: approved, year: approved }
				};
				const quantity = Number(
					evaluateConfigured(fixtureString(String(tax.quantity)), fixtureContext(context))
				);
				assert.equal(quantity, 10, `${version}: actual ${worked_hours}`);
				assert.equal(
					Math.round(
						quantity *
							Number(evaluateConfigured(fixtureString(String(tax.rate)), fixtureContext(context)))
					),
					Math.round(10 * 3 * hour)
				);
				assert.deepEqual(
					[tax.destination, tax.direction, tax.counts_toward],
					['EMPLOYER', 'ADD', ['PIT']]
				);
			}
		}
		assert.equal(line.destination, 'EMPLOYER');
		assert.equal(
			rows('version_1', 'work_catalog').some(
				(item) => item.code === 'OVERTIME_ABOVE_LIMIT_TAXABLE'
			),
			false
		);
	});
	it.effect(
		'a bonus off-cycle before, inside or after the regular run settles the same month totals, never deferred',
		Effect.fnUntraced(function* () {
			const COMPANY_ID = 'c0000000-0000-4000-8000-0000000000vn';
			const law = (name: string): Row[] =>
				VERSIONS.flatMap((version) => rows(version, name)).map((row) => ({
					...row
				}));
			let tables = fixtureTables();
			const reset = () => {
				tables = fixtureTables([
					...[...FILES].map((name) => fixtureValue1([name, law(name)])),
					[
						'entity',
						[
							{
								id: COMPANY_ID,
								name: 'Sông Hồng',
								settings_code: 'VN',
								pay_frequency: 'MONTHLY',
								region: 'I',
								facts: {},
								pay_cutoff_day: 1,
								effective_range: { from: '2025-12-01', to: null }
							}
						]
					],
					[
						'employment_profile',
						[
							{
								id: 'e1',
								name: 'Lan',
								date_of_birth: '1990-05-01',
								nationality: 'VN',
								gender: 'FEMALE',
								// a union member: UNION_DUES is charged too, so every scheme of the version is exercised
								facts: {
									employment_statutory_facts: [
										{
											id: 's-e1',
											employment_id: 'k-e1',
											statutory_contribution_id: fixturePresent(
												law('statutory_contribution_catalog').find(
													(row) =>
														row.code === 'UNION_DUES' &&
														row.settings_id === fixtureKey(settings('version_4').id)
												)
											).id,
											effective_range: { from: '2024-01-01', to: null },
											status: { kind: 'ENROLLED', elections: { union_member: true } }
										}
									]
								}
							},
							{
								id: 'e2',
								name: 'Minh',
								date_of_birth: '1985-02-11',
								nationality: 'VN',
								gender: 'MALE'
							}
						]
					],
					[
						'employment_contract',
						[
							['e1', 30000000],
							['e2', 70000000]
						].map(([id, salary]) => ({
							id: `k-${String(id)}`,
							employee_id: id,
							company_id: COMPANY_ID,
							effective_range: { from: '2024-01-01', to: null },
							facts: {
								contract_terms: [
									{
										base_salary: { value: salary, currency: 'VND' },
										effective_range: { from: '2024-01-01', to: null },
										residency_status: 'CITIZEN',
										work_classification: 'ORDINARY',
										employment_type: 'PERMANENT',
										// a meal allowance is taxable only above 1,200,000 a month: the month's threshold is
										// deducted once, whichever slip of the month pays what
										allowances:
											id === 'e1'
												? [{ code: 'MEAL_ALLOWANCE', amount: { currency: 'VND', value: 1500000 } }]
												: []
									}
								]
							},
							employee_number: String(id),
							contract_number: 1
						}))
					]
				]);
			};
			const reads = world(tables).layer;
			const run = Effect.fnUntraced(function* (kind: PayrollRunKind, sources?: string[]) {
				return yield* world(tables).run(
					fixtureKey(COMPANY_ID),
					'2026-08',
					kind,
					sources?.map(fixtureId)
				);
			});
			const bonus = () => {
				const v4 = settings('version_4').id;
				const catalogId = fixturePresent(
					law('adhoc_catalog').find(
						(row) => row.code === 'BONUS' && row.settings_id === fixtureKey(v4)
					)
				).id;
				if (!tables.has('adhoc_catalog_entry')) tables.set('adhoc_catalog_entry', fixtureRows([]));
				fixturePresent(tables.get('adhoc_catalog_entry')).push(
					fixtureRow({
						id: 'bonus-1',
						employment_id: 'k-e1',
						company_id: COMPANY_ID,
						catalog_id: catalogId,
						payslip_id: null,
						occurred_on: '2026-08-05',
						amount: 40000000
					})
				);
			};
			type Plan = Effect.Success<ReturnType<typeof run>>;
			type Charges = { [key: string]: [number, number] };
			const charges = (plans: Plan[]) => {
				const out: Charges = {};
				for (const slip of plans.flatMap((plan) => plan.payslips))
					for (const line of slip.statutory) {
						const key = `${String(slip.employment_id)}:${line.scheme_code}`;
						const held = out[key] ?? [0, 0];
						out[key] = [
							Math.round((held[0] + line.employee_amount) * 100) / 100,
							Math.round((held[1] + line.employer_amount) * 100) / 100
						];
					}
				return out;
			};
			reset();
			bonus();
			const offBefore = yield* run('OFF_CYCLE', ['bonus-1']);
			const before = [offBefore, yield* run('REGULAR')];
			reset();
			bonus();
			const inside = [yield* run('REGULAR')];
			reset();
			const regular = yield* run('REGULAR');
			bonus();
			const offAfter = yield* run('OFF_CYCLE', ['bonus-1']);
			const after = [regular, offAfter];
			// Every scheme of the version, employee and employer, per employee: identical month totals in all three orders.
			const first = charges(before);
			assert.deepEqual(first, charges(inside));
			assert.deepEqual(first, charges(after));
			const lan = fixtureKey('k-e1');
			const minh = fixtureKey('k-e2');
			for (const row of law('statutory_contribution_catalog').filter(
				(item) => item.settings_id === fixtureKey(settings('version_4').id)
			)) {
				const [employee, employer] = first[`${lan}:${String(row.code)}`] ?? [0, 0];
				assert.ok(employee + employer > 0, String(row.code));
			}
			// The 40,000,000 bonus sits outside the insurance salary: SI on 30,000,000 and 50,600,000 only, and PIT
			// deducts the insurance actually charged — taxable 70,000,000 + 300,000 meal above the cap − 3,150,000 −
			// 15,500,000 for Lan; union dues 0.5% of 30,000,000.
			assert.deepEqual(first[`${lan}:SI`], [30000000 * 0.08, 30000000 * 0.175]);
			assert.deepEqual(first[`${minh}:SI`], [50600000 * 0.08, 50600000 * 0.175]);
			assert.deepEqual(first[`${lan}:UNION_DUES`], [150000, 0]);
			// Both fall in the 20% rung (30,000,000 to 60,000,000).
			const pit = (taxable: number) => Math.round(500000 + 2000000 + (taxable - 30000000) * 0.2);
			const lanTaxable = 70000000 + 300000 - 3150000 - 15500000;
			assert.deepEqual(first[`${lan}:PIT`], [pit(lanTaxable), 0]);
			assert.deepEqual(first[`${minh}:PIT`], [
				pit(70000000 - 50600000 * 0.095 - 700000 - 15500000),
				0
			]);
			// Never deferred: the slip that pays the bonus carries the tax the bonus attracts, whichever run comes first —
			// the month's tax less the tax on the regular pay alone (30,000,000 + 300,000 − 3,150,000 − 15,500,000 =
			// 11,650,000 → 665,000): 6,830,000 − 665,000 = 6,165,000. (Before re-verification 3 the bonus slip paid before
			// the salary run carried 1,635,000 and the salary run caught up 4,530,000.) The month's insurance is charged with
			// the regular pay, never on the bonus slip.
			const bonusSlip = (plan: Plan) =>
				Object.fromEntries(
					fixturePresent(plan.payslips.find((slip) => slip.employment_id === lan)).statutory.map(
						(line) => [line.scheme_code, [line.employee_amount, line.employer_amount]]
					)
				);
			const regularPit = 500000 + (11650000 - 10000000) * 0.1;
			for (const slip of [bonusSlip(offBefore), bonusSlip(offAfter)])
				assert.deepEqual(slip, {
					PIT: [pit(lanTaxable) - regularPit, 0],
					SI: [0, 0],
					HI: [0, 0],
					UI: [0, 0],
					UNION_FEE: [0, 0],
					UNION_DUES: [0, 0]
				});
		})
	);
	it('exported returns: the D02-LT change list (Quyết định 366/QĐ-BHXH) and 05-1/BK-QTT-TNCN (Thông tư 89/2026)', () => {
		const exportsOf = (version: string) =>
			fixtureValue19(rows(version, 'rule_set').filter((row) => row.family === 'EXPORTS'));
		assert.deepEqual(
			VERSIONS.map((version) => exportsOf(version).map((row) => row.code)),
			[
				['SI_HI_UI_CHANGE_LIST'],
				['SI_HI_UI_CHANGE_LIST', 'PIT_FINALISATION_SCHEDULE'],
				['SI_HI_UI_CHANGE_LIST', 'PIT_FINALISATION_SCHEDULE'],
				['SI_HI_UI_CHANGE_LIST', 'PIT_FINALISATION_SCHEDULE']
			]
		);
		const v4 = fixturePresent(VERSIONS[VERSIONS.length - 1]);
		const d02 = exportsOf(v4).filter((row) => row.code === 'SI_HI_UI_CHANGE_LIST');
		const pit = exportsOf(v4).filter((row) => row.code === 'PIT_FINALISATION_SCHEDULE');
		const slip = (period: string, charges: Row) => ({
			period,
			status: 'PAID',
			gross: 0,
			net: 0,
			total_deductions: 0,
			lines: {},
			statutory: charges
		});
		const insured = (si: number) => ({
			SI: { employee: si, employer: 0, base: 22000000 },
			HI: { employee: 0, employer: 0, base: 22000000 },
			UI: { employee: 0, employer: 0, base: 22000000 }
		});
		const term = (from: string, to: string | null, base: number, extra: Row = {}) => ({
			effective_range: { from, to },
			base_salary: { currency: 'VND', value: base },
			job_title: 'Kế toán',
			residency_status: 'CITIZEN',
			employment_type: 'CONTRACT',
			...extra
		});
		const people = fixtureValue20([
			// Hired 10 July, the month charged: an increase from 07/2026 at 20,000,000 + 2,000,000 (meal excluded).
			{
				employee: {
					name: 'Nguyễn Văn An',
					date_of_birth: '1990-03-05',
					facts: { si_number: '0123456789', hi_registered_facility: 'Bệnh viện Bạch Mai' }
				},
				contract: {
					effective_range: { from: '2026-07-10', to: null },
					facts: {
						contract_terms: [
							term('2026-07-10', null, 20000000, {
								allowances: [
									{ code: 'RESPONSIBILITY', amount: { currency: 'VND', value: 2000000 } },
									{ code: 'MEAL_ALLOWANCE', amount: { currency: 'VND', value: 730000 } }
								],
								facts: { contract_type: 'FIXED' }
							})
						]
					}
				},
				slips: [slip('2026-07', insured(1760000))]
			},
			// A raise from 1 July and an exit on 20 July with the month not charged: the decrease is from 07/2026.
			{
				employee: { name: 'Trần Thị Bình', date_of_birth: '1985-12-01' },
				contract: {
					effective_range: { from: '2025-01-01', to: '2026-07-20' },
					facts: {
						contract_terms: [
							term('2025-01-01', '2026-06-30', 18000000, { employment_type: 'PERMANENT' }),
							term('2026-07-01', null, 25000000, { employment_type: 'PERMANENT' })
						]
					}
				},
				slips: [slip('2026-07', insured(0))]
			},
			// A pensioner hired in the month is outside compulsory SI: not listed.
			{
				employee: { name: 'Lê Văn Cường' },
				contract: {
					effective_range: { from: '2026-07-01', to: null },
					facts: {
						contract_terms: [
							term('2026-07-01', null, 10000000, { facts: { receiving_pension: true } })
						]
					}
				},
				slips: [slip('2026-07', insured(0))]
			}
		]);
		const [list] = recordDocuments(
			fixtureExports(d02),
			fixtureContexts([{ period: '2026-07' }]),
			fixtureReturnRows(people),
			fixtureContext({ facts: { vss_result_delivery: 'ELECTRONIC' } }),
			fixtureString('2026-08-03T02:00:00Z')
		);
		assert.equal(list?.name, 'D02-LT-2026-07.csv');
		const lines = fixturePresent(list).content.split('\n');
		assert.equal(
			lines[0],
			'STT,Họ và tên,Mã số BHXH,Ngày/ tháng/ năm sinh,"Chức vụ, chức danh nghề, nghề nghiệp, nơi làm việc",Hệ số lương/ Tiền lương,Hệ số chênh lệch bảo lưu,Phụ cấp chức vụ,Phụ cấp thâm niên VK (%),Phụ cấp thâm niên nghề (%),Các khoản phụ cấp lương và thu nhập bổ sung,Loại HĐLĐ: Không xác định thời hạn,Loại HĐLĐ: Xác định thời hạn,"Loại HĐLĐ: HĐ, thỏa thuận khác","Ngày Quyết định, HĐLĐ, HĐLV có hiệu lực",Từ tháng/ năm,Đến tháng/ năm,Nơi đăng ký KCB ban đầu,Hình thức nhận kết quả,"Loại tăng, giảm, điều chỉnh",Ghi chú'
		);
		assert.deepEqual(lines.slice(1), [
			'1,Nguyễn Văn An,0123456789,05/03/1990,Kế toán,20000000,,,,,2000000,,x,,10/07/2026,07/2026,,Bệnh viện Bạch Mai,Bản điện tử,Tăng lao động,',
			'2,Trần Thị Bình,,01/12/1985,Kế toán,25000000,,,,,0,x,,,01/07/2026,07/2026,,,Bản điện tử,Điều chỉnh tiền lương,',
			'2,Trần Thị Bình,,01/12/1985,Kế toán,25000000,,,,,0,x,,,,07/2026,,,Bản điện tử,Giảm lao động do nghỉ việc,Ngày chấm dứt HĐLĐ: 20/07/2026'
		]);
		// A hire on 20 July with the month not charged registers from 08/2026; a list made before 1 May 2026 is the old form.
		const [late] = recordDocuments(
			fixtureExports(d02),
			fixtureContexts([{ period: '2026-07' }]),
			fixtureReturnRows(
				fixtureValue20([
					{
						...fixturePresent(people[0]),
						contract: {
							...fixturePresent(people[0]).contract,
							effective_range: { from: '2026-07-10', to: null }
						},
						slips: [slip('2026-07', insured(0))]
					}
				])
			),
			fixtureContext({}),
			fixtureString('2026-08-03T02:00:00Z')
		);
		assert.equal(
			fixturePresent(fixturePresent(late).content.split('\n')[1]).split(',')[15],
			'08/2026'
		);
		assert.deepEqual(
			recordDocuments(
				fixtureExports(d02),
				fixtureContexts([{ period: '2026-04' }]),
				fixtureReturnRows(people),
				fixtureContext({}),
				fixtureString('2026-04-30T23:00:00Z')
			),
			[]
		);
		// VN-OBLIGATION-52: a month the SI rule did not charge, with the slip's leave, is a reduction for that month
		// (from and to the month), its reason by the class with the most days and every leave's dates in column 19.
		const staff = (name: string, leave: Row[], si: number) => ({
			employee: { name, date_of_birth: '1992-06-15' },
			contract: {
				effective_range: { from: '2024-01-01', to: null },
				facts: { contract_terms: [term('2024-01-01', null, 15000000)] }
			},
			slips: [{ ...slip('2026-07', insured(si)), leave }]
		});
		const away = (code: string, from: string, to: string, days: number) => ({
			code,
			from,
			to,
			days,
			facts: {}
		});
		const [suspended] = recordDocuments(
			fixtureExports(d02),
			fixtureContexts([{ period: '2026-07' }]),
			fixtureReturnRows(
				fixtureValue20([
					staff('Đỗ Thị Mai', [away('MATERNITY_LEAVE', '2026-06-20', '2026-12-19', 23)], 0),
					staff(
						'Vũ Văn Nam',
						[
							away('SICK_LEAVE', '2026-07-01', '2026-07-10', 8),
							away('UNPAID_LEAVE', '2026-07-13', '2026-07-31', 15)
						],
						0
					),
					// Leave of a suspending class but the month charged (under 14 working days): no row.
					staff('Phan Thu Trang', [away('UNPAID_LEAVE', '2026-07-01', '2026-07-03', 3)], 1200000),
					// Uncharged with annual leave only (not a suspending class): no row.
					staff('Ngô Minh Khoa', [away('ANNUAL_LEAVE', '2026-07-01', '2026-07-31', 23)], 0)
				])
			),
			fixtureContext({}),
			fixtureString('2026-08-03T02:00:00Z')
		);
		assert.deepEqual(fixturePresent(suspended).content.split('\n').slice(1), [
			'1,Đỗ Thị Mai,,15/06/1992,Kế toán,15000000,,,,,0,,x,,,07/2026,07/2026,,,Giảm do nghỉ thai sản,Nghỉ thai sản từ 20/06/2026 đến 19/12/2026',
			'2,Vũ Văn Nam,,15/06/1992,Kế toán,15000000,,,,,0,,x,,,07/2026,07/2026,,,Giảm do nghỉ không hưởng lương,Nghỉ ốm đau từ 01/07/2026 đến 10/07/2026; Nghỉ không hưởng lương từ 13/07/2026 đến 31/07/2026; BHYT tiếp tục đóng'
		]);
		// 05-1/BK-QTT-TNCN over a year's runs: an authorising employee with one dependant is finalised on the 2026 table.
		const pitSlip = (period: string, base: number, withheld: number) =>
			slip(period, {
				PIT: { employee: withheld, employer: 0, base },
				SI: { employee: 2400000, employer: 0, base: 30000000 },
				HI: { employee: 450000, employer: 0, base: 30000000 },
				UI: { employee: 300000, employer: 0, base: 30000000 }
			});
		const standing = (elections: Row) => ({
			employment_statutory_facts: [
				{
					statutory_contribution_id: 'pit',
					effective_range: { from: '2026-01-01', to: null },
					status: { kind: 'ENROLLED', elections }
				}
			]
		});
		const resident = { facts: { contract_terms: [term('2025-01-01', null, 30000000)] } };
		const year = [{ period: '2026-11' }, { period: '2026-12' }];
		const [schedule] = recordDocuments(
			fixtureExports(pit),
			fixtureContexts(year),
			fixtureReturnRows(
				fixtureValue20([
					{
						employee: {
							name: 'Phạm Minh Đức',
							identity_number: '001090012345',
							facts: standing({ finalisation_authorised: true, dependants: 1 })
						},
						contract: resident,
						slips: [pitSlip('2026-11', 200000000, 3650000), pitSlip('2026-12', 200000000, 3650000)]
					},
					{
						employee: { name: 'Hoàng Thu Hà', identity_number: '001190054321' },
						contract: resident,
						slips: [pitSlip('2026-11', 30000000, 0), pitSlip('2026-12', 30000000, 0)]
					},
					// A non-resident (20% flat) belongs on 05-2/BK-QTT-TNCN.
					{
						employee: { name: 'John Smith', identity_number: 'C1234567' },
						contract: {
							facts: {
								contract_terms: [
									term('2026-11-01', null, 50000000, { residency_status: 'NON_RESIDENT' })
								]
							}
						},
						slips: [pitSlip('2026-11', 50000000, 10000000)]
					}
				])
			)
		);
		assert.equal(schedule?.name, '05-1-BK-QTT-TNCN-2026.csv');
		const table = fixturePresent(schedule).content.split('\n');
		assert.equal(fixturePresent(table[0]).match(/\[\d{2}\]/g)?.length, 20);
		assert.match(
			fixturePresent(table[0]),
			/^\[06\] STT,\[07\] Họ và tên,\[08\] Mã số thuế,\[09\] Số ĐDCN\/Hộ chiếu,\[10\]/
		);
		// [16] = 15,500,000 × 12 + 6,200,000 × 12; [20] = 400,000,000 − 260,400,000 − 6,300,000 = 133,300,000;
		// [22] = 120,000,000 × 5% + 13,300,000 × 10% = 7,330,000; withheld 7,300,000 leaves 30,000: [25] ticked.
		assert.equal(
			table[1],
			'1,Phạm Minh Đức,,001090012345,x,,400000000,,,1,260400000,,6300000,0,133300000,7300000,7330000,0,30000,x'
		);
		// Not authorising: the deductions of the months paid, no finalisation columns.
		assert.equal(
			table[2],
			'2,Hoàng Thu Hà,,001190054321,,,60000000,,,0,31000000,,6300000,0,22700000,0,,,,'
		);
		assert.equal(table.length, 3);
		// Tax periods before 1 July 2026 keep the earlier forms (art.100(1)): no 2025 schedule, none across two years.
		assert.deepEqual(
			recordDocuments(
				fixtureExports(pit),
				fixtureContexts([{ period: '2025-12' }]),
				fixtureReturnRows([]),
				fixtureContext({})
			),
			[]
		);
		assert.deepEqual(
			recordDocuments(
				fixtureExports(pit),
				fixtureContexts([{ period: '2025-12' }, { period: '2026-01' }]),
				fixtureReturnRows([]),
				fixtureContext({})
			),
			[]
		);
		// The finalisation list is made only for a selection reaching the year end (a December run): a September run's
		// export carries no 05-1/BK-QTT-TNCN filled with that month alone; the January–December selection does.
		const ordinary = fixtureValue20([
			{
				employee: { name: 'Hoàng Thu Hà', identity_number: '001190054321' },
				contract: resident,
				slips: [pitSlip('2026-09', 30000000, 0)]
			}
		]);
		assert.deepEqual(
			recordDocuments(
				fixtureExports(pit),
				fixtureContexts([{ period: '2026-09' }]),
				fixtureReturnRows(ordinary)
			),
			[]
		);
		assert.deepEqual(
			recordDocuments(
				fixtureExports(pit),
				fixtureContexts([{ period: '2026-01' }, { period: '2026-09' }]),
				fixtureReturnRows(ordinary)
			),
			[]
		);
		const months = Array.from({ length: 12 }, (_, i) => ({
			period: `2026-${String(i + 1).padStart(2, '0')}`
		}));
		assert.equal(
			recordDocuments(fixtureExports(pit), fixtureContexts(months), fixtureReturnRows(ordinary))[0]
				?.name,
			'05-1-BK-QTT-TNCN-2026.csv'
		);
		assert.equal(
			recordDocuments(
				fixtureExports(pit),
				fixtureContexts([{ period: '2026-12' }]),
				fixtureReturnRows(ordinary)
			).length,
			1
		);
	});
	it('both input schemas are JSON Schema 2020-12 and declare every fact the CEL reads', () => {
		const TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);
		const valid = (node: unknown, where: string): void => {
			assert.ok(node != null && typeof node === 'object' && !Array.isArray(node), where);
			const schema = fixtureValue2(node);
			for (const type of [schema.type ?? []].flat())
				assert.ok(TYPES.has(String(type)), `${where}.type`);
			if (schema.enum !== undefined)
				assert.ok(Array.isArray(schema.enum) && schema.enum.length > 0, `${where}.enum`);
			if (schema.required !== undefined)
				assert.ok(Array.isArray(schema.required), `${where}.required`);
			if (schema.items !== undefined) valid(schema.items, `${where}.items`);
			if (schema.properties !== undefined)
				for (const [key, child] of Object.entries(fixtureValue2(schema.properties)))
					valid(child, `${where}.${key}`);
		};
		const CEL = new Set([
			'eligibility',
			'qualifies_when',
			'quantity',
			'rate',
			'amount',
			'when',
			'employee',
			'employer',
			'contribution',
			'assessment',
			'due',
			'days',
			'effect'
		]);
		for (const version of VERSIONS) {
			const row = settings(version);
			const employee = fixtureValue8(row.employee_input_schema);
			const entity = fixtureValue8(row.entity_input_schema);
			for (const [name, schema] of [
				['employee', employee],
				['entity', entity]
			] as const) {
				assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema', name);
				valid(schema, `${version} ${name}`);
			}
			// Labour Code art.95(2): wages are paid in VND.
			const term = fixtureValue21(employee.properties.contract_terms).items.properties;
			assert.equal(fixtureValue2(term.currency).const, 'VND');
			assert.equal(fixtureValue2(fixtureValue8(term.base_salary).properties.currency).const, 'VND');
			assert.deepEqual(Object.keys(employee.properties).toSorted(), [
				'contract_terms',
				'employment_statutory_facts',
				'exit_facts',
				'facts'
			]);
			const status = fixtureValue8(
				fixtureRecord(employee.properties.employment_statutory_facts).items
			).properties;
			assert.deepEqual(Object.keys(status).toSorted(), [
				'effective_range',
				'status',
				'statutory_contribution_id'
			]);
			for (const column of ['region', 'risk_class', 'gender', 'nationality'])
				assert.equal(
					column in entity.properties ||
						column in fixtureValue8(employee.properties.facts).properties,
					false,
					column
				);
			const props = (schema: unknown) =>
				new Set(Object.keys(fixtureValue2(fixtureRecord(schema ?? {}).properties ?? {})));
			const declared = {
				employee: props(employee.properties.facts),
				company: props(entity),
				terms: props(fixtureValue2(employee.properties.contract_terms).items),
				term_facts: props(
					fixtureValue8(fixtureRecord(employee.properties.contract_terms).items).properties.facts
				),
				exit: props(employee.properties.exit_facts),
				elections: props(fixtureValue8(status.status).properties.elections)
			};
			const expressions: string[] = [];
			const walk = (value: unknown, key = ''): void => {
				if (typeof value === 'string') {
					if (CEL.has(key)) expressions.push(value);
				} else if (Array.isArray(value)) value.forEach((item) => walk(item, key));
				else if (value != null && typeof value === 'object')
					for (const [child, item] of Object.entries(value))
						walk(item, key === 'assessable' || key === 'person' ? 'when' : child);
			};
			for (const file of FILES) walk(rows(version, file));
			assert.ok(
				expressions.some((expression) => expression.includes('company.facts.')),
				version
			);
			assert.ok(
				expressions.some((expression) => expression.includes('scheme.elections.')),
				version
			);
			for (const expression of expressions) {
				for (const [, root, fact] of expression.matchAll(
					/\b(employee|company)\.facts\.([a-z0-9_]+)/g
				))
					assert.ok(
						declared[fixtureValue22(root)].has(String(fact)),
						`${version} ${root}.facts.${fact}`
					);
				for (const [, fact] of expression.matchAll(
					/\b(?:scheme\.elections|elections\.[A-Z_]+)\.([a-z_]+)/g
				))
					assert.ok(declared.elections.has(String(fact)), `${version} elections.${fact}`);
				for (const [, fact] of expression.matchAll(/\bterms\.facts\.([a-z_]+)/g))
					assert.ok(declared.term_facts.has(String(fact)), `${version} terms.facts.${fact}`);
				for (const [, fact] of expression.matchAll(
					/\b(?:contract|employment)\.exit_facts\.([a-z_]+)/g
				))
					assert.ok(declared.exit.has(String(fact)), `${version} exit_facts.${fact}`);
				for (const [, fact] of expression.matchAll(/\bterms\.(?!facts\.)([a-z_]+)/g))
					assert.ok(
						declared.terms.has(String(fact)) ||
							['monthly_wage', 'allowances', 'effective_from', 'effective_to'].includes(
								String(fact)
							),
						`${version} terms.${fact}`
					);
			}
		}
	});
});
