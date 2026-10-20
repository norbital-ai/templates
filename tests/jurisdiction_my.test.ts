import canonicalLeave from '../src/data/model/+leave_catalog.model.js';
import { Schema as FixtureSchema } from 'effect';
import { fixtureId, nativeId } from './fixture_values.js';
import { refuse } from '../src/lib/payroll_engine/foundation.js';
import { world, type Tables } from './jurisdiction_kit.js';
import { lineage as jurisdiction } from './jurisdiction_kit.js';
import { readSeedRows } from './seed_values.js';
const LAW_KIT = jurisdiction('MY');
/** MY public lineage: every sealed version's structure, CEL on the engine contexts, obligations and the statutory amounts. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from '@effect/vitest';
import relationships from '../src/data/+relationship.js';
import adhocModel from '../src/data/model/+adhoc_catalog.model.js';
import allowanceModel from '../src/data/model/+allowance_catalog.model.js';
import claimModel from '../src/data/model/+claim_catalog.model.js';
import settingsModel from '../src/data/model/+jurisdiction_settings.model.js';
import leaveModel from '../src/data/model/+leave_catalog.model.js';
import loanModel from '../src/data/model/+loan_catalog.model.js';
import ruleSetModel from '../src/data/model/+rule_set.model.js';
import statutoryModel from '../src/data/model/+statutory_contribution_catalog.model.js';
import workModel from '../src/data/model/+work_catalog.model.js';
import { SUSPENSION_KIND as suspensionModel } from '../src/lib/payroll_engine/suspension_kinds.js';
import {
	behavioursOf,
	effectWrites,
	planBehaviours,
	resolveWhere
} from '../src/lib/payroll_engine/behaviours.js';
// strict: a record expression failing inside `configured_eval`, even where CEL absorbs it, fails the suite
import { evaluateStrict as evaluateConfigured } from '../src/lib/payroll_engine/expressions.js';
import { recordDocuments } from '../src/lib/payroll_engine/export.js';
import { entitlementDays } from '../src/lib/payroll_engine/leave.js';
import { Effect } from 'effect';
import { runEngine } from '../src/lib/payroll_engine/foundation.js';
import { planRosterImport } from '../src/lib/payroll_engine/roster_import.js';
import type { SheetRecord } from '../src/lib/payroll_engine/roster_sheet.js';
import { type PayrollRunKind } from '../src/lib/payroll_engine/payslip/context.js';
import { DUTY_KEYS, dutiesOf, raiseDuties, triggerOf } from './duties.ts';
import {
	leaveBalances,
	movementFromRow,
	serviceMonthsAt
} from '../src/lib/payroll_engine/leave.js';
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
				overtime_consent: FixtureSchema.optionalKey(FixtureSchema.String),
				banked_overtime_hours: FixtureSchema.optionalKey(FixtureSchema.Number),
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
			site: FixtureSchema.mutableKey(FixtureSchema.String),
			kind: FixtureSchema.mutableKey(FixtureSchema.String),
			when: FixtureSchema.mutableKey(FixtureSchema.String)
		}),
		[FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))]
	)
);
const fixtureValue1 = guardFixture(
	FixtureSchema.mutable(
		FixtureSchema.Array(
			FixtureSchema.Literals([
				'jurisdiction_settings',
				'rule_set',
				'statutory_contribution_catalog',
				'leave_catalog',
				'claim_catalog',
				'adhoc_catalog',
				'loan_catalog',
				'allowance_catalog',
				'work_catalog',
				'suspension_kind'
			])
		)
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
const fixtureValue4 = guardFixture(
	FixtureSchema.StructWithRest(
		FixtureSchema.Struct({
			person: FixtureSchema.mutableKey(
				FixtureSchema.optionalKey(
					FixtureSchema.StructWithRest(FixtureSchema.Struct({}), [
						FixtureSchema.Record(
							FixtureSchema.String,
							FixtureSchema.mutableKey(FixtureSchema.String)
						)
					])
				)
			),
			assessable: FixtureSchema.mutableKey(
				FixtureSchema.optionalKey(
					FixtureSchema.StructWithRest(FixtureSchema.Struct({}), [
						FixtureSchema.Record(
							FixtureSchema.String,
							FixtureSchema.mutableKey(FixtureSchema.String)
						)
					])
				)
			),
			rules: FixtureSchema.mutableKey(
				FixtureSchema.mutable(
					FixtureSchema.Array(
						FixtureSchema.StructWithRest(
							FixtureSchema.Struct({
								when: FixtureSchema.mutableKey(FixtureSchema.optionalKey(FixtureSchema.String)),
								employee: FixtureSchema.mutableKey(FixtureSchema.optionalKey(FixtureSchema.String)),
								employer: FixtureSchema.mutableKey(FixtureSchema.optionalKey(FixtureSchema.String))
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
const fixtureValue5 = guardFixture(
	FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))
);
const fixtureValue6 = guardFixture(
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
const fixtureValue7 = guardFixture(
	FixtureSchema.mutable(
		FixtureSchema.Array(
			FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))
		)
	)
);
const fixtureValue8 = guardFixture(
	FixtureSchema.StructWithRest(
		FixtureSchema.Struct({
			trigger: FixtureSchema.mutableKey(FixtureSchema.String),
			applies_when: FixtureSchema.mutableKey(FixtureSchema.optionalKey(FixtureSchema.String)),
			months: FixtureSchema.mutableKey(
				FixtureSchema.optionalKey(FixtureSchema.mutable(FixtureSchema.Array(FixtureSchema.String)))
			),
			due: FixtureSchema.mutableKey(FixtureSchema.String),
			description: FixtureSchema.mutableKey(FixtureSchema.String),
			authority: FixtureSchema.mutableKey(FixtureSchema.String)
		}),
		[FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))]
	)
);
const fixtureValue9 = guardFixture(
	FixtureSchema.StructWithRest(
		FixtureSchema.Struct({ to: FixtureSchema.mutableKey(FixtureSchema.Unknown) }),
		[FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))]
	)
);
const fixtureValue10 = guardFixture(
	FixtureSchema.Union([
		FixtureSchema.StructWithRest(
			FixtureSchema.Struct({
				days: FixtureSchema.mutableKey(FixtureSchema.optionalKey(FixtureSchema.String))
			}),
			[FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))]
		),
		FixtureSchema.Undefined
	])
);
const fixtureValue11 = guardFixture(
	FixtureSchema.mutable(
		FixtureSchema.Array(
			FixtureSchema.StructWithRest(
				FixtureSchema.Struct({
					when: FixtureSchema.mutableKey(FixtureSchema.String),
					amount: FixtureSchema.mutableKey(FixtureSchema.String),
					limit: FixtureSchema.mutableKey(
						FixtureSchema.optionalKey(
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
const fixtureValue12 = guardFixture(
	FixtureSchema.StructWithRest(
		FixtureSchema.Struct({
			properties: FixtureSchema.mutableKey(
				FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))
			)
		}),
		[FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))]
	)
);
const fixtureValue13 = guardFixture(
	FixtureSchema.StructWithRest(
		FixtureSchema.Struct({
			properties: FixtureSchema.mutableKey(
				FixtureSchema.StructWithRest(
					FixtureSchema.Struct({
						status: FixtureSchema.mutableKey(
							FixtureSchema.StructWithRest(
								FixtureSchema.Struct({
									properties: FixtureSchema.mutableKey(
										FixtureSchema.StructWithRest(
											FixtureSchema.Struct({
												kind: FixtureSchema.mutableKey(
													FixtureSchema.Record(
														FixtureSchema.String,
														FixtureSchema.mutableKey(FixtureSchema.Unknown)
													)
												),
												elections: FixtureSchema.mutableKey(
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
								[
									FixtureSchema.Record(
										FixtureSchema.String,
										FixtureSchema.mutableKey(FixtureSchema.Unknown)
									)
								]
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
const fixtureValue14 = guardFixture(
	FixtureSchema.StructWithRest(
		FixtureSchema.Struct({
			currency: FixtureSchema.mutableKey(
				FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))
			)
		}),
		[FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))]
	)
);
const fixtureValue15 = guardFixture(
	FixtureSchema.Union([FixtureSchema.Literal('employee'), FixtureSchema.Literal('company')])
);
const fixtureValue16 = guardFixture(
	FixtureSchema.mutable(FixtureSchema.Array(FixtureSchema.String))
);
const fixtureValue17 = guardFixture(
	FixtureSchema.StructWithRest(
		FixtureSchema.Struct({ from: FixtureSchema.mutableKey(FixtureSchema.String) }),
		[FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))]
	)
);
const fixtureValue18 = guardFixture(
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
const fixtureValue19 = guardFixture(
	FixtureSchema.StructWithRest(
		FixtureSchema.Struct({ days: FixtureSchema.mutableKey(FixtureSchema.Number) }),
		[FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))]
	)
);
const fixtureValue20 = guardFixture(
	FixtureSchema.StructWithRest(
		FixtureSchema.Struct({
			hrd_education_schedule_code: FixtureSchema.mutableKey(
				FixtureSchema.StructWithRest(
					FixtureSchema.Struct({
						enum: FixtureSchema.mutableKey(
							FixtureSchema.mutable(FixtureSchema.Array(FixtureSchema.String))
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
const fixtureValue21 = guardFixture(
	FixtureSchema.StructWithRest(
		FixtureSchema.Struct({
			to: FixtureSchema.mutableKey(FixtureSchema.Union([FixtureSchema.String, FixtureSchema.Null]))
		}),
		[FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))]
	)
);
const fixtureValue22 = guardFixture(
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
const fixtureValue23 = guardFixture(
	FixtureSchema.StructWithRest(
		FixtureSchema.Struct({
			kinds: FixtureSchema.mutableKey(
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
const fixtureValue24 = guardFixture(
	FixtureSchema.StructWithRest(
		FixtureSchema.Struct({
			trigger: FixtureSchema.mutableKey(
				FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))
			),
			when: FixtureSchema.mutableKey(FixtureSchema.String),
			due: FixtureSchema.mutableKey(FixtureSchema.String)
		}),
		[FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))]
	)
);
const fixtureValue25 = guardFixture(
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
const fixtureValue26 = guardFixture(ExportRowsFixture);
const fixtureValue27 = guardFixture(
	FixtureSchema.StructWithRest(
		FixtureSchema.Struct({
			base: FixtureSchema.mutableKey(
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
const fixtureValue28 = guardFixture(
	FixtureSchema.StructWithRest(
		FixtureSchema.Struct({
			base: FixtureSchema.mutableKey(
				FixtureSchema.optionalKey(
					FixtureSchema.mutable(
						FixtureSchema.Array(
							FixtureSchema.Record(
								FixtureSchema.String,
								FixtureSchema.mutableKey(FixtureSchema.Unknown)
							)
						)
					)
				)
			)
		}),
		[FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))]
	)
);
const fixtureValue29 = guardFixture(
	FixtureSchema.StructWithRest(
		FixtureSchema.Struct({
			elections: FixtureSchema.mutableKey(
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
type Row = {
	[field: string]: unknown;
};
it('Act A1586: permitted child work, hazardous training and prohibited employment boundaries', () => {
	for (const version of versions) {
		const check = (code: string, birth: string, facts: Row) => {
			const row = rows(version, 'rule_set').find((row) => row.code === code);
			assert.ok(row, `${version}:${code}`);
			const rule = fixtureValue0(row.rules);
			assert.deepEqual([rule.site, rule.kind], ['contract', 'refuse']);
			return evaluateConfigured(
				fixtureString(rule.when),
				fixtureContext({
					...subject({ employee: { date_of_birth: birth }, terms: { facts } }),
					day: '2026-02-01'
				})
			);
		};
		assert.equal(check('CHILD_WORK_KIND', '2012-02-01', { minor_employment_kind: 'OTHER' }), true);
		assert.equal(
			check('CHILD_WORK_KIND', '2012-02-01', { minor_employment_kind: 'SCHOOL_APPROVED' }),
			false
		);
		assert.equal(check('CHILD_WORK_KIND', '2011-02-01', { minor_employment_kind: 'OTHER' }), false);
		assert.equal(
			check('CHILD_LIGHT_WORK_AGE', '2013-02-02', { minor_employment_kind: 'LIGHT_FAMILY' }),
			true
		);
		assert.equal(
			check('CHILD_LIGHT_WORK_AGE', '2013-02-01', { minor_employment_kind: 'LIGHT_FAMILY' }),
			false
		);
		assert.equal(
			check('CHILD_LIGHT_WORK_AGE', '2013-02-02', {
				minor_employment_kind: 'LICENSED_ENTERTAINMENT'
			}),
			false
		);
		const trained = {
			hazardous_work: true,
			hazardous_work_personal_supervision: true,
			hazardous_work_training: true
		};
		assert.equal(check('MINOR_HAZARDOUS_WORK', '2011-02-02', trained), true);
		assert.equal(check('MINOR_HAZARDOUS_WORK', '2011-02-01', trained), false);
		assert.equal(
			check('MINOR_HAZARDOUS_WORK', '2010-02-01', {
				...trained,
				hazardous_work_personal_supervision: false
			}),
			true
		);
		assert.equal(
			check('MINOR_HAZARDOUS_WORK', '2010-02-01', { ...trained, hazardous_work_training: false }),
			true
		);
		assert.equal(check('MINOR_HAZARDOUS_WORK', '2008-02-01', { hazardous_work: true }), false);
		assert.equal(
			check('MINOR_PROHIBITED_EMPLOYMENT', '2008-02-02', { prohibited_minor_employment: true }),
			true
		);
		assert.equal(
			check('MINOR_PROHIBITED_EMPLOYMENT', '2008-02-01', { prohibited_minor_employment: true }),
			false
		);
		assert.equal(
			check('MINOR_PROHIBITED_EMPLOYMENT', '', { prohibited_minor_employment: true }),
			false
		);
	}
});
const MODELS = {
	jurisdiction_settings: settingsModel,
	rule_set: ruleSetModel,
	statutory_contribution_catalog: statutoryModel,
	leave_catalog: leaveModel,
	claim_catalog: claimModel,
	adhoc_catalog: adhocModel,
	loan_catalog: loanModel,
	allowance_catalog: allowanceModel,
	work_catalog: workModel,
	suspension_kind: suspensionModel
} as const;
type Table = keyof typeof MODELS;
const TABLES = fixtureValue1(Object.keys(MODELS)).filter((table) => table !== 'suspension_kind');
const CATALOGS = TABLES.filter(
	(table) => table !== 'jurisdiction_settings' && table !== 'rule_set'
);
const lineages = resolve(process.cwd(), 'seed/jurisdiction');
const root = resolve(lineages, 'MY');
const versionsOf = (directory: string) =>
	readdirSync(directory)
		.filter((entry) => entry.startsWith('version_'))
		.toSorted((left, right) => Number(left.slice(8)) - Number(right.slice(8)));
const versions = LAW_KIT.versions;
const rows = LAW_KIT.rows;
const settingsOf = LAW_KIT.settingsOf;
const at = (day: string): string => {
	const version = versions.find((name) => {
		const range = fixtureValue2(settingsOf(name).effective_range);
		return range.from <= day && (range.to == null || day <= range.to);
	});
	assert.ok(version, `a MY version governs ${day}`);
	return version;
};
/** A work-day sheet import planned against the MY versions: the `roster` validations as HR would see them. */
const rosterImport = (sheet: SheetRecord[]) => {
	const law = (file: Table) => versions.flatMap((version) => rows(version, file));
	const tables = fixtureTables([
		[
			'entity',
			[
				{
					id: 'c1',
					name: 'Nihon',
					settings_code: 'MY',
					time_zone: 'Asia/Kuala_Lumpur',
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
			[
				{
					id: 'k1',
					company_id: 'c1',
					employee_id: 'p1',
					employee_number: 'E1',
					effective_range: { from: '2026-01-01', to: null },
					facts: {
						contract_terms: [
							{
								effective_range: { from: '2026-01-01', to: null },
								base_salary: { value: 3000, currency: 'MYR' },
								allowances: [],
								employment_type: 'PERMANENT',
								residency_status: 'CITIZEN',
								work_classification: 'EA_COVERED',
								facts: {}
							}
						]
					},
					contract_number: 1
				}
			]
		],
		[
			'employment_profile',
			[{ id: 'p1', name: 'Aminah', date_of_birth: '1990-01-01', children: [], facts: {} }]
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
		].map((name) => fixtureValue3([name, []]))
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
				(message) => refuse(message)
			);
		})
	);
};
const byCode = (version: string, table: Table, code: string): Row => {
	const row = rows(version, table).find((item) => item.code === code);
	assert.ok(row, `${version} ${table} ${code}`);
	return row;
};
const nextDay = (day: string): string => {
	const date = new Date(`${day}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() + 1);
	return date.toISOString().slice(0, 10);
};
const round2 = (value: number): number => Math.round(value * 100) / 100;
const monthEnd = (day: string): string =>
	String(evaluateConfigured(fixtureString(`month_end("${day}")`), fixtureContext({})));
/** The subject `subjectContext` builds: `employee`, `company`, `terms`, `employment` and `person`. */
type Subject = {
	age?: number | null;
	residency_status?: string;
	employee?: Row;
	facts?: Row;
	company?: Row;
	terms?: Row;
	service_months?: number;
	start_date?: string;
	day?: string;
	/** This scheme's declared standing (`scheme.standing` / `scheme.elections`). */
	standing?: string;
	elections?: Row;
	/** Earlier months of the year: the scheme's wage parts (`year`) and every scheme's charges (`charged.year`). */
	year?: {
		[part: string]: number;
	};
	charged?: {
		[code: string]: {
			employee: number;
			employer: number;
		};
	};
	/** Other schemes' standing elections (`elections.<CODE>`). */
	all_elections?: Row;
	/** What the employment earned before this slip (`earned`) and this slip's lines (`lines[]`). */
	earned?: Row;
	lines?: {
		code: string;
		amount: number;
	}[];
	exit_date?: string;
	exit_ground?: string;
	exit_facts?: Row;
};
const subject = (input: Subject = {}) => {
	const day = input.day ?? '2026-02-15';
	const before = String(
		evaluateConfigured(fixtureString(`add_days(month_start("${day}"), -1)`), fixtureContext({}))
	);
	const age = input.age === undefined ? 40 : input.age;
	const employment = {
		classification: 'EA_COVERED',
		service_months: input.service_months ?? 30,
		start_date: input.start_date ?? '2023-08-01',
		exit_date: input.exit_date ?? '',
		exit_ground: input.exit_ground ?? '',
		exit_facts: { ...input.exit_facts }
	};
	const residency_status = input.residency_status ?? 'CITIZEN';
	return {
		employee: {
			gender: '',
			marital_status: 'SINGLE',
			spouse_status: 'NONE',
			solo_parent: false,
			disabled: false,
			receiving_pension: false,
			nationality: '',
			// Born on the day before the month starts, so `age_on(dob, period.from - 1)` is exactly `age`.
			date_of_birth: age == null ? '' : `${Number(before.slice(0, 4)) - age}${before.slice(4)}`,
			age,
			children: [],
			dependents_count: 0,
			...input.employee,
			facts: { ...input.facts }
		},
		company: { region: '', risk_class: '', pay_frequency: 'MONTHLY', facts: { ...input.company } },
		terms: {
			work_classification: 'EA_COVERED',
			statutory_work_category: 'MANUAL_LABOUR',
			employment_type: 'PERMANENT',
			residency_status,
			residency_since: '',
			base_salary: 3000,
			monthly_wage: 3000,
			allowances: [],
			facts: {},
			...input.terms
		},
		employment,
		person: {
			employment,
			race: null,
			religion: null,
			nationality: null,
			residency_status,
			residency_since: null
		}
	};
};
/** One month's charge the way `assessStatutory` makes it for a single slip: person facts, assessable parts, rules. */
const statutory = (
	version: string,
	code: string,
	wage:
		| number
		| {
				[part: string]: number;
		  },
	input: Subject = {}
): {
	employee: number;
	employer: number;
} | null => {
	const configuration = fixtureValue4(
		byCode(version, 'statutory_contribution_catalog', code).configuration
	);
	const parts = typeof wage === 'number' ? { ordinary: wage } : wage;
	const key = (input.day ?? '2026-02-15').slice(0, 7);
	const from = `${key}-01`;
	const to = monthEnd(from);
	const held = subject(input);
	let context: Row = {
		...held,
		wage: parts,
		month: parts,
		year: input.year ?? {},
		rules: {},
		earned: { month: {}, year: {}, previous_month: {}, months: [], ...input.earned },
		lines: input.lines ?? [],
		charged: { year: input.charged ?? {}, month: {} },
		elections: { [code]: input.elections ?? {}, ...input.all_elections },
		scheme: { code, standing: input.standing ?? '', elections: input.elections ?? {} },
		period: {
			key,
			from,
			to,
			days: Number(to.slice(8)),
			month: Number(key.slice(5)),
			salary_paid: false
		}
	};
	const person: Row = { ...held.person };
	for (const [fact, expression] of Object.entries(configuration.person ?? {}))
		person[fact] = evaluateConfigured(fixtureString(expression), fixtureContext(context));
	context = { ...context, person };
	const assessed: {
		[part: string]: number;
	} = {};
	for (const [part, amount] of Object.entries(parts)) {
		const expression = configuration.assessable?.[part];
		assessed[part] = round2(
			Math.max(
				0,
				expression == null
					? amount
					: Number(evaluateConfigured(fixtureString(expression), fixtureContext(context)))
			)
		);
	}
	const total = round2(Object.values(assessed).reduce((sum, value) => sum + value, 0));
	context = { ...context, base: { ...assessed, assessed: total, amount: total } };
	for (const rule of configuration.rules) {
		if (
			rule.when != null &&
			evaluateConfigured(fixtureString(rule.when), fixtureContext(context)) !== true
		)
			continue;
		const amount = (expression?: string) =>
			expression == null
				? 0
				: round2(Number(evaluateConfigured(fixtureString(expression), fixtureContext(context))));
		return { employee: amount(rule.employee), employer: amount(rule.employer) };
	}
	return null;
};
/** Every PCB part a catalogue row can count toward, so `base.<part>` exists as the engine builds it. */
const pcb = (parts: { [part: string]: number }) => ({
	ordinary: 0,
	additional: 0,
	non_epf: 0,
	additional_non_epf: 0,
	...parts
});
/** The context `admitEntry` builds for one entry. */
const admitContext = (facts: Row = {}, input: Subject = {}, columns: Row = {}) => ({
	...subject(input),
	rules: {},
	entry: {
		days: 1,
		...columns,
		...facts,
		amount: 100,
		quantity: 1,
		occurred_on: '2026-02-10',
		due_on: '2026-02-10',
		incurred_on: '2026-02-10',
		facts
	}
});
/** One `work.days[]` entry as `buildPayslip` projects it. */
const workDay = (date: string, fields: Row = {}) => ({
	date,
	day_type: 'WORK',
	shift_code: 'AM0830',
	holiday_kind: '',
	holiday_name: '',
	scheduled_hours: 8,
	worked_hours: 8,
	worked: true,
	overtime_hours: 0,
	banked_hours: 0,
	incentive_hours: 0,
	payable_incentive_hours: 0,
	worksite: '',
	facts: {},
	intervals: [],
	overtime_intervals: [],
	...fields
});
/** One `leave.rows[]` entry as `buildPayslip` projects it. */
const leaveRow = (fields: Row) => ({
	activity: 'TIME_OFF',
	from: '2026-02-05',
	to: '2026-02-05',
	is_npl: false,
	can_encash: false,
	event_id: '',
	month_index: 1,
	facts: {},
	pay_fraction: 1,
	...fields
});
/** The context `buildPayslip` builds for a salary run. */
const payslipContext = (input: Subject = {}, overrides: Row = {}) => ({
	...subject(input),
	rules: {},
	period: {
		key: '2026-02',
		from: '2026-02-01',
		to: '2026-02-28',
		days: 28,
		paid_days: 28,
		covered_days: 28,
		working_days: 20,
		part: 1,
		parts: 1,
		month_key: '2026-02',
		month_from: '2026-02-01',
		month_to: '2026-02-28',
		month_days: 28
	},
	work: {
		overtime_hours: 10,
		incentive_hours: 0,
		payable_incentive_hours: 0,
		dates: ['2026-02-03', '2026-02-10'],
		holidays: [
			{
				date: '2026-02-10',
				name: '',
				kind: 'PUBLIC_HOLIDAY',
				given_to: 'EVERYONE',
				replaces: '',
				day_type: 'WORK',
				worked: true,
				worked_hours: 8
			}
		],
		holiday_dates: ['2026-02-10'],
		days: [workDay('2026-02-03', { overtime_hours: 10, worked_hours: 18 })]
	},
	hours: {
		month: {
			worked_hours: 18,
			overtime_hours: 10,
			incentive_hours: 0,
			day_type: {},
			holiday_kind: {},
			day_type_holiday_kind: {}
		},
		previous_month: { worked_hours: 0, overtime_hours: 0, incentive_hours: 0 },
		year: { worked_hours: 18, overtime_hours: 10, incentive_hours: 0 },
		rolling: { worked_hours: 18, overtime_hours: 10, incentive_hours: 0 }
	},
	earned: { month: {}, year: {}, previous_month: {}, months: [] },
	leave: {
		rows: [
			leaveRow({ code: 'UNPAID_LEAVE', days: 2, is_npl: true }),
			leaveRow({ code: 'ANNUAL_LEAVE', activity: 'ENCASHMENT', days: 1, can_encash: true })
		]
	},
	...overrides
});
/** `event.leave_balances` as `leaveState` builds it on a contract event: the balances on the exit day, on the subject. */
const withBalances = <
	C extends {
		event: Row;
		catalogues?: unknown;
		movements?: unknown;
	}
>(
	context: C
): C => {
	const row = fixtureValue5(context.event.row);
	const range = fixtureValue6(row.effective_range ?? {});
	const asOf = range.to ?? range.from ?? '2026-01-01';
	return {
		...context,
		event: {
			...context.event,
			leave_balances: leaveBalances({
				classes: fixtureValue7(context.catalogues ?? []).map((held) => seedClass(held)),
				movements: fixtureValue7(context.movements ?? []).map((held) => seedMovement(held)),
				serviceMonths: serviceMonthsAt(range.from ?? null, asOf, row.prior_service_months),
				asOf,
				employmentStart: range.from ?? null,
				context: fixtureContext(
					subject({
						day: asOf,
						...(range.from == null ? {} : { start_date: range.from }),
						...(range.to == null ? {} : { exit_date: range.to })
					})
				)
			})
		}
	};
};
/** A class's entitlement as `leaveState` reads it: the subject roots plus the days `taken` in each window. */
const entitled = (
	row: Row,
	service_months: number,
	taken: Row = {},
	input: Subject = {},
	taken_by_class: Row = {}
) =>
	entitlementDays(
		fixtureEntitlement(row.entitlement),
		service_months,
		fixtureContext({
			...subject(input),
			as_of: input.day ?? '2026-02-15',
			taken: { calendar_year: 0, service_year: 0, lifetime: 0, event: 0, rolling: 0, ...taken },
			taken_by_class
		})
	);
const evaluates = (
	expression: unknown,
	context: object,
	where: string,
	kind: 'boolean' | 'number'
) => {
	if (expression == null || String(expression).trim() === '') return;
	const value = evaluateConfigured(fixtureString(String(expression)), fixtureContext(context));
	assert.equal(typeof value, kind, `${where}: ${String(expression).slice(0, 80)}`);
};
const line = (version: string, code: string, context: object): number => {
	const row = byCode(version, 'work_catalog', code);
	if (
		evaluateConfigured(
			fixtureString(String(row.eligibility ?? 'true')),
			fixtureContext(context)
		) !== true
	)
		return 0;
	return round2(
		Number(evaluateConfigured(fixtureString(String(row.quantity)), fixtureContext(context))) *
			Number(evaluateConfigured(fixtureString(String(row.rate)), fixtureContext(context)))
	);
};
type Duty = {
	trigger: string;
	applies_when?: string;
	months?: string[];
	due: string;
	description: string;
	authority: string;
};
const duties = (version: string) =>
	new Map(
		dutiesOf(rows(version, 'rule_set')).map((row) => [
			String(row.code),
			fixtureValue8({ ...fixtureRecord(row.rules), trigger: triggerOf(row) })
		])
	);
describe('MY jurisdiction seed', () => {
	it('every version holds its settings, rule set and every catalogue file', () => {
		assert.ok(versions.length >= 1);
		for (const version of versions)
			for (const table of TABLES)
				assert.ok(existsSync(resolve(root, version, `${table}.json`)), `${version}/${table}.json`);
	});
	it('ids are unique across every lineage and every child names its own version', () => {
		const seen = new Map<string, string>();
		for (const lineage of readdirSync(lineages))
			for (const version of versionsOf(resolve(lineages, lineage)))
				for (const table of TABLES) {
					const path = resolve(lineages, lineage, version, `${table}.json`);
					if (!existsSync(path)) continue;
					for (const row of fixtureValue7(JSON.parse(readFileSync(path, 'utf8')))) {
						const where = `${lineage}/${version}/${table}`;
						assert.ok(
							!seen.has(String(row.id)),
							`${where} reuses ${String(row.id)} of ${seen.get(String(row.id))}`
						);
						seen.set(String(row.id), where);
					}
				}
		for (const version of versions) {
			const settings = settingsOf(version);
			for (const table of TABLES)
				for (const row of rows(version, table)) {
					assert.equal(typeof row.id, 'string');
					if (table !== 'jurisdiction_settings')
						assert.equal(row.settings_id, settings.id, `${version} ${table} ${String(row.code)}`);
				}
		}
	});
	it('versions chain by cloned_from_id and their date ranges are contiguous and inclusive', () => {
		let previous: Row | undefined;
		for (const version of versions) {
			const row = settingsOf(version);
			const range = fixtureValue2(row.effective_range);
			assert.match(range.from, /^\d{4}-\d{2}-\d{2}$/);
			assert.equal(row.code, 'MY');
			assert.equal(typeof row.sealed_at, 'string');
			if (previous === undefined) assert.equal(row.cloned_from_id, undefined);
			else {
				const before = fixtureValue2(previous.effective_range);
				assert.equal(row.cloned_from_id, previous.id, version);
				assert.ok(
					before.to != null && before.to >= before.from,
					`${version} predecessor is closed`
				);
				assert.equal(
					range.from,
					nextDay(before.to),
					`${version} starts the day after its predecessor ends`
				);
			}
			previous = row;
		}
		assert.equal(fixtureValue9(previous?.effective_range).to, null, 'the last version is open');
	});
	it('every row carries only keys its model declares', () => {
		const owned = new Set(Object.keys(relationships).map((key) => key.split('.').join(':')));
		for (const version of versions)
			for (const table of TABLES) {
				const allowed = new Set([
					'id',
					...Object.keys(MODELS[table].fields),
					...[...owned].filter((key) => key.startsWith(`${table}:`)).map((key) => key.split(':')[1])
				]);
				for (const row of rows(version, table))
					for (const key of Object.keys(row))
						assert.ok(
							allowed.has(key),
							`${version} ${table} ${String(row.code)}: stale key ${key}`
						);
			}
	});
	it('a work stoppage by the employer keeps the wage; records kept seven years, then disposed of', () => {
		for (const version of versions) {
			const [kind, ...others] = rows(version, 'suspension_kind');
			assert.equal(others.length, 0, version);
			assert.equal(fixturePresent(kind).code, 'EMPLOYER_SHUTDOWN');
			const context = (day_type: string) => ({
				terms: { base_salary: 2600 },
				day: { date: '2026-10-05', day_type, worked: false },
				suspension: { kind: 'EMPLOYER_SHUTDOWN', facts: {} }
			});
			// EA s.24(1): the day's wage stands (monthly ÷ 26); EA s.60E(1): not an absence without permission.
			assert.equal(
				evaluateConfigured(
					fixtureString(String(fixturePresent(kind).pay)),
					fixtureContext(context('WORK'))
				),
				100
			);
			assert.equal(
				evaluateConfigured(
					fixtureString(String(fixturePresent(kind).pay)),
					fixtureContext(context('REST'))
				),
				0
			);
			assert.equal(
				evaluateConfigured(
					fixtureString(String(fixturePresent(kind).counts_as_attended)),
					fixtureContext(context('WORK'))
				),
				true
			);
			// ITA s.82(1)(a): seven years from the end of the exit year; PDPA s.10(2): destroyed then.
			const ruleSet = rows(version, 'rule_set');
			const retention = fixtureValue5(
				fixturePresent(
					ruleSet.find((row) => row.family === 'PAYROLL' && row.code === 'record_retention')
				).rules
			);
			assert.equal(
				evaluateConfigured(
					fixtureString(String(retention.until)),
					fixtureContext({ employment: { exit_date: '2026-10-31' } })
				),
				'2033-12-31'
			);
			const disposal = fixtureValue5(
				fixturePresent(ruleSet.find((row) => row.code === 'PERSONAL_DATA_DISPOSAL')).rules
			);
			assert.equal(
				evaluateConfigured(
					fixtureString(String(disposal.due)),
					fixtureContext({ exit_on: '2026-10-31' })
				),
				'2033-12-31'
			);
		}
	});
	it.effect(
		'work-day sheet: the EA s.59 and s.60A limits warn; no limit refuses the file',
		Effect.fnUntraced(function* () {
			// 5 October 2026: 07:00–20:00 in one block is 13 hours: over five hours unbroken, a ten-hour spread-over and
			// the twelve-hour day. Overtime is derived past the planned 9-hour shift (4 hours), so the normal hours are
			// the shift's nine — not more than nine (s.60A(1)(b)); a longer planned shift is what warns.
			const long = yield* rosterImport([
				{
					row: 2,
					employee_number: 'E1',
					work_date: '2026-10-05',
					shift_code: 'D',
					clock_in: '07:00',
					clock_out: '20:00'
				}
			]);
			assert.deepEqual(long.errors, []);
			assert.deepEqual(long.warnings.map((finding) => finding.message).toSorted(), [
				'more than five consecutive hours without a 30-minute break (EA s.60A(1)(a)).',
				'more than twelve hours worked in the day, overtime included (EA ss.60A(7), 60C(2)).',
				'the working day spreads over more than ten hours (EA s.60A(1)(c)).'
			]);
			const fine = yield* rosterImport([
				{
					row: 2,
					employee_number: 'E1',
					work_date: '2026-10-05',
					shift_code: 'D',
					clock_in: '08:00',
					clock_out: '12:00'
				}
			]);
			assert.deepEqual([fine.errors, fine.warnings], [[], []]);
			for (const version of versions) {
				const roster = rows(version, 'rule_set').filter((row) =>
					String(row.code).startsWith('ROSTER_')
				);
				assert.deepEqual(
					roster.map((row) => [
						row.code,
						fixtureValue5(row.rules).site,
						fixtureValue5(row.rules).kind
					]),
					[
						'ROSTER_CONTINUOUS_HOURS',
						'ROSTER_NORMAL_HOURS_DAY',
						'ROSTER_SPREAD_OVER',
						'ROSTER_NORMAL_HOURS_WEEK',
						'ROSTER_DAILY_TOTAL',
						'ROSTER_WEEKLY_REST'
					].map((code) => [code, 'roster', 'warn']),
					version
				);
				const rule = (code: string) => (context: Row) =>
					evaluateConfigured(
						fixtureString(
							String(
								fixtureValue5(fixturePresent(roster.find((row) => row.code === code)).rules).when
							)
						),
						fixtureContext({
							terms: { facts: {} },
							week: { worked_hours: 40, overtime_hours: 0, worked_days: 5 },
							...context,
							day: {
								date: '2026-10-05',
								worked: true,
								worked_hours: 8,
								overtime_hours: 0,
								intervals: [],
								...(context.day === undefined ? {} : fixtureValue5(context.day))
							}
						})
					);
				assert.equal(rule('ROSTER_NORMAL_HOURS_DAY')({ day: { worked_hours: 10 } }), true);
				assert.equal(
					rule('ROSTER_NORMAL_HOURS_DAY')({
						day: { worked_hours: 10 },
						terms: { facts: { shift_work: true } }
					}),
					false
				);
				assert.equal(
					rule('ROSTER_NORMAL_HOURS_WEEK')({
						week: { worked_hours: 47, overtime_hours: 1, worked_days: 6 }
					}),
					true
				);
				assert.equal(
					rule('ROSTER_NORMAL_HOURS_WEEK')({
						week: { worked_hours: 47, overtime_hours: 2, worked_days: 6 }
					}),
					false
				);
				assert.equal(
					rule('ROSTER_WEEKLY_REST')({
						week: { worked_hours: 56, overtime_hours: 0, worked_days: 7 }
					}),
					true
				);
				assert.equal(
					rule('ROSTER_WEEKLY_REST')({
						week: { worked_hours: 48, overtime_hours: 0, worked_days: 6 }
					}),
					false
				);
			}
		}),
		15_000
	);
	it('CP58: the January tick raises the yearly statement for an agent, dealer or distributor payee', () => {
		for (const version of versions) {
			const settings = settingsOf(version);
			const payee = (engagement: string, role: string) => ({
				id: 'k-x1',
				company_id: 'c1',
				employee_id: 'x1',
				engagement,
				effective_range: { from: '2026-01-01', to: null },
				facts: {
					contract_terms: [
						{ effective_range: { from: '2026-01-01', to: null }, facts: { payee_role: role } }
					]
				},
				employee_number: String('x1'),
				contract_number: 1
			});
			const tick = (row: Row, day: string) =>
				raiseDuties({
					behaviours: fixturePresent(behavioursOf(settings.behaviours)),
					settings_id: settings.id,
					rows: rows(version, 'rule_set'),
					collection: 'calendar',
					event: 'daily',
					row,
					day
				}).filter((write) => write.duty_code === 'CP58_AGENT_STATEMENT');
			const [raised] = tick(payee('PAYEE', 'AGENT'), '2027-01-04');
			// ITA s.83A(2): by 31 March of the next year, one per year.
			assert.equal(raised?.due_on, '2027-03-31', version);
			assert.equal(raised?.occurrence_key, 'CP58_AGENT_STATEMENT:c1:k-x1:2026');
			assert.deepEqual(tick(payee('PAYEE', 'AGENT'), '2027-02-04'), []);
			assert.deepEqual(tick(payee('PAYEE', 'OTHER'), '2027-01-04'), []);
			assert.deepEqual(tick(payee('EMPLOYEE', 'AGENT'), '2027-01-04'), []);
		}
	});
	it('a class or duty code never disappears from a later version', () => {
		for (const [index, version] of versions.entries()) {
			if (index === 0) continue;
			for (const table of [...CATALOGS, 'rule_set'] as const) {
				const now = new Set(rows(version, table).map((row) => row.code));
				for (const row of rows(fixturePresent(versions[index - 1]), table))
					assert.ok(now.has(row.code), `${version} ${table} drops ${String(row.code)}`);
			}
		}
	});
	it('every catalogue CEL evaluates on the context the engine builds', () => {
		const people: Subject[] = [
			{},
			{ age: 65, residency_status: 'PERMANENT_RESIDENT', employee: { gender: 'FEMALE' } },
			{
				age: null,
				residency_status: 'FOREIGNER',
				employee: { gender: 'MALE', marital_status: 'MARRIED' }
			}
		];
		for (const version of versions) {
			for (const input of people) {
				for (const row of rows(version, 'work_catalog')) {
					const where = `${version} work ${String(row.code)}`;
					evaluates(row.eligibility, payslipContext(input), where, 'boolean');
					evaluates(row.quantity, payslipContext(input), where, 'number');
					evaluates(row.rate, payslipContext(input), where, 'number');
				}
				for (const row of rows(version, 'allowance_catalog')) {
					const context = { ...payslipContext(input), allowance: { code: row.code, amount: 200 } };
					evaluates(
						row.eligibility,
						context,
						`${version} allowance ${String(row.code)}`,
						'boolean'
					);
					evaluates(row.amount, context, `${version} allowance ${String(row.code)}`, 'number');
				}
				for (const row of rows(version, 'leave_catalog')) {
					const where = `${version} leave ${String(row.code)}`;
					evaluates(row.eligibility, admitContext({}, input), where, 'boolean');
					evaluates(
						row.eligibility,
						admitContext({ event_kind: 'BIRTH' }, input),
						where,
						'boolean'
					);
					evaluates(row.pay_fraction, admitContext({}, input), where, 'number');
					const days = fixtureValue10(row.entitlement)?.days;
					if (days != null) assert.equal(typeof entitled(row, 30, {}, input), 'number');
				}
				const admit = admitContext({}, input);
				for (const table of ['adhoc_catalog', 'claim_catalog', 'loan_catalog'] as const)
					for (const row of rows(version, table))
						for (const context of [
							admit,
							{
								...payslipContext(input),
								entry: admitContext().entry,
								earlier: { rows: [], calendar_year: 0, lifetime: 0 }
							}
						]) {
							const where = `${version} ${table} ${String(row.code)}`;
							evaluates(row.eligibility, context, where, 'boolean');
							evaluates(row.qualifies_when, context, where, 'boolean');
							// Bands price on the payslip only (`buildPayslip`); admission reads eligibility and qualifies_when.
							if (context === admit) continue;
							for (const band of fixtureValue11(row.bands ?? [])) {
								evaluates(band.when, context, where, 'boolean');
								evaluates(band.amount, context, where, 'number');
								evaluates(band.limit?.amount, context, where, 'number');
							}
						}
				for (const row of rows(version, 'statutory_contribution_catalog'))
					for (const wage of [1500, 4999.99, 5000.01, 25000])
						assert.doesNotThrow(
							() =>
								statutory(
									version,
									String(row.code),
									pcb({ ordinary: wage, additional: 1000, non_epf: 300 }),
									input
								),
							`${version} ${String(row.code)}`
						);
			}
		}
	});
	it('both input schemas are JSON Schema 2020-12 and declare every fact the CEL reads', () => {
		const TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);
		const valid = (node: unknown, where: string): void => {
			assert.ok(node != null && typeof node === 'object' && !Array.isArray(node), where);
			const schema = fixtureValue5(node);
			for (const type of [schema.type ?? []].flat())
				assert.ok(TYPES.has(String(type)), `${where}.type`);
			if (schema.enum !== undefined)
				assert.ok(Array.isArray(schema.enum) && schema.enum.length > 0, `${where}.enum`);
			if (schema.items !== undefined) valid(schema.items, `${where}.items`);
			if (schema.properties !== undefined)
				for (const [key, child] of Object.entries(fixtureValue5(schema.properties)))
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
			'due',
			'applies_when',
			'days',
			'pay_fraction'
		]);
		for (const version of versions) {
			const settings = settingsOf(version);
			const employee = fixtureValue12(settings.employee_input_schema);
			const entity = fixtureValue12(settings.entity_input_schema);
			for (const [name, schema] of [
				['employee', employee],
				['entity', entity]
			] as const) {
				assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema', name);
				valid(schema, `${version} ${name}`);
			}
			const props = (schema: unknown) =>
				new Set(Object.keys(fixtureValue5(fixtureRecord(schema ?? {}).properties ?? {})));
			// The one layout the engine reads: contract terms, exit facts, statutory standings and person facts.
			assert.deepEqual(Object.keys(employee.properties).toSorted(), [
				'contract_terms',
				'employment_statutory_facts',
				'exit_facts',
				'facts'
			]);
			const standing = fixtureValue13(
				fixtureRecord(employee.properties.employment_statutory_facts).items
			);
			for (const column of [
				'gender',
				'marital_status',
				'spouse_status',
				'children',
				'nationality',
				'date_of_birth',
				'dependents_count'
			])
				assert.equal(
					props(employee.properties.facts).has(column),
					false,
					`${version} ${column} is a profile column`
				);
			for (const column of ['region', 'risk_class']) assert.equal(props(entity).has(column), false);
			const terms = fixtureValue12(fixtureRecord(employee.properties.contract_terms).items);
			assert.equal(
				fixtureValue14(fixtureRecord(terms.properties.base_salary).properties).currency.const,
				'MYR'
			);
			assert.deepEqual(fixtureValue5(terms.properties.residency_status).enum, [
				'CITIZEN',
				'PERMANENT_RESIDENT',
				'FOREIGNER'
			]);
			const declared = {
				employee: props(employee.properties.facts),
				company: props(entity),
				terms: props(terms),
				elections: props(standing.properties.status.properties.elections),
				exit: props(employee.properties.exit_facts)
			};
			for (const key of [
				'epf_employer_number',
				'socso_employer_code',
				'lhdn_employer_number',
				'hrd_employer_code'
			])
				assert.ok(declared.company.has(key), `${version} entity ${key}`);
			const expressions: string[] = [];
			const walk = (value: unknown, key = ''): void => {
				if (typeof value === 'string') {
					if (CEL.has(key)) expressions.push(value);
				} else if (Array.isArray(value)) value.forEach((item) => walk(item, key));
				else if (value != null && typeof value === 'object')
					for (const [child, item] of Object.entries(value))
						walk(item, key === 'assessable' || key === 'person' ? 'when' : child);
			};
			for (const table of TABLES.filter((table) => table !== 'jurisdiction_settings'))
				walk(rows(version, table));
			assert.ok(
				expressions.some((expression) => expression.includes('company.facts.')),
				version
			);
			assert.ok(
				expressions.some((expression) => expression.includes('scheme.elections.')),
				version
			);
			for (const expression of expressions) {
				for (const [, root, fact] of expression.matchAll(/\b(employee|company)\.facts\.([a-z_]+)/g))
					assert.ok(
						declared[fixtureValue15(root)].has(String(fact)),
						`${version} ${root}.facts.${fact}`
					);
				for (const [, fact] of expression.matchAll(/\bscheme\.elections\.([a-z_0-9]+)/g))
					assert.ok(declared.elections.has(String(fact)), `${version} scheme.elections.${fact}`);
				for (const [, fact] of expression.matchAll(/\bexit_facts\.([a-z_]+)/g))
					assert.ok(declared.exit.has(String(fact)), `${version} exit_facts.${fact}`);
				for (const [, fact] of expression.matchAll(/\bterms\.([a-z_]+)/g))
					assert.ok(
						declared.terms.has(String(fact)) || fact === 'monthly_wage',
						`${version} terms.${fact}`
					);
			}
			// SKBBK became voluntary for citizens and permanent residents on 8 July 2026: a RELEASED standing from then.
			assert.equal(
				fixtureValue16(standing.properties.status.properties.kind.enum).includes('RELEASED'),
				fixtureValue17(settings.effective_range).from >= '2026-07-08',
				version
			);
		}
	});
	it('obligations are rule_set rows whose due date and condition evaluate for their trigger', () => {
		const company = { region: '', risk_class: '', facts: {} };
		const employee = { nationality: 'MAL', gender: 'MALE', date_of_birth: '1990-01-01', facts: {} };
		const contract = (exit_ground: string, exit_facts: Row = {}) => ({
			id: 'c1',
			employee_id: 'p1',
			company_id: 'co1',
			effective_range: { from: '2020-01-01', to: '2026-10-31' },
			exit_ground,
			exit_facts,
			employee_number: String('p1'),
			contract_number: 1
		});
		const contexts: {
			[trigger: string]: Row;
		} = {
			PAYROLL_RUN: {
				period: { key: '2026-12', from: '2026-12-01', to: '2026-12-31' },
				company,
				holidays_named: []
			},
			HIRE: {
				hired_on: '2026-10-15',
				contract: { ...contract(''), facts: { contract_terms: [] } },
				employee,
				company,
				headcount: 1
			},
			EXIT: {
				exit_on: '2026-10-31',
				contract: contract('RESIGNATION'),
				employee,
				company,
				today: '2026-10-31'
			},
			'entity.created': {
				row: { id: 'co1', effective_range: { from: '2026-10-15', to: null }, facts: {} },
				period: { key: '2026-10', from: '2026-10-01', to: '2026-10-31' },
				company: { ...company, facts: { hrd_registration_class: 'COMPULSORY' } },
				today: '2026-10-15',
				headcount: 0
			},
			'entity.updated': {
				row: { id: 'co1', effective_range: { from: '2009-12-01', to: '2026-10-31' }, facts: {} },
				period: { key: '2026-10', from: '2026-10-01', to: '2026-10-31' },
				company: { ...company, facts: { hrd_registration_class: 'COMPULSORY' } },
				today: '2026-10-31',
				headcount: 0
			},
			'leave_catalog_entry.created': {
				row: {
					id: 'l1',
					catalog_code: 'MEDICAL_LEAVE',
					occurred_on: '2026-10-20',
					facts: { work_injury: true }
				},
				period: { key: '2026-10', from: '2026-10-01', to: '2026-10-31' },
				company,
				today: '2026-10-20'
			},
			'workplace_case.created': {
				row: {
					id: 'w1',
					kind: 'PERSONAL_DATA_BREACH',
					opened_on: '2026-10-20',
					closed_on: null,
					facts: {}
				},
				period: { key: '2026-10', from: '2026-10-01', to: '2026-10-31' },
				company,
				today: '2026-10-20'
			},
			'workplace_case.updated': {
				row: {
					id: 'w1',
					kind: 'SEXUAL_HARASSMENT_COMPLAINT',
					opened_on: '2026-10-20',
					closed_on: null,
					facts: {
						significant_harm: true,
						commissioner_notified_on: '2026-10-22',
						dg_directed_on: '2026-11-02',
						inquiry_outcome: 'PROVEN'
					},
					before: { facts: {} }
				},
				period: { key: '2026-11', from: '2026-11-01', to: '2026-11-30' },
				company,
				today: '2026-11-05'
			},
			'calendar.daily': {
				row: { id: 'c1' },
				contract: {
					...contract(''),
					facts: { contract_terms: [{ facts: { work_pass_valid_until: '2027-01-18' } }] }
				},
				period: { key: '2026-10', from: '2026-10-01', to: '2026-10-31' },
				company,
				today: '2026-10-20'
			}
		};
		for (const version of versions) {
			const all = duties(version);
			assert.equal(all.size, 54, version);
			for (const [code, rules] of all) {
				const where = `${version} ${code}`;
				for (const key of Object.keys(rules)) assert.ok(DUTY_KEYS.includes(key), `${where}.${key}`);
				assert.ok(rules.description.length > 0 && rules.authority.length > 0, where);
				const context = contexts[rules.trigger];
				assert.ok(context, `${where} trigger ${rules.trigger}`);
				for (const month of rules.months ?? []) assert.match(month, /^(0[1-9]|1[0-2])$/, where);
				assert.match(
					String(evaluateConfigured(fixtureString(rules.due), fixtureContext(context))),
					/^\d{4}-\d{2}-\d{2}$/,
					where
				);
				if (fixtureValue5(rules).when != null)
					assert.equal(
						typeof evaluateConfigured(
							fixtureString(String(fixtureValue5(rules).when)),
							fixtureContext(context)
						),
						'boolean',
						where
					);
				if (rules.applies_when != null)
					assert.equal(
						typeof evaluateConfigured(fixtureString(rules.applies_when), fixtureContext(context)),
						'boolean',
						where
					);
			}
			// Every rate table is a rule-set row, not a reference table.
			assert.equal(settingsOf(version).reference_tables, undefined, `${version} reference_tables`);
		}
		const rulesOf = (version: string, code: string) => {
			const rules = duties(version).get(code);
			assert.ok(rules, code);
			return rules;
		};
		const due = (version: string, code: string, context: Row) =>
			evaluateConfigured(fixtureString(rulesOf(version, code).due), fixtureContext(context));
		const applies = (version: string, code: string, context: Row) =>
			evaluateConfigured(
				fixtureString(rulesOf(version, code).applies_when ?? 'true'),
				fixtureContext(context)
			);
		const period = (key: string) => ({
			period: { key, from: `${key}-01`, to: monthEnd(`${key}-01`) },
			company
		});
		for (const code of [
			'EPF_MONTHLY_CONTRIBUTION',
			'SOCSO_EIS_MONTHLY_CONTRIBUTION',
			'PCB_REMITTANCE',
			'HRD_LEVY_MONTHLY'
		]) {
			assert.equal(due(at('2026-01-15'), code, period('2026-01')), '2026-02-15', code);
			assert.equal(due(at('2026-12-15'), code, period('2026-12')), '2027-01-15', code);
		}
		assert.equal(due(at('2026-02-15'), 'WAGE_PAYMENT_DEADLINE', period('2026-02')), '2026-03-07');
		assert.deepEqual(duties(at('2027-01-15')).get('EA_FORM')?.months, ['01']);
		assert.equal(due(at('2027-01-15'), 'EA_FORM', period('2027-01')), '2027-02-28');
		assert.equal(due(at('2028-01-15'), 'EA_FORM', period('2028-01')), '2028-02-29');
		assert.equal(due(at('2027-01-15'), 'FORM_E_CP8D', period('2027-01')), '2027-03-31');
		assert.equal(due(at('2026-12-15'), 'PUBLIC_HOLIDAY_NOTICE', period('2026-12')), '2026-12-31');
		// The HRD levy is a duty of a COMPULSORY or OPTIONAL registrant (unrecorded is compulsory), never out of scope.
		const v = at('2026-10-15');
		const levy = (facts: Row | null) =>
			applies(v, 'HRD_LEVY_MONTHLY', { ...period('2026-10'), company: { ...company, facts } });
		assert.equal(levy({}), true);
		assert.equal(levy(null), true);
		assert.equal(levy({ hrd_registration_class: 'OPTIONAL' }), true);
		assert.equal(levy({ hrd_registration_class: 'NOT_REGISTERED' }), false);
		assert.equal(levy({ hrd_scope: 'OUT_OF_SCOPE', hrd_registration_class: 'COMPULSORY' }), false);
		const hired = fixturePresent(contexts.HIRE);
		assert.equal(due(v, 'CP22_NEW_EMPLOYEE', hired), '2026-11-14');
		assert.equal(due(v, 'SOCSO_EIS_EMPLOYEE_REGISTRATION', hired), '2026-11-14');
		assert.equal(due(v, 'EPF_EMPLOYEE_REGISTRATION', hired), '2026-11-15');
		assert.equal(due(v, 'FOREIGN_EMPLOYEE_PARTICULARS', hired), '2026-10-29');
		// Foreign-employee duties follow the contract terms' residency (a permanent resident is not foreign, EA s.60O).
		const withResidency = (residency_status: string) => ({
			...hired,
			contract: { ...contract(''), facts: { contract_terms: [{ residency_status }] } }
		});
		for (const residency of ['CITIZEN', 'PERMANENT_RESIDENT'])
			for (const code of ['FOREIGN_EMPLOYEE_PARTICULARS', 'FOREIGN_WORKER_LEVY'])
				assert.equal(applies(v, code, withResidency(residency)), false, `${code} ${residency}`);
		for (const code of ['FOREIGN_EMPLOYEE_PARTICULARS', 'FOREIGN_WORKER_LEVY'])
			assert.equal(applies(v, code, withResidency('FOREIGNER')), true, code);
		assert.equal(due(v, 'FOREIGN_WORKER_LEVY', withResidency('FOREIGNER')), '2026-10-15');
		const exit = (
			exit_ground: string,
			exit_facts: Row = {},
			residency_status = 'CITIZEN',
			term: Row = {}
		) => ({
			exit_on: '2026-10-31',
			contract: {
				...contract(exit_ground, exit_facts),
				facts: {
					contract_terms: [
						{
							effective_range: { from: '2020-01-01', to: null },
							base_salary: { value: 3000, currency: 'MYR' },
							allowances: [],
							residency_status,
							...term
						}
					]
				}
			},
			employee,
			company
		});
		assert.equal(due(v, 'CP22A_CESSATION_AND_WITHHOLDING', exit('RETIREMENT')), '2026-10-01');
		assert.equal(due(v, 'CP21_LEAVING_MALAYSIA', exit('RESIGNATION')), '2026-10-01');
		assert.equal(due(v, 'TERMINATION_BENEFIT_PAYMENT', exit('RETRENCHMENT')), '2026-11-07');
		assert.equal(due(v, 'TERMINATION_BENEFITS_FINAL_WAGES', exit('RESIGNATION')), '2026-10-31');
		// EA s.21(2): an employee who left without notice is paid by the third day after.
		assert.equal(
			due(
				v,
				'TERMINATION_BENEFITS_FINAL_WAGES',
				exit('RESIGNATION', { terminated_without_notice: true })
			),
			'2026-11-03'
		);
		const raised = (context: Row) =>
			[...duties(v)]
				.filter(
					([, rules]) =>
						rules.trigger === 'EXIT' &&
						evaluateConfigured(
							fixtureString(String(fixtureValue5(rules).when ?? 'true')),
							fixtureContext(context)
						) === true &&
						evaluateConfigured(
							fixtureString(rules.applies_when ?? 'true'),
							fixtureContext(context)
						) === true
				)
				.map(([code]) => code)
				.toSorted();
		const always = ['PERSONAL_DATA_DISPOSAL', 'TERMINATION_BENEFITS_FINAL_WAGES'];
		assert.deepEqual(raised(exit('RESIGNATION')), always);
		// Act 753 s.4: born 1990, retired at 36 — the minimum retirement age review is raised.
		assert.deepEqual(
			raised(exit('RETIREMENT')),
			['CP22A_CESSATION_AND_WITHHOLDING', 'RETIREMENT_AGE_REVIEW', ...always].toSorted()
		);
		assert.deepEqual(
			raised(exit('RESIGNATION', { leaving_malaysia: true }, 'FOREIGNER')),
			[
				'CP21_LEAVING_MALAYSIA',
				'CP22A_CESSATION_AND_WITHHOLDING',
				'FOREIGN_EMPLOYEE_TERMINATION_NOTICE',
				...always
			].toSorted()
		);
		// EA s.60N: a citizen retrenched raises the foreign-employees-first review; a foreigner does not.
		assert.deepEqual(
			raised(exit('RETRENCHMENT')),
			[
				'RETRENCHMENT_FOREIGN_FIRST',
				'RETRENCHMENT_NOTIFICATION',
				'TERMINATION_BENEFIT_PAYMENT',
				...always
			].toSorted()
		);
		assert.ok(
			!raised(exit('RETRENCHMENT', {}, 'FOREIGNER')).includes('RETRENCHMENT_FOREIGN_FIRST')
		);
		// Termination benefits: none for a misconduct dismissal or under twelve months' service.
		assert.deepEqual(
			raised(exit('DISMISSAL')),
			['TERMINATION_BENEFIT_PAYMENT', ...always].toSorted()
		);
		assert.deepEqual(raised(exit('DISMISSAL', { misconduct_dismissal: true })), always);
		// First Schedule para 1A: the Regulations bind wages of RM4,000 a month or less, or a manual category.
		const paid = (term: Row) =>
			raised(exit('RETRENCHMENT', {}, 'CITIZEN', term)).includes('TERMINATION_BENEFIT_PAYMENT');
		assert.equal(paid({ base_salary: { value: 3800, currency: 'MYR' } }), true);
		assert.equal(
			paid({
				base_salary: { value: 3800, currency: 'MYR' },
				allowances: [{ code: 'FIXED', amount: { value: 300, currency: 'MYR' } }]
			}),
			false
		);
		assert.equal(
			paid({
				base_salary: { value: 6000, currency: 'MYR' },
				statutory_work_category: 'MANUAL_LABOUR'
			}),
			true
		);
		assert.equal(
			paid({
				base_salary: { value: 6000, currency: 'MYR' },
				facts: { overtime_by_contract: true }
			}),
			true
		);
		assert.equal(paid({ employment_type: 'DOMESTIC' }), false);
		// A resignation under s.13(2) / s.14(3) is inside reg.4; a plain resignation is not.
		assert.ok(
			raised(exit('RESIGNATION', { notice_exception: 'OTHER_PARTY_WILFUL_BREACH' })).includes(
				'TERMINATION_BENEFIT_PAYMENT'
			)
		);
		assert.ok(
			raised(exit('RESIGNATION', { notice_exception: 'IMMEDIATE_DANGER' })).includes(
				'TERMINATION_BENEFIT_PAYMENT'
			)
		);
		// EA s.57B: a foreign domestic employee's termination is notified within thirty days.
		const domestic = exit('RESIGNATION', {}, 'FOREIGNER', { employment_type: 'DOMESTIC' });
		assert.ok(raised(domestic).includes('FOREIGN_DOMESTIC_TERMINATION_NOTICE'));
		assert.equal(due(v, 'FOREIGN_DOMESTIC_TERMINATION_NOTICE', domestic), '2026-11-30');
		assert.ok(
			!raised(exit('RESIGNATION', {}, 'FOREIGNER')).includes('FOREIGN_DOMESTIC_TERMINATION_NOTICE')
		);
		const short = {
			...exit('RETRENCHMENT'),
			contract: {
				...exit('RETRENCHMENT').contract,
				effective_range: { from: '2026-01-01', to: '2026-10-31' }
			}
		};
		assert.deepEqual(
			raised(short),
			['RETRENCHMENT_FOREIGN_FIRST', 'RETRENCHMENT_NOTIFICATION', ...always].toSorted()
		);
		// SKBBK is remitted with SOCSO from 1 June 2026.
		assert.doesNotMatch(
			fixturePresent(duties(at('2026-05-15')).get('SOCSO_EIS_MONTHLY_CONTRIBUTION')).description,
			/SKBBK/
		);
		assert.match(
			fixturePresent(duties(at('2026-06-15')).get('SOCSO_EIS_MONTHLY_CONTRIBUTION')).description,
			/SKBBK/
		);
	});
	it('round-5 tasks: employer registrations, rest-day roster, s.19(2) wages, accident report', () => {
		const rulesOf = (version: string, code: string) => {
			const row = rows(version, 'rule_set').find((item) => item.code === code);
			assert.ok(row, `${version} ${code}`);
			return fixtureValue5(row.rules);
		};
		const entity = (from: string, facts: Row = {}) => ({
			row: { id: 'co1', effective_range: { from, to: null }, facts },
			period: { key: from.slice(0, 7), from: `${from.slice(0, 7)}-01`, to: monthEnd(from) },
			company: { region: '', risk_class: '', facts },
			today: from,
			headcount: 0
		});
		for (const version of versions) {
			const due = (code: string, context: Row) =>
				evaluateConfigured(
					fixtureString(String(rulesOf(version, code).due)),
					fixtureContext(context)
				);
			const applies = (code: string, context: Row) =>
				evaluateConfigured(
					fixtureString(String(rulesOf(version, code).applies_when ?? 'true')),
					fixtureContext(context)
				);
			const when = (code: string, context: Row) =>
				evaluateConfigured(
					fixtureString(String(rulesOf(version, code).when ?? 'true')),
					fixtureContext(context)
				);
			// EPF Act s.41(1): before the end of the first week of the first wage month.
			assert.equal(due('EPF_EMPLOYER_REGISTRATION', entity('2026-10-03')), '2026-10-07');
			assert.equal(due('EPF_EMPLOYER_REGISTRATION', entity('2026-10-15')), '2026-11-07');
			assert.deepEqual(fixtureValue5(rulesOf(version, 'EPF_EMPLOYER_REGISTRATION').trigger), {
				collection: 'entity',
				event: 'created'
			});
			// HRD: thirty days after becoming liable, for a COMPULSORY registrant only.
			assert.equal(
				due(
					'HRD_EMPLOYER_REGISTRATION',
					entity('2026-10-15', { hrd_registration_class: 'COMPULSORY' })
				),
				'2026-11-14'
			);
			assert.equal(
				applies(
					'HRD_EMPLOYER_REGISTRATION',
					entity('2026-10-15', { hrd_registration_class: 'COMPULSORY' })
				),
				true
			);
			assert.equal(
				applies(
					'HRD_EMPLOYER_REGISTRATION',
					entity('2026-10-15', { hrd_registration_class: 'OPTIONAL' })
				),
				false
			);
			// PERKESO: within 30 days of the first employee (headcount 1); PERKESO and HRD cessation within 30 days.
			const hire = (headcount: number) => ({
				hired_on: '2026-10-15',
				headcount,
				row: {},
				company: { facts: {} }
			});
			assert.equal(applies('SOCSO_EIS_EMPLOYER_REGISTRATION', hire(1)), true);
			assert.equal(applies('SOCSO_EIS_EMPLOYER_REGISTRATION', hire(12)), false);
			assert.equal(due('SOCSO_EIS_EMPLOYER_REGISTRATION', hire(1)), '2026-11-14');
			const closed = (facts: Row) => ({
				...entity('2009-12-01', facts),
				row: { id: 'co1', effective_range: { from: '2009-12-01', to: '2026-10-31' }, facts }
			});
			assert.equal(when('PERKESO_CESSATION_NOTICE', closed({})), true);
			assert.equal(when('PERKESO_CESSATION_NOTICE', entity('2009-12-01')), false);
			assert.equal(due('PERKESO_CESSATION_NOTICE', closed({})), '2026-11-30');
			assert.equal(
				applies('HRD_CESSATION_NOTICE', closed({ hrd_registration_class: 'COMPULSORY' })),
				true
			);
			assert.equal(
				applies('HRD_CESSATION_NOTICE', closed({ hrd_registration_class: 'NOT_REGISTERED' })),
				false
			);
			// EA s.59(2) before the next month; s.19(2) by the last day of the next wage period.
			const run = {
				period: { key: '2026-10', from: '2026-10-01', to: '2026-10-31' },
				row: { period: '2026-10' }
			};
			assert.equal(due('REST_DAY_ROSTER', run), '2026-10-31');
			assert.equal(due('OVERTIME_REST_HOLIDAY_WAGES_DEADLINE', run), '2026-11-30');
			// The 48-hour accident report, keyed by the sick / hospitalisation class and the work_injury fact.
			const leave = (catalog_code: string, facts: Row) => ({
				row: { id: 'l1', catalog_code, occurred_on: '2026-10-20', facts }
			});
			assert.equal(
				when('SOCSO_ACCIDENT_REPORT', leave('HOSPITALIZATION_LEAVE', { work_injury: true })),
				true
			);
			assert.equal(when('SOCSO_ACCIDENT_REPORT', leave('MEDICAL_LEAVE', {})), false);
			// Act 4 s.24 / reg.12: any employment injury — work, commuting or occupational disease — whatever the class.
			assert.equal(
				when('SOCSO_ACCIDENT_REPORT', leave('UNPAID_LEAVE', { work_injury: true })),
				true
			);
			assert.equal(
				due('SOCSO_ACCIDENT_REPORT', leave('MEDICAL_LEAVE', { work_injury: true })),
				'2026-10-22'
			);
		}
	});
	it('validations: the RM1,700 minimum wage on contract terms, the s.24(8) deduction ceiling, the 104-hour limit', () => {
		for (const version of versions) {
			const set = rows(version, 'rule_set');
			const minimum = fixtureValue5(
				fixturePresent(set.find((row) => row.code === 'minimum_wage')).rules
			);
			assert.equal(minimum.monthly, 1700);
			assert.equal(minimum.hourly, 8.72);
			const check = (code: string) => {
				const row = set.find((item) => item.code === code);
				assert.ok(row && row.family === 'VALIDATIONS', `${version} ${code}`);
				return fixtureValue18(row.rules);
			};
			const contract = (term: Row) => ({
				...subject({ terms: term }),
				rules: { minimum_wage: minimum },
				term: { ...subject({ terms: term }).terms }
			});
			const monthly = check('MINIMUM_WAGE_MONTHLY');
			assert.deepEqual([monthly.site, monthly.kind], ['contract', 'refuse']);
			assert.equal(
				evaluateConfigured(
					fixtureString(monthly.when),
					fixtureContext(contract({ base_salary: 1699.99 }))
				),
				true
			);
			assert.equal(
				evaluateConfigured(
					fixtureString(monthly.when),
					fixtureContext(contract({ base_salary: 1700 }))
				),
				false
			);
			assert.equal(
				evaluateConfigured(
					fixtureString(monthly.when),
					fixtureContext(contract({ base_salary: 0 }))
				),
				false
			);
			assert.equal(
				evaluateConfigured(
					fixtureString(monthly.when),
					fixtureContext(contract({ base_salary: 900, employment_type: 'DOMESTIC' }))
				),
				false
			);
			const territory = check('LABOUR_ORDINANCE_TERRITORY');
			assert.equal(
				evaluateConfigured(
					fixtureString(territory.when),
					fixtureContext(contract({ facts: { worksite_state: 'SABAH' } }))
				),
				true
			);
			assert.equal(
				evaluateConfigured(
					fixtureString(territory.when),
					fixtureContext(contract({ facts: { worksite_state: 'JOHOR' } }))
				),
				false
			);
			assert.equal(
				evaluateConfigured(fixtureString(territory.when), fixtureContext(contract({}))),
				false
			);
			const hourly = check('MINIMUM_WAGE_HOURLY_PART_TIME');
			const part = (base_salary: number, hours: number) =>
				contract({
					base_salary,
					employment_type: 'PART_TIME',
					facts: { contract_hours_per_week: hours }
				});
			// RM8.72 × 52 × 20 ÷ 12 = RM755.73 a month for twenty hours a week.
			assert.equal(
				evaluateConfigured(fixtureString(hourly.when), fixtureContext(part(755, 20))),
				true
			);
			assert.equal(
				evaluateConfigured(fixtureString(hourly.when), fixtureContext(part(756, 20))),
				false
			);
			const ceiling = check('DEDUCTION_CEILING');
			assert.deepEqual([ceiling.site, ceiling.kind], ['payslip', 'hold']);
			const slip = (total_deductions: number, lines: Row = {}, exit_date = '') => ({
				...payslipContext(),
				employment: { ...subject().employment, exit_date },
				payslip: { gross: 3000, net: 3000 - total_deductions, total_deductions, lines }
			});
			assert.equal(
				evaluateConfigured(fixtureString(ceiling.when), fixtureContext(slip(1500))),
				false
			);
			assert.equal(
				evaluateConfigured(fixtureString(ceiling.when), fixtureContext(slip(1500.01))),
				true
			);
			// s.24(9)(b): on the final payment only the amounts due to the employer leave the ceiling.
			assert.equal(
				evaluateConfigured(
					fixtureString(ceiling.when),
					fixtureContext(slip(1800, {}, '2026-02-20'))
				),
				true
			);
			assert.equal(
				evaluateConfigured(
					fixtureString(ceiling.when),
					fixtureContext(slip(1800, { LOAN_RECOVERY_FESTIVE_ADVANCE: -600 }, '2026-02-20'))
				),
				false
			);
			assert.equal(
				evaluateConfigured(
					fixtureString(ceiling.when),
					fixtureContext(slip(1800, { LOAN_RECOVERY_FESTIVE_ADVANCE: -600 }))
				),
				true
			);
			assert.equal(
				evaluateConfigured(
					fixtureString(ceiling.when),
					fixtureContext(slip(2000, { APPROVED_HOUSING_LOAN: -1200 }))
				),
				false
			);
			assert.equal(
				evaluateConfigured(
					fixtureString(ceiling.when),
					fixtureContext(slip(2000, { NOTICE_INDEMNITY: -600 }))
				),
				false
			);
			const overtime = check('OVERTIME_LIMIT');
			assert.equal(
				evaluateConfigured(fixtureString(overtime.when), fixtureContext(payslipContext())),
				false
			);
			assert.equal(
				evaluateConfigured(
					fixtureString(overtime.when),
					fixtureContext(
						// Approved overtime already includes its derived overflow; classification is not added again.
						payslipContext(
							{},
							{
								hours: {
									...payslipContext().hours,
									month: {
										...payslipContext().hours.month,
										worked_hours: 0,
										overtime_hours: 105,
										incentive_hours: 5
									}
								}
							}
						)
					)
				),
				true
			);
			assert.equal(
				evaluateConfigured(
					fixtureString(overtime.when),
					fixtureContext(
						payslipContext(
							{},
							{
								hours: {
									...payslipContext().hours,
									month: {
										...payslipContext().hours.month,
										worked_hours: 0,
										overtime_hours: 104,
										incentive_hours: 5
									}
								}
							}
						)
					)
				),
				false
			);
		}
	});
	it('the canonical duty behaviours raise each applicable duty once', () => {
		for (const version of versions) {
			const row = settingsOf(version);
			const behaviours = behavioursOf(row.behaviours);
			assert.ok(behaviours, version);
			const ruleRows = rows(version, 'rule_set');
			const all = dutiesOf(ruleRows).map((item) => ({
				code: item.code,
				family: item.family,
				rules: fixtureValue5({ ...fixtureRecord(item.rules), trigger: triggerOf(item) })
			}));
			const of = (trigger: string) => all.filter((duty) => duty.rules.trigger === trigger);
			const company = [{ region: '', risk_class: '', facts: {} }];
			const local = [
				{ nationality: 'MAL', gender: 'FEMALE', date_of_birth: '1990-01-01', facts: {} }
			];
			const contract = (data: Row) => ({
				id: 'c1',
				company_id: 'co1',
				employee_id: 'p1',
				exit_ground: '',
				...data
			});
			const raise = (collection: string, event: string, data: Row, reads: Row) =>
				raiseDuties({
					behaviours,
					settings_id: row.id,
					rows: ruleRows,
					collection,
					event,
					row: contract(data),
					reads
				});
			const run = (period: string, raised: Row[] = []) =>
				raise('payroll_run', 'created', { period }, { raised, company });
			const monthly = of('PAYROLL_RUN').filter((duty) => duty.rules.months == null);
			const january = run('2027-01');
			assert.equal(
				january.length,
				monthly.length + 3,
				`${version} January adds EA, Form E and the s.82 records`
			);
			assert.equal(run('2026-10').length, monthly.length);
			// December: the s.60D(1A) notice, and the compulsory-holidays check while none is published.
			assert.equal(run('2026-12').length, monthly.length + 2);
			// An employer outside the HRD Act is not raised the levy.
			const outside = raise(
				'payroll_run',
				'created',
				{ period: '2026-10' },
				{
					raised: [],
					company: [{ region: '', risk_class: '', facts: { hrd_scope: 'OUT_OF_SCOPE' } }]
				}
			);
			assert.equal(outside.length, monthly.length - 1);
			for (const data of january) assert.match(String(data.due_on), /^\d{4}-\d{2}-\d{2}$/);
			const epf = january.find((data) => data.duty_code === 'EPF_MONTHLY_CONTRIBUTION');
			assert.equal(epf?.due_on, '2027-02-15');
			assert.equal(
				run('2027-01', [{ duty_code: 'EPF_MONTHLY_CONTRIBUTION' }]).length,
				january.length - 1
			);
			const range = { from: '2026-10-15', to: '2026-12-31' };
			const hire = (employee: Row[]) =>
				raise(
					'employment_contract',
					'created',
					{ effective_range: range, exit_facts: null },
					{ raised: [], company, employee }
				);
			assert.equal(
				hire(local).length,
				of('HIRE').length - 5,
				`${version} a local is raised no foreign-employee, FOMEMA, s.57A or Act 446 duty`
			);
			const foreign = raise(
				'employment_contract',
				'created',
				{
					effective_range: range,
					exit_facts: null,
					facts: { contract_terms: [{ residency_status: 'FOREIGNER' }] }
				},
				{ raised: [], company, employee: local }
			);
			// A foreign non-domestic employee without housing: neither the Act 446 nor the s.57A duty.
			assert.equal(foreign.length, of('HIRE').length - 2);
			assert.ok(hire(local).every((data) => data.triggered_on === '2026-10-15'));
			// Under twelve months' service a retrenchment raises Borang PK and the final wages only.
			const exits = raise(
				'employment_contract',
				'updated',
				{ effective_range: range, exit_ground: 'RETRENCHMENT', exit_facts: {} },
				{ raised: [], company, employee: local }
			);
			assert.deepEqual(exits.map((data) => String(data.duty_code)).toSorted(), [
				'PERSONAL_DATA_DISPOSAL',
				'RETRENCHMENT_NOTIFICATION',
				'TERMINATION_BENEFITS_FINAL_WAGES'
			]);
			assert.ok(exits.every((data) => data.triggered_on === '2026-12-31'));
		}
	});
	it('behaviours admit payroll, pin settled entries and encash EA s.60E leave on exit', () => {
		for (const version of versions) {
			const behaviours = behavioursOf(settingsOf(version).behaviours);
			assert.ok(behaviours, `${version} behaviours`);
			for (const rule of behaviours.rules)
				for (const read of Object.values(rule.reads ?? {}))
					assert.doesNotThrow(() =>
						resolveWhere(read.where, {
							event: {
								row: { id: 'c1', company_id: 'co1', employee_id: 'p1', period: '2026-02' },
								settings_id: 's1',
								day: '2026-02-01',
								company_id: 'co1',
								employment_id: 'c1',
								employee_id: 'p1'
							}
						})
					);
			const planned = planBehaviours(
				behaviours,
				{ kind: 'catalog', catalog: 'WORK', event: 'PAYROLL_CREATE' },
				{ event: { data: { request: { kind: 'OFF_CYCLE', period: '2026-02' } } } }
			);
			assert.ok(planned.some((rule) => rule.id === 'payroll-run'));
			const pin = behaviours.rules.find((rule) => rule.id === 'pin-settled-entries');
			assert.ok(pin);
			const pins = effectWrites(pin, {
				event: {
					row: {
						id: 'r1',
						pins: [{ collection: 'leave_catalog_entry', id: 'e1', employment_id: 'c1' }]
					}
				},
				slips: [{ id: 'p1', employment_id: 'c1' }]
			});
			assert.deepEqual(
				pins.map((write) => write.callable),
				['leave_catalog_entry.update']
			);
			const encash = behaviours.rules.find((rule) => rule.id === 'encash-leave-on-exit');
			assert.ok(encash);
			const annual = byCode(version, 'leave_catalog', 'ANNUAL_LEAVE');
			const context = {
				event: {
					settings_id: settingsOf(version).id,
					row: {
						id: 'c1',
						prior_service_months: null,
						exit_facts: {},
						effective_range: { from: '2023-01-01', to: '2026-02-28' }
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
					{
						catalog_id: annual.id,
						activity: 'TIME_OFF',
						days: 12,
						from: '2025-06-02',
						occurred_on: '2025-06-02',
						reference: 'y'
					},
					{
						catalog_id: annual.id,
						activity: 'TIME_OFF',
						days: 1,
						from: '2026-01-12',
						occurred_on: '2026-01-12',
						reference: 'x'
					}
				]
			};
			// Exit in the fourth service year (from 1 January 2026) after 2 completed months of it: EA s.60E(1) closing
			// words / s.60E(2A) prorate its 12 days to 12 × 2 / 12 = 2, less 1 taken; the third year's 12 were all
			// taken, so nothing carries in.
			const writes = effectWrites(encash, withBalances(context));
			assert.equal(writes.length, 1);
			assert.equal(fixtureValue19(fixturePresent(writes[0]).data).days, 1);
			// 5 completed months: 8 × 5 / 12 = 3.33, a fraction under a half disregarded → 3 days.
			const short = effectWrites(
				encash,
				withBalances({
					...context,
					event: {
						...context.event,
						row: { ...context.event.row, effective_range: { from: '2025-09-01', to: '2026-02-28' } }
					},
					movements: []
				})
			);
			assert.equal(fixtureValue19(fixturePresent(short[0]).data).days, 3);
			// Unused days of the previous service year carry in once (EA s.60E(2), (2A)): 12 − 4 of the third year, plus
			// the exit year's prorated 2.
			const carried = effectWrites(
				encash,
				withBalances({
					...context,
					movements: [{ ...fixturePresent(context.movements[0]), days: 4 }]
				})
			);
			assert.equal(fixtureValue19(fixturePresent(carried[0]).data).days, 10);
			// QA F7 (NHPMY0060): joined 2 December 2019, leaves 5 October 2026 after 10 completed months of the seventh
			// service year — 16 carried + 16 × 10 / 12 = 13.33 → 13, less 4 taken = 25 (not 16 + 16 − 4 = 28).
			const seventh = (to: string) =>
				fixtureValue19(
					fixturePresent(
						effectWrites(
							encash,
							withBalances({
								...context,
								event: {
									...context.event,
									row: { ...context.event.row, effective_range: { from: '2019-12-02', to } }
								},
								movements: [
									{
										...fixturePresent(context.movements[1]),
										days: 4,
										from: '2026-01-12',
										occurred_on: '2026-01-12'
									}
								]
							})
						)[0]
					).data
				);
			assert.equal(seventh('2026-10-05').days, 25, version);
			// A completed final year keeps its whole band: leaving on 1 December 2026 is 16 + 16 − 4.
			assert.equal(seventh('2026-12-01').days, 28);
			// s.60E(1) rounding: a half day or more is a day — 16 × 2 / 12 = 2.67 → 3 after two completed months.
			assert.equal(seventh('2026-02-05').days, 16 + 3 - 4);
			// EA s.60E(3A) proviso: no payment for untaken leave on a s.14(1)(a) misconduct dismissal.
			const dismissed = {
				event: {
					...context.event,
					row: { ...context.event.row, exit_facts: { misconduct_dismissal: true } }
				}
			};
			assert.equal(
				planBehaviours(
					behaviours,
					{ kind: 'row', collection: 'employment_contract', event: 'updated' },
					dismissed
				).includes(encash),
				false
			);
			assert.equal(
				planBehaviours(
					behaviours,
					{ kind: 'row', collection: 'employment_contract', event: 'updated' },
					{ event: context.event }
				).includes(encash),
				true
			);
		}
	});
	it('EPF Third Schedule Parts A, E and F charge the printed bands', () => {
		const citizen = { age: 40, residency_status: 'CITIZEN' };
		// Nihon salary listing Jan/Feb 2026: EPF wage 3,395.34 → 374/442; 3,451 → 381/450.
		assert.deepEqual(
			statutory(at('2026-01-15'), 'EPF', 3395.34, { ...citizen, day: '2026-01-15' }),
			{
				employee: 374,
				employer: 442
			}
		);
		assert.deepEqual(statutory(at('2026-02-15'), 'EPF', 3451, citizen), {
			employee: 381,
			employer: 450
		});
		assert.deepEqual(statutory(at('2026-02-15'), 'EPF', 5000, citizen), {
			employee: 550,
			employer: 650
		});
		// Above RM5,000 the employer rate is 12%, on the RM100 band.
		assert.deepEqual(statutory(at('2026-02-15'), 'EPF', 6050, citizen), {
			employee: 671,
			employer: 732
		});
		// Above RM20,000: exact percentages, only the total rounded up (KWSP example 2.1: RM21,250 → 2,550 + 2,337.50 = 4,888).
		assert.deepEqual(statutory(at('2026-02-15'), 'EPF', 21250, citizen), {
			employee: 2337.5,
			employer: 2550.5
		});
		// NHPMY0193 RM23,019: 2,532.09 + 2,762.28 = 5,294.37 → 5,295 (the listing's 2,533 / 2,763 over-remits RM1).
		assert.deepEqual(statutory(at('2026-02-15'), 'EPF', 23019, citizen), {
			employee: 2532.09,
			employer: 2762.91
		});
		// Part C above RM20,000 (KWSP example 2.3: RM21,250 → 1,275 + 1,168.75 = 2,444); Part E 4% only (example 2.2).
		assert.deepEqual(
			statutory(at('2026-02-15'), 'EPF_PR', 21250, {
				age: 62,
				residency_status: 'PERMANENT_RESIDENT'
			}),
			{ employee: 1168.75, employer: 1275.25 }
		);
		assert.deepEqual(statutory(at('2026-02-15'), 'EPF', 21250, { age: 65 }), {
			employee: 0,
			employer: 850
		});
		// A domestic servant contributes only after giving notice (First Schedule (2)–(3)); a non-citizen one never.
		const domestic = { terms: { employment_type: 'DOMESTIC' } };
		assert.equal(statutory(at('2026-02-15'), 'EPF', 3000, domestic), null);
		assert.deepEqual(
			statutory(at('2026-02-15'), 'EPF', 3000, {
				...domestic,
				all_elections: { EPF: { domestic_servant_notice_given: true } }
			}),
			{ employee: 330, employer: 390 }
		);
		// A non-citizen who elected before 1 August 1998 stays on Part A below 60 and Part C from 60.
		const elector = {
			residency_status: 'FOREIGNER',
			all_elections: { EPF: { elected_before_1998: true } }
		};
		assert.deepEqual(statutory(at('2026-02-15'), 'EPF', 3000, elector), {
			employee: 330,
			employer: 390
		});
		assert.equal(statutory(at('2026-02-15'), 'EPF_NON_CITIZEN', 3000, elector), null);
		assert.deepEqual(statutory(at('2026-02-15'), 'EPF_PR', 3000, { ...elector, age: 62 }), {
			employee: 165,
			employer: 195
		});
		// Part E, a citizen of 69 (listing NHPMY0360, RM12,556): employer 4% only.
		assert.deepEqual(statutory(at('2026-02-15'), 'EPF', 12556, { age: 69 }), {
			employee: 0,
			employer: 504
		});
		// A permanent resident of 60+ is Part C under EPF_PR alone.
		const pr = { age: 62, residency_status: 'PERMANENT_RESIDENT' };
		assert.equal(statutory(at('2026-02-15'), 'EPF', 3000, pr), null);
		assert.deepEqual(statutory(at('2026-02-15'), 'EPF_PR', 3000, pr), {
			employee: 165,
			employer: 195
		});
		// Part F (Act A1760): 2% each, only the total rounded up (KWSP example 2.4: RM6,710 → 134.20 + 134.20 = 269);
		// the Nihon listing's RM1,954 → 40 / 40 rounds each share and over-remits RM1.
		const foreigner = { age: 30, residency_status: 'FOREIGNER' };
		assert.deepEqual(statutory(at('2026-02-15'), 'EPF_NON_CITIZEN', 6710, foreigner), {
			employee: 134.2,
			employer: 134.8
		});
		assert.deepEqual(statutory(at('2026-02-15'), 'EPF_NON_CITIZEN', 1751, foreigner), {
			employee: 35.02,
			employer: 35.98
		});
		assert.deepEqual(statutory(at('2026-02-15'), 'EPF_NON_CITIZEN', 1954, foreigner), {
			employee: 39.08,
			employer: 39.92
		});
		// Not liable: a domestic worker, a lapsed work pass, a Board-approved other scheme.
		for (const input of [
			{ ...foreigner, terms: { employment_type: 'DOMESTIC' } },
			{ ...foreigner, terms: { facts: { work_pass_valid_until: '2026-01-31' } } },
			{ ...foreigner, elections: { board_approved_other_scheme: true } }
		])
			assert.equal(statutory(at('2026-02-15'), 'EPF_NON_CITIZEN', 3000, input), null);
		assert.deepEqual(
			statutory(at('2026-02-15'), 'EPF_NON_CITIZEN', 3000, {
				...foreigner,
				terms: { facts: { work_pass_valid_until: '2026-12-31' } }
			}),
			{ employee: 60, employer: 60 }
		);
		// A lapsed pass also leaves the SOCSO invalidity scheme: Second Category (Act 4 First Schedule para 12A).
		assert.deepEqual(
			statutory(at('2026-02-15'), 'SOCSO', 3000, {
				...foreigner,
				terms: { facts: { work_pass_valid_until: '2026-01-31' } }
			}),
			{ employee: 0, employer: 36.9 }
		);
		assert.equal(
			statutory(at('2026-02-15'), 'EPF_NON_CITIZEN', 1751, { ...foreigner, age: 75 }),
			null
		);
	});
	it('SOCSO, EIS and HRD levy match the Nihon salary listings and the HRD registration class', () => {
		assert.deepEqual(statutory(at('2026-01-15'), 'SOCSO', 3760.78, { day: '2026-01-15' }), {
			employee: 18.75,
			employer: 65.65
		});
		assert.deepEqual(statutory(at('2026-02-15'), 'SOCSO', 3830.49), {
			employee: 19.25,
			employer: 67.35
		});
		assert.deepEqual(statutory(at('2026-02-15'), 'SOCSO', 10000), {
			employee: 29.75,
			employer: 104.15
		});
		assert.deepEqual(statutory(at('2026-02-15'), 'SOCSO', 12556, { age: 69 }), {
			employee: 0,
			employer: 74.4
		});
		assert.deepEqual(statutory(at('2026-02-15'), 'EIS', 3830.49), { employee: 7.7, employer: 7.7 });
		assert.deepEqual(statutory(at('2026-02-15'), 'EIS', 9000), { employee: 11.9, employer: 11.9 });
		const foreigner = { age: 30, residency_status: 'FOREIGNER' };
		assert.equal(statutory(at('2026-02-15'), 'EIS', 3000, foreigner), null);
		for (const version of versions) {
			// Foreign workers: First Category since 1 July 2024 (listing NHPMY0310, SOCSO wage RM1,855.31 → 9.25 / 32.35).
			assert.deepEqual(statutory(version, 'SOCSO', 1855.31, foreigner), {
				employee: 9.25,
				employer: 32.35
			});
			assert.deepEqual(statutory(version, 'SOCSO', 1855.31, { ...foreigner, age: 61 }), {
				employee: 0,
				employer: 23.1
			});
			// Second Category: first insured at 55 or more, or receiving an invalidity pension (Act 4 First Schedule 12).
			assert.deepEqual(
				statutory(version, 'SOCSO', 3000, {
					age: 56,
					elections: { first_insured_at_55_or_more: true }
				}),
				{ employee: 0, employer: 36.9 }
			);
			assert.deepEqual(statutory(version, 'SOCSO', 3000, { age: 56 }), {
				employee: 14.75,
				employer: 51.65
			});
			assert.deepEqual(
				statutory(version, 'SOCSO', 3000, { employee: { receiving_pension: true } }),
				{ employee: 0, employer: 36.9 }
			);
			// Act A1788 Part IV / A4T: the 1.25% column rounds half to even — RM200.01–300 → 3.10, RM300.01–400 → 4.40.
			for (const [wage, employer] of [
				[250, 3.1],
				[350, 4.4],
				[450, 5.6],
				[5950, 74.4]
			] as const)
				assert.deepEqual(
					statutory(version, 'SOCSO', wage, { age: 65 }),
					{ employee: 0, employer },
					`${wage}`
				);
			// Wages up to RM200: the printed rows of the Third Schedule and the Act 800 Second Schedule.
			for (const [wage, ee, er, er2, eis] of [
				[25, 0.1, 0.4, 0.3, 0.05],
				[45, 0.2, 0.7, 0.5, 0.1],
				[150, 0.85, 2.95, 2.1, 0.35],
				[200, 0.85, 2.95, 2.1, 0.35]
			] as const) {
				assert.deepEqual(
					statutory(version, 'SOCSO', wage),
					{ employee: ee, employer: er },
					`${version} ${wage}`
				);
				assert.deepEqual(statutory(version, 'SOCSO', wage, { age: 65 }), {
					employee: 0,
					employer: er2
				});
				assert.deepEqual(statutory(version, 'EIS', wage), { employee: eis, employer: eis });
			}
			// EIS from 57 only where a contribution was payable before 57 (Act 800 First Schedule para 9).
			assert.equal(
				statutory(version, 'EIS', 3000, {
					age: 57,
					elections: { first_insured_at_57_or_more: true }
				}),
				null
			);
			assert.deepEqual(statutory(version, 'EIS', 3000, { age: 57 }), {
				employee: 5.9,
				employer: 5.9
			});
			// The 2026 HRD levy exemption for scheduled education employers: P.U. (A) 13/2026 Schedule codes.
			assert.deepEqual(
				fixtureValue20(fixtureRecord(settingsOf(version).entity_input_schema).properties)
					.hrd_education_schedule_code.enum,
				['NONE', '85102', '85104', '85212', '85222', '85302', '8541', '8542', '8549', '85500'],
				version
			);
			const school = {
				company: { hrd_registration_class: 'COMPULSORY', hrd_education_schedule_code: '85212' }
			};
			const range = fixtureValue2(settingsOf(version).effective_range);
			// P.U.(A) 13/2026: exempt only in the versions inside January–November 2026 wage months (each change of law
			// its own version: the exemption ends with version_6 from 1 December 2026).
			const exempt = range.from >= '2026-01-01' && range.to != null && range.to <= '2026-11-30';
			assert.deepEqual(
				statutory(version, 'HRDF', 3451, { ...school, day: range.from }),
				exempt ? null : { employee: 0, employer: 34.51 },
				version
			);
		}
		// Strict reading (owner ruling): levy payable 15 January – 31 December 2026, so November 2026 wages are
		// exempt and December 2026 wages (levy payable in January 2027) are charged.
		{
			const school = {
				company: { hrd_registration_class: 'COMPULSORY', hrd_education_schedule_code: '85212' }
			};
			assert.equal(
				statutory(at('2026-11-01'), 'HRDF', 3451, { ...school, day: '2026-11-01' }),
				null
			);
			assert.deepEqual(
				statutory(at('2026-12-01'), 'HRDF', 3451, { ...school, day: '2026-12-01' }),
				{ employee: 0, employer: 34.51 }
			);
			assert.notEqual(at('2026-11-01'), at('2026-12-01'));
		}
		for (const version of versions) {
			// Unrecorded class is compulsory: 1% of a citizen's wages (listing NHPMY0053: 3,451 → 34.51).
			assert.deepEqual(statutory(version, 'HRDF', 3451), { employee: 0, employer: 34.51 }, version);
			assert.deepEqual(
				statutory(version, 'HRDF', 3451, { company: { hrd_registration_class: 'COMPULSORY' } }),
				{ employee: 0, employer: 34.51 }
			);
			assert.deepEqual(
				statutory(version, 'HRDF', 3451, { company: { hrd_registration_class: 'OPTIONAL' } }),
				{ employee: 0, employer: 17.26 }
			);
			assert.equal(
				statutory(version, 'HRDF', 3451, { company: { hrd_registration_class: 'NOT_REGISTERED' } }),
				null
			);
			assert.equal(
				statutory(version, 'HRDF', 3451, {
					company: { hrd_scope: 'OUT_OF_SCOPE', hrd_registration_class: 'COMPULSORY' }
				}),
				null
			);
			assert.equal(statutory(version, 'HRDF', 3451, foreigner), null);
			// Act 612 s.2: domestic servants and part-time wages are outside the levy.
			for (const employment_type of ['DOMESTIC', 'PART_TIME'])
				assert.equal(statutory(version, 'HRDF', 3451, { terms: { employment_type } }), null);
			assert.equal(
				statutory(version, 'HRDF', 3451, { residency_status: 'PERMANENT_RESIDENT' }),
				null
			);
		}
	});
	it('MTD: non-resident 30%; resident Specification 2026 D year to date with EPF relief, reliefs, rebates and additional remuneration', () => {
		for (const version of versions) {
			// January: no earlier month, n = 11 — the year-to-date formula equals twelve equal months.
			const mtd = (
				parts: {
					[part: string]: number;
				},
				input: Subject = {}
			) => statutory(version, 'PCB', pcb(parts), { day: '2026-01-15', ...input })?.employee;
			// Non-resident at 30% (listing NHPMY0363, RM10,000 → RM3,000), no reliefs.
			assert.equal(mtd({ ordinary: 10000 }, { age: 60, residency_status: 'FOREIGNER' }), 3000);
			// Single, no children, RM7,000: K1 770, K2 = min(770, 3,230 ÷ 11); P = 6,230 + 6,706.36 × 11 − 9,000 = 71,000;
			// tax 3,700 + 1,000 × 19% = 3,890 ÷ 12 = 324.166 → 324.16 → 324.20. (The Nihon listing shows 323.50: its
			// payroll software relieves SOCSO/EIS automatically, which the Specification leaves to a TP1 claim.)
			assert.equal(mtd({ ordinary: 7000 }), 324.2, version);
			// February after that January: Σ(Y − K) = 6,230, X = 324.20, n = 10 → P = 71,000 again;
			// (3,890 − 324.20) ÷ 11 = 324.163 → 324.20.
			const january = {
				year: { ordinary: 7000 },
				charged: { EPF: { employee: 770, employer: 910 }, PCB: { employee: 324.2, employer: 0 } }
			};
			assert.equal(mtd({ ordinary: 7000 }, { day: '2026-02-15', ...january }), 324.2);
			// A raise in February: K2 = min(880, (4,000 − 770 − 880) ÷ 10) = 235;
			// P = 6,230 + (8,000 − 880) + (8,000 − 235) × 10 − 9,000 = 82,000 → 3,700 + 12,000 × 19% = 5,980;
			// (5,980 − 324.20) ÷ 11 = 514.16 → 514.20.
			assert.equal(mtd({ ordinary: 8000 }, { day: '2026-02-15', ...january }), 514.2);
			// RM5,000: P = 47,000; 600 + 12,000 × 6% = 1,320 ÷ 12 = 110.00.
			assert.equal(mtd({ ordinary: 5000 }), 110);
			// RM3,900: P = 33,800; 150 + 13,800 × 3% = 564 − RM400 rebate = 164 ÷ 12 = 13.66 → 13.70.
			assert.equal(mtd({ ordinary: 3900 }), 13.7);
			// Listing NHPMY0053 (RM3,760.78 incl. RM365.44 overtime): 513.88 − 400 → 9.49 a month, under RM10.
			assert.equal(mtd({ ordinary: 3395.34, non_epf: 365.44 }), 0);
			// Overtime is PCB remuneration but not EPF wages: K is 11% of the RM3,000 basic only.
			// P = 60,000 − 3,960 − 9,000 = 47,040; 600 + 12,040 × 6% = 1,322.40 ÷ 12 = 110.20.
			assert.equal(mtd({ ordinary: 3000, non_epf: 2000 }), 110.2);
			// Married, spouse without income, two children under 18: D 9,000 + S 4,000 + 2 × 2,000.
			const spouse = { marital_status: 'MARRIED', spouse_status: 'WITHOUT_INCOME' };
			// P = 60,000 − 4,000 − 17,000 = 39,000; 600 + 4,000 × 6% = 840 ÷ 12 = 70.00 (no rebate above 35,000).
			assert.equal(
				mtd(
					{ ordinary: 5000 },
					{ employee: spouse, elections: { children_under_18_or_studying: 2 } }
				),
				70
			);
			// RM3,900 with the spouse: P = 29,800 → 444 − (400 + 400 spouse rebate) < 0 → nothing.
			assert.equal(mtd({ ordinary: 3900 }, { employee: spouse }), 0);
			// Disabled employee (RM7,000), disabled spouse (further RM6,000), half-share tertiary child (RM4,000):
			// P = 84,000 − 4,000 − (9,000 + 7,000 + 4,000 + 6,000 + 4,000) = 50,000 → 1,500 ÷ 12 = 125.00.
			assert.equal(
				mtd(
					{ ordinary: 7000 },
					{
						employee: { ...spouse, disabled: true },
						elections: { spouse_disabled: true, children_tertiary_or_disabled_half: 1 }
					}
				),
				125
			);
			// A RM7,000 bonus on RM7,000 (K already within the cap): P1 = 78,000 → 3,700 + 8,000 × 19% = 5,220;
			// additional MTD = 5,220 − 12 × 324.20 = 1,329.60; month 324.20 + 1,329.60.
			assert.equal(mtd({ ordinary: 7000, additional: 7000 }), 1653.8);
			// Payroll zakat is rebated from the month's MTD …
			assert.equal(mtd({ ordinary: 7000 }, { elections: { zakat_monthly: 100 } }), 224.2);
			// … and the earlier months' zakat counts with their MTD: February's X + Z = 224.20 + 100.
			assert.equal(
				mtd(
					{ ordinary: 7000 },
					{
						day: '2026-02-15',
						elections: { zakat_monthly: 100 },
						year: { ordinary: 7000 },
						charged: {
							EPF: { employee: 770, employer: 910 },
							PCB: { employee: 224.2, employer: 0 }
						}
					}
				),
				224.2
			);
			// A foreigner declared tax resident: scale rates with Part F EPF (2% = 140) as K.
			// P = 84,000 − 1,680 − 9,000 = 73,320 → 3,700 + 3,320 × 19% = 4,330.80 ÷ 12 = 360.90.
			assert.equal(
				mtd(
					{ ordinary: 7000 },
					{ residency_status: 'FOREIGNER', elections: { tax_residency: 'RESIDENT' } }
				),
				360.9
			);
			// TP1 deductions declared for the month (LP1 RM500, January): P = 71,000 − 500 = 70,500 →
			// 3,700 + 500 × 19% = 3,795 ÷ 12 = 316.25.
			assert.equal(mtd({ ordinary: 7000 }, { elections: { tp1_monthly_deductions: 500 } }), 316.25);
			// TP3 for a February joiner: RM7,000 earlier remuneration, RM770 EPF and RM324.20 MTD at the previous employer.
			assert.equal(
				mtd(
					{ ordinary: 7000 },
					{
						day: '2026-02-15',
						elections: { tp3_prior_remuneration: 7000, tp3_prior_epf: 770, tp3_prior_mtd: 324.2 }
					}
				),
				324.2
			);
			// REP / knowledge worker at 15% of P with the rebates; C-suite at 15% with none (Specification sections 3–5).
			// RM7,000: P = 71,000 → 10,650 ÷ 12 = 887.50 (above RM35,000, no rebate either way).
			const rep = {
				pcb_tax_profile: 'REP',
				pcb_approval_first_year: 2024,
				pcb_approval_last_year: 2028
			};
			assert.equal(mtd({ ordinary: 7000 }, { elections: rep }), 887.5);
			assert.equal(
				mtd({ ordinary: 7000 }, { elections: { ...rep, pcb_approval_last_year: 2025 } }),
				324.2
			);
			assert.equal(
				mtd({ ordinary: 7000 }, { elections: { ...rep, pcb_tax_profile: 'C_SUITE' } }),
				887.5
			);
			// P = 3,000 × 12 − 3,960 − 9,000 = 23,040: REP 3,456 − 400 = 3,056 ÷ 12 = 254.67 → 254.70; C-suite no rebate 288.
			assert.equal(mtd({ ordinary: 3000 }, { elections: rep }), 254.7);
			assert.equal(
				mtd({ ordinary: 3000 }, { elections: { ...rep, pcb_tax_profile: 'C_SUITE' } }),
				288
			);
			// A citizen declared non-resident pays 30%.
			assert.equal(mtd({ ordinary: 7000 }, { elections: { tax_residency: 'NON_RESIDENT' } }), 2100);
		}
	});
	it('SKBBK is an employee contribution from 1 June 2026, phased 0.75% / 1.00% / 1.25%, voluntary for locals from 8 July 2026', () => {
		for (const day of ['2025-12-15', '2026-05-31'])
			assert.equal(
				rows(at(day), 'statutory_contribution_catalog').some((row) => row.code === 'SKBBK'),
				false
			);
		for (const [day, top] of [
			['2026-06-01', 44.65],
			['2026-07-08', 44.65],
			['2028-06-01', 59.5],
			['2031-06-01', 74.4]
		] as const)
			for (const residency_status of ['CITIZEN', 'FOREIGNER'])
				assert.deepEqual(
					statutory(at(day), 'SKBBK', 6000, { age: 30, residency_status, day }),
					{ employee: top, employer: 0 },
					day
				);
		// An accepted release (a RELEASED SKBBK standing) stops a citizen's or permanent resident's contribution; a
		// FOREIGNER stays levied.
		// Act A1788 Parts I–III, RM200.01–300 / RM400.01–500 and up to RM30: 1.85 / 3.35 / 0.20, 2.50 / 4.50 / 0.25,
		// 3.10 / 5.60 / 0.30.
		for (const [day, rows3] of [
			[
				'2026-06-15',
				[
					[250, 1.85],
					[450, 3.35],
					[25, 0.2]
				]
			],
			[
				'2028-06-15',
				[
					[250, 2.5],
					[450, 4.5],
					[25, 0.25]
				]
			],
			[
				'2031-06-15',
				[
					[250, 3.1],
					[450, 5.6],
					[25, 0.3]
				]
			]
		] as const)
			for (const [wage, employee] of rows3)
				assert.deepEqual(
					statutory(at(day), 'SKBBK', wage, { day }),
					{ employee, employer: 0 },
					`${day} ${wage}`
				);
		// Only the employer the employee designated deducts SKBBK (PERKESO FAQ Q21).
		assert.equal(
			statutory(at('2026-09-15'), 'SKBBK', 6000, {
				day: '2026-09-15',
				elections: { designated_employer: false }
			}),
			null
		);
		assert.deepEqual(
			statutory(at('2026-09-15'), 'SKBBK', 6000, {
				day: '2026-09-15',
				elections: { designated_employer: true }
			}),
			{ employee: 44.65, employer: 0 }
		);
		const released = { standing: 'RELEASED' };
		assert.equal(
			statutory(at('2026-09-15'), 'SKBBK', 6000, { day: '2026-09-15', ...released }),
			null
		);
		assert.equal(
			statutory(at('2026-09-15'), 'SKBBK', 6000, {
				residency_status: 'PERMANENT_RESIDENT',
				day: '2026-09-15',
				...released
			}),
			null
		);
		assert.deepEqual(
			statutory(at('2026-09-15'), 'SKBBK', 6000, { day: '2026-09-15', standing: 'REGISTERED' }),
			{ employee: 44.65, employer: 0 }
		);
		assert.deepEqual(
			statutory(at('2026-09-15'), 'SKBBK', 6000, {
				residency_status: 'FOREIGNER',
				day: '2026-09-15',
				...released
			}),
			{ employee: 44.65, employer: 0 }
		);
	});
	it('÷26 for the ordinary rate (EA s.60I) and calendar days for no-pay leave and part months (EA s.18A)', () => {
		for (const version of versions) {
			// February: 28 calendar days.
			const context = payslipContext();
			assert.equal(line(version, 'BASIC', context), 3000);
			// Part month: the days employed × monthly ÷ the days of the month (s.18A(a)–(b)).
			// Joined on 19 February: 10 days employed.
			const joined = payslipContext({ start_date: '2026-02-19' });
			const part = { ...joined, period: { ...joined.period, paid_days: 10, covered_days: 10 } };
			assert.equal(line(version, 'BASIC', part), round2((3000 / 28) * 10));
			// No-pay leave: monthly ÷ the days of the month (s.18A(c)); listing NHPMY0045 Jan 2026, 1.5 days of RM2,622 → 126.87.
			assert.equal(line(version, 'NO_PAY_LEAVE', context), round2((3000 / 28) * 2));
			const january = payslipContext(
				{ terms: { base_salary: 2622 } },
				{
					period: {
						...context.period,
						key: '2026-01',
						from: '2026-01-01',
						to: '2026-01-31',
						days: 31,
						paid_days: 31,
						month_key: '2026-01',
						month_from: '2026-01-01',
						month_to: '2026-01-31',
						month_days: 31
					},
					leave: { rows: [leaveRow({ code: 'UNPAID_LEAVE', days: 1.5, is_npl: true })] }
				}
			);
			assert.equal(line(version, 'NO_PAY_LEAVE', january), 126.87);
			// No-pay days never take more than the days employed.
			const absent = {
				...context,
				leave: { rows: [leaveRow({ code: 'UNPAID_LEAVE', days: 31, is_npl: true })] }
			};
			assert.equal(line(version, 'NO_PAY_LEAVE', absent), 3000);
			// Encashment, overtime and holiday work price the ordinary rate of pay: monthly ÷ 26 (s.60I(1A)).
			assert.equal(line(version, 'ENCASHMENT', context), round2(3000 / 26));
			// Normal-day overtime 1.5 × monthly ÷ 26 ÷ normal daily hours (s.60A(3), s.60I(1)(b)); unrecorded hours are 8.
			assert.equal(line(version, 'OVERTIME', context), round2(10 * 1.5 * (3000 / 26 / 8)));
			const shorter = payslipContext({ company: { normal_daily_hours: 7.5 } });
			assert.equal(line(version, 'OVERTIME', shorter), round2(10 * 1.5 * (3000 / 26 / 7.5)));
			const days = (list: Row[]) => payslipContext({}, { work: { ...context.work, days: list } });
			const capped = days([
				workDay('2026-02-03', {
					overtime_hours: 110,
					incentive_hours: 6,
					payable_incentive_hours: 6
				})
			]);
			assert.equal(line(version, 'OVERTIME', capped), round2(104 * 1.5 * (3000 / 26 / 8)));
			assert.equal(line(version, 'INCENTIVE', capped), round2(6 * 1.5 * (3000 / 26 / 8)));
			// Rest days (s.60(3)): up to half the normal hours → half a day's wages, more → a day's; beyond → 2× hourly.
			// Every hour on a planned 0-hour rest day is derived overtime; the lines split it at the normal hours.
			const rest = days([
				workDay('2026-02-07', {
					day_type: 'REST',
					scheduled_hours: 0,
					worked_hours: 4,
					overtime_hours: 4
				}),
				workDay('2026-02-08', {
					day_type: 'REST',
					scheduled_hours: 0,
					worked_hours: 11,
					overtime_hours: 11
				})
			]);
			assert.equal(line(version, 'OVERTIME', rest), 0);
			assert.equal(line(version, 'REST_DAY_WORK', rest), round2((3000 / 26) * 1.5));
			assert.equal(line(version, 'REST_DAY_OVERTIME', rest), round2(3 * 2 * (3000 / 26 / 8)));
			// Public-holiday overtime beyond the normal hours at 3× hourly (s.60D(3)(a)(ii)).
			const holiday = days([
				workDay('2026-02-10', {
					holiday_kind: 'PUBLIC_HOLIDAY',
					worked_hours: 10,
					overtime_hours: 2
				})
			]);
			assert.equal(line(version, 'HOLIDAY_OVERTIME', holiday), round2(2 * 3 * (3000 / 26 / 8)));
			assert.equal(line(version, 'OVERTIME', holiday), 0);
			for (const code of ['REST_DAY_OVERTIME', 'HOLIDAY_OVERTIME']) {
				const counts = fixtureValue16(byCode(version, 'work_catalog', code).counts_toward);
				assert.equal(
					counts.some((target) => target.startsWith('EPF') || target === 'HRDF'),
					false,
					code
				);
			}
			// Two public holidays worked within normal hours: two days' wages each (s.60D(3)(a)(i)).
			const holidays = payslipContext(
				{},
				{
					work: {
						...context.work,
						dates: ['2026-02-10', '2026-02-12'],
						holidays: ['2026-02-10', '2026-02-12'].map((date) => ({
							date,
							kind: 'PUBLIC_HOLIDAY',
							given_to: 'EVERYONE',
							replaces: '',
							worked: true
						}))
					}
				}
			);
			assert.equal(line(version, 'HOLIDAY_WORK', holidays), round2((3000 / 26) * 2 * 2));
			// A fixed allowance is part of the monthly wages and prorates by calendar days with the salary.
			for (const row of rows(version, 'allowance_catalog'))
				assert.equal(
					evaluateConfigured(
						fixtureString(String(row.amount)),
						fixtureContext({ ...part, allowance: { amount: 280 } })
					),
					100,
					`${version} ${String(row.code)}`
				);
		}
	});
	it('derived payable overflow partitions approved overtime once across calendar-month parts', () => {
		for (const version of versions) {
			const context = payslipContext();
			const hourly = 1.5 * (3000 / 26 / 8);
			for (const { date, overtime_hours, incentive_hours, payable_incentive_hours, regular } of [
				{
					date: '2026-02-10',
					overtime_hours: 104,
					incentive_hours: 0,
					payable_incentive_hours: 0,
					regular: 104
				},
				{
					date: '2026-02-10',
					overtime_hours: 80,
					incentive_hours: 0,
					payable_incentive_hours: 0,
					regular: 80
				},
				{
					date: '2026-02-20',
					overtime_hours: 40,
					incentive_hours: 16,
					payable_incentive_hours: 16,
					regular: 24
				},
				{
					date: '2026-02-20',
					overtime_hours: 2,
					incentive_hours: 4,
					payable_incentive_hours: 2,
					regular: 0
				}
			]) {
				const work = {
					...context.work,
					overtime_hours,
					incentive_hours,
					payable_incentive_hours,
					days: [workDay(date, { overtime_hours, incentive_hours, payable_incentive_hours })]
				};
				const approved = payslipContext({}, { work });
				assert.equal(line(version, 'OVERTIME', approved), round2(regular * hourly));
				assert.equal(
					line(version, 'INCENTIVE', approved),
					round2(payable_incentive_hours * hourly)
				);
				const changedClock = payslipContext(
					{},
					{
						work: {
							...work,
							days: [
								workDay(date, {
									overtime_hours,
									incentive_hours,
									payable_incentive_hours,
									worked_hours: 30
								})
							]
						}
					}
				);
				assert.equal(line(version, 'OVERTIME', changedClock), line(version, 'OVERTIME', approved));
				assert.equal(
					line(version, 'INCENTIVE', changedClock),
					line(version, 'INCENTIVE', approved)
				);
			}
			const rest = payslipContext(
				{},
				{
					work: {
						...context.work,
						days: [
							// 11 hours on a planned 0-hour rest day: all derived overtime, 3 beyond the normal 8.
							workDay('2026-02-21', {
								day_type: 'REST',
								scheduled_hours: 0,
								worked_hours: 11,
								overtime_hours: 11,
								incentive_hours: 3,
								payable_incentive_hours: 3
							})
						]
					}
				}
			);
			assert.equal(line(version, 'OVERTIME', rest), 0);
			assert.equal(line(version, 'INCENTIVE', rest), 0);
			assert.equal(line(version, 'REST_DAY_OVERTIME', rest), round2(3 * 2 * (3000 / 26 / 8)));
		}
	});
	it('a CP38 instalment is a net deduction outside every scheme, so it never enters accumulated MTD', () => {
		for (const version of versions) {
			const row = byCode(version, 'adhoc_catalog', 'CP38_INSTALMENT');
			assert.deepEqual(
				[row.destination, row.direction, row.counts_toward],
				['NET', 'SUBTRACT', []]
			);
		}
	});
	it('overtime and other non-EPF pay is PCB remuneration outside the EPF and HRD wage', () => {
		for (const version of versions) {
			for (const code of ['OVERTIME', 'INCENTIVE']) {
				const counts = fixtureValue16(byCode(version, 'work_catalog', code).counts_toward);
				for (const scheme of ['EPF', 'EPF_PR', 'EPF_NON_CITIZEN', 'HRDF'])
					assert.equal(counts.includes(scheme), false);
				assert.ok(counts.includes('SOCSO') && counts.includes('PCB.NON_EPF'));
			}
			for (const table of ['work_catalog', 'adhoc_catalog', 'allowance_catalog'] as const)
				for (const row of rows(version, table)) {
					const counts = fixtureValue16(row.counts_toward ?? []);
					const epf = counts.some((target) => target.startsWith('EPF'));
					const where = `${version} ${table} ${String(row.code)}`;
					for (const target of counts.filter((item) => item.startsWith('PCB')))
						assert.ok(
							epf
								? ['PCB', 'PCB.ORDINARY', 'PCB.ADDITIONAL'].includes(target)
								: ['PCB.NON_EPF', 'PCB.ADDITIONAL_NON_EPF'].includes(target),
							`${where} ${target}`
						);
				}
		}
	});
	it('leave classes read the person: maternity by surviving children, paternity by gender and marriage', () => {
		const eligible = (version: string, code: string, context: object) =>
			evaluateConfigured(
				fixtureString(String(byCode(version, 'leave_catalog', code).eligibility)),
				fixtureContext(context)
			);
		const born = (dates: string[]) =>
			dates.map((child_birthdate) => ({ child_birthdate, relationship: 'CHILD' }));
		for (const version of versions) {
			const mother = (children: object[], facts: Row = {}) =>
				admitContext(
					{ event_kind: 'BIRTH', ...facts },
					{ employee: { gender: 'FEMALE', children } }
				);
			const two = mother(born(['2019-03-01', '2022-07-01']));
			assert.equal(eligible(version, 'MATERNITY_LEAVE', two), true);
			assert.equal(eligible(version, 'MATERNITY_LEAVE_NO_ALLOWANCE', two), false);
			// Five surviving natural children at confinement: the leave, no allowance (EA s.37(1)(c)).
			const five = mother(
				born(['2012-01-01', '2014-01-01', '2016-01-01', '2018-01-01', '2020-01-01'])
			);
			assert.equal(eligible(version, 'MATERNITY_LEAVE', five), false);
			assert.equal(eligible(version, 'MATERNITY_LEAVE_NO_ALLOWANCE', five), true);
			// A child who died before confinement, an adopted child and the newborn do not count.
			const counted = mother([
				...born(['2012-01-01', '2014-01-01', '2016-01-01', '2026-02-10']),
				{ child_birthdate: '2018-01-01', relationship: 'CHILD', child_deathdate: '2019-01-01' },
				{ child_birthdate: '2018-06-01', relationship: 'ADOPTED' }
			]);
			assert.equal(eligible(version, 'MATERNITY_LEAVE', counted), true);
			// Fewer than 90 days' service in the nine months before confinement: no allowance (s.37(2)(a)).
			assert.equal(
				eligible(version, 'MATERNITY_LEAVE', mother([], { qualifying_service_days: 60 })),
				false
			);
			assert.equal(
				eligible(
					version,
					'MATERNITY_LEAVE_NO_ALLOWANCE',
					mother([], { qualifying_service_days: 60 })
				),
				true
			);
			assert.equal(byCode(version, 'leave_catalog', 'MATERNITY_LEAVE_NO_ALLOWANCE').is_npl, true);
			const man = admitContext(
				{ event_kind: 'BIRTH' },
				{ employee: { gender: 'MALE', marital_status: 'MARRIED' } }
			);
			assert.equal(eligible(version, 'MATERNITY_LEAVE', man), false);
			assert.equal(eligible(version, 'MATERNITY_LEAVE_NO_ALLOWANCE', man), false);
			// Paternity: a married man with twelve months' service, seven days a confinement, five confinements.
			const father = (employee: Row, days: number, service_months = 30) =>
				admitContext({ event_kind: 'BIRTH' }, { employee, service_months }, { days });
			assert.equal(
				eligible(
					version,
					'PATERNITY_LEAVE',
					father({ gender: 'MALE', marital_status: 'MARRIED' }, 7)
				),
				true
			);
			assert.equal(
				eligible(
					version,
					'PATERNITY_LEAVE',
					father({ gender: 'MALE', marital_status: 'SINGLE' }, 7)
				),
				false
			);
			assert.equal(
				eligible(
					version,
					'PATERNITY_LEAVE',
					father({ gender: 'FEMALE', marital_status: 'MARRIED' }, 7)
				),
				false
			);
			assert.equal(
				eligible(
					version,
					'PATERNITY_LEAVE',
					father({ gender: 'MALE', marital_status: 'MARRIED' }, 7, 11)
				),
				false
			);
			const paternity = byCode(version, 'leave_catalog', 'PATERNITY_LEAVE');
			// Seven days a confinement (window EVENT), five confinements: 35 days over the employment.
			assert.equal(fixtureValue5(paternity.entitlement).window, 'EVENT');
			assert.equal(entitled(paternity, 30), 7);
			assert.equal(entitled(paternity, 30, { lifetime: 28, event: 0 }), 7);
			assert.equal(entitled(paternity, 30, { lifetime: 31, event: 3 }), 7);
			assert.equal(entitled(paternity, 30, { lifetime: 35, event: 0 }), 0);
			// Maternity: 98 days per confinement; sick 14 / 18 / 22 and hospitalisation 60 in each calendar year.
			for (const code of ['MATERNITY_LEAVE', 'MATERNITY_LEAVE_NO_ALLOWANCE']) {
				const row = byCode(version, 'leave_catalog', code);
				assert.equal(fixtureValue5(row.entitlement).window, 'EVENT');
				assert.equal(entitled(row, 30), 98);
			}
			const sick = byCode(version, 'leave_catalog', 'MEDICAL_LEAVE');
			assert.equal(fixtureValue5(sick.entitlement).window, 'CALENDAR_YEAR');
			assert.deepEqual(
				[6, 24, 59, 60].map((months) => entitled(sick, months)),
				[14, 18, 18, 22]
			);
			assert.deepEqual(
				[6, 24, 60].map((months) =>
					entitled(sick, months, {}, { terms: { employment_type: 'PART_TIME' } })
				),
				[10, 13, 15]
			);
			const hospital = byCode(version, 'leave_catalog', 'HOSPITALIZATION_LEAVE');
			assert.equal(fixtureValue5(hospital.entitlement).window, 'CALENDAR_YEAR');
			assert.equal(entitled(hospital, 6), 60);
			assert.equal(paternity.can_encash, false);
			// Court or custody absence is unpaid (EA s.23); attendance as the employer's witness is not this class.
			const court = byCode(version, 'leave_catalog', 'COURT_CUSTODY_ABSENCE');
			assert.equal(court.is_npl, true);
			assert.equal(
				eligible(version, 'COURT_CUSTODY_ABSENCE', admitContext({ absence_ground: 'CUSTODY' })),
				true
			);
			assert.equal(
				eligible(
					version,
					'COURT_CUSTODY_ABSENCE',
					admitContext({ absence_ground: 'EMPLOYER_WITNESS' })
				),
				false
			);
			// No MY leave class is partly paid: unpaid classes are is_npl, the rest are full pay.
			for (const row of rows(version, 'leave_catalog'))
				assert.equal(row.pay_fraction ?? '', '', `${version} ${String(row.code)}`);
		}
	});
	it('annual leave carries the EA s.60E(1) 8/12/16-day bands per service year, carrying one year once', () => {
		for (const version of versions) {
			const annual = byCode(version, 'leave_catalog', 'ANNUAL_LEAVE');
			const entitlement = fixtureValue5(annual.entitlement);
			assert.equal(entitlement.window, 'SERVICE_YEAR');
			// The carry cap is the year's band; the grant is the band unless s.60E(2) forfeits it.
			assert.ok(String(entitlement.days).includes(`(${String(entitlement.carry_forward)})`));
			// s.60E(2): absent without leave on more than 10% of the working days (31.2 of 312) forfeits the year.
			const absent = (days: number, facts: Row = {}) =>
				entitled(annual, 24, {}, { terms: { facts } }, { ABSENCE: { service_year: days } });
			assert.equal(absent(31), 12);
			assert.equal(absent(32), 0);
			assert.equal(absent(27, { days_per_week: 5 }), 0);
			assert.equal(absent(26, { days_per_week: 5 }), 12);
			assert.deepEqual(
				[5, 12, 24, 59, 60].map((months) => entitled(annual, months)),
				[3, 8, 12, 12, 16]
			);
			// Part-time (Employment (Part-Time Employees) Regulations 2010 reg.7(1)): 6 / 8 / 11 days.
			assert.deepEqual(
				[6, 12, 24, 60].map((months) =>
					entitled(annual, months, {}, { terms: { employment_type: 'PART_TIME' } })
				),
				[3, 6, 8, 11]
			);
		}
	});
	it('round 7: EA coverage above RM4,000, pay bases and the s.60I ordinary rate of pay', () => {
		for (const version of versions) {
			const ot = (terms: Row) => line(version, 'OVERTIME', payslipContext({ terms }));
			// First Schedule para 1A: a non-manual employee above RM4,000 has no statutory overtime; para 2 keeps it
			// for manual labour, vehicle and vessel work whatever the pay; a contract may grant it; never a domestic.
			const office = { base_salary: 5000, monthly_wage: 5000, statutory_work_category: '' };
			assert.equal(ot(office), 0, version);
			assert.equal(
				ot({ ...office, facts: { overtime_by_contract: true } }),
				round2(10 * 1.5 * (5000 / 26 / 8))
			);
			assert.equal(
				ot({ ...office, statutory_work_category: 'VEHICLE_OPERATOR' }),
				round2(10 * 1.5 * (5000 / 26 / 8))
			);
			assert.equal(
				ot({ ...office, base_salary: 4000, monthly_wage: 4000 }),
				round2(10 * 1.5 * (4000 / 26 / 8))
			);
			assert.equal(ot({ employment_type: 'DOMESTIC' }), 0);
			for (const code of ['HOLIDAY_WORK', 'REST_DAY_WORK', 'HOLIDAY_OVERTIME', 'REST_DAY_OVERTIME'])
				assert.equal(line(version, code, payslipContext({ terms: office })), 0, code);
			// A daily rate (s.60I(1C)): BASIC is the WORK days worked × the rate; the ordinary rate is the contract day
			// without a preceding period, else that period's wages less rest-day work ÷ its days worked.
			const daily = { base_salary: 100, monthly_wage: 2600, facts: { pay_basis: 'DAILY' } };
			const week = [
				workDay('2026-02-02'),
				workDay('2026-02-03', { worked_hours: 10, overtime_hours: 2 }),
				workDay('2026-02-04'),
				// A planned 0-hour rest day's hours are all derived overtime.
				workDay('2026-02-07', {
					day_type: 'REST',
					scheduled_hours: 0,
					worked_hours: 3,
					overtime_hours: 3
				}),
				workDay('2026-02-08', {
					day_type: 'REST',
					scheduled_hours: 0,
					worked_hours: 6,
					overtime_hours: 6
				}),
				workDay('2026-02-10', { holiday_kind: 'PUBLIC_HOLIDAY', worked: false, worked_hours: 0 })
			];
			const base = payslipContext({ terms: daily });
			const day = (overrides: Row = {}, terms: Row = daily) =>
				payslipContext({ terms }, { work: { ...base.work, days: week }, ...overrides });
			assert.equal(line(version, 'BASIC', day()), 300);
			// s.60(3)(a): up to half the normal hours one day's wages, more two days'.
			assert.equal(line(version, 'REST_DAY_WORK', day()), 300);
			assert.equal(line(version, 'OVERTIME', day()), round2(2 * 1.5 * (100 / 8)));
			assert.equal(line(version, 'NO_PAY_LEAVE', day()), 0);
			// s.60D(1): an unworked holiday is paid at the ordinary rate; s.60E/60F: paid leave the same.
			assert.equal(line(version, 'HOLIDAY_PAY', day()), 100);
			const leave = { rows: [leaveRow({ code: 'ANNUAL_LEAVE', days: 2 })] };
			assert.equal(line(version, 'LEAVE_PAY', day({ leave })), 200);
			assert.equal(line(version, 'LEAVE_PAY', payslipContext()), 0);
			const previous = {
				gross: 2860,
				BASIC: 2600,
				REST_DAY_WORK: 200,
				OVERTIME: 60,
				base_salary: 100
			};
			const earned = { month: {}, year: {}, previous_month: previous, months: [] };
			assert.equal(line(version, 'ENCASHMENT', day({ earned })), round2(2660 / 26));
			// s.60D(2): absent without consent the day before — the holiday is not paid (daily) or abated (monthly).
			const absent = {
				rows: [leaveRow({ code: 'ABSENCE', from: '2026-02-09', to: '2026-02-09', is_npl: true })]
			};
			assert.equal(line(version, 'HOLIDAY_PAY', day({ leave: absent })), 0);
			const monthlyDays = payslipContext({}, { work: { ...base.work, days: week }, leave: absent });
			assert.equal(line(version, 'HOLIDAY_ADJACENT_ABSENCE', monthlyDays), round2(3000 / 26));
			assert.equal(
				line(
					version,
					'HOLIDAY_ADJACENT_ABSENCE',
					payslipContext({}, { work: { ...base.work, days: week } })
				),
				0
			);
			// An hourly rate: the normal hours worked × the rate; the hourly rate is the contract rate.
			const hourly = { base_salary: 10, monthly_wage: 1800, facts: { pay_basis: 'HOURLY' } };
			assert.equal(line(version, 'BASIC', day({}, hourly)), 240);
			assert.equal(line(version, 'OVERTIME', day({}, hourly)), 30);
			// A weekly rate: × 52 ÷ 12 a month; the ordinary rate ÷ 6 (s.60I(1B)).
			const weekly = { base_salary: 700, monthly_wage: 3033.33, facts: { pay_basis: 'WEEKLY' } };
			assert.equal(
				line(version, 'BASIC', payslipContext({ terms: weekly })),
				round2((700 * 52) / 12)
			);
			assert.equal(line(version, 'ENCASHMENT', payslipContext({ terms: weekly })), round2(700 / 6));
			// Piece rates (s.60(3)(d), 60A(3)(a), 60D(3)(a)(ii)): ×1 on a working day, ×2 on a rest day, ×1.5 overtime pieces.
			const piece = { base_salary: 2, monthly_wage: 1700, facts: { pay_basis: 'PIECE' } };
			const pieces = [
				workDay('2026-02-02', { facts: { piece_units: 50, overtime_units: 10 } }),
				workDay('2026-02-07', { day_type: 'REST', facts: { piece_units: 30 } })
			];
			const piecework = payslipContext({ terms: piece }, { work: { ...base.work, days: pieces } });
			assert.equal(line(version, 'PIECE_PAY', piecework), 100 + 120 + 30);
			assert.equal(line(version, 'BASIC', piecework), 0);
			assert.equal(line(version, 'OVERTIME', piecework), 0);
			assert.equal(line(version, 'PIECE_PAY', payslipContext()), 0);
			// Part-time (Regulations 2010): 5 normal hours (RM10/h, ORP RM50); overtime to a full-timer's 8 hours at 1×,
			// then 1.5× (reg.5); a rest day worked 2 days' wages (reg.9(2)), its extra hours 1.5× / 2× (reg.9(3));
			// holiday extra hours 2× / 3× (reg.6(6)).
			const part = {
				base_salary: 10,
				monthly_wage: 1000,
				employment_type: 'PART_TIME',
				facts: { pay_basis: 'HOURLY', normal_hours_per_day: 5 }
			};
			const shifts = [
				workDay('2026-02-02', {
					scheduled_hours: 5,
					worked_hours: 10,
					overtime_hours: 5,
					incentive_hours: 5,
					payable_incentive_hours: 5
				}),
				// A planned 0-hour rest day: all 9 hours are derived overtime, 4 of them beyond the 5 normal hours.
				workDay('2026-02-07', {
					day_type: 'REST',
					scheduled_hours: 0,
					worked_hours: 9,
					overtime_hours: 9
				}),
				workDay('2026-02-10', {
					holiday_kind: 'PUBLIC_HOLIDAY',
					scheduled_hours: 5,
					worked_hours: 9,
					overtime_hours: 4
				})
			];
			const pt = payslipContext({ terms: part }, { work: { ...base.work, days: shifts } });
			assert.equal(line(version, 'OVERTIME', pt), 3 * 10 + 2 * 15);
			assert.equal(line(version, 'INCENTIVE', pt), 0);
			const longerActual = payslipContext(
				{ terms: part },
				{
					work: { ...base.work, days: shifts.map((day) => ({ ...day, worked_hours: 20 })) }
				}
			);
			assert.equal(line(version, 'OVERTIME', longerActual), line(version, 'OVERTIME', pt));
			assert.equal(line(version, 'REST_DAY_WORK', pt), 2 * 50);
			assert.equal(line(version, 'REST_DAY_OVERTIME', pt), 3 * 15 + 1 * 20);
			assert.equal(line(version, 'HOLIDAY_OVERTIME', pt), 3 * 20 + 1 * 30);
			// Without agreed hours a part-timer's day is 70% of a full-timer's (reg.4(2)): 5.6 of 8.
			const unset = payslipContext(
				{ terms: { ...part, facts: { pay_basis: 'HOURLY' } } },
				{ work: { ...base.work, days: [fixturePresent(shifts[0])] } }
			);
			assert.equal(line(version, 'OVERTIME', unset), round2(2.4 * 10 + 2.6 * 15));
		}
	});
	it('round 7: termination and lay-off benefits (reg.6), notice indemnity (ss.12–13), advances (s.22), catalogue routing', () => {
		for (const version of versions) {
			const adhoc = (code: string) => byCode(version, 'adhoc_catalog', code);
			const priced = (code: string, input: Subject, earned: Row = {}, amount = 100) => {
				const row = adhoc(code);
				const context = {
					...payslipContext(input),
					earned: { month: {}, year: {}, previous_month: {}, months: [], ...earned },
					entry: { ...admitContext().entry, amount }
				};
				if (
					evaluateConfigured(fixtureString(String(row.eligibility)), fixtureContext(context)) !==
					true
				)
					return null;
				return round2(
					Number(
						evaluateConfigured(
							fixtureString(String(fixturePresent(fixtureValue11(row.bands)[0]).amount)),
							fixtureContext(context)
						)
					)
				);
			};
			const months = Array.from({ length: 12 }, (_, index) => ({
				month: `2025-${index + 1}`,
				gross: 3120
			}));
			// reg.6(2) / JTKSM "12 Months/365 days' salary": a day's wages = RM37,440 ÷ 365 = RM102.58.
			// 2½ years: 15 days' wages a year × 2.5 = RM3,846.58.
			const leaver = { service_months: 30, exit_date: '2026-02-28', exit_ground: 'RETRENCHMENT' };
			assert.equal(priced('TERMINATION_BENEFIT', leaver, { months }), 3846.58, version);
			assert.equal(priced('TERMINATION_BENEFIT', leaver, { months }, 9000), 9000);
			// Without history: terms.monthly_wage × 12 ÷ 365 (RM3,000 → RM98.63 × 15 × 2.5 = RM3,698.63).
			assert.equal(priced('TERMINATION_BENEFIT', leaver), 3698.63);
			// 6 years: 20 days × 6 = RM12,309.04; 18 months: 10 days × 1.5 = RM1,538.63.
			assert.equal(
				priced('TERMINATION_BENEFIT', { ...leaver, service_months: 72 }, { months }),
				12309.04
			);
			assert.equal(
				priced('TERMINATION_BENEFIT', { ...leaver, service_months: 18 }, { months }),
				1538.63
			);
			// reg.3–4: twelve months' service; not on retirement, misconduct after inquiry or a plain resignation.
			assert.equal(priced('TERMINATION_BENEFIT', { ...leaver, service_months: 11 }), null);
			assert.equal(priced('TERMINATION_BENEFIT', { ...leaver, exit_ground: 'RETIREMENT' }), null);
			assert.equal(priced('TERMINATION_BENEFIT', { ...leaver, exit_ground: 'RESIGNATION' }), null);
			assert.notEqual(
				priced('TERMINATION_BENEFIT', {
					...leaver,
					exit_ground: 'RESIGNATION',
					exit_facts: { notice_exception: 'OTHER_PARTY_WILFUL_BREACH' }
				}),
				null
			);
			assert.equal(
				priced('TERMINATION_BENEFIT', {
					...leaver,
					exit_ground: 'DISMISSAL',
					exit_facts: { misconduct_dismissal: true }
				}),
				null
			);
			assert.equal(
				priced('TERMINATION_BENEFIT', {
					...leaver,
					terms: { base_salary: 6000, monthly_wage: 6000, statutory_work_category: '' }
				}),
				null
			);
			assert.deepEqual(adhoc('TERMINATION_BENEFIT').counts_toward, ['PCB.ADDITIONAL_NON_EPF']);
			assert.equal(priced('LAYOFF_BENEFIT', { service_months: 30 }, { months }), 3846.58);
			assert.equal(priced('LAYOFF_BENEFIT', { service_months: 6 }, { months }), null);
			assert.deepEqual(adhoc('LAYOFF_BENEFIT').counts_toward, ['PCB.ADDITIONAL_NON_EPF']);
			// s.12(2): 6 weeks at 2½ years; 28 days served from 1 February → 14 days × RM3,000 × 12 ÷ 365.
			const notice = (exit_facts: Row, terms: Row = {}) =>
				priced('NOTICE_IN_LIEU', {
					service_months: 30,
					exit_date: '2026-02-28',
					exit_ground: 'UNILATERAL',
					exit_facts,
					terms
				});
			const day = (3000 * 12) / 365;
			assert.equal(notice({ notice_given_on: '2026-02-01' }), round2(14 * day));
			assert.equal(
				notice({ notice_given_on: '2026-02-01' }, { facts: { contract_notice_weeks: 8 } }),
				round2(28 * day)
			);
			// A shorter written notice governs (s.12(2)) except on structural grounds (s.12(3)).
			assert.equal(
				notice({ notice_given_on: '2026-02-01' }, { facts: { contract_notice_weeks: 2 } }),
				100
			);
			assert.equal(
				notice(
					{ notice_given_on: '2026-02-01', notice_structural_ground: 'REDUNDANCY' },
					{ facts: { contract_notice_weeks: 2 } }
				),
				round2(14 * day)
			);
			assert.equal(notice({ notice_given_on: '2026-02-01', notice_waived_days: 14 }), 100);
			assert.equal(notice({ notice_termination_party: 'EMPLOYEE' }), null);
			// s.22: an advance above a month's wages only for the listed purposes.
			for (const row of rows(version, 'loan_catalog')) {
				const admits = (facts: Row) =>
					evaluateConfigured(
						fixtureString(String(row.eligibility)),
						fixtureContext(admitContext(facts))
					);
				assert.equal(admits({}), true, String(row.code));
				assert.equal(admits({ principal: 3000 }), true);
				assert.equal(admits({ principal: 5000 }), false);
				assert.equal(admits({ principal: 5000, advance_purpose: 'VEHICLE' }), true);
			}
			// s.24(4)(e): accommodation only at the written request.
			const rent = adhoc('ACCOMMODATION_RENT');
			assert.equal(
				evaluateConfigured(
					fixtureString(String(rent.qualifies_when)),
					fixtureContext(admitContext({ written_request: true }))
				),
				true
			);
			assert.equal(
				evaluateConfigured(
					fixtureString(String(rent.qualifies_when)),
					fixtureContext(admitContext({}))
				),
				false
			);
			// Routing: a fixed on-call allowance is ordinary; adjustments and arrears are EPF and HRD wages.
			const oncall = fixtureValue16(byCode(version, 'allowance_catalog', 'ONCALL').counts_toward);
			assert.ok(oncall.includes('PCB.ORDINARY') && oncall.includes('EPF.ORDINARY'));
			assert.ok(!oncall.some((target) => target.endsWith('.ADDITIONAL')));
			assert.ok(fixtureValue16(adhoc('ADJ').counts_toward).includes('HRDF'));
			for (const target of ['EPF.ADDITIONAL', 'HRDF', 'PCB.ADDITIONAL'])
				assert.ok(
					fixtureValue16(adhoc('BACKPAY_ADD_WAGES').counts_toward).includes(target),
					target
				);
			const task = (terms: Row) =>
				evaluateConfigured(
					fixtureString(String(adhoc('TASK_MONTHLY_WAGE').eligibility)),
					fixtureContext(admitContext({}, { terms }))
				);
			assert.equal(task({ statutory_work_category: 'TASK_BASIS' }), true);
			assert.equal(task({ facts: { pay_basis: 'PIECE' } }), true);
			assert.equal(task({}), false);
		}
	});
	it('round 7: MTD exemptions, EIS MyKAS cover, EPF elected and contractual rates', () => {
		for (const version of versions) {
			const mtd = (
				parts: {
					[part: string]: number;
				},
				input: Subject = {}
			) => statutory(version, 'PCB', pcb(parts), { day: '2026-01-15', ...input })?.employee;
			// Official travel up to RM6,000 a year leaves MTD remuneration (Specification 2026 E(9)).
			const travel = [{ code: 'TRAVEL_OFFICIAL', amount: 7000 }];
			assert.equal(
				mtd({ ordinary: 5000, non_epf: 7000 }, { lines: travel }),
				mtd({ ordinary: 5000, non_epf: 1000 }),
				version
			);
			// …except for an employee who controls the employer.
			assert.equal(
				mtd(
					{ ordinary: 5000, non_epf: 7000 },
					{ lines: travel, facts: { controls_employer: true } }
				),
				mtd({ ordinary: 5000, non_epf: 7000 })
			);
			// The cap is the year's: RM5,000 already paid leaves RM1,000.
			assert.equal(
				mtd(
					{ ordinary: 5000, non_epf: 2000 },
					{
						lines: [{ code: 'TRAVEL_OFFICIAL', amount: 2000 }],
						earned: { year: { TRAVEL_OFFICIAL: 5000 } }
					}
				),
				mtd({ ordinary: 5000, non_epf: 1000 })
			);
			// Compensation for loss of employment: RM10,000 a completed year (Sch.6 para 15) — two years at 30 months.
			const benefit = [{ code: 'TERMINATION_BENEFIT', amount: 25000 }];
			assert.equal(
				mtd({ ordinary: 5000, additional_non_epf: 25000 }, { lines: benefit }),
				mtd({ ordinary: 5000, additional_non_epf: 5000 })
			);
			// Long-service award above ten years, RM2,000 a year; not at 30 months.
			const award = [{ code: 'LONG_SERVICE_AWARD', amount: 3000 }];
			assert.equal(
				mtd({ ordinary: 5000, additional_non_epf: 3000 }, { lines: award, service_months: 121 }),
				mtd({ ordinary: 5000, additional_non_epf: 1000 }, { service_months: 121 })
			);
			assert.equal(
				mtd({ ordinary: 5000, additional_non_epf: 3000 }, { lines: award }),
				mtd({ ordinary: 5000, additional_non_epf: 3000 })
			);
			// Child care allowance up to RM3,000 is exempt, yet stays EPF wages for the relief.
			const care = fixturePresent(
				mtd({ ordinary: 5300 }, { lines: [{ code: 'CHILDCARE_ALLOWANCE', amount: 300 }] })
			);
			assert.ok(care < fixturePresent(mtd({ ordinary: 5300 })));
			// Sch.6 paras 21–22: a non-resident employed not more than 60 days in the year who leaves within it.
			const short = {
				age: 40,
				residency_status: 'FOREIGNER',
				start_date: '2026-01-05',
				exit_date: '2026-01-20'
			};
			assert.equal(mtd({ ordinary: 10000 }, short), undefined);
			assert.equal(mtd({ ordinary: 10000 }, { ...short, exit_date: '' }), 3000);
			// A planned end recorded at hire counts from the first slip: 5 January – 28 February is 55 days, exempt in
			// January already; to 15 March (70 days) it is not. No end recorded: withheld (the 60 days cannot be known).
			assert.equal(mtd({ ordinary: 10000 }, { ...short, exit_date: '2026-02-28' }), undefined);
			assert.equal(mtd({ ordinary: 10000 }, { ...short, exit_date: '2026-03-15' }), 3000);
			// EIS: a resident non-citizen with MyKAS is covered (Act 800 First Schedule para 10).
			const citizen = statutory(version, 'EIS', 3000);
			assert.deepEqual(
				statutory(version, 'EIS', 3000, {
					residency_status: 'FOREIGNER',
					elections: { mykas_resident: true }
				}),
				citizen
			);
			assert.notDeepEqual(
				statutory(version, 'EIS', 3000, { residency_status: 'FOREIGNER' }),
				citizen
			);
			// EPF: an elected employee share and a contractual employer share above the Third Schedule, never below.
			const epf = fixturePresent(statutory(version, 'EPF', 3000));
			assert.equal(
				statutory(version, 'EPF', 3000, { elections: { employee_rate: 0.15 } })?.employee,
				450
			);
			assert.equal(
				statutory(version, 'EPF', 3000, { elections: { employee_rate: 0.05 } })?.employee,
				epf.employee
			);
			assert.equal(
				statutory(version, 'EPF', 3000, {
					terms: { facts: { contractual_epf_employer_rate: 0.16 } }
				})?.employer,
				480
			);
			// s.2: an industrial-training student without a contract of service is not an employee.
			const student = statutory(version, 'EPF', 3000, {
				terms: { facts: { industrial_training_student: true } }
			});
			assert.equal(student?.employee ?? 0, 0);
		}
	});
	it('round 7: hours, rest day, minimum wage by basis, wage period and payment method validations', () => {
		for (const version of versions) {
			const set = rows(version, 'rule_set');
			const minimum = fixtureValue5(
				fixturePresent(set.find((row) => row.code === 'minimum_wage')).rules
			);
			const check = (code: string, site: string, kind: string) => {
				const row = set.find((item) => item.code === code);
				assert.ok(row && row.family === 'VALIDATIONS', `${version} ${code}`);
				const rules = fixtureValue0(row.rules);
				assert.deepEqual([rules.site, rules.kind], [site, kind], code);
				return (context: Row) =>
					evaluateConfigured(fixtureString(rules.when), fixtureContext(context));
			};
			const days = (list: Row[], terms: Row = {}) =>
				payslipContext({ terms }, { work: { ...payslipContext().work, days: list } });
			const at = (start: string, end: string) => ({
				start: `2026-02-03T${start}`,
				end: `2026-02-03T${end}`
			});
			const cap = check('DAILY_HOURS_CAP', 'payslip', 'warn');
			assert.equal(cap(days([workDay('2026-02-03', { worked_hours: 12.5 })])), true);
			assert.equal(cap(days([workDay('2026-02-03', { worked_hours: 12 })])), false);
			const breaks = check('CONTINUOUS_HOURS', 'payslip', 'warn');
			assert.equal(
				breaks(days([workDay('2026-02-03', { intervals: [at('08:00', '14:00')] })])),
				true
			);
			assert.equal(
				breaks(
					days([workDay('2026-02-03', { intervals: [at('08:00', '12:00'), at('12:30', '17:00')] })])
				),
				false
			);
			const spread = check('SPREAD_OVER', 'payslip', 'warn');
			assert.equal(
				spread(
					days([workDay('2026-02-03', { intervals: [at('08:00', '12:00'), at('15:00', '19:30')] })])
				),
				true
			);
			assert.equal(
				spread(
					days([workDay('2026-02-03', { intervals: [at('08:00', '12:00'), at('13:00', '17:00')] })])
				),
				false
			);
			const daily = check('NORMAL_HOURS_DAY', 'payslip', 'warn');
			assert.equal(daily(days([workDay('2026-02-03', { scheduled_hours: 10 })])), true);
			assert.equal(daily(days([workDay('2026-02-03', { scheduled_hours: 9 })])), false);
			assert.equal(
				daily(
					days([workDay('2026-02-03', { scheduled_hours: 10 })], { facts: { shift_work: true } })
				),
				false
			);
			const weekly = check('NORMAL_HOURS_WEEK', 'payslip', 'warn');
			const plan = (hours: number, work: number) =>
				days(
					Array.from({ length: 7 }, (_, index) =>
						workDay(
							`2026-02-0${index + 2}`,
							index < work ? { scheduled_hours: hours } : { day_type: 'REST', scheduled_hours: 0 }
						)
					)
				);
			assert.equal(weekly(plan(8, 6)), true);
			assert.equal(weekly(plan(9, 5)), false);
			const rest = check('WEEKLY_REST_DAY', 'payslip', 'warn');
			assert.equal(rest(plan(8, 7)), true);
			assert.equal(rest(plan(8, 6)), false);
			const moved = check('HOLIDAY_ON_REST_DAY', 'payslip', 'warn');
			assert.equal(
				moved(days([workDay('2026-02-08', { day_type: 'REST', holiday_kind: 'PUBLIC_HOLIDAY' })])),
				true
			);
			assert.equal(moved(payslipContext()), false);
			const contract = (term: Row, company: Row = {}) => {
				const held = subject({ terms: term });
				return {
					...held,
					company: { ...held.company, ...company },
					rules: { minimum_wage: minimum },
					term: held.terms
				};
			};
			const day = check('MINIMUM_WAGE_DAILY', 'contract', 'refuse');
			const rate = (base_salary: number, days_per_week?: number) =>
				contract({
					base_salary,
					facts: { pay_basis: 'DAILY', ...(days_per_week == null ? {} : { days_per_week }) }
				});
			assert.equal(day(rate(65)), true);
			assert.equal(day(rate(65.38)), false);
			assert.equal(day(rate(78.45, 5)), true);
			assert.equal(day(rate(98.08, 4)), false);
			assert.equal(day(contract({ base_salary: 65 })), false);
			const hour = check('MINIMUM_WAGE_HOURLY', 'contract', 'refuse');
			assert.equal(hour(contract({ base_salary: 8.71, facts: { pay_basis: 'HOURLY' } })), true);
			assert.equal(hour(contract({ base_salary: 8.72, facts: { pay_basis: 'HOURLY' } })), false);
			// MWO 2024 para 5(1): the monthly floor binds a MONTHLY basis only — a per-unit rate is checked by its own row.
			const month = check('MINIMUM_WAGE_MONTHLY', 'contract', 'refuse');
			for (const [pay_basis, base_salary] of [
				['DAILY', 70],
				['HOURLY', 10],
				['WEEKLY', 500],
				['PIECE', 2]
			] as const)
				assert.equal(month(contract({ base_salary, facts: { pay_basis } })), false, pay_basis);
			assert.equal(month(contract({ base_salary: 1699, facts: { pay_basis: 'MONTHLY' } })), true);
			assert.equal(month(contract({ base_salary: 1699 })), true);
			// No weekly rate in the Order: the daily rate × the working days (6 × 65.38 = RM392.28).
			const week = check('MINIMUM_WAGE_WEEKLY', 'contract', 'refuse');
			const weekRate = (base_salary: number, days_per_week?: number) =>
				contract({
					base_salary,
					facts: { pay_basis: 'WEEKLY', ...(days_per_week == null ? {} : { days_per_week }) }
				});
			assert.equal(week(weekRate(392.27)), true);
			assert.equal(week(weekRate(392.28)), false);
			assert.equal(week(weekRate(392.29, 5)), true);
			assert.equal(week(weekRate(392.3, 5)), false);
			assert.equal(week(weekRate(392.31, 4)), true);
			assert.equal(week(weekRate(392.32, 4)), false);
			assert.equal(week(contract({ base_salary: 300 })), false);
			// A part-timer is held to RM8.72 an hour on every basis; an hourly rate is compared directly.
			const part = check('MINIMUM_WAGE_HOURLY_PART_TIME', 'contract', 'refuse');
			const partTimer = (base_salary: number, facts: Row) =>
				contract({ base_salary, employment_type: 'PART_TIME', facts });
			assert.equal(
				part(partTimer(10, { pay_basis: 'HOURLY', contract_hours_per_week: 25 })),
				false
			);
			assert.equal(
				hour(partTimer(10, { pay_basis: 'HOURLY', contract_hours_per_week: 25 })),
				false
			);
			assert.equal(
				hour(partTimer(8.5, { pay_basis: 'HOURLY', contract_hours_per_week: 25 })),
				true
			);
			// Weekly: RM218 ÷ 25 h = RM8.72; RM217.99 below.
			assert.equal(
				part(partTimer(218, { pay_basis: 'WEEKLY', contract_hours_per_week: 25 })),
				false
			);
			assert.equal(
				part(partTimer(217.99, { pay_basis: 'WEEKLY', contract_hours_per_week: 25 })),
				true
			);
			// Daily: RM40 for 4 normal hours = RM10 an hour, lawful though below the RM65.38 full-time day.
			const fourHours = partTimer(40, { pay_basis: 'DAILY', normal_hours_per_day: 4 });
			assert.equal(part(fourHours), false);
			assert.equal(day(fourHours), false);
			assert.equal(part(partTimer(34, { pay_basis: 'DAILY', normal_hours_per_day: 4 })), true);
			assert.equal(month(partTimer(1000, {})), false);
			const piece = check('MINIMUM_WAGE_PIECE', 'payslip', 'hold');
			const slip = (gross: number, input: Subject = {}, part: Row = {}, earlier = 0) => ({
				...payslipContext({ terms: { base_salary: 2, facts: { pay_basis: 'PIECE' } }, ...input }),
				rules: { minimum_wage: minimum },
				period: {
					...payslipContext().period,
					month_from: '2026-02-01',
					month_to: '2026-02-28',
					part: 1,
					parts: 1,
					...part
				},
				earned: {
					month: earlier === 0 ? {} : { gross: earlier },
					year: {},
					previous_month: {},
					months: []
				},
				payslip: { gross, net: gross, total_deductions: 0, lines: {} }
			});
			assert.equal(piece(slip(1600)), true);
			assert.equal(piece(slip(1700)), false);
			// A month the employment does not cover whole (joined on the 19th) is not compared.
			assert.equal(piece(slip(1000, { start_date: '2026-02-19' })), false);
			// Semi-monthly: the first half is never compared; the second judges the month to date.
			const first = {
				from: '2026-02-01',
				to: '2026-02-15',
				days: 15,
				paid_days: 15,
				part: 1,
				parts: 2
			};
			const second = {
				from: '2026-02-16',
				to: '2026-02-28',
				days: 13,
				paid_days: 13,
				part: 2,
				parts: 2
			};
			assert.equal(piece(slip(850, {}, first)), false);
			assert.equal(piece(slip(850, {}, second, 850)), false);
			assert.equal(piece(slip(800, {}, second, 850)), true);
			const period = check('WAGE_PERIOD', 'contract', 'refuse');
			assert.equal(period(contract({}, { pay_frequency: 'INTEGER_MONTHS' })), true);
			assert.equal(period(contract({})), false);
			const method = check('WAGE_PAYMENT_METHOD', 'contract', 'refuse');
			assert.equal(method(contract({ facts: { wage_payment_method: 'CASH' } })), true);
			assert.equal(
				method(
					contract({
						facts: {
							wage_payment_method: 'CASH',
							wage_payment_written_request: true,
							wage_payment_dg_approval: 'JTK/1'
						}
					})
				),
				false
			);
			assert.equal(method(contract({ facts: { wage_payment_method: 'BANK' } })), false);
			assert.equal(method(contract({})), false);
			check('LABOUR_ORDINANCE_TERRITORY', 'contract', 'refuse');
		}
	});
	it('round 7: protection reviews, records, notices, renewals and the CP22A death deadline', () => {
		for (const version of versions) {
			const rulesOf = (code: string) => {
				const row = rows(version, 'rule_set').find((item) => item.code === code);
				assert.ok(row && row.family === 'TASKS', `${version} ${code}`);
				return fixtureValue5(row.rules);
			};
			const run = (code: string, key: keyof Duty | 'when', context: Row) =>
				evaluateConfigured(
					fixtureString(String(rulesOf(code)[key] ?? 'true')),
					fixtureContext(context)
				);
			const exit = (
				exit_ground: string,
				exit_facts: Row = {},
				terms: Row[] = [{ residency_status: 'CITIZEN' }]
			) => ({
				exit_on: '2026-10-31',
				today: '2026-10-31',
				contract: {
					id: 'c1',
					effective_range: { from: '2020-01-01', to: '2026-10-31' },
					exit_ground,
					exit_facts,
					facts: { contract_terms: terms }
				},
				employee: { date_of_birth: '1990-01-01' }
			});
			// ITA s.83(3): on a death, not more than thirty days after the employer is informed.
			assert.equal(
				run(
					'CP22A_CESSATION_AND_WITHHOLDING',
					'due',
					exit('DEATH', { death_informed_on: '2026-11-05' })
				),
				'2026-12-05'
			);
			assert.equal(run('CP22A_CESSATION_AND_WITHHOLDING', 'due', exit('DEATH')), '2026-11-30');
			// EA s.41A: notice to a pregnant employee except for misconduct, wilful breach or closure.
			const pregnant = { pregnant_or_pregnancy_illness: true };
			assert.equal(
				run('MATERNITY_PROTECTION_REVIEW', 'applies_when', exit('UNILATERAL', pregnant)),
				true
			);
			assert.equal(
				run(
					'MATERNITY_PROTECTION_REVIEW',
					'applies_when',
					exit('DISMISSAL', { ...pregnant, misconduct_dismissal: true })
				),
				false
			);
			assert.equal(run('MATERNITY_PROTECTION_REVIEW', 'applies_when', exit('UNILATERAL')), false);
			// Act 753 s.4: minimum retirement age 60.
			assert.equal(run('RETIREMENT_AGE_REVIEW', 'applies_when', exit('RETIREMENT')), true);
			assert.equal(
				run('RETIREMENT_AGE_REVIEW', 'applies_when', {
					...exit('RETIREMENT'),
					employee: { date_of_birth: '1960-01-01' }
				}),
				false
			);
			// EA s.60N: foreign employees first.
			assert.equal(run('RETRENCHMENT_FOREIGN_FIRST', 'applies_when', exit('RETRENCHMENT')), true);
			assert.equal(
				run(
					'RETRENCHMENT_FOREIGN_FIRST',
					'applies_when',
					exit('RETRENCHMENT', {}, [{ residency_status: 'FOREIGNER' }])
				),
				false
			);
			// EA s.60Q: reply within sixty days of the application.
			const applied = exit('', {}, [{ facts: { flexible_working_applied_on: '2026-10-01' } }]);
			assert.equal(run('FLEXIBLE_WORKING_REPLY', 'when', applied), true);
			assert.equal(run('FLEXIBLE_WORKING_REPLY', 'due', applied), '2026-11-30');
			assert.equal(run('FLEXIBLE_WORKING_REPLY', 'when', exit('')), false);
			// Act 446: housing needs the certificate.
			const housed = {
				...exit('', {}, [{ facts: { employer_provided_accommodation: true } }]),
				hired_on: '2026-10-15'
			};
			assert.equal(run('WORKERS_ACCOMMODATION_CERTIFICATE', 'applies_when', housed), true);
			assert.equal(run('WORKERS_ACCOMMODATION_CERTIFICATE', 'applies_when', exit('')), false);
			assert.equal(run('WORKERS_ACCOMMODATION_CERTIFICATE', 'due', housed), '2026-10-15');
			// VP(TE): renew from three months before expiry, raised by the daily tick on that day.
			const pass = (today: string) => ({
				...exit('', {}, [{ facts: { work_pass_valid_until: '2027-01-18' } }]),
				today
			});
			assert.equal(run('WORK_PASS_RENEWAL', 'when', pass('2026-10-20')), true);
			assert.equal(run('WORK_PASS_RENEWAL', 'when', pass('2026-10-21')), false);
			assert.equal(run('WORK_PASS_RENEWAL', 'due', pass('2026-10-20')), '2027-01-18');
			assert.deepEqual(rulesOf('WORK_PASS_RENEWAL').trigger, {
				collection: 'calendar',
				event: 'daily'
			});
			// s.81H on the entity; s.61 register and the wage statement with each run; ITA s.82 in January.
			assert.deepEqual(rulesOf('SEXUAL_HARASSMENT_NOTICE').trigger, {
				collection: 'entity',
				event: 'created'
			});
			const month = { period: { key: '2026-10', from: '2026-10-01', to: '2026-10-31' } };
			assert.equal(run('EMPLOYEE_REGISTER', 'due', month), '2026-10-31');
			assert.equal(run('PAYSLIP_ISSUE', 'due', month), '2026-11-07');
			assert.deepEqual(rulesOf('TAX_RECORDS_RETENTION').months, ['01']);
			// Act 4: any employment injury entry, whatever the class.
			assert.equal(
				run('SOCSO_ACCIDENT_REPORT', 'when', { row: { facts: { work_injury: true } } }),
				true
			);
		}
	});
	it('round 7: each version carries the gazetted federal holidays of its range, unpublished, with state limits', () => {
		const states = [
			'KUALA_LUMPUR',
			'LABUAN',
			'PUTRAJAYA',
			'JOHOR',
			'KEDAH',
			'KELANTAN',
			'MELAKA',
			'NEGERI_SEMBILAN',
			'PAHANG',
			'PERAK',
			'PERLIS',
			'PULAU_PINANG',
			'SABAH',
			'SARAWAK',
			'SELANGOR',
			'TERENGGANU'
		];
		const all: string[] = [];
		for (const version of versions) {
			const row = rows(version, 'rule_set').find((item) => item.code === 'public_holidays');
			assert.ok(row && row.family === 'PAYROLL', version);
			// Corrections retain the published calendar intact, including past and already announced future dates.
			for (const holiday of fixtureValue22(row.rules).holidays) {
				const date = String(holiday.date);
				assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
				assert.ok(date >= '2025-12-01' && date <= '2027-12-31', `${version} ${date}`);
				assert.equal(holiday.kind, 'PUBLIC_HOLIDAY');
				for (const region of fixtureValue16(holiday.regions ?? []))
					assert.ok(states.includes(region), region);
				all.push(date);
			}
		}
		for (const [correction, original] of [
			['version_9', 'version_5'],
			['version_10', 'version_6'],
			['version_11', 'version_7'],
			['version_12', 'version_8']
		] as const)
			assert.deepEqual(
				byCode(correction, 'rule_set', 'public_holidays').rules,
				byCode(original, 'rule_set', 'public_holidays').rules,
				`${correction} preserves the original published calendar`
			);
		// HKA 2025–2027: Christmas 2025, sixteen 2026 dates, fifteen 2027 dates; no calendar gazetted beyond.
		assert.equal(new Set(all).size, 31);
		for (const date of [
			'2025-12-25',
			'2026-02-17',
			'2026-05-01',
			'2026-08-31',
			'2026-09-16',
			'2027-03-10',
			'2027-12-25'
		])
			assert.ok(all.includes(date), date);
		const deepavali = fixturePresent(
			rows(at('2026-11-08'), 'rule_set').find((item) => item.code === 'public_holidays')
		);
		const regions = fixtureValue16(
			fixturePresent(
				fixtureValue22(deepavali.rules).holidays.find((holiday) => holiday.date === '2026-11-08')
			).regions
		);
		assert.ok(!regions.includes('SARAWAK') && regions.includes('SABAH'));
	});
	it('fix 2: PDPA ss.7/12A/12B, EA ss.57A–57B and 81B–81C, CP58 on exit, FOMEMA, compulsory holidays, EPF relief, Sabah and Sarawak', () => {
		for (const version of versions) {
			const settings = settingsOf(version);
			const ruleRows = rows(version, 'rule_set');
			const raise = (collection: string, event: string, row: Row, extra: Row = {}) =>
				raiseDuties({
					behaviours: fixturePresent(behavioursOf(settings.behaviours)),
					settings_id: settings.id,
					rows: ruleRows,
					collection,
					event,
					row: { company_id: 'c1', ...row },
					...extra
				});
			const codes = (writes: Row[]) => writes.map((write) => String(write.duty_code)).toSorted();
			const kinds = fixtureValue23(
				fixturePresent(ruleRows.find((row) => row.code === 'case_kinds')).rules
			).kinds.map((kind) => kind.code);
			assert.deepEqual(kinds, ['PERSONAL_DATA_BREACH', 'SEXUAL_HARASSMENT_COMPLAINT'], version);
			// PDPA s.12B + DBN Guideline 6.1: the Commissioner within 72 hours of the breach.
			const breach = {
				id: 'w1',
				kind: 'PERSONAL_DATA_BREACH',
				opened_on: '2026-10-20',
				closed_on: null
			};
			const opened = raise(
				'workplace_case',
				'created',
				{ ...breach, facts: {} },
				{ day: '2026-10-20' }
			);
			assert.deepEqual(codes(opened), ['PDPA_BREACH_COMMISSIONER_NOTICE'], version);
			assert.equal(fixturePresent(opened[0]).due_on, '2026-10-23');
			// s.12B(2) + Guideline 9.1: affected employees within 7 days of that notice, only on significant harm.
			const updated = (facts: Row, kind = 'PERSONAL_DATA_BREACH') =>
				raise(
					'workplace_case',
					'updated',
					{ ...breach, kind, facts, before: { facts: {} } },
					{ day: '2026-10-23' }
				);
			const harm = updated({ significant_harm: true, commissioner_notified_on: '2026-10-22' });
			assert.deepEqual(codes(harm), ['PDPA_BREACH_DATA_SUBJECT_NOTICE']);
			assert.equal(fixturePresent(harm[0]).due_on, '2026-10-29');
			assert.deepEqual(
				updated({ significant_harm: false, commissioner_notified_on: '2026-10-22' }),
				[]
			);
			assert.deepEqual(updated({ significant_harm: true }), []);
			// EA s.81B(2): inquire, or refuse in writing within thirty days of the complaint.
			const complaint = raise(
				'workplace_case',
				'created',
				{ ...breach, kind: 'SEXUAL_HARASSMENT_COMPLAINT', facts: {} },
				{ day: '2026-10-20' }
			);
			assert.deepEqual(codes(complaint), ['SEXUAL_HARASSMENT_INQUIRY']);
			assert.equal(fixturePresent(complaint[0]).due_on, '2026-11-19');
			// s.81D(2): the report of a directed inquiry within thirty days; s.81C: act on a proven finding.
			const directed = updated({ dg_directed_on: '2026-11-02' }, 'SEXUAL_HARASSMENT_COMPLAINT');
			assert.deepEqual(codes(directed), ['SEXUAL_HARASSMENT_DG_INQUIRY_REPORT']);
			assert.equal(fixturePresent(directed[0]).due_on, '2026-12-02');
			const proven = updated({ inquiry_outcome: 'PROVEN' }, 'SEXUAL_HARASSMENT_COMPLAINT');
			assert.deepEqual(codes(proven), ['SEXUAL_HARASSMENT_FINDING_ACTION']);
			assert.equal(fixturePresent(proven[0]).due_on, '2026-10-23');
			assert.deepEqual(
				updated({ inquiry_outcome: 'NOT_PROVEN' }, 'SEXUAL_HARASSMENT_COMPLAINT'),
				[]
			);
			// PDPA s.12A + DPO Guideline 4.2, 7.1: appoint and register within 21 days where in scope.
			const entity = (facts: Row, extra: Row = {}) =>
				codes(
					raise(
						'entity',
						'created',
						{ id: 'c1', effective_range: { from: '2026-10-15', to: null }, facts },
						{ reads: { company: [{ region: '', risk_class: '', facts }] }, ...extra }
					)
				).filter((code) => code.startsWith('PDPA_'));
			assert.deepEqual(entity({ pdpa_dpo_required: true }), ['PDPA_DPO_APPOINTMENT']);
			assert.deepEqual(entity({}), []);
			assert.deepEqual(entity({}, { headcount: 10001 }), ['PDPA_DPO_APPOINTMENT']);
			const dpo = fixtureValue5(
				fixturePresent(ruleRows.find((row) => row.code === 'PDPA_DPO_APPOINTMENT_UPDATE')).rules
			);
			const scoped = (before: Row, facts: Row) =>
				evaluateConfigured(
					fixtureString(String(dpo.when)),
					fixtureContext({ row: { facts, before: { facts: before } } })
				);
			assert.equal(scoped({}, { pdpa_dpo_required: true }), true);
			assert.equal(scoped({ pdpa_dpo_required: true }, { pdpa_dpo_required: true }), false);
			assert.equal(scoped({}, {}), false);
			assert.equal(
				evaluateConfigured(fixtureString(String(dpo.due)), fixtureContext({ today: '2026-10-15' })),
				'2026-11-05'
			);
			// Hire: the s.7 notice for everyone; s.57A and FOMEMA for a foreign domestic employee, 30 days.
			const hire = (term: Row) =>
				raise('employment_contract', 'created', {
					id: 'k1',
					employee_id: 'p1',
					effective_range: { from: '2026-10-15', to: null },
					exit_facts: null,
					facts: { contract_terms: [term] }
				});
			const local = hire({ residency_status: 'CITIZEN' });
			assert.ok(codes(local).includes('PDPA_PRIVACY_NOTICE'));
			assert.equal(
				fixturePresent(local.find((w) => w.duty_code === 'PDPA_PRIVACY_NOTICE')).due_on,
				'2026-10-15'
			);
			assert.ok(!codes(local).includes('FOREIGN_WORKER_MEDICAL_EXAMINATION'));
			const maid = hire({ residency_status: 'FOREIGNER', employment_type: 'DOMESTIC' });
			for (const code of [
				'FOREIGN_DOMESTIC_EMPLOYMENT_NOTICE',
				'FOREIGN_WORKER_MEDICAL_EXAMINATION'
			])
				assert.equal(maid.find((w) => w.duty_code === code)?.due_on, '2026-11-14', code);
			assert.ok(
				!codes(hire({ residency_status: 'FOREIGNER' })).includes(
					'FOREIGN_DOMESTIC_EMPLOYMENT_NOTICE'
				)
			);
			// ITA s.83A: an agent whose engagement ends in the year still gets the CP58 by 31 March next.
			const ended = (role: string, engagement = 'PAYEE') =>
				raise('employment_contract', 'updated', {
					id: 'k-x1',
					employee_id: 'x1',
					engagement,
					exit_ground: 'END_OF_CONTRACT',
					exit_facts: {},
					effective_range: { from: '2026-01-01', to: '2026-08-31' },
					facts: {
						contract_terms: [
							{
								effective_range: { from: '2026-01-01', to: '2026-08-31' },
								facts: { payee_role: role }
							}
						]
					}
				}).filter((write) => write.duty_code === 'CP58_AGENT_STATEMENT_ON_EXIT');
			const [cp58] = ended('AGENT');
			assert.equal(cp58?.due_on, '2027-03-31');
			assert.equal(cp58?.occurrence_key, 'CP58_AGENT_STATEMENT_ON_EXIT:c1:k-x1:2026');
			assert.deepEqual(ended('OTHER'), []);
			assert.deepEqual(ended('AGENT', 'EMPLOYEE'), []);
			// The renewal names its FOMEMA, SPIKPA and FWCS documents.
			assert.match(
				String(
					fixtureValue5(
						fixturePresent(ruleRows.find((row) => row.code === 'WORK_PASS_RENEWAL')).rules
					).description
				),
				/FOMEMA.*SPIKPA.*FWCS/
			);
			// EA s.60D(1)(a): the December run checks the published holidays hold the five compulsory ones.
			const compulsory = fixtureValue5(
				fixturePresent(ruleRows.find((row) => row.code === 'COMPULSORY_HOLIDAYS_CHECK')).rules
			);
			const named = [
				'Hari Kebangsaan',
				'Hari Pekerja',
				'Hari Malaysia',
				'Hari Keputeraan Rasmi Seri Paduka Baginda Yang di-Pertuan Agong'
			].map((name) => ({ date: '2027-05-01', name, kind: 'PUBLIC_HOLIDAY' }));
			assert.deepEqual(compulsory.months, ['12']);
			assert.equal(
				evaluateConfigured(
					fixtureString(String(compulsory.when)),
					fixtureContext({ holidays_named: named })
				),
				false
			);
			assert.equal(
				evaluateConfigured(
					fixtureString(String(compulsory.when)),
					fixtureContext({ holidays_named: named.slice(1) })
				),
				true
			);
			// Sabah and Sarawak are excluded from this lineage: refused, not priced under the Employment Act.
			const territory = fixtureValue5(
				fixturePresent(ruleRows.find((row) => row.code === 'LABOUR_ORDINANCE_TERRITORY')).rules
			);
			assert.equal(territory.kind, 'refuse');
			assert.equal(
				fixtureValue12(settings.entity_input_schema).properties.pdpa_dpo_required != null,
				true
			);
			// MTD Specification 2026 D: K is the EPF actually contributed. A December joiner (TP3: RM60,000 and
			// RM1,500 MTD before, no EPF) on RM2,500: 11% K 275 → P 53,225 → MTD 354.75; an elected 15% K 375
			// → P 53,125 → 1,500 + 3,125 × 11% − 1,500 = 343.75.
			const tp3 = { tp3_prior_remuneration: 60000, tp3_prior_epf: 0, tp3_prior_mtd: 1500 };
			const december = (all_elections: Row = {}) =>
				statutory(version, 'PCB', pcb({ ordinary: 2500 }), {
					day: '2026-12-15',
					elections: tp3,
					all_elections
				})?.employee;
			assert.equal(december(), 354.75, version);
			assert.equal(december({ EPF: { employee_rate: 0.15 } }), 343.75, version);
		}
		// The child-care allowance exemption (RM3,000 since YA2024) is in every version, December 2025 included.
		for (const version of versions)
			assert.ok(
				rows(version, 'allowance_catalog').some((row) => row.code === 'CHILDCARE_ALLOWANCE'),
				version
			);
		assert.doesNotMatch(String(settingsOf('version_2').change_summary), /from RM2,400/);
	});
	it("Act 350: hours and night work of children and young persons warn; a child's employment is flagged", () => {
		for (const version of versions) {
			const rules = (code: string) =>
				fixtureValue0(
					fixturePresent(rows(version, 'rule_set').find((row) => row.code === code)).rules
				);
			const hours = rules('YOUNG_WORKER_HOURS');
			assert.deepEqual([hours.site, hours.kind], ['payslip', 'warn'], version);
			const worked = (date_of_birth: string, fields: Row) =>
				evaluateConfigured(
					fixtureString(hours.when),
					fixtureContext({
						...payslipContext({ employee: { date_of_birth } }),
						work: { ...payslipContext().work, days: [workDay('2026-02-03', fields)] }
					})
				);
			const at = (start: string, end: string) => ({
				start: `2026-02-03T${start}`,
				end: `2026-02-03T${end}`
			});
			// Young person (16): 7 hours a day, 4 consecutive hours, not 8 pm – 6 am.
			const young = '2009-06-01';
			assert.equal(
				worked(young, { worked_hours: 7, intervals: [at('08:00', '12:00'), at('12:30', '15:30')] }),
				false
			);
			assert.equal(worked(young, { worked_hours: 7.5, intervals: [] }), true);
			assert.equal(worked(young, { worked_hours: 4.5, intervals: [at('08:00', '12:30')] }), true);
			assert.equal(worked(young, { worked_hours: 3, intervals: [at('18:00', '21:00')] }), true);
			// Child (14): 6 hours, 3 consecutive hours, not 8 pm – 7 am.
			const child = '2011-06-01';
			assert.equal(worked(child, { worked_hours: 6.5, intervals: [] }), true);
			assert.equal(worked(child, { worked_hours: 3.5, intervals: [at('09:00', '12:30')] }), true);
			assert.equal(worked(child, { worked_hours: 3, intervals: [at('06:00', '09:00')] }), true);
			assert.equal(worked(child, { worked_hours: 3, intervals: [at('09:00', '12:00')] }), false);
			// An adult is not limited; no birth date recorded is not read.
			assert.equal(
				worked('1990-01-01', { worked_hours: 12, intervals: [at('20:00', '23:00')] }),
				false
			);
			assert.equal(worked('', { worked_hours: 12, intervals: [] }), false);
			const child2 = rules('CHILD_EMPLOYMENT');
			assert.deepEqual([child2.site, child2.kind], ['contract', 'warn']);
			const hired = (date_of_birth: string) =>
				evaluateConfigured(
					fixtureString(child2.when),
					fixtureContext({
						...subject({ employee: { date_of_birth } }),
						day: '2026-02-01'
					})
				);
			assert.equal(hired('2011-06-01'), true);
			assert.equal(hired('2009-06-01'), false);
		}
	});
	it('round 7: the formerly SEEDED rows — EPF bonus band, sub-monthly parts, national service, termination routing, advances', () => {
		for (const version of versions) {
			// EPF Third Schedule: the employer stays at 13% where only additional wages lift the month over RM5,000.
			assert.equal(
				statutory(version, 'EPF', { ordinary: 4800, additional: 1000 })?.employer,
				754,
				version
			);
			assert.equal(statutory(version, 'EPF', { ordinary: 5100, additional: 1000 })?.employer, 732);
			// Sub-monthly settlement (EA s.18A): a whole month is the monthly amount ÷ the parts; a part month is the
			// part's days employed ÷ the MONTH's calendar days, the last part settling the month less the earlier parts.
			const halfPeriod = {
				...payslipContext().period,
				to: '2026-02-14',
				days: 14,
				paid_days: 14,
				parts: 2
			};
			const half = payslipContext({}, { period: halfPeriod });
			assert.equal(line(version, 'BASIC', half), 1500);
			// Joined 8 February: the first half's 7 days are 3,000 × 7 ÷ 28 = 750 (not 3,000 ÷ 2 × 7 ÷ 14 by chance:
			// the divisor is the month's 28 days)…
			const joiner = payslipContext(
				{ start_date: '2026-02-08' },
				{ period: { ...halfPeriod, paid_days: 7 } }
			);
			assert.equal(line(version, 'BASIC', joiner), 750);
			// …and the second half settles 3,000 × 21 ÷ 28 = 2,250 less the 750 paid.
			const second = payslipContext(
				{ start_date: '2026-02-08' },
				{
					period: { ...halfPeriod, from: '2026-02-15', to: '2026-02-28', part: 2 },
					earned: { month: { BASIC: 750 }, year: {}, previous_month: {}, months: [] }
				}
			);
			assert.equal(line(version, 'BASIC', second), 1500);
			// s.18A(d): national service days are unpaid at the incomplete-month rate.
			assert.equal(byCode(version, 'leave_catalog', 'NATIONAL_SERVICE_LEAVE').is_npl, true);
			const service = payslipContext(
				{},
				{ leave: { rows: [leaveRow({ code: 'NATIONAL_SERVICE_LEAVE', days: 5, is_npl: true })] } }
			);
			assert.equal(line(version, 'NO_PAY_LEAVE', service), round2((3000 / 28) * 5));
			// Termination, lay-off and notice money are not EPF, SOCSO, EIS, SKBBK or HRD wages; all reach MTD.
			for (const code of ['TERMINATION_BENEFIT', 'LAYOFF_BENEFIT', 'NOTICE_IN_LIEU']) {
				const counts = fixtureValue16(byCode(version, 'adhoc_catalog', code).counts_toward);
				assert.ok(!counts.some((target) => /^(EPF|SOCSO|EIS|SKBBK|HRDF)/.test(target)), code);
				assert.ok(counts.includes('PCB.ADDITIONAL_NON_EPF'), code);
			}
			// A bonus is EPF additional wages and MTD additional remuneration, not SOCSO / EIS / SKBBK wages.
			const bonus = fixtureValue16(byCode(version, 'adhoc_catalog', 'BONUS').counts_toward);
			assert.ok(bonus.includes('EPF.ADDITIONAL') && bonus.includes('PCB.ADDITIONAL'));
			assert.ok(!bonus.some((target) => ['SOCSO', 'EIS', 'SKBBK'].includes(target)));
			// Advances and loans are recovered from net pay outside every scheme.
			for (const row of rows(version, 'loan_catalog'))
				assert.deepEqual(
					[row.destination, row.direction, row.counts_toward ?? []],
					['NET', 'SUBTRACT', []],
					String(row.code)
				);
			// Act 446 accommodation charge: RM100 a month, RM150 from March 2026, never above the contract charge.
			const rent = fixturePresent(
				fixturePresent(
					fixtureValue11(byCode(version, 'adhoc_catalog', 'ACCOMMODATION_RENT').bands)[0]
				).limit
			).amount;
			const cap = (occurred_on: string, facts: Row = {}) =>
				evaluateConfigured(
					fixtureString(String(rent)),
					fixtureContext({
						entry: { ...admitContext(facts).entry, amount: 200, occurred_on }
					})
				);
			// The RM150 cap is its own version from 1 March 2026; earlier versions cap at RM100.
			const from = fixtureValue17(settingsOf(version).effective_range).from;
			assert.equal(cap(from), from >= '2026-03-01' ? 150 : 100, version);
			assert.equal(cap(from, { contract_monthly_charge: 80 }), 80);
			// Domestic workers: SOCSO for local and foreign (Act 4 from 1 June 2021), EIS for locals only.
			const domestic = { terms: { employment_type: 'DOMESTIC' } };
			assert.notEqual(statutory(version, 'SOCSO', 2000, domestic)?.employer ?? 0, 0);
			assert.notEqual(
				statutory(version, 'SOCSO', 2000, { ...domestic, residency_status: 'FOREIGNER' })
					?.employer ?? 0,
				0
			);
			assert.notEqual(statutory(version, 'EIS', 2000, domestic)?.employee ?? 0, 0);
			assert.equal(
				statutory(version, 'EIS', 2000, { ...domestic, residency_status: 'FOREIGNER' })?.employee ??
					0,
				0
			);
		}
	});
	it('close: EPF notice on ceasing to be an employer, PERKESO cover of industrial-training students, the C.P.8D file', () => {
		for (const version of versions) {
			const set = rows(version, 'rule_set');
			// MY-OBLIGATION-27 — EPF s.41(3); KWSP: Form KWSP 6 (Form B) within 30 days of terminating operations.
			const epf = fixturePresent(set.find((row) => row.code === 'EPF_CESSATION_NOTICE'));
			const task = fixtureValue24(epf.rules);
			assert.equal(epf.family, 'TASKS', version);
			assert.deepEqual(task.trigger, { collection: 'entity', event: 'updated' });
			const entity = (to: string | null) => ({
				row: { id: 'co1', effective_range: { from: '2009-12-01', to }, facts: {} },
				company: { facts: {} }
			});
			assert.equal(
				evaluateConfigured(fixtureString(task.when), fixtureContext(entity('2026-10-31'))),
				true
			);
			assert.equal(
				evaluateConfigured(fixtureString(task.when), fixtureContext(entity(null))),
				false
			);
			assert.equal(
				evaluateConfigured(fixtureString(task.due), fixtureContext(entity('2026-10-31'))),
				'2026-11-30'
			);
			// MY-CONTRIBUTION-27 — Act 4 s.2(5) and Act 800 s.2: insured only under a contract of service or apprenticeship.
			const student = {
				terms: { employment_type: 'INTERN', facts: { industrial_training_student: true } }
			};
			const trainee = { terms: { employment_type: 'INTERN' } };
			const schemes = ['SOCSO', 'EIS', 'SKBBK'].filter((code) =>
				rows(version, 'statutory_contribution_catalog').some((row) => row.code === code)
			);
			for (const code of schemes) {
				assert.deepEqual(
					statutory(version, code, 1500, student),
					{ employee: 0, employer: 0 },
					code
				);
				assert.notDeepEqual(
					statutory(version, code, 1500, trainee),
					{ employee: 0, employer: 0 },
					code
				);
				assert.deepEqual(
					statutory(version, code, 1500, trainee),
					statutory(version, code, 1500),
					code
				);
				// No date-of-birth refusal for a person who is not insured.
				const configuration = fixtureValue4(
					byCode(version, 'statutory_contribution_catalog', code).configuration
				);
				const guards = fixtureValue7(configuration.refuse_when ?? []);
				const noAge = (input: Subject) => {
					const held = subject(input);
					const fact = fixturePresent(
						fixturePresent(configuration.person).industrial_training_student
					);
					return {
						...held,
						person: {
							...held.person,
							age: null,
							industrial_training_student: evaluateConfigured(
								fixtureString(fact),
								fixtureContext(held)
							)
						}
					};
				};
				for (const guard of guards) {
					assert.equal(
						evaluateConfigured(fixtureString(guard.when), fixtureContext(noAge(student))),
						false,
						code
					);
					assert.equal(
						evaluateConfigured(fixtureString(guard.when), fixtureContext(noAge(trainee))),
						true,
						code
					);
				}
			}
			// MY-OBLIGATION-39 — LHDN Susun Atur Maklumat C.P.8D Pin. 2025: the 22 pipe-delimited fields.
			const exports = set.filter((row) => row.family === 'EXPORTS');
			assert.deepEqual(
				exports.map((row) => row.code),
				['CP8D_EMPLOYEE_FILE'],
				version
			);
			const templates = fixtureValue25(exports);
			const slip = (period: string, parts: Row) => ({ period, status: 'PAID', ...parts });
			const ali = {
				employee: {
					id: 'p1',
					name: 'Ali bin Ahmad',
					identity_number: '730510-12-5580',
					date_of_birth: '1967-12-15',
					marital_status: 'MARRIED',
					spouse_status: 'WITH_INCOME',
					children: [],
					facts: {
						income_tax_number: 'IG 03770324020',
						employment_statutory_facts: [
							{
								employment_id: 'c1',
								effective_range: { from: '2025-01-01', to: null },
								status: {
									kind: 'REGISTERED',
									elections: {
										children_under_18_or_studying: 1,
										tp1_monthly_deductions: 1100.25,
										zakat_monthly: 850.1
									}
								}
							}
						]
					}
				},
				contract: {
					id: 'c1',
					engagement: 'EMPLOYEE',
					effective_range: { from: '2015-01-01', to: '9999-12-31' },
					facts: {
						contract_terms: [
							{ effective_range: { from: '2015-01-01' }, employment_type: 'PERMANENT' }
						]
					}
				},
				slips: ['2025-11', '2025-12'].map((period, i) =>
					slip(period, {
						gross: 25222.8,
						net: 20000,
						total_deductions: 5222.8,
						lines: {
							BASIC: 25000,
							MEAL_ALLOWANCE: 222.8,
							BIK_VOLA: 2100.4,
							CP38_INSTALMENT: i ? -911.32 : -911.31
						},
						statutory: {
							PCB: { employee: i ? 1277.63 : 1277.62, employer: 0, base: 25000.35 },
							EPF: { employee: 1800.45, employer: 3000, base: 25000 },
							SOCSO: { employee: 60.2, employer: 210, base: 6000 },
							EIS: { employee: i ? 14.95 : 15.25, employer: 15, base: 6000 }
						}
					})
				)
			};
			const siti = {
				employee: {
					id: 'p2',
					name: 'Siti binti Abu',
					marital_status: 'SINGLE',
					children: [],
					facts: {}
				},
				contract: {
					id: 'c2',
					engagement: 'EMPLOYEE',
					effective_range: { from: '2025-11-01', to: '2025-12-31' },
					facts: {
						contract_terms: [{ effective_range: { from: '2025-11-01' }, employment_type: 'INTERN' }]
					}
				},
				slips: ['2025-11', '2025-12'].map((period) =>
					slip(period, {
						gross: 1200,
						net: 1200,
						total_deductions: 0,
						lines: { BASIC: 1200 },
						statutory: {}
					})
				)
			};
			const agent = {
				employee: { id: 'p3', name: 'Agent', facts: {} },
				contract: {
					id: 'c3',
					engagement: 'PAYEE',
					effective_range: { from: '2025-01-01', to: null },
					facts: {}
				},
				slips: [
					slip('2025-12', { gross: 900, net: 900, total_deductions: 0, lines: {}, statutory: {} })
				]
			};
			const runs = [
				{ period: '2025-11', pay_date: '2025-11-28' },
				{ period: '2025-12', pay_date: '2025-12-29' }
			];
			const company = { facts: { lhdn_employer_number: 'E 2900030000' } };
			const [file, ...rest] = recordDocuments(
				fixtureExports(templates),
				fixtureContexts(runs),
				fixtureReturnRows(fixtureValue26([ali, siti, agent])),
				fixtureContext(company)
			);
			assert.equal(rest.length, 0);
			assert.equal(file?.name, 'P2900030000_2025.txt');
			// The layout's own example record (txt 1), its VOLA, ESOS, TP1 zakat and medical-insurance fields blank.
			const [first, second, ...more] = fixturePresent(file).content.split('\n');
			assert.equal(more.length, 0, 'the payee is not listed');
			assert.equal(
				first,
				'Ali bin Ahmad|03770324020|730510125580|3|2|15-12-2027|2|1|2000|50000|4200|||445|2200||3600|1700.20|2555.25|1822.63||150'
			);
			// An industrial trainee: status 5, no identity number, ceased in the year, gross from the slips.
			assert.equal(
				second,
				[
					'Siti binti Abu',
					'',
					'000000000000',
					'1',
					'5',
					'31-12-2025',
					'2',
					'',
					'',
					'2400',
					...Array(12).fill('')
				].join('|')
			);
			assert.equal(fixturePresent(second).split('|').length, 22);
			// Category 2 for a spouse without income, status 1 for management; tax borne by the employer.
			const [director] = recordDocuments(
				fixtureExports(templates),
				fixtureContexts(runs),
				fixtureReturnRows(
					fixtureValue26([
						{
							...ali,
							employee: {
								...ali.employee,
								spouse_status: 'WITHOUT_INCOME',
								facts: {
									...ali.employee.facts,
									organisation_management: true,
									tax_borne_by_employer: true
								}
							}
						}
					])
				),
				fixtureContext(company)
			);
			assert.deepEqual(fixturePresent(director).content.split('|').slice(3, 7), [
				'2',
				'1',
				'15-12-2027',
				'1'
			]);
			// Runs paid in two years make no file: a C.P.8D covers one remuneration year.
			assert.deepEqual(
				recordDocuments(
					fixtureExports(templates),
					fixtureContexts([...runs, { period: '2026-01', pay_date: '2026-01-28' }]),
					fixtureReturnRows(fixtureValue26([ali])),
					fixtureContext(company)
				),
				[]
			);
		}
	});
});
describe('MY engine runs', () => {
	const COMPANY = 'my-co-1';
	const LAW = [
		'jurisdiction_settings',
		'rule_set',
		'statutory_contribution_catalog',
		'work_catalog',
		'allowance_catalog',
		'adhoc_catalog',
		'claim_catalog',
		'leave_catalog',
		'loan_catalog'
	] as const;
	const people = [
		{
			id: 'p1',
			name: 'Aminah',
			date_of_birth: '1986-03-02',
			gender: 'FEMALE',
			salary: 7000,
			residency: 'CITIZEN'
		},
		{
			id: 'p2',
			name: 'Ram',
			date_of_birth: '1994-07-19',
			gender: 'MALE',
			salary: 3000,
			residency: 'FOREIGNER'
		}
	];
	let tables: Map<string, Row[]>;
	const reset = () => {
		tables = fixtureTables([
			...LAW.map((name) =>
				fixtureValue3([
					name,
					versions.flatMap((version) => rows(version, name)).map((row) => ({ ...row }))
				])
			),
			[
				'entity',
				[
					{
						id: COMPANY,
						name: 'Nihon',
						settings_code: 'MY',
						pay_frequency: 'MONTHLY',
						facts: { hrd_scope: 'PART_I', hrd_registration_class: 'COMPULSORY' },
						pay_cutoff_day: 1,
						effective_range: { from: '2025-12-01', to: null }
					}
				]
			],
			[
				'employment_profile',
				people.map(({ salary: _s, residency: _r, ...person }) => ({
					...person,
					marital_status: 'SINGLE',
					spouse_status: 'NONE',
					children: [],
					facts: {}
				}))
			],
			[
				'employment_contract',
				people.map((person) => ({
					id: `k-${person.id}`,
					employee_id: person.id,
					company_id: COMPANY,
					effective_range: { from: '2020-01-01', to: null },
					facts: {
						contract_terms: [
							{
								base_salary: { value: person.salary, currency: 'MYR' },
								effective_range: { from: '2020-01-01', to: null },
								residency_status: person.residency,
								work_classification: 'EA_COVERED',
								statutory_work_category: 'NON_MANUAL',
								employment_type: 'PERMANENT',
								allowances: []
							}
						]
					},
					employee_number: String(person.id),
					contract_number: 1
				}))
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
				'payroll_run',
				'shift_definition',
				'shift_pattern'
			].map((name) => fixtureValue3([name, []]))
		]);
	};
	const run = Effect.fnUntraced(function* (
		period: string,
		kind: PayrollRunKind,
		sources?: string[]
	) {
		return yield* world(tables).run(fixtureKey(COMPANY), period, kind, sources?.map(fixtureId));
	});
	type Plan = Effect.Success<ReturnType<typeof run>>;
	const bonus = () =>
		fixturePresent(tables.get('adhoc_catalog_entry')).push(
			fixtureRow({
				id: 'bonus-1',
				employment_id: 'k-p1',
				company_id: COMPANY,
				catalog_id: byCode(at('2026-02-15'), 'adhoc_catalog', 'BONUS').id,
				payslip_id: null,
				occurred_on: '2026-02-05',
				amount: 7000
			})
		);
	const totals = (plans: Plan[]) => {
		const out: {
			[key: string]: number;
		} = {};
		for (const slip of plans.flatMap((plan) => plan.payslips))
			for (const line of slip.statutory) {
				out[`${line.scheme_code}.employee`] = round2(
					(out[`${line.scheme_code}.employee`] ?? 0) + line.employee_amount
				);
				out[`${line.scheme_code}.employer`] = round2(
					(out[`${line.scheme_code}.employer`] ?? 0) + line.employer_amount
				);
			}
		return out;
	};
	it.effect(
		'a REGULAR February run prices basic, EPF, SOCSO, EIS, MTD and the HRD levy from the records',
		Effect.fnUntraced(function* () {
			reset();
			const plan = yield* run('2026-02', 'REGULAR');
			const slip = (id: string) =>
				fixturePresent(plan.payslips.find((row) => row.employment_id === fixtureKey(`k-${id}`)));
			const line = (id: string, code: string) =>
				slip(id).statutory.find((row) => row.scheme_code === code);
			assert.equal(slip('p1').gross, 7000);
			assert.deepEqual(
				[line('p1', 'EPF')?.employee_amount, line('p1', 'EPF')?.employer_amount],
				[770, 840]
			);
			assert.deepEqual(
				[line('p1', 'SOCSO')?.employee_amount, line('p1', 'SOCSO')?.employer_amount],
				[29.75, 104.15]
			);
			assert.equal(line('p1', 'HRDF')?.employer_amount, 70);
			// February with no January slip: n = 10, P = 6,230 + (7,000 − 323) × 10 − 9,000 = 64,000 → 3,040 ÷ 11.
			assert.equal(line('p1', 'PCB')?.employee_amount, 276.4);
			// The foreign worker: Part F 2% each way, SOCSO First Category, no EIS or HRD levy.
			assert.deepEqual(
				[
					line('p2', 'EPF_NON_CITIZEN')?.employee_amount,
					line('p2', 'EPF_NON_CITIZEN')?.employer_amount
				],
				[60, 60]
			);
			assert.deepEqual(
				[line('p2', 'SOCSO')?.employee_amount, line('p2', 'SOCSO')?.employer_amount],
				[14.75, 51.65]
			);
			assert.deepEqual(
				[line('p2', 'EIS')?.employee_amount ?? 0, line('p2', 'EIS')?.employer_amount ?? 0],
				[0, 0]
			);
			assert.equal(line('p2', 'HRDF')?.employer_amount ?? 0, 0);
		})
	);
	it.effect(
		'a payee paid as an agent is charged no EPF, SOCSO, EIS, HRD levy or MTD',
		Effect.fnUntraced(function* () {
			reset();
			fixturePresent(tables.get('employment_profile')).push(
				fixtureRow({
					id: 'x1',
					name: 'Agen',
					date_of_birth: '1980-01-01',
					gender: 'MALE',
					marital_status: 'SINGLE',
					spouse_status: 'NONE',
					children: [],
					facts: {}
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
								facts: { payee_role: 'AGENT' }
							}
						]
					},
					employee_number: String('x1'),
					contract_number: 1
				})
			);
			fixturePresent(tables.get('adhoc_catalog_entry')).push(
				fixtureRow({
					id: 'fee-1',
					employment_id: 'k-x1',
					company_id: COMPANY,
					catalog_id: byCode(at('2026-02-15'), 'adhoc_catalog', 'PAYEE_PAYMENT').id,
					payslip_id: null,
					occurred_on: '2026-02-10',
					amount: 5000
				})
			);
			const plan = yield* run('2026-02', 'REGULAR');
			const slip = fixturePresent(
				plan.payslips.find((row) => row.employment_id === fixtureKey('k-x1'))
			);
			assert.equal(slip.gross, 5000);
			assert.deepEqual(
				slip.statutory.filter((line) => line.employee_amount !== 0 || line.employer_amount !== 0),
				[]
			);
			// The employees are priced as before.
			const aminah = fixturePresent(
				plan.payslips.find((row) => row.employment_id === fixtureKey('k-p1'))
			);
			assert.equal(aminah.statutory.find((row) => row.scheme_code === 'EPF')?.employee_amount, 770);
		})
	);
	it.effect(
		'QA F10: the RM576 medical claim cap is yearly — RM400 then RM800 pays 400 and 176; a new year resets it',
		Effect.fnUntraced(function* () {
			reset();
			const claim = (id: string, occurred_on: string, amount: number) =>
				fixturePresent(tables.get('claim_catalog_entry')).push(
					fixtureRow({
						id,
						employment_id: 'k-p2',
						company_id: COMPANY,
						catalog_id: byCode(at(occurred_on), 'claim_catalog', 'MEDICAL_CLAIM').id,
						payslip_id: null,
						occurred_on,
						amount
					})
				);
			claim('mc-1', '2026-02-03', 400);
			claim('mc-2', '2026-02-10', 800);
			const paid = (plan: Plan) =>
				fixturePresent(plan.payslips.find((slip) => slip.employment_id === fixtureKey('k-p2')))
					.adjustments.filter((line) => line.component_code === 'MEDICAL_CLAIM')
					.map((line) => line.amount)
					.toSorted((left, right) => left - right);
			assert.deepEqual(paid(yield* run('2026-02', 'REGULAR')), [176, 400]);
			// Used up for 2026: a March claim pays nothing.
			claim('mc-3', '2026-03-04', 100);
			assert.deepEqual(paid(yield* run('2026-03', 'REGULAR')), []);
			// 2027 is a new window.
			claim('mc-4', '2027-01-06', 800);
			assert.deepEqual(paid(yield* run('2027-01', 'REGULAR')), [576]);
		})
	);
	it.effect(
		"a SEMI_MONTHLY month pays the monthly basic and allowances exactly once and charges the month's EPF",
		Effect.fnUntraced(function* () {
			reset();
			fixturePresent(fixturePresent(tables.get('entity'))[0]).pay_frequency = 'SEMI_MONTHLY';
			const term = fixturePresent(
				fixtureValue7(
					fixtureRecord(
						fixturePresent(
							fixturePresent(tables.get('employment_contract')).find(
								(row) => row.id === fixtureKey('k-p2')
							)
						).facts
					).contract_terms
				)[0]
			);
			term.allowances = [
				{
					code: 'MEAL_ALLOWANCE',
					catalogue_id: byCode(at('2026-02-15'), 'allowance_catalog', 'MEAL_ALLOWANCE').id,
					amount: { value: 301, currency: 'MYR' }
				}
			];
			const amountOf = (slip: Plan['payslips'][number], code: string) =>
				round2(
					[...(fixtureValue27(slip).base ?? [])]
						.filter((line) => line.component_code === code)
						.reduce((total, line) => total + Number(line.amount), 0)
				);
			const month: {
				[key: string]: number;
			} = {};
			const halves: Plan[] = [];
			for (const half of ['2026-02-1', '2026-02-2']) {
				const plan = yield* run(half, 'REGULAR');
				halves.push(plan);
				for (const slip of plan.payslips)
					for (const code of ['BASIC', 'MEAL_ALLOWANCE', 'gross']) {
						const key = `${slip.employment_id}.${code}`;
						const amount = code === 'gross' ? slip.gross : amountOf(slip, code);
						month[key] = round2((month[key] ?? 0) + amount);
					}
			}
			// Each half pays half the monthly rate (1 to 15 and 16 to 28 February), never the whole month twice.
			const first = fixturePresent(
				fixturePresent(halves[0]).payslips.find((slip) => slip.employment_id === fixtureKey('k-p1'))
			);
			assert.equal(amountOf(first, 'BASIC'), 3500);
			assert.deepEqual(
				[
					month[`${fixtureKey('k-p1')}.BASIC`],
					month[`${fixtureKey('k-p2')}.BASIC`],
					month[`${fixtureKey('k-p2')}.MEAL_ALLOWANCE`]
				],
				[7000, 3000, 301]
			);
			assert.deepEqual(
				[month[`${fixtureKey('k-p1')}.gross`], month[`${fixtureKey('k-p2')}.gross`]],
				[7000, 3301]
			);
			// The month's statutory charge is the monthly one (EPF Part A on RM7,000: 770 / 840).
			assert.deepEqual(
				[totals(halves)['EPF.employee'], totals(halves)['EPF.employer']],
				[770, 840]
			);
		})
	);
	// RM3,100 a month: joined on the 10th 3,100 × 22 ÷ 31 = 2,200; on the 20th 1,200; left on the 10th 1,000; on the 20th 2,000.
	for (const [range, expected] of [
		[{ from: '2026-10-10', to: null }, 2200],
		[{ from: '2026-10-20', to: null }, 1200],
		[{ from: '2020-01-01', to: '2026-10-10' }, 1000],
		[{ from: '2020-01-01', to: '2026-10-20' }, 2000],
		[{ from: '2020-01-01', to: null }, 3100]
	] satisfies [Row, number][]) {
		it.effect(
			`EA s.18A on a SEMI_MONTHLY entity: October range ${JSON.stringify(range)} is prorated over 31 calendar days`,
			Effect.fnUntraced(function* () {
				reset();
				fixturePresent(fixturePresent(tables.get('entity'))[0]).pay_frequency = 'SEMI_MONTHLY';
				const contract = fixturePresent(
					fixturePresent(tables.get('employment_contract')).find(
						(row) => row.id === fixtureKey('k-p2')
					)
				);
				contract.effective_range = range;
				const term = fixturePresent(fixtureValue7(fixtureRecord(contract.facts).contract_terms)[0]);
				term.base_salary = { value: 3100, currency: 'MYR' };
				term.effective_range = range;
				let basic = 0;
				for (const half of ['2026-10-1', '2026-10-2']) {
					const slip = (yield* run(half, 'REGULAR')).payslips.find(
						(row) => row.employment_id === fixtureKey('k-p2')
					);
					for (const line of (slip?.base ?? []).filter((held) => held.component_code === 'BASIC'))
						basic = round2(basic + Number(line.amount));
				}
				assert.equal(basic, expected, JSON.stringify(range));
			})
		);
	}
	it.effect(
		'EA s.60D(3)(a) and s.60(3)(d): holiday pay plus two days for a worked holiday; every rest-day piece at 2×',
		Effect.fnUntraced(function* () {
			reset();
			const terms = (id: string) =>
				fixturePresent(
					fixtureValue7(
						fixtureRecord(
							fixturePresent(
								fixturePresent(tables.get('employment_contract')).find(
									(row) => row.id === fixtureKey(id)
								)
							).facts
						).contract_terms
					)[0]
				);
			Object.assign(terms('k-p2'), {
				base_salary: { value: 100, currency: 'MYR' },
				statutory_work_category: 'MANUAL_LABOUR',
				facts: { pay_basis: 'DAILY' }
			});
			Object.assign(terms('k-p1'), {
				base_salary: { value: 2, currency: 'MYR' },
				statutory_work_category: 'MANUAL_LABOUR',
				facts: { pay_basis: 'PIECE' }
			});
			fixturePresent(tables.get('shift_definition')).push(
				fixtureRow({
					id: 'R',
					company_id: COMPANY,
					code: 'R',
					variant: { day_type: 'REST' }
				}),
				// Only planned time pays: the worked holiday is rostered on an 8-hour WORK shift, so its 8 clocked hours
				// are the shift's ordinary hours and no holiday overtime.
				fixtureRow({
					id: 'D',
					company_id: COMPANY,
					code: 'D',
					variant: { day_type: 'WORK', start_time: '08:00', end_time: '16:00' }
				})
			);
			fixturePresent(tables.get('holiday')).push(
				fixtureRow({
					id: 'h1',
					company_id: COMPANY,
					date: '2026-08-31',
					name: 'Hari Kebangsaan',
					kind: 'PUBLIC_HOLIDAY',
					published_at: '2026-01-01T00:00:00.000Z',
					given_to: 'EVERYONE'
				})
			);
			fixturePresent(tables.get('roster_entry')).push(
				fixtureRow({
					id: 'holiday-worked',
					employment_id: 'k-p2',
					work_date: '2026-08-31',
					shift_definition_id: 'D',
					payslip_id: null,
					worked_intervals: [{ start: '2026-08-31T00:00:00.000Z', end: '2026-08-31T08:00:00.000Z' }]
				}),
				fixtureRow({
					id: 'rest-pieces',
					employment_id: 'k-p1',
					work_date: '2026-08-30',
					shift_definition_id: 'R',
					payslip_id: null,
					facts: { piece_units: 30, overtime_units: 10 }
				})
			);
			const plan = yield* run('2026-08', 'REGULAR');
			const amount = (id: string, code: string) =>
				round2(
					(
						fixtureValue28(plan.payslips.find((slip) => slip.employment_id === fixtureKey(id)))
							?.base ?? []
					)
						.filter((line) => line.component_code === code)
						.reduce((total, line) => total + Number(line.amount), 0)
				);
			// RM100 a day: the holiday at the ordinary rate (s.60D(1)) and two days' wages for working it = RM300.
			assert.deepEqual(
				['BASIC', 'HOLIDAY_PAY', 'HOLIDAY_WORK'].map((code) => amount('k-p2', code)),
				[0, 100, 200]
			);
			// Rest day, 30 pieces + 10 overtime pieces at RM2: (30 + 10) × 2 × 2 = RM160 (was 120 + 30 at 1.5×).
			assert.equal(amount('k-p1', 'PIECE_PAY'), 160);
		})
	);
	it.effect(
		'an OFF_CYCLE bonus run before or after the REGULAR run yields the same month totals',
		Effect.fnUntraced(function* () {
			reset();
			bonus();
			const before = [
				yield* run('2026-02', 'OFF_CYCLE', ['bonus-1']),
				yield* run('2026-02', 'REGULAR')
			];
			assert.equal(fixturePresent(fixturePresent(before[0]).payslips[0]).base.length, 0);
			reset();
			const salary = yield* run('2026-02', 'REGULAR');
			bonus();
			const after = [salary, yield* run('2026-02', 'OFF_CYCLE', ['bonus-1'])];
			reset();
			bonus();
			const together = [yield* run('2026-02', 'REGULAR')];
			const expected = totals(together);
			for (const scheme of ['EPF', 'SOCSO', 'EIS', 'PCB', 'HRDF', 'EPF_NON_CITIZEN'])
				for (const side of ['employee', 'employer'])
					assert.ok(
						`${scheme}.${side}` in expected || scheme === 'EPF_NON_CITIZEN',
						`${scheme}.${side}`
					);
			assert.deepEqual(totals(before), expected);
			assert.deepEqual(totals(after), expected);
			// The bonus is EPF additional wages: 11% / 12% of RM14,000 in the month, and MTD on additional remuneration.
			assert.equal(expected['EPF.employee'], 1540);
			assert.ok(fixturePresent(expected['PCB.employee']) > 1000);
		})
	);
});
describe('MY sample records (Nihon bank)', () => {
	const bank = resolve(process.cwd(), '../../seed_bank/norbital_hr/records/nihon');
	const read = (name: string): readonly Row[] =>
		existsSync(resolve(bank, `${name}.json`)) ? readSeedRows(resolve(bank), name) : [];
	it(
		'every reference resolves to a sample row or a MY catalogue row of the version in force',
		{},
		() => {
			const ids = (name: string) => new Set(read(name).map((row) => String(row.id)));
			const entity = ids('entity');
			const profiles = ids('employment_profile');
			const contracts = read('employment_contract');
			const contractIds = new Set(contracts.map((row) => String(row.id)));
			const shifts = ids('shift_definition');
			const patterns = ids('shift_pattern');
			assert.equal(entity.size, 1);
			for (const row of [...read('shift_definition'), ...read('shift_pattern'), ...read('holiday')])
				assert.ok(entity.has(String(row.company_id)), `company of ${String(row.id)}`);
			for (const pattern of read('shift_pattern'))
				for (const day of fixtureValue7(fixtureRecord(pattern.pattern).days ?? []))
					if (day.roster_code_id != null)
						assert.ok(shifts.has(String(day.roster_code_id)), `${String(pattern.code)} day`);
			const schemes = new Map(
				versions.flatMap((version) =>
					rows(version, 'statutory_contribution_catalog').map(
						(row) => [String(row.id), String(row.code)] as const
					)
				)
			);
			const employeeSchema = fixtureValue12(
				settingsOf(fixturePresent(versions.at(-1))).employee_input_schema
			);
			const statutoryFacts = fixtureValue13(
				fixtureRecord(employeeSchema.properties.employment_statutory_facts).items
			);
			const electionKeys = new Set(
				Object.keys(
					fixtureValue29(statutoryFacts.properties.status.properties).elections.properties
				)
			);
			for (const profile of read('employment_profile'))
				for (const standing of fixtureValue7(
					fixtureRecord(profile.facts).employment_statutory_facts ?? []
				)) {
					assert.ok(
						schemes.has(String(standing.statutory_contribution_id)),
						`scheme of ${String(standing.id)}`
					);
					for (const key of Object.keys(
						fixtureValue5(fixtureRecord(standing.status).elections ?? {})
					))
						assert.ok(electionKeys.has(key), `election ${key}`);
				}
			for (const contract of contracts) {
				assert.ok(profiles.has(String(contract.employee_id)), `employee of ${String(contract.id)}`);
				assert.ok(entity.has(String(contract.company_id)));
				for (const term of fixtureValue7(fixtureRecord(contract.facts).contract_terms ?? [])) {
					if (term.shift_pattern_id != null) assert.ok(patterns.has(String(term.shift_pattern_id)));
					assert.equal(fixtureValue5(term.base_salary).currency, 'MYR');
				}
			}
			for (const row of read('roster')) assert.ok(contractIds.has(String(row.employment_id)));
			for (const row of read('roster_entry')) {
				assert.ok(contractIds.has(String(row.employment_id)), `roster ${String(row.id)}`);
				assert.ok(shifts.has(String(row.shift_definition_id)), `shift of ${String(row.id)}`);
				for (const interval of fixtureValue7(row.worked_intervals))
					assert.match(String(interval.start), /Z$/);
			}
			// Each entry names the class of the version in force on its day (or the first version before the lineage).
			for (const [collection, table] of [
				['leave_catalog_entry', 'leave_catalog'],
				['claim_catalog_entry', 'claim_catalog'],
				['adhoc_catalog_entry', 'adhoc_catalog'],
				['loan_repayment_entry', 'loan_catalog']
			] as const)
				for (const row of read(collection)) {
					const day = String(row.occurred_on);
					const version = day < '2025-12-01' ? fixturePresent(versions[0]) : at(day);
					assert.ok(
						rows(version, table).some((item) => item.id === row.catalog_id),
						`${collection} ${String(row.id)} class of ${version}`
					);
					assert.ok(contractIds.has(String(row.employment_id)));
					assert.ok(entity.has(String(row.company_id)));
				}
			const loans = new Map(read('loan_catalog_entry').map((row) => [row.id, row]));
			for (const loan of loans.values()) {
				assert.ok(contractIds.has(String(loan.employment_id)));
				assert.ok(entity.has(String(loan.company_id)));
				// A configured loan carries its principal and period; a legacy one (unknown principal) neither.
				assert.equal(loan.principal_amount === undefined, loan.repayment_period === undefined);
				assert.equal('amount' in loan || 'payslip_id' in loan, false);
			}
			const repaid = new Map<unknown, number>();
			for (const repayment of read('loan_repayment_entry')) {
				const loan = fixturePresent(loans.get(repayment.loan_id));
				// its class follows the version in force on its day (checked above), so only the owner must match
				for (const field of ['company_id', 'employment_id'])
					assert.equal(repayment[field], loan[field]);
				if (loan.repayment_period !== undefined) {
					const period = fixtureValue2(loan.repayment_period);
					const day = String(repayment.occurred_on);
					assert.ok(day >= period.from && (period.to == null || day <= period.to));
				}
				repaid.set(loan.id, (repaid.get(loan.id) ?? 0) + Number(repayment.amount));
			}
			for (const loan of loans.values())
				if (loan.principal_amount !== undefined)
					assert.equal(
						Math.round((repaid.get(loan.id) ?? 0) * 100),
						Math.round(Number(loan.principal_amount) * 100),
						`loan ${String(loan.id)} repays its principal`
					);
			// Derived amounts are never seeded: no payslip, run, obligation or statutory line in the bank.
			for (const derived of ['payslip', 'payroll_run', 'obligation', 'regulatory_task'])
				assert.equal(existsSync(resolve(bank, `${derived}.json`)), false, derived);
			assert.equal(contracts.length, 290);
			assert.equal(read('roster_entry').length, 5390);
			assert.equal(read('leave_catalog_entry').length, 961);
		}
	);
});
