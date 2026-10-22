import { modelFields as kitModelFields } from './jurisdiction_kit.js';
import canonicalLeave from '../src/data/model/+leave_catalog.model.js';
import canonicalContribution from '../src/data/model/+statutory_contribution_catalog.model.js';
import { inputSchema } from '@norbital-ai/std/kind';
import type { StatutoryConfiguration } from '../src/lib/payroll_engine/payslip/context.js';
import { Schema as FixtureSchema } from 'effect';
import { fixtureId, nativeId } from './fixture_values.js';
import { refuse } from '../src/lib/payroll_engine/foundation.js';
import { citationText, world, type Tables } from './jurisdiction_kit.js';
import { lineage as jurisdiction } from './jurisdiction_kit.js';
import { readSeedRows } from './seed_values.js';
import { workspace } from './kit.js';
const LAW_KIT = jurisdiction('ID');
/** ID public lineage: version structure, input schemas, obligations, CEL on the engine context and the statutory amounts in force. */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, layer } from '@effect/vitest';
import { Effect, Schema } from 'effect';
import { Behaviours, effectWrites, planBehaviours } from '../src/lib/payroll_engine/behaviours.js';
import { dutiesOf, raiseDuties, triggerOf, withBalances } from './duties.ts';
// strict: a record expression failing inside `configured_eval`, even where CEL absorbs it, fails the suite
import { evaluateStrict as evaluateConfigured } from '../src/lib/payroll_engine/expressions.js';
import { runEngine } from '../src/lib/payroll_engine/foundation.js';
import { planRosterImport } from '../src/lib/payroll_engine/roster_import.js';
import type { SheetRecord } from '../src/lib/payroll_engine/roster_sheet.js';
import { leaveBalances, movementFromRow } from '../src/lib/payroll_engine/leave.js';
import { type PayrollRunKind } from '../src/lib/payroll_engine/payslip/context.js';
import { recordDocuments } from '../src/lib/payroll_engine/export.js';
import { bankRow } from '../seed/seed.ts';
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
const fixtureRecords = guardFixture(
	FixtureSchema.mutable(
		FixtureSchema.Array(
			FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))
		)
	)
);
const fixtureBoolean = guardFixture(FixtureSchema.Boolean);
const fixtureString = guardFixture(FixtureSchema.String);
const fixtureNumber = guardFixture(FixtureSchema.Number);
const fixtureKey = (value: unknown): string => fixtureId(fixtureString(value));
const fixtureContext = guardFixture(FixtureSchema.Record(FixtureSchema.String, FixtureSchema.Json));
const fixtureSheet = guardFixture(
	FixtureSchema.Array(
		FixtureSchema.StructWithRest(
			FixtureSchema.Struct({
				row: FixtureSchema.Number,
				employee_number: FixtureSchema.String,
				work_date: FixtureSchema.String,
				shift_code: FixtureSchema.optionalKey(FixtureSchema.String),
				clock_in: FixtureSchema.optionalKey(FixtureSchema.String),
				clock_out: FixtureSchema.optionalKey(FixtureSchema.String),
				overtime_hours: FixtureSchema.optionalKey(FixtureSchema.Number),
				overtime_consent: FixtureSchema.optionalKey(FixtureSchema.String),
				banked_overtime_hours: FixtureSchema.optionalKey(FixtureSchema.Number),
				incentive_hours: FixtureSchema.optionalKey(FixtureSchema.Number),
				leave_code: FixtureSchema.optionalKey(FixtureSchema.String),
				name: FixtureSchema.optionalKey(FixtureSchema.String),
				holiday: FixtureSchema.optionalKey(FixtureSchema.String)
			}),
			[FixtureSchema.Record(FixtureSchema.String, FixtureSchema.Unknown)]
		)
	)
);
const fixtureLinks = new Set([
	'employee_id',
	'company_id',
	'catalog_id',
	'loan_id',
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
const fixtureEntitlement = guardFixture(EntitlementFixture);
const entitlementOf = (row: Row) => fixturePresent(fixtureEntitlement(row.entitlement));
const bandsOf = (row: Row) =>
	guardFixture(
		Schema.Array(
			Schema.StructWithRest(
				Schema.Struct({
					when: Schema.optionalKey(Schema.String),
					amount: Schema.optionalKey(Schema.String),
					limit: Schema.optionalKey(
						Schema.StructWithRest(Schema.Struct({ amount: Schema.String }), [
							Schema.Record(Schema.String, Schema.Json)
						])
					)
				}),
				[Schema.Record(Schema.String, Schema.Json)]
			)
		)
	)(row.bands ?? []);
const assessmentResult = guardFixture(
	Schema.Struct({
		employee: Schema.Number,
		employer: Schema.Number,
		parts: Schema.Record(Schema.String, Schema.Number)
	})
);
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
	FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))
);
const fixtureValue1 = guardFixture(FixtureSchema.String);
const fixtureValue2 = guardFixture(
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
const fixtureValue3 = guardFixture(
	FixtureSchema.mutable(
		FixtureSchema.Array(
			FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))
		)
	)
);
const fixtureValue4 = guardFixture(
	FixtureSchema.mutable(FixtureSchema.Array(FixtureSchema.String))
);
const fixtureValue5 = guardFixture(
	FixtureSchema.mutable(
		FixtureSchema.Array(
			FixtureSchema.StructWithRest(
				FixtureSchema.Struct({ decree: FixtureSchema.mutableKey(FixtureSchema.String) }),
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
const fixtureValue6 = guardFixture(
	FixtureSchema.StructWithRest(
		FixtureSchema.Struct({
			kinds: FixtureSchema.mutableKey(
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
			)
		}),
		[FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))]
	)
);
type Row = Record<string, unknown>;
const lineages = resolve(process.cwd(), 'seed/jurisdiction');
const CATALOGS = [
	'adhoc_catalog',
	'allowance_catalog',
	'claim_catalog',
	'leave_catalog',
	'loan_catalog',
	'rule_set',
	'statutory_contribution_catalog',
	'work_catalog'
] as const;
const versions = LAW_KIT.versions;
const read = (version: string, table: string) =>
	LAW_KIT.rows(version, table).map((row) => Object.assign({}, row, { id: fixtureString(row.id) }));
const schemaProperties = (value: unknown) =>
	Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Json))(
		fixtureRecord(value).properties
	);
const schemaItems = (value: unknown) => fixtureRecord(fixtureRecord(value).items);
const schemaEnum = (value: unknown) => fixtureValue4(fixtureRecord(value).enum);
const InputObjectSchema = Schema.StructWithRest(
	Schema.Struct({
		$schema: Schema.String,
		type: Schema.String,
		properties: Schema.Record(Schema.String, Schema.Json)
	}),
	[Schema.Record(Schema.String, Schema.Json)]
);
const settingsOf = (version: string) => {
	const row = LAW_KIT.settingsOf(version);
	return Object.assign({}, row, {
		id: fixtureString(row.id),
		behaviours: guardFixture(Behaviours)(row.behaviours),
		effective_range: Schema.decodeUnknownSync(
			Schema.Struct({ from: Schema.String, to: Schema.NullOr(Schema.String) })
		)(row.effective_range),
		employee_input_schema: guardFixture(InputObjectSchema)(row.employee_input_schema),
		entity_input_schema: guardFixture(InputObjectSchema)(row.entity_input_schema)
	});
};
const contributionShape = inputSchema(canonicalContribution.fields.configuration.shape);
const ContributionConfiguration = Schema.declare<StatutoryConfiguration>(
	(value): value is StatutoryConfiguration => Schema.is(contributionShape)(value)
);
const dutyRules = guardFixture(
	Schema.StructWithRest(
		Schema.Struct({
			description: Schema.String,
			due: Schema.String,
			months: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.String))),
			when: Schema.optionalKey(Schema.NullOr(Schema.String)),
			applies_when: Schema.optionalKey(Schema.NullOr(Schema.String)),
			schemes: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.String)))
		}),
		[Schema.Record(Schema.String, Schema.Json)]
	)
);
const minimumWage = guardFixture(
	Schema.StructWithRest(
		Schema.Struct({
			by_region: Schema.Record(Schema.String, Schema.Number),
			by_sector: Schema.Record(
				Schema.String,
				Schema.Array(
					Schema.StructWithRest(
						Schema.Struct({
							kbli: Schema.String,
							monthly: Schema.Number,
							condition: Schema.optionalKey(Schema.String)
						}),
						[Schema.Record(Schema.String, Schema.Json)]
					)
				)
			)
		}),
		[Schema.Record(Schema.String, Schema.Json)]
	)
);
it('Sumut decree 909/2025: eleven completed annexes enforce their exact KBLI floors', () => {
	const annexes: Record<string, Record<string, number>> = {
		'Kabupaten Deli Serdang': {
			'01461': 4122373,
			'01462': 4122373,
			'01262': 4243619,
			'10437': 4203703,
			'11040': 4122373,
			'10710': 4122373,
			'10740': 4122373,
			'11051': 4122373,
			'16101': 4162789,
			'16221': 4070050,
			'20119': 4243619,
			'23952': 4122373,
			'22112': 4162789,
			'22123': 4122373,
			'22192': 4122373,
			'22299': 4122373,
			'22230': 4162789,
			'24102': 4122373,
			'24103': 4162789,
			'10801': 4122373,
			'31001': 4162789,
			'17022': 4162789,
			'27113': 4243619,
			'27409': 4122072,
			'22194': 4122373,
			'20231': 4243619,
			'22220': 4162789,
			'10434': 4162789,
			'20115': 4162789,
			'10611': 4162789,
			'23953': 4122373,
			'31009': 4122373,
			'16102': 4203204,
			'24203': 4203204,
			'25120': 4203703,
			'21012': 4278216,
			'23990': 4278216,
			'20114': 4278216,
			'16299': 4070050,
			'25111': 4278216,
			'25119': 4278216,
			'22199': 4278216,
			'41011': 4162789,
			'41012': 4162789,
			'41013': 4243619,
			'41017': 4243619,
			'47111': 4122373,
			'46633': 4122373,
			'46631': 4278216,
			'46900': 4278216,
			'46441': 4278216,
			'52101': 4162789,
			'55110': 4081556,
			'64121': 4243619,
			'64122': 4243619
		},
		'Kabupaten Tapanuli Selatan': {
			'01262': 3621881,
			'07301': 3723350,
			'10433': 3624353,
			'22123': 3623714
		},
		'Kabupaten Labuhanbatu': { '01262': 3839000, '10431': 3839000, '22123': 3753181 },
		'Kabupaten Asahan': {
			'01262': 3791847.19,
			'01291': 3601988.45,
			'10433': 3791847.19,
			'10437': 3791847.19,
			'22123': 3601988.45
		},
		'Kabupaten Simalungun': {
			'01262': 3451945,
			'01291': 3451945,
			'01270': 3451945,
			'10433': 3451945,
			'10437': 3451945,
			'22123': 3451945,
			'10763': 3451945,
			'10213': 3451945
		},
		'Kabupaten Langkat': {
			'01262': 3597624,
			'01291': 3426183,
			'10433': 3597624,
			'10437': 3597624,
			'10411': 3597624,
			'10431': 3597624,
			'10434': 3597624,
			'23957': 3520869,
			'64121': 3520869,
			'64122': 3520869
		},
		'Kabupaten Serdang Bedagai': { '01262': 3804951, '10433': 3804951 },
		'Kabupaten Batu Bara': { '01262': 4120000 },
		'Kabupaten Labuhanbatu Selatan': { '01262': 3745000, '01291': 3745000, '10431': 3745000 },
		'Kabupaten Labuhanbatu Utara': {
			'01262': 3718724,
			'01291': 3639449,
			'10431': 3718724,
			'22123': 3639449
		},
		'Kabupaten Mandailing Natal': { '01262': 3400862 }
	};
	for (const version of ['version_2', 'version_3']) {
		const rows = read(version, 'rule_set');
		const wage = minimumWage(fixturePresent(rows.find((row) => row.code === 'minimum_wage')).rules);
		const check = fixtureRecord(
			fixturePresent(rows.find((row) => row.code === 'SECTOR_MINIMUM_WAGE')).rules
		).when;
		for (const [locality, table] of Object.entries(annexes)) {
			const region = `Provinsi Sumatera Utara/${locality}`;
			assert.deepEqual(
				Object.fromEntries(
					fixturePresent(wage.by_sector[region]).map((row: { kbli: string; monthly: number }) => [
						row.kbli,
						row.monthly
					])
				),
				table
			);
			for (const [kbli, floor] of Object.entries(table)) {
				const below = (monthly_wage: number) => {
					const term = {
						employment_type: 'PERMANENT',
						monthly_wage,
						facts: { worksite_kbli: kbli }
					};
					return evaluateConfigured(
						fixtureString(check),
						fixtureContext({
							...subject({ company: { region }, terms: term, employment: { service_months: 0 } }),
							term,
							rules: { minimum_wage: wage }
						})
					);
				};
				assert.equal(below(floor - 0.01), true, `${version}:${region}:${kbli}`);
				assert.equal(below(floor), false, `${version}:${region}:${kbli}`);
			}
		}
	}
});
it('Medan annex XI: every sector floor and KBLI 2015 hotel/bank scope survives conversion', () => {
	const table: Record<string, number> = {
		'10130': 4421737,
		'10221': 4378185,
		'10239': 4465254,
		'10431': 4421902,
		'10437': 4421777,
		'10710': 4421777,
		'10732': 4421777,
		'10740': 4465162,
		'10750': 4551958,
		'10801': 4421737,
		'11010': 4595208,
		'11040': 4421777,
		'18111': 4421777,
		'20119': 4508451,
		'20221': 4508451,
		'20231': 4465128,
		'20291': 4439215,
		'22112': 4465090,
		'22220': 4498998,
		'22299': 4421902,
		'23951': 4498998,
		'24102': 4421777,
		'24310': 4421777,
		'24320': 4421777,
		'25952': 4421777,
		'25993': 4378392,
		'27120': 4464730,
		'27320': 4377326,
		'27330': 4377326,
		'27401': 4378185,
		'28111': 4498998,
		'29200': 4551830,
		'29300': 4439215,
		'31001': 4421777,
		'31002': 4378392,
		'31003': 4421902,
		'31009': 4378392,
		'35302': 4508451,
		'41012': 4508519,
		'42111': 4508519,
		'45101': 4507810,
		'45103': 4421902,
		'45301': 4507810,
		'45302': 4421902,
		'45401': 4508606,
		'45403': 4421902,
		'45405': 4508606,
		'45406': 4421902,
		'45407': 4508606,
		'46593': 4508606,
		'46599': 4508606,
		'46900': 4439215,
		'47301': 4439215,
		'47111': 4498998,
		'49431': 4464878,
		'49432': 4464878,
		'52101': 4465072,
		'52240': 4508606,
		'56101': 4508451,
		'61100': 4508451,
		'61200': 4508451,
		'61300': 4508451,
		'65111': 4508451,
		'66160': 4508606,
		'66420': 4508606,
		'86103': 4508451
	};
	for (const version of ['version_2', 'version_3']) {
		const rows = read(version, 'rule_set');
		const wage = minimumWage(fixturePresent(rows.find((row) => row.code === 'minimum_wage')).rules);
		const region = 'Provinsi Sumatera Utara/Kota Medan';
		const entries = fixturePresent(wage.by_sector[region]);
		assert.equal(entries.length, 71);
		assert.deepEqual(
			Object.fromEntries(
				entries.filter((r: Row) => r.condition === '').map((r: Row) => [r.kbli, r.monthly])
			),
			table
		);
		const check = (code: string, kbli: string, monthly_wage: number, facts: Row = {}) => {
			const term = { employment_type: 'PERMANENT', monthly_wage, facts: { worksite_kbli: kbli } };
			return evaluateConfigured(
				fixtureString(fixtureRecord(fixturePresent(rows.find((r) => r.code === code)).rules).when),
				fixtureContext({
					...subject({
						company: { region, facts },
						terms: term,
						employment: { service_months: 0 }
					}),
					term,
					rules: { minimum_wage: wage }
				})
			);
		};
		for (const [kbli, floor] of Object.entries(table)) {
			assert.equal(check('SECTOR_MINIMUM_WAGE', kbli, floor - 0.01), true, `${version}:${kbli}`);
			assert.equal(check('SECTOR_MINIMUM_WAGE', kbli, floor), false, `${version}:${kbli}`);
		}
		for (const [stars, floor] of [
			[3, 4464878],
			[4, 4465076],
			[5, 4465072]
		] satisfies [number, number][]) {
			assert.equal(
				check('SECTOR_MINIMUM_WAGE', '55110', floor - 0.01, { umsp_hotel_star: stars }),
				true
			);
			assert.equal(check('SECTOR_MINIMUM_WAGE', '55110', floor, { umsp_hotel_star: stars }), false);
			assert.equal(
				check('MEDAN_SECTOR_SCOPE_MISSING', '55110', floor, { umsp_hotel_star: stars }),
				false
			);
		}
		for (const stars of [1, 2])
			assert.equal(check('SECTOR_MINIMUM_WAGE', '55110', 1, { umsp_hotel_star: stars }), false);
		assert.equal(check('MEDAN_SECTOR_SCOPE_MISSING', '55110', 4500000), true);
		assert.equal(
			check('MEDAN_SECTOR_SCOPE_MISSING', '55110', 4500000, { umsp_hotel_star: 0 }),
			true
		);
		for (const [kbli, category] of [
			['64121', 'PRIVATE_CONVENTIONAL_FOREX'],
			['64122', 'SYARIAH_FOREX']
		] satisfies [string, string][]) {
			assert.equal(
				check('SECTOR_MINIMUM_WAGE', kbli, 4508450.99, { umsp_bank_category: category }),
				true
			);
			assert.equal(
				check('SECTOR_MINIMUM_WAGE', kbli, 4508451, { umsp_bank_category: category }),
				false
			);
			assert.equal(check('SECTOR_MINIMUM_WAGE', kbli, 1, { umsp_bank_category: 'OTHER' }), false);
			assert.equal(check('MEDAN_SECTOR_SCOPE_MISSING', kbli, 4508451), true);
			assert.equal(
				check('MEDAN_SECTOR_SCOPE_MISSING', kbli, 4508451, { umsp_bank_category: 'OTHER' }),
				false
			);
			assert.equal(
				check('MEDAN_SECTOR_SCOPE_MISSING', kbli, 4508451, {
					umsp_bank_category:
						category === 'SYARIAH_FOREX' ? 'PRIVATE_CONVENTIONAL_FOREX' : 'SYARIAH_FOREX'
				}),
				true
			);
			assert.equal(
				check('MEDAN_SECTOR_SCOPE_MISSING', kbli, 4508451, { umsp_bank_category: category }),
				false
			);
		}
		assert.equal(
			check('SECTOR_MINIMUM_WAGE', '64131', 1, { umsp_bank_category: 'SYARIAH_FOREX' }),
			false
		);
		assert.equal(check('MEDAN_SECTOR_SCOPE_MISSING', '10431', 4421902), false);
	}
});
it('PER.02/MEN/1980: pre-employment examination exemption and two-calendar-month report', () => {
	for (const version of versions) {
		const settings = settingsOf(version);
		const rows = read(version, 'rule_set');
		const hire = rows.find((row) => row.code === 'PRE_EMPLOYMENT_HEALTH_EXAMINATION');
		assert.ok(hire, version);
		const required = (facts: Row, range: Row = { from: '2026-03-01', to: null }) =>
			raiseDuties({
				behaviours: settings.behaviours,
				settings_id: settings.id,
				rows,
				collection: 'employment_contract',
				event: 'created',
				row: {
					id: 'e1',
					company_id: 'c1',
					effective_range: { from: '2026-03-01', to: null },
					facts: {
						contract_terms: [
							{
								effective_range: range,
								employment_type: 'PERMANENT',
								facts
							}
						]
					}
				}
			}).some((write) => write.duty_code === 'PRE_EMPLOYMENT_HEALTH_EXAMINATION');
		assert.equal(required({}), true);
		const accepted = { pre_employment_exam_on: '2026-02-01', pre_employment_exam_accepted: true };
		assert.equal(required(accepted, { from: '2026-03-01' }), false);
		assert.equal(required(accepted, { from: '2026-04-01', to: null }), true);
		assert.equal(required(accepted, { from: '2025-12-01', to: '2026-02-28' }), true);
		assert.equal(
			required({ pre_employment_exam_on: '2025-12-01', pre_employment_exam_accepted: true }),
			false
		);
		assert.equal(
			required({ pre_employment_exam_on: '2025-11-30', pre_employment_exam_accepted: true }),
			true
		);
		assert.equal(
			required({ pre_employment_exam_on: '2026-03-02', pre_employment_exam_accepted: true }),
			true
		);
		assert.equal(
			required({ pre_employment_exam_on: '2026-02-28', pre_employment_exam_accepted: false }),
			true
		);
		const kinds = fixtureValue6(
			fixturePresent(rows.find((row) => row.code === 'case_kinds')).rules
		).kinds.map((kind) => kind.code);
		assert.ok(kinds.includes('WORKER_HEALTH_EXAMINATION_COMPLETED'));
		const completed = (kind: string, opened_on: string) =>
			raiseDuties({
				behaviours: settings.behaviours,
				settings_id: settings.id,
				rows,
				collection: 'workplace_case',
				event: 'created',
				day: opened_on,
				row: { id: 'exam1', company_id: 'c1', kind, opened_on }
			}).map((write) => [write.duty_code, write.due_on]);
		assert.deepEqual(completed('WORKER_HEALTH_EXAMINATION_COMPLETED', '2026-12-31'), [
			['WORKER_HEALTH_EXAMINATION_REPORT', '2027-02-28']
		]);
		assert.deepEqual(completed('WORKER_HEALTH_EXAMINATION_COMPLETED', '2028-12-31'), [
			['WORKER_HEALTH_EXAMINATION_REPORT', '2029-02-28']
		]);
		assert.deepEqual(completed('PERSONAL_DATA_BREACH', '2026-03-01'), [
			['PDP_BREACH_NOTICE', '2026-03-04']
		]);
	}
});
const scheme = (version: string, code: string) => {
	const row = fixturePresent(
		read(version, 'statutory_contribution_catalog').find((row) => row.code === code)
	);
	return Object.assign({}, row, {
		code: fixtureString(row.code),
		configuration: Schema.decodeUnknownSync(ContributionConfiguration)(row.configuration)
	});
};
const catalog = (version: string, table: string, code: string) =>
	fixturePresent(read(version, table).find((row) => row.code === code));
/** Every duty row, its trigger named by lifecycle. */
const obligations = (version: string) =>
	dutiesOf(read(version, 'rule_set')).map((row) =>
		Object.assign({}, row, {
			code: fixtureString(row.code),
			rules: { ...dutyRules(row.rules), trigger: triggerOf(row) }
		})
	);
const payrollRules = (version: string) => {
	const rows = Object.fromEntries(
		read(version, 'rule_set')
			.filter((row) => row.family === 'PAYROLL')
			.map((row): [string, Schema.Json] => [
				fixtureString(row.code),
				guardFixture(Schema.Json)(row.rules)
			])
	);
	return Object.assign({}, rows, {
		minimum_wage: minimumWage(rows.minimum_wage),
		public_holidays: guardFixture(
			Schema.StructWithRest(
				Schema.Struct({
					holidays: Schema.Array(
						Schema.StructWithRest(
							Schema.Struct({ date: Schema.String, name: Schema.String, kind: Schema.String }),
							[Schema.Record(Schema.String, Schema.Json)]
						)
					)
				}),
				[Schema.Record(Schema.String, Schema.Json)]
			)
		)(rows.public_holidays)
	});
};
const modelFields = kitModelFields;
const nextDay = (day: string): string => {
	const date = new Date(`${day}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() + 1);
	return date.toISOString().slice(0, 10);
};
// ── The subject `subjectContext` builds (services.ts), with the facts the ID records read. ─────────────────────
const subject = (
	over: {
		employee?: Row;
		company?: Row;
		terms?: Row;
		employment?: Row;
	} = {}
) => {
	const employment = {
		classification: 'ORDINARY',
		service_months: 40,
		exit_date: '',
		start_date: '2022-08-01',
		exit_ground: '',
		exit_facts: {},
		...over.employment
	};
	// PTKP dependants are a dated contract-term fact (`terms.facts.dependents_count`), not a profile column.
	const { dependents_count = 1, ...person }: Row = over.employee ?? {};
	const held = {
		work_classification: 'ORDINARY',
		statutory_work_category: 'NON_MANUAL',
		employment_type: 'PERMANENT',
		residency_status: 'CITIZEN',
		residency_since: '',
		facts: { working_days_per_week: 5 },
		base_salary: 8000000,
		monthly_wage: 8000000,
		effective_from: '',
		effective_to: '',
		allowances: [],
		...over.terms
	};
	const dependants = FixtureSchema.is(FixtureSchema.Number)(dependents_count)
		? dependents_count
		: 1;
	const terms = { ...held, facts: { dependents_count: dependants, ...held.facts } };
	return {
		employee: {
			gender: 'MALE',
			marital_status: 'MARRIED',
			nationality: 'ID',
			date_of_birth: '1990-05-01',
			age: 35,
			children: [],
			facts: {},
			...person
		},
		company: {
			region: 'Provinsi DKI Jakarta',
			risk_class: 'II',
			pay_frequency: 'MONTHLY',
			facts: { leave_cash_out_day_divisor: 25, leave_cash_out_wage_basis: 'BASIC' },
			...over.company
		},
		terms,
		employment,
		person: {
			employment,
			nationality: 'ID',
			residency_status: terms.residency_status,
			residency_since: null
		}
	};
};
const SCHEMES = [
	'JHT',
	'JP',
	'JKK',
	'JKM',
	'KESEHATAN',
	'JKP',
	'PPH21',
	'PPH21_DTP',
	'PPH21_FINAL_SEVERANCE',
	'PPH21_FINAL_PENSION',
	'PPH26',
	'DKPTKA'
];
/** `charged.month` / `charged.year`: every scheme at zero unless given. */
const chargedOf = (given: Row = {}) =>
	Object.fromEntries(
		SCHEMES.map((code) => [code, { employee: 0, employer: 0, ...fixtureRecord(given[code] ?? {}) }])
	);
/**
 * One scheme's month charge exactly as `assessStatutory` evaluates it: person facts, assessable parts, the guards
 * and the first matching rule. `wage` is the month's raw parts; `year` the earlier months' stored parts; `charged`
 * the schemes' charges (`month` so far, earlier `year`); `elections` this scheme's declared elections.
 */
const assess = (
	row: Row,
	wage: Row,
	options: {
		subject?: ReturnType<typeof subject> & {
			readonly headcount?: number;
			readonly earned?: { readonly months: readonly Row[]; readonly history?: readonly Row[] };
		};
		period?: string;
		year?: Row;
		charged?: {
			month?: Row;
			year?: Row;
		};
		elections?: Row;
		version?: string;
		rules?: ReturnType<typeof payrollRules>;
	} = {}
):
	| {
			employee: number;
			employer: number;
			parts: Row;
	  }
	| 'REFUSED'
	| null => {
	const base = options.subject ?? subject();
	const key = options.period ?? '2026-03';
	const to = new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)), 0))
		.toISOString()
		.slice(0, 10);
	const configuration = Schema.decodeUnknownSync(ContributionConfiguration)(row.configuration);
	const code = fixtureString(row.code);
	const parts = new Set([
		'ordinary',
		...Object.keys(wage),
		...Object.keys(configuration.assessable ?? {})
	]);
	const month = Object.fromEntries([...parts].map((part) => [part, wage[part] ?? 0]));
	const year = Object.fromEntries([...parts].map((part) => [part, options.year?.[part] ?? 0]));
	let context: Row = {
		// The engine always hands `earned`; a subject may bring its own months.
		earned: { months: [], history: [] },
		// A standalone assessment models this one employment; discount scenarios supply their actual count.
		headcount: 1,
		...base,
		wage: month,
		month,
		year,
		rules: options.rules ?? payrollRules(options.version ?? 'version_3'),
		charged: { month: chargedOf(options.charged?.month), year: chargedOf(options.charged?.year) },
		elections: { [code]: options.elections ?? {} },
		scheme: { code, standing: 'REGISTERED', elections: options.elections ?? {} },
		period: {
			key,
			from: `${key}-01`,
			to,
			days: Number(to.slice(8)),
			month: Number(key.slice(5)),
			salary_paid: false,
			// A standalone assessment is the month's salary slip: no regular pay is still pending.
			salary_run: true
		}
	};
	const person: Row = {};
	for (const [fact, expression] of Object.entries(configuration.person ?? {}))
		person[fact] = evaluateConfigured(
			fixtureString(fixtureValue1(expression)),
			fixtureContext(context)
		);
	context = { ...context, person: { ...base.person, ...person } };
	const assessed: Row = {};
	for (const part of parts) {
		const expression = configuration.assessable?.[part];
		assessed[part] = Math.max(
			0,
			expression == null
				? Number(month[part])
				: Number(evaluateConfigured(fixtureString(expression), fixtureContext(context)))
		);
	}
	const total = Object.values(assessed).reduce((sum: number, value) => sum + Number(value), 0);
	context = { ...context, base: { ...assessed, assessed: total, amount: total } };
	for (const guard of configuration.refuse_when ?? [])
		if (evaluateConfigured(fixtureString(guard.when), fixtureContext(context)) === true)
			return 'REFUSED';
	for (const rule of configuration.rules ?? []) {
		if (
			rule.when != null &&
			evaluateConfigured(fixtureString(rule.when), fixtureContext(context)) !== true
		)
			continue;
		return {
			employee:
				rule.employee == null
					? 0
					: Number(evaluateConfigured(fixtureString(rule.employee), fixtureContext(context))),
			employer:
				rule.employer == null
					? 0
					: Number(evaluateConfigured(fixtureString(rule.employer), fixtureContext(context))),
			parts: assessed
		};
	}
	return null;
};
/** One `work.days[]` entry as `workDay` (services.ts) builds it. */
const day = (over: Row = {}) => ({
	date: '2026-03-09',
	day_type: 'WORK',
	shift_code: 'D8',
	holiday_kind: '',
	scheduled_hours: 8,
	worked_hours: 8,
	overtime_hours: 0,
	banked_hours: 0,
	incentive_hours: 0,
	intervals: [],
	...over
});
/** One `leave.rows[]` entry as the payslip projects it. */
const leaveRow = (over: Row = {}) => ({
	code: 'ANNUAL_LEAVE',
	activity: 'TIME_OFF',
	days: 1,
	from: '2026-03-02',
	to: '2026-03-02',
	is_npl: false,
	can_encash: false,
	event_id: '',
	month_index: 1,
	facts: {},
	pay_fraction: 1,
	...over
});
// The payslip context `buildPayslip` builds.
const period = {
	key: '2026-03',
	from: '2026-03-01',
	to: '2026-03-31',
	days: 31,
	paid_days: 31,
	part: 1,
	parts: 1,
	month_days: 31
};
const payslipOf = (over: Parameters<typeof subject>[0] = {}, version = 'version_3') => ({
	...subject(over),
	// This standalone pay scenario has no earlier payslips.
	earned: { months: [], history: [] },
	rules: payrollRules(version),
	period,
	work: {
		overtime_hours: 2,
		incentive_hours: 0,
		dates: ['2026-03-09'],
		holidays: [],
		// One ordinary working day with 2 approved overtime hours.
		days: [day({ overtime_hours: 2 })]
	},
	leave: {
		rows: [
			leaveRow({ code: 'ANNUAL_LEAVE', activity: 'ENCASHMENT', days: 2, can_encash: true }),
			leaveRow({ code: 'UNPAID_LEAVE', days: 1, is_npl: true })
		]
	}
});
const entry = (facts: Row = {}) => ({
	amount: 500000,
	quantity: 1,
	occurred_on: '2026-03-02',
	due_on: '2026-03-02',
	incurred_on: '2026-03-02',
	...facts,
	facts
});
const EXIT_FACTS = {
	termination_cause: 'EFFICIENCY_ACTUAL_LOSS',
	separation_wage_basis: 'MONTHLY',
	separation_daily_wage: 0,
	output_average_12m: 0,
	micro_small_enterprise: false,
	agreed_pesangon_amount: 0,
	agreed_upmk_amount: 0,
	agreed_pkwt_compensation_amount: 0,
	separation_pay_amount: 7000000,
	pension_offset_applies: true,
	employer_funded_pension_benefit: 5000000
};
/** Every CEL a version's rows carry, with where it sits. */
const celOf = (version: string): string[] => {
	const out: string[] = [];
	const walk = (value: unknown, key = ''): void => {
		if (typeof value === 'string') {
			if (
				/^(when|employee|employer|eligibility|qualifies_when|quantity|rate|amount|due|assessment|days|pay_fraction)$/.test(
					key
				) ||
				/[.(]/.test(value) // person/assessable map values
			)
				out.push(value);
			return;
		}
		if (Array.isArray(value)) for (const item of value) walk(item, key);
		else if (value != null && typeof value === 'object')
			for (const [child, item] of Object.entries(value))
				if (child !== 'references' && child !== 'limitation' && child !== 'description')
					walk(item, child);
	};
	for (const table of CATALOGS)
		for (const row of read(version, table))
			walk(table === 'statutory_contribution_catalog' ? row.configuration : row);
	return out;
};
/** A structural JSON Schema 2020-12 check of the keywords these schemas use. */
const TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);
const KEYWORDS = new Set([
	'$schema',
	'type',
	'title',
	'description',
	'additionalProperties',
	'properties',
	'items',
	'enum',
	'const',
	'format',
	'minimum',
	'maximum',
	'minLength',
	'pattern',
	'default',
	'required'
]);
const checkSchema = (node: Row, path: string): void => {
	for (const key of Object.keys(node))
		assert.ok(KEYWORDS.has(key), `${path}: unknown keyword ${key}`);
	const types = node.type == null ? [] : Array.isArray(node.type) ? node.type : [node.type];
	for (const type of types) assert.ok(TYPES.has(fixtureString(type)), `${path}: type ${type}`);
	if (node.enum != null)
		assert.ok(Array.isArray(node.enum) && node.enum.length > 0, `${path}: enum`);
	if (node.pattern != null) new RegExp(fixtureString(node.pattern));
	if (node.properties != null) {
		assert.ok(types.includes('object'), `${path}: properties on a non-object`);
		for (const [key, child] of Object.entries(fixtureRecord(node.properties)))
			checkSchema(fixtureValue0(child), `${path}.${key}`);
	}
	if (node.items != null) checkSchema(fixtureRecord(node.items), `${path}[]`);
};
/** An ID company with four people on the engine's own read surface, and a run helper that stores what it plans. */
/** A work-day sheet import planned against the ID versions: the `roster` validations as HR would see them. */
const rosterImport = (
	people: {
		number: string;
		profile: Row;
		terms?: Row;
	}[],
	sheet: SheetRecord[]
) => {
	const law = (file: string) => versions.flatMap((version) => read(version, file));
	const tables = fixtureTables([
		[
			'entity',
			[
				{
					id: 'c1',
					name: 'Nusantara',
					settings_code: 'ID',
					time_zone: 'Asia/Jakarta',
					region: 'Provinsi DKI Jakarta',
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
							base_salary: { value: 10000000, currency: 'IDR' },
							allowances: [],
							employment_type: 'PERMANENT',
							residency_status: 'CITIZEN',
							facts: { working_days_per_week: 5 },
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
				nationality: 'ID',
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
					variant: { day_type: 'WORK', start_time: '08:00', end_time: '16:00' }
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
		].map((name) => fixtureValue2([name, []]))
	]);
	return world(tables).withRead((reader) =>
		Effect.gen(function* () {
			return yield* runEngine(
				planRosterImport(
					{
						company_id: nativeId('entity', fixtureKey('c1')),
						rows: fixtureSheet(sheet),
						now: '2026-10-20T00:00:00.000Z'
					},
					reader
				),
				reader,
				(message, at) => refuse(message, at?.field)
			);
		})
	);
};
const idWorld = () => {
	const COMPANY = 'c0000000-0000-4000-8000-0000000000id';
	const law = (name: string): Row[] =>
		versions.flatMap((version) => read(version, name)).map((row) => ({ ...row }));
	const contract = (
		id: string,
		salary: number,
		residency: string,
		dependents_count: number,
		to: string | null = null
	) => ({
		id: `k-${id}`,
		employee_id: id,
		company_id: COMPANY,
		effective_range: { from: '2024-01-01', to },
		facts: {
			contract_terms: [
				{
					base_salary: { value: salary, currency: 'IDR' },
					effective_range: { from: '2024-01-01', to: null },
					residency_status: residency,
					work_classification: 'ORDINARY',
					statutory_work_category: 'NON_MANUAL',
					employment_type: 'PERMANENT',
					allowances: [],
					facts: { dependents_count }
				}
			]
		},
		employee_number: String(id),
		contract_number: 1
	});
	const tables = fixtureTables([
		...['jurisdiction_settings', 'rule_set', ...CATALOGS.filter((name) => name !== 'rule_set')].map(
			(name) => fixtureValue2([name, law(name)])
		),
		[
			'entity',
			[
				{
					id: COMPANY,
					name: 'Nusantara',
					settings_code: 'ID',
					pay_frequency: 'MONTHLY',
					region: 'Provinsi DKI Jakarta',
					risk_class: 'II',
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
					id: 'p1',
					name: 'Budi',
					gender: 'MALE',
					marital_status: 'MARRIED',
					date_of_birth: '1990-02-01',
					nationality: 'ID',
					facts: {}
				},
				{
					id: 'p2',
					name: 'Sari',
					gender: 'FEMALE',
					marital_status: 'MARRIED',
					date_of_birth: '1992-07-12',
					nationality: 'ID',
					facts: {}
				},
				{
					id: 'p3',
					name: 'Ken',
					gender: 'MALE',
					marital_status: 'SINGLE',
					date_of_birth: '1985-07-12',
					nationality: 'JP',
					facts: {}
				},
				{
					id: 'p4',
					name: 'Dewi',
					gender: 'FEMALE',
					marital_status: 'SINGLE',
					date_of_birth: '1995-07-12',
					nationality: 'ID',
					facts: {}
				}
			]
		],
		[
			'employment_contract',
			[
				contract('p1', 10000000, 'CITIZEN', 1),
				contract('p2', 20000000, 'CITIZEN', 2),
				contract('p3', 30000000, 'NON_RESIDENT', 0),
				contract('p4', 10000000, 'CITIZEN', 0, '2026-06-30')
			]
		],
		[
			'shift_definition',
			[
				{
					id: 'D',
					company_id: COMPANY,
					code: 'D',
					variant: { day_type: 'WORK', start_time: '08:00', end_time: '16:00' }
				}
			]
		],
		...[
			'adhoc_catalog_entry',
			'claim_catalog_entry',
			'leave_catalog_entry',
			'loan_catalog_entry',
			'loan_repayment_entry',
			'roster_entry',
			'holiday',
			'payslip',
			'payroll_run'
		].map((name) => fixtureValue2([name, []]))
	]);
	const reads = world(tables).layer;
	const run = Effect.fnUntraced(function* (
		month: string,
		kind: PayrollRunKind,
		sources?: string[]
	) {
		return yield* world(tables).run(fixtureKey(COMPANY), month, kind, sources?.map(fixtureId));
	});
	const lines = (plan: Effect.Success<ReturnType<typeof run>>, who: string) =>
		Object.fromEntries(
			fixturePresent(plan.payslips.find((slip) => slip.employment_id === fixtureKey(`k-${who}`)))
				.statutory.filter((line) => line.employee_amount !== 0 || line.employer_amount !== 0)
				.map((line) => [line.scheme_code, [line.employee_amount, line.employer_amount]])
		);
	return { COMPANY, tables, run, lines };
};
describe('ID jurisdiction seed', () => {
	it.effect(
		'every version holds settings, rule_set and every catalogue, with unique ids owned by its own settings row',
		Effect.fnUntraced(function* () {
			const seen = new Map<string, string>();
			for (const version of versions) {
				const settings = settingsOf(version);
				assert.equal(settings.code, 'ID');
				assert.equal(settings.jurisdiction_code, 'ID');
				for (const table of ['jurisdiction_settings', ...CATALOGS]) {
					const fields = modelFields(table);
					for (const row of read(version, table)) {
						assert.equal(
							seen.has(row.id),
							false,
							`${version}/${table} ${row.id} also in ${seen.get(row.id)}`
						);
						seen.set(row.id, `${version}/${table}`);
						for (const key of Object.keys(row))
							assert.ok(
								fields.has(key),
								`${version}/${table} ${row.code}: ${key} is not on the model`
							);
						if (table !== 'jurisdiction_settings')
							assert.equal(row.settings_id, settings.id, `${version}/${table} ${row.code}`);
					}
				}
			}
			// No id is shared with another lineage.
			const others = new Set(
				readdirSync(lineages)
					.filter((lineage) => lineage !== 'ID')
					.flatMap((lineage) =>
						readdirSync(resolve(lineages, lineage))
							.filter((entry) => entry.startsWith('version_'))
							.flatMap((version) =>
								readdirSync(resolve(lineages, lineage, version))
									.filter((name) => name.endsWith('.json'))
									.flatMap((name) =>
										fixtureValue3(
											JSON.parse(readFileSync(resolve(lineages, lineage, version, name), 'utf8'))
										).map((row) => String(row.id))
									)
							)
					)
			);
			assert.deepEqual(
				[...seen.keys()].filter((id) => others.has(id)),
				[]
			);
		})
	);
	it('versions chain by cloned_from_id and their ranges are contiguous, inclusive and open-ended last', () => {
		const rows = versions.map(settingsOf);
		assert.equal(fixturePresent(rows[0]).cloned_from_id, undefined);
		rows.forEach((row, index) => {
			assert.match(row.effective_range.from, /^\d{4}-\d{2}-01$/);
			const sealed = fixtureString(row.sealed_at);
			assert.match(sealed, /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/);
			assert.ok(sealed.slice(0, 10) >= row.effective_range.from);
			if (index === 0) return;
			const previous = fixturePresent(rows[index - 1]);
			assert.equal(row.cloned_from_id, previous.id);
			assert.equal(nextDay(fixtureString(previous.effective_range.to)), row.effective_range.from);
		});
		assert.equal(fixturePresent(rows.at(-1)).effective_range.to, null);
	});
	it('catalogue and rule-set codes are stable across versions', () => {
		for (const table of CATALOGS) {
			const codes = versions.map((version) =>
				read(version, table)
					.map((row) => `${row.family ?? ''}:${row.code}`)
					.toSorted()
					.join(',')
			);
			assert.equal(new Set(codes).size, 1, table);
		}
	});
	it('both input schemas are JSON Schema 2020-12 and declare every fact the CEL reads', () => {
		for (const version of versions) {
			const settings = settingsOf(version);
			const employee = settings.employee_input_schema;
			const entity = settings.entity_input_schema;
			for (const [name, schema] of [
				['employee', employee],
				['entity', entity]
			] as const) {
				assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema', name);
				assert.equal(schema.type, 'object');
				checkSchema(schema, name);
			}
			const term = schemaProperties(schemaItems(employee.properties.contract_terms));
			assert.deepEqual(schemaEnum(term.residency_status), [
				'CITIZEN',
				'RESIDENT_FOREIGNER',
				'NON_RESIDENT'
			]);
			assert.deepEqual(schemaEnum(term.employment_type), [
				'PERMANENT',
				'CONTRACT',
				'PART_TIME',
				'DAILY'
			]);
			assert.equal(fixtureRecord(schemaProperties(term.base_salary).currency).const, 'IDR');
			// One layout: profile and entity columns (gender, marital_status, region, risk_class) are model fields, not
			// schema keys; PTKP dependants are a contract-term fact.
			assert.equal(fixtureRecord(schemaProperties(term.facts).dependents_count).type, 'integer');
			assert.deepEqual(Object.keys(employee.properties), [
				'contract_terms',
				'exit_facts',
				'employment_statutory_facts',
				'facts',
				'loan_facts'
			]);
			for (const column of ['region', 'risk_class'])
				assert.equal(column in entity.properties, false);
			const status = schemaProperties(
				schemaItems(employee.properties.employment_statutory_facts)
			).status;
			for (const key of [
				'npwp',
				'bpjs_ketenagakerjaan_npp',
				'bpjs_kesehatan_kode_badan_usaha',
				'wlkp_registration'
			])
				assert.ok(key in entity.properties, key);
			const declared = {
				'employee.facts': new Set(Object.keys(schemaProperties(employee.properties.facts))),
				'company.facts': new Set(Object.keys(entity.properties)),
				'employment.exit_facts': new Set(
					Object.keys(schemaProperties(employee.properties.exit_facts))
				),
				// terms: the term object's own keys plus what subjectContext derives from them.
				terms: new Set([
					...Object.keys(term),
					'monthly_wage',
					'effective_from',
					'effective_to',
					'allowances'
				]),
				'terms.facts': new Set(Object.keys(schemaProperties(term.facts))),
				'scheme.elections': new Set(
					Object.keys(schemaProperties(schemaProperties(status).elections))
				)
			};
			const source = celOf(version).join('\n');
			for (const [prefix, keys] of Object.entries(declared))
				for (const [, key] of source.matchAll(
					new RegExp(`(?<![\\w.])${prefix.replace('.', '\\.')}\\.(\\w+)`, 'g')
				))
					assert.ok(
						keys.has(fixturePresent(key)),
						`${version}: ${prefix}.${key} is read but not declared`
					);
			// Minimum wages are a PAYROLL rule, not a reference table.
			assert.equal(settings.reference_tables, undefined);
		}
	});
	it('allowances: a semi-monthly half pays its share of the monthly amount (period.parts)', () => {
		for (const version of versions)
			for (const row of read(version, 'allowance_catalog')) {
				const pay = (parts: number, days: number, paid_days: number) =>
					evaluateConfigured(
						fixtureString(String(row.amount)),
						fixtureContext({
							...payslipOf({}, version),
							allowance: { code: row.code, amount: 3000000 },
							period: { ...period, days, paid_days, part: 1, parts }
						})
					);
				assert.equal(pay(1, 31, 31), 3000000, `${version} ${String(row.code)} monthly`);
				assert.equal(pay(2, 15, 15), 1500000, `${version} ${String(row.code)} half`);
				assert.equal(pay(2, 16, 8), 750000, `${version} ${String(row.code)} half, half paid`);
			}
		// A semi-monthly March (1–15, 16–31) adds up to exactly the monthly run: BASIC halves the monthly salary,
		// a no-pay or partial-pay day and a suspension day cost the monthly day rate (monthly / month_days) in either half.
		for (const version of versions) {
			const work = (code: string) =>
				fixturePresent(read(version, 'work_catalog').find((row) => row.code === code));
			const npl = leaveRow({ code: 'UNPAID_LEAVE', days: 2, is_npl: true });
			const line = (code: string, slice: Row, rows: Row[] = []) => {
				const context = {
					...payslipOf({}, version),
					period: { ...period, ...slice },
					leave: { rows },
					work: { ...payslipOf({}, version).work, days: [] }
				};
				const row = work(code);
				if (
					evaluateConfigured(fixtureString(String(row.eligibility)), fixtureContext(context)) !==
					true
				)
					return 0;
				return (
					Number(
						evaluateConfigured(
							fixtureString(String(row.quantity ?? '1.0')),
							fixtureContext(context)
						)
					) * Number(evaluateConfigured(fixtureString(String(row.rate)), fixtureContext(context)))
				);
			};
			const monthly = { days: 31, paid_days: 31, part: 1, parts: 1, month_days: 31 };
			const first = {
				from: '2026-03-01',
				to: '2026-03-15',
				days: 15,
				paid_days: 15,
				part: 1,
				parts: 2,
				month_days: 31
			};
			const second = {
				from: '2026-03-16',
				to: '2026-03-31',
				days: 16,
				paid_days: 16,
				part: 2,
				parts: 2,
				month_days: 31
			};
			const basic = line('BASIC', monthly);
			assert.ok(basic > 0, version);
			assert.ok(
				Math.abs(line('BASIC', first) + line('BASIC', second) - basic) < 1e-6,
				`${version} BASIC`
			);
			const leave = line('NO_PAY_LEAVE', monthly, [npl]);
			assert.ok(leave > 0, version);
			assert.ok(
				Math.abs(line('NO_PAY_LEAVE', second, [npl]) - leave) < 1e-6,
				`${version} NO_PAY_LEAVE`
			);
		}
	});
	it('every OBLIGATIONS row is a dated duty whose due evaluates for its trigger', () => {
		const wageTerm = (from: string, to: string | null, value: number) => ({
			effective_range: { from, to },
			base_salary: { value, currency: 'IDR' },
			allowances: []
		});
		const raised = wageTerm('2026-12-01', null, 11000000);
		const wageWrite = {
			contract: {
				facts: { contract_terms: [wageTerm('2024-01-01', '2026-11-30', 10000000), raised] }
			},
			row: { terms_written: [raised] }
		};
		const counts = versions.map((version) => obligations(version).length);
		// OVERTIME_WRITTEN_ORDER is one row answering both roster events (created and updated).
		assert.deepEqual(counts, [46, 46, 46, 46]);
		for (const version of versions)
			for (const row of obligations(version)) {
				const rules = row.rules;
				assert.ok(
					rules.description.length > 0 && citationText(row.references).length > 0,
					row.code
				);
				assert.ok(
					[
						'PAYROLL_RUN',
						'HIRE',
						'EXIT',
						'entity.created',
						'payslip.updated',
						'roster_entry.created|updated',
						'leave_catalog_entry.created',
						'adhoc_catalog_entry.created',
						'calendar.daily',
						'workplace_case.created',
						'employment_profile.updated',
						'entity.updated'
					].includes(rules.trigger),
					row.code
				);
				for (const month of rules.months ?? []) assert.match(month, /^(0[1-9]|1[0-2])$/);
				const context = {
					contract: null,
					hired_on: null,
					holidays: [],
					holidays_named: [{ date: '2026-12-25', name: 'Christmas Day', kind: 'PUBLIC_HOLIDAY' }],
					headcount: 12,
					today: '2026-12-01',
					company: {
						facts: {
							wlkp_first_reported_on: '2023-12-04',
							company_regulation_valid_until: '2026-12-15'
						}
					},
					row: {
						work_date: '2026-12-07',
						approved_overtime_hours: 2,
						overtime_consented_at: null,
						paid_on: '2026-12-28',
						pay_due_date: '2026-12-20',
						from: '2026-12-07',
						occurred_on: '2026-12-07',
						catalog_code: 'WORK_ACCIDENT_LEAVE',
						facts: { doctor_certificate_on: '2026-12-09' },
						kind:
							row.code === 'WORKER_HEALTH_EXAMINATION_REPORT'
								? 'WORKER_HEALTH_EXAMINATION_COMPLETED'
								: 'PERSONAL_DATA_BREACH',
						opened_on: '2026-12-07'
					},
					...(rules.trigger === 'HIRE'
						? { hired_on: '2026-03-16' }
						: rules.trigger === 'EXIT'
							? { exit_on: '2026-03-16' }
							: { period: { key: '2026-12', from: '2026-12-01', to: '2026-12-31' } }),
					// A wage change is read on the contract write that added the new term.
					...(row.code === 'BPJS_KETENAGAKERJAAN_WAGE_CHANGE' ? wageWrite : {})
				};
				assert.match(
					String(evaluateConfigured(fixtureString(rules.due), fixtureContext(context))),
					/^\d{4}-\d{2}-\d{2}$/,
					row.code
				);
				// Their own triggers' rows (a THR entry, a contract term ending today) are asserted in the round-7 tests.
				if (
					rules.when != null &&
					rules.trigger !== 'EXIT' &&
					![
						'LATE_THR_FINE',
						'PKWT_TERM_END_COMPENSATION',
						'BPJS_KETENAGAKERJAAN_WAGE_CHANGE',
						'PDP_SUBJECT_REQUEST',
						'BPJS_KETENAGAKERJAAN_FAMILY_DATA_CHANGE',
						'BPJS_KETENAGAKERJAAN_ENTITY_CHANGE'
					].includes(row.code)
				)
					assert.equal(
						evaluateConfigured(fixtureString(rules.when), fixtureContext(context)),
						true,
						row.code
					);
				if (rules.applies_when != null)
					for (const extra of [
						{ contract: { exit_facts: null }, employee: null, company: null },
						{
							contract: { exit_facts: EXIT_FACTS, facts: { contract_terms: [] } },
							employee: { nationality: 'ID' },
							company: {}
						}
					])
						assert.equal(
							typeof evaluateConfigured(
								fixtureString(rules.applies_when),
								fixtureContext({ ...context, ...extra })
							),
							'boolean',
							row.code
						);
			}
		const due = (code: string, context: Row) =>
			evaluateConfigured(
				fixtureString(
					fixturePresent(obligations('version_3').find((row) => row.code === code)).rules.due
				),
				fixtureContext({
					holidays: [],
					...context
				})
			);
		const march = { period: { key: '2026-03', from: '2026-03-01', to: '2026-03-31' } };
		// PPh 21: deposit by the 15th, SPT Masa by the 20th of the next month; BPJS TK 15th next, Kesehatan 10th same.
		assert.equal(due('PPH21_PAYMENT', march), '2026-04-15');
		assert.equal(due('PPH21_SPT_MASA', march), '2026-04-20');
		assert.equal(due('BPJS_KETENAGAKERJAAN_REMITTANCE', march), '2026-04-15');
		assert.equal(due('BPJS_KESEHATAN_REMITTANCE', march), '2026-03-10');
		assert.equal(
			due('PPH21_BPA1_YEAR_END', {
				period: { key: '2026-12', from: '2026-12-01', to: '2026-12-31' }
			}),
			'2027-01-31'
		);
		assert.equal(
			due('THR_PAYMENT', {
				period: { key: '2026-12', from: '2026-12-01', to: '2026-12-31' },
				holidays_named: [{ date: '2026-12-25', name: 'Christmas Day', kind: 'PUBLIC_HOLIDAY' }]
			}),
			'2026-12-18'
		);
		assert.equal(
			due('BPJS_KETENAGAKERJAAN_REGISTRATION', { hired_on: '2026-03-16' }),
			'2026-04-15'
		);
		assert.equal(due('PPH21_BPA1_EXIT', { exit_on: '2026-03-16' }), '2026-04-30');
		// PP 44/2015 art.21(3), Perpres 82/2018 art.39(4), PMK 81/2024: a due day on a weekend or published holiday
		// rolls to the next working day — 15 August 2026 is a Saturday and 17 August Independence Day.
		const july = { period: { key: '2026-07', from: '2026-07-01', to: '2026-07-31' } };
		assert.equal(due('PPH21_PAYMENT', { ...july, holidays: ['2026-08-17'] }), '2026-08-18');
		assert.equal(due('BPJS_KETENAGAKERJAAN_REMITTANCE', july), '2026-08-17');
		// PP 35/2021 art.14: PKWT registration in 3 working days; Permenaker 2/2025 art.9: JKP notice in 7.
		assert.equal(due('PKWT_REGISTRATION', { hired_on: '2026-03-13' }), '2026-03-18');
		assert.equal(due('JKP_PHK_NOTIFICATION', { exit_on: '2026-06-30' }), '2026-07-09');
		assert.equal(due('WLKP_ESTABLISHMENT_REPORT', march), '2026-03-31');
	});
	it('the canonical duty behaviours are present and raise obligation and task writes', () => {
		for (const version of versions) {
			const settings = settingsOf(version);
			const behaviours = settings.behaviours;
			assert.ok(Schema.is(Behaviours)(behaviours), version);
			for (const [id, target] of [
				['raise-obligations', 'payroll_run'],
				['raise-tasks', undefined]
			] satisfies [string, string | undefined][])
				assert.equal(
					behaviours.rules.filter(
						(rule: Row) => rule.id === id && rule.target_collection === target
					).length,
					1,
					id
				);
			const rows = read(version, 'rule_set');
			const company = [{ region: 'Provinsi DKI Jakarta', risk_class: 'II', facts: {} }];
			const raise = (collection: string, event: string, row: Row, reads: Row = {}) =>
				raiseDuties({
					behaviours,
					settings_id: settings.id,
					rows,
					collection,
					event,
					row,
					reads: { company, ...reads }
				});
			const run = raise(
				'payroll_run',
				'created',
				{ id: 'r1', period: '2026-12', company_id: 'c1' },
				{
					raised: [{ duty_code: 'PPH21_PAYMENT', occurrence_key: '' }],
					holidays: [{ date: '2026-12-25', name: 'Christmas Day', kind: 'PUBLIC_HOLIDAY' }]
				}
			);
			const runCodes = run.map((write) => write.duty_code);
			assert.ok(runCodes.includes('PPH21_BPA1_YEAR_END') && runCodes.includes('THR_PAYMENT'));
			assert.equal(runCodes.includes('PPH21_PAYMENT'), false);
			assert.equal(runCodes.includes('PTKP_STATUS_ANNUAL'), false);
			assert.equal(
				fixturePresent(run.find((write) => write.duty_code === 'PPH21_SPT_MASA')).due_on,
				'2027-01-20'
			);
			const hire = (nationality: string, facts?: Row) =>
				raise(
					'employment_contract',
					'created',
					{
						id: 'k1',
						company_id: 'c1',
						employee_id: 'p1',
						effective_range: { from: '2026-03-16', to: null },
						...(facts ? { facts } : {}),
						employee_number: String('p1'),
						contract_number: 1
					},
					{ employee: [{ nationality, gender: 'MALE', date_of_birth: '1990-01-01', facts: {} }] }
				);
			const codes = (writes: Row[]) => writes.map((write) => String(write.duty_code)).toSorted();
			// A contract without terms raises the PKWT registration; permanent terms do not.
			assert.deepEqual(codes(hire('ID')), [
				'BPJS_KESEHATAN_REGISTRATION',
				'BPJS_KETENAGAKERJAAN_REGISTRATION',
				'PKWT_REGISTRATION',
				'PRE_EMPLOYMENT_HEALTH_EXAMINATION',
				'PTKP_STATUS_AT_HIRE',
				'WAGE_SCALE_NOTICE_AT_HIRE'
			]);
			assert.ok(codes(hire('JP')).includes('FOREIGN_WORKER_RPTKA_DKPTKA'));
			const pkwtt = { contract_terms: [{ employment_type: 'PERMANENT' }] };
			assert.equal(codes(hire('ID', pkwtt)).includes('PKWT_REGISTRATION'), false);
			assert.ok(
				codes(hire('ID', { contract_terms: [{ employment_type: 'CONTRACT' }] })).includes(
					'PKWT_REGISTRATION'
				)
			);
			assert.ok(hire('ID').every((write) => write.subject_collection === 'employment_contract'));
			const exit = (cause: string | null, nationality = 'ID') =>
				Object.fromEntries(
					raise(
						'employment_contract',
						'updated',
						{
							id: 'k1',
							company_id: 'c1',
							employee_id: 'p1',
							exit_facts: cause == null ? {} : { termination_cause: cause },
							effective_range: { from: '2024-01-01', to: '2026-06-30' },
							employee_number: String('p1'),
							contract_number: 1
						},
						{ employee: [{ nationality, gender: 'MALE', date_of_birth: '1990-01-01', facts: {} }] }
					).map((write) => [write.duty_code, write.due_on])
				);
			// Retrenchment of a national: JKP notice in 7 days and the art.38 report; a resignation or a PKWT
			// expiry (no cause) takes only the BPA1; a foreigner is outside JKP.
			// No notice day recorded: PP 35/2021 art.37(3) is not shown to be met.
			assert.deepEqual(exit('EFFICIENCY_ACTUAL_LOSS'), {
				PPH21_BPA1_EXIT: '2026-07-31',
				JKP_PHK_NOTIFICATION: '2026-07-09',
				TERMINATION_REPORT: '2026-06-30',
				TERMINATION_NOTICE_LATE: '2026-06-30',
				BPJS_KETENAGAKERJAAN_EXIT_REPORT: '2026-07-09',
				PERSONAL_DATA_DISPOSAL: '2036-12-31'
			});
			// PP 44/2015 art.9(3): every exit changes the BPJS headcount, reported in 7 working days.
			const reported = {
				BPJS_KETENAGAKERJAAN_EXIT_REPORT: '2026-07-09',
				PERSONAL_DATA_DISPOSAL: '2036-12-31'
			};
			assert.deepEqual(exit('VOLUNTARY_RESIGNATION'), {
				PPH21_BPA1_EXIT: '2026-07-31',
				...reported
			});
			assert.deepEqual(exit(null), { PPH21_BPA1_EXIT: '2026-07-31', ...reported });
			assert.deepEqual(Object.keys(exit('EFFICIENCY_ACTUAL_LOSS', 'JP')).toSorted(), [
				'BPJS_KETENAGAKERJAAN_EXIT_REPORT',
				'PERSONAL_DATA_DISPOSAL',
				'PPH21_BPA1_EXIT',
				'TERMINATION_NOTICE_LATE',
				'TERMINATION_REPORT'
			]);
		}
	});
	it('every CEL expression evaluates on the engine context it runs in, except the reported context gaps', () => {
		const KNOWN_GAPS = new Set<string>();
		const failures = new Set<string>();
		const run = (where: string, expression: unknown, context: object) => {
			if (typeof expression !== 'string' || expression.trim() === '') return;
			try {
				evaluateConfigured(fixtureString(expression), fixtureContext(context));
			} catch {
				failures.add(where);
			}
		};
		const people = [
			{},
			{ terms: { residency_status: 'NON_RESIDENT' } },
			{
				terms: { residency_status: 'RESIDENT_FOREIGNER' },
				employee: { gender: 'FEMALE', dependents_count: 3 }
			},
			{ employee: { date_of_birth: '', marital_status: 'SINGLE', dependents_count: 0 } },
			{ company: { risk_class: '' } },
			{ employment: { exit_date: '2026-03-20' } }
		];
		for (const version of versions) {
			for (const row of read(version, 'statutory_contribution_catalog'))
				for (const over of people)
					for (const wage of [0, 5000000, 30000000])
						try {
							const result = assess(
								row,
								{ ordinary: wage, additional: 0, bpjs: wage },
								{ subject: subject(over) }
							);
							if (result !== null && result !== 'REFUSED')
								assert.ok(Number.isFinite(result.employee) && Number.isFinite(result.employer));
						} catch {
							failures.add(`statutory/${row.code}`);
						}
			const payslip = payslipOf({ employment: { exit_facts: EXIT_FACTS } }, version);
			for (const table of ['work_catalog', 'allowance_catalog'])
				for (const row of read(version, table))
					for (const field of ['eligibility', 'quantity', 'rate', 'amount'])
						run(`${table}/${row.code}.${field}`, row[field], {
							...payslip,
							allowance: { code: row.code, amount: 1000000 }
						});
			for (const table of ['adhoc_catalog', 'claim_catalog', 'loan_catalog', 'leave_catalog'])
				for (const row of read(version, table)) {
					const context = {
						...payslip,
						entry: entry({
							holiday_date: '2026-03-21',
							event_kind: 'BIRTH',
							relationship: 'SELF',
							wage_due_on: '2026-03-01',
							wage_paid_on: '2026-03-10',
							wage_due_amount: 10000000,
							thr_due_amount: 10000000
						}),
						earlier: { rows: [], calendar_year: 0, lifetime: 0 }
					};
					for (const field of ['eligibility', 'qualifies_when'])
						run(`${table}/${row.code}.${field}`, row[field], context);
					// `pay_fraction` runs per leave row, with `leave` = that row.
					run(`${table}/${row.code}.pay_fraction`, row.pay_fraction, {
						...context,
						leave: leaveRow({ code: row.code, month_index: 6 })
					});
					for (const band of bandsOf(row))
						for (const expression of [band.when, band.amount, band.limit?.amount])
							run(`${table}/${row.code}.bands`, expression, context);
					// Admission without event facts still answers (has() guards).
					run(`${table}/${row.code}.eligibility`, row.eligibility, {
						...subject(),
						rules: {},
						entry: entry(),
						earlier: { rows: [], calendar_year: 0, lifetime: 0 }
					});
				}
		}
		assert.deepEqual(
			[...failures].filter((where) => !KNOWN_GAPS.has(where)),
			[]
		);
	});
	it('behaviours decode, admit payroll, pin settled entries and encash unused annual leave on exit', () => {
		for (const version of versions) {
			const behaviours = settingsOf(version).behaviours;
			const planned = planBehaviours(
				behaviours,
				{ kind: 'catalog', catalog: 'WORK', event: 'PAYROLL_CREATE' },
				{ event: { data: { request: { kind: 'REGULAR', period: '2026-03' } } } }
			);
			assert.ok(planned.some((rule) => rule.id === 'payroll-run'));
			const pin = fixturePresent(
				behaviours.rules.find((rule: Row) => rule.id === 'pin-settled-entries')
			);
			assert.deepEqual(
				effectWrites(pin, {
					event: {
						row: {
							id: 'run',
							pins: [{ employment_id: 'e1', collection: 'roster_entry', id: 'r1' }]
						}
					},
					slips: [{ id: 's1', employment_id: 'e1' }]
				}).map((write) => write.data),
				[{ target: ['r1'], set: { payslip_id: 's1' } }]
			);
			const annual = catalog(version, 'leave_catalog', 'ANNUAL_LEAVE');
			const encash = fixturePresent(
				behaviours.rules.find((rule: Row) => rule.id === 'encash-leave-on-exit')
			);
			const exit = (to: string) =>
				effectWrites(
					encash,
					withBalances({
						event: {
							settings_id: settingsOf(version).id,
							row: {
								id: 'c1',
								exit_facts: {},
								prior_service_months: null,
								effective_range: { from: '2022-08-01', to }
							}
						},
						catalogues: [annual],
						movements: [
							{
								catalog_id: annual.id,
								activity: 'TIME_OFF',
								days: 2.5,
								occurred_on: '2026-01-05',
								reference: 'x'
							}
						]
					})
				).map((write) => write.data.days);
			// UU 13/2003 art.79(3): 12 days after each 12 months of continuous service; none before. Owner ruling: the
			// service year resets the balance and carries at most 5 unused days — 12 + 5 − 2.5 taken this year.
			assert.deepEqual(exit('2026-01-31'), [14.5]);
			assert.deepEqual(exit('2023-06-30'), []);
		}
	});
	it('BPJS Ketenagakerjaan and Kesehatan charge the rates in force per version', () => {
		const at = (
			version: string,
			code: string,
			wage: number,
			over: Parameters<typeof subject>[0] = {},
			elections: Row = {}
		) => {
			const result = assess(
				scheme(version, code),
				{ ordinary: wage },
				{ subject: subject(over), version, elections }
			);
			return result === null || result === 'REFUSED'
				? result
				: { employee: result.employee, employer: result.employer };
		};
		const foreigner = {
			terms: { residency_status: 'RESIDENT_FOREIGNER', monthly_wage: 62000000 }
		};
		for (const version of versions) {
			// PP 46/2015 art.16: JHT 2% / 3.7% of the contract's monthly rate, no ceiling (owner rule 2026-09-28: whole rate).
			assert.deepEqual(at(version, 'JHT', 31000000, foreigner), {
				employee: 1240000,
				employer: 2294000
			});
			assert.deepEqual(at(version, 'JHT', 4000000, { terms: { monthly_wage: 8000000 } }), {
				employee: 160000,
				employer: 296000
			});
			// PP 44/2015 art.16(1): JKK by risk group; art.18(1) JKM 0.30%; employer only.
			for (const [group, employer] of [
				['I', 17709],
				['II', 39845],
				['III', 65670],
				['IV', 93709],
				['V', 128389]
			] as const)
				assert.deepEqual(
					at(version, 'JKK', 0, {
						terms: { monthly_wage: 7378688 },
						company: { risk_class: group }
					}),
					{ employee: 0, employer }
				);
			assert.equal(at(version, 'JKK', 7378688, { company: { risk_class: '' } }), 'REFUSED');
			assert.deepEqual(at(version, 'JKM', 0, { terms: { monthly_wage: 22380750 } }), {
				employee: 0,
				employer: 67142
			});
			// PP 44/2015 art.19(3): a daily worker's month is 25 days of the agreed daily wage (else the wage paid).
			assert.deepEqual(
				at(version, 'JKM', 3000000, {
					terms: { employment_type: 'DAILY', facts: { daily_wage: 200000 } }
				}),
				{ employee: 0, employer: 15000 }
			);
			assert.deepEqual(at(version, 'JKM', 3000000, { terms: { employment_type: 'DAILY' } }), {
				employee: 0,
				employer: 9000
			});
			// PP 37/2021 art.11 as amended by PP 6/2025: JKP is government money plus recomposed JKK — no payslip charge.
			assert.equal(at(version, 'JKP', 10000000), null);
			// Perpres 82/2018 art.30 as amended: 1% / 4% on a wage capped at 12,000,000; +1% per extra member (art.36).
			assert.deepEqual(at(version, 'KESEHATAN', 27880750), {
				employee: 120000,
				employer: 480000
			});
			assert.deepEqual(at(version, 'KESEHATAN', 8000000, {}, { extra_members: 2 }), {
				employee: 240000,
				employer: 320000
			});
			// Perpres 82/2018 art.32(2)–(5): floored at the workplace UMK/UMP outside a micro or small enterprise.
			const floor = version === 'version_1' ? 5396761 : 5729876;
			assert.deepEqual(at(version, 'KESEHATAN', 3000000), {
				employee: Math.round(floor * 0.01),
				employer: Math.round(floor * 0.04)
			});
			assert.deepEqual(
				at(version, 'KESEHATAN', 3000000, {
					company: { facts: { enterprise_size_class: 'MICRO_OR_SMALL' } }
				}),
				{ employee: 30000, employer: 120000 }
			);
			assert.equal(
				at(version, 'KESEHATAN', 3000000, { company: { region: 'Atlantis' } }),
				'REFUSED'
			);
			// PP 45/2015 art.28 1% / 2%: citizens only, stopping at the pension age of 59 (art.15).
			assert.deepEqual(at(version, 'JP', 9000000, foreigner), null);
			assert.deepEqual(
				at(version, 'JP', 9000000, { employee: { date_of_birth: '1966-01-01' } }),
				null
			);
			assert.deepEqual(at(version, 'JP', 9000000, { employee: { date_of_birth: '' } }), {
				employee: 90000,
				employer: 180000
			});
		}
		// The JP ceiling: 10,547,400 through February 2026, 11,086,300 from 1 March 2026 (SE BPJS Ketenagakerjaan B/1226/022026).
		assert.deepEqual(
			versions.map((version) => at(version, 'JP', 22380750)),
			[
				{ employee: 105474, employer: 210948 },
				{ employee: 105474, employer: 210948 },
				{ employee: 110863, employer: 221726 },
				{ employee: 110863, employer: 221726 }
			]
		);
	});
	it('JP continuation requires the recorded election and stops within three years after pension age', () => {
		assert.equal(LAW_KIT.versionOn('2026-09-30'), 'version_3');
		assert.equal(LAW_KIT.versionOn('2026-10-01'), 'version_4');
		const at = (birthdate: string, elections: Row = {}, residency_status = 'CITIZEN') => {
			const result = assess(
				scheme('version_4', 'JP'),
				{ ordinary: 9000000 },
				{
					version: 'version_4',
					period: '2026-10',
					subject: subject({ employee: { date_of_birth: birthdate }, terms: { residency_status } }),
					elections
				}
			);
			return result === null || result === 'REFUSED'
				? result
				: { employee: result.employee, employer: result.employer };
		};
		const elected = { continue_after_pension_age: true };
		assert.equal(at('1967-01-01'), null); // age59: default stops
		assert.equal(at('1967-01-01', { continue_after_pension_age: false }), null);
		for (const birthdate of ['1967-01-01', '1966-01-01', '1965-01-01'])
			assert.deepEqual(at(birthdate, elected), { employee: 90000, employer: 180000 });
		assert.equal(at('1964-01-01', elected), 'REFUSED'); // age62: cannot extend the maximum
		assert.equal(at('', elected), 'REFUSED');
		assert.equal(at('1966-01-01', elected, 'RESIDENT_FOREIGNER'), null);
		const properties = settingsOf('version_4').employee_input_schema.properties;
		const status = schemaProperties(schemaItems(properties.employment_statutory_facts)).status;
		const elections = schemaProperties(schemaProperties(status).elections);
		assert.equal(fixtureRecord(elections.continue_after_pension_age).type, 'boolean');
	});
	it('PPh 21 TER bulanan by PTKP category, at the PMK 168/2023 bracket edges', () => {
		const ter = (gross: number, employee: Row, version = 'version_3') => {
			const result = assess(
				scheme(version, 'PPH21'),
				{ ordinary: gross, additional: 0, bpjs: 0, premium: 0, iuran: 0, withheld: 0 },
				{ subject: subject({ employee, terms: { monthly_wage: 0 } }), period: '2026-03' }
			);
			assert.ok(result !== null && result !== 'REFUSED');
			return result.employee;
		};
		const A = { marital_status: 'SINGLE', dependents_count: 0 };
		const B = { marital_status: 'MARRIED', dependents_count: 1 };
		const C = { marital_status: 'MARRIED', dependents_count: 3 };
		for (const version of versions) {
			// Category A: 0% to 5,400,000, 0.25% from 5,400,001; 9% to 24,150,000; 34% above 1,400,000,000.
			assert.equal(ter(5400000, A, version), 0);
			assert.equal(ter(5400001, A, version), 13500);
			assert.equal(ter(24150000, A, version), 2173500);
			assert.equal(ter(1500000000, A, version), 510000000);
			// TK/1 and K/0 are A as well.
			assert.equal(ter(5400001, { marital_status: 'SINGLE', dependents_count: 1 }, version), 13500);
			assert.equal(
				ter(5400001, { marital_status: 'MARRIED', dependents_count: 0 }, version),
				13500
			);
			// Category B (K/1): 0% to 6,200,000; 1% to 9,200,000; 1.5% to 10,750,000.
			assert.equal(ter(6200000, B, version), 0);
			assert.equal(ter(9200000, B, version), 92000);
			assert.equal(ter(10484000, B, version), 157260);
			assert.equal(ter(6500000, { marital_status: 'SINGLE', dependents_count: 2 }, version), 16250);
			// Category C (K/3, dependants capped at three): 0% to 6,600,000; 1.25% to 9,800,000.
			assert.equal(ter(6600000, C, version), 0);
			assert.equal(ter(9800000, C, version), 122500);
			assert.equal(
				ter(9800000, { marital_status: 'MARRIED', dependents_count: 5 }, version),
				122500
			);
			// A married woman without the kelurahan statement takes TK/0 (A); with it, K/3 (C).
			assert.equal(ter(9800000, { ...C, gender: 'FEMALE' }, version), 196000);
			assert.equal(
				ter(
					9800000,
					{ ...C, gender: 'FEMALE', facts: { husband_no_income_certified: true } },
					version
				),
				122500
			);
		}
		const pph21 = scheme('version_3', 'PPH21');
		const subjectOf = (terms: Row, employee: Row = {}) => subject({ terms, employee });
		// Residency and marital status are required; a daily worker is refused until TER harian has its daily wage.
		assert.equal(
			assess(
				pph21,
				{ ordinary: 8000000, additional: 0, bpjs: 8000000 },
				{ subject: subjectOf({ residency_status: '' }) }
			),
			'REFUSED'
		);
		assert.equal(
			assess(
				pph21,
				{ ordinary: 8000000, additional: 0, bpjs: 8000000 },
				{ subject: subjectOf({}, { marital_status: '' }) }
			),
			'REFUSED'
		);
		assert.equal(
			assess(
				pph21,
				{ ordinary: 8000000, additional: 0, bpjs: 8000000 },
				{ subject: subjectOf({ employment_type: 'DAILY' }) }
			),
			'REFUSED'
		);
		assert.equal(
			assess(
				pph21,
				{ ordinary: 8000000, additional: 0, bpjs: 8000000 },
				{ subject: subjectOf({ residency_status: 'NON_RESIDENT' }) }
			),
			null
		);
		// TER harian on the agreed daily wage: 0% to 450,000 a day, 0.5% to 2,500,000, on the month's daily gross.
		const daily = (daily_wage: number) =>
			assess(
				pph21,
				{ ordinary: 8000000, additional: 0 },
				{ subject: subjectOf({ employment_type: 'DAILY', facts: { daily_wage } }) }
			);
		assert.equal(fixtureValue0(daily(450000)).employee, 0);
		assert.equal(fixtureValue0(daily(500000)).employee, 40000);
		// Above 2,500,000 a day: the art.17 rates on 50% of each day's gross (PMK 168/2023 arts.12(2)(b), 16(2)(b)):
		// 5% of 1,300,000 = 65,000 a day, i.e. 2.5% of the month's 8,000,000.
		assert.equal(fixtureValue0(daily(2600000)).employee, 200000);
		// The month's gross takes the employer premiums the BPJS schemes charged before PPh 21 on the slip.
		const premiums = fixtureValue0(
			assess(
				pph21,
				{ ordinary: 10000000, additional: 0 },
				{
					charged: {
						month: {
							JKK: { employer: 54000 },
							JKM: { employer: 30000 },
							KESEHATAN: { employer: 400000 }
						}
					}
				}
			)
		);
		assert.equal(premiums.employee, 157260);
	});
	it('PPh 26 is 20% for a non-resident and PP 68/2009 art.4 bands severance', () => {
		for (const version of versions) {
			const pph26 = (residency: string) =>
				assess(
					scheme(version, 'PPH26'),
					{ ordinary: 10000000 },
					{ subject: subject({ terms: { residency_status: residency } }) }
				);
			assert.equal(fixtureValue0(pph26('NON_RESIDENT')).employee, 2000000);
			assert.equal(pph26('CITIZEN'), null);
			assert.equal(pph26('RESIDENT_FOREIGNER'), null);
			const severance = (amount: number) =>
				fixtureValue0(assess(scheme(version, 'PPH21_FINAL_SEVERANCE'), { ordinary: amount }))
					.employee;
			assert.equal(severance(50000000), 0);
			assert.equal(severance(80000000), 1500000);
			assert.equal(severance(300000000), 32500000);
			assert.equal(severance(600000000), 87500000);
		}
	});
	it('severance, THR and leave pay price on the engine context', () => {
		for (const version of versions) {
			const price = (code: string, over: Parameters<typeof subject>[0], facts: Row = {}) => {
				const row = catalog(version, 'adhoc_catalog', code);
				const context = { ...payslipOf(over, version), entry: entry(facts) };
				if (
					evaluateConfigured(fixtureString(row.eligibility || 'true'), fixtureContext(context)) !==
					true
				)
					return null;
				return Number(
					evaluateConfigured(
						fixtureString(fixturePresent(bandsOf(row)[0]).amount),
						fixtureContext(context)
					)
				);
			};
			const wage = { terms: { monthly_wage: 10000000 } };
			const leaver = (facts: Row, months = 40, terms: Row = {}) => ({
				terms: { monthly_wage: 10000000, ...terms },
				employment: {
					service_months: months,
					exit_date: '2026-03-31',
					exit_facts: { ...EXIT_FACTS, ...facts }
				}
			});
			// PP 35/2021 art.40(2) 40 months → 4 months' wage, art.43(1) efficiency due to loss × 0.5; art.40(3) UPMK 2 months.
			assert.equal(price('PESANGON', leaver({})), 20000000);
			assert.equal(price('UPMK', leaver({})), 20000000);
			assert.equal(price('UPMK', leaver({}, 30)), null);
			// Art.157(3)–(4): the output average is floored at the workplace minimum wage (rules.minimum_wage.by_region).
			// DKI UMP: Kep. Gubernur 1142/2025 (2026) and the 2025 UMP.
			const floor = version === 'version_1' ? 5396761 : 5729876;
			assert.equal(
				price('PESANGON', leaver({ separation_wage_basis: 'OUTPUT', output_average_12m: 3000000 })),
				Math.round(floor * 4 * 0.5)
			);
			// Uang pisah on a voluntary resignation; no pesangon.
			assert.equal(
				price('UANG_PISAH', leaver({ termination_cause: 'VOLUNTARY_RESIGNATION' })),
				7000000
			);
			assert.equal(price('PESANGON', leaver({ termination_cause: 'VOLUNTARY_RESIGNATION' })), null);
			// PP 35/2021 art.16: PKWT compensation = monthly wage × the term's months / 12; never for a foreigner.
			assert.equal(
				price(
					'PKWT_COMPENSATION',
					leaver({}, 18, { employment_type: 'CONTRACT', effective_from: '2024-10-01' })
				),
				15000000
			);
			// Art.15(5) excludes foreign workers by nationality, not by tax residency.
			assert.equal(
				price('PKWT_COMPENSATION', {
					...leaver({}, 18, {
						employment_type: 'CONTRACT',
						residency_status: 'RESIDENT_FOREIGNER'
					}),
					employee: { nationality: 'SG' }
				}),
				null
			);
			assert.equal(
				price('PKWT_COMPENSATION', {
					...leaver({}, 18, {
						employment_type: 'CONTRACT',
						residency_status: 'NON_RESIDENT',
						effective_from: '2024-10-01'
					}),
					employee: { nationality: 'ID' }
				}),
				15000000
			);
			assert.equal(price('PESANGON', leaver({}, 18, { employment_type: 'CONTRACT' })), null);
			// PP 35/2021 art.58: the employer pension benefit offsets the separation pay, up to it.
			assert.equal(price('PENSION_OFFSET', leaver({})), 5000000);
			// Permenaker 6/2016 art.3: THR is one month's wage from 12 months, pro rata from one; a PKWTT leaver within
			// 30 days before the holiday keeps it (art.7(1)), a PKWT leaver does not.
			assert.equal(price('THR_HOLIDAY', { ...wage, employment: { service_months: 40 } }), 10000000);
			assert.equal(price('THR_HOLIDAY', { ...wage, employment: { service_months: 6 } }), 5000000);
			assert.equal(price('THR_HOLIDAY', { ...wage, employment: { service_months: 0 } }), null);
			const thrLeaver = (employment_type: string) =>
				price(
					'THR',
					{
						terms: { monthly_wage: 10000000, employment_type },
						employment: { service_months: 40, exit_date: '2026-03-01' }
					},
					{ holiday_date: '2026-03-20' }
				);
			assert.equal(thrLeaver('PERMANENT'), 10000000);
			assert.equal(thrLeaver('CONTRACT'), null);
			// Work lines: overtime and holiday work on the monthly wage (PP 35/2021 art.32(2)); none for the art.27(2) group.
			const payslip = payslipOf(
				{ terms: { base_salary: 8000000, monthly_wage: 9000000 } },
				version
			);
			const work = (code: string, context: Row = payslip) => {
				const row = catalog(version, 'work_catalog', code);
				if (evaluateConfigured(fixtureString(row.eligibility), fixtureContext(context)) !== true)
					return 0;
				return (
					Number(evaluateConfigured(fixtureString(row.quantity), fixtureContext(context))) *
					Number(evaluateConfigured(fixtureString(row.rate), fixtureContext(context)))
				);
			};
			// Two ordinary-day hours: the first at 1.5×, the second at 2× (art.31(1)).
			assert.equal(work('OVERTIME'), ((1.5 + 2) * 9000000) / 173);
			// art.27(4)–(5): the managerial group is exempt only where the agreement or regulations define it.
			assert.equal(
				work(
					'OVERTIME',
					payslipOf(
						{
							terms: { work_classification: 'MANAGERIAL' },
							company: { facts: { managerial_group_defined: true } }
						},
						version
					)
				),
				0
			);
			assert.equal(
				work('OVERTIME', payslipOf({ terms: { work_classification: 'MANAGERIAL' } }, version)),
				((1.5 + 2) * 8000000) / 173
			);
			// PP 35/2021 art.31(2)–(3): rest-day and holiday hours are all overtime, on the week's ladder; the result is
			// in hour-units of 1/173 of a 17,300,000 monthly wage (100,000 an hour).
			const ladder = (days: Row[], week: number) =>
				work('OVERTIME', {
					...payslipOf(
						{ terms: { monthly_wage: 17300000, facts: { working_days_per_week: week } } },
						version
					),
					work: { overtime_hours: 1, incentive_hours: 0, dates: [], holidays: [], days }
				}) / 100000;
			// A holiday on a working day: every paid hour (`worked_hours`, the shift plus the time past it) is priced.
			const holiday = (hours: number, scheduled = 8) =>
				day({
					holiday_kind: 'PUBLIC_HOLIDAY',
					scheduled_hours: scheduled,
					worked_hours: hours,
					overtime_hours: Math.max(0, hours - scheduled)
				});
			// 5-day week: hours 1–8 at 2×, hour 9 at 3×, hours 10–12 at 4×.
			assert.equal(ladder([holiday(9)], 5), 16 + 3);
			assert.equal(ladder([holiday(12)], 5), 16 + 3 + 12);
			// 6-day week: hours 1–7 at 2×, hour 8 at 3×, hours 9–11 at 4×.
			assert.equal(ladder([holiday(9)], 6), 14 + 3 + 4);
			// A holiday on the shortest day (5 scheduled hours): 1–5 at 2×, 6 at 3×, 7–9 at 4×.
			assert.equal(ladder([holiday(7, 5)], 6), 10 + 3 + 4);
			// A rest day is priced like a holiday; an ordinary day is 1.5× then 2×.
			// A 0-hour rest day: all 8 hours are its overtime and its paid hours, counted once.
			const rest = (hours: number, banked = 0) =>
				day({
					day_type: 'REST',
					scheduled_hours: 0,
					worked_hours: hours,
					overtime_hours: hours - banked,
					banked_hours: banked
				});
			assert.equal(ladder([rest(8)], 5), 16);
			// An hour banked as time off is not paid as well.
			assert.equal(ladder([rest(9, 1)], 5), 16);
			assert.equal(ladder([day({ worked_hours: 11, overtime_hours: 3 })], 5), 1.5 + 4);
			// art.33(1): a daily-paid worker's month is the day × 25 (6-day week) or × 21 (5-day week).
			const daily = (week: number) =>
				work('OVERTIME', {
					...payslipOf(
						{
							terms: {
								employment_type: 'DAILY',
								facts: { daily_wage: 173000, working_days_per_week: week }
							}
						},
						version
					),
					work: {
						overtime_hours: 1,
						incentive_hours: 0,
						dates: [],
						holidays: [],
						days: [day({ overtime_hours: 1 })]
					}
				});
			assert.equal(daily(6), 1.5 * 25000);
			assert.equal(daily(5), 1.5 * 21000);
			// Unused leave cashed out at the usual wage (basic plus fixed allowances, PP 36/2021 art.46) ÷ the entity's
			// divisor (owner ruling): 2 days × 9,000,000 / 25.
			assert.equal(work('ENCASHMENT'), 720000);
			assert.equal(work('EXIT_ENCASHMENT'), 0);
			// The exit encashment (written on the last day) is uang penggantian hak — the PP 68/2009 final base.
			const exitSlip = {
				...payslip,
				employment: { ...payslip.employment, exit_date: '2026-03-31' },
				leave: {
					rows: [
						leaveRow({ activity: 'ENCASHMENT', days: 16, can_encash: true, from: '2026-03-31' })
					]
				}
			};
			assert.equal(work('EXIT_ENCASHMENT', exitSlip), 16 * 360000);
			assert.equal(work('ENCASHMENT', exitSlip), 0);
			// UU 13/2003 art.93(3): sick pay 100 / 75 / 50 / 25% by four-month band; the unpaid share is deducted.
			const sick = catalog(version, 'leave_catalog', 'MEDICAL_LEAVE').pay_fraction;
			assert.deepEqual(
				[1, 4, 5, 9, 13].map((month_index) =>
					evaluateConfigured(
						fixtureString(sick),
						fixtureContext({ leave: leaveRow({ month_index }) })
					)
				),
				[1, 1, 0.75, 0.5, 0.25]
			);
			const maternity = catalog(version, 'leave_catalog', 'MATERNITY_LEAVE').pay_fraction;
			// UU 4/2024 arts.4(3), 5(2): months 4–6 only on a doctor's certificate of a special condition.
			assert.equal(
				evaluateConfigured(
					fixtureString(maternity),
					fixtureContext({
						leave: leaveRow({ month_index: 5, facts: { special_condition_certified: true } })
					})
				),
				0.75
			);
			assert.equal(
				evaluateConfigured(
					fixtureString(maternity),
					fixtureContext({ leave: leaveRow({ month_index: 5 }) })
				),
				0
			);
			const partial = {
				...payslip,
				leave: { rows: [leaveRow({ code: 'MEDICAL_LEAVE', days: 10, pay_fraction: 0.75 })] }
			};
			assert.equal(
				Math.round(work('PARTIAL_PAY_LEAVE', partial)),
				Math.round((2.5 * 9000000) / 31)
			);
			// Event-based leave reads the entry's facts and the employee.
			const leave = (code: string, employee: Row, facts: Row) =>
				evaluateConfigured(
					fixtureString(catalog(version, 'leave_catalog', code).eligibility),
					fixtureContext({
						...subject({ employee }),
						rules: {},
						entry: entry(facts)
					})
				);
			assert.equal(leave('MATERNITY_LEAVE', { gender: 'FEMALE' }, { event_kind: 'BIRTH' }), true);
			assert.equal(leave('MATERNITY_LEAVE', { gender: 'MALE' }, { event_kind: 'BIRTH' }), false);
			assert.equal(leave('PATERNITY_LEAVE', { gender: 'MALE' }, { event_kind: 'BIRTH' }), true);
			assert.equal(
				leave('BEREAVEMENT_LEAVE', {}, { event_kind: 'DEATH', relationship: 'PARENT' }),
				true
			);
			assert.equal(leave('MARRIAGE_LEAVE', {}, {}), false);
			assert.equal(leave('MENSTRUAL_LEAVE', { gender: 'FEMALE' }, {}), true);
		}
	});
	it('pay lines feed the schemes their wage concept names, once', () => {
		for (const version of versions) {
			const counts = (table: string, code: string) =>
				fixtureValue4(catalog(version, table, code).counts_toward);
			assert.equal(counts('work_catalog', 'BASIC').includes('PPH21_FINAL_SEVERANCE'), false);
			// Upah pokok + tunjangan tetap is the BPJS wage; overtime and holiday work are not.
			assert.ok(counts('work_catalog', 'EXIT_ENCASHMENT').includes('PPH21_FINAL_SEVERANCE'));
			assert.equal(counts('work_catalog', 'ENCASHMENT').includes('PPH21_FINAL_SEVERANCE'), false);
			for (const code of ['OVERTIME', 'ENCASHMENT', 'EXIT_ENCASHMENT'])
				for (const bpjs of ['JHT', 'JP', 'JKK', 'JKM', 'KESEHATAN'])
					assert.equal(counts('work_catalog', code).includes(bpjs), false, `${code} ${bpjs}`);
			// PPh 21 is fed only its cash parts; premiums and contributions come from the schemes' own charges.
			for (const table of ['work_catalog', 'allowance_catalog', 'adhoc_catalog'])
				for (const row of read(version, table))
					for (const target of fixtureValue4(row.counts_toward))
						if (target.startsWith('PPH21.'))
							assert.ok(
								['PPH21.ORDINARY', 'PPH21.ADDITIONAL'].includes(target),
								`${row.code} ${target}`
							);
			for (const code of ['PESANGON', 'UPMK', 'UANG_PISAH', 'PKWT_COMPENSATION']) {
				assert.ok(counts('adhoc_catalog', code).includes('PPH21_FINAL_SEVERANCE'), code);
				assert.equal(
					counts('adhoc_catalog', code).some((target) => target.startsWith('PPH21.')),
					false,
					code
				);
			}
			for (const code of ['THR', 'THR_HOLIDAY'])
				assert.equal(catalog(version, 'adhoc_catalog', code).destination, 'PAY');
		}
	});
	layer(workspace({ seed: 'none' }))('dependent ID payroll history', (it) => {
		it.effect(
			'an ID year settles through the engine: TER January to November, the art.17 reckoning in December',
			Effect.fnUntraced(function* () {
				const { COMPANY, tables, lines } = idWorld();
				return yield* world(tables).useRun((history) =>
					Effect.gen(function* () {
						const run = (month: string, kind: PayrollRunKind, sources?: string[]) =>
							history(fixtureKey(COMPANY), month, kind, sources?.map(fixtureId));
						const january = yield* run('2026-01', 'REGULAR');
						// Budi, K/1 (category B), 10,000,000, risk group II: PPh 21 gross adds JKK 54,000 + JKM 30,000 + Kesehatan
						// 400,000 = 10,484,000, TER B 1.5% = 157,260.
						assert.deepEqual(lines(january, 'p1'), {
							JHT: [200000, 370000],
							JP: [100000, 200000],
							JKK: [0, 54000],
							JKM: [0, 30000],
							KESEHATAN: [100000, 400000],
							PPH21: [157260, 0]
						});
						assert.equal(
							fixturePresent(
								january.payslips.find((slip) => slip.employment_id === fixtureKey('k-p1'))
							).net,
							10000000 - 200000 - 100000 - 100000 - 157260
						);
						// The PPh 21 line's base is the cash gross; premiums and contributions are read from the schemes' charges.
						const budi = fixturePresent(
							january.payslips.find((slip) => slip.employment_id === fixtureKey('k-p1'))
						);
						assert.equal(
							fixturePresent(budi.statutory.find((line) => line.scheme_code === 'PPH21'))
								.base_amount,
							10000000
						);
						// Sari, married woman without the kelurahan statement: TK/0 (A); 20,648,000 at 9% = 1,858,320.
						assert.equal(fixturePresent(lines(january, 'p2').PPH21)[0], 1858320);
						// Ken, non-resident: PPh 26 20% of the gross, no PPh 21 and no JP.
						assert.deepEqual(lines(january, 'p3').PPH26, [6000000, 0]);
						assert.equal('PPH21' in lines(january, 'p3') || 'JP' in lines(january, 'p3'), false);
						yield* run('2026-02', 'REGULAR');
						const march = yield* run('2026-03', 'REGULAR');
						assert.equal(fixturePresent(lines(march, 'p1').PPH21)[0], 157260);
						// THR in March, paid off-cycle: March gross 20,484,000 is TER B 8% = 1,638,720, less the 157,260 withheld.
						const thr = catalog('version_3', 'adhoc_catalog', 'THR_HOLIDAY');
						fixturePresent(tables.get('adhoc_catalog_entry')).push(
							fixtureRow({
								id: 't1',
								catalog_id: thr.id,
								employment_id: 'k-p1',
								company_id: COMPANY,
								payslip_id: null,
								occurred_on: '2026-03-13',
								amount: 1,
								activity: 'AWARD'
							})
						);
						const offCycle = yield* run('2026-03', 'OFF_CYCLE', ['t1']);
						assert.deepEqual(lines(offCycle, 'p1'), { PPH21: [1481460, 0] });
						const snapshotRows = Schema.decodeUnknownSync(
							Schema.fromJsonString(
								Schema.Array(
									Schema.Tuple([
										Schema.String,
										Schema.Array(Schema.Record(Schema.String, Schema.Json))
									])
								)
							)
						);
						// Statutory is never deferred: Budi's 10,000,000 bonus (THR_HOLIDAY) is paid off-cycle before the month's
						// regular run, inside it, or off-cycle after it. Every scheme settles the same month totals, employee and
						// employer, and the off-cycle slip paid first already withholds what the bonus adds to the month.
						const orderings = Effect.fnUntraced(function* (month: string, day: string) {
							const snapshot = JSON.stringify([...tables]);
							const restore = () => {
								const rows = snapshotRows(snapshot);
								tables.clear();
								for (const [name, held] of rows) tables.set(name, fixtureRows(held));
							};
							const settle = Effect.fnUntraced(function* (
								order: 'bonus-first' | 'together' | 'bonus-after'
							) {
								restore();
								const award = () =>
									fixturePresent(tables.get('adhoc_catalog_entry')).push(
										fixtureRow({
											id: `b${month}`,
											catalog_id: catalog('version_4', 'adhoc_catalog', 'THR_HOLIDAY').id,
											employment_id: 'k-p1',
											company_id: COMPANY,
											payslip_id: null,
											occurred_on: day,
											amount: 1,
											activity: 'AWARD'
										})
									);
								const plans = [];
								if (order === 'bonus-after') plans.push(yield* run(month, 'REGULAR'));
								award();
								if (order === 'together') plans.push(yield* run(month, 'REGULAR'));
								else plans.push(yield* run(month, 'OFF_CYCLE', [`b${month}`]));
								if (order === 'bonus-first') plans.push(yield* run(month, 'REGULAR'));
								const slips = plans.flatMap((plan) =>
									plan.payslips.filter((slip) => slip.employment_id === fixtureKey('k-p1'))
								);
								const totals: Record<string, [number, number]> = {};
								for (const line of slips.flatMap((slip) => slip.statutory)) {
									const held = (totals[line.scheme_code] ??= [0, 0]);
									held[0] = Math.round((held[0] + line.employee_amount) * 100) / 100;
									held[1] = Math.round((held[1] + line.employer_amount) * 100) / 100;
								}
								return {
									totals,
									gross: slips.reduce((sum, slip) => sum + slip.gross, 0),
									first: lines(fixturePresent(plans[0]), 'p1')
								};
							});
							const together = yield* settle('together');
							const first = yield* settle('bonus-first');
							const after = yield* settle('bonus-after');
							restore();
							assert.deepEqual(first.totals, together.totals, `${month}: bonus first`);
							assert.deepEqual(after.totals, together.totals, `${month}: bonus after`);
							assert.equal(first.gross, together.gross);
							assert.equal(after.gross, together.gross);
							for (const code of ['JHT', 'JP', 'JKK', 'JKM', 'KESEHATAN', 'PPH21'])
								assert.ok(code in together.totals, `${month}: ${code}`);
							return { together, first };
						});
						let june;
						for (const month of [
							'2026-04',
							'2026-05',
							'2026-06',
							'2026-07',
							'2026-08',
							'2026-09'
						]) {
							const plan = yield* run(month, 'REGULAR');
							if (month === '2026-06') june = plan;
						}
						// Dewi (TK/0, category A) leaves on 30 June, her last tax period. 10,484,000 a month is A's 2.5% bracket:
						// 5 × 262,100 withheld. The part year: 6 × 10,484,000 = 62,904,000, less biaya jabatan capped at 6 × 500,000
						// (PMK 168/2023 art.10(2) and its worked examples) and JHT/JP 1,800,000 = 58,104,000, less PTKP 54,000,000 =
						// PKP 4,104,000 at 5% = 205,200; the excess is returned.
						assert.equal(
							fixturePresent(lines(fixturePresent(june), 'p4').PPH21)[0],
							205200 - 5 * 262100
						);
						// October (version 4), TER B: the month is 20,484,000 at 8% = 1,638,720 in every order. Paid first, the
						// bonus slip withholds TER B on 10,000,000 salary + 10,000,000 bonus less TER B on the salary still to
						// come: 1,600,000 − 150,000 = 1,450,000 (before the pending-salary rule: 1.5% of the bonus alone, 150,000).
						const october = yield* orderings('2026-10', '2026-10-09');
						assert.deepEqual(october.together.totals.PPH21, [1638720, 0]);
						assert.deepEqual(october.first.first, { PPH21: [1450000, 0] });
						yield* run('2026-10', 'REGULAR');
						yield* run('2026-11', 'REGULAR');
						// December, the art.17 reckoning (PMK 168/2023 art.15). Together: the year's gross 12 × 10,484,000 + two THRs
						// 20,000,000 = 145,808,000, less biaya jabatan 6,000,000, JHT/JP 3,600,000 and PTKP K/1 63,000,000 = PKP
						// 73,208,000 → 4,981,200, less 3,211,320 withheld January to November = 1,769,880 in every order. Paid first,
						// the bonus slip withholds the reckoning on salary + bonus less the reckoning on the salary still to come —
						// the bonus at the 15% marginal rate, 1,500,000 — where it used to reckon the year without December's salary
						// and refund 560,120.
						const decemberOrders = yield* orderings('2026-12', '2026-12-04');
						assert.deepEqual(decemberOrders.together.totals.PPH21, [1769880, 0]);
						assert.deepEqual(decemberOrders.first.first, { PPH21: [1500000, 0] });
						const december = yield* run('2026-12', 'REGULAR');
						// Budi's year: gross 12 × 10,484,000 + THR 10,000,000 = 135,808,000; biaya jabatan capped at 6,000,000; JHT/JP
						// 3,600,000; PTKP K/1 63,000,000; PKP 63,208,000 → 3,000,000 + 15% × 3,208,000 = 3,481,200; withheld January
						// to November 10 × 157,260 + 1,638,720 = 3,211,320; December withholds the difference.
						assert.equal(fixturePresent(lines(december, 'p1').PPH21)[0], 269880);
						assert.equal(
							'k-p4' in
								Object.fromEntries(december.payslips.map((slip) => [slip.employment_id, 1])),
							false
						);
						// January 2027: the new year's first TER month settles the same in every order.
						const january2027 = yield* orderings('2027-01', '2027-01-08');
						assert.ok(
							fixturePresent(fixturePresent(january2027.first.first.PPH21)[0]) > 157260,
							'the THR is taxed in January'
						);
					})
				);
			}),
			// a whole year plus three bonus orderings in three months: about 20 engine runs
			60_000
		);
	});
	const BANK = resolve(process.cwd(), '../../seed_bank/norbital_hr/records/kdit');
	const bank = (name: string): Row[] =>
		readSeedRows(resolve(BANK), name).map((row) => bankRow(name, { ...row }));
	it('the KDIT sample records resolve every reference onto the ID lineage', {}, () => {
		const settings = versions.map(settingsOf);
		const versionOn = (day: string) =>
			fixturePresent(
				settings.find(
					(row) =>
						row.effective_range.from <= day &&
						(row.effective_range.to == null || day <= row.effective_range.to)
				)
			);
		const ids = (rows: readonly Row[]) => new Set(rows.map((row) => fixtureString(row.id)));
		const entity = fixturePresent(bank('entity')[0]);
		assert.equal(entity.settings_code, 'ID');
		for (const version of versions)
			assert.ok(
				fixtureString(entity.region) in payrollRules(version).minimum_wage.by_region,
				version
			);
		assert.ok(['I', 'II', 'III', 'IV', 'V'].includes(fixtureString(entity.risk_class)));
		const entityKeys = new Set(
			Object.keys(fixturePresent(settings[0]).entity_input_schema.properties)
		);
		for (const key of Object.keys(fixtureRecord(entity.facts))) assert.ok(entityKeys.has(key), key);
		const shifts = ids(bank('shift_definition'));
		const patterns = ids(bank('shift_pattern'));
		for (const pattern of bank('shift_pattern'))
			for (const cycle of fixtureRecords(fixtureRecord(pattern.pattern).days))
				if (cycle.roster_code_id != null && cycle.roster_code_id !== '')
					assert.ok(shifts.has(fixtureString(cycle.roster_code_id)));
		const profiles = bank('employment_profile');
		const statutory = new Map(
			versions.flatMap((version) =>
				read(version, 'statutory_contribution_catalog').map((row) => [row.id, row.code])
			)
		);
		const schema = fixturePresent(settings[0]).employee_input_schema.properties;
		const status = schemaProperties(schemaItems(schema.employment_statutory_facts)).status;
		const elections = new Set(Object.keys(schemaProperties(schemaProperties(status).elections)));
		const statusKeys = new Set(Object.keys(schemaProperties(status)));
		for (const profile of profiles) {
			assert.match(fixtureString(profile.nationality), /^[A-Z]{2}$/);
			assert.ok(
				profile.phone == null || /^\+\d{8,15}$/.test(fixtureString(profile.phone)),
				fixtureString(profile.name)
			);
			for (const fact of fixtureRecords(fixtureRecord(profile.facts).employment_statutory_facts)) {
				assert.ok(
					statutory.has(fixtureString(fact.statutory_contribution_id)),
					fixtureString(fact.id)
				);
				for (const key of Object.keys(fixtureRecord(fact.status)))
					assert.ok(statusKeys.has(key), key);
				for (const key of Object.keys(fixtureRecord(fixtureRecord(fact.status).elections ?? {})))
					assert.ok(elections.has(key), key);
			}
		}
		const termProperties = schemaProperties(schemaItems(schema.contract_terms));
		const termKeys = new Set(Object.keys(termProperties));
		const termFacts = new Set(Object.keys(schemaProperties(termProperties.facts)));
		const exitKeys = new Set(Object.keys(schemaProperties(schema.exit_facts)));
		const contracts = bank('employment_contract');
		const people = ids(profiles);
		const allowances = new Set(read('version_3', 'allowance_catalog').map((row) => row.code));
		for (const contract of contracts) {
			assert.ok(
				people.has(fixtureString(contract.employee_id)),
				fixtureString(contract.employee_number)
			);
			assert.equal(contract.company_id, entity.id);
			for (const key of Object.keys(fixtureRecord(contract.exit_facts ?? {})))
				assert.ok(exitKeys.has(key), key);
			for (const term of fixtureRecords(fixtureRecord(contract.facts).contract_terms)) {
				for (const key of Object.keys(term)) assert.ok(termKeys.has(key), key);
				for (const key of Object.keys(fixtureRecord(term.facts)))
					assert.ok(termFacts.has(key), key);
				assert.ok(patterns.has(fixtureString(term.shift_pattern_id)), fixtureString(term.id));
				assert.ok(
					schemaEnum(termProperties.residency_status).includes(fixtureString(term.residency_status))
				);
				for (const line of fixtureRecords(term.allowances))
					assert.ok(allowances.has(fixtureString(line.code)), fixtureString(line.code));
			}
		}
		const employments = ids(contracts);
		for (const name of ['roster', 'roster_entry', 'leave_catalog_entry', 'adhoc_catalog_entry'])
			for (const row of bank(name))
				assert.ok(employments.has(fixtureString(row.employment_id)), `${name} ${row.id}`);
		for (const row of bank('roster_entry'))
			assert.ok(shifts.has(fixtureString(row.shift_definition_id)), fixtureString(row.id));
		for (const [name, table] of [
			['leave_catalog_entry', 'leave_catalog'],
			['adhoc_catalog_entry', 'adhoc_catalog']
		] as const)
			for (const row of bank(name)) {
				const version = versionOn(fixtureString(row.occurred_on));
				assert.ok(
					read(fixturePresent(versions[settings.indexOf(version)]), table).some(
						(held) => held.id === row.catalog_id
					),
					`${name} ${row.id}`
				);
			}
		for (const holiday of bank('holiday')) assert.equal(holiday.company_id, entity.id);
	});
	it.effect(
		'the KDIT sample pays January and February 2026 through the engine',
		Effect.fnUntraced(function* () {
			const tables = fixtureTables();
			for (const version of versions)
				for (const name of ['jurisdiction_settings', ...CATALOGS])
					tables.set(
						name,
						fixtureRows([
							...(tables.get(name) ?? []),
							...read(version, name).map((row) => ({ ...row }))
						])
					);
			for (const file of readdirSync(BANK))
				tables.set(
					file.replace('.json', ''),
					fixtureRows(
						bank(file.replace('.json', '')).map((row) => ({
							...row
						}))
					)
				);
			for (const name of [
				'claim_catalog_entry',
				'loan_catalog_entry',
				'loan_repayment_entry',
				'payslip',
				'payroll_run'
			])
				tables.set(name, fixtureRows(tables.get(name) ?? []));
			const company = fixturePresent(bank('entity')[0]).id;
			const number = new Map(
				bank('employment_contract').map((row) => [row.id, row.employee_number])
			);
			const slips: Record<string, Record<string, Row>> = {};
			for (const period of ['2026-01', '2026-02']) {
				const plan = yield* world(tables).run(fixtureKey(company), period, 'REGULAR');
				slips[period] = Object.fromEntries(
					plan.payslips.map((slip) => [number.get(slip.employment_id), slip])
				);
			}
			const line = (period: string, who: string, code: string) =>
				guardFixture(
					Schema.Array(
						Schema.StructWithRest(
							Schema.Struct({
								scheme_code: Schema.String,
								employee_amount: Schema.Number,
								employer_amount: Schema.Number
							}),
							[Schema.Record(Schema.String, Schema.Json)]
						)
					)
				)(fixturePresent(fixturePresent(slips[period])[who]).statutory).find(
					(held) => held.scheme_code === code
				);
			// 14 employed in January (KDIT0016 starts 1 Feb), 14 in February (KDIT0001 left on 31 Jan).
			assert.equal(Object.keys(fixturePresent(slips['2026-01'])).length, 14);
			assert.equal(Object.keys(fixturePresent(slips['2026-02'])).length, 14);
			// KDIT0003's KESEHATAN election of one extra family member: 2% of 7,254,993, as the listing charges.
			assert.equal(
				fixturePresent(line('2026-02', 'KDIT0003', 'KESEHATAN')).employee_amount,
				145100
			);
			// JKK risk group III at 0.89%, as the listing's JKK column; no JP for the Japanese employee.
			assert.equal(fixturePresent(line('2026-02', 'KDIT0011', 'JKK')).employer_amount, 65670);
			const jp = line('2026-02', 'KDIT0014', 'JP');
			assert.equal((jp?.employee_amount ?? 0) + (jp?.employer_amount ?? 0), 0);
			// KDIT0001's exit month is his last tax period: the year's tax on one month is nil, as the listing withholds.
			assert.equal(fixturePresent(line('2026-01', 'KDIT0001', 'PPH21')).employee_amount, 0);
		})
	);
	it('validations: minimum wage, basic share, overtime limits and the deduction ceiling', () => {
		for (const version of versions) {
			const checks = Object.fromEntries(
				read(version, 'rule_set')
					.filter(
						(row) =>
							row.family === 'VALIDATIONS' &&
							!['roster', 'cycle'].includes(String(fixtureValue0(row.rules).site))
					)
					.map((row): [string, ReturnType<typeof fixtureContext>] => [
						fixtureString(row.code),
						fixtureContext(row.rules)
					])
			);
			assert.deepEqual(Object.keys(checks).toSorted(), [
				'BANKRUPTCY_CEILING',
				'BASIC_WAGE_SHARE',
				'CHILD_LIGHT_WORK_HOURS',
				'CHILD_WORKER',
				'DAILY_CASUAL_21_DAYS',
				'DAILY_MINIMUM_WAGE',
				'FOREIGN_WORKER_PERSONNEL_POSITION',
				'FOREIGN_WORKER_PKWT',
				'GARNISHMENT_CEILING',
				'HOURLY_MINIMUM_WAGE',
				'MEDAN_SECTOR_SCOPE_MISSING',
				'MINIMUM_AGE',
				'MINIMUM_WAGE_FLOOR',
				'MINIMUM_WAGE_LONG_SERVICE',
				'MINIMUM_WAGE_REGION_UNKNOWN',
				'NIGHT_WORK_FEMALE_DUTIES',
				'NIGHT_WORK_FEMALE_UNDER_18',
				'NIGHT_WORK_PREGNANCY',
				'OVERTIME_DAILY_LIMIT',
				'OVERTIME_WEEKLY_LIMIT',
				'PKWT_MAXIMUM_TERM',
				'PKWT_WRITTEN_INDONESIAN',
				'PROBATION_RULES',
				'SECTOR_KBLI_MISSING',
				'SECTOR_MINIMUM_WAGE',
				'SECTOR_MINIMUM_WAGE_UNSEEDED',
				'WAGE_DEDUCTION_CEILING',
				'WEEKLY_REST',
				'WORKING_DAYS_PER_WEEK_REQUIRED',
				'WORKING_TIME_LIMIT'
			]);
			for (const row of read(version, 'rule_set'))
				if (row.family === 'VALIDATIONS' && fixtureString(row.code) in checks)
					assert.ok(citationText(row.references).length > 0, fixtureString(row.code));
			const floor = version === 'version_1' ? 5396761 : 5729876;
			// A contract write: the term as the subject context builds it, plus `term` and `rules`.
			// A worker in the first year of service: the minimum wage binds below 12 months (UU 13/2003 art.88E(1)).
			const contract = (term: Row, company: Row = {}, service_months = 6) => {
				const base = subject({ terms: term, company, employment: { service_months } });
				return { ...base, rules: payrollRules(version), term: base.terms };
			};
			const trips = (code: string, context: Row) =>
				evaluateConfigured(
					fixtureString(fixturePresent(checks[code]).when),
					fixtureContext(context)
				) === true;
			// UU 13/2003 art.88E(2): the monthly wage may not be below the workplace UMK/UMP.
			assert.equal(
				trips('MINIMUM_WAGE_FLOOR', contract({ base_salary: floor - 1, monthly_wage: floor - 1 })),
				true
			);
			assert.equal(
				trips('MINIMUM_WAGE_FLOOR', contract({ base_salary: floor, monthly_wage: floor })),
				false
			);
			// Micro and small enterprises (PP 36/2021 art.36) and part-time pay are outside it.
			assert.equal(
				trips(
					'MINIMUM_WAGE_FLOOR',
					contract(
						{ base_salary: 1000000, monthly_wage: 1000000 },
						{ facts: { enterprise_size_class: 'MICRO_OR_SMALL' } }
					)
				),
				false
			);
			assert.equal(
				trips(
					'MINIMUM_WAGE_FLOOR',
					contract({
						base_salary: 1000000,
						monthly_wage: 1000000,
						employment_type: 'PART_TIME'
					})
				),
				false
			);
			assert.equal(
				trips(
					'MINIMUM_WAGE_FLOOR',
					contract({ base_salary: floor - 1, monthly_wage: floor - 1 }, {}, 12)
				),
				false
			);
			// Kep. Gubernur DKI 33/2026: the sector wage for the worksite KBLI, under one year of service, with its conditions.
			if (version !== 'version_1') {
				const sector = (term: Row, company: Row = {}, months = 6) =>
					trips(
						'SECTOR_MINIMUM_WAGE',
						contract({ base_salary: 5800000, monthly_wage: 5800000, ...term }, company, months)
					);
				assert.equal(sector({ facts: { worksite_kbli: '20118' } }), true); // 5,844,336
				assert.equal(sector({ facts: { worksite_kbli: '10437' } }), false); // 5,741,201
				assert.equal(sector({ facts: { worksite_kbli: '20118' } }, {}, 12), false);
				assert.equal(sector({ facts: { worksite_kbli: '14111' } }), false); // exporters only
				assert.equal(
					sector({ facts: { worksite_kbli: '14111' } }, { facts: { umsp_export_oriented: true } }),
					true
				);
				assert.equal(
					sector({ facts: { worksite_kbli: '20118' } }, { region: 'Provinsi Banten' }),
					false
				);
				assert.equal(
					sector(
						{ facts: { worksite_kbli: '86103', umsp_job_category: 'NURSING_MIDWIFERY' } },
						{ facts: { umsp_class_a_private_hospital: true } }
					),
					false
				); // 5,743,449 < 5,800,000
				assert.equal(
					fixturePresent(payrollRules(version).minimum_wage.by_sector['Provinsi DKI Jakarta'])
						.length,
					61
				);
			}
			// PP 36/2021 art.7(2): basic at least 75% of basic plus fixed allowances.
			assert.equal(
				trips('BASIC_WAGE_SHARE', contract({ base_salary: 7000000, monthly_wage: 10000000 })),
				true
			);
			assert.equal(
				trips('BASIC_WAGE_SHARE', contract({ base_salary: 7500000, monthly_wage: 10000000 })),
				false
			);
			// PP 35/2021 art.26: 4 hours a day, 18 in seven consecutive days; rest-day and holiday hours are outside.
			const slip = (days: Row[], lines: Row = {}, gross = 10000000) => ({
				...payslipOf({}, version),
				work: { overtime_hours: 0, incentive_hours: 0, dates: [], holidays: [], days },
				payslip: { gross, net: gross, total_deductions: 0, lines },
				statutory: {}
			});
			assert.equal(trips('OVERTIME_DAILY_LIMIT', slip([day({ overtime_hours: 5 })])), true);
			assert.equal(trips('OVERTIME_DAILY_LIMIT', slip([day({ overtime_hours: 4 })])), false);
			assert.equal(
				trips(
					'OVERTIME_DAILY_LIMIT',
					slip([day({ overtime_hours: 8, holiday_kind: 'PUBLIC_HOLIDAY' })])
				),
				false
			);
			const week = (hours: number, gap = 1) =>
				[0, 1, 2, 3, 4].map((offset) =>
					day({
						date: `2026-03-${String(2 + offset * gap).padStart(2, '0')}`,
						overtime_hours: hours
					})
				);
			assert.equal(trips('OVERTIME_WEEKLY_LIMIT', slip(week(4))), true);
			assert.equal(trips('OVERTIME_WEEKLY_LIMIT', slip(week(3.6))), false);
			assert.equal(trips('OVERTIME_WEEKLY_LIMIT', slip(week(4, 3))), false);
			// PP 36/2021 art.65: deductions at most 50% of the wage paid; statutory contributions are outside.
			assert.equal(trips('WAGE_DEDUCTION_CEILING', slip([], { STAFF_LOAN: -5000001 })), true);
			assert.equal(trips('WAGE_DEDUCTION_CEILING', slip([], { STAFF_LOAN: -5000000 })), false);
			assert.equal(
				trips(
					'WAGE_DEDUCTION_CEILING',
					slip([], { STAFF_LOAN: -3000000, CLAWBACK_OVERTIME: -2000000 }, 8000000)
				),
				false
			);
		}
	});
	it.effect(
		'a run warns on an overtime breach and holds a slip over the deduction ceiling',
		Effect.fnUntraced(function* () {
			const { COMPANY, tables, run } = idWorld();
			fixturePresent(tables.get('roster_entry')).push(
				fixtureRow({
					id: 'ot1',
					employment_id: 'k-p1',
					work_date: '2026-01-14',
					// 08:00–21:00 Jakarta on the 8-hour D shift, with 5 overtime hours planned.
					shift_definition_id: 'D',
					planned_overtime_hours: 5,
					worked_intervals: [
						{ start: '2026-01-14T01:00:00.000Z', end: '2026-01-14T14:00:00.000Z' }
					],
					payslip_id: null,
					facts: {}
				})
			);
			const loan = catalog('version_2', 'loan_catalog', 'STAFF_LOAN');
			fixturePresent(tables.get('loan_catalog_entry')).push(
				fixtureRow({
					id: 'l1',
					catalog_id: loan.id,
					employment_id: 'k-p2',
					company_id: COMPANY,
					advance_made_on: '2026-01-15',
					principal_amount: 11000000,
					repayment_period: { from: '2026-01-15', to: '2026-01-15' },
					facts: { written_agreement_reference: 'PK-2026-01' }
				})
			);
			fixturePresent(tables.get('loan_repayment_entry')).push(
				fixtureRow({
					id: 'l1-repayment',
					loan_id: 'l1',
					catalog_id: loan.id,
					employment_id: 'k-p2',
					company_id: COMPANY,
					payslip_id: null,
					occurred_on: '2026-01-15',
					amount: 11000000
				})
			);
			const plan = yield* run('2026-01', 'REGULAR');
			assert.ok(plan.warnings.some((line) => line.startsWith('Budi: Overtime above 4 hours')));
			const sari = fixturePresent(
				plan.payslips.find((slip) => slip.employment_id === fixtureKey('k-p2'))
			);
			assert.match(String(sari.hold), /exceed 50% of this wage payment/);
			assert.equal(
				fixturePresent(plan.payslips.find((slip) => slip.employment_id === fixtureKey('k-p1')))
					.hold,
				null
			);
		})
	);
	it('the new duties: annual WLKP, accident report, company regulations, payslip issue', () => {
		for (const version of versions) {
			const settings = settingsOf(version);
			const rows = read(version, 'rule_set');
			const raise = (collection: string, event: string, row: Row, extra: Row = {}) =>
				Object.fromEntries(
					raiseDuties({
						behaviours: settings.behaviours,
						settings_id: settings.id,
						rows,
						collection,
						event,
						row,
						...extra
					}).map((write) => [write.duty_code, write.due_on])
				);
			const run = (period: string, facts: Row, headcount = 12) =>
				raise(
					'payroll_run',
					'created',
					{ id: `r-${period}`, period, company_id: 'c1' },
					{ reads: { company: [{ region: 'Provinsi DKI Jakarta', facts }] }, headcount }
				);
			// UU 7/1981 art.8: the WLKP report on each anniversary of the first one.
			const wlkp = { wlkp_first_reported_on: '2023-12-04' };
			assert.equal(run('2026-12', wlkp).WLKP_ANNUAL_REPORT, '2026-12-04');
			assert.equal(run('2026-11', wlkp).WLKP_ANNUAL_REPORT, undefined);
			assert.equal(run('2023-12', wlkp).WLKP_ANNUAL_REPORT, undefined);
			// UU 13/2003 arts.108, 111(3): company regulations renewed when they lapse, for 10 or more workers.
			const lapse = { company_regulation_valid_until: '2026-12-15' };
			assert.equal(run('2026-12', lapse).COMPANY_REGULATION_RENEWAL, '2026-12-15');
			assert.equal(run('2026-12', lapse, 9).COMPANY_REGULATION_RENEWAL, undefined);
			// PP 44/2015 art.43: a work accident reported within 2 × 24 hours.
			const accident = (catalog_code: string) =>
				raise('leave_catalog_entry', 'created', {
					id: 'a1',
					company_id: 'c1',
					employment_id: 'k1',
					occurred_on: '2026-03-10',
					from: '2026-03-10',
					catalog_code
				});
			assert.equal(accident('WORK_ACCIDENT_LEAVE').WORK_ACCIDENT_REPORT, '2026-03-12');
			assert.equal(accident('ANNUAL_LEAVE').WORK_ACCIDENT_REPORT, undefined);
			// PP 36/2021 art.53(2): the wage slip when the wage is paid.
			const paid = raise('payslip', 'updated', {
				id: 's1',
				company_id: 'c1',
				employment_id: 'k1',
				paid_on: '2026-03-27'
			});
			assert.equal(paid.PAYSLIP_ISSUE, '2026-03-27');
			// PP 35/2021 art.28: overtime needs a written order and consent; an approved day without one raises it.
			// A day created with overtime raises it as an updated one does; an id it already raised for does not again.
			const day = (consent: string | null) => ({
				id: 'w1',
				company_id: 'c1',
				employment_id: 'k1',
				work_date: '2026-03-11',
				approved_overtime_hours: 2,
				overtime_consented_at: consent
			});
			for (const event of ['created', 'updated']) {
				assert.equal(
					raise('roster_entry', event, day(null)).OVERTIME_WRITTEN_ORDER,
					'2026-03-11',
					event
				);
				assert.equal(
					raise('roster_entry', event, day('2026-03-10T09:00:00.000Z')).OVERTIME_WRITTEN_ORDER,
					undefined,
					event
				);
				assert.equal(
					raise('roster_entry', event, { ...day(null), approved_overtime_hours: 0 })
						.OVERTIME_WRITTEN_ORDER,
					undefined,
					event
				);
			}
			// Created then updated: the second event meets the same occurrence key and raises nothing.
			assert.equal(
				raise('roster_entry', 'updated', day(null), { raisedAll: true }).OVERTIME_WRITTEN_ORDER,
				undefined
			);
			assert.deepEqual(
				rows
					.filter((row) => row.code === 'OVERTIME_WRITTEN_ORDER')
					.map((row) => fixtureValue0(fixtureRecord(row.rules).trigger).events),
				[['created', 'updated']]
			);
		}
	});
	it('family-event leave meters its UU 13/2003 art.93(4) days per event', () => {
		for (const version of versions) {
			const days = (code: string) => {
				const row = catalog(version, 'leave_catalog', code);
				assert.equal(entitlementOf(row).window, 'EVENT', code);
				return evaluateConfigured(
					fixtureString(entitlementOf(row).days),
					fixtureContext({ service_months: 1, bands: [] })
				);
			};
			assert.deepEqual(
				[
					'MARRIAGE_LEAVE',
					'CHILD_MARRIAGE_LEAVE',
					'CHILD_CIRCUMCISION_LEAVE',
					'CHILD_BAPTISM_LEAVE',
					'PATERNITY_LEAVE',
					'BEREAVEMENT_LEAVE',
					'BEREAVEMENT_HOUSEHOLD_LEAVE',
					'MENSTRUAL_LEAVE'
				].map(days),
				[3, 2, 2, 2, 2, 2, 1, 2]
			);
			assert.equal(catalog(version, 'leave_catalog', 'WORK_ACCIDENT_LEAVE').encash_on_exit, false);
		}
	});
	it('PPh 21 part-year reckoning reproduces the PMK 168/2023 worked examples (Tuan B and Tuan C)', () => {
		for (const version of versions) {
			const pph21 = scheme(version, 'PPH21');
			const december = (terms: Row, employee: Row, jht: number) =>
				fixtureValue0(
					assess(
						pph21,
						{ ordinary: 15500000, additional: 0 },
						{
							subject: subject({
								terms: { monthly_wage: 0, ...terms },
								employee: { marital_status: 'SINGLE', dependents_count: 0, ...employee },
								employment: { start_date: '2026-09-01' }
							}),
							period: '2026-12',
							year: { ordinary: 46500000, additional: 0 },
							charged: {
								month: { JHT: { employee: jht } },
								year: { JHT: { employee: 3 * jht }, PPH21: { employee: 3255000 } }
							}
						}
					)
				).employee;
			// Tuan B: resident all year, joins 1 September: biaya jabatan at most 4 × 500,000, no annualisation;
			// 62,000,000 − 2,000,000 − 400,000 − 54,000,000 = 5,600,000 at 5% = 280,000, less 3,255,000 withheld.
			assert.equal(december({}, {}, 100000), 280000 - 3255000);
			// Tuan C: becomes a resident on 1 September (art.15(3)): net 62,000,000 − 2,000,000 − zakat 3,100,000 =
			// 56,900,000 annualised × 12/4 = 170,700,000; PKP 116,700,000 → 11,505,000 × 4/12 = 3,835,000.
			assert.equal(
				december(
					{ facts: { tax_subject_from: '2026-09-01' } },
					{ facts: { zakat_monthly: 775000 } },
					0
				),
				3835000 - 3255000
			);
		}
	});
	it('THR is raised 7 days before each named religious holiday', () => {
		for (const version of versions) {
			const settings = settingsOf(version);
			const thr = (period: string, holidays: Row[]) =>
				Object.fromEntries(
					raiseDuties({
						behaviours: settings.behaviours,
						settings_id: settings.id,
						rows: read(version, 'rule_set'),
						collection: 'payroll_run',
						event: 'created',
						row: { id: `r-${period}`, period, company_id: 'c1' },
						reads: { company: [{ region: 'Provinsi DKI Jakarta', facts: {} }], holidays }
					}).map((write) => [write.duty_code, write.due_on])
				).THR_PAYMENT;
			const kdit = [
				{ date: '2026-03-20', name: 'Eid al-Fitr 1447 Hijri', kind: 'PUBLIC_HOLIDAY' },
				{ date: '2026-03-21', name: 'Eid al-Fitr 1447 Hijri', kind: 'PUBLIC_HOLIDAY' },
				{ date: '2026-05-31', name: 'Vesak Day 2570 BE', kind: 'PUBLIC_HOLIDAY' },
				{
					date: '2026-08-17',
					name: 'Independence Day of the Republic of Indonesia',
					kind: 'PUBLIC_HOLIDAY'
				}
			];
			// Permenaker 6/2016 art.5(4): at the latest 7 days before the holiday.
			assert.equal(thr('2026-03', kdit), '2026-03-13');
			assert.equal(thr('2026-05', kdit), '2026-05-24');
			assert.equal(thr('2026-08', kdit), undefined);
			assert.equal(thr('2026-04', kdit), undefined);
		}
	});
	it.effect(
		'an off-cycle THR run before or after the regular run settles to the same month totals',
		Effect.fnUntraced(function* () {
			const month = Effect.fnUntraced(function* (thrFirst: boolean) {
				const { COMPANY, tables, run } = idWorld();
				yield* run('2026-01', 'REGULAR');
				yield* run('2026-02', 'REGULAR');
				const thr = catalog('version_3', 'adhoc_catalog', 'THR_HOLIDAY');
				// The THR is entered when it is paid: before the regular run, or after it.
				const enter = () =>
					fixturePresent(tables.get('adhoc_catalog_entry')).push(
						fixtureRow({
							id: 't1',
							catalog_id: thr.id,
							employment_id: 'k-p1',
							company_id: COMPANY,
							payslip_id: null,
							occurred_on: '2026-03-13',
							amount: 1,
							activity: 'AWARD'
						})
					);
				const plans = [];
				if (thrFirst) {
					enter();
					plans.push(yield* run('2026-03', 'OFF_CYCLE', ['t1']), yield* run('2026-03', 'REGULAR'));
				} else {
					plans.push(yield* run('2026-03', 'REGULAR'));
					enter();
					plans.push(yield* run('2026-03', 'OFF_CYCLE', ['t1']));
				}
				const totals: Record<string, [number, number]> = {};
				for (const plan of plans)
					for (const slip of plan.payslips.filter(
						(slip) => slip.employment_id === fixtureKey('k-p1')
					))
						for (const line of slip.statutory) {
							const held = (totals[line.scheme_code] ??= [0, 0]);
							held[0] = Math.round((held[0] + line.employee_amount) * 100) / 100;
							held[1] = Math.round((held[1] + line.employer_amount) * 100) / 100;
						}
				const gross = plans
					.flatMap((plan) =>
						plan.payslips.filter((slip) => slip.employment_id === fixtureKey('k-p1'))
					)
					.reduce((sum, slip) => sum + slip.gross, 0);
				return { totals, gross };
			});
			const after = yield* month(false);
			const before = yield* month(true);
			assert.deepEqual(before, after);
			// The month's PPh 21 is TER B 8% on 10,000,000 + THR 10,000,000 + premiums 484,000, whichever run goes first.
			assert.equal(fixturePresent(after.totals.PPH21)[0], 1638720);
			assert.equal(after.gross, 20000000);
			for (const code of ['JHT', 'JP', 'JKK', 'JKM', 'KESEHATAN'])
				assert.ok(
					fixturePresent(after.totals[code])[0] + fixturePresent(after.totals[code])[1] > 0,
					code
				);
		})
	);
	it('wave 2: a cash compensation is employment income for PPh 21/26 and outside the BPJS wage (UU PPh art.4(1)(a))', () => {
		for (const version of versions)
			assert.deepEqual(catalog(version, 'adhoc_catalog', 'COMPENSATION').counts_toward, [
				'PPH21.ADDITIONAL',
				'PPH26'
			]);
	});
});
describe('ID round 7: the whole law, row by row', () => {
	const checksOf = (version: string) =>
		Object.fromEntries(
			read(version, 'rule_set')
				.filter((row) => row.family === 'VALIDATIONS')
				.map((row) => [row.code, row.rules])
		);
	const contractCtx = (
		version: string,
		over: Parameters<typeof subject>[0] = {},
		day = '2026-03-02'
	) => {
		const base = subject({ ...over, employment: { service_months: 6, ...over.employment } });
		return { ...base, rules: payrollRules(version), term: base.terms, day };
	};
	const trips = (version: string, code: string, context: Row) =>
		evaluateConfigured(fixtureString(checksOf(version)[code].when), fixtureContext(context)) ===
		true;
	const slipCtx = (
		version: string,
		days: Row[],
		over: Parameters<typeof subject>[0] = {},
		lines: Row = {},
		gross = 10000000
	) => ({
		...payslipOf(over, version),
		work: { overtime_hours: 0, incentive_hours: 0, dates: [], holidays: [], days },
		payslip: { gross, net: gross, total_deductions: 0, lines },
		statutory: {}
	});
	const DKI = (version: string) => (version === 'version_1' ? 5396761 : 5729876);
	const ctxEntry = (facts: Row, earlierRows: Row[] = []) => ({
		entry: entry(facts),
		earlier: { rows: earlierRows, calendar_year: 0, lifetime: 0 }
	});
	const priceAdhoc = (
		version: string,
		code: string,
		over: Parameters<typeof subject>[0],
		facts: Row,
		earlierRows: Row[] = [],
		amount = 500000
	) => {
		const row = catalog(version, 'adhoc_catalog', code);
		const context = { ...payslipOf(over, version), ...ctxEntry(facts, earlierRows) };
		context.entry.amount = amount;
		for (const guard of [row.eligibility, row.qualifies_when])
			if (guard && evaluateConfigured(fixtureString(guard), fixtureContext(context)) !== true)
				return null;
		return Number(
			evaluateConfigured(
				fixtureString(fixturePresent(bandsOf(row)[0]).amount),
				fixtureContext(context)
			)
		);
	};
	it('ID-SETTINGS-3: every kota and kabupaten of the 38 provinces carries its decree UMK, or the UMP', () => {
		// BPS: the 514 kota and kabupaten; DKI Jakarta's six administrative ones share the UMP (the bare key).
		const LOCALITIES: Record<string, number> = {
			Aceh: 23,
			'Sumatera Utara': 33,
			'Sumatera Barat': 19,
			Riau: 12,
			Jambi: 11,
			'Sumatera Selatan': 17,
			Bengkulu: 10,
			Lampung: 15,
			'Kepulauan Bangka Belitung': 7,
			'Kepulauan Riau': 7,
			'DKI Jakarta': 0,
			'Jawa Barat': 27,
			'Jawa Tengah': 35,
			'DI Yogyakarta': 5,
			'Jawa Timur': 38,
			Banten: 8,
			Bali: 9,
			'Nusa Tenggara Barat': 10,
			'Nusa Tenggara Timur': 22,
			'Kalimantan Barat': 14,
			'Kalimantan Tengah': 14,
			'Kalimantan Selatan': 13,
			'Kalimantan Timur': 10,
			'Kalimantan Utara': 5,
			'Sulawesi Utara': 15,
			'Sulawesi Tengah': 13,
			'Sulawesi Selatan': 24,
			'Sulawesi Tenggara': 17,
			Gorontalo: 6,
			'Sulawesi Barat': 6,
			Maluku: 11,
			'Maluku Utara': 10,
			Papua: 9,
			'Papua Barat': 7,
			'Papua Tengah': 8,
			'Papua Pegunungan': 8,
			'Papua Selatan': 4,
			'Papua Barat Daya': 6
		};
		assert.equal(Object.keys(LOCALITIES).length, 38);
		assert.equal(
			Object.values(LOCALITIES).reduce((a: number, b: number) => a + b, 0),
			508
		);
		// UMPs hard-coded from the governors' decrees (2026) and the Kemnaker list with its sen (2025).
		const UMP: Record<string, Record<string, number>> = {
			version_1: {
				Aceh: 3685616,
				'Sumatera Utara': 2992559,
				'Sumatera Barat': 2994193.47,
				Riau: 3508776.22,
				Jambi: 3234535,
				'Sumatera Selatan': 3681571,
				Bengkulu: 2670039.39,
				Lampung: 2893070,
				'Kepulauan Bangka Belitung': 3876600,
				'Kepulauan Riau': 3623654,
				'DKI Jakarta': 5396761,
				'Jawa Barat': 2191232.18,
				'Jawa Tengah': 2169349,
				'DI Yogyakarta': 2264080.95,
				'Jawa Timur': 2305985,
				Banten: 2905119.9,
				Bali: 2996561,
				'Nusa Tenggara Barat': 2602931,
				'Nusa Tenggara Timur': 2328969.69,
				'Kalimantan Barat': 2878286,
				'Kalimantan Tengah': 3473621.04,
				'Kalimantan Selatan': 3496195,
				'Kalimantan Timur': 3579313.77,
				'Kalimantan Utara': 3580160,
				'Sulawesi Utara': 3775425,
				'Sulawesi Tengah': 2915000,
				'Sulawesi Selatan': 3657527.37,
				'Sulawesi Tenggara': 3073551.7,
				Gorontalo: 3221731,
				'Sulawesi Barat': 3104430,
				Maluku: 3141700,
				'Maluku Utara': 3408000,
				Papua: 4285850,
				'Papua Barat': 3615000,
				'Papua Tengah': 4285848,
				'Papua Pegunungan': 4285850,
				'Papua Selatan': 4285850,
				'Papua Barat Daya': 3614000
			},
			version_2: {
				Aceh: 3932552,
				'Sumatera Utara': 3228971,
				'Sumatera Barat': 3182955,
				Riau: 3780495.85,
				Jambi: 3471497,
				'Sumatera Selatan': 3942963,
				Bengkulu: 2827250.9,
				Lampung: 3047734,
				'Kepulauan Bangka Belitung': 4035000,
				'Kepulauan Riau': 3879520,
				'DKI Jakarta': 5729876,
				'Jawa Barat': 2317601,
				'Jawa Tengah': 2327386.07,
				'DI Yogyakarta': 2417495,
				'Jawa Timur': 2446880,
				Banten: 3100881.4,
				Bali: 3207459,
				'Nusa Tenggara Barat': 2673861,
				'Nusa Tenggara Timur': 2455898,
				'Kalimantan Barat': 3054552,
				'Kalimantan Tengah': 3686138,
				'Kalimantan Selatan': 3725000,
				'Kalimantan Timur': 3762431,
				'Kalimantan Utara': 3775243,
				'Sulawesi Utara': 4002630,
				'Sulawesi Tengah': 3179565,
				'Sulawesi Selatan': 3921088.79,
				'Sulawesi Tenggara': 3306496.18,
				Gorontalo: 3405144,
				'Sulawesi Barat': 3315934,
				Maluku: 3334490,
				'Maluku Utara': 3510240,
				Papua: 4436283,
				'Papua Barat': 3841000,
				'Papua Tengah': 4285848,
				'Papua Pegunungan': 4508714,
				'Papua Selatan': 4508100,
				'Papua Barat Daya': 3766000
			}
		};
		UMP.version_3 = fixturePresent(UMP.version_2);
		UMP.version_4 = fixturePresent(UMP.version_3);
		// Spot values per province, hard-coded from the decrees (2026) and the restated 2025 figures.
		const UMK: Record<string, Record<string, number>> = {
			version_1: {
				'Aceh/Kota Banda Aceh': 3898856,
				'Aceh/Kabupaten Aceh Tamiang': 3717948,
				'Sumatera Utara/Kota Medan': 4014072,
				'Sumatera Utara/Kabupaten Batu Bara': 3676000,
				'Jambi/Kota Jambi': 3607223,
				'Sumatera Selatan/Kabupaten Musi Rawas Utara': 3796654,
				'Bengkulu/Kabupaten Mukomuko': 3052118.99,
				'Nusa Tenggara Barat/Kabupaten Lombok Barat': 2602931,
				'Nusa Tenggara Barat/Kota Mataram': 2859620,
				'Nusa Tenggara Timur/Kota Kupang': 2396697,
				'Kalimantan Barat/Kabupaten Ketapang': 3396267.26,
				'Kalimantan Tengah/Kabupaten Barito Utara': 3900362.43,
				'Kalimantan Selatan/Kabupaten Kotabaru': 3643004,
				'Kalimantan Timur/Kabupaten Berau': 4081376.31,
				'Kalimantan Timur/Kabupaten Mahakam Ulu': 3953233,
				'Kalimantan Utara/Kota Tarakan': 4460405,
				'Sulawesi Utara/Kota Manado': 3824264,
				'Sulawesi Tengah/Kabupaten Morowali Utara': 3925456,
				'Sulawesi Selatan/Kota Makassar': 3880136,
				'Sulawesi Tenggara/Kabupaten Kolaka': 3349714.11,
				'Sulawesi Barat/Kabupaten Mamuju': 3122680,
				'Maluku/Kota Ambon': 3185733,
				'Maluku Utara/Kota Ternate': 3461250,
				'Papua Tengah/Kabupaten Mimika': 5005678,
				'Jawa Barat/Kota Bekasi': 5690752.95,
				'Lampung/Kabupaten Pesawaran': 2893070
			},
			version_2: {
				'Aceh/Kota Banda Aceh': 4162965,
				'Aceh/Kabupaten Aceh Tamiang': 3978204,
				'Aceh/Kabupaten Simeulue': 3932552,
				'Sumatera Utara/Kota Medan': 4335198,
				'Sumatera Utara/Kabupaten Deli Serdang': 4041543,
				'Sumatera Utara/Kabupaten Toba': 3404422.49,
				'Sumatera Utara/Kota Pematangsiantar': 3228971,
				'Sumatera Barat/Kota Padang': 3182955,
				'Riau/Kota Dumai': 4431174.69,
				'Jambi/Kabupaten Tanjung Jabung Timur': 3486521,
				'Sumatera Selatan/Kota Palembang': 4192837,
				'Sumatera Selatan/Kabupaten Muara Enim': 4178363,
				'Bengkulu/Kota Bengkulu': 3089218.66,
				'Lampung/Kota Bandar Lampung': 3491889,
				'Kepulauan Riau/Kota Batam': 5357982,
				'Kepulauan Bangka Belitung/Kabupaten Belitung': 4035000,
				'Jawa Barat/Kabupaten Bekasi': 5938885,
				'Jawa Barat/Kota Bekasi': 5999443,
				'Jawa Tengah/Kota Semarang': 3701709,
				'Jawa Timur/Kota Surabaya': 5288796,
				'Banten/Kota Cilegon': 5469922.59,
				'DI Yogyakarta/Kota Yogyakarta': 2827593,
				'Bali/Kabupaten Badung': 3791002.57,
				'Nusa Tenggara Barat/Kabupaten Sumbawa Barat': 3136468,
				'Nusa Tenggara Timur/Kota Kupang': 2532853,
				'Kalimantan Barat/Kota Pontianak': 3205220,
				'Kalimantan Tengah/Kota Palangka Raya': 3724677.99,
				'Kalimantan Selatan/Kota Banjarbaru': 3843037.66,
				'Kalimantan Selatan/Kabupaten Balangan': 3725000,
				'Kalimantan Timur/Kota Balikpapan': 3856694.43,
				'Kalimantan Timur/Kabupaten Kutai Barat': 4231617.4,
				'Kalimantan Timur/Kabupaten Mahakam Ulu': 3762431,
				'Kalimantan Utara/Kota Tarakan': 4742169,
				'Sulawesi Utara/Kota Manado': 4022017,
				'Sulawesi Tengah/Kota Palu': 3619466.72,
				'Sulawesi Selatan/Kabupaten Pangkajene dan Kepulauan': 4032248,
				'Sulawesi Selatan/Kabupaten Gowa': 3921088.79,
				'Sulawesi Tenggara/Kota Kendari': 3516070,
				'Gorontalo/Kota Gorontalo': 3405144,
				'Sulawesi Barat/Kabupaten Pasangkayu': 3564798,
				'Maluku/Kota Ambon': 3381225,
				'Maluku Utara/Kota Ternate': 3599562,
				'Papua/Kota Jayapura': 4436283,
				'Papua Barat/Kabupaten Teluk Bintuni': 3841000,
				'Papua Tengah/Kabupaten Mimika': 5005678,
				'Papua Pegunungan/Kabupaten Jayawijaya': 4508714,
				'Papua Selatan/Kabupaten Merauke': 4508100,
				'Papua Barat Daya/Kota Sorong': 3766000
			}
		};
		UMK.version_3 = fixturePresent(UMK.version_2);
		UMK.version_4 = fixturePresent(UMK.version_3);
		for (const version of versions) {
			const table = payrollRules(version).minimum_wage.by_region;
			const ump = fixturePresent(UMP[version]);
			for (const [province, count] of Object.entries(LOCALITIES)) {
				const key = `Provinsi ${province}`;
				const localities = Object.keys(table).filter((k) => k.startsWith(`${key}/`));
				assert.equal(localities.length, count, `${version} ${province}`);
				// A province with localities keeps no bare key (it would floor a UMK worksite at the UMP).
				assert.equal(key in table, count === 0, `${version} ${key}`);
				if (count === 0) assert.equal(table[key], ump[province], key);
				// No locality sits below its UMP; a locality without a UMK sits at it.
				for (const k of localities)
					assert.ok(
						fixturePresent(table[k]) >= fixturePresent(ump[province]),
						`${version} ${k} ${table[k]}`
					);
			}
			assert.equal(Object.keys(table).length, 509);
			for (const [name, value] of Object.entries(fixturePresent(UMK[version])))
				assert.equal(table[`Provinsi ${name}`], value, `${version} ${name}`);
		}
		// Lampung regression: versions 2 and 3 list the ten regencies at the 2026 UMP, as version 1 did at 2025's.
		for (const version of ['version_2', 'version_3']) {
			const table = fixtureValue0(payrollRules(version).minimum_wage.by_region);
			for (const regency of [
				'Pesawaran',
				'Pringsewu',
				'Tulang Bawang',
				'Tulang Bawang Barat',
				'Pesisir Barat',
				'Lampung Tengah',
				'Lampung Timur',
				'Lampung Utara',
				'Tanggamus',
				'Lampung Barat'
			])
				assert.equal(table[`Provinsi Lampung/Kabupaten ${regency}`], 3047734, regency);
		}
		// The 2025 and 2026 tables list the same localities.
		assert.deepEqual(
			Object.keys(payrollRules('version_1').minimum_wage.by_region).toSorted(),
			Object.keys(payrollRules('version_3').minimum_wage.by_region).toSorted()
		);
	});
	it('ID-SETTINGS-4/9, ID-CONTRIBUTION-8: the floors read the worksite; an unseeded worksite refuses; basic alone against the minimum', () => {
		for (const version of versions) {
			const at = (region: string, wage: number, extra: Row = {}) =>
				contractCtx(version, {
					terms: {
						base_salary: wage,
						monthly_wage: wage,
						facts: { worksite_region: region, working_days_per_week: 5 },
						...extra
					}
				});
			const medan = version === 'version_1' ? 4014072 : 4335198;
			assert.equal(
				trips(version, 'MINIMUM_WAGE_FLOOR', at('Provinsi Sumatera Utara/Kota Medan', medan - 1)),
				true
			);
			assert.equal(
				trips(version, 'MINIMUM_WAGE_FLOOR', at('Provinsi Sumatera Utara/Kota Medan', medan)),
				false
			);
			// The company sits in DKI, the worker in Medan: Medan's UMK, not DKI's UMP, binds.
			assert.equal(
				trips(version, 'MINIMUM_WAGE_FLOOR', at('Provinsi Sumatera Utara/Kota Medan', 5000000)),
				false
			);
			// Every locality is listed (Langkat at its UMK); the province key of a province whose localities are
			// listed, and a locality that is not one, refuse — neither falls back to the lower UMP.
			const langkat = version === 'version_1' ? 3134660 : 3402892;
			assert.equal(
				trips(
					version,
					'MINIMUM_WAGE_REGION_UNKNOWN',
					at('Provinsi Sumatera Utara/Kabupaten Langkat', 5000000)
				),
				false
			);
			assert.equal(
				trips(
					version,
					'MINIMUM_WAGE_FLOOR',
					at('Provinsi Sumatera Utara/Kabupaten Langkat', langkat - 1)
				),
				true
			);
			for (const unknown of [
				'Provinsi Sumatera Utara',
				'Provinsi Sumatera Utara/Kabupaten Atlantis'
			])
				assert.equal(
					trips(version, 'MINIMUM_WAGE_REGION_UNKNOWN', at(unknown, 5000000)),
					true,
					unknown
				);
			assert.equal(
				trips(version, 'MINIMUM_WAGE_REGION_UNKNOWN', at('Provinsi DKI Jakarta', 6000000)),
				false
			);
			assert.equal(
				trips(
					version,
					'MINIMUM_WAGE_REGION_UNKNOWN',
					at('Provinsi Sumatera Utara/Kota Medan', 5000000)
				),
				false
			);
			assert.equal(
				trips(version, 'MINIMUM_WAGE_REGION_UNKNOWN', {
					...at('Atlantis', 1),
					company: { region: 'Atlantis', facts: { enterprise_size_class: 'MICRO_OR_SMALL' } }
				}),
				false
			);
			// PP 36/2021 art.23(2): basic 5,000,000 plus non-fixed allowances — the basic alone is compared.
			assert.equal(
				trips(
					version,
					'MINIMUM_WAGE_FLOOR',
					contractCtx(version, {
						terms: {
							base_salary: 5000000,
							monthly_wage: 5000000,
							facts: { non_fixed_allowances_monthly: 2000000 }
						}
					})
				),
				true
			);
			// Perpres 82/2018 art.32: the BPJS Kesehatan wage is floored at the worksite's minimum.
			const kes = (region: string) =>
				assess(
					scheme(version, 'KESEHATAN'),
					{ ordinary: 3000000 },
					{ subject: subject({ terms: { facts: { worksite_region: region } } }), version }
				);
			assert.deepEqual(kes('Provinsi Sumatera Utara/Kota Medan'), {
				employee: Math.round(medan * 0.01),
				employer: Math.round(medan * 0.04),
				parts: { ordinary: medan }
			});
			assert.equal(kes('Provinsi Sumatera Utara'), 'REFUSED');
		}
	});
	it('ID-SETTINGS-9/10: daily and hourly minimum wages (÷25 / ÷21, ÷126)', () => {
		for (const version of versions) {
			const floor = DKI(version);
			const daily = (daily_wage: number | undefined, week?: number) =>
				trips(
					version,
					'DAILY_MINIMUM_WAGE',
					contractCtx(version, {
						terms: {
							employment_type: 'DAILY',
							facts: {
								...(daily_wage == null ? {} : { daily_wage }),
								...(week == null ? {} : { working_days_per_week: week })
							}
						}
					})
				);
			assert.equal(daily(Math.floor(floor / 21), 5), true);
			assert.equal(daily(Math.ceil(floor / 21), 5), false);
			assert.equal(daily(Math.floor(floor / 25), 6), true);
			assert.equal(daily(Math.ceil(floor / 25), 6), false);
			assert.equal(daily(Math.ceil(floor / 21)), true); // the working days a week is required
			const hourly = (hourly_wage: number) =>
				trips(
					version,
					'HOURLY_MINIMUM_WAGE',
					contractCtx(version, { terms: { employment_type: 'PART_TIME', facts: { hourly_wage } } })
				);
			assert.equal(hourly(Math.floor(floor / 126)), true);
			assert.equal(hourly(Math.ceil(floor / 126)), false);
		}
	});
	it('ID-SETTINGS-8: sector minimum wages outside DKI (Bali, Badung, Lampung) at the worksite', () => {
		for (const version of ['version_2', 'version_3']) {
			const sector = (region: string, kbli: string, wage: number, star?: number) =>
				trips(
					version,
					'SECTOR_MINIMUM_WAGE',
					contractCtx(version, {
						terms: {
							base_salary: wage,
							monthly_wage: wage,
							facts: { worksite_region: region, worksite_kbli: kbli }
						},
						company: {
							region: 'Provinsi DKI Jakarta',
							facts: star == null ? {} : { umsp_hotel_star: star }
						}
					})
				);
			assert.equal(sector('Provinsi Bali/Kabupaten Buleleng', '55110', 3267692), true);
			assert.equal(sector('Provinsi Bali/Kabupaten Buleleng', '55110', 3267693), false);
			assert.equal(sector('Provinsi Bali/Kabupaten Badung', '55110', 3828912, 4), true);
			assert.equal(sector('Provinsi Bali/Kabupaten Badung', '55110', 3828912, 3), false);
			assert.equal(sector('Provinsi Lampung', '10434', 3108688), true);
			assert.equal(sector('Provinsi Lampung', '10433', 3108688), false);
		}
	});
	it('ID-SETTINGS-8/15: the 2026 sector minimum wages by KBLI (code or group) across the provinces', () => {
		for (const version of ['version_2', 'version_3']) {
			const sector = (
				region: string,
				kbli: string,
				wage: number,
				facts: Row = {},
				size = 'OTHER',
				employee: Row = {}
			) =>
				trips(
					version,
					'SECTOR_MINIMUM_WAGE',
					contractCtx(version, {
						employee,
						terms: {
							base_salary: wage,
							monthly_wage: wage,
							facts: { worksite_region: region, worksite_kbli: kbli }
						},
						company: {
							region: 'Provinsi DKI Jakarta',
							facts: { enterprise_size_class: size, ...facts }
						}
					})
				);
			// Each pair: the decree's amount less one rupiah refuses, the amount itself passes.
			const at = (
				region: string,
				kbli: string,
				amount: number,
				facts: Row = {},
				employee: Row = {}
			) => {
				assert.equal(
					sector(region, kbli, amount - 1, facts, 'OTHER', employee),
					true,
					`${region} ${kbli}`
				);
				assert.equal(
					sector(region, kbli, amount, facts, 'OTHER', employee),
					false,
					`${region} ${kbli}`
				);
			};
			// Jawa Barat Kep. 561.7/Kep.876-Kesra/2025 (revoking Kep. 863): Kota Bekasi 6,028,033, Karawang 5,910,371.
			at('Provinsi Jawa Barat/Kota Bekasi', '29101', 6028033);
			at('Provinsi Jawa Barat/Kabupaten Bekasi', '06100', 5941759);
			at('Provinsi Jawa Barat/Kabupaten Karawang', '42220', 5910371);
			at('Provinsi Jawa Barat/Kabupaten Cianjur', '11051', 3317787);
			at('Provinsi Jawa Barat/Kabupaten Purwakarta', '29100', 5957247);
			// Purwakarta's two KBLI 20302 rows: polyester 5,062,344; rayon viscose 5,193,876.
			at('Provinsi Jawa Barat/Kabupaten Purwakarta', '20302', 5062344);
			at('Provinsi Jawa Barat/Kabupaten Purwakarta', '20302', 5193876, {
				umsp_rayon_viscose: true
			});
			// A micro or small enterprise is outside them (Kep. 876 diktum KETIGA: medium and large).
			assert.equal(
				sector('Provinsi Jawa Barat/Kota Bekasi', '29101', 5999443, {}, 'MICRO_OR_SMALL'),
				false
			);
			// An uncovered KBLI pays the UMK only.
			assert.equal(sector('Provinsi Jawa Barat/Kota Bekasi', '47111', 5999443), false);
			// Jawa Timur: the UMSP 2,571,426.91 binds every locality; Surabaya's UMSK 5,444,909 (Kep. 938) its KBLI.
			at('Provinsi Jawa Timur/Kabupaten Situbondo', '12012', 2571426.91);
			at('Provinsi Jawa Timur/Kota Surabaya', '55111', 5444909);
			at('Provinsi Jawa Timur/Kabupaten Probolinggo', '43211', 3317559);
			// Jawa Tengah UMSP (Kep. 504) and UMSK (Kep. 505 Lampiran II).
			at('Provinsi Jawa Tengah/Kabupaten Banjarnegara', '10721', 2334768.22);
			at('Provinsi Jawa Tengah/Kabupaten Demak', '82920', 3137685);
			at('Provinsi Jawa Tengah/Kota Semarang', '42930', 3721126);
			// Banten Kep. 704/2025: Lebak sector 1, Kabupaten Tangerang sector 1A, Cilegon sector 1, Tangerang Selatan II.
			at('Provinsi Banten/Kabupaten Lebak', '01262', 3487636.85);
			at('Provinsi Banten/Kabupaten Tangerang', '17011', 5290110);
			at('Provinsi Banten/Kota Cilegon', '24101', 5606670.54);
			at('Provinsi Banten/Kota Tangerang Selatan', '17099', 5272842);
			// Kalimantan Timur and Kalimantan Selatan (decree KBLI) and the group prefixes of the named sectors.
			at('Provinsi Kalimantan Timur/Kota Bontang', '06201', 4975637);
			at('Provinsi Kalimantan Timur/Kabupaten Berau', '05100', 4463705.35);
			at('Provinsi Kalimantan Selatan/Kabupaten Tabalong', '09900', 3854176.42);
			at('Provinsi Kalimantan Selatan/Kota Banjarmasin', '64121', 3867143); // banking: KBLI 641
			at('Provinsi Kalimantan Selatan/Kabupaten Banjar', '05100', 3770000); // the UMSP
			at('Provinsi Riau/Kota Pekanbaru', '06100', 4293445.01); // oil and gas: division 06
			at('Provinsi Riau/Kabupaten Kampar', '01262', 4149255.46);
			at('Provinsi Kalimantan Utara/Kota Tarakan', '16211', 4754904);
			at('Provinsi Kepulauan Riau/Kota Batam', '30111', 5374672);
			at('Provinsi Papua Barat Daya/Kota Sorong', '06100', 5549000);
			at('Provinsi Papua Selatan/Kabupaten Merauke', '03111', 4517120);
			// DKI's exact five-digit rows still match only their own code.
			assert.equal(sector('Provinsi DKI Jakarta', '20118', 5844335), true);
			assert.equal(sector('Provinsi DKI Jakarta', '2011', 5844335), false);
			// Kota Tangerang sectors I–IV (Kep. 704/2025 Lampiran I and V, the sub-sectors read as KBLI 2020).
			at('Provinsi Banten/Kota Tangerang', '11031', 5777364.09); // minuman keras
			at('Provinsi Banten/Kota Tangerang', '64122', 5777364.09); // bank syariah
			at('Provinsi Banten/Kota Tangerang', '22291', 5777364.09); // plastik lembaran: sector I over sector III's 222
			at('Provinsi Banten/Kota Tangerang', '25920', 5561387.86); // jasa pengerjaan khusus logam
			at('Provinsi Banten/Kota Tangerang', '13121', 5561387.86); // pertenunan
			at('Provinsi Banten/Kota Tangerang', '22220', 5480396.78); // barang dari plastik
			at('Provinsi Banten/Kota Tangerang', '52101', 5480396.78); // pergudangan
			at('Provinsi Banten/Kota Tangerang', '15202', 5453399.75); // sepatu olahraga
			// Sector III's star hotels are 3 to 5 stars; large export toys and furniture are sector II.
			at('Provinsi Banten/Kota Tangerang', '55110', 5480396.78, { umsp_hotel_star: 3 });
			assert.equal(
				sector('Provinsi Banten/Kota Tangerang', '55110', 5480396, { umsp_hotel_star: 2 }),
				false
			);
			at('Provinsi Banten/Kota Tangerang', '32402', 5561387.86, { umsp_export_oriented: true });
			assert.equal(sector('Provinsi Banten/Kota Tangerang', '32402', 5561386), false);
			// A sub-sector the decree names without a class or KBLI (a type B hospital) pays the UMK only.
			assert.equal(sector('Provinsi Banten/Kota Tangerang', '86103', 5480396), false);
			// Mimika (Kep. 100.3.3.1/337/2025): mining 6,000,000, construction 5,130,819; any company in the Freeport area mining.
			at('Provinsi Papua Tengah/Kabupaten Mimika', '07291', 6000000);
			at('Provinsi Papua Tengah/Kabupaten Mimika', '42101', 5130819);
			at('Provinsi Papua Tengah/Kabupaten Mimika', '49431', 6000000, {
				umsp_freeport_area: true
			});
			assert.equal(sector('Provinsi Papua Tengah/Kabupaten Mimika', '49431', 5999999), false);
			// Sulawesi Tengah UMSP (Kep. 485/2025) binds every locality; Morowali (Kep. 487 as amended by 495),
			// Morowali Utara (488), Poso (489) and Palu (486) UMSK their KBLI.
			at('Provinsi Sulawesi Tengah/Kabupaten Banggai', '08103', 3352956);
			at('Provinsi Sulawesi Tengah/Kabupaten Banggai', '01262', 3320403);
			at('Provinsi Sulawesi Tengah/Kabupaten Morowali', '07295', 4627000);
			at('Provinsi Sulawesi Tengah/Kabupaten Morowali', '19100', 4627000);
			at('Provinsi Sulawesi Tengah/Kabupaten Morowali', '01262', 4262000);
			at('Provinsi Sulawesi Tengah/Kabupaten Morowali Utara', '07295', 4521306);
			at('Provinsi Sulawesi Tengah/Kabupaten Morowali Utara', '24202', 4516842);
			at('Provinsi Sulawesi Tengah/Kabupaten Poso', '35111', 3317251);
			at('Provinsi Sulawesi Tengah/Kota Palu', '08103', 3658497.15);
			// Morowali Utara's prefix "Provinsi Sulawesi Tengah/Kabupaten Morowali" is not its key: the "/" separator.
			assert.equal(
				sector('Provinsi Sulawesi Tengah/Kabupaten Morowali Utara', '19100', 4626999),
				false
			);
			// Kalimantan Selatan UMSP (Kep. 100.3.3.1/01101/KUM/2025 diktum KETIGA), every locality.
			at('Provinsi Kalimantan Selatan/Kabupaten Banjar', '46610', 3728000); // wholesale fuel
			at('Provinsi Kalimantan Selatan/Kabupaten Banjar', '16211', 3728000); // plywood
			at('Provinsi Kalimantan Selatan/Kabupaten Banjar', '10431', 3730000); // CPO
			assert.equal(sector('Provinsi Kalimantan Selatan/Kabupaten Banjar', '10432', 3729999), false);
			// Kalimantan Tengah UMSP (Kep. 188.44/477/2025) and UMSK (Kep. 188.44/492/2025 Lampiran II).
			at('Provinsi Kalimantan Tengah/Kota Palangka Raya', '10437', 3692907);
			at('Provinsi Kalimantan Tengah/Kota Palangka Raya', '07301', 3714130);
			at('Provinsi Kalimantan Tengah/Kabupaten Kotawaringin Barat', '55110', 3946141.38);
			at('Provinsi Kalimantan Tengah/Kabupaten Kotawaringin Barat', '41013', 3967641.31);
			at('Provinsi Kalimantan Tengah/Kabupaten Seruyan', '10431', 4058597.7);
			at('Provinsi Kalimantan Tengah/Kabupaten Barito Utara', '05100', 4095936.68);
			at('Provinsi Kalimantan Tengah/Kabupaten Murung Raya', '96200', 4007626);
			at('Provinsi Kalimantan Tengah/Kabupaten Kapuas', '05100', 3738175);
			// Kalimantan Barat UMSP (Kep. 1350/NAKERTRAN/2025): bauxite 3,108,007, palm 3,062,552.
			at('Provinsi Kalimantan Barat/Kabupaten Sekadau', '07293', 3108007);
			at('Provinsi Kalimantan Barat/Kota Pontianak', '08101', 3062552);
			// Aceh UMSP (Kep. 500.15.14.1/1489/2025): five KBLI; every first-year worker, married or not (diktum
			// KEEMPAT's "lajang" is the reference worker; diktum KEENAM binds every employer in the five sectors).
			const married = { marital_status: 'MARRIED' };
			at('Provinsi Aceh/Kabupaten Aceh Utara', '10431', 3987940, {}, married);
			at('Provinsi Aceh/Kabupaten Aceh Utara', '01262', 3987940, {}, { marital_status: 'SINGLE' });
			at('Provinsi Aceh/Kabupaten Aceh Utara', '06201', 4061791, {}, married);
			at('Provinsi Aceh/Kota Banda Aceh', '07301', 4061791, {}, married);
			at('Provinsi Aceh/Kota Banda Aceh', '05100', 4061791, {}, { marital_status: null });
			assert.equal(
				sector('Provinsi Aceh/Kabupaten Aceh Utara', '09900', 4061790, {}, 'OTHER', married),
				false
			);
			// The Kalimantan Tengah UMKs carry their sen (Kep. 188.44/492/2025 Lampiran I).
			const kalteng = payrollRules(version).minimum_wage.by_region;
			assert.equal(kalteng['Provinsi Kalimantan Tengah/Kota Palangka Raya'], 3724677.99);
			assert.equal(kalteng['Provinsi Kalimantan Tengah/Kabupaten Kapuas'], 3710096.5);
		}
		// Version 1 (December 2025): the 2025 Mimika UMSK (Kep. 258/2024); in the Freeport area only construction.
		assert.deepEqual(Object.keys(payrollRules('version_1').minimum_wage.by_sector), [
			'Provinsi Papua Tengah/Kabupaten Mimika',
			'Provinsi Kalimantan Selatan/Kota Banjarmasin',
			'Provinsi Kalimantan Selatan/Kabupaten Kotabaru'
		]);
		assert.equal(
			payrollRules('version_1').minimum_wage.by_region[
				'Provinsi Kalimantan Selatan/Kabupaten Tanah Bumbu'
			],
			3500163.21
		);
		const v1 = (kbli: string, wage: number, facts: Row = {}) =>
			trips(
				'version_1',
				'SECTOR_MINIMUM_WAGE',
				contractCtx('version_1', {
					terms: {
						base_salary: wage,
						monthly_wage: wage,
						facts: {
							worksite_region: 'Provinsi Papua Tengah/Kabupaten Mimika',
							worksite_kbli: kbli
						}
					},
					company: {
						region: 'Provinsi DKI Jakarta',
						facts: { enterprise_size_class: 'OTHER', ...facts }
					}
				})
			);
		assert.equal(v1('05100', 5999999), true);
		assert.equal(v1('05100', 6000000), false);
		assert.equal(v1('43211', 5130818), true);
		assert.equal(v1('43211', 5999999, { umsp_freeport_area: true }), true);
		assert.equal(v1('49431', 5999999, { umsp_freeport_area: true }), false);
		// Kalimantan Selatan UMSK 2025 (Kep. 100.3.3.1/01089/KUM/2024 diktum KETIGA).
		const v1At = (region: string, kbli: string, amount: number) => {
			const at = (wage: number) =>
				trips(
					'version_1',
					'SECTOR_MINIMUM_WAGE',
					contractCtx('version_1', {
						terms: {
							base_salary: wage,
							monthly_wage: wage,
							facts: { worksite_region: region, worksite_kbli: kbli }
						},
						company: { facts: { enterprise_size_class: 'OTHER' } }
					})
				);
			assert.equal(at(amount - 1), true, `${region} ${kbli}`);
			assert.equal(at(amount), false, `${region} ${kbli}`);
		};
		v1At('Provinsi Kalimantan Selatan/Kota Banjarmasin', '64121', 3609682.13);
		v1At('Provinsi Kalimantan Selatan/Kota Banjarmasin', '55120', 3603182.13);
		v1At('Provinsi Kalimantan Selatan/Kota Banjarmasin', '16211', 3601682.13);
		v1At('Provinsi Kalimantan Selatan/Kabupaten Kotabaru', '05100', 3653000);
		v1At('Provinsi Kalimantan Selatan/Kabupaten Kotabaru', '10431', 3646004);
	});
	it('Kayong Utara 2026: the official sector floor binds palm plantations and CPO, not other sectors', () => {
		for (const version of ['version_2', 'version_3']) {
			for (const kbli of ['01262', '10431']) {
				for (const wage of [3404290, 3404291]) {
					assert.equal(
						trips(
							version,
							'SECTOR_MINIMUM_WAGE',
							contractCtx(version, {
								terms: {
									base_salary: wage,
									monthly_wage: wage,
									facts: {
										worksite_region: 'Provinsi Kalimantan Barat/Kabupaten Kayong Utara',
										worksite_kbli: kbli
									}
								},
								company: { facts: { enterprise_size_class: 'OTHER' } }
							})
						),
						wage < 3404291
					);
				}
			}
		}
	});
	it('Sultra 2026: provincial sector floors bind districts without their own UMK', () => {
		for (const version of ['version_2', 'version_3']) {
			for (const [kbli, floor] of [
				['07295', 3373843.2],
				['42101', 3437546.64]
			] as const) {
				for (const region of ['Kabupaten Bombana', 'Kabupaten Konawe Utara', 'Kota Kendari']) {
					const table =
						payrollRules(version).minimum_wage.by_sector[`Provinsi Sulawesi Tenggara/${region}`];
					if (region !== 'Kabupaten Bombana') {
						assert.equal(table, undefined);
						continue;
					}
					for (const wage of [floor - 1, floor]) {
						const ctx = contractCtx(version, {
							terms: {
								base_salary: wage,
								monthly_wage: wage,
								facts: {
									worksite_region: `Provinsi Sulawesi Tenggara/${region}`,
									worksite_kbli: kbli
								}
							},
							company: { facts: { enterprise_size_class: 'OTHER' } }
						});
						assert.equal(trips(version, 'SECTOR_MINIMUM_WAGE', ctx), wage < floor);
						assert.equal(trips(version, 'SECTOR_MINIMUM_WAGE_UNSEEDED', ctx), false);
					}
				}
			}
		}
	});
	it('Jambi decree 1154/2025: coal, oil and natural gas use the signed 2026 sector floor', () => {
		for (const version of ['version_2', 'version_3']) {
			for (const kbli of ['05100', '06100', '06201']) {
				for (const wage of [3574445, 3574446]) {
					const ctx = contractCtx(version, {
						terms: {
							base_salary: wage,
							monthly_wage: wage,
							facts: { worksite_region: 'Provinsi Jambi/Kabupaten Bungo', worksite_kbli: kbli }
						},
						company: { facts: { enterprise_size_class: 'OTHER' } }
					});
					assert.equal(trips(version, 'SECTOR_MINIMUM_WAGE', ctx), wage < 3574446);
				}
			}
			assert.equal(
				fixturePresent(payrollRules(version).minimum_wage.by_sector['Provinsi Jambi']).some(
					(row: Row) => row.kbli === '06202'
				),
				false
			);
		}
	});
	it('Kolaka decree 583/2025: mining and construction floors retain the published cents', () => {
		for (const version of ['version_2', 'version_3']) {
			assert.equal(
				payrollRules(version).minimum_wage.by_region['Provinsi Sulawesi Tenggara/Kabupaten Kolaka'],
				3688130.26
			);
			for (const [kbli, floor] of [
				['07295', 3713476.49],
				['41011', 3844359.65]
			] as const) {
				for (const wage of [floor - 0.01, floor]) {
					const ctx = contractCtx(version, {
						terms: {
							base_salary: wage,
							monthly_wage: wage,
							facts: {
								worksite_region: 'Provinsi Sulawesi Tenggara/Kabupaten Kolaka',
								worksite_kbli: kbli
							}
						},
						company: { facts: { enterprise_size_class: 'OTHER' } }
					});
					assert.equal(trips(version, 'SECTOR_MINIMUM_WAGE', ctx), wage < floor);
				}
			}
		}
	});
	it('ID-SETTINGS-15: a worksite whose sector decree is not configured warns at the payslip', () => {
		const warns = (
			version: string,
			region: string,
			kbli: string | undefined,
			{
				months = 6,
				size = 'OTHER'
			}: {
				months?: number;
				size?: string;
			} = {},
			rules?: Row
		) =>
			trips(version, 'SECTOR_MINIMUM_WAGE_UNSEEDED', {
				...contractCtx(version, {
					terms: {
						facts: {
							worksite_region: region,
							...(kbli === undefined ? {} : { worksite_kbli: kbli })
						}
					},
					company: { facts: { enterprise_size_class: size } },
					employment: { service_months: months }
				}),
				...(rules ? { rules } : {})
			});
		for (const version of ['version_2', 'version_3']) {
			const rules = payrollRules(version);
			const areas = fixtureRecord(fixtureRecord(rules.minimum_wage.unseeded_sector).areas);
			// The warning names each area's decree.
			const check = checksOf(version).SECTOR_MINIMUM_WAGE_UNSEEDED;
			assert.equal(check.kind, 'warn');
			assert.equal(check.site, 'payslip');
			for (const area of fixtureValue5(Object.values(areas)))
				assert.ok(check.message.includes(area.decree), area.decree);
			assert.match(check.message, /188\.44\/909\/KPTS\/2025/);
			// All areas together, then one area at a time (the others dropped) so each case proves its own entry.
			assert.equal(warns(version, 'Provinsi Sulawesi Tenggara/Kota Kendari', '07295'), false);
			assert.equal(warns(version, 'Provinsi DKI Jakarta', '20118'), false);
			const W = (code: string, region: string, kbli?: string, opts = {}) =>
				warns(version, region, kbli, opts, {
					...rules,
					minimum_wage: {
						...rules.minimum_wage,
						unseeded_sector: {
							outside_tables: false,
							areas: areas[code] === undefined ? {} : { [code]: areas[code] }
						}
					}
				});
			const kendari = 'Provinsi Sulawesi Tenggara/Kota Kendari';
			// From a year of service it still warns: the wage scale may not fall below it (UU 13/2003 art.88E(2)).
			assert.equal(areas.KOLAKA_UMSK, undefined);
			assert.equal(W('KOLAKA_UMSK', 'Provinsi Sulawesi Tenggara/Kabupaten Kolaka', '47111'), false);
			assert.equal(W('KOLAKA_UMSK', kendari, '07295'), false);
			assert.equal(
				warns(version, 'Provinsi Kalimantan Barat/Kabupaten Kayong Utara', '01262'),
				false
			);
			assert.equal(areas.KAYONG_UTARA_UMSK, undefined);
			assert.equal(areas.JAMBI_SECTOR, undefined);
			assert.equal(W('JAMBI_SECTOR', 'Provinsi Jambi/Kabupaten Bungo', '05100'), false);
			assert.equal(W('JAMBI_SECTOR', 'Provinsi Jambi/Kabupaten Bungo', '01262'), false); // palm is seeded
			assert.equal(W('JAMBI_UMSK', 'Provinsi Jambi/Kota Jambi', '47111'), true);
			assert.equal(W('JAMBI_UMSK', 'Provinsi Jambi/Kabupaten Kerinci', '47111'), false);
			assert.equal(W('SUMUT_UMSK', 'Provinsi Sumatera Utara/Kota Medan', '10431'), false);
			assert.equal(W('SUMUT_UMSK', 'Provinsi Sumatera Utara/Kabupaten Asahan', '01262'), false);
			assert.equal(
				W('SUMUT_UMSK', 'Provinsi Sumatera Utara/Kabupaten Deli Serdang', '27409'),
				false
			);
			// A locality at the UMP has no wage council of its own, so no UMSK: no warning.
			assert.equal(W('SUMUT_UMSK', 'Provinsi Sumatera Utara/Kabupaten Nias', '01262'), false);
			assert.equal(areas.SUMUT_UMSK, undefined);
			const tangerang = 'Provinsi Banten/Kota Tangerang';
			assert.equal(W('KOTA_TANGERANG_LAMPIRAN_V', tangerang, '86103'), true); // a type B hospital
			assert.equal(W('KOTA_TANGERANG_LAMPIRAN_V', tangerang, '46100'), true); // a distributor
			assert.equal(W('KOTA_TANGERANG_LAMPIRAN_V', tangerang, '22220'), false); // sector III, seeded
		}
		// A worksite with no KBLI declared, in an area with a sector table or an unconfigured decree, warns.
		const noKbli = (version: string, region: string, kbli?: string, size = 'OTHER') =>
			trips(
				version,
				'SECTOR_KBLI_MISSING',
				contractCtx(version, {
					terms: {
						facts: {
							worksite_region: region,
							...(kbli === undefined ? {} : { worksite_kbli: kbli })
						}
					},
					company: { facts: { enterprise_size_class: size } },
					employment: { service_months: 30 }
				})
			);
		for (const version of versions) {
			assert.equal(checksOf(version).SECTOR_KBLI_MISSING.kind, 'warn');
			assert.equal(noKbli(version, 'Provinsi Papua Tengah/Kabupaten Mimika'), true); // a table, every version
			assert.equal(noKbli(version, 'Provinsi Papua Tengah/Kabupaten Mimika', '05100'), false);
			assert.equal(
				noKbli(version, 'Provinsi Papua Tengah/Kabupaten Mimika', undefined, 'MICRO_OR_SMALL'),
				false
			);
		}
		for (const version of ['version_2', 'version_3']) {
			assert.equal(noKbli(version, 'Provinsi Jawa Barat/Kota Bekasi'), true);
			assert.equal(noKbli(version, 'Provinsi Sulawesi Tenggara/Kabupaten Bombana'), true); // seeded UMSP
			assert.equal(noKbli(version, 'Provinsi DKI Jakarta'), true); // DKI's table
			assert.equal(noKbli(version, 'Provinsi Maluku/Kota Ambon'), false); // no sector wage known
		}
		assert.equal(noKbli('version_1', 'Provinsi Jawa Barat/Kota Bekasi'), true); // outside the verified 2025 tables
		assert.equal(noKbli('version_1', 'Provinsi Jawa Barat/Kota Bekasi', '29101'), false);
		assert.equal(
			noKbli('version_1', 'Provinsi Jawa Barat/Kota Bekasi', undefined, 'MICRO_OR_SMALL'),
			false
		);
		// Version 1: every worksite area without a 2025 table warns; Mimika and Kalsel's two do not.
		const v1 = (region: string, kbli?: string) => warns('version_1', region, kbli);
		assert.equal(v1('Provinsi Jawa Barat/Kota Bekasi', '29101'), true);
		assert.equal(v1('Provinsi Papua Tengah/Kabupaten Mimika', '05100'), false);
		assert.equal(v1('Provinsi Kalimantan Selatan/Kota Banjarmasin', '64121'), false);
		assert.equal(v1('Provinsi Jawa Barat/Kota Bekasi'), false);
	});
	it('ID-SETTINGS-16: a worker of a year or more below the worksite minimum warns', () => {
		for (const version of versions) {
			const floor = DKI(version);
			const warn = (service_months: number, wage: number, terms: Row = {}) =>
				trips(
					version,
					'MINIMUM_WAGE_LONG_SERVICE',
					contractCtx(version, {
						terms: { base_salary: wage, monthly_wage: wage, ...terms },
						employment: { service_months }
					})
				);
			assert.equal(warn(12, floor - 1), true);
			assert.equal(warn(12, floor), false);
			assert.equal(warn(11, floor - 1), false); // under a year: MINIMUM_WAGE_FLOOR refuses instead
			assert.equal(checksOf(version).MINIMUM_WAGE_LONG_SERVICE.kind, 'warn');
			assert.equal(
				trips(
					version,
					'MINIMUM_WAGE_FLOOR',
					contractCtx(version, {
						terms: { base_salary: floor - 1, monthly_wage: floor - 1 },
						employment: { service_months: 12 }
					})
				),
				false
			);
			// Daily (÷21 on a five-day week) and hourly (÷126) floors after a year.
			assert.equal(
				warn(24, 0, {
					employment_type: 'DAILY',
					facts: { daily_wage: Math.floor(floor / 21), working_days_per_week: 5 }
				}),
				true
			);
			assert.equal(
				warn(24, 0, {
					employment_type: 'PART_TIME',
					facts: { hourly_wage: Math.ceil(floor / 126) }
				}),
				false
			);
			// A micro or small enterprise is outside the minimum wage.
			assert.equal(
				trips(version, 'MINIMUM_WAGE_LONG_SERVICE', {
					...contractCtx(version, {
						terms: { base_salary: 1, monthly_wage: 1 },
						employment: { service_months: 30 }
					}),
					company: {
						region: 'Provinsi DKI Jakarta',
						facts: { enterprise_size_class: 'MICRO_OR_SMALL' }
					}
				}),
				false
			);
		}
		// The sector minimum binds after a year too (Jawa Barat Kota Bekasi, KBLI 29101).
		assert.equal(
			trips(
				'version_3',
				'MINIMUM_WAGE_LONG_SERVICE',
				contractCtx('version_3', {
					terms: {
						base_salary: 6000000,
						monthly_wage: 6000000,
						facts: { worksite_region: 'Provinsi Jawa Barat/Kota Bekasi', worksite_kbli: '29101' }
					},
					employment: { service_months: 30 }
				})
			),
			true
		);
	});
	it('ID-WORK-20: a rest of at least 30 minutes after 4 hours of continuous work (UU 13/2003 art.79(2)(a))', () => {
		for (const version of versions) {
			const rule = checksOf(version).ROSTER_REST_BREAK;
			assert.equal(rule.site, 'roster');
			assert.equal(rule.kind, 'warn');
			const breaks = (intervals: Row[]) =>
				evaluateConfigured(
					fixtureString(rule.when),
					fixtureContext({
						...subject(),
						rules: payrollRules(version),
						day: day({ date: '2026-03-09', worked: true, intervals }),
						week: {}
					})
				) === true;
			const at = (start: string, end: string) => ({
				start: `2026-03-09T${start}`,
				end: `2026-03-09T${end}`
			});
			assert.equal(breaks([at('08:00', '12:00'), at('12:30', '16:30')]), false); // 4 h, a 30-minute rest, 4 h
			assert.equal(breaks([at('08:00', '12:00'), at('12:30', '17:00')]), true); // 4.5 h after the rest owes another
			assert.equal(breaks([at('08:00', '12:01')]), true); // more than 4 h straight
			assert.equal(breaks([at('08:00', '11:00'), at('11:15', '13:30')]), true); // a 15-minute pause is no rest
			assert.equal(breaks([at('08:00', '11:00'), at('11:30', '13:30')]), false);
			// A night shift across midnight: 22:00–03:00 is five hours straight.
			assert.equal(breaks([{ start: '2026-03-09T22:00', end: '2026-03-10T03:00' }]), true);
			assert.equal(breaks([]), false);
			assert.equal(
				evaluateConfigured(
					fixtureString(rule.when),
					fixtureContext({
						...subject(),
						rules: payrollRules(version),
						day: day({ worked: false }),
						week: {}
					})
				),
				false
			);
		}
	});
	it('ID-WORK-2: rest-day or holiday overtime without the working days a week warns', () => {
		for (const version of versions) {
			const rule = checksOf(version).WORKING_DAYS_PER_WEEK_REQUIRED;
			const warns = (facts: Row, days: Row[]) =>
				evaluateConfigured(
					fixtureString(rule.when),
					fixtureContext(slipCtx(version, days, { terms: { facts } }))
				) === true;
			const rest = day({
				day_type: 'REST',
				scheduled_hours: 0,
				worked_hours: 8,
				overtime_hours: 8
			});
			assert.equal(warns({}, [rest]), true);
			// A holiday worked within its shift: no overtime past it, but every hour is priced on the week's ladder.
			assert.equal(warns({}, [day({ holiday_kind: 'PUBLIC_HOLIDAY' })]), true);
			assert.equal(warns({ working_days_per_week: 6 }, [rest]), false);
			assert.equal(warns({}, [day({ overtime_hours: 2 })]), false); // ordinary-day overtime: one ladder
		}
	});
	it('ID-ADHOC-15: early PKWT termination damages up to the end of the term (UU 13/2003 art.62)', () => {
		for (const version of versions) {
			const contract = (ground: string, end = '2026-12-31') => ({
				terms: { employment_type: 'CONTRACT', monthly_wage: 9000000, effective_to: end },
				employment: { service_months: 8, exit_date: '2026-04-15', exit_ground: ground }
			});
			// Exit on 15 April, term to 31 December: 16 April–15 December = 8 months, then 16 days at ÷30.
			const owed = 9000000 * 8 + Math.round((9000000 / 30) * 16);
			assert.equal(priceAdhoc(version, 'PKWT_EARLY_TERMINATION', contract('DISMISSAL'), {}), owed);
			assert.equal(
				priceAdhoc(version, 'PKWT_EARLY_TERMINATION', contract('RESIGNATION'), {}),
				null
			);
			assert.equal(
				priceAdhoc(version, 'PKWT_EARLY_TERMINATION_BY_WORKER', contract('RESIGNATION'), {}),
				owed
			);
			assert.equal(
				priceAdhoc(version, 'PKWT_EARLY_TERMINATION_BY_WORKER', contract('DISMISSAL'), {}),
				null
			);
			// The term's end on the entry wins; a whole month remaining is one month's wage.
			assert.equal(
				priceAdhoc(version, 'PKWT_EARLY_TERMINATION', contract('UNILATERAL', ''), {
					term_end_date: '2026-05-15'
				}),
				9000000
			);
			// Ending on or after the term's last day owes nothing; a PKWTT is outside art.62.
			assert.equal(
				priceAdhoc(version, 'PKWT_EARLY_TERMINATION', contract('DISMISSAL', '2026-04-15'), {}),
				0
			);
			assert.equal(
				priceAdhoc(
					version,
					'PKWT_EARLY_TERMINATION',
					{
						...contract('DISMISSAL'),
						terms: { employment_type: 'PERMANENT', monthly_wage: 9000000 }
					},
					{}
				),
				null
			);
			const paid = catalog(version, 'adhoc_catalog', 'PKWT_EARLY_TERMINATION');
			assert.deepEqual(
				[paid.destination, paid.direction, paid.counts_toward],
				['PAY', 'ADD', ['PPH21_FINAL_SEVERANCE', 'PPH26']]
			);
			const owedBy = catalog(version, 'adhoc_catalog', 'PKWT_EARLY_TERMINATION_BY_WORKER');
			assert.deepEqual([owedBy.destination, owedBy.direction], ['NET', 'SUBTRACT']);
			// The worker's damages fall within the PP 36/2021 art.65 50% ceiling.
			const ceiling = checksOf(version).WAGE_DEDUCTION_CEILING.when;
			assert.equal(
				evaluateConfigured(
					fixtureString(ceiling),
					fixtureContext({
						payslip: { gross: 10000000, lines: { PKWT_EARLY_TERMINATION_BY_WORKER: -6000000 } }
					})
				),
				true
			);
		}
	});
	it('ID-LEAVE-2: the leave cash-out divisor is at most 25 (PP 36/2021 art.17)', () => {
		for (const version of versions)
			assert.equal(
				fixtureRecord(settingsOf(version).entity_input_schema.properties.leave_cash_out_day_divisor)
					.maximum,
				25
			);
	});
	it('ID-OBLIGATION-51: the Coretax BPMP, BPA1, BP21 and BP26 XML import files', () => {
		const order = (xml: string, record: string) =>
			[...xml.matchAll(new RegExp(`<${record}>(.*?)</${record}>`, 'g'))].map((m) =>
				[...fixturePresent(m[1]).matchAll(/<([A-Za-z0-9]+)(?: xsi:nil="true"\/>|>)/g)].map(
					(t) => t[1]
				)
			);
		const value = (xml: string, tag: string) =>
			[...xml.matchAll(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'g'))].map((m) => m[1]);
		// Every opened element closes, in order (no parser in the runtime).
		const wellFormed = (xml: string) => {
			const stack: string[] = [];
			for (const [, close, name, self] of xml
				.replace(/<\?xml[^>]*\?>/, '')
				.matchAll(/<(\/?)([A-Za-z0-9:]+)[^>]*?(\/?)>/g)) {
				if (self) continue;
				if (close) assert.equal(stack.pop(), name);
				else stack.push(fixturePresent(name));
			}
			assert.deepEqual(stack, []);
		};
		const slip = (period: string, lines: Row, statutory: Row) => ({
			period,
			status: 'PAID',
			gross: 0,
			net: 0,
			total_deductions: 0,
			lines,
			statutory
		});
		const months = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`);
		const ss = (pph: number) => ({
			PPH21: { employee: pph, employer: 0, base: 10484000 },
			JKK: { employee: 0, employer: 54000, base: 0 },
			JKM: { employee: 0, employer: 30000, base: 0 },
			KESEHATAN: { employee: 100000, employer: 400000, base: 0 },
			JHT: { employee: 200000, employer: 370000, base: 0 },
			JP: { employee: 100000, employer: 200000, base: 0 }
		});
		// Budi, K/1, 10,000,000 a month: TER B 1.5% on 10,484,000 = 157,260; December reckons 269,880.
		const budi = {
			employee: {
				name: 'Budi & Putra <PT>',
				identity_number: '3172022407981234',
				nationality: 'ID',
				gender: 'MALE',
				marital_status: 'MARRIED',
				facts: {}
			},
			contract: {
				employee_number: 'E-1',
				effective_range: { from: '2020-01-01', to: null },
				exit_ground: null,
				facts: {
					contract_terms: [
						{
							effective_range: { from: '2020-01-01', to: null },
							employment_type: 'PERMANENT',
							job_title: 'Staf R&D',
							facts: { dependents_count: 1 }
						}
					]
				}
			},
			slips: months.map((m) =>
				slip(
					m,
					m === '2026-03' ? { BASIC: 10000000, THR: 10000000 } : { BASIC: 10000000 },
					ss(m.endsWith('12') ? 269880 : 157260)
				)
			)
		};
		// A married woman without the husband's no-income statement files TK/0 whatever her children.
		const sari = {
			...budi,
			employee: {
				...budi.employee,
				name: 'Sari',
				gender: 'FEMALE',
				identity_number: '3172024806201234'
			},
			contract: {
				...budi.contract,
				facts: {
					contract_terms: [
						{
							effective_range: { from: '2020-01-01', to: null },
							employment_type: 'PERMANENT',
							job_title: 'Staf R&D',
							facts: { dependents_count: 2 }
						}
					]
				}
			},
			slips: [
				slip(
					'2026-01',
					{ BASIC: 20000000 },
					{ PPH21: { employee: 1858320, employer: 0, base: 20648000 } }
				)
			]
		};
		// A bukan pegawai (PAYEE) paid a 10,000,000 fee: 5% on 50% = 250,000.
		const payee = {
			employee: {
				name: 'Konsultan',
				identity_number: '3273062212790005',
				nationality: 'ID',
				marital_status: 'SINGLE',
				facts: {}
			},
			contract: {
				employee_number: 'P-1',
				engagement: 'PAYEE',
				effective_range: { from: '2026-01-01', to: null },
				exit_ground: null,
				facts: {
					contract_terms: [
						{
							effective_range: { from: '2026-01-01', to: null },
							employment_type: 'PERMANENT',
							facts: {}
						}
					]
				}
			},
			slips: [
				slip(
					'2026-01',
					{ NON_EMPLOYEE_FEE: 10000000 },
					{ PPH21_BUKAN_PEGAWAI: { employee: 250000, employer: 0, base: 10000000 } }
				)
			]
		};
		// A non-resident at 20% PPh 26.
		const expat = {
			employee: {
				name: 'Jason Lee',
				nationality: 'US',
				date_of_birth: '1980-01-13',
				address: 'California',
				marital_status: 'SINGLE',
				facts: {
					passport_number: 'P123',
					foreign_tin: 'US-TIN-9',
					bp26_country: 'USA',
					birth_city: 'Las Vegas'
				}
			},
			contract: {
				employee_number: 'X-1',
				effective_range: { from: '2026-01-01', to: null },
				exit_ground: null,
				facts: {
					contract_terms: [
						{
							effective_range: { from: '2026-01-01', to: null },
							employment_type: 'PERMANENT',
							facts: {}
						}
					]
				}
			},
			slips: [
				slip(
					'2026-01',
					{ BASIC: 50000000 },
					{ PPH26: { employee: 10000000, employer: 0, base: 50000000 } }
				)
			]
		};
		for (const version of versions) {
			const templates = read(version, 'rule_set').filter((row) => row.family === 'EXPORTS');
			assert.deepEqual(templates.map((row) => row.code).toSorted(), [
				'CORETAX_BP21_XML',
				'CORETAX_BP26_XML',
				'CORETAX_BPA1_XML',
				'CORETAX_BPMP_XML'
			]);
			const docs = recordDocuments(
				fixtureExports(templates.map((row) => ({ code: String(row.code), rules: row.rules }))),
				fixtureContexts([{ period: '2026-01', salary_to: '2026-01-31' }]),
				fixtureReturnRows([budi, sari, payee, expat]),
				fixtureContext({ facts: { npwp: '0029482015507000' } })
			);
			const doc = (name: string) => fixturePresent(docs.find((d) => d.name === name)).content;
			for (const d of docs) {
				assert.ok(d.content.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'));
				wellFormed(d.content);
			}
			// BPMP: the elements in the DJP template's order; January to November only (December is the BPA1).
			const bpmp = doc('coretax-bpmp-2026-01.xml');
			assert.ok(
				bpmp.includes(
					'<MmPayrollBulk xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><TIN>0029482015507000</TIN><ListOfMmPayroll>'
				)
			);
			assert.deepEqual(order(bpmp, 'MmPayroll')[0], [
				'TaxPeriodMonth',
				'TaxPeriodYear',
				'CounterpartOpt',
				'CounterpartPassport',
				'CounterpartTin',
				'StatusTaxExemption',
				'Position',
				'TaxCertificate',
				'TaxObjectCode',
				'Gross',
				'Rate',
				'IDPlaceOfBusinessActivity',
				'WithholdingDate'
			]);
			assert.equal(order(bpmp, 'MmPayroll').length, 12); // Budi's 11 months and Sari's January
			assert.deepEqual(value(bpmp, 'StatusTaxExemption').slice(-2), ['K/1', 'TK/0']);
			assert.deepEqual([...new Set(value(bpmp, 'Rate'))], ['1.5', '9']);
			assert.equal(value(bpmp, 'Gross')[0], '10484000');
			assert.equal(value(bpmp, 'Position')[0], 'Staf R&amp;D'); // escaped
			assert.equal(value(bpmp, 'IDPlaceOfBusinessActivity')[0], '0029482015507000000000');
			assert.equal(value(bpmp, 'WithholdingDate')[1], '2026-02-28');
			// BPA1: Budi's year — 120,000,000 salary, 10,000,000 THR, 5,808,000 employer premiums, 3,600,000 JHT+JP.
			const bpa1 = doc('coretax-bpa1-2026.xml');
			assert.deepEqual(order(bpa1, 'A1')[0], [
				'WorkForSecondEmployer',
				'TaxPeriodMonthStart',
				'TaxPeriodMonthEnd',
				'TaxPeriodYear',
				'CounterpartOpt',
				'CounterpartPassport',
				'CounterpartTin',
				'TaxExemptOpt',
				'StatusOfWithholding',
				'CounterpartPosition',
				'TaxObjectCode',
				'NumberOfMonths',
				'SalaryPensionJhtTht',
				'GrossUpOpt',
				'IncomeTaxBenefit',
				'OtherBenefit',
				'Honorarium',
				'InsurancePaidByEmployer',
				'Natura',
				'TantiemBonusThr',
				'PensionContributionJhtThtFee',
				'Zakat',
				'PrevWhTaxSlip',
				'TaxCertificate',
				'Article21IncomeTax',
				'IDPlaceOfBusinessActivity',
				'WithholdingDate'
			]);
			assert.equal(order(bpa1, 'A1').length, 1); // Sari's January is not a final month
			assert.deepEqual(
				[
					'StatusOfWithholding',
					'SalaryPensionJhtTht',
					'TantiemBonusThr',
					'InsurancePaidByEmployer',
					'PensionContributionJhtThtFee',
					'Article21IncomeTax',
					'WithholdingDate'
				].map((tag) => value(bpa1, tag)[0]),
				[
					'FullYear',
					'120000000',
					'10000000',
					'5808000',
					'3600000',
					String(11 * 157260),
					'2026-12-31'
				]
			);
			// BP21: the payee's fee at 21-100-20, deemed 50%, 5% on the deemed gross.
			const bp21 = doc('coretax-bp21-2026-01.xml');
			assert.equal(order(bp21, 'Bp21').length, 1);
			assert.deepEqual(
				['TaxObjectCode', 'Gross', 'Deemed', 'Rate', 'StatusTaxExemption', 'Document'].map(
					(tag) => value(bp21, tag)[0]
				),
				['21-100-20', '10000000', '50', '5', 'TK/0', 'PaymentProof']
			);
			// BP26: the non-resident at 20%.
			const bp26 = doc('coretax-bp26-2026-01.xml');
			assert.deepEqual(
				[
					'CounterpartTin',
					'CounterpartName',
					'CounterpartCountry',
					'CounterpartDob',
					'TaxObjectCode',
					'Gross',
					'Rate'
				].map((tag) => value(bp26, tag)[0]),
				['US-TIN-9', 'Jason Lee', 'USA', '1980-01-13', '27-100-99', '50000000', '20']
			);
		}
	});
	it('ID-CONTRIBUTION-14: the JKK 50% discount for labour-intensive industries to the January 2026 wage month', () => {
		const jkk = (version: string, period: string, industry: string | null, headcount: number) => {
			const base = subject({
				terms: { monthly_wage: 10000000 },
				company: {
					risk_class: 'III',
					facts: industry ? { jkk_labour_intensive_industry: industry } : {}
				}
			});
			return fixtureValue0(
				assess(
					scheme(version, 'JKK'),
					{ ordinary: 0 },
					{ subject: { ...base, headcount }, period, version }
				)
			).employer;
		};
		assert.equal(jkk('version_1', '2025-12', 'FURNITURE', 50), 44500); // 0.445%
		assert.equal(jkk('version_2', '2026-01', 'FOOTWEAR', 80), 44500);
		assert.equal(jkk('version_2', '2026-01', 'FOOTWEAR', 49), 89000);
		assert.equal(jkk('version_2', '2026-02', 'FOOTWEAR', 80), 89000);
		assert.equal(jkk('version_2', '2026-01', null, 80), 89000);
		assert.equal(jkk('version_3', '2026-03', 'FOOTWEAR', 80), 89000);
		const half = (group: string) => {
			const base = subject({
				terms: { monthly_wage: 10000000 },
				company: { risk_class: group, facts: { jkk_labour_intensive_industry: 'TEXTILE_GARMENT' } }
			});
			return fixtureValue0(
				assess(
					scheme('version_1', 'JKK'),
					{ ordinary: 0 },
					{ subject: { ...base, headcount: 50 }, period: '2025-12', version: 'version_1' }
				)
			).employer;
		};
		// PP 7/2025 art.4(1): I 0.120%, II 0.270%, III 0.445%, IV 0.635%, V 0.870%.
		assert.deepEqual(['I', 'II', 'III', 'IV', 'V'].map(half), [12000, 27000, 44500, 63500, 87000]);
	});
	it('ID-CONTRIBUTION-15, ID-OBLIGATION-11: a foreign worker planned under 6 months is outside BPJS', () => {
		for (const version of versions) {
			const foreign = (months: number) =>
				subject({
					employee: { nationality: 'JP' },
					terms: {
						residency_status: 'RESIDENT_FOREIGNER',
						facts: { indonesia_work_months_planned: months }
					}
				});
			for (const code of ['JHT', 'JKK', 'JKM', 'KESEHATAN']) {
				const short = fixtureValue0(
					assess(scheme(version, code), { ordinary: 10000000 }, { subject: foreign(5), version })
				);
				assert.deepEqual([short.employee, short.employer], [0, 0], code);
				const long = fixtureValue0(
					assess(scheme(version, code), { ordinary: 10000000 }, { subject: foreign(6), version })
				);
				assert.ok(fixtureNumber(long.employer) > 0, code);
			}
			const settings = settingsOf(version);
			const hire = (months: number) =>
				raiseDuties({
					behaviours: settings.behaviours,
					settings_id: settings.id,
					rows: read(version, 'rule_set'),
					collection: 'employment_contract',
					event: 'created',
					row: {
						id: 'k1',
						company_id: 'c1',
						employee_id: 'p1',
						effective_range: { from: '2026-03-16', to: null },
						facts: {
							contract_terms: [
								{ employment_type: 'CONTRACT', facts: { indonesia_work_months_planned: months } }
							]
						},
						employee_number: String('p1'),
						contract_number: 1
					},
					reads: { employee: [{ nationality: 'JP', facts: {} }] }
				}).map((write) => write.duty_code);
			assert.equal(hire(5).includes('BPJS_KESEHATAN_REGISTRATION'), false);
			assert.equal(hire(5).includes('BPJS_KETENAGAKERJAAN_REGISTRATION'), false);
			assert.ok(hire(12).includes('BPJS_KESEHATAN_REGISTRATION'));
			assert.ok(hire(5).includes('FOREIGN_WORKER_COMPANION_TRAINING'));
		}
	});
	it('ID-CONTRIBUTION-13: piece-rate BPJS on the 3-month average (12 when weather-dependent)', () => {
		for (const version of versions) {
			const months = [
				{ month: '2025-04', gross: 20000000 },
				{ month: '2025-12', gross: 6000000 },
				{ month: '2026-01', gross: 8000000, OVERTIME: 1000000 },
				{ month: '2026-02', gross: 8000000 }
			];
			const at = (weather: boolean) => {
				const base = subject({
					terms: {
						statutory_work_category: 'PIECE_RATE',
						monthly_wage: 0,
						facts: { weather_dependent: weather }
					}
				});
				return assessmentResult(
					assess(
						scheme(version, 'JHT'),
						{ ordinary: 9000000 },
						{ subject: { ...base, earned: { months } }, period: '2026-03', version }
					)
				).parts.ordinary;
			};
			assert.equal(at(false), 7000000); // (6 + 7 + 8) / 3
			assert.equal(at(true), 10250000); // (20 + 6 + 7 + 8) / 4
		}
	});
	it('ID-TAX-1: every one of the 125 TER brackets of PP 58/2023 Lampiran, at its upper edge and one rupiah above', () => {
		// Transcribed from the signed PP 58/2023 Lampiran A–C (jdih.kemenkeu.go.id), independent of the seed.
		const M = 1000000;
		const TABLES: [Row, [number | null, number][]][] = [
			[
				{ marital_status: 'SINGLE', dependents_count: 0 },
				[
					[5.4, 0],
					[5.65, 0.25],
					[5.95, 0.5],
					[6.3, 0.75],
					[6.75, 1],
					[7.5, 1.25],
					[8.55, 1.5],
					[9.65, 1.75],
					[10.05, 2],
					[10.35, 2.25],
					[10.7, 2.5],
					[11.05, 3],
					[11.6, 3.5],
					[12.5, 4],
					[13.75, 5],
					[15.1, 6],
					[16.95, 7],
					[19.75, 8],
					[24.15, 9],
					[26.45, 10],
					[28, 11],
					[30.05, 12],
					[32.4, 13],
					[35.4, 14],
					[39.1, 15],
					[43.85, 16],
					[47.8, 17],
					[51.4, 18],
					[56.3, 19],
					[62.2, 20],
					[68.6, 21],
					[77.5, 22],
					[89, 23],
					[103, 24],
					[125, 25],
					[157, 26],
					[206, 27],
					[337, 28],
					[454, 29],
					[550, 30],
					[695, 31],
					[910, 32],
					[1400, 33],
					[null, 34]
				]
			],
			[
				{ marital_status: 'MARRIED', dependents_count: 1 },
				[
					[6.2, 0],
					[6.5, 0.25],
					[6.85, 0.5],
					[7.3, 0.75],
					[9.2, 1],
					[10.75, 1.5],
					[11.25, 2],
					[11.6, 2.5],
					[12.6, 3],
					[13.6, 4],
					[14.95, 5],
					[16.4, 6],
					[18.45, 7],
					[21.85, 8],
					[26, 9],
					[27.7, 10],
					[29.35, 11],
					[31.45, 12],
					[33.95, 13],
					[37.1, 14],
					[41.1, 15],
					[45.8, 16],
					[49.5, 17],
					[53.8, 18],
					[58.5, 19],
					[64, 20],
					[71, 21],
					[80, 22],
					[93, 23],
					[109, 24],
					[129, 25],
					[163, 26],
					[211, 27],
					[374, 28],
					[459, 29],
					[555, 30],
					[704, 31],
					[957, 32],
					[1405, 33],
					[null, 34]
				]
			],
			[
				{ marital_status: 'MARRIED', dependents_count: 3 },
				[
					[6.6, 0],
					[6.95, 0.25],
					[7.35, 0.5],
					[7.8, 0.75],
					[8.85, 1],
					[9.8, 1.25],
					[10.95, 1.5],
					[11.2, 1.75],
					[12.05, 2],
					[12.95, 3],
					[14.15, 4],
					[15.55, 5],
					[17.05, 6],
					[19.5, 7],
					[22.7, 8],
					[26.6, 9],
					[28.1, 10],
					[30.1, 11],
					[32.6, 12],
					[35.4, 13],
					[38.9, 14],
					[43, 15],
					[47.4, 16],
					[51.2, 17],
					[55.8, 18],
					[60.4, 19],
					[66.7, 20],
					[74.5, 21],
					[83.2, 22],
					[95.6, 23],
					[110, 24],
					[134, 25],
					[169, 26],
					[221, 27],
					[390, 28],
					[463, 29],
					[561, 30],
					[709, 31],
					[965, 32],
					[1419, 33],
					[null, 34]
				]
			]
		];
		assert.equal(
			TABLES.reduce((sum, [, rows]) => sum + rows.length, 0),
			125
		);
		for (const version of versions) {
			const tax = scheme(version, 'PPH21');
			const rules = payrollRules(version);
			for (const [employee, rows] of TABLES) {
				const base = subject({ employee, terms: { monthly_wage: 0 } });
				const ter = (gross: number) =>
					fixtureValue0(
						assess(
							tax,
							{ ordinary: gross, additional: 0 },
							{
								subject: base,
								period: '2026-03',
								version,
								rules
							}
						)
					).employee;
				rows.forEach(([upTo, rate], index) => {
					if (upTo == null) return;
					const edge = Math.round(upTo * M);
					assert.equal(ter(edge), Math.round((edge * rate) / 100), `${version} ${edge}`);
					assert.equal(
						ter(edge + 1),
						Math.round(((edge + 1) * fixturePresent(rows[index + 1])[1]) / 100),
						`${version} ${edge + 1}`
					);
				});
			}
		}
	});
	it('ID-TAX-3/4/19/20/21: permanent-only reckoning, DPLK, the no-NPWP surcharge', () => {
		for (const version of versions) {
			const dec = (terms: Row, employee: Row = {}) =>
				fixtureValue0(
					assess(
						scheme(version, 'PPH21'),
						{ ordinary: 10000000, additional: 0 },
						{
							subject: subject({
								terms: { monthly_wage: 10000000, ...terms },
								employee: { marital_status: 'SINGLE', dependents_count: 0, ...employee }
							}),
							period: '2026-12',
							year: { ordinary: 110000000 },
							version
						}
					)
				).employee;
			// Gross 120,000,000 − biaya jabatan 6,000,000 − PTKP 54,000,000 = 60,000,000 → 5% = 3,000,000.
			assert.equal(dec({}), 3000000);
			// PMK 168/2023 art.10(1)(b): DPLK 200,000 a month × 12 → PKP 57,600,000 → 2,880,000.
			assert.equal(dec({ facts: { dplk_employee_monthly: 200000 } }), 2880000);
			// A part-time worker (pegawai tidak tetap) stays on TER in December: A 2% of 10,000,000.
			assert.equal(dec({ employment_type: 'PART_TIME' }), 200000);
			// UU 36/2008 art.21(5a): 20% more without an NPWP or validated NIK.
			assert.equal(dec({}, { facts: { tax_id_validated: false } }), 3600000);
			assert.equal(
				dec({ employment_type: 'PART_TIME' }, { facts: { tax_id_validated: false } }),
				240000
			);
			assert.equal(dec({}, { facts: { tax_id_validated: true } }), 3000000);
		}
		// A part-time leaver gets no BPA1 (PER-11/PJ/2025); a permanent one does.
		for (const version of versions) {
			const settings = settingsOf(version);
			const exit = (employment_type: string) =>
				raiseDuties({
					behaviours: settings.behaviours,
					settings_id: settings.id,
					rows: read(version, 'rule_set'),
					collection: 'employment_contract',
					event: 'updated',
					row: {
						id: 'k1',
						company_id: 'c1',
						employee_id: 'p1',
						exit_facts: {},
						effective_range: { from: '2024-01-01', to: '2026-06-30' },
						facts: { contract_terms: [{ employment_type }] },
						employee_number: String('p1'),
						contract_number: 1
					},
					reads: { employee: [{ nationality: 'ID', date_of_birth: '1990-01-01', facts: {} }] }
				}).map((write) => write.duty_code);
			assert.equal(exit('PART_TIME').includes('PPH21_BPA1_EXIT'), false);
			assert.equal(exit('DAILY').includes('PPH21_BPA1_EXIT'), false);
			assert.ok(exit('PERMANENT').includes('PPH21_BPA1_EXIT'));
			assert.ok(exit('CONTRACT').includes('PPH21_BPA1_EXIT'));
		}
	});
	it('ID-TAX-14: PPh 21 DTP reproduces PMK 105/2025 (and PMK 10/2025) — the tax is paid back in cash', () => {
		const dtp = (
			version: string,
			period: string,
			over: {
				klu?: string;
				facts?: Row;
				terms?: Row;
			} = {},
			pph21 = 120000,
			paidBack = 0
		) => {
			const base = subject({
				company: { facts: { klu: over.klu ?? '13111' } },
				employee: {
					facts: {
						tax_id_validated: true,
						pph21_dtp_reference_gross: 8000000,
						pph21_dtp_reference_year: Number(period.slice(0, 4)),
						...over.facts
					}
				},
				terms: over.terms ?? {}
			});
			const result = assess(
				scheme(version, 'PPH21_DTP'),
				{},
				{
					subject: base,
					period,
					version,
					charged: { month: { PPH21: { employee: pph21 }, PPH21_DTP: { employee: paidBack } } }
				}
			);
			return result === null || result === 'REFUSED' ? result : result.employee;
		};
		// Lampiran B example 1 (Tuan A, KLU 13111): 120,000 withheld each month and borne by the government; December 540,000.
		assert.equal(dtp('version_3', '2026-03'), -120000);
		assert.equal(dtp('version_3', '2026-12', {}, 540000), -540000);
		// Example 3: a December over-withholding (−287,500) is not refunded — the DTP reverses it.
		assert.equal(dtp('version_3', '2026-12', {}, -287500), 287500);
		// Art.5(1): paid back with the payment it is withheld from, never deferred — an off-cycle slip after the salary
		// slip pays back only its own PPh 21 (the month's 150,000 less the 120,000 already paid back), in every version.
		for (const version of versions)
			assert.equal(
				dtp(
					version,
					version === 'version_1' ? '2025-12' : '2026-03',
					{ klu: '31001' },
					150000,
					-120000
				),
				-30000
			);
		// Example 4: a non-permanent worker at 500,000 a day qualifies; 500,001 does not.
		assert.equal(
			dtp(
				'version_3',
				'2026-06',
				{ terms: { employment_type: 'DAILY', facts: { daily_wage: 500000 } } },
				2500
			),
			-2500
		);
		assert.equal(
			dtp(
				'version_3',
				'2026-06',
				{ terms: { employment_type: 'DAILY', facts: { daily_wage: 500001 } } },
				2500
			),
			null
		);
		// Not for: a KLU outside Lampiran A, a reference gross above 10,000,000, an unvalidated tax id, last year's reference.
		assert.equal(dtp('version_3', '2026-03', { klu: '62019' }), null);
		assert.equal(
			dtp('version_3', '2026-03', { facts: { pph21_dtp_reference_gross: 10000001 } }),
			null
		);
		assert.equal(dtp('version_3', '2026-03', { facts: { tax_id_validated: false } }), null);
		assert.equal(dtp('version_3', '2026-03', { facts: { pph21_dtp_reference_year: 2025 } }), null);
		// Tourism (KLU 55110, hotel) joined in 2026 only; PMK 10/2025 covers the four manufacturing sectors in December 2025.
		assert.equal(dtp('version_2', '2026-01', { klu: '55110' }), -120000);
		assert.equal(dtp('version_1', '2025-12', { klu: '55110' }), null);
		assert.equal(dtp('version_1', '2025-12', { klu: '31001' }), -120000);
		// The deposit nets the DTP; the warning asks for the reference month where the KLU qualifies.
		for (const version of versions) {
			assert.ok(
				fixturePresent(
					fixturePresent(obligations(version).find((row) => row.code === 'PPH21_PAYMENT')).rules
						.schemes
				).includes('PPH21_DTP')
			);
			const warn = fixturePresent(
				fixturePresent(scheme(version, 'PPH21_DTP').configuration.warn_when)[0]
			).when;
			assert.equal(
				evaluateConfigured(
					fixtureString(warn),
					fixtureContext(subject({ company: { facts: { klu: '13111' } } }))
				),
				true
			);
			assert.equal(
				evaluateConfigured(
					fixtureString(warn),
					fixtureContext(subject({ company: { facts: { klu: '62019' } } }))
				),
				false
			);
		}
	});
	it.effect(
		'ID-TAX-14: a DTP run leaves the worker the gross before tax',
		Effect.fnUntraced(function* () {
			const { tables, run, lines } = idWorld();
			fixturePresent(fixturePresent(tables.get('entity'))[0]).facts = { klu: '14111' };
			fixturePresent(fixturePresent(tables.get('employment_profile'))[0]).facts = {
				tax_id_validated: true,
				pph21_dtp_reference_gross: 10000000,
				pph21_dtp_reference_year: 2026
			};
			const plan = yield* run('2026-01', 'REGULAR');
			const budi = lines(plan, 'p1');
			assert.ok(fixturePresent(fixturePresent(budi.PPH21)[0]) > 0);
			assert.equal(
				fixturePresent(budi.PPH21_DTP)[0],
				-fixturePresent(fixturePresent(budi.PPH21)[0])
			);
			assert.equal(lines(plan, 'p2').PPH21_DTP, undefined); // Sari has no reference gross recorded
		})
	);
	it('ID-TAX-9/10/22: final PPh 21 bands over the calendar year, and on a lump-sum pension', () => {
		for (const version of versions) {
			const fin = (code: string, amount: number, year = 0, charged = 0) =>
				fixtureValue0(
					assess(
						scheme(version, code),
						{ ordinary: amount },
						{
							year: { ordinary: year },
							charged: { year: { [code]: { employee: charged } } },
							version
						}
					)
				).employee;
			// PP 68/2009 art.5: 0% to 50,000,000, 5% above.
			assert.equal(fin('PPH21_FINAL_PENSION', 50000000), 0);
			assert.equal(fin('PPH21_FINAL_PENSION', 80000000), 1500000);
			// Two severance parts of 40,000,000 in one year: banded together (1,500,000), less what the first withheld (0).
			assert.equal(fin('PPH21_FINAL_SEVERANCE', 40000000, 40000000, 0), 1500000);
			assert.equal(fin('PPH21_FINAL_SEVERANCE', 40000000, 0, 0), 0);
			// PP 68/2009 art.2(2): a part paid the next calendar year bands on from last year's base; art.6: a part in
			// the third calendar year takes the art.17 rates. Paid in March 2026 / 2027 / 2028 here.
			const later = (
				period: string,
				history: [string, number][],
				amount = 40000000,
				exit = '2025-11-30'
			) =>
				fixtureValue0(
					assess(
						scheme(version, 'PPH21_FINAL_SEVERANCE'),
						{ ordinary: amount },
						{
							subject: {
								...subject({ employment: { exit_date: exit } }),
								earned: {
									months: [],
									history: history.map(([month, base]) => ({
										month,
										statutory: { PPH21_FINAL_SEVERANCE: { employee: 0, employer: 0, base } }
									}))
								}
							},
							period,
							version
						}
					)
				).employee;
			// 2025 paid 40,000,000 (no tax); 2026 pays 40,000,000: 80,000,000 together is 1,500,000 (not 0 alone).
			assert.equal(later('2026-03', [['2025-12', 40000000]]), 1500000, version);
			assert.equal(later('2026-03', []), 0);
			// 2025 paid 80,000,000 (1,500,000 then): 2026's 40,000,000 runs 80–120 million = 20 m at 5% + 20 m at 15%.
			assert.equal(later('2026-03', [['2025-12', 80000000]]), 4000000);
			// A third-year part (2025 and 2026 paid before): art.17 on 2027's 40,000,000 = 5% to 60 million.
			assert.equal(
				later('2027-03', [
					['2025-12', 40000000],
					['2026-06', 10000000]
				]),
				2000000
			);
			const warn = fixturePresent(
				fixturePresent(scheme(version, 'PPH21_FINAL_SEVERANCE').configuration.warn_when)[0]
			).when;
			const at = (exit_date: string, history: Row[]) =>
				evaluateConfigured(
					fixtureString(warn),
					fixtureContext({
						period: { from: '2027-03-01' },
						employment: { exit_date },
						earned: { history }
					})
				);
			// An exit before last year with no part two years back in the 24 months read is flagged.
			assert.equal(at('2025-01-31', []), true);
			assert.equal(at('2026-05-31', []), false);
			assert.equal(
				at('2025-01-31', [{ month: '2025-06', statutory: { PPH21_FINAL_SEVERANCE: { base: 1 } } }]),
				false
			);
			const pension = catalog(version, 'adhoc_catalog', 'PENSION_LUMPSUM');
			assert.deepEqual(pension.counts_toward, ['PPH21_FINAL_PENSION', 'PPH26']);
		}
	});
	it('ID-TAX-18: PPh 26 at the treaty rate, never above 20%', () => {
		for (const version of versions) {
			const pph26 = (rate?: number) =>
				assess(
					scheme(version, 'PPH26'),
					{ ordinary: 10000000 },
					{
						subject: subject({
							terms: { residency_status: 'NON_RESIDENT' },
							employee: { facts: rate == null ? {} : { pph26_treaty_rate: rate } }
						}),
						version
					}
				);
			assert.equal(fixtureValue0(pph26(0.1)).employee, 1000000);
			assert.equal(fixtureValue0(pph26()).employee, 2000000);
			assert.equal(pph26(0.25), 'REFUSED');
		}
	});
	it('ID-TAX-5: the Kesehatan floor raises the employer premium in the PPh 21 gross', () => {
		const kes = fixtureValue0(assess(scheme('version_3', 'KESEHATAN'), { ordinary: 3000000 }));
		assert.equal(kes.employer, 229195); // 4% of DKI 5,729,876
		const pph = fixtureValue0(
			assess(
				scheme('version_3', 'PPH21'),
				{ ordinary: 6000000, additional: 0 },
				{
					subject: subject({
						employee: { marital_status: 'SINGLE', dependents_count: 0 },
						terms: { monthly_wage: 6000000 }
					}),
					charged: { month: { KESEHATAN: { employer: kes.employer } } }
				}
			)
		);
		// 6,229,195 is in TER A's 5,950,000–6,300,000 band (0.75%).
		assert.equal(pph.employee, Math.round(6229195 * 0.0075));
	});
	it('ID-LEAVE-2/4/5/15: leave pay on the usual wage (basic plus fixed allowances)', () => {
		for (const version of versions) {
			const work = (code: string, context: Row) => {
				const row = catalog(version, 'work_catalog', code);
				if (evaluateConfigured(fixtureString(row.eligibility), fixtureContext(context)) !== true)
					return 0;
				return (
					Number(evaluateConfigured(fixtureString(row.quantity), fixtureContext(context))) *
					Number(evaluateConfigured(fixtureString(row.rate), fixtureContext(context)))
				);
			};
			// The review's example: 3 unpaid days of a 31-day month on 9,300,000 → 900,000.
			const npl = {
				...payslipOf({ terms: { base_salary: 9300000, monthly_wage: 9300000 } }, version),
				leave: { rows: [leaveRow({ code: 'UNPAID_LEAVE', days: 3, is_npl: true })] }
			};
			assert.equal(work('NO_PAY_LEAVE', npl), 900000);
			// With a 700,000 fixed allowance the day is (9,300,000 + 700,000) / 31.
			const allowance = {
				...npl,
				terms: { ...npl.terms, base_salary: 9300000, monthly_wage: 10000000 }
			};
			assert.equal(work('NO_PAY_LEAVE', allowance), (3 * 10000000) / 31);
			// STMB: 100% for 12 months, then 50% (PP 82/2019).
			const stmb = catalog(version, 'leave_catalog', 'WORK_ACCIDENT_LEAVE').pay_fraction;
			assert.deepEqual(
				[12, 13].map((month_index) =>
					evaluateConfigured(
						fixtureString(stmb),
						fixtureContext({ leave: leaveRow({ month_index }) })
					)
				),
				[1, 0.5]
			);
		}
	});
	it('ID-LEAVE-3: joint leave draws on the annual balance', () => {
		for (const version of versions) {
			const rows = read(version, 'leave_catalog');
			const annual = catalog(version, 'leave_catalog', 'ANNUAL_LEAVE');
			const joint = catalog(version, 'leave_catalog', 'JOINT_LEAVE');
			const balances = leaveBalances({
				classes: rows.map((row) => seedClass(row)),
				movements: [
					seedMovement({
						catalog_id: joint.id,
						employment_id: 'k1',
						activity: 'TIME_OFF',
						days: 1,
						occurred_on: '2026-03-18'
					})
				],
				serviceMonths: 40,
				asOf: '2026-03-31',
				employmentStart: '2022-12-01',
				context: { ...subject(), entry: { facts: {} } }
			});
			const held = fixturePresent(balances.find((row) => row.catalog_id === annual.id));
			assert.equal(held.entitlement + held.carried - held.available, 1, version);
			assert.equal(joint.consumes_code, 'ANNUAL_LEAVE');
		}
	});
	it('ID-LEAVE-6/7/8/9/13/16–22: leave classes — maternity, miscarriage, paternity, religious duty once, paid absences', () => {
		for (const version of versions) {
			const admit = (
				code: string,
				facts: Row,
				employee: Row = {},
				earlierRows: Row[] = [],
				company: Row = {}
			) =>
				evaluateConfigured(
					fixtureString(catalog(version, 'leave_catalog', code).eligibility || 'true'),
					fixtureContext({
						...subject({ employee, company }),
						rules: {},
						...ctxEntry(facts, earlierRows)
					})
				);
			const female = { gender: 'FEMALE' };
			// UU 13/2003 art.82(2): 1.5 months after a miscarriage (one month and fifteen days).
			assert.equal(
				admit(
					'MISCARRIAGE_LEAVE',
					{ event_kind: 'MISCARRIAGE', from: '2026-03-01', to: '2026-04-15' },
					female
				),
				true
			);
			assert.equal(
				admit(
					'MISCARRIAGE_LEAVE',
					{ event_kind: 'MISCARRIAGE', from: '2026-03-01', to: '2026-04-16' },
					female
				),
				false
			);
			assert.equal(
				admit('MISCARRIAGE_LEAVE', { event_kind: 'MISCARRIAGE' }, { gender: 'MALE' }),
				false
			);
			// UU 4/2024 art.6(1)(a): up to 3 more paternity days by agreement.
			assert.equal(
				admit(
					'PATERNITY_EXTENSION_LEAVE',
					{ event_kind: 'BIRTH', employer_agreed: true },
					{ gender: 'MALE' }
				),
				true
			);
			assert.equal(
				admit('PATERNITY_EXTENSION_LEAVE', { event_kind: 'BIRTH' }, { gender: 'MALE' }),
				false
			);
			assert.equal(
				evaluateConfigured(
					fixtureString(
						entitlementOf(catalog(version, 'leave_catalog', 'PATERNITY_EXTENSION_LEAVE')).days
					),
					fixtureContext({})
				),
				3
			);
			// PP 36/2021 art.43: religious-duty leave is paid once in the employment.
			assert.equal(
				admit('RELIGIOUS_DUTY_LEAVE', { event_kind: 'RELIGIOUS_DUTY', event_id: 'hajj' }),
				true
			);
			assert.equal(
				admit('RELIGIOUS_DUTY_LEAVE', { event_kind: 'RELIGIOUS_DUTY', event_id: 'hajj' }, {}, [
					{ activity: 'TIME_OFF', facts: { event_id: 'hajj' } }
				]),
				true
			);
			assert.equal(
				admit('RELIGIOUS_DUTY_LEAVE', { event_kind: 'RELIGIOUS_DUTY', event_id: 'hajj2' }, {}, [
					{ activity: 'TIME_OFF', facts: { event_id: 'hajj' } }
				]),
				false
			);
			// PP 36/2021 art.40(1)–(4): an absence the law pays is never booked as unpaid.
			for (const reason of [
				'STATE_DUTY',
				'UNION_DUTY',
				'COMPANY_TRAINING',
				'EMPLOYER_IDLE',
				'SUSPENSION',
				'BREASTFEEDING'
			])
				assert.equal(admit('UNPAID_LEAVE', { event_kind: reason }), false, reason);
			assert.equal(admit('UNPAID_LEAVE', { event_kind: 'PERSONAL' }), true);
			// The paid absences: state duty (shortfall only), union duty (with consent), training, idle, suspension, long leave.
			assert.equal(admit('STATE_DUTY_LEAVE', { event_kind: 'STATE_DUTY', duty_months: 12 }), true);
			assert.equal(admit('STATE_DUTY_LEAVE', { event_kind: 'STATE_DUTY', duty_months: 13 }), false);
			const state = catalog(version, 'leave_catalog', 'STATE_DUTY_LEAVE').pay_fraction;
			assert.equal(
				evaluateConfigured(
					fixtureString(state),
					fixtureContext({ leave: leaveRow({ facts: { state_income_share: 0.4 } }) })
				),
				0.6
			);
			assert.equal(
				evaluateConfigured(
					fixtureString(state),
					fixtureContext({ leave: leaveRow({ facts: { state_income_share: 1.2 } }) })
				),
				0
			);
			assert.equal(admit('UNION_DUTY_LEAVE', { employer_consent: true }), true);
			assert.equal(admit('UNION_DUTY_LEAVE', {}), false);
			assert.equal(admit('LONG_LEAVE', {}, {}, [], { facts: { long_leave_granted: true } }), true);
			assert.equal(admit('LONG_LEAVE', {}), false);
			for (const code of [
				'COMPANY_TRAINING_LEAVE',
				'EMPLOYER_IDLE',
				'SUSPENSION',
				'UNION_DUTY_LEAVE',
				'LONG_LEAVE'
			]) {
				const row = catalog(version, 'leave_catalog', code);
				assert.deepEqual([row.is_npl, row.pay_fraction], [false, ''], code);
			}
		}
	});
	it('ID-ADHOC-2/8/9/10–14: THR average, travel home, detention aid, late-wage and late-THR fines, natura', () => {
		for (const version of versions) {
			// Permenaker 6/2016 art.3(3): a daily worker's THR on the 12-month average, pro rata below 12 months.
			assert.equal(
				priceAdhoc(
					version,
					'THR_HOLIDAY',
					{ terms: { employment_type: 'DAILY' }, employment: { service_months: 6 } },
					{ average_monthly_wage_12m: 4200000 }
				),
				2100000
			);
			assert.equal(
				priceAdhoc(
					version,
					'THR_HOLIDAY',
					{ terms: { employment_type: 'DAILY' }, employment: { service_months: 6 } },
					{},
					[],
					1234000
				),
				1234000
			);
			// PP 35/2021 art.40(4)(b): travel home only for a worker taken on elsewhere, and only on termination.
			const exit = { employment: { exit_date: '2026-03-31' } };
			assert.equal(
				priceAdhoc(version, 'UPH_TRAVEL_HOME', exit, { hired_at_other_place: true }, [], 3000000),
				3000000
			);
			assert.equal(priceAdhoc(version, 'UPH_TRAVEL_HOME', exit, {}, [], 3000000), null);
			assert.ok(
				fixtureValue4(catalog(version, 'adhoc_catalog', 'UPH_TRAVEL_HOME').counts_toward).includes(
					'PPH21_FINAL_SEVERANCE'
				)
			);
			// PP 35/2021 art.53: 25 / 35 / 45 / 50% of the wage by dependants, at most six months.
			const aid = (dependents_count: number, before = 0) =>
				priceAdhoc(
					version,
					'DETENTION_FAMILY_AID',
					{ terms: { monthly_wage: 10000000 }, employee: { dependents_count } },
					{},
					Array.from({ length: before }, () => ({ activity: 'AWARD', facts: {} }))
				);
			assert.deepEqual(
				[1, 2, 3, 4, 6].map((n) => aid(n)),
				[2500000, 3500000, 4500000, 5000000, 5000000]
			);
			assert.equal(aid(0), null);
			assert.equal(aid(2, 5), 3500000);
			assert.equal(aid(2, 6), null);
			// PP 36/2021 art.61: 5% a day from day 4 to day 8, then +1% a day, at most 50%; interest after a month.
			const fine = (paid: string, interest?: number) =>
				priceAdhoc(
					version,
					'LATE_WAGE_FINE',
					{},
					{
						wage_due_on: '2026-03-01',
						wage_paid_on: paid,
						wage_due_amount: 10000000,
						...(interest == null ? {} : { late_interest_amount: interest })
					}
				);
			// The due day is day 1 (“terhitung tanggal seharusnya Upah dibayarkan”): paid three days late is the 4th day.
			assert.equal(fine('2026-03-03'), 0);
			assert.equal(fine('2026-03-04'), 500000);
			assert.equal(fine('2026-03-05'), 1000000);
			assert.equal(fine('2026-03-09'), 2600000);
			assert.equal(fine('2026-03-15'), 3200000);
			assert.equal(fine('2026-04-10'), 5000000);
			assert.equal(fine('2026-04-10', 125000), 5125000);
			assert.equal(priceAdhoc(version, 'LATE_WAGE_FINE', {}, {}), null);
			// PP 36/2021 art.62: 5% of the THR due, for the workers' welfare (an employer cost).
			assert.equal(priceAdhoc(version, 'LATE_THR_FINE', {}, { thr_due_amount: 10000000 }), 500000);
			assert.equal(catalog(version, 'adhoc_catalog', 'LATE_THR_FINE').destination, 'EMPLOYER');
			// PMK 66/2023: the Lampiran B example 1 coupon (2,700,000 against a 2,500,000 workplace meal) taxes 200,000.
			const natura = (facts: Row, amount: number, earlierRows: Row[] = []) =>
				priceAdhoc(version, 'NATURA', {}, facts, earlierRows, amount);
			assert.equal(
				natura({ natura_kind: 'MEAL_COUPON', workplace_meal_value: 2500000 }, 2700000),
				200000
			);
			assert.equal(natura({ natura_kind: 'MEAL_COUPON' }, 2700000), 700000);
			assert.equal(natura({ natura_kind: 'WORKPLACE_MEALS' }, 1500000), 0);
			assert.equal(
				natura({ natura_kind: 'OTHER_GIFT' }, 2000000, [
					{ natura_kind: 'OTHER_GIFT', amount: 2000000, occurred_on: '2026-01-10' }
				]),
				1000000
			);
			assert.equal(
				natura({ natura_kind: 'OTHER_GIFT' }, 2000000, [
					{ natura_kind: 'OTHER_GIFT', amount: 2000000, occurred_on: '2025-01-10' }
				]),
				0
			);
			assert.equal(natura({ natura_kind: 'INDIVIDUAL_HOUSING' }, 2500000), 500000);
			assert.equal(natura({ natura_kind: 'COMPANY_CAR', car_user_qualifies: true }, 4000000), 0);
			assert.equal(natura({}, 4000000), 4000000);
			assert.equal(catalog(version, 'adhoc_catalog', 'NATURA').destination, 'DISPLAY');
		}
	});
	it('ID-ADHOC-3/4/5: every severance cause and band, and PKWT compensation per term', () => {
		const MULTIPLIER: Record<string, number> = {
			MERGER_CONSOLIDATION_SEPARATION: 1,
			ACQUISITION: 1,
			EFFICIENCY_ACTUAL_LOSS: 0.5,
			EFFICIENCY_PREVENT_LOSS: 1,
			CLOSURE_LOSS: 0.5,
			CLOSURE_NO_LOSS: 1,
			FORCE_MAJEURE_CLOSURE: 0.5,
			FORCE_MAJEURE_NO_CLOSURE: 0.75,
			DEBT_SUSPENSION_LOSS: 0.5,
			DEBT_SUSPENSION_NO_LOSS: 1,
			BANKRUPTCY: 0.5,
			EMPLOYEE_REQUEST_EMPLOYER_MISCONDUCT: 1,
			VIOLATION_AFTER_WARNINGS: 0.5,
			LONG_ILLNESS_OR_WORK_ACCIDENT_DISABILITY: 2,
			RETIREMENT: 1.75,
			DEATH: 2,
			ACQUISITION_TERMS_CHANGE_REJECTED: 0.5
		};
		// PP 35/2021 art.40(2): 1 month below one year … 9 from eight years; art.40(3): UPMK 2 from 3 years … 10 from 24.
		const PESANGON_BANDS: [number, number][] = [
			[11, 1],
			[12, 2],
			[23, 2],
			[24, 3],
			[36, 4],
			[48, 5],
			[60, 6],
			[72, 7],
			[84, 8],
			[95, 8],
			[96, 9],
			[300, 9]
		];
		const UPMK_BANDS: [number, number | null][] = [
			[35, null],
			[36, 2],
			[72, 3],
			[108, 4],
			[144, 5],
			[180, 6],
			[216, 7],
			[252, 8],
			[287, 8],
			[288, 10]
		];
		for (const version of versions) {
			const leaver = (cause: string, months: number) => ({
				terms: { monthly_wage: 10000000 },
				employment: {
					service_months: months,
					exit_date: '2026-03-31',
					exit_facts: { ...EXIT_FACTS, termination_cause: cause }
				}
			});
			for (const [cause, factor] of Object.entries(MULTIPLIER))
				assert.equal(
					priceAdhoc(version, 'PESANGON', leaver(cause, 40), {}),
					4 * 10000000 * factor,
					cause
				);
			for (const [months, wages] of PESANGON_BANDS)
				assert.equal(
					priceAdhoc(version, 'PESANGON', leaver('MERGER_CONSOLIDATION_SEPARATION', months), {}),
					wages * 10000000,
					`${months}`
				);
			for (const [months, wages] of UPMK_BANDS)
				assert.equal(
					priceAdhoc(version, 'UPMK', leaver('MERGER_CONSOLIDATION_SEPARATION', months), {}),
					wages == null ? null : wages * 10000000,
					`${months}`
				);
			// PP 35/2021 art.15(4): an extension's compensation covers its own months (here 2026-01-01 to 2026-06-30).
			const pkwt = priceAdhoc(
				version,
				'PKWT_COMPENSATION',
				{
					terms: {
						employment_type: 'CONTRACT',
						monthly_wage: 12000000,
						effective_from: '2026-01-01',
						effective_to: '2026-06-30'
					},
					employment: {
						service_months: 18,
						start_date: '2025-01-01',
						exit_date: '',
						exit_facts: EXIT_FACTS
					}
				},
				{}
			);
			assert.equal(pkwt, 6000000);
			// Art.16(1) "masa kerja/12": a term ending mid-month pays the part month at ÷30 a day (6 months 15 days).
			const partMonth = priceAdhoc(
				version,
				'PKWT_COMPENSATION',
				{
					terms: {
						employment_type: 'CONTRACT',
						monthly_wage: 12000000,
						effective_from: '2026-01-01',
						effective_to: '2026-07-15'
					},
					employment: {
						service_months: 18,
						start_date: '2025-01-01',
						exit_date: '',
						exit_facts: EXIT_FACTS
					}
				},
				{}
			);
			assert.equal(partMonth, 6500000);
		}
	});
	it('overtime payment follows the derived paid hours of the day, each hour once', () => {
		for (const version of versions) {
			const row = catalog(version, 'work_catalog', 'OVERTIME');
			// [day, week, scheduled hours, derived overtime hours, amount]: an ordinary day prices its overtime; a 0-hour
			// rest day and a holiday on a working day price every paid hour (scheduled + overtime).
			for (const [dayFacts, week, scheduled, overtime, expected] of [
				[{}, 5, 8, 3, 550000],
				[{ day_type: 'REST' }, 5, 0, 9, 1900000],
				[{ holiday_kind: 'PUBLIC_HOLIDAY' }, 6, 8, 1, 2100000],
				[{ holiday_kind: 'PUBLIC_HOLIDAY' }, 6, 5, 2, 1700000]
			] as const) {
				const amount = (worked: boolean) => {
					const context = fixtureContext({
						...payslipOf(
							{ terms: { monthly_wage: 17300000, facts: { working_days_per_week: week } } },
							version
						),
						work: {
							overtime_hours: worked ? overtime : 0,
							incentive_hours: 0,
							dates: ['2026-03-09'],
							holidays: [],
							days: [
								day({
									...dayFacts,
									worked,
									scheduled_hours: scheduled,
									overtime_hours: worked ? overtime : 0,
									worked_hours: worked ? scheduled + overtime : 0
								})
							]
						}
					});
					return evaluateConfigured(fixtureString(row.eligibility), context) === true
						? Number(evaluateConfigured(fixtureString(row.quantity), context)) *
								Number(evaluateConfigured(fixtureString(row.rate), context))
						: 0;
				};
				assert.equal(amount(true), expected);
				assert.equal(amount(false), 0);
			}
		}
	});
	it('ID-WORK-5/7/8/10–17: overtime bases, working time, rest, night work, children, daily casuals', () => {
		for (const version of versions) {
			const ot = (context: Row) => {
				const row = catalog(version, 'work_catalog', 'OVERTIME');
				return evaluateConfigured(fixtureString(row.eligibility), fixtureContext(context)) === true
					? Number(evaluateConfigured(fixtureString(row.rate), fixtureContext(context)))
					: 0;
			};
			// PP 35/2021 art.32(4): basic plus fixed 6,000,000 under 75% of 10,000,000 → base 7,500,000.
			assert.equal(
				ot(
					payslipOf(
						{
							terms: {
								monthly_wage: 6000000,
								facts: { non_fixed_allowances_monthly: 4000000, working_days_per_week: 5 }
							}
						},
						version
					)
				),
				7500000 / 173
			);
			assert.equal(
				ot(
					payslipOf(
						{
							terms: {
								monthly_wage: 6000000,
								facts: { non_fixed_allowances_monthly: 1000000, working_days_per_week: 5 }
							}
						},
						version
					)
				),
				6000000 / 173
			);
			// Art.33(2)–(3): output pay on the 12-month average (overtime out), floored at the worksite minimum.
			const piece = (months: Row[]) =>
				ot({
					...payslipOf({ terms: { statutory_work_category: 'PIECE_RATE' } }, version),
					earned: { months }
				});
			assert.equal(
				piece([
					{ month: '2026-01', gross: 7000000, OVERTIME: 500000 },
					{ month: '2026-02', gross: 6500000 }
				]),
				6500000 / 173
			);
			assert.equal(piece([{ month: '2026-02', gross: 9000000 }]), 9000000 / 173);
			assert.equal(piece([{ month: '2026-02', gross: 1000000 }]), DKI(version) / 173);
		}
		for (const version of versions) {
			const night = (start: string, end: string) =>
				day({ intervals: [{ start, end }], worked: true });
			const t = (
				code: string,
				days: Row[],
				over: Parameters<typeof subject>[0] = {},
				lines: Row = {}
			) => trips(version, code, slipCtx(version, days, over, lines));
			// PP 35/2021 art.21(2): 8 hours (5-day week), 7 (6-day week); 40 hours in seven days.
			assert.equal(t('WORKING_TIME_LIMIT', [day({ scheduled_hours: 9 })]), true);
			assert.equal(t('WORKING_TIME_LIMIT', [day({ scheduled_hours: 8 })]), false);
			assert.equal(
				t('WORKING_TIME_LIMIT', [day({ scheduled_hours: 8 })], {
					terms: { facts: { working_days_per_week: 6 } }
				}),
				true
			);
			const run = (n: number, hours = 7) =>
				Array.from({ length: n }, (_, i) =>
					day({
						date: `2026-03-${String(2 + i).padStart(2, '0')}`,
						scheduled_hours: hours,
						worked: true
					})
				);
			assert.equal(t('WORKING_TIME_LIMIT', run(6, 7)), true); // 42 hours
			assert.equal(t('WORKING_TIME_LIMIT', run(5, 8)), false);
			// PP 35/2021 art.22: 2 rest days a week on a 5-day week, 1 on a 6-day week.
			assert.equal(t('WEEKLY_REST', run(6, 6)), true);
			assert.equal(t('WEEKLY_REST', run(5, 8)), false);
			assert.equal(
				t('WEEKLY_REST', run(6, 6), { terms: { facts: { working_days_per_week: 6 } } }),
				false
			);
			assert.equal(
				t('WEEKLY_REST', run(7, 6), { terms: { facts: { working_days_per_week: 6 } } }),
				true
			);
			// UU 13/2003 art.76: women under 18 not 23:00–07:00; at-risk pregnancy; food and transport duties.
			const girl = { employee: { gender: 'FEMALE', date_of_birth: '2009-01-01' } };
			const woman = { employee: { gender: 'FEMALE', date_of_birth: '1990-01-01' } };
			assert.equal(
				t('NIGHT_WORK_FEMALE_UNDER_18', [night('2026-03-09T22:00', '2026-03-10T02:00')], girl),
				true
			);
			assert.equal(
				t('NIGHT_WORK_FEMALE_UNDER_18', [night('2026-03-09T08:00', '2026-03-09T16:00')], girl),
				false
			);
			assert.equal(
				t('NIGHT_WORK_FEMALE_UNDER_18', [night('2026-03-09T22:00', '2026-03-10T02:00')], woman),
				false
			);
			assert.equal(
				t('NIGHT_WORK_PREGNANCY', [night('2026-03-09T22:00', '2026-03-10T02:00')], {
					employee: { gender: 'FEMALE', facts: { night_work_pregnancy_risk: true } }
				}),
				true
			);
			assert.equal(
				t('NIGHT_WORK_FEMALE_DUTIES', [night('2026-03-09T22:00', '2026-03-10T02:00')], woman),
				true
			);
			assert.equal(
				t('NIGHT_WORK_FEMALE_DUTIES', [night('2026-03-09T22:00', '2026-03-10T02:00')]),
				false
			);
			// UU 13/2003 arts.68–69: under 18 warns; under 15 at most 3 hours, by day.
			const kid = { employee: { date_of_birth: '2012-01-01' } };
			assert.equal(t('CHILD_WORKER', [day({ worked: true })], kid), true);
			assert.equal(t('CHILD_WORKER', [day({ worked: true })]), false);
			assert.equal(
				t('CHILD_LIGHT_WORK_HOURS', [day({ worked: true, worked_hours: 4 })], kid),
				true
			);
			assert.equal(
				t('CHILD_LIGHT_WORK_HOURS', [day({ worked: true, worked_hours: 3 })], kid),
				false
			);
			assert.equal(
				t('CHILD_LIGHT_WORK_HOURS', [day({ worked: true, worked_hours: 3 })], {
					employee: { date_of_birth: '2010-01-01' }
				}),
				false
			);
			// PP 35/2021 art.10(3)–(4): a daily worker on 21 days a month.
			assert.equal(
				t('DAILY_CASUAL_21_DAYS', run(21, 7), { terms: { employment_type: 'DAILY' } }),
				true
			);
			assert.equal(
				t('DAILY_CASUAL_21_DAYS', run(20, 7), { terms: { employment_type: 'DAILY' } }),
				false
			);
			// UU 13/2003 art.42(4): a foreign worker on a PKWTT warns.
			assert.equal(t('FOREIGN_WORKER_PKWT', [], { employee: { nationality: 'JP' } }), true);
			assert.equal(
				t('FOREIGN_WORKER_PKWT', [], {
					employee: { nationality: 'JP' },
					terms: { employment_type: 'CONTRACT' }
				}),
				false
			);
			// PP 36/2021 arts.50–51: garnishment 20%, bankruptcy 25% of the wage.
			assert.equal(t('GARNISHMENT_CEILING', [], {}, { COURT_GARNISHMENT: -2000001 }), true);
			assert.equal(t('GARNISHMENT_CEILING', [], {}, { COURT_GARNISHMENT: -2000000 }), false);
			assert.equal(t('BANKRUPTCY_CEILING', [], {}, { BANKRUPTCY_ESTATE: -2500001 }), true);
			assert.equal(t('BANKRUPTCY_CEILING', [], {}, { BANKRUPTCY_ESTATE: -2500000 }), false);
			for (const code of [
				'NIGHT_WORK_FEMALE_UNDER_18',
				'NIGHT_WORK_PREGNANCY',
				'CHILD_LIGHT_WORK_HOURS',
				'GARNISHMENT_CEILING',
				'BANKRUPTCY_CEILING'
			])
				assert.equal(checksOf(version)[code].kind, 'hold', code);
		}
	});
	it('ID-OBLIGATION-31–37: PKWT term, probation, Indonesian, personnel position, minimum age refuse the contract', () => {
		for (const version of versions) {
			const c = (code: string, over: Parameters<typeof subject>[0], day = '2026-03-02') =>
				trips(version, code, contractCtx(version, over, day));
			// PP 35/2021 art.8: at most 5 years with extensions.
			assert.equal(
				c('PKWT_MAXIMUM_TERM', {
					terms: { employment_type: 'CONTRACT', effective_to: '2031-01-01' },
					employment: { start_date: '2026-01-01' }
				}),
				true
			);
			assert.equal(
				c('PKWT_MAXIMUM_TERM', {
					terms: { employment_type: 'CONTRACT', effective_to: '2030-12-31' },
					employment: { start_date: '2026-01-01' }
				}),
				false
			);
			assert.equal(
				c('PKWT_MAXIMUM_TERM', {
					terms: { employment_type: 'CONTRACT' },
					employment: { start_date: '2026-01-01', exit_date: '2031-01-01' }
				}),
				true
			);
			// UU 13/2003 arts.58, 60: no probation in a PKWT; at most 3 months in a PKWTT.
			assert.equal(
				c('PROBATION_RULES', {
					terms: { employment_type: 'CONTRACT', facts: { probation_months: 1 } }
				}),
				true
			);
			assert.equal(c('PROBATION_RULES', { terms: { facts: { probation_months: 3 } } }), false);
			assert.equal(c('PROBATION_RULES', { terms: { facts: { probation_months: 4 } } }), true);
			// UU 13/2003 art.57(1): a PKWT in Indonesian.
			assert.equal(
				c('PKWT_WRITTEN_INDONESIAN', {
					terms: { employment_type: 'CONTRACT', facts: { written_in_indonesian: false } }
				}),
				true
			);
			assert.equal(
				c('PKWT_WRITTEN_INDONESIAN', {
					terms: { employment_type: 'CONTRACT', facts: { written_in_indonesian: true } }
				}),
				false
			);
			// PP 34/2021 art.11: no foreign worker in a personnel position.
			assert.equal(
				c('FOREIGN_WORKER_PERSONNEL_POSITION', {
					employee: { nationality: 'SG' },
					terms: { facts: { personnel_position: true } }
				}),
				true
			);
			assert.equal(
				c('FOREIGN_WORKER_PERSONNEL_POSITION', { terms: { facts: { personnel_position: true } } }),
				false
			);
			// UU 13/2003 arts.68–70: no worker under 13.
			assert.equal(c('MINIMUM_AGE', { employee: { date_of_birth: '2013-03-03' } }), true);
			assert.equal(c('MINIMUM_AGE', { employee: { date_of_birth: '2013-03-02' } }), false);
			for (const code of [
				'PKWT_MAXIMUM_TERM',
				'PROBATION_RULES',
				'PKWT_WRITTEN_INDONESIAN',
				'FOREIGN_WORKER_PERSONNEL_POSITION',
				'MINIMUM_AGE',
				'DAILY_MINIMUM_WAGE',
				'HOURLY_MINIMUM_WAGE',
				'MINIMUM_WAGE_REGION_UNKNOWN'
			])
				assert.deepEqual(
					[checksOf(version)[code].site, checksOf(version)[code].kind],
					['contract', 'refuse'],
					code
				);
		}
	});
	it('ID-OBLIGATION-9, ID-SETTINGS-11: national holidays seeded unpublished; THR from the Indonesian SKB names', () => {
		const HOLIDAYS_2026 = [
			['2026-01-01', 'Tahun Baru 2026 Masehi'],
			['2026-01-16', 'Isra Mikraj Nabi Muhammad S.A.W.'],
			['2026-02-17', 'Tahun Baru Imlek 2577 Kongzili'],
			['2026-03-19', 'Hari Suci Nyepi (Tahun Baru Saka 1948)'],
			['2026-03-21', 'Idul Fitri 1447 Hijriah'],
			['2026-03-22', 'Idul Fitri 1447 Hijriah'],
			['2026-04-03', 'Wafat Yesus Kristus'],
			['2026-04-05', 'Kebangkitan Yesus Kristus (Paskah)'],
			['2026-05-01', 'Hari Buruh Internasional'],
			['2026-05-14', 'Kenaikan Yesus Kristus'],
			['2026-05-27', 'Idul Adha 1447 Hijriah'],
			['2026-05-31', 'Hari Raya Waisak 2570 BE'],
			['2026-06-01', 'Hari Lahir Pancasila'],
			['2026-06-16', '1 Muharam Tahun Baru Islam 1448 Hijriah'],
			['2026-08-17', 'Proklamasi Kemerdekaan'],
			['2026-08-25', 'Maulid Nabi Muhammad S.A.W.'],
			['2026-12-25', 'Kelahiran Yesus Kristus']
		];
		// SKB 1205/3/2 Tahun 2026 (15 September 2026), Lampiran A: 18 days, Isra Mikraj twice (1448 H and 1449 H).
		const HOLIDAYS_2027 = [
			['2027-01-01', 'Tahun Baru 2027 Masehi'],
			['2027-01-05', 'Isra Mikraj Nabi Muhammad S.A.W. 1448 Hijriah'],
			['2027-02-06', 'Tahun Baru Imlek 2578 Kongzili'],
			['2027-03-08', 'Hari Suci Nyepi (Tahun Baru Saka 1949)'],
			['2027-03-10', 'Idul Fitri 1448 Hijriah'],
			['2027-03-11', 'Idul Fitri 1448 Hijriah'],
			['2027-03-26', 'Wafat Yesus Kristus'],
			['2027-03-28', 'Kebangkitan Yesus Kristus (Paskah)'],
			['2027-05-01', 'Hari Buruh Internasional'],
			['2027-05-06', 'Kenaikan Yesus Kristus'],
			['2027-05-17', 'Idul Adha 1448 Hijriah'],
			['2027-05-20', 'Hari Raya Waisak 2571 BE'],
			['2027-06-01', 'Hari Lahir Pancasila'],
			['2027-06-06', '1 Muharam Tahun Baru Islam 1449 Hijriah'],
			['2027-08-15', 'Maulid Nabi Muhammad S.A.W.'],
			['2027-08-17', 'Proklamasi Kemerdekaan'],
			['2027-12-25', 'Kelahiran Yesus Kristus'],
			['2027-12-26', 'Isra Mikraj Nabi Muhammad S.A.W. 1449 Hijriah']
		];
		const CUTI_BERSAMA = [
			'2026-02-16',
			'2026-03-18',
			'2026-03-20',
			'2026-03-23',
			'2026-03-24',
			'2026-05-15',
			'2026-05-28',
			'2026-12-24',
			'2027-02-05',
			'2027-03-09',
			'2027-03-12',
			'2027-03-15',
			'2027-03-25',
			'2027-05-18',
			'2027-05-19',
			'2027-12-24'
		];
		for (const version of versions) {
			const holidays = payrollRules(version).public_holidays.holidays;
			const expected = [
				...(version === 'version_1' ? [['2025-12-25', 'Kelahiran Yesus Kristus']] : []),
				...HOLIDAYS_2026,
				// The open-ended version carries the 2027 SKB, signed before it was sealed.
				...(version === 'version_4' ? HOLIDAYS_2027 : [])
			];
			assert.deepEqual(
				holidays.map((h) => [h.date, h.name]),
				expected
			);
			assert.ok(holidays.every((h) => h.kind === 'PUBLIC_HOLIDAY'));
			// Each row cites the signed SKB of its own year on kemenkopmk.go.id; no row is regional.
			for (const h of holidays) {
				assert.match(
					String(h.source),
					new RegExp(`kemenkopmk\\.go\\.id/.*Tahun%20${h.date.slice(0, 4)}\\.pdf\\)$`),
					h.date
				);
				assert.equal('regions' in h, false, h.date);
			}
			assert.equal(
				holidays.some((h) => CUTI_BERSAMA.includes(h.date)),
				false
			);
			const settings = settingsOf(version);
			const writer = fixturePresent(
				settings.behaviours.rules.find((rule: Row) => rule.id === 'write-public-holidays')
			);
			const writes = effectWrites(writer, {
				event: {
					collection: 'entity',
					action: 'created',
					company_id: fixtureKey('c1'),
					settings_id: settings.id,
					row: { id: fixtureKey('c1'), region: 'Provinsi DKI Jakarta' }
				},
				calendar: [{ rules: payrollRules(version).public_holidays }],
				held: [{ date: '2026-08-17' }]
			});
			assert.equal(writes.length, expected.length - 1);
			assert.ok(
				writes.every(
					(write) =>
						write.collection === 'holiday' &&
						write.data.company_id === fixtureKey('c1') &&
						!('approval_id' in write.data)
				)
			);
			const thr = (period: string, named: Row[]) =>
				Object.fromEntries(
					raiseDuties({
						behaviours: settings.behaviours,
						settings_id: settings.id,
						rows: read(version, 'rule_set'),
						collection: 'payroll_run',
						event: 'created',
						row: { id: `r-${period}`, period, company_id: 'c1' },
						reads: { holidays: named, company: [{ region: 'Provinsi DKI Jakarta', facts: {} }] }
					}).map((write) => [write.duty_code, write.due_on])
				).THR_PAYMENT;
			const skb = holidays.map((h) => ({ date: h.date, name: h.name, kind: h.kind }));
			if (version === 'version_1') assert.equal(thr('2025-12', skb), '2025-12-18');
			assert.equal(thr('2026-12', skb), '2026-12-18'); // Kelahiran Yesus Kristus
			assert.equal(thr('2026-03', skb), '2026-03-12'); // Nyepi 19 March − 7
			assert.equal(thr('2026-02', skb), '2026-02-10'); // Imlek 17 February − 7
			assert.equal(thr('2026-05', skb), '2026-05-24'); // Waisak 31 May − 7
			if (version === 'version_4') {
				assert.equal(thr('2027-01', skb), '2027-01-30'); // Imlek 6 February 2027 − 7
				assert.equal(thr('2027-03', skb), '2027-03-01'); // Nyepi 8 March 2027 − 7, before Idul Fitri’s 3 March
				assert.equal(thr('2027-12', skb), '2027-12-18'); // Kelahiran Yesus Kristus
			}
		}
	});
	it('ID-SETTINGS-17: the in-force sources — one readable official entry per area, each with its own instructions', () => {
		const sources = fixtureRecord(settingsOf('version_4').sources);
		const entries = fixtureValue3(sources.entries);
		const urls = entries.map((entry) => String(entry.url));
		// jdih.kemnaker.go.id and www.bpjs-kesehatan.go.id (WAF block pages) and oss.go.id (licensing, not HR law) are not
		// sources; regency portals overlapped their governor's decrees. Audited through the agents' own browser on
		// 2026-10-23: JDIH Setneg and peraturan.go.id time out, JDIH BPK is behind a challenge and pajak.go.id's pages crash
		// the engine, so national law and tax have no reachable source yet.
		assert.deepEqual(urls.slice(0, 3), [
			'https://kemnaker.go.id/',
			'https://www.kemenkopmk.go.id/pengumuman',
			'https://www.bpjsketenagakerjaan.go.id/'
		]);
		for (const blocked of [
			'jdih.kemnaker.go.id',
			'oss.go.id',
			'gunungkidulkab',
			'lamongankab',
			'pontianak',
			'setneg',
			'pajak'
		])
			assert.ok(!urls.some((url) => url.includes(blocked)), blocked);
		assert.equal(new Set(urls).size, urls.length);
		const instructions = entries.map((entry) => String(entry.instructions));
		assert.equal(new Set(instructions).size, entries.length);
		// One minimum-wage entry per province with a readable official portal; Kepulauan Riau, Kalimantan Barat,
		// Kalimantan Selatan (Cloudflare challenge), Sulawesi Tenggara and Papua Pegunungan (unreachable), Bali and Banten
		// (JDIH under maintenance), Nusa Tenggara Barat (incomplete TLS chain) and Riau (times out) have none.
		const provinces = instructions
			.filter((text) => text.startsWith('Provinsi '))
			.map((text) => text.slice(0, text.indexOf(':')));
		assert.equal(provinces.length, 29);
		assert.equal(new Set(provinces).size, 29);
		const regions = new Set(
			Object.keys(payrollRules('version_4').minimum_wage.by_region).map((key) => key.split('/')[0])
		);
		for (const province of provinces) assert.ok(regions.has(province), province);
		assert.ok(String(sources.instructions).length > 100);
	});
	it('ID-CONTRIBUTION-4, ID-OBLIGATION-20/28: construction-services JKK, BPJS wage and headcount changes, 10-year tax records', () => {
		for (const version of versions) {
			// PP 44/2015 art.54(1): 1.74% of the monthly wage for a construction-services employer's daily, piece,
			// task and PKWT workers, whatever its risk group; its permanent staff stay on the group rate.
			const jkk = (terms: Row, facts: Row, risk_class = 'II') =>
				fixtureValue0(
					assess(
						scheme(version, 'JKK'),
						{ ordinary: 0 },
						{
							subject: {
								...subject({
									terms: { monthly_wage: 10000000, ...terms },
									company: { risk_class, facts }
								}),
								headcount: 12
							},
							period: version === 'version_1' ? '2025-12' : '2026-03',
							version
						}
					)
				).employer;
			const builder = { construction_services: true };
			const daily = { employment_type: 'DAILY', facts: { daily_wage: 400000 } };
			assert.equal(jkk(daily, builder), 174000, version);
			assert.equal(jkk({ employment_type: 'CONTRACT' }, builder), 174000);
			assert.equal(
				jkk({ employment_type: 'PERMANENT', statutory_work_category: 'TASK_BASIS' }, builder),
				174000
			);
			assert.equal(jkk({ employment_type: 'PERMANENT' }, builder), 54000);
			assert.equal(jkk(daily, {}), 54000);
			const refuse = fixturePresent(
				fixturePresent(fixturePresent(scheme(version, 'JKK').configuration.refuse_when)[0])
			).when;
			const at = (risk_class: string, employment_type: string) =>
				evaluateConfigured(
					fixtureString(refuse),
					fixtureContext({
						employment: { engagement: 'EMPLOYEE' },
						company: { risk_class, facts: builder },
						terms: { employment_type, statutory_work_category: 'NON_MANUAL' }
					})
				);
			assert.equal(at('', 'DAILY'), false);
			assert.equal(at('', 'PERMANENT'), true);
			const settings = settingsOf(version);
			const rows = read(version, 'rule_set');
			const raise = (collection: string, event: string, row: Row, extra: Row = {}) =>
				Object.fromEntries(
					raiseDuties({
						behaviours: settings.behaviours,
						settings_id: settings.id,
						rows,
						collection,
						event,
						row,
						...extra
					}).map((write) => [write.duty_code, write.due_on])
				);
			// PP 44/2015 art.9(3): a new term whose wage (basic plus fixed allowances) differs from the one ending the
			// day before is reported within 7 working days; 1 July 2026 is a Wednesday, so 10 July.
			const term = (from: string, to: string | null, base: number, allowance = 0) => ({
				employment_type: 'PERMANENT',
				effective_range: { from, to },
				base_salary: { value: base, currency: 'IDR' },
				allowances: allowance
					? [{ code: 'HOUSE_ALLOWANCE', amount: { value: allowance, currency: 'IDR' } }]
					: []
			});
			// The write that adds the term raises it, whatever its effective date; once per change.
			const write = (second: Row, day = '2026-06-20', raised: Row[] = []) =>
				raise(
					'employment_contract',
					'updated',
					{
						id: 'k1',
						company_id: 'c1',
						employee_id: 'p1',
						effective_range: { from: '2025-01-01', to: null },
						exit_facts: null,
						facts: {
							contract_terms: [term('2025-01-01', '2026-06-30', 9000000, 500000), second]
						},
						terms_written: [second],
						employee_number: String('p1'),
						contract_number: 1
					},
					{ day, reads: { subject_tasks: raised } }
				).BPJS_KETENAGAKERJAAN_WAGE_CHANGE;
			assert.equal(write(term('2026-07-01', null, 9500000, 500000)), '2026-07-10');
			assert.equal(write(term('2026-07-01', null, 9000000, 1000000)), '2026-07-10');
			assert.equal(write(term('2026-07-01', null, 9000000, 500000)), undefined);
			// Entered in September for July: still raised, due seven working days after the change.
			assert.equal(write(term('2026-07-01', null, 9500000, 500000), '2026-09-15'), '2026-07-10');
			assert.equal(
				write(term('2026-07-01', null, 9500000, 500000), '2026-06-21', [
					{ occurrence_key: 'BPJS_KETENAGAKERJAAN_WAGE_CHANGE:c1:k1:2026-07-01' }
				]),
				undefined
			);
			// UU KUP art.28(11): the January run raises the 10-year retention of the past year's records.
			const run = (period: string) =>
				raise(
					'payroll_run',
					'created',
					{ id: `r-${period}`, period, company_id: 'c1' },
					{
						reads: { company: [{ region: 'Provinsi DKI Jakarta', facts: {} }] },
						headcount: 12
					}
				);
			assert.equal(run('2026-01').TAX_RECORDS_RETENTION, '2026-01-31');
			assert.equal(run('2026-02').TAX_RECORDS_RETENTION, undefined);
		}
	});
	it.effect(
		'ID-TAX-24: a bukan pegawai (PAYEE) is withheld PPh 21 on 50% of each payment and charged no BPJS',
		Effect.fnUntraced(function* () {
			const world = Effect.fnUntraced(function* (facts: Row) {
				const { COMPANY, tables, run, lines } = idWorld();
				fixturePresent(tables.get('employment_profile')).push(
					fixtureRow({
						id: 'x1',
						name: 'Ahli',
						nationality: 'ID',
						marital_status: 'SINGLE',
						facts
					})
				);
				fixturePresent(tables.get('employment_contract')).push(
					fixtureRow({
						id: 'k-x1',
						employee_id: 'x1',
						company_id: COMPANY,
						engagement: 'PAYEE',
						effective_range: { from: '2026-01-01', to: null },
						facts: {
							contract_terms: [
								{
									effective_range: { from: '2026-01-01', to: null },
									residency_status: 'CITIZEN',
									facts: { dependents_count: 0 }
								}
							]
						},
						employee_number: String('x1'),
						contract_number: 1
					})
				);
				const fee = catalog('version_3', 'adhoc_catalog', 'NON_EMPLOYEE_FEE');
				for (const [id, amount] of [
					['f1', 10000000],
					['f2', 200000000]
				] as const)
					fixturePresent(tables.get('adhoc_catalog_entry')).push(
						fixtureRow({
							id,
							catalog_id: fee.id,
							employment_id: 'k-x1',
							company_id: COMPANY,
							payslip_id: null,
							occurred_on: '2026-03-10',
							amount,
							activity: 'AWARD'
						})
					);
				const march = yield* run('2026-03', 'REGULAR');
				return { payee: lines(march, 'x1'), budi: lines(march, 'p1') };
			});
			// PMK 168/2023 art.12(3): each payment on its own — 5% of 5,000,000 = 250,000; 100,000,000 = 3,000,000 at 5%
			// + 40,000,000 at 15% = 9,000,000. No JHT, JP, JKK, JKM, Kesehatan or employee PPh 21.
			const validated = yield* world({});
			assert.deepEqual(validated.payee, { PPH21_BUKAN_PEGAWAI: [9250000, 0] });
			// The employees are priced as before.
			assert.equal(fixturePresent(validated.budi.PPH21)[0], 157260);
			// Without a validated tax number the withholding is 20% higher (UU PPh art.21(5a)).
			assert.deepEqual((yield* world({ tax_id_validated: false })).payee, {
				PPH21_BUKAN_PEGAWAI: [11100000, 0]
			});
		})
	);
	it('work suspensions: each cause pays as UU 13/2003 and PP 36/2021 say; record retention and disposal', () => {
		for (const version of versions) {
			const kinds = new Map(
				LAW_KIT.rows(version, 'suspension_kind').map((row) => [String(row.code), row])
			);
			assert.deepEqual(
				[...kinds.keys()],
				['EMPLOYER_CAUSED', 'FORCE_MAJEURE', 'STRIKE_NORMATIVE', 'STRIKE_OTHER'],
				version
			);
			// 9,300,000 in a 31-day month is 300,000 a day (the unpaid-day value).
			const context = (code: string, day_type = 'WORK') => ({
				terms: { monthly_wage: 9300000 },
				period: { days: 31, month_days: 31 },
				day: { date: '2026-07-01', day_type, worked: false },
				suspension: { kind: code, facts: {} }
			});
			const pay = (code: string, day_type = 'WORK') =>
				Number(
					evaluateConfigured(
						fixtureString(String(fixturePresent(kinds.get(code)).pay)),
						fixtureContext(context(code, day_type))
					)
				);
			const attended = (code: string) =>
				evaluateConfigured(
					fixtureString(String(fixturePresent(kinds.get(code)).counts_as_attended)),
					fixtureContext(context(code))
				);
			assert.equal(pay('EMPLOYER_CAUSED'), 300000); // PP 36/2021 art.40(2)(d)
			assert.equal(attended('EMPLOYER_CAUSED'), true);
			assert.equal(pay('FORCE_MAJEURE'), 0); // UU 13/2003 art.93(1)
			assert.equal(attended('FORCE_MAJEURE'), false);
			assert.equal(pay('STRIKE_NORMATIVE'), 300000); // art.145
			assert.equal(pay('STRIKE_OTHER'), 0);
			assert.equal(pay('EMPLOYER_CAUSED', 'REST'), 0);
			const line = catalog(version, 'work_catalog', 'SUSPENSION_PAY_ADJUSTMENT');
			const slip = {
				terms: { monthly_wage: 9300000 },
				period: { days: 31, month_days: 31 },
				work: {
					days: [
						{ date: '2026-07-01', day_type: 'WORK', suspended: { kind: 'FORCE_MAJEURE', pay: 0 } },
						{
							date: '2026-07-02',
							day_type: 'WORK',
							suspended: { kind: 'EMPLOYER_CAUSED', pay: 300000 }
						},
						{ date: '2026-07-04', day_type: 'REST', suspended: { kind: 'FORCE_MAJEURE', pay: 0 } },
						{ date: '2026-07-06', day_type: 'WORK', suspended: null }
					]
				}
			};
			assert.equal(
				evaluateConfigured(fixtureString(String(line.eligibility)), fixtureContext(slip)),
				true
			);
			// One unpaid working day is deducted; the paid one and the rest day are not.
			assert.equal(
				evaluateConfigured(fixtureString(String(line.rate)), fixtureContext(slip)),
				300000
			);
			// UU KUP art.28(11): 10 years after the exit's tax year; UU 27/2022 art.44(1)(a): destroyed then.
			const retention = fixtureValue0(
				fixturePresent(
					read(version, 'rule_set').find(
						(row) => row.family === 'PAYROLL' && row.code === 'record_retention'
					)
				).rules
			);
			assert.equal(
				evaluateConfigured(
					fixtureString(String(retention.until)),
					fixtureContext({ employment: { exit_date: '2026-06-30' } })
				),
				'2036-12-31'
			);
			const disposal = fixturePresent(
				obligations(version).find((row) => row.code === 'PERSONAL_DATA_DISPOSAL')
			);
			assert.equal(
				evaluateConfigured(
					fixtureString(disposal.rules.due),
					fixtureContext({ exit_on: '2026-06-30' })
				),
				'2036-12-31'
			);
		}
	});
	it.effect(
		'work-day sheet: PP 35/2021 and UU 13/2003 working-time limits warn, a child under 13 refuses the file',
		Effect.fnUntraced(function* () {
			// 5 October 2026: 07:00–19:30 on the 8-hour D shift: 8 normal hours (fine on a five-day week), 4.5 overtime derived.
			const long = yield* rosterImport(
				[{ number: 'E1', profile: { gender: 'MALE', date_of_birth: '1990-01-01' } }],
				[
					{
						row: 2,
						employee_number: 'E1',
						work_date: '2026-10-05',
						shift_code: 'D',
						clock_in: '07:00',
						clock_out: '19:30'
					}
				]
			);
			assert.deepEqual(long.errors, []);
			assert.deepEqual(
				long.warnings.map((finding) => [finding.row, finding.message]),
				[
					[2, 'more than 4 overtime hours on a working day (PP 35/2021 art.26(1)).'],
					// Eight unbroken ordinary hours: no half-hour rest after four hours (UU 13/2003 art.79(2)(a)).
					[
						2,
						'more than 4 hours of continuous work without a break of at least 30 minutes (UU 13/2003 art.79(2)(a); PP 35/2021 art.22).'
					]
				]
			);
			// PP 35/2021 art.26(2): 17.5 working-day hours (3.5 past each 8-hour shift) plus 6 on the rest day is a lawful week;
			// 20 on working days (4 past each shift) is not.
			const sixDays = [
				{
					number: 'E1',
					profile: { gender: 'MALE', date_of_birth: '1990-01-01' },
					terms: { facts: { working_days_per_week: 6 } }
				}
			];
			const weekly = (sheet: SheetRecord[]) =>
				rosterImport(sixDays, sheet).pipe(
					Effect.map((plan) =>
						plan.warnings
							.filter((finding) => finding.message.startsWith('more than 18 overtime hours'))
							.map((finding) => finding.row)
					)
				);
			assert.deepEqual(
				yield* weekly([
					{
						row: 2,
						employee_number: 'E1',
						work_date: '2026-10-05',
						shift_code: 'D',
						clock_in: '08:00',
						clock_out: '19:30'
					},
					{
						row: 3,
						employee_number: 'E1',
						work_date: '2026-10-06',
						shift_code: 'D',
						clock_in: '08:00',
						clock_out: '19:30'
					},
					{
						row: 4,
						employee_number: 'E1',
						work_date: '2026-10-07',
						shift_code: 'D',
						clock_in: '08:00',
						clock_out: '19:30'
					},
					{
						row: 5,
						employee_number: 'E1',
						work_date: '2026-10-08',
						shift_code: 'D',
						clock_in: '08:00',
						clock_out: '19:30'
					},
					{
						row: 6,
						employee_number: 'E1',
						work_date: '2026-10-09',
						shift_code: 'D',
						clock_in: '08:00',
						clock_out: '19:30'
					},
					{
						row: 7,
						employee_number: 'E1',
						work_date: '2026-10-10',
						shift_code: 'R',
						clock_in: '08:00',
						clock_out: '14:00'
					}
				]),
				[]
			);
			assert.deepEqual(
				yield* weekly([
					{
						row: 2,
						employee_number: 'E1',
						work_date: '2026-10-05',
						shift_code: 'D',
						clock_in: '08:00',
						clock_out: '20:00'
					},
					{
						row: 3,
						employee_number: 'E1',
						work_date: '2026-10-06',
						shift_code: 'D',
						clock_in: '08:00',
						clock_out: '20:00'
					},
					{
						row: 4,
						employee_number: 'E1',
						work_date: '2026-10-07',
						shift_code: 'D',
						clock_in: '08:00',
						clock_out: '20:00'
					},
					{
						row: 5,
						employee_number: 'E1',
						work_date: '2026-10-08',
						shift_code: 'D',
						clock_in: '08:00',
						clock_out: '20:00'
					},
					{
						row: 6,
						employee_number: 'E1',
						work_date: '2026-10-09',
						shift_code: 'D',
						clock_in: '08:00',
						clock_out: '20:00'
					},
					{
						row: 7,
						employee_number: 'E1',
						work_date: '2026-10-10',
						shift_code: 'R',
						clock_in: '08:00',
						clock_out: '14:00'
					}
				]),
				[6]
			);
			const child = yield* rosterImport(
				[{ number: 'E2', profile: { gender: 'MALE', date_of_birth: '2015-03-01' } }],
				[
					{
						row: 2,
						employee_number: 'E2',
						work_date: '2026-10-05',
						shift_code: 'D',
						clock_in: '09:00',
						clock_out: '11:00'
					}
				]
			);
			assert.deepEqual(
				child.errors.map((finding) => finding.row),
				[2]
			);
			assert.match(fixturePresent(child.errors[0]).message, /under 13/);
			for (const version of versions) {
				const rule = (code: string) => {
					const rules = fixtureValue0(
						fixturePresent(read(version, 'rule_set').find((item) => item.code === code)).rules
					);
					assert.equal(rules.site, 'roster', code);
					return (context: Row) =>
						evaluateConfigured(
							fixtureString(String(rules.when)),
							fixtureContext({
								terms: { facts: { working_days_per_week: 5 } },
								employee: { gender: 'FEMALE', date_of_birth: '1990-01-01', facts: {} },
								week: { worked_hours: 40, overtime_hours: 0, worked_days: 5 },
								...context,
								day: {
									date: '2026-10-05',
									day_type: 'WORK',
									holiday_kind: '',
									worked: true,
									worked_hours: 8,
									overtime_hours: 0,
									intervals: [],
									...fixtureValue0(context.day ?? {})
								}
							})
						);
				};
				const night = [{ start: '2026-10-05T22:00', end: '2026-10-06T02:00' }];
				assert.equal(rule('ROSTER_NORMAL_HOURS_DAY')({ day: { worked_hours: 9 } }), true);
				assert.equal(rule('ROSTER_NORMAL_HOURS_DAY')({ day: { worked_hours: 8 } }), false);
				assert.equal(
					rule('ROSTER_NORMAL_HOURS_DAY')({
						day: { worked_hours: 8 },
						terms: { facts: { working_days_per_week: 6 } }
					}),
					true
				);
				assert.equal(
					rule('ROSTER_NORMAL_HOURS_WEEK')({
						week: { worked_hours: 42, overtime_hours: 1, worked_days: 5 }
					}),
					true
				);
				assert.equal(
					rule('ROSTER_NORMAL_HOURS_WEEK')({
						week: { worked_hours: 42, overtime_hours: 2, worked_days: 5 }
					}),
					false
				);
				assert.equal(rule('ROSTER_OVERTIME_DAY')({ day: { overtime_hours: 4.5 } }), true);
				assert.equal(
					rule('ROSTER_OVERTIME_DAY')({ day: { overtime_hours: 4.5, day_type: 'REST' } }),
					false
				);
				assert.equal(
					rule('ROSTER_OVERTIME_WEEK')({
						day: { overtime_hours: 2 },
						week: {
							worked_hours: 60,
							overtime_hours: 19,
							worked_days: 5,
							overtime_hours_by_day_type: { WORK: 19, REST: 0, OFF: 0, HOLIDAY: 0 }
						}
					}),
					true
				);
				// art.26(2): rest-day overtime and overtime on a holiday that fell on a working day stay out.
				assert.equal(
					rule('ROSTER_OVERTIME_WEEK')({
						day: { overtime_hours: 2 },
						week: {
							worked_hours: 70,
							overtime_hours: 30,
							worked_days: 6,
							overtime_hours_by_day_type: { WORK: 20, REST: 8, OFF: 0, HOLIDAY: 4 }
						}
					}),
					false
				);
				assert.equal(
					rule('ROSTER_WEEKLY_REST')({
						week: { worked_hours: 48, overtime_hours: 0, worked_days: 6 }
					}),
					true
				);
				assert.equal(
					rule('ROSTER_WEEKLY_REST')({
						week: { worked_hours: 48, overtime_hours: 0, worked_days: 6 },
						terms: { facts: { working_days_per_week: 6 } }
					}),
					false
				);
				const girl = { employee: { gender: 'FEMALE', date_of_birth: '2010-01-01', facts: {} } };
				assert.equal(
					rule('ROSTER_NIGHT_FEMALE_UNDER_18')({ ...girl, day: { intervals: night } }),
					true
				);
				assert.equal(rule('ROSTER_NIGHT_FEMALE_UNDER_18')({ day: { intervals: night } }), false);
				const atRisk = {
					employee: {
						gender: 'FEMALE',
						date_of_birth: '1990-01-01',
						facts: { night_work_pregnancy_risk: true }
					}
				};
				assert.equal(
					rule('ROSTER_NIGHT_PREGNANCY')({ ...atRisk, day: { intervals: night } }),
					true
				);
				assert.equal(rule('ROSTER_NIGHT_PREGNANCY')({ ...atRisk }), false);
				const young = { employee: { gender: 'MALE', date_of_birth: '2012-06-01', facts: {} } };
				assert.equal(rule('ROSTER_CHILD_LIGHT_WORK')({ ...young, day: { worked_hours: 4 } }), true);
				assert.equal(
					rule('ROSTER_CHILD_LIGHT_WORK')({ ...young, day: { worked_hours: 3 } }),
					false
				);
				assert.equal(
					rule('ROSTER_UNDER_13')({
						employee: { gender: 'MALE', date_of_birth: '2014-01-01', facts: {} }
					}),
					true
				);
				assert.equal(rule('ROSTER_UNDER_13')({ ...young }), false);
				assert.deepEqual(
					read(version, 'rule_set')
						.filter((row) => String(row.code).startsWith('ROSTER_'))
						.map((row) => [row.code, fixtureValue0(row.rules).kind]),
					[
						['ROSTER_NORMAL_HOURS_DAY', 'warn'],
						['ROSTER_NORMAL_HOURS_WEEK', 'warn'],
						['ROSTER_OVERTIME_DAY', 'warn'],
						['ROSTER_OVERTIME_WEEK', 'warn'],
						['ROSTER_WEEKLY_REST', 'warn'],
						['ROSTER_NIGHT_FEMALE_UNDER_18', 'warn'],
						['ROSTER_NIGHT_PREGNANCY', 'warn'],
						['ROSTER_CHILD_LIGHT_WORK', 'warn'],
						['ROSTER_UNDER_13', 'refuse'],
						['ROSTER_REST_BREAK', 'warn'],
						['ROSTER_PATTERN_CYCLE', 'refuse']
					]
				);
			}
		})
	);
	it('ID-OBLIGATION-29/48: personal-data cases answer in 3 × 24 hours; family data changes reach BPJS per change', () => {
		for (const version of versions) {
			const settings = settingsOf(version);
			const rows = read(version, 'rule_set');
			const raise = (collection: string, event: string, row: Row, extra: Row = {}) =>
				raiseDuties({
					behaviours: settings.behaviours,
					settings_id: settings.id,
					rows,
					collection,
					event,
					row,
					...extra
				});
			const kinds = fixtureValue6(
				fixturePresent(rows.find((row) => row.family === 'PAYROLL' && row.code === 'case_kinds'))
					.rules
			).kinds.map((kind) => kind.code);
			assert.ok(kinds.includes('PERSONAL_DATA_BREACH') && kinds.length === 6, version);
			// UU 27/2022 art.46(1): written notice within 3 × 24 hours; arts.30, 32, 40, 41: requests likewise.
			const opened = (kind: string) =>
				raise(
					'workplace_case',
					'created',
					{
						id: `case-${kind}`,
						company_id: 'c1',
						kind,
						opened_on: '2026-03-02'
					},
					{ day: '2026-03-02' }
				).map((write) => [write.duty_code, write.due_on]);
			assert.deepEqual(opened('PERSONAL_DATA_BREACH'), [['PDP_BREACH_NOTICE', '2026-03-05']]);
			for (const kind of kinds.filter(
				(code) => code.startsWith('PERSONAL_DATA_') && code !== 'PERSONAL_DATA_BREACH'
			))
				assert.deepEqual(opened(kind), [['PDP_SUBJECT_REQUEST', '2026-03-05']], kind);
			// PP 44/2015 art.9(2): one duty per family state, 7 working days after the update (5 March 2026 → 16 March).
			const profile = (
				marital_status: string,
				children: number,
				before: Row = { marital_status: 'SINGLE' }
			) => ({
				id: 'p1',
				company_id: 'c1',
				employee_id: 'p1',
				nationality: 'ID',
				marital_status,
				children: Array.from({ length: children }, () => ({ child_birthdate: '2026-02-20' })),
				facts: {},
				before
			});
			const updated = (held: Row, raised: Row[] = []) =>
				raise('employment_profile', 'updated', held, {
					day: '2026-03-05',
					reads: { employee: [held], subject_tasks: raised }
				}).filter((write) => write.duty_code === 'BPJS_KETENAGAKERJAAN_FAMILY_DATA_CHANGE');
			const [first] = updated(profile('MARRIED', 1));
			assert.equal(first?.due_on, '2026-03-16');
			assert.equal(
				first?.occurrence_key,
				'BPJS_KETENAGAKERJAAN_FAMILY_DATA_CHANGE:c1:p1:MARRIED:1'
			);
			assert.deepEqual(
				updated(profile('MARRIED', 1), [{ occurrence_key: fixturePresent(first).occurrence_key }]),
				[]
			);
			assert.equal(
				updated(profile('MARRIED', 2), [
					{ occurrence_key: fixturePresent(first).occurrence_key }
				])[0]?.occurrence_key,
				'BPJS_KETENAGAKERJAAN_FAMILY_DATA_CHANGE:c1:p1:MARRIED:2'
			);
			// PP 44/2015 art.9(3): the employer's own name, registration number or province changed.
			const entity = (before: Row, name = 'PT Baru') =>
				raise(
					'entity',
					'updated',
					{
						id: 'c1',
						name,
						registration_number: 'NIB-1',
						region: 'Provinsi DKI Jakarta',
						facts: {},
						before
					},
					{ day: '2026-03-05' }
				).filter((write) => write.duty_code === 'BPJS_KETENAGAKERJAAN_ENTITY_CHANGE');
			assert.equal(entity({ name: 'PT Lama' })[0]?.due_on, '2026-03-16');
			assert.deepEqual(entity({ facts: {} }), []);
			// An update that changed nothing of the family (row.before names other fields) raises nothing.
			assert.deepEqual(updated(profile('MARRIED', 3, { name: 'Old' })), []);
		}
	});
	it('ID-OBLIGATION-6/7/15/16/38–49: the new and corrected duties raise with their due days', () => {
		for (const version of versions) {
			const settings = settingsOf(version);
			const rows = read(version, 'rule_set');
			const raise = (collection: string, event: string, row: Row, extra: Row = {}) =>
				Object.fromEntries(
					raiseDuties({
						behaviours: settings.behaviours,
						settings_id: settings.id,
						rows,
						collection,
						event,
						row,
						...extra
					}).map((write) => [write.duty_code, write.due_on])
				);
			const run = (period: string, headcount = 12, facts: Row = {}) =>
				raise(
					'payroll_run',
					'created',
					{ id: `r-${period}`, period, company_id: 'c1' },
					{ reads: { company: [{ region: 'Provinsi DKI Jakarta', facts }] }, headcount }
				);
			const january = run('2026-01', 120);
			// PMK 168/2023 art.9; PP 36/2021 art.25: the January duties, due on the first of the year.
			assert.equal(january.PTKP_STATUS_ANNUAL, '2026-01-01');
			assert.equal(january.MINIMUM_WAGE_COMPLIANCE, '2026-01-01');
			assert.equal(january.WAGE_STRUCTURE_SCALE, '2026-01-31');
			assert.equal(january.DISABILITY_QUOTA_REVIEW, '2026-01-31');
			assert.equal(january.K3_SMK3_P2K3, '2026-01-31');
			assert.equal(january.LKS_BIPARTIT_FORMATION, '2026-01-31');
			assert.equal(january.PPH21_BUKTI_POTONG, '2026-01-31');
			assert.equal(january.WORKER_HEALTH_EXAMINATION, '2026-01-31');
			assert.equal(run('2026-02').WORKER_HEALTH_EXAMINATION, undefined);
			const march = run('2026-03', 60);
			assert.equal(march.DISABILITY_QUOTA_REVIEW, undefined);
			assert.equal(march.LKS_BIPARTIT_FORMATION, '2026-03-31');
			assert.equal(
				run('2026-03', 60, { lks_bipartit_formed_on: '2025-05-01' }).LKS_BIPARTIT_FORMATION,
				undefined
			);
			assert.equal(run('2026-03', 49).LKS_BIPARTIT_FORMATION, undefined);
			assert.equal(run('2026-01', 20).K3_SMK3_P2K3, undefined);
			assert.equal(run('2026-01', 20, { k3_high_hazard: true }).K3_SMK3_P2K3, '2026-01-31');
			// PP 36/2021 art.61: a slip paid on the 4th day counted from its due day (due + 3) raises the fine duty.
			const paid = (paid_on: string) =>
				raise('payslip', 'updated', {
					id: 's1',
					company_id: 'c1',
					employment_id: 'k1',
					paid_on,
					pay_due_date: '2026-03-25'
				}).LATE_WAGE_FINE;
			assert.equal(paid('2026-03-28'), '2026-03-28');
			assert.equal(paid('2026-03-27'), undefined);
			// PP 36/2021 art.62: a THR entered later than 7 days before its holiday.
			const thrEntry = (occurred_on: string) =>
				raise('adhoc_catalog_entry', 'created', {
					id: 'e1',
					company_id: 'c1',
					employment_id: 'k1',
					occurred_on,
					catalog_code: 'THR_HOLIDAY',
					facts: { holiday_date: '2026-03-21' }
				}).LATE_THR_FINE;
			assert.equal(thrEntry('2026-03-15'), '2026-03-15');
			assert.equal(thrEntry('2026-03-14'), undefined);
			// PP 35/2021 art.15(4): a PKWT period ending while the employment continues.
			const tick = (day: string, exit: string | null) =>
				raise(
					'calendar',
					'daily',
					{
						id: 'k1',
						company_id: 'c1',
						employee_id: 'p1',
						effective_range: { from: '2025-07-01', to: exit },
						facts: {
							contract_terms: [
								{
									employment_type: 'CONTRACT',
									effective_range: { from: '2025-07-01', to: '2026-06-30' }
								},
								{
									employment_type: 'CONTRACT',
									effective_range: { from: '2026-07-01', to: '2027-06-30' }
								}
							]
						},
						employee_number: String('p1'),
						contract_number: 1
					},
					{ day }
				).PKWT_TERM_END_COMPENSATION;
			assert.equal(tick('2026-06-30', '2027-06-30'), '2026-06-30');
			assert.equal(tick('2026-06-29', '2027-06-30'), undefined);
			assert.equal(tick('2027-06-30', '2027-06-30'), undefined); // the exit is settled by PKWT_COMPENSATION
			// PP 35/2021 art.37(3)–(4): notice 14 working days before (7 in probation).
			const exit = (facts: Row, dob = '1990-01-01') =>
				raise(
					'employment_contract',
					'updated',
					{
						id: 'k1',
						company_id: 'c1',
						employee_id: 'p1',
						exit_facts: { termination_cause: 'EFFICIENCY_ACTUAL_LOSS', ...facts },
						effective_range: { from: '2024-01-01', to: '2026-06-30' },
						employee_number: String('p1'),
						contract_number: 1
					},
					{
						reads: {
							employee: [{ nationality: 'ID', gender: 'MALE', date_of_birth: dob, facts: {} }]
						}
					}
				);
			assert.equal(exit({ notice_given_on: '2026-06-10' }).TERMINATION_NOTICE_LATE, undefined); // +14 working days = 30 June
			assert.equal(exit({ notice_given_on: '2026-06-11' }).TERMINATION_NOTICE_LATE, '2026-06-30');
			assert.equal(
				exit({ notice_given_on: '2026-06-19', in_probation: true }).TERMINATION_NOTICE_LATE,
				undefined
			);
			assert.equal(
				exit({ notice_given_on: '2026-06-22', in_probation: true }).TERMINATION_NOTICE_LATE,
				'2026-06-30'
			);
			// PP 37/2021 art.4: no JKP notice for a worker 54 or over when hired.
			assert.equal(exit({}, '1969-12-31').JKP_PHK_NOTIFICATION, undefined);
			assert.equal(exit({}, '1970-01-02').JKP_PHK_NOTIFICATION, '2026-07-09');
			// PP 44/2015 art.43: stage II within 2 × 24 hours of the doctor's certificate.
			const accident = raise('leave_catalog_entry', 'created', {
				id: 'a1',
				company_id: 'c1',
				employment_id: 'k1',
				occurred_on: '2026-03-10',
				from: '2026-03-10',
				catalog_code: 'WORK_ACCIDENT_LEAVE',
				facts: { doctor_certificate_on: '2026-04-02' }
			});
			assert.equal(accident.WORK_ACCIDENT_REPORT_STAGE2, '2026-04-04');
			// PP 36/2021 art.21(2): each new worker told their wage scale.
			assert.equal(
				raise(
					'employment_contract',
					'created',
					{
						id: 'k2',
						company_id: 'c1',
						employee_id: 'p1',
						effective_range: { from: '2026-03-16', to: null },
						employee_number: String('p1'),
						contract_number: 1
					},
					{ reads: { employee: [{ nationality: 'ID', facts: {} }] } }
				).WAGE_SCALE_NOTICE_AT_HIRE,
				'2026-03-16'
			);
			// The DKPTKA deposit is due in advance, on the month's first day; it is priced USD 100 × the recorded rate.
			assert.equal(
				evaluateConfigured(
					fixtureString(
						fixturePresent(obligations(version).find((row) => row.code === 'DKPTKA_PAYMENT')).rules
							.due
					),
					fixtureContext({ period: { from: '2026-03-01', to: '2026-03-31' } })
				),
				'2026-03-01'
			);
			const levy = fixtureValue0(
				assess(
					scheme(version, 'DKPTKA'),
					{},
					{
						subject: subject({
							employee: { nationality: 'JP' },
							company: { facts: { dkptka_usd_idr_rate: 16500 } }
						}),
						version
					}
				)
			);
			assert.equal(levy.employer, 1650000);
			// Once a month: a later slip in the month (an off-cycle run) charges nothing more.
			const again = fixtureValue0(
				assess(
					scheme(version, 'DKPTKA'),
					{},
					{
						subject: subject({
							employee: { nationality: 'JP' },
							company: { facts: { dkptka_usd_idr_rate: 16500 } }
						}),
						version,
						charged: { month: { DKPTKA: { employer: 1650000 } } }
					}
				)
			);
			assert.equal(again.employer, 0);
			assert.equal(assess(scheme(version, 'DKPTKA'), {}, { version }), null);
		}
	});
	it('ID-OBLIGATION-26, ID-LOAN-2/3: deductions name their written basis', () => {
		for (const version of versions) {
			const deduct = (facts: Row) => priceAdhoc(version, 'DEDUCTION', {}, facts, [], 100000);
			assert.equal(deduct({ deduction_kind: 'FINE', basis_reference: 'PP art.12' }), 100000);
			assert.equal(deduct({ deduction_kind: 'FINE' }), null);
			assert.equal(deduct({ deduction_kind: 'OVERPAYMENT' }), 100000);
			assert.equal(deduct({}), null);
			assert.equal(
				priceAdhoc(
					version,
					'COURT_GARNISHMENT',
					{},
					{ court_order_reference: 'PN 1/2026' },
					[],
					100000
				),
				100000
			);
			assert.equal(priceAdhoc(version, 'COURT_GARNISHMENT', {}, {}, [], 100000), null);
			const loan = catalog(version, 'loan_catalog', 'STAFF_LOAN').eligibility;
			assert.equal(
				evaluateConfigured(
					fixtureString(loan),
					fixtureContext(ctxEntry({ written_agreement_reference: 'L-1' }))
				),
				true
			);
			assert.equal(evaluateConfigured(fixtureString(loan), fixtureContext(ctxEntry({}))), false);
		}
	});
});
