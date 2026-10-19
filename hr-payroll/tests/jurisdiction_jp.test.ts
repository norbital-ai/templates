import { modelFields as kitModelFields } from './jurisdiction_kit.js';
import canonicalLeave from '../src/data/model/+leave_catalog.model.js';
import { inputSchema } from '@norbital-ai/std/kind';
import { Instant } from '@norbital-ai/std/date';
import { Schema as FixtureSchema } from 'effect';
import { fixtureId, nativeId } from './fixture_values.js';
import {
	schemaProblems as kitSchemaProblems,
	propertiesAt as kitPropertiesAt
} from './jurisdiction_kit.js';
import { world, type Tables } from './jurisdiction_kit.js';
import { workspace } from './kit.js';
import { lineage as jurisdiction } from './jurisdiction_kit.js';
const LAW_KIT = jurisdiction('JP');
/** The JP public lineage: snapshot structure, CEL on the engine's own contexts, obligations, and amounts through a run. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, layer } from '@effect/vitest';
import { Effect } from 'effect';
import { Behaviours } from '../src/lib/payroll_engine/behaviours.js';
import { electionKeysOf } from '../src/lib/payroll_engine/employment_facts.js';
import { dutiesOf, raiseDuties, triggerOf, SEEDED_PAYROLL } from './duties.ts';
// strict: a record expression failing inside `configured_eval`, even where CEL absorbs it, fails the suite
import { evaluateStrict as evaluateConfigured } from '../src/lib/payroll_engine/expressions.js';
import { leaveBalances, type AttendanceDay } from '../src/lib/payroll_engine/leave.js';
import { rosterFindings, type RosterDraft } from '../src/lib/payroll_engine/admit.js';
import { type PayrollRunKind } from '../src/lib/payroll_engine/payslip/context.js';
import { recordDocuments } from '../src/lib/payroll_engine/export.js';
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
const fixtureInstant = (value: unknown) =>
	Instant(fixtureString(FixtureSchema.decodeUnknownSync(inputSchema({ kind: 'instant' }))(value)));
const fixtureIntervals = (value: unknown) =>
	fixtureRecords(value).map((row) => ({
		start: fixtureInstant(row.from),
		end: row.to === null ? null : fixtureInstant(row.to)
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
const fixtureValue0 = guardFixture(
	FixtureSchema.mutable(FixtureSchema.Tuple([FixtureSchema.Number, FixtureSchema.Number]))
);
const fixtureValue1 = guardFixture(
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
			assess_without_wage: FixtureSchema.mutableKey(
				FixtureSchema.optionalKey(FixtureSchema.Boolean)
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
			),
			warn_when: FixtureSchema.mutableKey(
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
const fixtureValue2 = guardFixture(
	FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Number))
);
const fixtureValue3 = guardFixture(
	FixtureSchema.mutable(FixtureSchema.Array(FixtureSchema.String))
);
const fixtureValue4 = guardFixture(
	FixtureSchema.mutable(
		FixtureSchema.Array(
			FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))
		)
	)
);
const fixtureValue5 = guardFixture(
	FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))
);
const fixtureValue6 = guardFixture(
	FixtureSchema.Union([
		FixtureSchema.StructWithRest(
			FixtureSchema.Struct({
				person: FixtureSchema.mutableKey(
					FixtureSchema.optionalKey(
						FixtureSchema.Record(
							FixtureSchema.String,
							FixtureSchema.mutableKey(FixtureSchema.String)
						)
					)
				),
				assessable: FixtureSchema.mutableKey(
					FixtureSchema.optionalKey(
						FixtureSchema.Record(
							FixtureSchema.String,
							FixtureSchema.mutableKey(FixtureSchema.String)
						)
					)
				),
				assessment: FixtureSchema.mutableKey(FixtureSchema.optionalKey(FixtureSchema.String)),
				assess_without_wage: FixtureSchema.mutableKey(
					FixtureSchema.optionalKey(FixtureSchema.Boolean)
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
				),
				warn_when: FixtureSchema.mutableKey(
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
					FixtureSchema.mutable(
						FixtureSchema.Array(
							FixtureSchema.StructWithRest(
								FixtureSchema.Struct({
									when: FixtureSchema.mutableKey(FixtureSchema.optionalKey(FixtureSchema.String)),
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
			}),
			[FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))]
		),
		FixtureSchema.Undefined
	])
);
const fixtureValue7 = guardFixture(
	FixtureSchema.StructWithRest(
		FixtureSchema.Struct({
			from: FixtureSchema.mutableKey(FixtureSchema.String),
			to: FixtureSchema.mutableKey(FixtureSchema.Union([FixtureSchema.String, FixtureSchema.Null]))
		}),
		[FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))]
	)
);
const fixtureValue8 = guardFixture(
	FixtureSchema.StructWithRest(
		FixtureSchema.Struct({ to: FixtureSchema.mutableKey(FixtureSchema.String) }),
		[FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))]
	)
);
const fixtureValue9 = guardFixture(
	FixtureSchema.StructWithRest(
		FixtureSchema.Struct({
			items: FixtureSchema.mutableKey(
				FixtureSchema.StructWithRest(
					FixtureSchema.Struct({
						properties: FixtureSchema.mutableKey(
							FixtureSchema.Record(
								FixtureSchema.String,
								FixtureSchema.mutableKey(
									FixtureSchema.StructWithRest(
										FixtureSchema.Struct({
											enum: FixtureSchema.mutableKey(
												FixtureSchema.optionalKey(
													FixtureSchema.mutable(FixtureSchema.Array(FixtureSchema.String))
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
const fixtureValue10 = guardFixture(
	FixtureSchema.StructWithRest(
		FixtureSchema.Struct({
			PREFECTURE: FixtureSchema.mutableKey(
				FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))
			)
		}),
		[FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))]
	)
);
const fixtureValue11 = guardFixture(
	FixtureSchema.StructWithRest(
		FixtureSchema.Struct({
			by_region: FixtureSchema.mutableKey(
				FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))
			)
		}),
		[FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))]
	)
);
const fixtureValue12 = guardFixture(
	FixtureSchema.mutable(
		FixtureSchema.Array(
			FixtureSchema.StructWithRest(
				FixtureSchema.Struct({
					when: FixtureSchema.mutableKey(FixtureSchema.String),
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
const fixtureValue13 = guardFixture(
	FixtureSchema.StructWithRest(
		FixtureSchema.Struct({ employee: FixtureSchema.mutableKey(FixtureSchema.Number) }),
		[FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))]
	)
);
const fixtureValue14 = guardFixture(
	FixtureSchema.StructWithRest(
		FixtureSchema.Struct({
			days: FixtureSchema.mutableKey(FixtureSchema.String),
			bands: FixtureSchema.mutableKey(
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
const fixtureValue15 = guardFixture(
	FixtureSchema.StructWithRest(
		FixtureSchema.Struct({
			site: FixtureSchema.mutableKey(FixtureSchema.String),
			kind: FixtureSchema.mutableKey(FixtureSchema.String),
			when: FixtureSchema.mutableKey(FixtureSchema.String),
			message: FixtureSchema.mutableKey(FixtureSchema.String),
			authority: FixtureSchema.mutableKey(FixtureSchema.String)
		}),
		[FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))]
	)
);
const fixtureValue16 = guardFixture(
	FixtureSchema.StructWithRest(
		FixtureSchema.Struct({ days: FixtureSchema.mutableKey(FixtureSchema.String) }),
		[FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))]
	)
);
const fixtureValue17 = guardFixture(
	FixtureSchema.StructWithRest(
		FixtureSchema.Struct({ window_key: FixtureSchema.mutableKey(FixtureSchema.String) }),
		[FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))]
	)
);
const fixtureValue18 = guardFixture(
	FixtureSchema.Union([
		FixtureSchema.StructWithRest(
			FixtureSchema.Struct({ employee: FixtureSchema.mutableKey(FixtureSchema.Number) }),
			[FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))]
		),
		FixtureSchema.Null
	])
);
const fixtureValue19 = guardFixture(
	FixtureSchema.mutable(
		FixtureSchema.Array(
			FixtureSchema.StructWithRest(
				FixtureSchema.Struct({
					limit: FixtureSchema.mutableKey(
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
const fixtureValue20 = guardFixture(
	FixtureSchema.StructWithRest(
		FixtureSchema.Struct({
			holidays: FixtureSchema.mutableKey(
				FixtureSchema.mutable(
					FixtureSchema.Array(
						FixtureSchema.StructWithRest(
							FixtureSchema.Struct({
								date: FixtureSchema.mutableKey(FixtureSchema.String),
								name: FixtureSchema.mutableKey(FixtureSchema.String),
								kind: FixtureSchema.mutableKey(FixtureSchema.String),
								replaces: FixtureSchema.mutableKey(FixtureSchema.optionalKey(FixtureSchema.String))
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
const fixtureValue21 = guardFixture(
	FixtureSchema.StructWithRest(
		FixtureSchema.Struct({
			contract_terms: FixtureSchema.mutableKey(
				FixtureSchema.StructWithRest(
					FixtureSchema.Struct({
						items: FixtureSchema.mutableKey(
							FixtureSchema.StructWithRest(
								FixtureSchema.Struct({
									properties: FixtureSchema.mutableKey(
										FixtureSchema.StructWithRest(
											FixtureSchema.Struct({
												statutory_work_category: FixtureSchema.mutableKey(
													FixtureSchema.StructWithRest(
														FixtureSchema.Struct({
															description: FixtureSchema.mutableKey(FixtureSchema.String)
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
const fixtureValue22 = guardFixture(Behaviours);
const fixtureValue23 = guardFixture(FixtureSchema.String);
const fixtureValue24 = guardFixture(
	FixtureSchema.Union([
		FixtureSchema.mutable(FixtureSchema.Tuple([FixtureSchema.String, FixtureSchema.String])),
		FixtureSchema.Undefined
	])
);
const fixtureValue25 = guardFixture(
	FixtureSchema.StructWithRest(
		FixtureSchema.Struct({
			tables: FixtureSchema.mutableKey(
				FixtureSchema.mutable(
					FixtureSchema.Array(
						FixtureSchema.StructWithRest(
							FixtureSchema.Struct({
								year: FixtureSchema.mutableKey(FixtureSchema.Number),
								from: FixtureSchema.mutableKey(FixtureSchema.String),
								to: FixtureSchema.mutableKey(
									FixtureSchema.Union([FixtureSchema.String, FixtureSchema.Null])
								),
								below: FixtureSchema.mutableKey(FixtureSchema.Number),
								formula_from: FixtureSchema.mutableKey(FixtureSchema.Number),
								rows: FixtureSchema.mutableKey(
									FixtureSchema.mutable(
										FixtureSchema.Array(
											FixtureSchema.mutable(FixtureSchema.Array(FixtureSchema.Number))
										)
									)
								),
								kou: FixtureSchema.mutableKey(
									FixtureSchema.mutable(
										FixtureSchema.Array(
											FixtureSchema.mutable(FixtureSchema.Array(FixtureSchema.Number))
										)
									)
								),
								otsu: FixtureSchema.mutableKey(
									FixtureSchema.mutable(
										FixtureSchema.Array(
											FixtureSchema.mutable(FixtureSchema.Array(FixtureSchema.Number))
										)
									)
								),
								hei: FixtureSchema.mutableKey(
									FixtureSchema.mutable(
										FixtureSchema.Array(
											FixtureSchema.mutable(FixtureSchema.Array(FixtureSchema.Number))
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
			)
		}),
		[FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))]
	)
);
const fixtureValue26 = guardFixture(FixtureSchema.Number);
const fixtureValue27 = guardFixture(
	FixtureSchema.StructWithRest(
		FixtureSchema.Struct({
			meals: FixtureSchema.mutableKey(
				FixtureSchema.mutable(
					FixtureSchema.Array(
						FixtureSchema.StructWithRest(
							FixtureSchema.Struct({
								by_region: FixtureSchema.mutableKey(
									FixtureSchema.Record(
										FixtureSchema.String,
										FixtureSchema.mutableKey(
											FixtureSchema.Record(
												FixtureSchema.String,
												FixtureSchema.mutableKey(FixtureSchema.Unknown)
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
				)
			),
			housing: FixtureSchema.mutableKey(
				FixtureSchema.mutable(
					FixtureSchema.Array(
						FixtureSchema.StructWithRest(
							FixtureSchema.Struct({
								by_region: FixtureSchema.mutableKey(
									FixtureSchema.Record(
										FixtureSchema.String,
										FixtureSchema.mutableKey(FixtureSchema.Number)
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
			)
		}),
		[FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))]
	)
);
const fixtureValue28 = guardFixture(
	FixtureSchema.StructWithRest(
		FixtureSchema.Struct({ until: FixtureSchema.mutableKey(FixtureSchema.String) }),
		[FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))]
	)
);
const fixtureValue29 = guardFixture(
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
const fixtureValue30 = guardFixture(
	FixtureSchema.StructWithRest(
		FixtureSchema.Struct({
			employee: FixtureSchema.mutableKey(FixtureSchema.Number),
			employer: FixtureSchema.mutableKey(FixtureSchema.Number)
		}),
		[FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))]
	)
);
const fixtureValue31 = guardFixture(
	FixtureSchema.StructWithRest(
		FixtureSchema.Struct({ employer: FixtureSchema.mutableKey(FixtureSchema.Number) }),
		[FixtureSchema.Record(FixtureSchema.String, FixtureSchema.mutableKey(FixtureSchema.Unknown))]
	)
);
type Row = Record<string, unknown>;
const lineages = resolve(process.cwd(), 'seed/jurisdiction');
const JP = resolve(lineages, 'JP');
const ELECTIONS = [
	'apportionment_ratio',
	'basic_pension_number',
	'bonus_as_remuneration',
	'care_exempt',
	'departure_date',
	'dependency_declaration_filed',
	'employment_insurance_number',
	'june_amount',
	'lump_sum_on_exit',
	'monthly_amount',
	'not_domiciled_on_january_1',
	'premium_adjustment_employee_share',
	'prior_employer_income',
	'prior_employer_social_insurance',
	'prior_employer_tax',
	'retirement_deduction_adjustment',
	'retirement_due_to_disability',
	'retirement_income_declaration_filed',
	'secondary_dependants',
	'social_security_agreement_exempt',
	'specified_officer',
	'standard_monthly_remuneration',
	'treaty_exempt',
	'withholding_dependants',
	'yea_dependant_deduction',
	'yea_housing_loan_credit',
	'yea_income_adjustment',
	'yea_insurance_deductions',
	'yea_other_income',
	'yea_other_social_insurance',
	'yea_personal_deductions',
	'yea_specific_relative_deduction',
	'yea_spouse_deduction'
];
/** 協会けんぽ 健康保険料率 (%) by prefecture: FY2025 (from March 2025) and FY2026 (from March 2026). */
const KYOKAI: Record<string, [number, number]> = {
	HOKKAIDO: [10.31, 10.28],
	AOMORI: [9.85, 9.85],
	IWATE: [9.62, 9.51],
	MIYAGI: [10.11, 10.1],
	AKITA: [10.01, 10.01],
	YAMAGATA: [9.75, 9.75],
	FUKUSHIMA: [9.62, 9.5],
	IBARAKI: [9.67, 9.52],
	TOCHIGI: [9.82, 9.82],
	GUNMA: [9.77, 9.68],
	SAITAMA: [9.76, 9.67],
	CHIBA: [9.79, 9.73],
	TOKYO: [9.91, 9.85],
	KANAGAWA: [9.92, 9.92],
	NIIGATA: [9.55, 9.21],
	TOYAMA: [9.65, 9.59],
	ISHIKAWA: [9.88, 9.7],
	FUKUI: [9.94, 9.71],
	YAMANASHI: [9.89, 9.55],
	NAGANO: [9.69, 9.63],
	GIFU: [9.93, 9.8],
	SHIZUOKA: [9.8, 9.61],
	AICHI: [10.03, 9.93],
	MIE: [9.99, 9.77],
	SHIGA: [9.97, 9.88],
	KYOTO: [10.03, 9.89],
	OSAKA: [10.24, 10.13],
	HYOGO: [10.16, 10.12],
	NARA: [10.02, 9.91],
	WAKAYAMA: [10.19, 10.06],
	TOTTORI: [9.93, 9.86],
	SHIMANE: [9.94, 9.94],
	OKAYAMA: [10.17, 10.05],
	HIROSHIMA: [9.97, 9.78],
	YAMAGUCHI: [10.36, 10.15],
	TOKUSHIMA: [10.47, 10.24],
	KAGAWA: [10.21, 10.02],
	EHIME: [10.18, 9.98],
	KOCHI: [10.13, 10.05],
	FUKUOKA: [10.31, 10.11],
	SAGA: [10.78, 10.55],
	NAGASAKI: [10.41, 10.06],
	KUMAMOTO: [10.12, 10.08],
	OITA: [10.25, 10.08],
	MIYAZAKI: [10.09, 9.77],
	KAGOSHIMA: [10.31, 10.13],
	OKINAWA: [9.44, 9.44]
};
const CATALOGS = [
	'statutory_contribution_catalog',
	'leave_catalog',
	'claim_catalog',
	'adhoc_catalog',
	'loan_catalog',
	'allowance_catalog',
	'work_catalog'
];
const FILES = ['jurisdiction_settings', 'rule_set', ...CATALOGS];
const versions = LAW_KIT.versions;
const file = LAW_KIT.rows;
const settingsOf = LAW_KIT.settingsOf;
const payrollRules = (version: string): Row =>
	Object.fromEntries(
		file(version, 'rule_set')
			.filter((row) => row.family === 'PAYROLL')
			.map((row) => [row.code, row.rules])
	);
const scheme = (version: string, code: string): Row =>
	fixturePresent(file(version, 'statutory_contribution_catalog').find((row) => row.code === code));
const modelFields = kitModelFields;
// ── the statutory context exactly as `assessStatutory` builds it ────────────────────────────────────────────────────
type Person = {
	dob?: string;
	gender?: string;
	region?: string;
	category?: string;
	residency?: string;
	classification?: string;
	monthly_wage?: number;
	elections?: Record<string, Row>;
	company?: Row;
	exit_date?: string;
	start_date?: string;
	service_months?: number;
	earned?: Row;
	terms_facts?: Row;
	pay_date?: string;
	leave?: Row[];
	hours?: Row;
	headcount?: number;
	previous_month?: Record<
		string,
		{
			employee: number;
			employer: number;
		}
	>;
};
type Month = {
	ordinary?: number;
	bonus?: number;
	bonus12?: number;
	commuting?: number;
	pass?: number;
	retirement?: number;
};
/** The class each test wage is paid through: its `counts_toward` routes it to the schemes, as in the engine. */
const PAID_AS: Record<keyof Month, [string, string]> = {
	ordinary: ['work_catalog', 'BASIC'],
	commuting: ['allowance_catalog', 'COMMUTING_ALLOWANCE'],
	bonus: ['adhoc_catalog', 'BONUS'],
	bonus12: ['adhoc_catalog', 'BONUS_OVER_SIX_MONTHS'],
	pass: ['adhoc_catalog', 'COMMUTER_PASS'],
	retirement: ['adhoc_catalog', 'RETIREMENT_ALLOWANCE']
};
const schemePart = (target: string): [string, string] => {
	const [code = '', part = 'ORDINARY'] = target.split('.');
	return [code, part.toLowerCase()];
};
const periodOf = (key: string, pay_date?: string) => {
	const [year, month] = fixtureValue0(key.split('-').map(Number));
	const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
	const to = `${key}-${String(days).padStart(2, '0')}`;
	const next = new Date(Date.UTC(year, month, 10)).toISOString().slice(0, 10);
	return {
		key,
		from: `${key}-01`,
		to,
		days,
		month,
		part: 1,
		parts: 1,
		month_key: key,
		month_from: `${key}-01`,
		month_to: to,
		month_days: days,
		unpaid_working_days: 0,
		paid_days: days,
		pay_date: pay_date ?? next,
		covered_days: days,
		working_days: 21,
		salary_paid: false
	};
};
const statutoryContext = (key: string, person: Person = {}, month: Month = {}) => {
	const parts = { ordinary: 0, bonus: 0, commuting: 0, retirement: 0, ...month };
	const employment = {
		classification: person.classification ?? 'ORDINARY',
		service_months: person.service_months ?? 60,
		exit_date: person.exit_date ?? '',
		start_date: person.start_date ?? '2020-04-01',
		exit_ground: '',
		exit_facts: {}
	};
	const earned = { month: {}, year: {}, previous_month: {}, months: [], ...person.earned };
	return {
		employee: {
			gender: person.gender ?? 'MALE',
			date_of_birth: person.dob ?? '1990-06-15',
			age: null,
			children: [],
			facts: {}
		},
		company: {
			region: person.region ?? 'TOKYO',
			risk_class: '',
			pay_frequency: 'MONTHLY',
			headcount: person.headcount ?? 60,
			facts: person.company ?? {
				workers_accident_rate_per_mille: 3,
				monthly_average_scheduled_hours: 160
			}
		},
		terms: {
			work_classification: person.classification ?? 'ORDINARY',
			statutory_work_category: person.category ?? 'SOCIAL_AND_EMPLOYMENT',
			employment_type: 'INDEFINITE',
			residency_status: person.residency ?? 'RESIDENT',
			residency_since: '',
			base_salary: person.monthly_wage ?? parts.ordinary,
			monthly_wage: person.monthly_wage ?? parts.ordinary,
			effective_from: '2020-04-01',
			effective_to: '',
			allowances: [],
			facts: person.terms_facts ?? {}
		},
		earned,
		work: { days: [], overtime_hours: 0 },
		hours: person.hours ?? { month: {}, previous_month: {}, year: {}, rolling: {}, months: [] },
		leave: { rows: person.leave ?? [] },
		headcount: person.headcount ?? 60,
		employment,
		person: { employment, residency_status: person.residency ?? 'RESIDENT' },
		wage: parts,
		month: parts,
		year: { ordinary: 0, bonus: 0, commuting: 0, retirement: 0 },
		period: periodOf(key, person.pay_date)
	};
};
type Charge =
	| {
			employee: number;
			employer: number;
	  }
	| null
	| 'REFUSED';
/** One scheme's month charge as `assessStatutory` evaluates it: person facts, assessable parts, guards, first rule. */
const charge = (
	row: Row,
	base: Row & {
		person: Row;
		month: Row;
	}
): Charge => {
	const configuration = fixtureValue1(row.configuration);
	let context: Row = { ...base };
	const facts: Row = {};
	for (const [fact, expression] of Object.entries(configuration.person ?? {}))
		facts[fact] = evaluateConfigured(fixtureString(expression), fixtureContext(context));
	context = { ...context, person: { ...base.person, ...facts } };
	const parts: Record<string, number> = {};
	for (const part of Object.keys(base.month)) {
		const expression = configuration.assessable?.[part];
		const value =
			expression == null
				? fixturePresent(fixtureValue2(base.month)[part])
				: Number(evaluateConfigured(fixtureString(expression), fixtureContext(context)));
		parts[part] = Math.round(Math.max(0, value) * 100) / 100;
	}
	const total = Object.values(parts).reduce((sum, value) => sum + value, 0);
	context = { ...context, base: { ...parts, assessed: total, amount: total } };
	for (const guard of configuration.refuse_when ?? [])
		if (evaluateConfigured(fixtureString(guard.when), fixtureContext(context)) === true)
			return 'REFUSED';
	for (const rule of configuration.rules) {
		if (
			rule.when != null &&
			evaluateConfigured(fixtureString(rule.when), fixtureContext(context)) !== true
		)
			continue;
		const assessed =
			configuration.assessment == null
				? total
				: Number(
						evaluateConfigured(fixtureString(configuration.assessment), fixtureContext(context))
					);
		const ruled = { ...context, base: { ...parts, assessed, amount: assessed } };
		return {
			employee:
				rule.employee == null
					? 0
					: Number(evaluateConfigured(fixtureString(rule.employee), fixtureContext(ruled))),
			employer:
				rule.employer == null
					? 0
					: Number(evaluateConfigured(fixtureString(rule.employer), fixtureContext(ruled)))
		};
	}
	return null;
};
/** One slip of `assessStatutory`: each test wage routed by its class's `counts_toward`, every scheme assessed after the
 * schemes whose `charged.month` it reads (else by code), skipped without a wage unless it assesses without one. */
const slip = (version: string, key: string, person: Person = {}, month: Month = {}) => {
	const base = statutoryContext(key, person, month);
	const elections = person.elections ?? {};
	const rows = file(version, 'statutory_contribution_catalog');
	const codes = rows.map((row) => String(row.code));
	const rules = payrollRules(version);
	const schemeParts = new Map<string, Set<string>>();
	const wages = new Map<string, Map<string, number>>();
	for (const name of CATALOGS.filter((catalog) => catalog !== 'statutory_contribution_catalog'))
		for (const row of file(version, name))
			for (const target of fixtureValue3(row.counts_toward ?? [])) {
				const [code, part] = schemePart(target);
				schemeParts.set(code, (schemeParts.get(code) ?? new Set(['ordinary'])).add(part));
			}
	for (const wage of [
		'ordinary',
		'commuting',
		'bonus',
		'bonus12',
		'pass',
		'retirement'
	] satisfies (keyof Month)[]) {
		const [name, code] = PAID_AS[wage];
		const amount = month[wage] ?? 0;
		if (amount === 0) continue;
		const row = fixturePresent(file(version, name).find((item) => item.code === code));
		for (const target of fixtureValue3(row.counts_toward)) {
			const [scheme, part] = schemePart(target);
			const held = wages.get(scheme) ?? new Map<string, number>();
			held.set(part, (held.get(part) ?? 0) + amount);
			wages.set(scheme, held);
		}
	}
	const zero = () => Object.fromEntries(codes.map((code) => [code, { employee: 0, employer: 0 }]));
	const charged = {
		year: zero(),
		month: zero(),
		previous_month: { ...zero(), ...person.previous_month },
		previous_year: zero()
	};
	const reads = new Map(
		rows.map((row) => [
			String(row.code),
			[...JSON.stringify(row.configuration).matchAll(/charged\.month\.([A-Za-z0-9_]+)/g)]
				.map((match) => fixturePresent(match[1]))
				.filter((code) => code !== row.code && codes.includes(code))
		])
	);
	const ordered: Row[] = [];
	const place = (row: Row, path: Set<string>) => {
		const code = String(row.code);
		if (ordered.includes(row) || path.has(code)) return;
		for (const read of (reads.get(code) ?? []).toSorted())
			place(fixturePresent(rows.find((other) => other.code === read)), new Set([...path, code]));
		ordered.push(row);
	};
	for (const row of rows.toSorted((l, r) => String(l.code).localeCompare(String(r.code))))
		place(row, new Set());
	const out: Record<string, Charge> = {};
	for (const row of ordered) {
		const code = String(row.code);
		const configuration = fixtureValue1(row.configuration);
		const paid = wages.get(code) ?? new Map<string, number>();
		if (configuration.assess_without_wage !== true && [...paid.values()].every((v) => v === 0)) {
			out[code] = null;
			continue;
		}
		const wage = Object.fromEntries(
			[...new Set([...(schemeParts.get(code) ?? ['ordinary']), ...paid.keys()])].map((part) => [
				part,
				paid.get(part) ?? 0
			])
		);
		const result = charge(row, {
			...base,
			wage,
			month: wage,
			year: Object.fromEntries(Object.keys(wage).map((part) => [part, 0])),
			rules,
			lines: [],
			charged,
			elections,
			scheme: { code, standing: '', since: '', elections: elections[code] ?? {} }
		});
		out[code] = result;
		// A refusal stops the whole payslip, as in the engine.
		if (result === 'REFUSED') {
			for (const later of rows) out[String(later.code)] ??= 'REFUSED';
			break;
		}
		if (result !== null) charged.month[code] = { ...result };
	}
	return out;
};
const at = (version: string, code: string, key: string, person: Person, month: Month) =>
	slip(version, key, person, month)[code];
const employment = { classification: 'ORDINARY', service_months: 30, exit_date: '' };
const payslipContext = {
	entry: { facts: {} },
	period: {
		key: '2026-04',
		from: '2026-04-01',
		to: '2026-04-30',
		days: 30,
		paid_days: 30,
		month_key: '2026-04',
		month_from: '2026-04-01',
		month_to: '2026-04-30',
		month_days: 30,
		part: 1,
		parts: 1,
		pay_date: '2026-05-10'
	},
	terms: {
		base_salary: 180000,
		monthly_wage: 180000,
		work_classification: 'ORDINARY',
		statutory_work_category: 'SOCIAL_AND_EMPLOYMENT',
		employment_type: 'INDEFINITE',
		residency_status: 'RESIDENT',
		effective_from: '2026-04-01',
		effective_to: '',
		allowances: fixtureValue4([]),
		facts: fixtureValue5({})
	},
	employee: {
		gender: 'FEMALE',
		date_of_birth: '1990-06-15',
		children: fixtureValue4([]),
		facts: {}
	},
	company: {
		region: 'TOKYO',
		headcount: 60,
		facts: fixtureValue5({ monthly_average_scheduled_hours: 160, wage_deduction_agreement: true })
	},
	headcount: 60,
	employment,
	person: { employment },
	earned: { month: {}, year: {}, previous_month: {}, months: fixtureValue4([]) },
	hours: { month: {}, previous_month: {}, year: {}, rolling: {}, months: fixtureValue4([]) },
	// Two planned days as the engine reads them: 2 hours past an 8-hour shift, and 8 hours on the rest day (no
	// ordinary hours, so all of it is overtime).
	work: {
		overtime_hours: 10,
		incentive_hours: 0,
		dates: ['2026-04-10', '2026-04-12'],
		holidays: [],
		days: fixtureValue4([
			{
				date: '2026-04-10',
				day_type: 'WORK',
				worked: true,
				scheduled_hours: 8,
				worked_hours: 10,
				overtime_hours: 2,
				facts: {},
				intervals: [{ start: '2026-04-10T15:00', end: '2026-04-11T01:00' }]
			},
			{
				date: '2026-04-12',
				day_type: 'REST',
				worked: true,
				scheduled_hours: 0,
				worked_hours: 8,
				overtime_hours: 8,
				facts: {},
				intervals: [{ start: '2026-04-12T09:00', end: '2026-04-12T17:00' }]
			}
		])
	},
	leave: {
		rows: fixtureValue4([
			{
				code: 'UNPAID_LEAVE',
				activity: 'TIME_OFF',
				days: 2,
				from: '2026-04-20',
				to: '2026-04-21',
				is_npl: true,
				can_encash: false
			}
		])
	},
	allowance: { code: 'FIXED_ALLOWANCE', amount: 30000 }
};
/** A month of 70 statutory overtime hours: 3½ hours past each of 20 eight-hour weekdays (at most five a week, so no
 * week passes 40 ordinary hours), the 10 April day running to 01:00, and the 8 rest-day hours of the 12th. */
const seventyHours = {
	...payslipContext.work,
	overtime_hours: 78,
	days: [
		...[
			'01',
			'02',
			'03',
			'06',
			'07',
			'08',
			'09',
			'10',
			'13',
			'14',
			'15',
			'16',
			'17',
			'20',
			'21',
			'22',
			'23',
			'24',
			'27',
			'28'
		].map((day) => ({
			date: `2026-04-${day}`,
			day_type: 'WORK',
			worked: true,
			scheduled_hours: 8,
			worked_hours: 11.5,
			overtime_hours: 3.5,
			facts: {},
			intervals: day === '10' ? [{ start: '2026-04-10T13:30', end: '2026-04-11T01:00' }] : []
		})),
		fixturePresent(payslipContext.work.days[1])
	]
};
/** Rest-day hours added to `seventyHours`: each listed Sunday worked for `hours`. */
const withRestDays = (hours: number, dates: string[]) => ({
	...seventyHours,
	overtime_hours: seventyHours.overtime_hours + hours * dates.length,
	days: [
		...seventyHours.days,
		...dates.map((date) => ({
			...fixturePresent(payslipContext.work.days[1]),
			date,
			worked_hours: hours,
			overtime_hours: hours,
			intervals: []
		}))
	]
});
const entry = (facts: Row, quantity = 1) => ({
	amount: 1000,
	quantity,
	occurred_on: '2026-04-10',
	due_on: '2026-04-30',
	incurred_on: '2026-04-10',
	...facts,
	facts
});
/** Every CEL string a version holds, with where it lives. */
const celOf = (version: string): [string, string][] => {
	const out: [string, string][] = [];
	const walk = (value: unknown, where: string, cel: boolean) => {
		if (typeof value === 'string') {
			if (cel && value !== '') out.push([where, value]);
		} else if (Array.isArray(value)) value.forEach((item, i) => walk(item, `${where}[${i}]`, cel));
		else if (value != null && typeof value === 'object')
			for (const [key, child] of Object.entries(value))
				walk(
					child,
					`${where}.${key}`,
					cel ||
						[
							'eligibility',
							'qualifies_when',
							'quantity',
							'rate',
							'amount',
							'when',
							'employee',
							'employer',
							'assessment',
							'due',
							'days',
							'configuration'
						].includes(key)
				);
	};
	for (const name of ['rule_set', ...CATALOGS])
		for (const row of file(version, name)) {
			const { authority: _a, name: _n, ...rest } = row;
			const configuration = fixtureValue6(rest.configuration);
			const walkable = configuration?.refuse_when
				? {
						...rest,
						configuration: {
							...configuration,
							refuse_when: configuration.refuse_when.map((guard) => ({ when: guard.when }))
						}
					}
				: rest;
			if (name === 'rule_set') {
				const rules = fixtureValue5(rest.rules);
				walk({ due: rules.due }, `${version}/${name}:${String(row.code)}`, false);
			} else walk(walkable, `${version}/${name}:${String(row.code)}`, false);
		}
	return out;
};
/** A structural JSON Schema 2020-12 check: known keywords of the right shape, recursively. */
const schemaProblems = kitSchemaProblems;
const propertiesAt = kitPropertiesAt;
describe('JP public lineage', () => {
	it('every version holds settings, rule_set and every catalogue, each row on its own version', () => {
		assert.equal(versions.length, 16);
		for (const version of versions) {
			for (const name of FILES)
				assert.equal(existsSync(resolve(JP, version, `${name}.json`)), true, `${version}/${name}`);
			const settings = file(version, 'jurisdiction_settings');
			assert.equal(settings.length, 1);
			for (const name of ['rule_set', ...CATALOGS])
				for (const row of file(version, name))
					assert.equal(
						row.settings_id,
						fixturePresent(settings[0]).id,
						`${version}/${name}:${String(row.code)}`
					);
			for (const name of CATALOGS)
				assert.ok(file(version, name).length > 0, `${version}/${name} is empty`);
			assert.deepEqual(fixturePresent(settings[0]).payroll, {
				currency: 'JPY',
				timezone: 'Asia/Tokyo',
				tax_year_start_month: 1,
				...SEEDED_PAYROLL
			});
		}
	});
	it('ids are unique across JP versions and collide with no other lineage', () => {
		const ids = (lineage: string): string[] =>
			readdirSync(resolve(lineages, lineage))
				.filter((entry) => entry.startsWith('version_'))
				.flatMap((version) =>
					readdirSync(resolve(lineages, lineage, version))
						.filter((name) => name.endsWith('.json'))
						.flatMap((name) =>
							fixtureValue4(
								JSON.parse(readFileSync(resolve(lineages, lineage, version, name), 'utf8'))
							).map((row) => String(row.id))
						)
				);
		const own = ids('JP');
		assert.equal(new Set(own).size, own.length);
		const others = new Set(
			readdirSync(lineages)
				.filter((lineage) => lineage !== 'JP')
				.flatMap(ids)
		);
		assert.deepEqual(
			own.filter((id) => others.has(id)),
			[]
		);
	});
	it('the lineage is one contiguous chain of inclusive date ranges, the last open', () => {
		let previous: Row | undefined;
		for (const version of versions) {
			const settings = settingsOf(version);
			const range = fixtureValue7(settings.effective_range);
			if (previous === undefined) assert.equal(settings.cloned_from_id, undefined);
			else {
				assert.equal(settings.cloned_from_id, previous.id);
				const day = new Date(`${fixtureValue8(previous.effective_range).to}T00:00:00Z`);
				day.setUTCDate(day.getUTCDate() + 1);
				assert.equal(range.from, day.toISOString().slice(0, 10));
			}
			assert.ok(range.to === null || range.to >= range.from);
			previous = settings;
		}
		assert.equal(fixtureValue5(settingsOf('version_1').effective_range).from, '2025-12-01');
		assert.equal(fixtureValue5(fixturePresent(previous).effective_range).to, null);
		assert.deepEqual(
			versions.map((version) => fixtureValue5(settingsOf(version).effective_range).from),
			[
				'2025-12-01',
				'2026-01-01',
				'2026-03-01',
				'2026-04-01',
				'2026-07-01',
				'2026-10-01',
				'2026-12-01',
				'2027-01-01',
				'2027-09-01',
				'2027-10-01',
				'2028-09-01',
				'2028-10-01',
				'2029-09-01',
				'2029-10-01',
				'2032-10-01',
				'2035-10-01'
			]
		);
	});
	it('every row carries only its model’s fields, and every value cites its authority', () => {
		for (const version of versions)
			for (const name of FILES) {
				const fields = modelFields(name);
				for (const row of file(version, name)) {
					for (const key of Object.keys(row))
						assert.ok(fields.has(key), `${version}/${name}:${String(row.code)} carries ${key}`);
					const authority =
						name === 'rule_set'
							? fixtureValue5(row.rules).authority
							: name === 'jurisdiction_settings'
								? row.change_summary
								: row.authority;
					assert.ok(
						typeof authority === 'string' && authority.length > 40,
						`${version}/${name}:${String(row.code)}`
					);
				}
			}
	});
	it('codes are stable across versions; the support levy joins from April 2026, the premium adjustment from October', () => {
		const LATER = new Map([
			['CHILD_SUPPORT', 4],
			['CHILD_SUPPORT_BONUS', 4],
			['SI_ADJUSTMENT_REFUND', 6]
		]);
		for (const name of ['rule_set', ...CATALOGS]) {
			const codes = (version: string) =>
				file(version, name)
					.map((row) => String(row.code))
					.filter((code) => !LATER.has(code))
					.join(',');
			for (const version of versions) assert.equal(codes(version), codes('version_1'), name);
		}
		for (const version of versions)
			for (const [code, from] of LATER)
				assert.equal(
					file(version, 'statutory_contribution_catalog').some((row) => row.code === code),
					Number(version.slice(8)) >= from,
					`${version} ${code}`
				);
	});
	it('both input schemas are JSON Schema 2020-12 and declare every fact the CEL reads', () => {
		for (const version of versions) {
			const settings = settingsOf(version);
			const employee = fixtureValue5(settings.employee_input_schema);
			const entity = fixtureValue5(settings.entity_input_schema);
			for (const [name, schema] of [
				['employee', employee],
				['entity', entity]
			] as const) {
				assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
				assert.equal(schema.type, 'object');
				assert.deepEqual(schemaProblems(schema, `${version} ${name}`), []);
			}
			// The one layout every lineage shares (employment_facts.ts reads elections at exactly this path).
			assert.deepEqual(Object.keys(fixtureValue5(employee.properties)).toSorted(), [
				'contract_terms',
				'employment_statutory_facts',
				'exit_facts',
				'facts'
			]);
			const terms = propertiesAt(employee, 'properties', 'contract_terms', 'items');
			const elections = new Set(electionKeysOf(employee));
			assert.deepEqual([...elections].toSorted(), ELECTIONS);
			for (const column of ['region', 'risk_class'])
				assert.equal(propertiesAt(entity).has(column), false);
			const declared: Record<string, Set<string>> = {
				'employee.facts': propertiesAt(employee, 'properties', 'facts'),
				'company.facts': propertiesAt(entity),
				'scheme.elections': elections,
				elections,
				terms: new Set([...terms, 'monthly_wage', 'facts'])
			};
			const enums = (key: string) =>
				fixturePresent(
					fixtureValue9(fixtureRecord(employee.properties).contract_terms).items.properties[key]
				).enum;
			assert.deepEqual(enums('residency_status'), ['RESIDENT', 'NON_RESIDENT']);
			assert.deepEqual(enums('statutory_work_category'), [
				'SOCIAL_AND_EMPLOYMENT',
				'SOCIAL_ONLY',
				'EMPLOYMENT_ONLY',
				'NONE'
			]);
			let reads = 0;
			for (const [where, cel] of celOf(version))
				for (const [, root, key, election] of cel.matchAll(
					/\b(employee\.facts|company\.facts|scheme\.elections|terms)\.(\w+)|\belections\.[A-Z_]+\.(\w+)/g
				)) {
					reads++;
					const set =
						root == null ? fixturePresent(declared.elections) : fixturePresent(declared[root]);
					const name = root == null ? fixturePresent(election) : fixturePresent(key);
					assert.equal(
						set.has(name),
						true,
						`${where} reads undeclared ${root ?? 'elections'}.${name}`
					);
				}
			assert.ok(reads > 60);
			// The settings' prefecture table is the region vocabulary the CEL reads.
			const prefectures = Object.keys(fixtureValue10(settings.reference_tables).PREFECTURE);
			assert.equal(prefectures.length, 47);
			const wage = fixturePresent(
				file(version, 'rule_set').find((row) => row.code === 'minimum_wage')
			);
			assert.deepEqual(Object.keys(fixtureValue11(wage.rules).by_region), prefectures);
		}
	});
	for (const version of versions) {
		it(`every CEL expression evaluates on the context its engine surface supplies: ${version}`, () => {
			const people: Person[] = [
				{},
				{ dob: '1980-01-01' },
				{ dob: '1950-01-01' },
				{ dob: '1955-03-20' },
				{ category: 'EMPLOYMENT_ONLY' },
				{ category: 'SOCIAL_ONLY', classification: 'OFFICER' },
				{ category: 'NONE', residency: 'NON_RESIDENT' },
				{
					elections: {
						INCOME_TAX: { dependency_declaration_filed: true, withholding_dependants: 9 }
					}
				},
				{
					elections: {
						HEALTH: { standard_monthly_remuneration: 1390000 },
						RESIDENT_TAX: { monthly_amount: 9000 }
					}
				},
				{
					exit_date: '2026-04-15',
					elections: { RETIREMENT_TAX: { retirement_income_declaration_filed: true } }
				}
			];
			const months: Month[] = [
				{},
				{ ordinary: 50000 },
				{ ordinary: 300000, commuting: 20000 },
				{ ordinary: 3000000, commuting: 200000 },
				{ bonus: 800000 },
				{ ordinary: 250000, bonus: 9000000 },
				{ retirement: 25000000 }
			];
			const key = String(fixtureValue5(settingsOf(version).effective_range).from).slice(0, 7);
			for (const person of people)
				for (const month of months)
					for (const [code, result] of Object.entries(slip(version, key, person, month))) {
						const row = { code };
						if (result === null || result === 'REFUSED') continue;
						// A year-end adjustment refunds; the premium recovery and the adjustment refund reverse an employer advance.
						const signed = [
							'YEAR_END_ADJUSTMENT',
							'SI_PREVIOUS_MONTH',
							'SI_ADJUSTMENT_REFUND'
						].includes(code);
						assert.ok(
							Number.isFinite(result.employee) &&
								Number.isFinite(result.employer) &&
								(signed || (result.employee >= 0 && result.employer >= 0)),
							`${version} ${String(row.code)} ${JSON.stringify([person, month, result])}`
						);
					}
			for (const row of [...file(version, 'work_catalog'), ...file(version, 'allowance_catalog')])
				for (const field of ['eligibility', 'quantity', 'rate', 'amount'])
					if (typeof row[field] === 'string' && row[field] !== '')
						assert.notEqual(
							evaluateConfigured(
								fixtureString(String(row[field])),
								fixtureContext({
									...payslipContext,
									rules: payrollRules(version)
								})
							),
							undefined
						);
			for (const name of ['adhoc_catalog', 'claim_catalog', 'loan_catalog'])
				for (const row of file(version, name))
					for (const facts of [{ average_daily_wage: 10000, notice_days_given: 10 }, {}]) {
						const context = {
							...payslipContext,
							rules: payrollRules(version),
							entry: entry(facts, 2)
						};
						for (const field of ['eligibility', 'qualifies_when'])
							if (typeof row[field] === 'string' && row[field] !== '')
								assert.equal(
									typeof evaluateConfigured(
										fixtureString(String(row[field])),
										fixtureContext(context)
									),
									'boolean'
								);
						for (const band of fixtureValue12(row.bands ?? []))
							if (evaluateConfigured(fixtureString(band.when), fixtureContext(context)) === true)
								assert.equal(
									typeof evaluateConfigured(fixtureString(band.amount), fixtureContext(context)),
									'number'
								);
					}
			for (const row of file(version, 'leave_catalog'))
				if (row.eligibility !== '')
					assert.equal(
						typeof evaluateConfigured(
							fixtureString(String(row.eligibility)),
							fixtureContext(payslipContext)
						),
						'boolean'
					);
		});
	}
	it('health and nursing care: the 協会けんぽ prefectural rate on the standard monthly remuneration', () => {
		const salary = (wage: number): Month => ({ ordinary: wage });
		// FY2025 Tokyo 9.91%: grade 22 (300,000) → 29,730, half 14,865.
		assert.deepEqual(at('version_1', 'HEALTH', '2025-12', {}, salary(300000)), {
			employee: 14865,
			employer: 14865
		});
		// FY2026 Tokyo 9.85% + nursing 1.62% at 45: the 協会けんぽ table's 34,410 / 17,205.
		assert.deepEqual(at('version_4', 'HEALTH', '2026-04', { dob: '1981-01-10' }, salary(300000)), {
			employee: 17205,
			employer: 17205
		});
		// Grade 1 (under 63,000): 5,713 total, 2,856.5 → 2,856 (50 sen drops), employer 2,857.
		assert.deepEqual(at('version_4', 'HEALTH', '2026-04', {}, salary(62999)), {
			employee: 2856,
			employer: 2857
		});
		assert.deepEqual(at('version_4', 'HEALTH', '2026-04', {}, salary(63000)), {
			employee: 3349,
			employer: 3349
		});
		// The decided grade governs over the paid wage; Osaka 10.13% on 1,390,000 (grade 50): 140,807 → 70,403.5 → 70,403.
		assert.deepEqual(
			at(
				'version_4',
				'HEALTH',
				'2026-04',
				{ region: 'OSAKA', elections: { HEALTH: { standard_monthly_remuneration: 1390000 } } },
				salary(100000)
			),
			{ employee: 70403, employer: 70404 }
		);
		// Nursing from the month the day before the 40th birthday falls in: born 2 May → May, born 1 May → April.
		assert.deepEqual(at('version_4', 'HEALTH', '2026-04', { dob: '1986-05-02' }, salary(300000)), {
			employee: 14775,
			employer: 14775
		});
		assert.deepEqual(at('version_4', 'HEALTH', '2026-05', { dob: '1986-05-02' }, salary(300000)), {
			employee: 17205,
			employer: 17205
		});
		assert.deepEqual(at('version_4', 'HEALTH', '2026-04', { dob: '1986-05-01' }, salary(300000)), {
			employee: 17205,
			employer: 17205
		});
		// At 75 the person leaves employee health insurance; the exit month (loss mid-month) is not charged.
		assert.equal(at('version_4', 'HEALTH', '2026-04', { dob: '1951-04-10' }, salary(300000)), null);
		assert.equal(
			at('version_4', 'HEALTH', '2026-04', { exit_date: '2026-04-20' }, salary(300000)),
			null
		);
		assert.notEqual(
			at('version_4', 'HEALTH', '2026-04', { exit_date: '2026-04-30' }, salary(300000)),
			null
		);
		// 同月得喪: hired and gone in the same month is still charged.
		assert.notEqual(
			at(
				'version_4',
				'HEALTH',
				'2026-04',
				{ start_date: '2026-04-06', exit_date: '2026-04-20' },
				salary(300000)
			),
			null
		);
		// Standard bonus: under 1,000 dropped. 1,234,567 → 1,234,000 × 9.85% / 2 = 60,774.5 → 60,774.
		assert.deepEqual(at('version_4', 'HEALTH_BONUS', '2026-04', {}, { bonus: 1234567 }), {
			employee: 60774,
			employer: 60775
		});
		assert.equal(
			at('version_4', 'HEALTH', '2026-04', { region: 'EDO' }, salary(300000)),
			'REFUSED'
		);
		assert.equal(at('version_4', 'HEALTH', '2026-04', { dob: '' }, salary(300000)), 'REFUSED');
		assert.equal(at('version_4', 'HEALTH', '2026-04', { category: 'NONE' }, salary(300000)), null);
	});
	it('the support levy, welfare pension, child contribution and labour insurance', () => {
		assert.deepEqual(at('version_4', 'CHILD_SUPPORT', '2026-04', {}, { ordinary: 300000 }), {
			employee: 345,
			employer: 345
		});
		assert.deepEqual(at('version_4', 'PENSION', '2026-04', {}, { ordinary: 300000 }), {
			employee: 27450,
			employer: 27450
		});
		// Pension floor grade 88,000 and ceiling 650,000; the bonus cap is 1,500,000 a month.
		assert.deepEqual(at('version_4', 'PENSION', '2026-04', {}, { ordinary: 60000 }), {
			employee: 8052,
			employer: 8052
		});
		assert.deepEqual(at('version_4', 'PENSION', '2026-04', {}, { ordinary: 2000000 }), {
			employee: 59475,
			employer: 59475
		});
		assert.deepEqual(at('version_4', 'PENSION_BONUS', '2026-04', {}, { bonus: 2000000 }), {
			employee: 137250,
			employer: 137250
		});
		assert.equal(
			at('version_4', 'PENSION', '2026-04', { dob: '1956-04-20' }, { ordinary: 300000 }),
			null
		);
		assert.deepEqual(at('version_4', 'CHILD_CONTRIBUTION', '2026-04', {}, { ordinary: 300000 }), {
			employee: 0,
			employer: 1080
		});
		// Employment insurance on every wage: 5.5/9 per mille in FY2025, 5/8.5 from April 2026; construction 6/10.5.
		assert.deepEqual(at('version_1', 'EI', '2025-12', {}, { ordinary: 300000 }), {
			employee: 1650,
			employer: 2700
		});
		assert.deepEqual(at('version_4', 'EI', '2026-04', {}, { ordinary: 300000 }), {
			employee: 1500,
			employer: 2550
		});
		assert.deepEqual(
			at(
				'version_4',
				'EI',
				'2026-04',
				{ company: { ei_industry_class: 'CONSTRUCTION', workers_accident_rate_per_mille: 9.5 } },
				{ ordinary: 300100 }
			),
			{ employee: 1801, employer: 3151 }
		);
		// 0.5 yen at 5/1000 drops: 300,100 × 0.005 = 1,500.5 → 1,500.
		assert.deepEqual(at('version_4', 'EI', '2026-04', {}, { ordinary: 300100 }), {
			employee: 1500,
			employer: 2550
		});
		assert.equal(
			at('version_4', 'EI', '2026-04', { category: 'SOCIAL_ONLY' }, { ordinary: 300000 }),
			null
		);
		assert.deepEqual(at('version_4', 'WORKERS_ACCIDENT', '2026-04', {}, { ordinary: 300000 }), {
			employee: 0,
			employer: 900
		});
		assert.equal(
			at('version_4', 'WORKERS_ACCIDENT', '2026-04', { company: {} }, { ordinary: 300000 }),
			'REFUSED'
		);
		assert.deepEqual(at('version_4', 'ASBESTOS_LEVY', '2026-04', {}, { ordinary: 300000 }), {
			employee: 0,
			employer: 6
		});
	});
	it('withholding: 甲欄 by the electronic method, 乙欄 by the table, bonus rates and non-residents', () => {
		const declared = { dependency_declaration_filed: true, withholding_dependants: 1 };
		// The previous period's salary-run pay and premiums (earned.previous_month): 300,000 − 46,500 = 253,500.
		const previous = {
			month: {},
			year: {},
			previous_month: {
				gross: 300000,
				statutory: {
					HEALTH: { employee: 17205 },
					CHILD_SUPPORT: { employee: 345 },
					PENSION: { employee: 27450 },
					EI: { employee: 1500 }
				}
			}
		};
		const person = {
			dob: '1981-01-10',
			elections: { INCOME_TAX: declared },
			monthly_wage: 300000,
			earned: previous
		};
		// 300,000 less 17,205 + 345 + 27,450 + 1,500 = 253,500; 2026 甲 1 dependant:
		// 253,500 − (253,500 × 30% + 6,667) − 48,334 − 31,667 = 90,782 × 5.105% = 4,634.4 → 4,630.
		assert.deepEqual(at('version_4', 'INCOME_TAX', '2026-04', person, { ordinary: 300000 }), {
			employee: 4630,
			employer: 0
		});
		// 2025 tables, Tokyo 9.91% and no nursing at 35: 300,000 − (14,865 + 27,450 + 1,650) = 256,035;
		// 256,035 − 83,478 − 40,000 − 31,667 = 100,890 × 5.105% = 5,150.4 → 5,150.
		assert.deepEqual(
			at(
				'version_1',
				'INCOME_TAX',
				'2025-12',
				{ ...person, dob: '1990-01-10' },
				{ ordinary: 300000 }
			),
			{ employee: 5150, employer: 0 }
		);
		// 乙欄 (no declaration): 2026 row 251,000–254,000 is 36,600.
		assert.deepEqual(
			at('version_4', 'INCOME_TAX', '2026-04', { ...person, elections: {} }, { ordinary: 300000 }),
			{ employee: 36600, employer: 0 }
		);
		// A 従たる給与 declaration with 2 dependants: 36,600 − 2 × 1,610.
		assert.deepEqual(
			at(
				'version_4',
				'INCOME_TAX',
				'2026-04',
				{ ...person, elections: { INCOME_TAX: { secondary_dependants: 2 } } },
				{ ordinary: 300000 }
			),
			{ employee: 36600 - 3220, employer: 0 }
		);
		// The commuting allowance is exempt up to 150,000; non-residents 20.42% of the taxable pay.
		assert.deepEqual(
			at(
				'version_4',
				'INCOME_TAX',
				'2026-04',
				{ ...person, residency: 'NON_RESIDENT' },
				{
					ordinary: 300000,
					commuting: 160000
				}
			),
			{ employee: 63302, employer: 0 }
		);
		// Bonus 500,000 after 28,675 + 575 + 45,750 + 2,500 = 422,500; previous month 253,500 with 1 dependant
		// falls in 250,000–289,000 → 4.084% → 17,254.
		assert.deepEqual(at('version_4', 'INCOME_TAX', '2026-04', person, { bonus: 500000 }), {
			employee: 17254,
			employer: 0
		});
		// 乙 bonus rate for a previous month of 253,500: 224,000–295,000 → 20.42%.
		assert.deepEqual(
			at('version_4', 'INCOME_TAX', '2026-04', { ...person, elections: {} }, { bonus: 500000 }),
			{ employee: 86274, employer: 0 }
		);
		// No salary the previous month (別表第三 備考4): the 月額表 on one sixth — 70,416 is under the 甲 1-dependant floor.
		const { earned: _previousSalary, ...withoutPreviousSalary } = person;
		assert.deepEqual(
			at('version_4', 'INCOME_TAX', '2026-04', withoutPreviousSalary, { bonus: 500000 }),
			{ employee: 0, employer: 0 }
		);
		// A car commuter (30 km, parking 8,000): 19,700 + 5,000 is exempt from April 2026, the other 5,300 taxed.
		// 300,000 + 5,300 − (17,205 + 345 + 27,450 + 1,650) = 258,650 → 94,387 × 5.105% → 4,820.
		assert.deepEqual(
			at(
				'version_4',
				'INCOME_TAX',
				'2026-04',
				{ ...person, terms_facts: { commute_car_km_one_way: 30, commute_parking_fee: 8000 } },
				{ ordinary: 300000, commuting: 30000 }
			),
			{ employee: 4820, employer: 0 }
		);
		// A bonus above ten times the previous month goes through the 月額表 on one sixth.
		const big = fixtureValue13(
			at(
				'version_4',
				'INCOME_TAX',
				'2026-04',
				{ ...person, monthly_wage: 100000 },
				{
					bonus: 2000000
				}
			)
		);
		assert.ok(big.employee > 0);
		assert.equal(
			at('version_4', 'INCOME_TAX', '2026-04', { ...person, residency: 'ALIEN' }, { ordinary: 1 }),
			'REFUSED'
		);
	});
	it('retirement income withholding and resident tax special collection', () => {
		const ten = {
			service_months: 120,
			elections: { RETIREMENT_TAX: { retirement_income_declaration_filed: true } }
		};
		// 5,000,000 − 4,000,000 = 1,000,000; half 500,000 × 5% × 102.1% = 25,525.
		assert.deepEqual(at('version_4', 'RETIREMENT_TAX', '2026-04', ten, { retirement: 5000000 }), {
			employee: 25525,
			employer: 0
		});
		// Four years: 1,600,000 deduction; 6,000,000 − 1,600,000 = 4,400,000 → 1,500,000 + 1,400,000 = 2,900,000.
		assert.deepEqual(
			at(
				'version_4',
				'RETIREMENT_TAX',
				'2026-04',
				{ ...ten, service_months: 40 },
				{ retirement: 6000000 }
			),
			{ employee: Math.floor((2900000 * 0.1 - 97500) * 1.021), employer: 0 }
		);
		assert.deepEqual(
			at(
				'version_4',
				'RETIREMENT_TAX',
				'2026-04',
				{ service_months: 120 },
				{ retirement: 5000000 }
			),
			{ employee: 1021000, employer: 0 }
		);
		// A specified officer of 4 years: no halving — 6,000,000 − 1,600,000 = 4,400,000 × 20% − 427,500 = 452,500 × 102.1%.
		assert.deepEqual(
			at(
				'version_4',
				'RETIREMENT_TAX',
				'2026-04',
				{
					service_months: 40,
					elections: {
						RETIREMENT_TAX: { retirement_income_declaration_filed: true, specified_officer: true }
					}
				},
				{ retirement: 6000000 }
			),
			{ employee: Math.floor(452500 * 1.021), employer: 0 }
		);
		// Retiring on becoming disabled: 1,000,000 more deduction — 5,000,000 − 5,000,000 = 0.
		assert.deepEqual(
			at(
				'version_4',
				'RETIREMENT_TAX',
				'2026-04',
				{
					service_months: 120,
					elections: {
						RETIREMENT_TAX: {
							retirement_income_declaration_filed: true,
							retirement_due_to_disability: true
						}
					}
				},
				{ retirement: 5000000 }
			),
			{ employee: 0, employer: 0 }
		);
		const notice = { elections: { RESIDENT_TAX: { june_amount: 12300, monthly_amount: 12000 } } };
		assert.deepEqual(at('version_4', 'RESIDENT_TAX', '2026-06', notice, { ordinary: 300000 }), {
			employee: 12300,
			employer: 0
		});
		assert.deepEqual(at('version_4', 'RESIDENT_TAX', '2026-07', notice, { ordinary: 300000 }), {
			employee: 12000,
			employer: 0
		});
		assert.equal(at('version_4', 'RESIDENT_TAX', '2026-07', {}, { ordinary: 300000 }), null);
	});
	it('work lines: overtime 125% / 150% over 60 hours, unpaid absence and the minimum wage top-up', () => {
		const line = (version: string, code: string, context: Row = payslipContext) => {
			const row = fixturePresent(file(version, 'work_catalog').find((item) => item.code === code));
			const full = {
				...context,
				rules: payrollRules(version)
			};
			if (evaluateConfigured(fixtureString(String(row.eligibility)), fixtureContext(full)) !== true)
				return 0;
			return (
				Number(evaluateConfigured(fixtureString(String(row.quantity)), fixtureContext(full))) *
				Number(evaluateConfigured(fixtureString(String(row.rate)), fixtureContext(full)))
			);
		};
		// 180,000 / 160 = 1,125 an hour: 60 h × 1,406 (1,406.25) and 10 h × 1,688 (1,687.5).
		const seventy = { ...payslipContext, work: seventyHours };
		assert.equal(line('version_4', 'OVERTIME', seventy), 60 * 1406);
		assert.equal(line('version_4', 'OVERTIME_OVER_60', seventy), 10 * 1688);
		assert.equal(line('version_4', 'WITHIN_HOURS_OVERTIME', seventy), 0);
		assert.equal(line('version_4', 'OVERTIME'), 2 * 1406);
		assert.equal(line('version_4', 'NO_PAY_LEAVE'), 12000);
		// Every rest-day hour at 135% (1,518.75 → 1,519); late-night 22:00–01:00 = 3 h × 281 (281.25, 25%).
		assert.equal(line('version_4', 'REST_DAY_WORK'), 8 * 1519);
		assert.equal(line('version_4', 'NIGHT_WORK'), 3 * 281);
		assert.equal(line('version_1', 'NIGHT_WORK'), 3 * 281);
		// Ten hours past the schedule on each of seven days (six of them one week) and 3 on the rest day: 70 statutory hours
		// off the rest day (the sixth day's ordinary hours pass 40 but are never more than the approved overtime), 8 of
		// the 10 beyond 60 substituted by 2 hours of 代替休暇, and the rest-day hours at 135%.
		for (const version of versions) {
			const planned = {
				...payslipContext,
				company: {
					...payslipContext.company,
					facts: { ...payslipContext.company.facts, substitute_leave_agreement: true }
				},
				work: {
					...payslipContext.work,
					overtime_hours: 73,
					days: [
						...['06', '07', '08', '09', '10', '11', '13'].map((day) => ({
							date: `2026-04-${day}`,
							day_type: 'WORK',
							worked: true,
							scheduled_hours: 8,
							worked_hours: 18,
							overtime_hours: 10,
							facts: {},
							intervals: []
						})),
						{
							...fixturePresent(payslipContext.work.days[1]),
							worked_hours: 3,
							overtime_hours: 3,
							intervals: []
						}
					]
				},
				leave: {
					rows: [
						{
							code: 'SUBSTITUTE_LEAVE_FOR_OVERTIME',
							activity: 'TIME_OFF',
							days: 2,
							from: '2026-04-20',
							to: '2026-04-20'
						}
					]
				}
			};
			assert.equal(line(version, 'OVERTIME', planned), 60 * 1406, version);
			assert.equal(line(version, 'OVERTIME_OVER_60', planned), 10 * 1688);
			assert.equal(line(version, 'OVERTIME_SUBSTITUTED', planned), 8 * 281);
			assert.equal(line(version, 'WITHIN_HOURS_OVERTIME', planned), 0);
			assert.equal(line(version, 'REST_DAY_WORK', planned), 3 * 1519);
		}
		// Tokyo 1,226 until 30 September 2026, 1,280 from 1 October: 160 h × (1,226 − 1,125).
		assert.equal(Math.round(line('version_4', 'MINIMUM_WAGE_TOP_UP')), 160 * 101);
		const october = {
			...payslipContext,
			period: {
				key: '2026-10',
				from: '2026-10-01',
				to: '2026-10-31',
				days: 31,
				paid_days: 31,
				parts: 1,
				month_days: 31
			}
		};
		assert.equal(Math.round(line('version_5', 'MINIMUM_WAGE_TOP_UP', october)), 160 * 155);
		const manager = {
			...payslipContext,
			terms: { ...payslipContext.terms, work_classification: 'MANAGERIAL' }
		};
		assert.equal(line('version_4', 'OVERTIME', manager), 0);
		assert.equal(line('version_4', 'REST_DAY_WORK', manager), 0);
		assert.equal(line('version_4', 'NIGHT_WORK', manager), 3 * 281);
		// One effective-dated rule in every version: the amount in force on the period's last day.
		const inForce = (version: string, region: string, day: string) =>
			evaluateConfigured(
				fixtureString(
					'double(first(rules.minimum_wage.by_region[company.region].filter(e, e["from"] <= period.to)).amount)'
				),
				fixtureContext({
					rules: payrollRules(version),
					company: { region },
					period: { to: day }
				})
			);
		const rule = (version: string) =>
			fixturePresent(file(version, 'rule_set').find((r) => r.code === 'minimum_wage')).rules;
		for (const version of versions) assert.deepEqual(rule(version), rule('version_1'));
		assert.equal(inForce('version_1', 'YAMAGATA', '2025-12-22'), 955);
		assert.equal(inForce('version_1', 'YAMAGATA', '2025-12-31'), 1032);
		assert.equal(inForce('version_3', 'GUNMA', '2026-03-31'), 1063);
		assert.equal(inForce('version_3', 'AKITA', '2026-03-30'), 951);
		assert.equal(inForce('version_3', 'AKITA', '2026-03-31'), 1031);
		assert.equal(inForce('version_5', 'NAGANO', '2026-10-31'), 1117);
		assert.equal(inForce('version_5', 'FUKUOKA', '2026-10-31'), 1114);
		assert.equal(inForce('version_5', 'OKINAWA', '2026-11-30'), 1023);
		assert.equal(inForce('version_5', 'OKINAWA', '2026-12-31'), 1086);
		assert.throws(() => inForce('version_1', 'YAMAGATA', '2024-01-31'));
	});
	it('ad hoc lines: the shutdown allowance floor, injury waiting days and pay in lieu of notice', () => {
		const amount = (code: string, facts: Row, quantity: number) => {
			const row = fixturePresent(
				file('version_4', 'adhoc_catalog').find((item) => item.code === code)
			);
			const band = fixturePresent(fixtureValue12(row.bands)[0]);
			const context = { ...payslipContext, entry: entry(facts, quantity) };
			return evaluateConfigured(fixtureString(band.when), fixtureContext(context)) === true
				? Number(evaluateConfigured(fixtureString(band.amount), fixtureContext(context)))
				: 1000;
		};
		assert.equal(amount('SHUTDOWN_ALLOWANCE', { average_daily_wage: 10000 }, 5), 30000);
		assert.equal(amount('INJURY_WAITING_COMPENSATION', { average_daily_wage: 10000 }, 5), 18000);
		assert.equal(
			amount('DISMISSAL_NOTICE_ALLOWANCE', { average_daily_wage: 10000, notice_days_given: 10 }, 1),
			200000
		);
		assert.equal(amount('SHUTDOWN_ALLOWANCE', {}, 5), 1000);
	});
	it('annual leave grants follow 労働基準法 art.39 and are neither encashable nor settled on exit', () => {
		const annual = fixturePresent(
			file('version_4', 'leave_catalog').find((row) => row.code === 'ANNUAL_LEAVE')
		);
		const entitlement = fixtureValue14(annual.entitlement);
		const days = (service_months: number, facts: Row = {}) =>
			evaluateConfigured(
				fixtureString(entitlement.days),
				fixtureContext({
					service_months,
					bands: entitlement.bands,
					terms: { facts },
					attendance: { window: { months: [] }, previous: { months: [] } }
				})
			);
		assert.deepEqual(
			[5, 6, 17, 18, 30, 42, 54, 66, 77, 78, 400].map((months) => days(months)),
			[0, 10, 10, 11, 12, 14, 16, 18, 18, 20, 20]
		);
		// 施行規則 art.24の3: 3 days and 24 hours a week; 4 days but 32 hours is a full grant.
		const three = { weekly_scheduled_days: 3, weekly_scheduled_hours: 24 };
		assert.deepEqual(
			[5, 6, 18, 30, 42, 54, 66, 78].map((months) => days(months, three)),
			[0, 5, 6, 6, 8, 9, 10, 11]
		);
		assert.equal(days(6, { weekly_scheduled_days: 1, weekly_scheduled_hours: 6 }), 1);
		assert.equal(days(78, { weekly_scheduled_days: 4, weekly_scheduled_hours: 28 }), 15);
		assert.equal(days(78, { weekly_scheduled_days: 4, weekly_scheduled_hours: 32 }), 20);
		assert.equal(fixtureValue5(entitlement).window, 'SERVICE_YEAR');
		assert.equal(annual.can_encash, false);
		assert.equal(annual.encash_on_exit, false);
	});
	it('validations, payslip warnings and the 2027 withholding tables', () => {
		const validation = (version: string, code: string) =>
			fixtureValue15(
				fixturePresent(
					file(version, 'rule_set').find((row) => row.family === 'VALIDATIONS' && row.code === code)
				).rules
			);
		for (const version of versions) {
			const checks = file(version, 'rule_set').filter(
				(row) => row.family === 'VALIDATIONS' && fixtureValue5(row.rules).site !== 'roster'
			);
			assert.deepEqual(checks.map((row) => row.code).toSorted(), [
				'CHILDCARE_CARE_LIMITS',
				'DAYTIME_STUDENT_EI',
				'DIGITAL_WAGE_CONSENT',
				'DISCIPLINARY_DEDUCTION_LIMIT',
				'EI_COVERAGE_HOURS',
				'MATERNITY_LIMITS',
				'MINIMUM_WAGE_CONTRACT',
				'MINOR_LIMITS',
				'OVERTIME_80H_NOTICE',
				'OVERTIME_AVERAGE_80H',
				'OVERTIME_MONTHLY_45H',
				'OVERTIME_REST_DAY_100H',
				'OVERTIME_SIX_MONTHS_OVER_45',
				'OVERTIME_WITHOUT_AGREEMENT',
				'OVERTIME_YEAR_360H',
				'OVERTIME_YEAR_720H',
				'SHORT_TIME_COVERAGE',
				'WAGE_PAYMENT_MONTHLY'
			]);
			for (const check of checks) {
				const rules = fixtureValue5(check.rules);
				assert.ok(['contract', 'payslip'].includes(String(rules.site)));
				assert.ok(['refuse', 'warn', 'hold'].includes(String(rules.kind)));
				assert.ok(String(rules.message).length > 20 && String(rules.authority).length > 40);
			}
		}
		// 36 agreement limits (労働基準法 art.36): 70 h overtime is over 45; with 8 rest-day hours it stays under 100.
		const slip = { ...payslipContext, work: seventyHours, rules: payrollRules('version_4') };
		const trips = (code: string, context: Row) =>
			evaluateConfigured(
				fixtureString(validation('version_4', code).when),
				fixtureContext(context)
			);
		assert.equal(trips('OVERTIME_MONTHLY_45H', slip), true);
		assert.equal(trips('OVERTIME_REST_DAY_100H', slip), false);
		assert.equal(
			// 70 + 8 + 2 × 11 rest-day hours reaches 100.
			trips('OVERTIME_REST_DAY_100H', {
				...slip,
				work: withRestDays(11, ['2026-04-19', '2026-04-26'])
			}),
			true
		);
		assert.equal(
			trips('OVERTIME_MONTHLY_45H', {
				...slip,
				terms: { ...slip.terms, work_classification: 'MANAGERIAL' }
			}),
			false
		);
		// The agreement year from its own start (company.facts.overtime_agreement_from) over hours.months, this month
		// included: a 1 April agreement counts April 2026 onward in December 2026.
		const months = (from: string, values: number[]) =>
			values.map((overtime_hours, i) => {
				const [y, m] = fixtureValue0(from.split('-').map(Number));
				const day = new Date(Date.UTC(y, m - 1 + i, 1));
				return {
					month: day.toISOString().slice(0, 7),
					overtime_hours,
					worked_hours: 160 + overtime_hours
				};
			});
		const yearOf = (
			values: number[],
			company: Row = { overtime_agreement_from: '2026-04-01' },
			sector?: string
		) => ({
			...slip,
			period: { ...slip.period, key: '2026-12', month_key: '2026-12', month_from: '2026-12-01' },
			company: {
				...slip.company,
				facts: { ...slip.company.facts, ...company, ...(sector ? { overtime_sector: sector } : {}) }
			},
			hours: {
				...slip.hours,
				month: { overtime_hours: values.at(-1) },
				months: months('2026-01', values)
			}
		});
		// Jan–Mar belong to the previous agreement year: 3 × 50 + 9 × 40 = 510 overall, 360 from April.
		const twelve = [50, 50, 50, 40, 40, 40, 40, 40, 40, 40, 40, 40];
		assert.equal(trips('OVERTIME_YEAR_360H', yearOf(twelve)), false);
		assert.equal(trips('OVERTIME_YEAR_360H', yearOf(twelve, {})), true);
		assert.equal(trips('OVERTIME_YEAR_360H', yearOf([...twelve.slice(0, 11), 41])), true);
		assert.equal(
			trips(
				'OVERTIME_YEAR_360H',
				yearOf(
					twelve.map(() => 99),
					{},
					'NEW_TECH_RD'
				)
			),
			false
		);
		const heavy = [0, 0, 0, 80, 80, 80, 80, 80, 80, 80, 80, 81];
		assert.equal(trips('OVERTIME_YEAR_720H', yearOf(heavy)), true);
		assert.equal(trips('OVERTIME_YEAR_720H', yearOf(heavy, undefined, 'DRIVER')), false);
		assert.equal(trips('OVERTIME_YEAR_720H', yearOf(twelve)), false);
		// Six months above 45 hours at most in the agreement year; the seventh warns.
		const seven = [0, 0, 0, 46, 46, 46, 46, 46, 46, 46, 10, 10];
		assert.equal(trips('OVERTIME_SIX_MONTHS_OVER_45', yearOf(seven)), true);
		assert.equal(
			trips('OVERTIME_SIX_MONTHS_OVER_45', yearOf([...seven.slice(0, 9), 10, 10, 10])),
			false
		);
		// 2- to 6-month averages: 90 + 75 averages 82.5 over two months; 81 × 3 over three; 80 flat stays lawful.
		assert.equal(trips('OVERTIME_AVERAGE_80H', yearOf([...Array(10).fill(0), 75, 90])), true);
		assert.equal(trips('OVERTIME_AVERAGE_80H', yearOf([...Array(9).fill(0), 81, 81, 81])), true);
		assert.equal(
			trips('OVERTIME_AVERAGE_80H', yearOf([...Array(6).fill(0), 80, 80, 80, 80, 80, 80])),
			false
		);
		assert.equal(
			trips(
				'OVERTIME_AVERAGE_80H',
				yearOf([...Array(10).fill(0), 75, 90], { disaster_recovery_work: true })
			),
			false
		);
		const agreement = (to: string) => ({
			...slip,
			company: { ...slip.company, facts: { ...slip.company.facts, overtime_agreement_to: to } }
		});
		assert.equal(trips('OVERTIME_WITHOUT_AGREEMENT', agreement('2026-03-31')), true);
		assert.equal(trips('OVERTIME_WITHOUT_AGREEMENT', agreement('2027-03-31')), false);
		assert.equal(trips('OVERTIME_WITHOUT_AGREEMENT', slip), false);
		// 70 statutory + 8 rest-day hours is under 80; 3 more rest-day hours pass it (労働安全衛生法 art.66の8).
		assert.equal(trips('OVERTIME_80H_NOTICE', slip), false);
		assert.equal(
			trips('OVERTIME_80H_NOTICE', { ...slip, work: withRestDays(3, ['2026-04-19']) }),
			true
		);
		// Overtime within the legal hours (7 scheduled, 8 worked) needs no 36 agreement and is lawful for a minor.
		const within = {
			...slip,
			work: {
				...payslipContext.work,
				overtime_hours: 1,
				days: [
					{
						...fixturePresent(payslipContext.work.days[0]),
						scheduled_hours: 7,
						worked_hours: 8,
						overtime_hours: 1,
						intervals: [{ start: '2026-04-10T09:00', end: '2026-04-10T17:00' }]
					}
				]
			}
		};
		assert.equal(
			trips('OVERTIME_WITHOUT_AGREEMENT', { ...within, company: agreement('2026-03-31').company }),
			false
		);
		// Minors, pregnant workers on request, childcare and care limits.
		const minor = { ...slip, employee: { ...slip.employee, date_of_birth: '2009-01-01' } };
		assert.equal(trips('MINOR_LIMITS', minor), true);
		assert.equal(trips('MINOR_LIMITS', slip), false);
		assert.equal(trips('MINOR_LIMITS', { ...within, employee: minor.employee }), false);
		const asked = (facts: Row, work: Row = {}) => ({
			...slip,
			terms: { ...slip.terms, facts },
			work: { ...slip.work, ...work },
			hours: { ...slip.hours, month: { overtime_hours: 30 }, year: { overtime_hours: 100 } }
		});
		assert.equal(trips('MATERNITY_LIMITS', asked({ pregnancy_work_limits_requested: true })), true);
		assert.equal(trips('MATERNITY_LIMITS', asked({})), false);
		assert.equal(
			trips('CHILDCARE_CARE_LIMITS', asked({ childcare_overtime_limit_requested: true })),
			true
		);
		assert.equal(trips('CHILDCARE_CARE_LIMITS', asked({ no_overtime_requested: true })), true);
		assert.equal(
			trips('CHILDCARE_CARE_LIMITS', asked({ night_work_exemption_requested: true })),
			true
		);
		assert.equal(trips('CHILDCARE_CARE_LIMITS', asked({})), false);
		// Coverage on the terms: a daytime student is outside EI; 20–30 weekly hours are insured from 51 employees.
		const covered = (facts: Row, category: string, headcount: number) => ({
			...slip,
			terms: { ...slip.terms, statutory_work_category: category, facts },
			company: { ...slip.company, headcount }
		});
		assert.equal(
			trips('DAYTIME_STUDENT_EI', covered({ daytime_student: true }, 'SOCIAL_AND_EMPLOYMENT', 60)),
			true
		);
		assert.equal(
			trips('DAYTIME_STUDENT_EI', covered({ daytime_student: true }, 'SOCIAL_ONLY', 60)),
			false
		);
		assert.equal(
			trips('SHORT_TIME_COVERAGE', covered({ weekly_scheduled_hours: 24 }, 'EMPLOYMENT_ONLY', 60)),
			true
		);
		assert.equal(
			trips(
				'SHORT_TIME_COVERAGE',
				covered({ weekly_scheduled_hours: 24 }, 'SOCIAL_AND_EMPLOYMENT', 60)
			),
			false
		);
		assert.equal(
			trips(
				'SHORT_TIME_COVERAGE',
				covered({ weekly_scheduled_hours: 24 }, 'SOCIAL_AND_EMPLOYMENT', 40)
			),
			true
		);
		assert.equal(
			trips('SHORT_TIME_COVERAGE', covered({ weekly_scheduled_hours: 24 }, 'EMPLOYMENT_ONLY', 40)),
			false
		);
		// Disciplinary reductions at most a tenth of the period's wages (art.91); digital pay needs consent.
		const disciplined = (deduction: number) => ({
			...slip,
			payslip: { gross: 300000 - deduction, lines: { DISCIPLINARY_DEDUCTION: -deduction } }
		});
		assert.equal(validation('version_4', 'DISCIPLINARY_DEDUCTION_LIMIT').kind, 'refuse');
		assert.equal(trips('DISCIPLINARY_DEDUCTION_LIMIT', disciplined(30001)), true);
		assert.equal(trips('DISCIPLINARY_DEDUCTION_LIMIT', disciplined(30000)), false);
		assert.equal(trips('DIGITAL_WAGE_CONSENT', asked({ wage_payment_method: 'DIGITAL' })), true);
		assert.equal(
			trips(
				'DIGITAL_WAGE_CONSENT',
				asked({ wage_payment_method: 'DIGITAL', digital_payment_consent_on: '2026-03-01' })
			),
			false
		);
		// The contract check reads the minimum in force on the term's first day (`day`) in the workplace prefecture.
		const term = (base_salary: number, day: string, facts: Row = {}) => ({
			rules: payrollRules('version_6'),
			day,
			term: { base_salary, work_classification: 'ORDINARY', allowances: [], facts },
			company: { region: 'TOKYO', facts: { monthly_average_scheduled_hours: 160 } }
		});
		const contract = (context: Row) =>
			evaluateConfigured(
				fixtureString(validation('version_6', 'MINIMUM_WAGE_CONTRACT').when),
				fixtureContext(context)
			);
		assert.equal(validation('version_4', 'MINIMUM_WAGE_CONTRACT').kind, 'refuse');
		// Tokyo 1,226 to 30 September 2026, 1,280 from 1 October: 200,000 / 160 = 1,250.
		assert.equal(contract(term(200000, '2026-09-30')), false);
		assert.equal(contract(term(200000, '2026-10-01')), true);
		assert.equal(contract(term(1279, '2026-10-01', { pay_basis: 'HOURLY' })), true);
		assert.equal(contract(term(1280, '2026-10-01', { pay_basis: 'HOURLY' })), false);
		assert.equal(
			contract(term(9600, '2026-10-01', { pay_basis: 'DAILY', scheduled_daily_hours: 8 })),
			true
		);
		assert.equal(contract(term(200000, '2026-10-01', { workplace_region: 'OKINAWA' })), false);
		assert.equal(contract(term(190000, '2026-10-01', { minimum_wage_reduction_rate: 0.1 })), false);
		// Statutory warnings: the grade estimated from the contract wage; the 乙欄 without a declaration.
		const health = fixturePresent(
			fixturePresent(
				fixturePresent(fixtureValue6(scheme('version_4', 'HEALTH').configuration)).warn_when
			)[0]
		).when;
		const base = statutoryContext('2026-04', {}, { ordinary: 300000 });
		assert.equal(
			evaluateConfigured(fixtureString(health), fixtureContext({ ...base, elections: {} })),
			true
		);
		assert.equal(
			evaluateConfigured(
				fixtureString(health),
				fixtureContext({
					...base,
					elections: { HEALTH: { standard_monthly_remuneration: 300000 } }
				})
			),
			false
		);
		// 令和9年分 (告示127号・128号): 253,500 → 253,500 − 82,717 − 51,667 − 31,667 = 87,449 × 5.105% → 4,460;
		// the 乙欄 row 251,000–254,000 is 36,200; the bonus rate for 253,500 with 1 dependant stays 4.084%.
		const declared = { dependency_declaration_filed: true, withholding_dependants: 1 };
		const person = {
			dob: '1981-01-10',
			elections: { INCOME_TAX: declared },
			monthly_wage: 300000,
			earned: {
				month: {},
				year: {},
				previous_month: {
					gross: 300000,
					statutory: {
						HEALTH: { employee: 17205 },
						CHILD_SUPPORT: { employee: 345 },
						PENSION: { employee: 27450 },
						EI: { employee: 1500 }
					}
				}
			}
		};
		assert.deepEqual(at('version_8', 'INCOME_TAX', '2027-01', person, { ordinary: 300000 }), {
			employee: 4460,
			employer: 0
		});
		assert.deepEqual(at('version_7', 'INCOME_TAX', '2026-12', person, { ordinary: 300000 }), {
			employee: 4630,
			employer: 0
		});
		assert.deepEqual(
			at('version_8', 'INCOME_TAX', '2027-01', { ...person, elections: {} }, { ordinary: 300000 }),
			{ employee: 36200, employer: 0 }
		);
		assert.deepEqual(at('version_8', 'INCOME_TAX', '2027-01', person, { bonus: 500000 }), {
			employee: 17254,
			employer: 0
		});
	});
	it('child-nursing and family-care days: per business year, by children and family members', () => {
		const leave = (code: string) =>
			fixturePresent(file('version_4', 'leave_catalog').find((row) => row.code === code));
		const days = (code: string, as_of: string, employee: Row) =>
			evaluateConfigured(
				fixtureString(fixtureValue16(leave(code).entitlement).days),
				fixtureContext({
					as_of,
					employee,
					service_months: 12,
					bands: []
				})
			);
		const key = (code: string, from: string) =>
			evaluateConfigured(
				fixtureString(fixtureValue17(leave(code).entitlement).window_key),
				fixtureContext({
					entry: { from }
				})
			);
		assert.equal(fixtureValue5(leave('CHILD_NURSING_LEAVE').entitlement).window, 'EVENT');
		assert.equal(key('CHILD_NURSING_LEAVE', '2026-03-31'), '2025');
		assert.equal(key('CHILD_NURSING_LEAVE', '2026-04-01'), '2026');
		const child = (child_birthdate: string) => ({ child_birthdate, relationship: 'CHILD' });
		// Born 2 April 2017: third grade in the 2026 school year (under 9 on 1 April) — counts; born 1 April 2017 does not.
		assert.equal(days('CHILD_NURSING_LEAVE', '2026-06-01', { children: [child('2017-04-02')] }), 5);
		assert.equal(days('CHILD_NURSING_LEAVE', '2026-06-01', { children: [child('2017-04-01')] }), 0);
		assert.equal(
			days('CHILD_NURSING_LEAVE', '2026-06-01', {
				children: [child('2017-04-02'), child('2022-01-15')]
			}),
			10
		);
		assert.equal(days('CHILD_NURSING_LEAVE', '2026-06-01', { children: [child('2026-08-01')] }), 0);
		assert.equal(days('FAMILY_CARE_DAYS', '2026-06-01', { facts: {} }), 5);
		assert.equal(
			days('FAMILY_CARE_DAYS', '2026-06-01', { facts: { family_care_recipients: 2 } }),
			10
		);
		// Per-event grants read the event's first entry: 42 prenatal days (98 for a multiple pregnancy), 56 postnatal,
		// 28 for 産後パパ育休, 93 care-leave days per family member.
		const grant = (code: string, facts: Row) =>
			evaluateConfigured(
				fixtureString(fixtureValue16(leave(code).entitlement).days),
				fixtureContext({
					entry: { facts },
					service_months: 12,
					bands: []
				})
			);
		assert.equal(grant('PRENATAL_LEAVE', {}), 42);
		assert.equal(grant('PRENATAL_LEAVE', { multiple_pregnancy: true }), 98);
		assert.equal(grant('POSTNATAL_LEAVE', {}), 56);
		assert.equal(grant('POSTNATAL_PATERNITY_LEAVE', {}), 28);
		assert.equal(grant('FAMILY_CARE_LEAVE', {}), 93);
		assert.equal(
			evaluateConfigured(
				fixtureString(fixtureValue17(leave('FAMILY_CARE_LEAVE').entitlement).window_key),
				fixtureContext({ entry: { facts: { care_recipient_id: 'mother' } } })
			),
			'mother'
		);
	});
	it('premium months: no-pay months, 当月払い deferral and recovery, the month-end leaver, exemptions and elections', () => {
		const none = (result: Charge | undefined) =>
			result == null || (result !== 'REFUSED' && result.employee === 0 && result.employer === 0);
		const wage = { monthly_wage: 300000 };
		// A month of insured status with no pay is still charged; the employer advances it (no pay to deduct from).
		const idle = slip('version_4', '2026-04', wage, {});
		assert.deepEqual(idle.HEALTH, { employee: 0, employer: 29550 });
		assert.deepEqual(idle.PENSION, { employee: 0, employer: 54900 });
		assert.equal(idle.EI, null);
		assert.equal(idle.INCOME_TAX, null);
		// Paid the following month: the employee half comes off this pay.
		assert.deepEqual(at('version_4', 'HEALTH', '2026-04', wage, { ordinary: 300000 }), {
			employee: 14775,
			employer: 14775
		});
		// Paid within the month: April is advanced, and March's outstanding shares are recovered (健康保険法 art.167(1)).
		const march = {
			month: '2026-03',
			gross: 300000,
			statutory: {
				HEALTH: { employee: 0, employer: 29550, parts: { ordinary: 300000 } },
				PENSION: { employee: 0, employer: 54900, parts: { ordinary: 300000 } }
			}
		};
		const sameMonth = { ...wage, pay_date: '2026-04-25', earned: { months: [march] } };
		const april = slip('version_4', '2026-04', sameMonth, { ordinary: 300000 });
		assert.deepEqual(april.HEALTH, { employee: 0, employer: 29550 });
		assert.deepEqual(april.SI_PREVIOUS_MONTH, {
			employee: 14775 + 27450,
			employer: -(14775 + 27450)
		});
		// A recovery already made is not made again.
		const recovered = {
			...march,
			month: '2026-04',
			statutory: {
				HEALTH: { employee: 14775, employer: 14775, parts: { ordinary: 300000 } },
				PENSION: { employee: 27450, employer: 27450, parts: { ordinary: 300000 } },
				SI_PREVIOUS_MONTH: { employee: 42225, employer: -42225 }
			}
		};
		assert.equal(
			slip(
				'version_4',
				'2026-05',
				{ ...sameMonth, pay_date: '2026-05-25', earned: { months: [march, recovered] } },
				{
					ordinary: 300000
				}
			).SI_PREVIOUS_MONTH,
			null
		);
		// A leaver on the last day of the month: both months come off the final pay (art.167(1) proviso).
		const leaver = slip(
			'version_4',
			'2026-04',
			{ ...sameMonth, exit_date: '2026-04-30' },
			{ ordinary: 300000 }
		);
		assert.deepEqual(leaver.HEALTH, { employee: 14775, employer: 14775 });
		assert.deepEqual(leaver.SI_PREVIOUS_MONTH, { employee: 42225, employer: -42225 });
		// Childcare leave covering the month end, or 14 days within the month, exempts the month (arts.159, 159の3).
		const onLeave = (from: string, to: string, code = 'CHILDCARE_LEAVE') => ({
			...wage,
			leave: [{ code, from, to, days: 10, activity: 'TIME_OFF' }]
		});
		assert.ok(
			none(
				at('version_4', 'HEALTH', '2026-04', onLeave('2026-03-01', '2026-06-30'), {
					ordinary: 300000
				})
			)
		);
		assert.ok(
			none(
				at('version_4', 'PENSION', '2026-04', onLeave('2026-04-06', '2026-04-19'), {
					ordinary: 300000
				})
			)
		);
		assert.ok(
			!none(
				at('version_4', 'PENSION', '2026-04', onLeave('2026-04-06', '2026-04-18'), {
					ordinary: 300000
				})
			)
		);
		assert.ok(
			none(
				at(
					'version_4',
					'HEALTH',
					'2026-04',
					onLeave('2026-04-01', '2026-05-10', 'POSTNATAL_LEAVE'),
					{ ordinary: 1 }
				)
			)
		);
		// A bonus in the month is exempt only under a childcare leave longer than one month.
		assert.ok(
			none(
				at('version_4', 'HEALTH_BONUS', '2026-04', onLeave('2026-03-15', '2026-05-31'), {
					bonus: 500000
				})
			)
		);
		assert.ok(
			!none(
				at('version_4', 'HEALTH_BONUS', '2026-04', onLeave('2026-04-20', '2026-05-10'), {
					bonus: 500000
				})
			)
		);
		// Elections: nursing care exemption, the multiple-employer share, a social security agreement certificate.
		const elect = (HEALTH: Row, dob = '1981-01-10') => ({ ...wage, dob, elections: { HEALTH } });
		assert.deepEqual(at('version_4', 'HEALTH', '2026-04', elect({}), { ordinary: 300000 }), {
			employee: 17205,
			employer: 17205
		});
		assert.deepEqual(
			at('version_4', 'HEALTH', '2026-04', elect({ care_exempt: true }), { ordinary: 300000 }),
			{
				employee: 14775,
				employer: 14775
			}
		);
		assert.deepEqual(
			at('version_4', 'HEALTH', '2026-04', elect({ apportionment_ratio: 0.5 }, '1990-06-15'), {
				ordinary: 300000
			}),
			{
				employee: 7387,
				employer: 7388
			}
		);
		assert.ok(
			none(
				at('version_4', 'HEALTH', '2026-04', elect({ social_security_agreement_exempt: true }), {
					ordinary: 300000
				})
			)
		);
		// Nursing care ends with the month before the one holding the 65th birthday's eve: born 1 May 1961 reaches 65
		// on 30 April (April is not charged), born 2 May on 1 May (April still is).
		assert.deepEqual(
			at('version_4', 'HEALTH', '2026-04', { ...wage, dob: '1961-05-01' }, { ordinary: 300000 }),
			{
				employee: 14775,
				employer: 14775
			}
		);
		assert.deepEqual(
			at('version_4', 'HEALTH', '2026-04', { ...wage, dob: '1961-05-02' }, { ordinary: 300000 }),
			{
				employee: 17205,
				employer: 17205
			}
		);
		// FY2025 nursing 1.59%: Tokyo 9.91 + 1.59 = 11.50% → 34,500 / 2.
		assert.deepEqual(
			at('version_1', 'HEALTH', '2025-12', { ...wage, dob: '1981-01-10' }, { ordinary: 300000 }),
			{
				employee: 17250,
				employer: 17250
			}
		);
		// The standard bonus cap is 5,730,000 over the fiscal year from April: 5,000,000 earlier leaves 730,000.
		const bonusEarlier = {
			earned: {
				months: [
					{
						month: '2026-07',
						gross: 5000000,
						statutory: { HEALTH_BONUS: { employee: 0, employer: 0, parts: { bonus: 5000000 } } }
					}
				]
			}
		};
		assert.deepEqual(at('version_7', 'HEALTH_BONUS', '2026-12', bonusEarlier, { bonus: 1000000 }), {
			employee: 35952,
			employer: 35953
		});
		// 保険料調整制度 (from October 2026): the employer bears part of a newly covered worker's share, refunded three
		// months later off the notice.
		const adjusted = {
			monthly_wage: 126000,
			elections: {
				HEALTH: { premium_adjustment_employee_share: 0.25 },
				PENSION: { premium_adjustment_employee_share: 0.25 }
			}
		};
		assert.deepEqual(at('version_6', 'HEALTH', '2026-10', adjusted, { ordinary: 126000 }), {
			employee: 3103,
			employer: 9308
		});
		const refund = at(
			'version_8',
			'SI_ADJUSTMENT_REFUND',
			'2027-01',
			{
				...adjusted,
				earned: {
					months: [
						{
							month: '2026-10',
							gross: 126000,
							statutory: {
								HEALTH: { employee: 3103, employer: 9308, parts: { ordinary: 126000 } },
								PENSION: { employee: 5765, employer: 17293, parts: { ordinary: 126000 } }
							}
						}
					]
				}
			},
			{ ordinary: 126000 }
		);
		// 126,000 × (9.85% + 18.3%) × (0.5 − 0.25) = 8,867.25 → 8,867.
		assert.deepEqual(refund, { employee: 0, employer: -8867 });
		// 47 prefectures × FY2025 and FY2026 協会けんぽ rates on 300,000 (no nursing).
		for (const [region, [fy2025, fy2026]] of Object.entries(KYOKAI))
			for (const [version, key, rate] of [
				['version_1', '2025-12', fy2025],
				['version_4', '2026-04', fy2026]
			] as const) {
				const total = Math.floor((300000 * rate) / 100 + 1e-9);
				const employee = Math.round((300000 * rate) / 200 - 0.0001);
				assert.deepEqual(
					at(version, 'HEALTH', key, { region }, { ordinary: 300000 }),
					{
						employee,
						employer: total - employee
					},
					`${region} ${key}`
				);
			}
	});
	it('withholding: the 1/12 rule, non-resident domestic share and treaty, the year-end adjustment for 2025 and 2026', () => {
		const declared = { dependency_declaration_filed: true, withholding_dependants: 1 };
		const plain = { category: 'NONE', monthly_wage: 300000, elections: { INCOME_TAX: declared } };
		const tax = (version: string, key: string, person: Person, month: Month) =>
			fixtureValue13(at(version, 'INCOME_TAX', key, person, month)).employee;
		// No salary the month before: the 月額表 on one sixth of the bonus, one twelfth over a six-month period.
		const monthly = tax('version_4', '2026-04', plain, { ordinary: 300000 });
		assert.ok(monthly > 0);
		assert.equal(tax('version_4', '2026-04', plain, { bonus: 1800000 }), 6 * monthly);
		assert.equal(tax('version_4', '2026-04', plain, { bonus12: 3600000 }), 12 * monthly);
		// Non-residents: 20.42% of the share of service in Japan; nothing under a treaty exemption.
		const abroad = {
			...plain,
			residency: 'NON_RESIDENT',
			terms_facts: { domestic_service_ratio: 0.6 }
		};
		assert.equal(tax('version_4', '2026-04', abroad, { ordinary: 300000 }), 36756);
		assert.equal(
			tax(
				'version_4',
				'2026-04',
				{ ...abroad, elections: { INCOME_TAX: { treaty_exempt: true } } },
				{ ordinary: 300000 }
			),
			0
		);
		// Year-end adjustment: eleven months of 300,000 with 6,000 withheld each, the December pay, one dependant.
		const year = (from: string) =>
			Array.from({ length: 11 }, (_, i) => {
				const [y, m] = fixtureValue0(from.split('-').map(Number));
				return {
					month: new Date(Date.UTC(y, m - 1 + i, 1)).toISOString().slice(0, 7),
					gross: 300000,
					statutory: { INCOME_TAX: { employee: 6000, employer: 0, parts: { ordinary: 300000 } } }
				};
			});
		const yea = (version: string, key: string, pay_date: string, months: Row[]) => {
			const person = {
				...plain,
				pay_date,
				earned: { months },
				elections: {
					INCOME_TAX: declared,
					YEAR_END_ADJUSTMENT: { yea_dependant_deduction: 380000 }
				}
			};
			const result = slip(version, key, person, { ordinary: 300000 });
			const settle = fixtureValue18(result.YEAR_END_ADJUSTMENT);
			return [settle?.employee, fixtureValue13(result.INCOME_TAX).employee] as const;
		};
		// 令和7年分: 3,600,000 → 2,440,000; basic 880,000; dependant 380,000 → 1,180,000 → 59,000 × 102.1% → 60,200.
		const [dec2025, withheld2025] = yea('version_1', '2025-12', '2025-12-25', year('2025-01'));
		assert.equal(dec2025, 60200 - 66000 - withheld2025);
		assert.equal(dec2025, -12520);
		// 令和8年分 (the 2026 reform): basic 1,040,000 → 1,020,000 → 51,000 × 102.1% → 52,000.
		const [dec2026, withheld2026] = yea('version_7', '2026-12', '2026-12-25', year('2026-01'));
		assert.equal(dec2026, 52000 - 66000 - withheld2026);
		assert.equal(dec2026, -20300);
		// Paid the month after: November's pay on 10 December is the year's last; the year runs December–November.
		const [nov2026, withheldNov] = yea('version_7', '2026-11', '2026-12-10', year('2025-12'));
		assert.equal(nov2026, 52000 - 66000 - withheldNov);
		assert.equal(yea('version_7', '2026-12', '2027-01-10', year('2026-01'))[0], undefined);
	});
	it('retirement allowances: the 10% resident tax, non-residents, and the resident tax collected on leaving', () => {
		const ten = {
			service_months: 120,
			elections: { RETIREMENT_TAX: { retirement_income_declaration_filed: true } }
		};
		// (5,000,000 − 4,000,000) / 2 = 500,000: 6% 30,000 + 4% 20,000 (地方税法 arts.50の4, 328の3).
		assert.deepEqual(
			at('version_4', 'RESIDENT_TAX_RETIREMENT', '2026-04', ten, { retirement: 5000000 }),
			{
				employee: 50000,
				employer: 0
			}
		);
		assert.equal(
			at(
				'version_4',
				'RESIDENT_TAX_RETIREMENT',
				'2026-04',
				{
					...ten,
					elections: {
						...ten.elections,
						RESIDENT_TAX_RETIREMENT: { not_domiciled_on_january_1: true }
					}
				},
				{ retirement: 5000000 }
			),
			null
		);
		// An overlapping earlier allowance reduces the deduction (所得税法 art.30(6), the employer's computation):
		// 4,000,000 − 1,000,000 = 3,000,000 → (5,000,000 − 3,000,000) / 2 = 1,000,000 × 5% × 102.1%.
		assert.deepEqual(
			at(
				'version_4',
				'RETIREMENT_TAX',
				'2026-04',
				{
					service_months: 120,
					elections: {
						RETIREMENT_TAX: {
							retirement_income_declaration_filed: true,
							retirement_deduction_adjustment: 1000000
						}
					}
				},
				{ retirement: 5000000 }
			),
			{ employee: 51050, employer: 0 }
		);
		// The tables follow the pay day: the version in force on it assesses these schemes.
		for (const code of [
			'INCOME_TAX',
			'YEAR_END_ADJUSTMENT',
			'RETIREMENT_TAX',
			'RESIDENT_TAX_RETIREMENT'
		])
			assert.equal(
				fixtureValue5(scheme('version_7', code).configuration).governed_by,
				'pay_date',
				code
			);
		// A non-resident: 20.42% of the part for service in Japan, no resident tax.
		const away = {
			...ten,
			residency: 'NON_RESIDENT',
			terms_facts: { retirement_domestic_ratio: 0.5 }
		};
		assert.deepEqual(at('version_4', 'RETIREMENT_TAX', '2026-04', away, { retirement: 5000000 }), {
			employee: 510500,
			employer: 0
		});
		assert.equal(
			at('version_4', 'RESIDENT_TAX_RETIREMENT', '2026-04', away, { retirement: 5000000 }),
			null
		);
		// A January–April leaver pays the rest to May from the final pay; a later leaver only on request.
		const notice = (exit_date: string, extra: Row = {}) => ({
			exit_date,
			elections: { RESIDENT_TAX: { monthly_amount: 10000, ...extra } }
		});
		assert.deepEqual(
			at('version_2', 'RESIDENT_TAX', '2026-02', notice('2026-02-15'), { ordinary: 300000 }),
			{
				employee: 40000,
				employer: 0
			}
		);
		assert.deepEqual(
			at('version_5', 'RESIDENT_TAX', '2026-07', notice('2026-07-15'), { ordinary: 300000 }),
			{
				employee: 10000,
				employer: 0
			}
		);
		assert.deepEqual(
			at('version_5', 'RESIDENT_TAX', '2026-07', notice('2026-07-15', { lump_sum_on_exit: true }), {
				ordinary: 300000
			}),
			{ employee: 110000, employer: 0 }
		);
		// Not enough pay for the lump sum: the month's amount only.
		assert.deepEqual(
			at('version_2', 'RESIDENT_TAX', '2026-02', notice('2026-02-15'), { ordinary: 25000 }),
			{
				employee: 10000,
				employer: 0
			}
		);
	});
	it('pay bases, derived overtime, substitute leave, annual leave pay and the workplace minimum wage', () => {
		const line = (code: string, patch: (context: typeof payslipContext) => Row) => {
			const row = fixturePresent(
				file('version_4', 'work_catalog').find((item) => item.code === code)
			);
			const context = {
				...patch(structuredClone(payslipContext)),
				rules: payrollRules('version_4')
			};
			if (
				evaluateConfigured(fixtureString(String(row.eligibility)), fixtureContext(context)) !== true
			)
				return 0;
			return (
				Number(evaluateConfigured(fixtureString(String(row.quantity)), fixtureContext(context))) *
				Number(evaluateConfigured(fixtureString(String(row.rate)), fixtureContext(context)))
			);
		};
		const hourly = (context: typeof payslipContext) => ({
			...context,
			terms: {
				...context.terms,
				base_salary: 1500,
				facts: { pay_basis: 'HOURLY', scheduled_daily_hours: 8 }
			}
		});
		// Hourly: every paid hour off the rest day at the rate (8 planned + 2 past them); overtime pays the 25% premium only.
		assert.equal(line('BASIC', hourly), 10 * 1500);
		assert.equal(line('OVERTIME', hourly), 2 * 375);
		assert.equal(line('NO_PAY_LEAVE', hourly), 0);
		const daily = (context: typeof payslipContext) => ({
			...context,
			terms: {
				...context.terms,
				base_salary: 12000,
				facts: { pay_basis: 'DAILY', scheduled_daily_hours: 8 }
			}
		});
		assert.equal(line('BASIC', daily), 12000);
		assert.equal(line('OVERTIME', daily), 2 * 1875);
		// Paid annual leave of an hourly worker: the scheduled day at the rate (art.39(9)).
		const leaveDay = (context: typeof payslipContext) => {
			const held = hourly(context);
			return {
				...held,
				leave: {
					rows: [
						{
							code: 'ANNUAL_LEAVE',
							activity: 'TIME_OFF',
							days: 1,
							from: '2026-04-15',
							to: '2026-04-15'
						}
					]
				}
			};
		};
		assert.equal(line('ANNUAL_LEAVE_PAY', leaveDay), 12000);
		assert.equal(
			line('ANNUAL_LEAVE_PAY', (context) => context),
			0
		);
		// 2 hours past the 8-hour shift Monday–Friday and 8 on the Saturday day off: 2 a day beyond 8 and 8 beyond the
		// 40-hour week (Sunday start), all of the 18 approved hours.
		const week = (context: typeof payslipContext, company: Row = {}) => ({
			...context,
			company: { ...context.company, facts: { ...context.company.facts, ...company } },
			work: {
				...context.work,
				overtime_hours: 18,
				days: ['06', '07', '08', '09', '10', '11'].map((day, i) => ({
					date: `2026-04-${day}`,
					day_type: i < 5 ? 'WORK' : 'OFF',
					worked: true,
					scheduled_hours: i < 5 ? 8 : 0,
					worked_hours: i < 5 ? 10 : 8,
					overtime_hours: i < 5 ? 2 : 8,
					facts: {},
					intervals: []
				}))
			}
		});
		assert.equal(line('OVERTIME', week), 18 * 1406);
		assert.equal(line('WITHIN_HOURS_OVERTIME', week), 0);
		// A 44-hour 特例措置対象事業場 week: 4 hours beyond the week; the other 4 Saturday hours are within the legal hours.
		assert.equal(
			line('OVERTIME', (context) => week(context, { weekly_limit_44: true })),
			14 * 1406
		);
		assert.equal(
			line('WITHIN_HOURS_OVERTIME', (context) => week(context, { weekly_limit_44: true })),
			4 * 1125
		);
		// A variable schedule of 8-hour days reads as the standard one; flextime settles over the month (58 hours is far
		// below 40 × 30 / 7); a deemed regime pays its deemed 12 hours a day beyond 8 on each of the 6 days.
		for (const [regime, hours] of [
			['VARIABLE', 18],
			['FLEX', 0],
			['DEEMED', 24]
		] as const)
			assert.equal(
				line('OVERTIME', (context) =>
					week(context, { working_time_regime: regime, deemed_daily_hours: 12 })
				),
				hours * 1406,
				regime
			);
		// Within-hours overtime: 7 scheduled, 8 worked is an hour at the ordinary rate.
		const seven = (context: typeof payslipContext) => ({
			...context,
			work: {
				...context.work,
				days: [
					{
						...fixturePresent(context.work.days[0]),
						scheduled_hours: 7,
						worked_hours: 8,
						overtime_hours: 1
					}
				]
			}
		});
		assert.equal(line('WITHIN_HOURS_OVERTIME', seven), 1125);
		assert.equal(line('OVERTIME', seven), 0);
		// 代替休暇: 2 hours of substitute leave replace the extra 25% of 8 of the 10 hours beyond 60.
		const substituted = (context: typeof payslipContext) => ({
			...context,
			work: seventyHours,
			company: {
				...context.company,
				facts: { ...context.company.facts, substitute_leave_agreement: true }
			},
			leave: {
				rows: [
					{
						code: 'SUBSTITUTE_LEAVE_FOR_OVERTIME',
						activity: 'TIME_OFF',
						days: 2,
						from: '2026-04-20',
						to: '2026-04-20'
					}
				]
			}
		});
		assert.equal(line('OVERTIME_SUBSTITUTED', substituted), 8 * 281);
		assert.equal(
			line('OVERTIME_SUBSTITUTED', (context) => context),
			0
		);
		// The overtime base takes the fixed allowance; a family allowance set by dependants stays out: (180,000 + 20,000) / 160 = 1,250.
		const allowances = (byDependants: boolean) => (context: typeof payslipContext) => ({
			...context,
			work: seventyHours,
			terms: {
				...context.terms,
				allowances: [
					{ code: 'FIXED_ALLOWANCE', amount: 20000 },
					{ code: 'FAMILY_ALLOWANCE', amount: 10000 }
				],
				facts: { ...context.terms.facts, family_allowance_by_dependants: byDependants }
			}
		});
		assert.equal(line('OVERTIME', allowances(true)), 60 * 1563);
		// A flat family allowance is in the base: 210,000 / 160 × 1.25 = 1,640.6 → 1,641.
		assert.equal(line('OVERTIME', allowances(false)), 60 * 1641);
		// The minimum wage of the workplace prefecture, and a permitted reduction.
		assert.equal(Math.round(line('MINIMUM_WAGE_TOP_UP', (context) => context)), 160 * 101);
		const okinawa = (context: typeof payslipContext) => ({
			...context,
			terms: { ...context.terms, facts: { workplace_region: 'OKINAWA' } }
		});
		assert.equal(line('MINIMUM_WAGE_TOP_UP', okinawa), 0);
		const reduced = (context: typeof payslipContext) => ({
			...context,
			terms: { ...context.terms, facts: { minimum_wage_reduction_rate: 0.1 } }
		});
		assert.equal(line('MINIMUM_WAGE_TOP_UP', reduced), 0);
		const hourlyLow = (context: typeof payslipContext) => ({
			...hourly(context),
			terms: { ...context.terms, base_salary: 1200, facts: { pay_basis: 'HOURLY' } }
		});
		// Hourly 1,200 against Tokyo's 1,226: 26 × the 10 hours worked.
		assert.equal(Math.round(line('MINIMUM_WAGE_TOP_UP', hourlyLow)), 260);
	});
	it('ad hoc classes: the average wage, benefits in kind, duty and meal allowances, disciplinary limits and interest', () => {
		const amount = (
			version: string,
			code: string,
			facts: Row,
			quantity = 1,
			entryAmount = 1000
		) => {
			const row = fixturePresent(file(version, 'adhoc_catalog').find((item) => item.code === code));
			const band = fixturePresent(fixtureValue12(row.bands)[0]);
			const context = {
				...payslipContext,
				earned: {
					...payslipContext.earned,
					months: ['2026-01', '2026-02', '2026-03'].map((month) => ({ month, gross: 300000 }))
				},
				entry: { ...entry(facts, quantity), amount: entryAmount }
			};
			return evaluateConfigured(fixtureString(band.when), fixtureContext(context)) === true
				? Number(evaluateConfigured(fixtureString(band.amount), fixtureContext(context)))
				: null;
		};
		// 平均賃金: 900,000 over the 90 calendar days of January–March = 10,000 a day.
		assert.equal(amount('version_4', 'SHUTDOWN_ALLOWANCE', {}, 5), 30000);
		assert.equal(amount('version_4', 'SHUTDOWN_ALLOWANCE', { wages_paid_for_days: 4000 }, 1), 2000);
		assert.equal(amount('version_4', 'INJURY_WAITING_COMPENSATION', {}, 3), 18000);
		assert.equal(
			amount('version_4', 'DISMISSAL_NOTICE_ALLOWANCE', { notice_days_given: 20 }),
			100000
		);
		assert.equal(amount('version_4', 'DISMISSAL_NOTICE_ALLOWANCE', { notice_exempt: true }), null);
		// Meals: the employee pays half and the employer's cost is within 3,500 (7,500 from April 2026).
		assert.equal(
			amount('version_4', 'MEALS_IN_KIND', { meal_value: 12000, employee_payment: 6000 }),
			0
		);
		assert.equal(
			amount('version_3', 'MEALS_IN_KIND', { meal_value: 12000, employee_payment: 6000 }),
			6000
		);
		assert.equal(
			amount('version_4', 'MEALS_IN_KIND', { meal_value: 12000, employee_payment: 5000 }),
			7000
		);
		// Housing: half the standard rent or more paid leaves no benefit.
		assert.equal(
			amount('version_4', 'HOUSING_IN_KIND', { standard_rent: 50000, rent_paid: 25000 }),
			0
		);
		assert.equal(
			amount('version_4', 'HOUSING_IN_KIND', { standard_rent: 50000, rent_paid: 20000 }),
			30000
		);
		// Disciplinary: at most half a day's average wage per act; late wages of a leaver bear 14.6%.
		assert.equal(amount('version_4', 'DISCIPLINARY_DEDUCTION', {}, 1, 8000), 5000);
		assert.equal(
			amount('version_4', 'LATE_WAGE_INTEREST', { unpaid_amount: 100000, days_late: 30 }, 1, 0),
			1200
		);
		// Duty and night-meal limits per occasion; the bonus over six months routes to the 1/12 part.
		const limit = (version: string, code: string) =>
			fixturePresent(
				fixtureValue19(
					fixturePresent(file(version, 'adhoc_catalog').find((row) => row.code === code)).bands
				)[0]
			).limit.amount;
		assert.equal(
			evaluateConfigured(
				fixtureString(limit('version_4', 'NIGHT_DUTY_ALLOWANCE')),
				fixtureContext({ entry: { quantity: 2 } })
			),
			8000
		);
		assert.equal(
			evaluateConfigured(
				fixtureString(limit('version_3', 'NIGHT_MEAL_CASH')),
				fixtureContext({ entry: { quantity: 2 } })
			),
			600
		);
		assert.equal(
			evaluateConfigured(
				fixtureString(limit('version_4', 'NIGHT_MEAL_CASH')),
				fixtureContext({ entry: { quantity: 2 } })
			),
			1300
		);
		const routes = (code: string) =>
			fixtureValue3(
				fixturePresent(file('version_4', 'adhoc_catalog').find((row) => row.code === code))
					.counts_toward
			);
		assert.ok(routes('BONUS_OVER_SIX_MONTHS').includes('INCOME_TAX.BONUS12'));
		assert.ok(routes('RETIREMENT_ALLOWANCE').includes('RESIDENT_TAX_RETIREMENT.RETIREMENT'));
		assert.deepEqual(routes('LONG_SERVICE_AWARD'), []);
	});
	it('leave classes, the national holidays row and the hourly leave cap', () => {
		for (const version of versions) {
			const holidays = fixturePresent(
				file(version, 'rule_set').find((row) => row.code === 'public_holidays')
			);
			const list = fixtureValue20(holidays.rules).holidays;
			assert.equal(holidays.family, 'PAYROLL');
			assert.equal(
				list.filter((h) => h.kind === 'PUBLIC_HOLIDAY' || h.kind === 'SUBSTITUTE').length,
				35
			);
			assert.ok(list.some((h) => h.date === '2026-09-22' && h.name === '休日（国民の休日）'));
			assert.deepEqual(
				list.filter((h) => h.kind === 'SUBSTITUTE').map((h) => [h.date, h.replaces]),
				[
					['2026-05-06', '2026-05-03'],
					['2027-03-22', '2027-03-21']
				]
			);
			assert.equal(new Set(list.map((h) => h.date)).size, list.length);
		}
		const leave = (code: string) =>
			fixturePresent(file('version_4', 'leave_catalog').find((row) => row.code === code));
		assert.equal(fixtureValue5(leave('ANNUAL_LEAVE').entitlement).service_year_offset_months, 6);
		const hours = leave('ANNUAL_LEAVE_HOURS');
		assert.equal(hours.consumes_code, 'ANNUAL_LEAVE');
		assert.equal(
			evaluateConfigured(
				fixtureString(fixtureValue16(hours.entitlement).days),
				fixtureContext({
					terms: { facts: { scheduled_daily_hours: 7.5 } }
				})
			),
			37.5
		);
		const mother = {
			...payslipContext,
			entry: { occurred_on: '2026-04-10' },
			employee: { ...payslipContext.employee, children: [{ child_birthdate: '2025-09-01' }] }
		};
		assert.equal(
			evaluateConfigured(
				fixtureString(String(leave('NURSING_TIME').eligibility)),
				fixtureContext(mother)
			),
			true
		);
		assert.equal(
			evaluateConfigured(
				fixtureString(String(leave('NURSING_TIME').eligibility)),
				fixtureContext({
					...mother,
					employee: { ...mother.employee, children: [{ child_birthdate: '2025-04-01' }] }
				})
			),
			false
		);
		assert.equal(leave('MATERNAL_HEALTH_CHECK').is_npl, true);
		assert.equal(leave('SUBSTITUTE_LEAVE_FOR_OVERTIME').is_npl, false);
	});
	it('society rates, coverage, labour insurance classes, grade warnings and the rows customers configure', () => {
		const society = {
			health_insurer: 'SOCIETY',
			society_health_rate_percent: 9.0,
			society_care_rate_percent: 1.8,
			society_employee_share: 0.45,
			society_support_levy_rate_percent: 0.3,
			workers_accident_rate_per_mille: 3,
			monthly_average_scheduled_hours: 160
		};
		// 組合健保 at 9.0% + 1.8% nursing, employee 45%: 32,400 → 14,580 / 17,820; the levy 0.3% → 405 / 495.
		const member = { dob: '1981-01-10', company: society };
		assert.deepEqual(at('version_4', 'HEALTH', '2026-04', member, { ordinary: 300000 }), {
			employee: 14580,
			employer: 17820
		});
		assert.deepEqual(at('version_4', 'CHILD_SUPPORT', '2026-04', member, { ordinary: 300000 }), {
			employee: 405,
			employer: 495
		});
		assert.equal(
			at(
				'version_4',
				'HEALTH',
				'2026-04',
				{ company: { health_insurer: 'SOCIETY', workers_accident_rate_per_mille: 3 } },
				{ ordinary: 300000 }
			),
			'REFUSED'
		);
		// The 88,000 wage requirement left the coverage text on 1 October 2026.
		const coverage = (version: string) =>
			String(
				fixtureValue21(fixtureRecord(settingsOf(version).employee_input_schema).properties)
					.contract_terms.items.properties.statutory_work_category.description
			);
		assert.match(coverage('version_5'), /88,000\+ monthly wage/);
		assert.match(coverage('version_6'), /88,000 monthly wage requirement was abolished/);
		// A 24-hour week below 88,000 was outside coverage before October 2026, inside after it.
		const shortTime = (version: string, category: string) =>
			evaluateConfigured(
				fixtureString(
					String(
						fixtureValue5(
							fixturePresent(
								file(version, 'rule_set').find((row) => row.code === 'SHORT_TIME_COVERAGE')
							).rules
						).when
					)
				),
				fixtureContext({
					...payslipContext,
					terms: {
						...payslipContext.terms,
						monthly_wage: 80000,
						statutory_work_category: category,
						facts: { weekly_scheduled_hours: 24 }
					}
				})
			);
		assert.equal(shortTime('version_5', 'EMPLOYMENT_ONLY'), false);
		assert.equal(shortTime('version_5', 'SOCIAL_AND_EMPLOYMENT'), true);
		assert.equal(shortTime('version_6', 'EMPLOYMENT_ONLY'), true);
		assert.equal(shortTime('version_6', 'SOCIAL_AND_EMPLOYMENT'), false);
		// Employment insurance by class and year; officers are outside workers' accident insurance.
		const ei = (version: string, key: string, ei_industry_class: string) =>
			at(
				version,
				'EI',
				key,
				{ company: { ei_industry_class, workers_accident_rate_per_mille: 3 } },
				{ ordinary: 300000 }
			);
		assert.deepEqual(ei('version_1', '2025-12', 'AGRICULTURE_SAKE'), {
			employee: 1950,
			employer: 3000
		});
		assert.deepEqual(ei('version_4', '2026-04', 'AGRICULTURE_SAKE'), {
			employee: 1800,
			employer: 2850
		});
		assert.deepEqual(ei('version_1', '2025-12', 'CONSTRUCTION'), {
			employee: 1950,
			employer: 3300
		});
		assert.equal(
			at(
				'version_4',
				'WORKERS_ACCIDENT',
				'2026-04',
				{ classification: 'OFFICER' },
				{ ordinary: 300000 }
			),
			null
		);
		assert.equal(
			at(
				'version_4',
				'ASBESTOS_LEVY',
				'2026-04',
				{ classification: 'OFFICER' },
				{ ordinary: 300000 }
			),
			null
		);
		// 乙欄 rows and formulas (2026): a row, the 740,000 formula, the 1,710,000 formula, the floor.
		const otsu = (amount: number) =>
			fixtureValue13(
				at(
					'version_4',
					'INCOME_TAX',
					'2026-04',
					{ category: 'NONE', monthly_wage: amount },
					{ ordinary: amount }
				)
			).employee;
		assert.equal(otsu(499000), 144100);
		assert.equal(otsu(800000), 259200 + 24504);
		assert.equal(otsu(2000000), 655400 + 133240);
		assert.equal(otsu(100000), 3063);
		// Car commuting caps: 38,700 at 55 km+ before April 2026, 66,400 at 95 km+ after, plus parking to 5,000.
		const cap = (version: string, facts: Row) =>
			evaluateConfigured(
				fixtureString(
					String(
						fixturePresent(fixtureValue1(scheme(version, 'INCOME_TAX').configuration).person)
							.commute_cap
					)
				),
				fixtureContext({
					terms: { facts }
				})
			);
		assert.equal(cap('version_3', { commute_car_km_one_way: 100 }), 38700);
		assert.equal(cap('version_4', { commute_car_km_one_way: 100 }), 66400);
		assert.equal(
			cap('version_4', { commute_car_km_one_way: 100, commute_parking_fee: 9000 }),
			71400
		);
		assert.equal(
			cap('version_4', { commute_car_km_one_way: 1, commute_transit_fare: 12000 }),
			12000
		);
		assert.equal(cap('version_4', {}), 150000);
		// Payslip warnings: no declaration (乙欄); 定時決定 from April–June; 随時改定 on a two-grade change.
		const warnings = (code: string, version = 'version_6') =>
			(fixtureValue1(scheme(version, code).configuration).warn_when ?? []).map(
				(guard) => guard.when
			);
		const [noDeclaration] = warnings('INCOME_TAX', 'version_4');
		const base = (person: Person, key = '2026-09') => ({
			...statutoryContext(key, person, { ordinary: 300000 }),
			elections: person.elections ?? {}
		});
		const declaredFact = String(
			fixturePresent(fixtureValue1(scheme('version_4', 'INCOME_TAX').configuration).person)
				.wht_declared
		);
		const declaration = (elections: Row) => {
			const context = { ...base({}), scheme: { elections } };
			return evaluateConfigured(
				fixtureString(fixturePresent(noDeclaration)),
				fixtureContext({
					...context,
					person: {
						...context.person,
						wht_declared: evaluateConfigured(fixtureString(declaredFact), fixtureContext(context))
					}
				})
			);
		};
		assert.equal(declaration({}), true);
		assert.equal(declaration({ dependency_declaration_filed: true }), false);
		const health = warnings('HEALTH');
		const teiji = fixturePresent(health.find((when) => when.includes('"-04"')));
		const zuiji = fixturePresent(
			health.find((when) => when.includes('add_months(period.month_from, -4)'))
		);
		const months = (pairs: [string, number, number][]) =>
			pairs.map(([month, gross, BASIC]) => ({ month, gross, BASIC }));
		const recorded = { HEALTH: { standard_monthly_remuneration: 300000 } };
		const springRaise = months([
			['2026-04', 360000, 360000],
			['2026-05', 360000, 360000],
			['2026-06', 360000, 360000]
		]);
		const at9 = (earned: Row[], key = '2026-09') => ({
			...base({ elections: recorded, earned: { months: earned } }, key),
			scheme: { elections: recorded.HEALTH, since: '2025-09-01' }
		});
		assert.equal(evaluateConfigured(fixtureString(teiji), fixtureContext(at9(springRaise))), true);
		assert.equal(
			evaluateConfigured(
				fixtureString(teiji),
				fixtureContext(at9(springRaise.map((m) => ({ ...m, gross: 300000 }))))
			),
			false
		);
		assert.equal(
			evaluateConfigured(fixtureString(teiji), fixtureContext(at9(springRaise, '2026-08'))),
			false
		);
		const raise = months([
			['2026-05', 300000, 300000],
			['2026-06', 360000, 360000],
			['2026-07', 360000, 360000],
			['2026-08', 360000, 360000]
		]);
		assert.equal(evaluateConfigured(fixtureString(zuiji), fixtureContext(at9(raise))), true);
		const oneGrade = months([
			['2026-05', 300000, 300000],
			['2026-06', 310000, 310000],
			['2026-07', 310000, 310000],
			['2026-08', 310000, 310000]
		]);
		assert.equal(evaluateConfigured(fixtureString(zuiji), fixtureContext(at9(oneGrade))), false);
		// Customer-configured rows: an industry minimum above the regional one; loans need the deduction agreement;
		// claims and the retirement allowance stay outside the wage bases.
		const topUp = (facts: Row) => {
			const row = fixturePresent(
				file('version_4', 'work_catalog').find((item) => item.code === 'MINIMUM_WAGE_TOP_UP')
			);
			const context = {
				...payslipContext,
				company: {
					...payslipContext.company,
					facts: { ...payslipContext.company.facts, ...facts }
				},
				rules: payrollRules('version_4')
			};
			return evaluateConfigured(fixtureString(String(row.eligibility)), fixtureContext(context)) ===
				true
				? Number(evaluateConfigured(fixtureString(String(row.quantity)), fixtureContext(context))) *
						Number(evaluateConfigured(fixtureString(String(row.rate)), fixtureContext(context)))
				: 0;
		};
		assert.equal(Math.round(topUp({ industry_minimum_wage_hourly: 1300 })), 160 * 175);
		assert.equal(Math.round(topUp({ industry_minimum_wage_hourly: 1100 })), 160 * 101);
		const loan = fixturePresent(
			file('version_4', 'loan_catalog').find((row) => row.code === 'STAFF_LOAN')
		);
		assert.equal(
			evaluateConfigured(
				fixtureString(String(loan.eligibility)),
				fixtureContext({ company: { facts: {} } })
			),
			false
		);
		assert.equal(
			evaluateConfigured(
				fixtureString(String(loan.eligibility)),
				fixtureContext({
					company: { facts: { wage_deduction_agreement: true } }
				})
			),
			true
		);
		for (const row of file('version_4', 'claim_catalog')) {
			assert.equal(row.destination, 'NET');
			assert.deepEqual(row.counts_toward, []);
		}
		const retirement = fixturePresent(
			file('version_4', 'adhoc_catalog').find((row) => row.code === 'RETIREMENT_ALLOWANCE')
		);
		assert.deepEqual(retirement.counts_toward, [
			'RETIREMENT_TAX.RETIREMENT',
			'RESIDENT_TAX_RETIREMENT.RETIREMENT',
			'RESIDENT_TAX.RETIREMENT'
		]);
		const family = fixturePresent(
			file('version_4', 'allowance_catalog').find((row) => row.code === 'FAMILY_ALLOWANCE')
		);
		assert.equal(
			evaluateConfigured(
				fixtureString(String(family.amount)),
				fixtureContext({
					...payslipContext,
					allowance: { amount: 20000 },
					period: { ...payslipContext.period, paid_days: 15 }
				})
			),
			10000
		);
		for (const target of ['HEALTH', 'EI', 'INCOME_TAX'])
			assert.ok(fixtureValue3(family.counts_toward).includes(target));
		// Statutory leave classes: unpaid by the employer (the benefit is the insurer's), by gender where the law says.
		const leave = (code: string) =>
			fixturePresent(file('version_4', 'leave_catalog').find((row) => row.code === code));
		for (const code of [
			'PRENATAL_LEAVE',
			'POSTNATAL_LEAVE',
			'CHILDCARE_LEAVE',
			'POSTNATAL_PATERNITY_LEAVE',
			'FAMILY_CARE_LEAVE',
			'MENSTRUAL_LEAVE',
			'SICKNESS_ABSENCE',
			'OCCUPATIONAL_INJURY_ABSENCE'
		])
			assert.equal(leave(code).is_npl, true, code);
		const male = {
			...payslipContext,
			employee: { ...payslipContext.employee, gender: 'MALE' },
			entry: { occurred_on: '2026-04-10', facts: {} }
		};
		for (const code of ['PRENATAL_LEAVE', 'MENSTRUAL_LEAVE'])
			assert.equal(
				evaluateConfigured(fixtureString(String(leave(code).eligibility)), fixtureContext(male)),
				false,
				code
			);
		const npl = fixturePresent(
			file('version_4', 'work_catalog').find((row) => row.code === 'NO_PAY_LEAVE')
		);
		const prenatal = {
			...payslipContext,
			leave: {
				rows: [
					{
						code: 'PRENATAL_LEAVE',
						activity: 'TIME_OFF',
						days: 20,
						is_npl: true,
						from: '2026-04-11',
						to: '2026-05-22'
					}
				]
			},
			rules: payrollRules('version_4')
		};
		assert.equal(
			Number(evaluateConfigured(fixtureString(String(npl.quantity)), fixtureContext(prenatal))) *
				Number(evaluateConfigured(fixtureString(String(npl.rate)), fixtureContext(prenatal))),
			120000
		);
		const injury = fixturePresent(
			file('version_4', 'adhoc_catalog').find((row) => row.code === 'INJURY_WAITING_COMPENSATION')
		);
		assert.deepEqual(injury.counts_toward, []);
	});
	it('obligations: every due day evaluates for its trigger and the behaviours raise them', () => {
		const ISO = /^\d{4}-\d{2}-\d{2}$/;
		for (const version of versions) {
			const settings = settingsOf(version);
			const behaviours = fixtureValue22(settings.behaviours);
			const ids = behaviours.rules.map((rule) => rule.id);
			assert.equal(new Set(ids).size, ids.length);
			for (const id of [
				'payroll-run',
				'pin-settled-entries',
				'encash-leave-on-exit',
				'raise-obligations',
				'raise-tasks'
			])
				assert.ok(ids.includes(id), `${version} ${id}`);
			const rows = file(version, 'rule_set');
			const duties = dutiesOf(rows).map((row) => ({
				code: row.code,
				rules: fixtureValue5({ ...fixtureRecord(row.rules), trigger: triggerOf(row) })
			}));
			assert.equal(duties.length, 98);
			const plain = { region: 'TOKYO', risk_class: '', facts: {} };
			const japanese = {
				nationality: 'JP',
				gender: 'MALE',
				date_of_birth: '1990-01-01',
				facts: {}
			};
			for (const duty of duties) {
				const trigger = fixtureValue23(duty.rules.trigger);
				assert.ok(
					[
						'PAYROLL_RUN',
						'HIRE',
						'EXIT',
						'entity.created',
						'entity.updated',
						'calendar.daily',
						'workplace_case.created',
						'employment_profile.updated',
						'adhoc_catalog_entry.created',
						'leave_catalog_entry.created',
						'loan_catalog_entry.created',
						'payslip.updated'
					].includes(trigger)
				);
				const period = { key: '2026-02', from: '2026-02-01', to: '2026-02-28' };
				const context =
					trigger === 'PAYROLL_RUN'
						? {
								row: { period: '2026-02' },
								run: {},
								period,
								company: plain,
								holidays: [],
								headcount: 10
							}
						: trigger.endsWith('_entry.created') || trigger === 'payslip.updated'
							? {
									row: {
										line_codes: ['BASIC'],
										paid_on: '2026-02-25',
										catalog_code: 'X',
										occurred_on: '2026-02-03',
										from: '2026-02-03',
										to: '2026-02-20',
										days: 5
									},
									period,
									company: plain,
									contract: { facts: { contract_terms: [] } },
									employee: japanese,
									holidays: [],
									headcount: 10
								}
							: trigger === 'calendar.daily'
								? {
										row: { leave: [] },
										today: '2026-02-03',
										hired_on: '2025-08-03',
										contract: { facts: { contract_terms: [] } },
										employee: { ...japanese, children: [] },
										company: plain,
										holidays: [],
										headcount: 10
									}
								: trigger === 'workplace_case.created' || trigger === 'employment_profile.updated'
									? {
											row: {
												kind: 'DEPENDANT_CHANGE',
												opened_on: '2026-02-03',
												facts: {},
												children: []
											},
											today: '2026-02-03',
											hired_on: '2026-01-31',
											contract: { facts: { contract_terms: [] } },
											employee: japanese,
											company: plain,
											holidays: []
										}
									: trigger === 'entity.created' || trigger === 'entity.updated'
										? {
												row: { effective_range: { from: '2026-02-02' }, before: {} },
												today: '2026-02-03',
												period,
												company: plain,
												holidays: []
											}
										: {
												row: { leave: [] },
												today: '2026-01-31',
												hired_on: '2026-01-31',
												[trigger === 'HIRE' ? 'hired_on' : 'exit_on']: '2026-01-31',
												contract: {
													exit_ground: 'RESIGNATION',
													exit_facts: {},
													facts: { contract_terms: [] }
												},
												employee: japanese,
												company: plain,
												holidays: []
											};
				assert.match(
					String(
						evaluateConfigured(fixtureString(String(duty.rules.due)), fixtureContext(context))
					),
					ISO,
					fixtureValue23(duty.code)
				);
				if (duty.rules.applies_when != null)
					assert.equal(
						typeof evaluateConfigured(
							fixtureString(String(duty.rules.applies_when)),
							fixtureContext(context)
						),
						'boolean'
					);
			}
			const raise = (
				collection: string,
				event: string,
				row: Row,
				company: Row = plain,
				employee: Row = japanese,
				extra: {
					headcount?: number;
					day?: string;
				} = {}
			) =>
				Object.fromEntries(
					raiseDuties({
						behaviours,
						settings_id: settings.id,
						rows,
						collection,
						event,
						row,
						reads: { company: [company], employee: [employee] },
						...extra
					}).map((write) => [write.duty_code, write.due_on])
				);
			const run = (period: string, company: Row = plain) =>
				raise('payroll_run', 'created', { id: 'r1', company_id: 'c1', period }, company);
			// Filings and remittances falling on a weekend or published holiday move to the next working day.
			assert.deepEqual(run('2027-01'), {
				SOCIAL_INSURANCE_PAYMENT: '2027-03-01',
				WITHHOLDING_TAX_PAYMENT: '2027-02-10',
				RESIDENT_TAX_PAYMENT: '2027-02-10',
				RESIDENT_TAX_RETIREMENT_PAYMENT: '2027-02-10',
				PAYSLIP_DELIVERY: '2027-01-31',
				WAGE_LEDGER: '2027-01-31',
				WITHHOLDING_SLIPS_TO_EMPLOYEES: '2027-01-31',
				STATUTORY_RETURNS_SUMMARY: '2027-02-01',
				SALARY_PAYMENT_REPORT: '2027-02-01'
			});
			assert.equal(run('2026-07').SANTEI_KISO_REPORT, '2026-07-10');
			assert.equal(run('2026-06').LABOUR_INSURANCE_ANNUAL_DECLARATION, '2026-07-10');
			assert.ok(run('2026-12').YEAR_END_ADJUSTMENT);
			// Semi-annual special rules (所得税法 art.216, 地方税法 art.321の5の2) replace the monthly payments.
			const small = {
				...plain,
				facts: { withholding_semiannual_special: true, resident_tax_semiannual_special: true }
			};
			// Each month's remittance of a semi-annual payer is raised with its own amount and the half-year's due day.
			const june = run('2026-06', small);
			assert.equal(june.WITHHOLDING_TAX_PAYMENT, undefined);
			assert.equal(june.RESIDENT_TAX_PAYMENT, undefined);
			assert.equal(june.WITHHOLDING_TAX_SEMIANNUAL, '2026-07-10');
			assert.equal(run('2026-02', small).WITHHOLDING_TAX_SEMIANNUAL, '2026-07-10');
			assert.equal(run('2026-12', small).WITHHOLDING_TAX_SEMIANNUAL, '2027-01-20');
			assert.equal(run('2026-07', small).WITHHOLDING_TAX_SEMIANNUAL, '2027-01-20');
			assert.equal(run('2026-05', small).RESIDENT_TAX_SEMIANNUAL, '2026-06-10');
			assert.equal(run('2026-12', small).RESIDENT_TAX_SEMIANNUAL, '2027-06-10');
			assert.equal(run('2026-06', small).RESIDENT_TAX_SEMIANNUAL, '2026-12-10');
			assert.equal(run('2026-11', small).RESIDENT_TAX_SEMIANNUAL, '2026-12-10');
			assert.equal(run('2026-12').WITHHOLDING_TAX_SEMIANNUAL, undefined);
			// Headcount-bound reports: the disability quota binds from 40 (2.5%), then 37.5 from July 2026 (2.7%).
			const sized = (count: number) => ({ ...plain, facts: { regular_employee_count: count } });
			assert.equal(
				run('2027-06', sized(39)).DISABILITY_EMPLOYMENT_REPORT,
				Number(version.slice(8)) >= 5 ? '2027-07-15' : undefined
			);
			assert.equal(run('2026-06', sized(40)).DISABILITY_EMPLOYMENT_REPORT, '2026-07-15');
			// The older-workers report binds every employer (高年齢者雇用安定法 art.52(1)).
			assert.equal(run('2026-06').ELDERLY_EMPLOYMENT_REPORT, '2026-07-15');
			assert.equal(run('2026-05', sized(100)).DISABILITY_LEVY_DECLARATION, undefined);
			assert.equal(run('2026-05', sized(101)).DISABILITY_LEVY_DECLARATION, '2026-05-15');
			assert.equal(run('2026-06').DISABILITY_EMPLOYMENT_REPORT, undefined);
			const contract = {
				id: 'k1',
				company_id: 'c1',
				employee_id: 'p1',
				exit_ground: 'RESIGNATION',
				exit_facts: { ground: 'RESIGNATION', last_day: '2026-05-20' },
				effective_range: { from: '2026-04-01', to: '2026-05-20' },
				facts: {
					contract_terms: [
						{
							effective_range: { from: '2026-04-01', to: null },
							statutory_work_category: 'SOCIAL_AND_EMPLOYMENT'
						}
					]
				},
				employee_number: String('p1'),
				contract_number: 1
			};
			const uninsured = {
				...contract,
				facts: {
					contract_terms: [
						{ effective_range: { from: '2026-04-01', to: null }, statutory_work_category: 'NONE' }
					]
				}
			};
			const hire = (row: Row = contract, employee: Row = japanese) =>
				raise('employment_contract', 'created', row, plain, employee);
			const exit = (row: Row = contract, employee: Row = japanese) =>
				raise('employment_contract', 'updated', row, plain, employee);
			// 当該事実があった日から五日以内: 1 April → 5 April (a Sunday) → 6 April; 10 May (a Sunday) → 11 May.
			assert.deepEqual(hire(), {
				SOCIAL_INSURANCE_ACQUISITION: '2026-04-06',
				EMPLOYMENT_INSURANCE_ACQUISITION: '2026-05-11',
				WORKING_CONDITIONS_NOTICE: '2026-04-01',
				WORKER_REGISTER: '2026-04-01',
				MY_NUMBER_COLLECTION: '2026-04-01',
				HEALTH_CHECK_AT_HIRE: '2026-04-01'
			});
			assert.deepEqual(exit(), {
				SOCIAL_INSURANCE_LOSS: '2026-05-25',
				EMPLOYMENT_INSURANCE_LOSS: '2026-06-01',
				RESIDENT_TAX_TRANSFER: '2026-06-10',
				LEAVER_WITHHOLDING_SLIP: '2026-06-20',
				FINAL_WAGES_ON_REQUEST: '2026-05-27',
				RECORDS_RETENTION: '2031-05-20',
				PERSONAL_DATA_DISPOSAL: '2034-01-10'
			});
			// Coverage on the contract terms gates the insurance notices; an insured foreigner is reported on the EI forms.
			assert.deepEqual(Object.keys(hire(uninsured)).toSorted(), [
				'HEALTH_CHECK_AT_HIRE',
				'MY_NUMBER_COLLECTION',
				'WORKER_REGISTER',
				'WORKING_CONDITIONS_NOTICE'
			]);
			// The daily tick: the 5-day designation on each grant day (6 months after hire, then yearly), once.
			const daily = (day: string, row: Row = contract) =>
				raise('calendar', 'daily', row, plain, japanese, { day });
			assert.deepEqual(daily('2026-10-01'), {
				ANNUAL_LEAVE_FIVE_DAY_DESIGNATION: '2027-09-30',
				ANNUAL_LEAVE_REGISTER: '2026-10-01'
			});
			assert.deepEqual(daily('2027-10-01'), {
				ANNUAL_LEAVE_FIVE_DAY_DESIGNATION: '2028-09-30',
				ANNUAL_LEAVE_REGISTER: '2027-10-01'
			});
			assert.deepEqual(daily('2026-10-02'), {});
			assert.deepEqual(daily('2026-07-01'), {});
			const shortWeek = {
				...contract,
				facts: {
					contract_terms: [
						{
							effective_range: { from: '2026-04-01', to: null },
							statutory_work_category: 'EMPLOYMENT_ONLY',
							facts: { weekly_scheduled_days: 3, weekly_scheduled_hours: 18 }
						}
					]
				}
			};
			// A 3-day week is granted 5 days at 6 months (register only) and 10 from 5½ years, when the 5-day duty binds.
			assert.deepEqual(daily('2026-10-01', shortWeek), { ANNUAL_LEAVE_REGISTER: '2026-10-01' });
			assert.deepEqual(daily('2030-10-01', shortWeek), { ANNUAL_LEAVE_REGISTER: '2030-10-01' });
			assert.deepEqual(daily('2031-10-01', shortWeek), {
				ANNUAL_LEAVE_FIVE_DAY_DESIGNATION: '2032-09-30',
				ANNUAL_LEAVE_REGISTER: '2031-10-01'
			});
			const fourDay = {
				...shortWeek,
				facts: {
					contract_terms: [
						{
							effective_range: { from: '2026-04-01', to: null },
							statutory_work_category: 'EMPLOYMENT_ONLY',
							facts: { weekly_scheduled_days: 4, weekly_scheduled_hours: 24 }
						}
					]
				}
			};
			assert.equal(daily('2028-10-01', fourDay).ANNUAL_LEAVE_FIVE_DAY_DESIGNATION, undefined);
			assert.equal(daily('2029-10-01', fourDay).ANNUAL_LEAVE_FIVE_DAY_DESIGNATION, '2030-09-30');
			// Entry-class tasks (row.catalog_code): bonus report, premium exemptions and the work-injury report.
			const entry = (collection: string, catalog_code: string, row: Row = {}) =>
				raise(collection, 'created', {
					id: 'e1',
					company_id: 'c1',
					employment_id: 'k1',
					employee_id: 'p1',
					catalog_code,
					...row
				});
			const withContract = (collection: string, code: string, row: Row) =>
				Object.fromEntries(
					raiseDuties({
						behaviours,
						settings_id: settings.id,
						rows,
						collection,
						event: 'created',
						row: {
							id: 'e1',
							company_id: 'c1',
							employment_id: 'k1',
							employee_id: 'p1',
							catalog_code: code,
							...row
						},
						reads: { company: [plain], employee: [japanese], contract: [contract] }
					}).map((write) => [write.duty_code, write.due_on])
				);
			// The bonus payment report: a paid payslip carrying a BONUS line (row.line_codes, row.paid_on).
			const paidSlip = (line_codes: string[]) =>
				Object.fromEntries(
					raiseDuties({
						behaviours,
						settings_id: settings.id,
						rows,
						collection: 'payslip',
						event: 'updated',
						row: {
							id: 's1',
							company_id: 'c1',
							employment_id: 'k1',
							employee_id: 'p1',
							status: 'PAID',
							line_codes,
							paid_on: '2026-07-10'
						},
						day: '2026-07-10',
						reads: { company: [plain], employee: [japanese], contract: [contract] }
					}).map((write) => [write.duty_code, write.due_on])
				);
			assert.deepEqual(paidSlip(['BASIC', 'BONUS']), { BONUS_PAYMENT_REPORT: '2026-07-14' });
			assert.deepEqual(paidSlip(['BASIC']), {});
			assert.deepEqual(
				withContract('adhoc_catalog_entry', 'BONUS', { occurred_on: '2026-07-10' }),
				{}
			);
			// The 36 agreement on record (customer input): its renewal is raised in the month before the expiry month.
			const agreed = { ...plain, facts: { overtime_agreement_to: '2027-03-31' } };
			const renewal = (period: string) =>
				raise('payroll_run', 'created', { id: 'r7', company_id: 'c1', period }, agreed)
					.OVERTIME_AGREEMENT_RENEWAL;
			assert.equal(renewal('2027-02'), '2027-03-31');
			assert.equal(renewal('2027-03'), undefined);
			assert.deepEqual(
				entry('adhoc_catalog_entry', 'SHUTDOWN_ALLOWANCE', { occurred_on: '2026-07-10' }),
				{}
			);
			assert.deepEqual(
				withContract('leave_catalog_entry', 'PRENATAL_LEAVE', {
					from: '2026-06-01',
					to: '2026-07-12',
					days: 42
				}),
				{ MATERNITY_PREMIUM_EXEMPTION: '2026-07-13', CHILDCARE_INDIVIDUAL_NOTICE: '2026-06-01' }
			);
			assert.deepEqual(
				withContract('leave_catalog_entry', 'CHILDCARE_LEAVE', {
					from: '2026-08-01',
					to: '2027-03-31',
					days: 243
				}),
				{
					CHILDCARE_PREMIUM_EXEMPTION: '2027-03-31',
					// The month of the day four months from the start; the grade change three months after the return.
					CHILDCARE_BENEFIT_APPLICATION: '2026-11-30',
					CHILDCARE_END_GRADE_CHANGE: '2027-07-12'
				}
			);
			assert.deepEqual(
				entry('leave_catalog_entry', 'OCCUPATIONAL_INJURY_ABSENCE', {
					from: '2026-05-11',
					days: 6
				}),
				{ WORK_INJURY_REPORT: '2026-05-14' }
			);
			assert.deepEqual(
				entry('leave_catalog_entry', 'OCCUPATIONAL_INJURY_ABSENCE', {
					from: '2026-05-11',
					days: 2
				}),
				{ WORK_INJURY_REPORT_QUARTERLY: '2026-07-31' }
			);
			// Headcount (the entity's employments in force): women's advancement publication from 101, disability quota.
			const publisher = { ...plain, facts: { business_year_end_month: 3 } };
			const april = (headcount: number, company: Row = publisher) =>
				raise(
					'payroll_run',
					'created',
					{ id: 'r9', company_id: 'c1', period: '2027-04' },
					company,
					japanese,
					{ headcount }
				);
			assert.equal(april(101).WOMEN_ADVANCEMENT_PUBLICATION, '2027-06-30');
			assert.equal(april(100).WOMEN_ADVANCEMENT_PUBLICATION, undefined);
			assert.equal(april(500, plain).WOMEN_ADVANCEMENT_PUBLICATION, undefined);
			const juneRun = (headcount: number) =>
				raise(
					'payroll_run',
					'created',
					{ id: 'r8', company_id: 'c1', period: '2026-06' },
					plain,
					japanese,
					{ headcount }
				);
			assert.equal(juneRun(45).DISABILITY_EMPLOYMENT_REPORT, '2026-07-15');
			assert.equal(juneRun(30).DISABILITY_EMPLOYMENT_REPORT, undefined);
			const foreigner = { ...japanese, nationality: 'VN' };
			assert.equal(hire(contract, foreigner).FOREIGN_WORKER_HIRE_NOTIFICATION, undefined);
			assert.equal(hire(uninsured, foreigner).FOREIGN_WORKER_HIRE_NOTIFICATION, '2026-06-01');
			assert.equal(exit(uninsured, foreigner).FOREIGN_WORKER_EXIT_NOTIFICATION, '2026-06-30');
			// Business start: the establishment notices count from the entity's own start day.
			assert.deepEqual(
				raise('entity', 'created', {
					id: 'c1',
					effective_range: { from: '2026-04-01', to: null }
				}),
				{
					SOCIAL_INSURANCE_NEW_ESTABLISHMENT: '2026-04-06',
					LABOUR_INSURANCE_ESTABLISHMENT: '2026-04-13',
					LABOUR_INSURANCE_PROVISIONAL_DECLARATION: '2026-05-21',
					EMPLOYMENT_INSURANCE_ESTABLISHMENT: '2026-04-13',
					PAYROLL_OFFICE_OPENING: '2026-05-01',
					CHILDCARE_ENVIRONMENT_MEASURES: '2026-04-01',
					HARASSMENT_PREVENTION_MEASURES: '2026-04-01'
				}
			);
			assert.equal(exit({ ...contract, exit_ground: 'DISMISSAL' }).DISMISSAL_NOTICE, '2026-04-20');
			// Art.21 exclusions: probation within 14 days, a term of two months or less, or a certified exception.
			const dismissed = (exit_facts: Row, range = contract.effective_range) =>
				exit({ ...contract, exit_ground: 'DISMISSAL', exit_facts, effective_range: range })
					.DISMISSAL_NOTICE;
			assert.equal(
				dismissed({ probation: true }, { from: '2026-04-01', to: '2026-04-10' }),
				undefined
			);
			assert.equal(dismissed({ probation: true }), '2026-04-20');
			assert.equal(dismissed({ fixed_term_within_two_months: true }), undefined);
			assert.equal(dismissed({ dismissal_exception_certified: true }), undefined);
			// Leaving: the certificate on request; non-renewal notice after three renewals or a year.
			assert.equal(
				exit({ ...contract, exit_facts: { certificate_requested: true } }).SEPARATION_CERTIFICATE,
				'2026-05-20'
			);
			assert.equal(exit().SEPARATION_CERTIFICATE, undefined);
			const ending = (exit_facts: Row) =>
				exit({ ...contract, exit_ground: 'END_OF_CONTRACT', exit_facts }).NON_RENEWAL_NOTICE;
			assert.equal(ending({ renewal_count: 3 }), '2026-04-20');
			assert.equal(ending({ renewal_count: 1 }), undefined);
			// Hire: the part-time/fixed-term statement; the special-collection switch the hire asks for.
			const partTime = {
				...contract,
				facts: {
					contract_terms: [
						{
							effective_range: { from: '2026-04-01', to: null },
							statutory_work_category: 'EMPLOYMENT_ONLY',
							employment_type: 'PART_TIME'
						}
					]
				}
			};
			assert.equal(hire(partTime).PART_TIME_TERMS_NOTICE, '2026-04-01');
			assert.equal(hire().PART_TIME_TERMS_NOTICE, undefined);
			assert.equal(
				hire(contract, { ...japanese, facts: { resident_tax_special_collection_switch: true } })
					.RESIDENT_TAX_SPECIAL_COLLECTION_SWITCH,
				'2026-04-30'
			);
			// Age events on the daily tick (the contract covers social and employment insurance).
			const born = (date_of_birth: string, day: string) =>
				raise('calendar', 'daily', contract, plain, { ...japanese, date_of_birth }, { day });
			assert.deepEqual(born('1951-06-15', '2026-06-15'), { HEALTH_LOSS_AT_75: '2026-06-19' });
			assert.deepEqual(born('1956-06-15', '2026-06-14'), { PENSION_AGE_70: '2026-06-18' });
			assert.deepEqual(born('1966-06-15', '2026-06-14'), {
				OLDER_WORKER_CONTINUATION_BENEFIT: '2026-11-02'
			});
			assert.deepEqual(born('1986-06-15', '2026-06-14'), { CARE_INFORMATION_AT_40: '2027-03-31' });
			assert.deepEqual(born('1986-06-15', '2026-06-15'), {});
			// Five years of fixed terms: the conversion right is stated at the renewal.
			const fixed = {
				...contract,
				effective_range: { from: '2021-04-01', to: null },
				facts: {
					contract_terms: [
						{
							effective_range: { from: '2021-04-01', to: null },
							statutory_work_category: 'SOCIAL_AND_EMPLOYMENT',
							employment_type: 'FIXED_TERM'
						}
					]
				}
			};
			assert.equal(daily('2026-04-01', fixed).INDEFINITE_CONVERSION_NOTICE, '2026-04-01');
			assert.equal(daily('2026-04-01', contract).INDEFINITE_CONVERSION_NOTICE, undefined);
			// A shortened-hours childcare term starting today raises the 育児時短就業給付 application.
			const shortHours = {
				...contract,
				facts: {
					contract_terms: [
						{
							effective_range: { from: '2026-06-01', to: null },
							statutory_work_category: 'SOCIAL_AND_EMPLOYMENT',
							facts: { childcare_short_hours: true }
						}
					]
				}
			};
			assert.equal(daily('2026-06-01', shortHours).SHORT_HOURS_CHILDCARE_BENEFIT, '2026-09-30');
			// Leave events: the grade change after maternity and childcare leave, the EI benefit applications, the care notice.
			assert.deepEqual(
				withContract('leave_catalog_entry', 'POSTNATAL_LEAVE', {
					from: '2026-07-13',
					to: '2026-09-06',
					days: 56
				}),
				{ MATERNITY_PREMIUM_EXEMPTION: '2026-09-07', MATERNITY_END_GRADE_CHANGE: '2026-12-10' }
			);
			assert.deepEqual(
				withContract('leave_catalog_entry', 'POSTNATAL_PATERNITY_LEAVE', {
					from: '2026-06-01',
					to: '2026-06-14',
					days: 14,
					facts: { child_birth_date: '2026-05-25' }
				}),
				{
					CHILDCARE_PREMIUM_EXEMPTION: '2026-06-15',
					PATERNITY_BENEFIT_APPLICATION: '2026-09-30',
					CHILDCARE_INDIVIDUAL_NOTICE: '2026-06-01'
				}
			);
			assert.deepEqual(
				withContract('leave_catalog_entry', 'FAMILY_CARE_LEAVE', {
					from: '2026-06-01',
					to: '2026-08-31',
					days: 66
				}),
				{ CARE_LEAVE_BENEFIT_APPLICATION: '2026-11-02', CARE_INDIVIDUAL_NOTICE: '2026-06-01' }
			);
			// Ad hoc and loan entries: the retirement income slip within a month; the emergency payment on request.
			assert.deepEqual(
				entry('adhoc_catalog_entry', 'RETIREMENT_ALLOWANCE', { occurred_on: '2026-05-20' }),
				{
					RETIREMENT_INCOME_SLIP: '2026-06-22'
				}
			);
			assert.deepEqual(
				entry('loan_catalog_entry', 'EMERGENCY_ADVANCE', { occurred_on: '2026-05-20' }),
				{
					EMERGENCY_PAYMENT: '2026-05-20'
				}
			);
			// Payroll-run duties by headcount and customer input.
			const sizedRun = (period: string, headcount: number, company: Row = plain) =>
				raise(
					'payroll_run',
					'created',
					{ id: `h${period}`, company_id: 'c1', period },
					company,
					japanese,
					{
						headcount
					}
				);
			assert.equal(sizedRun('2026-05', 10).WORK_RULES_FILING, '2026-06-01');
			assert.equal(sizedRun('2026-05', 9).WORK_RULES_FILING, undefined);
			assert.equal(
				sizedRun('2026-05', 10, { ...plain, facts: { work_rules_filed_on: '2025-04-01' } })
					.WORK_RULES_FILING,
				undefined
			);
			const large = { ...plain, facts: { business_year_end_month: 3 } };
			const big = sizedRun('2027-04', 301, large);
			assert.equal(big.MALE_CHILDCARE_LEAVE_PUBLICATION, '2027-06-30');
			assert.equal(big.MID_CAREER_HIRING_PUBLICATION, '2027-06-30');
			assert.equal(big.NEXT_GENERATION_ACTION_PLAN, '2027-04-30');
			assert.equal(big.WOMEN_ACTION_PLAN, '2027-04-30');
			assert.equal(sizedRun('2027-04', 300, large).MALE_CHILDCARE_LEAVE_PUBLICATION, undefined);
			assert.equal(
				sizedRun('2027-04', 150, { ...plain, facts: { next_generation_plan_until: '2028-03-31' } })
					.NEXT_GENERATION_ACTION_PLAN,
				undefined
			);
			assert.equal(run('2026-10').MINIMUM_WAGE_POSTING, '2026-10-01');
			assert.equal(run('2026-11').MINIMUM_WAGE_POSTING, undefined);
			const filing = (count: number) =>
				run('2027-01', { ...plain, facts: { statutory_return_count_two_years_prior: count } })
					.STATUTORY_RETURNS_E_FILING;
			assert.equal(filing(100), '2027-02-01');
			assert.equal(filing(30), Number(version.slice(8)) >= 8 ? '2027-02-01' : undefined);
			// Instalments of a labour insurance association member fall on 14 November and 14 February.
			const instalments = (association: boolean) => ({
				...plain,
				facts: { labour_insurance_instalments: true, labour_insurance_association: association }
			});
			assert.equal(run('2026-10', instalments(false)).LABOUR_INSURANCE_INSTALMENT_2, '2026-11-02');
			assert.equal(run('2026-10', instalments(true)).LABOUR_INSURANCE_INSTALMENT_2, '2026-11-16');
			assert.equal(run('2027-01', instalments(true)).LABOUR_INSURANCE_INSTALMENT_3, '2027-02-15');
			// Remittances follow the month of payment (run.pay_date): June pay on 5 July is remitted by 10 August.
			const paidOn = (period: string, pay_date: string, company: Row = plain) =>
				Object.fromEntries(
					raiseDuties({
						behaviours,
						settings_id: settings.id,
						rows,
						collection: 'payroll_run',
						event: 'created',
						row: { id: `p${period}`, company_id: 'c1', period },
						reads: { company: [company], employee: [japanese] },
						run: {
							pay_date,
							totals: {
								schemes: {
									INCOME_TAX: { employee: 1, employer: 0 },
									RESIDENT_TAX: { employee: 1, employer: 0 }
								}
							}
						}
					}).map((write) => [write.duty_code, write.due_on])
				);
			const julyPaid = paidOn('2026-06', '2026-07-05');
			assert.equal(julyPaid.WITHHOLDING_TAX_PAYMENT, '2026-08-10');
			assert.equal(julyPaid.RESIDENT_TAX_PAYMENT, '2026-08-10');
			assert.equal(paidOn('2026-06', '2026-06-25').WITHHOLDING_TAX_PAYMENT, '2026-07-10');
			assert.equal(paidOn('2026-06', '2026-07-05', small).WITHHOLDING_TAX_SEMIANNUAL, '2027-01-20');
			assert.equal(paidOn('2026-11', '2026-12-05', small).RESIDENT_TAX_SEMIANNUAL, '2027-06-10');
			// Business start: the childcare-environment and harassment measures bind every employer.
			const opened = raise('entity', 'created', {
				id: 'c1',
				effective_range: { from: '2026-04-01', to: null }
			});
			assert.equal(opened.CHILDCARE_ENVIRONMENT_MEASURES, '2026-04-01');
			assert.equal(opened.HARASSMENT_PREVENTION_MEASURES, '2026-04-01');
			// Health checks: at hire, on each anniversary for a regular worker, the result report and stress check at 50+.
			assert.equal(daily('2027-04-01').PERIODIC_HEALTH_CHECK, '2027-04-01');
			assert.equal(daily('2027-04-01', shortWeek).PERIODIC_HEALTH_CHECK, undefined);
			const checked = { ...plain, facts: { health_check_month: 9 } };
			assert.equal(sizedRun('2026-09', 50, checked).HEALTH_CHECK_REPORT, '2026-09-30');
			assert.equal(sizedRun('2026-09', 50, checked).STRESS_CHECK, '2026-09-30');
			assert.equal(sizedRun('2026-09', 49, checked).STRESS_CHECK, undefined);
			assert.equal(run('2026-12').DEPENDANT_DECLARATION_COLLECTION, '2026-12-31');
			assert.equal(run('2027-01', instalments(false)).LABOUR_INSURANCE_INSTALMENT_3, '2027-02-01');
			assert.equal(run('2026-10').LABOUR_INSURANCE_INSTALMENT_2, undefined);
		}
	});
	it('round-8 roots: the 80% attendance test, benefit repeats, the dismissal restriction, dependant and age-3 notices', () => {
		// ── 労働基準法 art.39(1): the grant needs 80% attendance over the window before it ──────────────────────────
		const weekdays = (
			from: string,
			to: string,
			mark: (date: string) => Partial<AttendanceDay> = () => ({})
		) => {
			const out: AttendanceDay[] = [];
			for (let t = Date.parse(from); t <= Date.parse(to); t += 86400000) {
				const date = new Date(t).toISOString().slice(0, 10);
				const day = new Date(t).getUTCDay();
				const scheduled = day !== 0 && day !== 6;
				out.push({
					date,
					scheduled,
					worked: scheduled,
					holiday: false,
					leave: [],
					...(scheduled ? mark(date) : {})
				});
			}
			return out;
		};
		// Employed 1 April 2025; the 六箇月経過日 is 1 October 2025. April–September: 131 scheduled weekdays.
		const absent =
			(from: string, to: string, leave: string[] = [], holiday = false) =>
			(date: string) =>
				date >= from && date <= to ? { worked: false, leave, holiday } : {};
		for (const version of versions) {
			const annual = seedClass(
				file(version, 'leave_catalog').find((row) => row.code === 'ANNUAL_LEAVE')
			);
			const grant = (days: AttendanceDay[], asOf = '2025-10-01', serviceMonths = 6) =>
				fixturePresent(
					leaveBalances({
						classes: [annual],
						movements: [],
						serviceMonths,
						asOf,
						employmentStart: '2025-04-01',
						attendanceDays: days.filter((day) => day.date <= asOf),
						context: { terms: { facts: {} } }
					})[0]
				).entitlement;
			const year = (mark?: (date: string) => Partial<AttendanceDay>) =>
				weekdays('2025-04-01', '2026-10-01', mark);
			assert.equal(grant(year()), 10, version);
			// 30 weekdays absent (2–30 June minus weekends ≈ 21, plus 1–13 May): 101 of 131 is under 80%.
			const away = absent('2025-05-01', '2025-06-13');
			assert.equal(grant(year(away)), 0, version);
			// The same days on childcare, maternity or injury leave count as attended; unpaid leave does not.
			for (const code of [
				'CHILDCARE_LEAVE',
				'POSTNATAL_LEAVE',
				'OCCUPATIONAL_INJURY_ABSENCE',
				'ANNUAL_LEAVE'
			])
				assert.equal(
					grant(year(absent('2025-05-01', '2025-06-13', [code]))),
					10,
					`${version} ${code}`
				);
			assert.equal(grant(year(absent('2025-05-01', '2025-06-13', ['UNPAID_LEAVE']))), 0, version);
			// Published holidays leave the 全労働日: 24 absences and 9 unworked holidays pass (98 of 122), not 98 of 131.
			const holidays = (date: string) =>
				date >= '2025-07-01' && date <= '2025-07-11'
					? { worked: false, holiday: true }
					: date >= '2025-08-01' && date <= '2025-09-03'
						? { worked: false }
						: {};
			assert.equal(grant(year(holidays)), 10, version);
			// 代替休暇 days leave it too.
			assert.equal(
				grant(year(absent('2025-05-01', '2025-06-13', ['SUBSTITUTE_LEAVE_FOR_OVERTIME']))),
				10,
				version
			);
			// Months before the roster was kept here (no attendance and no leave at all) leave both sides.
			assert.equal(grant(year(absent('2025-04-01', '2025-06-30'))), 10, version);
			// The next grant year (1½ years, 11 days) reads October 2025–September 2026.
			assert.equal(grant(year(), '2026-10-01', 18), 11, version);
			assert.equal(grant(year(absent('2026-03-02', '2026-05-29')), '2026-10-01', 18), 0, version);
			// No 全労働日 recorded: the grant stands.
			assert.equal(grant([]), 10, version);
		}
		// ── duties on the new task roots ───────────────────────────────────────────────────────────────────────
		const plain = { region: 'TOKYO', risk_class: '', facts: {} };
		const insured = (facts: Row = {}, from = '2026-04-01') => ({
			id: 'k1',
			company_id: 'c1',
			employee_id: 'p1',
			exit_ground: '',
			exit_facts: {},
			effective_range: { from: '2025-04-01', to: null },
			facts: {
				contract_terms: [
					{
						effective_range: { from, to: null },
						statutory_work_category: 'SOCIAL_AND_EMPLOYMENT',
						facts
					}
				]
			},
			leave: fixtureValue4([]),
			employee_number: String('p1'),
			contract_number: 1
		});
		for (const version of versions) {
			const settings = settingsOf(version);
			const behaviours = fixtureValue22(settings.behaviours);
			const rows = file(version, 'rule_set');
			const raise = (
				collection: string,
				event: string,
				row: Row,
				input: {
					day?: string;
					employee?: Row;
					contract?: Row;
					raised?: Row[];
				} = {}
			) =>
				Object.fromEntries(
					raiseDuties({
						behaviours,
						settings_id: settings.id,
						rows,
						collection,
						event,
						row,
						...(input.day == null ? {} : { day: input.day }),
						reads: {
							company: [plain],
							employee: [
								input.employee ?? {
									gender: 'FEMALE',
									date_of_birth: '1990-01-01',
									children: [],
									facts: {}
								}
							],
							...(input.contract == null ? {} : { contract: [input.contract] }),
							...(input.raised == null ? {} : { raised: input.raised })
						}
					}).map((write) => [write.duty_code, [write.due_on, write.occurrence_key]])
				);
			const due = (out: Record<string, unknown>, code: string) => fixtureValue24(out[code])?.[0];
			const key = (out: Record<string, unknown>, code: string) => fixtureValue24(out[code])?.[1];
			const daily = (day: string, row: Row, employee?: Row) =>
				raise('calendar', 'daily', row, { day, ...(employee == null ? {} : { employee }) });
			// 育児休業給付金: a pair of 支給単位期間 from the second, due the month-end four months after the pair starts.
			const onLeave = {
				...insured(),
				leave: [
					{ code: 'CHILDCARE_LEAVE', from: '2026-06-03', to: '2027-03-31', days: 200, facts: {} }
				]
			};
			assert.equal(
				due(daily('2026-07-15', onLeave), 'CHILDCARE_BENEFIT_REPEAT'),
				undefined,
				version
			);
			const second = daily('2026-08-03', onLeave);
			// 3 August → 3 December − 1 day → 31 December (a Thursday).
			assert.equal(due(second, 'CHILDCARE_BENEFIT_REPEAT'), '2026-12-31', version);
			assert.equal(
				key(second, 'CHILDCARE_BENEFIT_REPEAT'),
				'CHILDCARE_BENEFIT_REPEAT:c1:k1:2026-06-03:1'
			);
			// 3 October → 2 February 2027 → 28 February (a Sunday) → 1 March.
			assert.equal(
				due(daily('2026-10-15', onLeave), 'CHILDCARE_BENEFIT_REPEAT'),
				'2027-03-01',
				version
			);
			// Raised once per pair: the key already held on the subject raises nothing.
			assert.equal(
				due(
					raise('calendar', 'daily', onLeave, {
						day: '2026-08-20',
						raised: [{ occurrence_key: 'CHILDCARE_BENEFIT_REPEAT:c1:k1:2026-06-03:1' }]
					}),
					'CHILDCARE_BENEFIT_REPEAT'
				),
				undefined
			);
			assert.equal(
				due(daily('2027-04-05', onLeave), 'CHILDCARE_BENEFIT_REPEAT'),
				undefined,
				version
			);
			// 育児時短就業給付: month pairs from the term's first month; June term → August pair due 30 November.
			const short = insured({ childcare_short_hours: true }, '2026-06-01');
			assert.equal(
				due(daily('2026-07-10', short), 'SHORT_HOURS_CHILDCARE_BENEFIT_REPEAT'),
				undefined,
				version
			);
			assert.equal(
				due(daily('2026-08-10', short), 'SHORT_HOURS_CHILDCARE_BENEFIT_REPEAT'),
				'2026-11-30',
				version
			);
			assert.equal(
				key(daily('2026-09-01', short), 'SHORT_HOURS_CHILDCARE_BENEFIT_REPEAT'),
				'SHORT_HOURS_CHILDCARE_BENEFIT_REPEAT:c1:k1:2026-06-01:1'
			);
			assert.equal(
				due(daily('2026-10-01', short), 'SHORT_HOURS_CHILDCARE_BENEFIT_REPEAT'),
				'2027-02-01',
				version
			);
			// 高年齢雇用継続給付: reached 60 on 14 June 2026 → first month July; the September pair is due 31 December.
			const older = { gender: 'MALE', date_of_birth: '1966-06-15', children: [], facts: {} };
			const claiming = insured({ older_worker_continuation_benefit: true });
			assert.equal(
				due(daily('2026-09-01', claiming, older), 'OLDER_WORKER_CONTINUATION_BENEFIT_REPEAT'),
				'2026-12-31',
				version
			);
			assert.equal(
				due(daily('2026-08-20', claiming, older), 'OLDER_WORKER_CONTINUATION_BENEFIT_REPEAT'),
				undefined,
				version
			);
			assert.equal(
				due(daily('2026-09-01', insured(), older), 'OLDER_WORKER_CONTINUATION_BENEFIT_REPEAT'),
				undefined,
				version
			);
			// Through the month of reaching 65 (14 June 2031), not after.
			assert.ok(
				due(daily('2031-05-01', claiming, older), 'OLDER_WORKER_CONTINUATION_BENEFIT_REPEAT'),
				version
			);
			assert.equal(
				due(daily('2031-07-01', claiming, older), 'OLDER_WORKER_CONTINUATION_BENEFIT_REPEAT'),
				undefined,
				version
			);
			// 解雇制限: a dismissal inside 産後休業 + 30 days or an injury absence is flagged; lifted by 打切補償.
			const dismissed = (
				leave: Row[],
				exit_on: string,
				exit_facts: Row = {},
				exit_ground = 'DISMISSAL'
			) =>
				due(
					raise('employment_contract', 'updated', {
						...insured(),
						exit_ground,
						exit_facts,
						effective_range: { from: '2025-04-01', to: exit_on },
						leave
					}),
					'DISMISSAL_RESTRICTION'
				);
			const postnatal = [
				{ code: 'POSTNATAL_LEAVE', from: '2026-07-13', to: '2026-09-06', days: 56, facts: {} }
			];
			assert.equal(dismissed(postnatal, '2026-10-06'), '2026-10-06', version);
			assert.equal(dismissed(postnatal, '2026-10-07'), undefined, version);
			assert.equal(dismissed(postnatal, '2026-10-06', {}, 'RESIGNATION'), undefined, version);
			assert.equal(
				dismissed(postnatal, '2026-10-06', { dismissal_restriction_lifted: true }),
				undefined,
				version
			);
			const injury = [
				{
					code: 'OCCUPATIONAL_INJURY_ABSENCE',
					from: '2026-05-11',
					to: '2026-05-31',
					days: 15,
					facts: {}
				}
			];
			assert.equal(dismissed(injury, '2026-05-20', {}, 'REDUNDANCY'), '2026-05-20', version);
			assert.equal(
				dismissed([{ ...injury[0], code: 'SICKNESS_ABSENCE' }], '2026-05-20'),
				undefined,
				version
			);
			// 被扶養者(異動)届: a DEPENDANT_CHANGE case within 5 days of the change (counting its day), insured only.
			const kase = (facts: Row, contract: Row = insured(), kind = 'DEPENDANT_CHANGE') =>
				due(
					raise(
						'workplace_case',
						'created',
						{
							id: 'w1',
							company_id: 'c1',
							employment_id: 'k1',
							kind,
							opened_on: '2026-06-10',
							facts
						},
						{ contract }
					),
					'DEPENDANT_CHANGE_NOTICE'
				);
			assert.equal(kase({}), '2026-06-15', version); // 10 June + 4 = 14 June (a Sunday) → 15 June.
			assert.equal(kase({ changed_on: '2026-06-08' }), '2026-06-12', version);
			assert.equal(kase({}, insured(), 'OTHER'), undefined, version);
			const uninsured = insured();
			fixtureValue5(uninsured.facts.contract_terms[0]).statutory_work_category = 'EMPLOYMENT_ONLY';
			assert.equal(kase({}, uninsured), undefined, version);
			assert.ok(
				fixtureValue4(
					fixtureRecord(
						fixturePresent(file(version, 'rule_set').find((row) => row.code === 'case_kinds')).rules
					).kinds
				).some((kind) => kind.code === 'DEPENDANT_CHANGE')
			);
			// A newborn recorded on the profile: once per birth date, 5 days from the birth.
			const profile = (children: Row[], day: string) =>
				raise(
					'employment_profile',
					'updated',
					{ id: 'p1', employee_id: 'p1', children },
					{ day, contract: insured() }
				);
			const newborn = profile(
				[{ child_birthdate: '2026-06-02', relationship: 'CHILD' }],
				'2026-06-04'
			);
			assert.equal(due(newborn, 'DEPENDANT_BIRTH_NOTICE'), '2026-06-08', version);
			assert.equal(
				key(newborn, 'DEPENDANT_BIRTH_NOTICE'),
				'DEPENDANT_BIRTH_NOTICE:c1:p1:2026-06-02'
			);
			assert.equal(
				due(
					profile([{ child_birthdate: '2024-01-10', relationship: 'CHILD' }], '2026-06-04'),
					'DEPENDANT_BIRTH_NOTICE'
				),
				undefined,
				version
			);
			// 3歳到達前の個別周知: born 15 March 2025 → window 16 February 2027 to 15 February 2028.
			const parent = {
				gender: 'MALE',
				date_of_birth: '1990-01-01',
				children: [{ child_birthdate: '2025-03-15', relationship: 'CHILD' }],
				facts: {}
			};
			assert.equal(
				due(daily('2027-02-15', insured(), parent), 'CHILD_AGE_THREE_NOTICE'),
				undefined,
				version
			);
			const notice = daily('2027-02-16', insured(), parent);
			assert.equal(due(notice, 'CHILD_AGE_THREE_NOTICE'), '2028-02-15', version);
			assert.equal(
				key(notice, 'CHILD_AGE_THREE_NOTICE'),
				'CHILD_AGE_THREE_NOTICE:c1:k1:2025-03-15'
			);
			assert.equal(
				due(daily('2028-02-16', insured(), parent), 'CHILD_AGE_THREE_NOTICE'),
				undefined,
				version
			);
		}
	});
	it('日額表 and 現物給与: weekly and daily withholding on the transcribed tables, remuneration in kind at the 告示 price', () => {
		// Cells read off the NTA 日額表 (令和7年分, 令和8年分, 令和9年分): first and last rows, a middle row, every 甲 column at
		// the formula edges, the 乙 and 丙 bands.
		const OFFICIAL: Record<
			number,
			{
				rows: number;
				first: number[];
				last: number[];
				edges: Record<number, number[]>;
				otsu: number[][];
				hei: number[][];
			}
		> = {
			2025: {
				rows: 215,
				first: [2900, 2950, 5, 0, 0, 0, 0, 0, 0, 0, 100, 0],
				last: [23900, 24000, 2295, 2080, 1870, 1655, 1435, 1220, 1005, 790, 8270, 776],
				edges: {
					24000: [2305],
					57000: [12550, 12340, 12125, 11910, 11690, 11475, 11260, 11045],
					116500: [37400]
				},
				otsu: [
					[57000, 21800, 0.45945],
					[24000, 8320, 0.4084]
				],
				hei: [
					[116500, 28643, 0.4084],
					[57000, 8595, 0.33693],
					[32000, 2214, 0.25525],
					[26000, 989, 0.2042],
					[24000, 785, 0.1021]
				]
			},
			2026: {
				rows: 205,
				first: [3500, 3600, 5, 0, 0, 0, 0, 0, 0, 0, 120, 0],
				last: [23900, 24000, 2240, 2025, 1810, 1590, 1380, 1165, 950, 730, 8250, 738],
				edges: {
					24000: [2250, 2035, 1820, 1600, 1390, 1175, 960, 740],
					26500: [2760, 2545, 2330, 2115, 1900, 1685, 1470, 1250],
					32500: [4170, 3955, 3740, 3525, 3310, 3095, 2880, 2660],
					57500: [12595, 12380, 12165, 11950, 11735, 11520, 11305, 11085],
					71000: [18225, 18010, 17795, 17575, 17360, 17145, 16935, 16715],
					116500: [37360, 37145, 36930, 36710, 36495, 36280, 36070, 35850]
				},
				otsu: [
					[57500, 21980, 0.45945],
					[24000, 8300, 0.4084]
				],
				hei: [
					[116500, 28486, 0.4084],
					[57500, 8608, 0.33693],
					[32500, 2226, 0.25525],
					[26500, 1001, 0.2042],
					[24000, 746, 0.1021]
				]
			},
			2027: {
				rows: 203,
				first: [3700, 3800, 5, 0, 0, 0, 0, 0, 0, 0, 130, 0],
				last: [23900, 24000, 2220, 2000, 1785, 1570, 1355, 1145, 925, 710, 8240, 722],
				edges: {
					24000: [2230, 2010, 1795, 1580, 1370, 1155, 935, 720],
					58000: [12745, 12525, 12310, 12100, 11885, 11670, 11450, 11235],
					116500: [37345, 37125, 36910, 36695, 36480, 36265, 36045, 35835]
				},
				otsu: [
					[58000, 22180, 0.45945],
					[24000, 8290, 0.4084]
				],
				hei: [
					[116500, 28430, 0.4084],
					[58000, 8720, 0.33693],
					[32500, 2211, 0.25525],
					[26500, 986, 0.2042],
					[24000, 731, 0.1021]
				]
			}
		};
		const RATES: Record<number, number> = {
			24000: 0.2042,
			26000: 0.23483,
			26500: 0.23483,
			32000: 0.33693,
			32500: 0.33693,
			116500: 0.45945
		};
		for (const version of versions) {
			const tables = fixtureValue25(payrollRules(version).withholding_daily_table).tables;
			assert.deepEqual(
				tables.map((t) => t.year),
				version === 'version_1'
					? [2025, 2026]
					: Number(version.slice(8)) >= 8
						? [2027]
						: [2026, 2027],
				version
			);
			for (const t of tables) {
				const official = fixturePresent(OFFICIAL[t.year]);
				assert.equal(t.rows.length, official.rows, `${version} ${t.year}`);
				assert.deepEqual(t.rows[0], official.first);
				assert.deepEqual(t.rows.at(-1), official.last);
				assert.equal(t.below, official.first[0]);
				assert.equal(t.formula_from, 24000);
				for (let i = 1; i < t.rows.length; i++)
					assert.equal(fixturePresent(t.rows[i])[0], fixturePresent(t.rows[i - 1])[1]);
				for (const [edge, taxes] of Object.entries(official.edges)) {
					const band = fixturePresent(t.kou.find((b) => b[0] === Number(edge)));
					assert.deepEqual(band.slice(2, 2 + taxes.length), taxes, `${t.year} ${edge}`);
					assert.equal(band[1], RATES[Number(edge)] ?? 0.4084, `${t.year} ${edge}`);
				}
				assert.deepEqual(t.otsu, official.otsu);
				assert.deepEqual(t.hei, official.hei);
			}
		}
		// The engine's INCOME_TAX on a payment of a WEEKLY, DAILY, SEMI_MONTHLY or MONTHLY entity.
		const withhold = (
			version: string,
			input: {
				frequency: string;
				days: number;
				pay: number;
				pay_date?: string;
				declared?: boolean;
				dependants?: number;
				secondary?: number;
				facts?: Row;
				worked?: number;
				earlier?: number;
				bonus_before?: number;
			}
		) => {
			const base = statutoryContext('2026-05', {
				pay_date: input.pay_date ?? '2026-05-08',
				terms_facts: input.facts ?? {}
			});
			const wage = {
				ordinary: input.pay,
				commuting: 0,
				commuter_pass: 0,
				bonus: 0,
				bonus12: 0,
				retirement: 0,
				in_kind: 0
			};
			const month = { ...wage, bonus: input.bonus_before ?? 0 };
			const elections = {
				INCOME_TAX: {
					dependency_declaration_filed: input.declared ?? true,
					withholding_dependants: input.dependants ?? 0,
					secondary_dependants: input.secondary ?? 0
				}
			};
			const result = charge(scheme(version, 'INCOME_TAX'), {
				...base,
				company: { ...base.company, pay_frequency: input.frequency },
				period: { ...base.period, days: input.days },
				earned: { ...base.earned, previous_month: { gross: 300000, BASIC: 300000 } },
				work: {
					days: Array.from({ length: input.worked ?? 0 }, () => ({ worked: true })),
					overtime_hours: 0
				},
				wage,
				month,
				rules: payrollRules(version),
				lines: [],
				charged: {
					month:
						input.earlier == null ? {} : { INCOME_TAX: { employee: input.earlier, employer: 0 } },
					year: {},
					previous_month: {},
					previous_year: {}
				},
				elections,
				scheme: { code: 'INCOME_TAX', standing: '', since: '', elections: elections.INCOME_TAX }
			});
			return result === 'REFUSED' || result === null ? result : result.employee;
		};
		for (const version of ['version_4', 'version_6']) {
			const daily = (
				pay: number,
				more: Parameters<typeof withhold>[1] extends infer T ? Partial<T> : never = {}
			) => withhold(version, { frequency: 'DAILY', days: 1, pay, ...more });
			// 甲欄: below the first row, the first row, every dependant column of the 10,000 row, over seven.
			assert.equal(daily(3499), 0);
			assert.equal(daily(3500), 5);
			assert.deepEqual(
				[0, 1, 2, 3, 4, 5, 6, 7].map((dependants) => daily(10050, { dependants })),
				[265, 210, 160, 100, 50, 0, 0, 0]
			);
			assert.equal(daily(23999), 2240);
			assert.equal(daily(24000, { dependants: 7 }), 740);
			assert.equal(daily(24000, { dependants: 9 }), 640);
			// The formula bands: 26,500 + 3,500 × 23.483% = 2,115 + 821; 116,500 → 45.945%.
			assert.equal(daily(30000, { dependants: 3 }), 2936);
			assert.equal(daily(126500), 37360 + 4594);
			// 乙欄: 3.063% under 3,500, the row, the bands, less 50 per 従たる dependant.
			assert.equal(daily(3000, { declared: false }), 91);
			assert.equal(daily(10000, { declared: false }), 1800);
			assert.equal(daily(10000, { declared: false, secondary: 2 }), 1700);
			assert.equal(daily(34000, { declared: false }), 8300 + 4084);
			assert.equal(daily(67500, { declared: false }), 21980 + 4594);
			// 丙欄: a day labourer paid for each day worked; three days paid at once are three days of the table.
			const labourer = { declared: false, facts: { daily_wage_earner: true } };
			assert.equal(daily(10000, labourer), 8);
			assert.equal(daily(30000, { ...labourer, worked: 3 }), 24);
			assert.equal(daily(34500, labourer), 2226 + 510);
			assert.equal(daily(126500, labourer), 28486 + 4084);
			// Weekly: the 日割額 over the seven days of the week, times seven.
			assert.equal(
				withhold(version, { frequency: 'WEEKLY', days: 7, pay: 70350, dependants: 1 }),
				210 * 7
			);
			// Each payment on its own: an earlier slip's 500 stays, this one adds its own.
			assert.equal(daily(10050, { earlier: 500 }), 500 + 265);
			// A bonus the month paid earlier is not withheld again on a later weekly slip.
			assert.equal(daily(10050, { earlier: 30000, bonus_before: 300000 }), 30000 + 265);
			// Semi-monthly: the 月額表 on twice the payment, halved.
			const monthly = fixtureValue26(
				withhold(version, { frequency: 'MONTHLY', days: 31, pay: 300000 })
			);
			assert.equal(
				withhold(version, { frequency: 'SEMI_MONTHLY', days: 15, pay: 150000 }),
				Math.floor(monthly / 2)
			);
			// The pay day picks the table: December pay payable on 8 January 2027 is on the 令和9年分 table.
			assert.equal(daily(3600, { pay_date: '2026-12-25' }), 10);
			assert.equal(daily(3600, { pay_date: '2027-01-08' }), 0);
		}
		// Version 8 holds only the 令和9年分 table: a 2026 pay day refuses rather than guess.
		assert.equal(
			withhold('version_8', { frequency: 'DAILY', days: 1, pay: 10000, pay_date: '2026-12-25' }),
			'REFUSED'
		);
		assert.equal(
			withhold('version_8', { frequency: 'DAILY', days: 1, pay: 10050, pay_date: '2027-01-08' }),
			260
		);
		assert.equal(
			withhold('version_1', { frequency: 'DAILY', days: 1, pay: 2900, pay_date: '2025-12-10' }),
			5
		);
		// ── 現物給与の価額: the 告示 price by prefecture, less the worker's payment ─────────────────────────────────
		const inKind = (
			version: string,
			code: string,
			facts: Row,
			occurred_on: string,
			region = 'TOKYO',
			terms: Row = {}
		) => {
			const row = fixturePresent(file(version, 'adhoc_catalog').find((item) => item.code === code));
			const band = fixturePresent(fixtureValue12(row.bands)[0]);
			return evaluateConfigured(
				fixtureString(band.amount),
				fixtureContext({
					...payslipContext,
					rules: payrollRules(version),
					company: { ...payslipContext.company, region },
					terms: { ...payslipContext.terms, facts: terms },
					entry: { ...entry(facts), occurred_on }
				})
			);
		};
		for (const version of versions) {
			const april = '2026-04-20';
			const october = '2026-10-20';
			const meals = (facts: Row, day = april, region = 'TOKYO') =>
				inKind(version, 'MEALS_IN_KIND_SOCIAL_INSURANCE', facts, day, region);
			const housing = (facts: Row, day = april, region = 'TOKYO', terms: Row = {}) =>
				inKind(version, 'HOUSING_IN_KIND_SOCIAL_INSURANCE', facts, day, region, terms);
			// 日本年金機構 Q&A 10 (Tokyo, 令和8年4月): 25,500 a month; a 10,000 payment leaves 15,500; two thirds or more is none.
			assert.equal(meals({ meal_months: 1 }), 25500, version);
			assert.equal(meals({ meal_months: 1, meal_payment: 10000 }), 15500);
			assert.equal(meals({ meal_months: 1, meal_payment: 17000 }), 0);
			assert.equal(meals({ meal_months: 1 }, '2026-03-20'), 24300);
			assert.equal(meals({ meal_days: 20, lunches: 5 }, april, 'OKINAWA'), 20 * 880 + 5 * 310);
			assert.equal(
				meals({ breakfasts: 10, dinners: 10 }, '2025-12-10', 'HOKKAIDO'),
				10 * 200 + 10 * 330
			);
			// Q&A 7–9: 16 畳 in Tokyo from 11 April (20 of 30 days); 40 m² from October; 26.4 m² of rooms is 16 畳.
			assert.equal(housing({ housing_tatami: 16, occupied_days: 20, month_days: 30 }), 30186);
			assert.equal(housing({ housing_room_m2: 26.4 }), 45280);
			assert.equal(
				housing({ housing_area_m2: 40, occupied_days: 20, month_days: 30 }, october),
				35466
			);
			// Q&A 6: the branch's own prefecture (Hokkaido: 1,110 per 畳, 530 per m²).
			assert.equal(
				housing({ housing_tatami: 20 }, april, 'TOKYO', { insured_office_region: 'HOKKAIDO' }),
				22200
			);
			assert.equal(housing({ housing_area_m2: 51 }, october, 'HOKKAIDO'), 27030);
			assert.equal(housing({ housing_tatami: 10, rent_paid: 5000 }, april, 'KYOTO'), 13100);
			// A society's own value overrides the price.
			assert.equal(housing({ housing_tatami: 16, social_insurance_value: 12000 }), 12000);
			const rules = fixtureValue27(payrollRules(version).in_kind_values);
			assert.equal(Object.keys(fixturePresent(rules.meals[1]).by_region).length, 47);
			assert.deepEqual(fixturePresent(rules.meals[0]).by_region.KANAGAWA, {
				month: 24300,
				day: 810,
				breakfast: 200,
				lunch: 280,
				dinner: 330
			});
			assert.deepEqual(fixturePresent(rules.meals[1]).by_region.NAGANO, {
				month: 23700,
				day: 790,
				breakfast: 200,
				lunch: 280,
				dinner: 310
			});
			assert.equal(fixturePresent(rules.housing[1]).by_region.OSAKA, 820);
			assert.equal(fixturePresent(rules.housing[0]).by_region.SAITAMA, 1810);
			// The in-kind value enters the 報酬月額 the contract wage is graded on: 200,000 + 45,280 → grade 240,000.
			const health = fixtureValue1(scheme(version, 'HEALTH').configuration);
			const grade = (in_kind: number) =>
				evaluateConfigured(
					fixtureString(fixturePresent(fixturePresent(health.assessable).ordinary)),
					fixtureContext({
						...statutoryContext('2026-05', { monthly_wage: 200000 }, { ordinary: 200000 }),
						month: { ordinary: 200000, in_kind },
						elections: {}
					})
				);
			assert.equal(grade(0), 200000);
			assert.equal(grade(45280), 240000);
			assert.ok(
				fixtureValue3(
					fixturePresent(
						file(version, 'adhoc_catalog').find(
							(row) => row.code === 'HOUSING_IN_KIND_SOCIAL_INSURANCE'
						)
					).counts_toward
				).includes('PENSION.IN_KIND')
			);
		}
	});
	it('round-10 roots: suspension kinds, record retention, the wage ledger, leave chains, the designation and in-kind recovery', () => {
		const KINDS = ['EMPLOYER_CAUSED', 'FORCE_MAJEURE', 'STRIKE', 'LOCKOUT', 'GOVERNMENT_ORDER'];
		const fields = modelFields('suspension_kind');
		for (const version of versions) {
			const kinds = file(version, 'suspension_kind');
			assert.deepEqual(
				kinds.map((row) => row.code),
				KINDS,
				version
			);
			for (const kind of kinds) {
				for (const key of Object.keys(kind))
					assert.ok(fields.has(key), `${version} ${String(kind.code)} ${key}`);
				assert.match(String(kind.authority), /労働基準法|民法|最判|感染症法/);
				// Every kind leaves the 全労働日 (基発0710第3号) and none counts as attended.
				assert.equal(
					evaluateConfigured(
						fixtureString(String(kind.scheduled)),
						fixtureContext({ day: {}, suspension: {} })
					),
					false
				);
				assert.equal(kind.counts_as_attended, '');
				assert.equal(kind.pay !== '', kind.code === 'EMPLOYER_CAUSED');
			}
			const pay = String(fixturePresent(kinds[0]).pay);
			const day = (d: Row = {}, facts: Row = {}, basis = 'DAILY') =>
				evaluateConfigured(
					fixtureString(pay),
					fixtureContext({
						...payslipContext,
						terms: { ...payslipContext.terms, facts: { pay_basis: basis } },
						earned: {
							...payslipContext.earned,
							months: ['2026-01', '2026-02', '2026-03'].map((month) => ({
								month,
								gross: 300000,
								BONUS: 0
							}))
						},
						day: { date: '2026-04-10', day_type: 'WORK', worked: false, ...d },
						suspension: { kind: 'EMPLOYER_CAUSED', facts }
					})
				);
			// 平均賃金 = 900,000 over the 90 days of January–March = 10,000; 休業手当 60% = 6,000.
			assert.equal(day(), 6000, version);
			assert.equal(day({}, { average_daily_wage: 12345 }), 7407);
			assert.equal(day({}, { pay_rate: 1.0 }), 10000);
			assert.equal(day({}, { pay_rate: 0.5 }), 6000);
			assert.equal(day({ day_type: 'REST' }), 0);
			assert.equal(day({ worked: true }), 0);
			// A monthly salary running on in full meets the floor; with the deduction the allowance is paid.
			assert.equal(day({}, {}, 'MONTHLY'), 0);
			assert.equal(day({}, { deduct_salary: true }, 'MONTHLY'), 6000);
			const deduction = fixturePresent(
				file(version, 'work_catalog').find((row) => row.code === 'SUSPENSION_DEDUCTION')
			);
			const suspendedDays = [
				{
					day_type: 'WORK',
					worked: false,
					suspended: { kind: 'FORCE_MAJEURE', facts: { deduct_salary: true }, pay: 0 }
				},
				{
					day_type: 'WORK',
					worked: false,
					suspended: { kind: 'EMPLOYER_CAUSED', facts: {}, pay: 0 }
				},
				{
					day_type: 'REST',
					worked: false,
					suspended: { kind: 'FORCE_MAJEURE', facts: { deduct_salary: true }, pay: 0 }
				}
			];
			const monthly = {
				...payslipContext,
				period: { ...payslipContext.period, days: 30 },
				terms: { ...payslipContext.terms, facts: {} },
				work: { ...payslipContext.work, days: suspendedDays }
			};
			assert.equal(
				evaluateConfigured(fixtureString(String(deduction.eligibility)), fixtureContext(monthly)),
				true
			);
			assert.equal(
				evaluateConfigured(fixtureString(String(deduction.quantity)), fixtureContext(monthly)),
				1
			);
			// 記録の保存: 扶養控除等申告書 seven years from 10 January after the exit year; the disposal task on that day.
			const retention = fixtureValue28(payrollRules(version).record_retention);
			assert.equal(
				evaluateConfigured(
					fixtureString(retention.until),
					fixtureContext({ employment: { exit_date: '2026-05-20' } })
				),
				'2034-01-10'
			);
			assert.equal(
				evaluateConfigured(
					fixtureString(retention.until),
					fixtureContext({ employment: { exit_date: '2026-12-31' } })
				),
				'2034-01-10'
			);
			const disposal = fixturePresent(
				file(version, 'rule_set').find((row) => row.code === 'PERSONAL_DATA_DISPOSAL')
			);
			assert.equal(
				evaluateConfigured(
					fixtureString(String(fixtureValue5(disposal.rules).due)),
					fixtureContext({ exit_on: '2026-05-20' })
				),
				'2034-01-10'
			);
			// 賃金台帳 (様式第20号) as a CSV: the header and one worker's row.
			const ledger = fixturePresent(
				file(version, 'rule_set').find((row) => row.code === 'WAGE_LEDGER_CSV')
			);
			assert.equal(ledger.family, 'EXPORTS');
			const [document] = recordDocuments(
				fixtureExports([{ code: 'WAGE_LEDGER_CSV', rules: ledger.rules }]),
				fixtureContexts([{ period: '2026-04' }]),
				fixtureReturnRows([
					{
						employee: { name: '山田 太郎', gender: 'MALE' },
						contract: {},
						slips: [
							{
								period: '2026-04',
								gross: 330000,
								net: 270000,
								total_deductions: 60000,
								lines: {
									BASIC: 300000,
									NO_PAY_LEAVE: -10000,
									OVERTIME: 15000,
									NIGHT_WORK: 5000,
									FIXED_ALLOWANCE: 10000,
									COMMUTING_ALLOWANCE: 10000,
									MEALS_IN_KIND: 3000
								},
								statutory: {
									HEALTH: { employee: 0, employer: 15000, base: 300000 },
									SI_PREVIOUS_MONTH: { employee: 42000, employer: -42000, base: 0 },
									EI: { employee: 1650, employer: 2800, base: 330000 },
									INCOME_TAX: { employee: 6350, employer: 0, base: 0 },
									RESIDENT_TAX: { employee: 10000, employer: 0, base: 0 }
								}
							}
						]
					}
				])
			);
			const [header, row] = fixturePresent(document).content.split('\n');
			assert.equal(fixturePresent(document).name, 'chingin-daicho-2026-04.csv');
			assert.equal(
				header,
				'氏名,性別,賃金計算期間,労働日数,労働時間数,休日労働時間数,早出残業時間数,深夜労働時間数,基本給,所定時間外割増賃金,休日労働割増賃金,深夜労働割増賃金,諸手当,その他の給与,総支給額,健康保険料・介護保険料,子ども・子育て支援金,厚生年金保険料,前月分社会保険料,雇用保険料,所得税,住民税,その他控除,控除額計,実物給与,差引支給額'
			);
			assert.equal(
				row,
				'山田 太郎,男,2026-04,,,,,,290000,15000,0,5000,20000,0,330000,0,0,0,42000,1650,6350,10000,0,60000,3000,270000'
			);
			// Childcare benefit repeats count from the start of the leave chain: an extension row continues it.
			const settings = settingsOf(version);
			const behaviours = fixtureValue22(settings.behaviours);
			const rows = file(version, 'rule_set');
			const contract = {
				id: 'k1',
				company_id: 'c1',
				employee_id: 'p1',
				exit_ground: '',
				exit_facts: {},
				effective_range: { from: '2025-04-01', to: null },
				facts: {
					contract_terms: [
						{
							effective_range: { from: '2025-04-01', to: null },
							statutory_work_category: 'SOCIAL_AND_EMPLOYMENT'
						}
					]
				},
				employee_number: String('p1'),
				contract_number: 1
			};
			const daily = (day: string, row: Row) =>
				Object.fromEntries(
					raiseDuties({
						behaviours,
						settings_id: settings.id,
						rows,
						collection: 'calendar',
						event: 'daily',
						row,
						day,
						reads: {
							company: [{ region: 'TOKYO', facts: {} }],
							employee: [{ gender: 'FEMALE', date_of_birth: '1990-01-01', children: [], facts: {} }]
						}
					}).map((write) => [write.duty_code, [write.due_on, write.occurrence_key]])
				);
			const chain = [
				{
					code: 'CHILDCARE_LEAVE',
					from: '2026-06-03',
					to: '2026-11-30',
					chain_from: '2026-06-03',
					days: 120,
					facts: {}
				},
				{
					code: 'CHILDCARE_LEAVE',
					from: '2026-12-01',
					to: '2027-05-31',
					chain_from: '2026-06-03',
					days: 120,
					facts: {}
				}
			];
			// 3 December: six months from 3 June, the fourth pair (units 7–8) from 3 December, due 30 April 2027.
			assert.deepEqual(
				daily('2026-12-05', { ...contract, leave: chain }).CHILDCARE_BENEFIT_REPEAT,
				['2027-04-30', 'CHILDCARE_BENEFIT_REPEAT:c1:k1:2026-06-03:3']
			);
			const unchained = chain.map((leave) => ({ ...leave, chain_from: leave.from }));
			assert.equal(
				daily('2026-12-05', { ...contract, leave: unchained }).CHILDCARE_BENEFIT_REPEAT,
				undefined
			);
			// The 5-day designation and the register follow the grant the attendance test made on the base date.
			const granted = (entitlement: number) =>
				daily('2025-10-01', {
					...contract,
					leave: [],
					leave_balances: [{ code: 'ANNUAL_LEAVE', entitlement }]
				});
			assert.ok(granted(10).ANNUAL_LEAVE_FIVE_DAY_DESIGNATION);
			assert.ok(granted(10).ANNUAL_LEAVE_REGISTER);
			assert.equal(granted(0).ANNUAL_LEAVE_FIVE_DAY_DESIGNATION, undefined);
			assert.equal(granted(0).ANNUAL_LEAVE_REGISTER, undefined);
			assert.equal(granted(7).ANNUAL_LEAVE_FIVE_DAY_DESIGNATION, undefined);
			assert.ok(granted(7).ANNUAL_LEAVE_REGISTER);
			// The premium recovered for a month without pay grades that month's own in-kind value.
			const recovery = JSON.stringify(scheme(version, 'SI_PREVIOUS_MONTH').configuration);
			assert.ok(recovery.includes('m.HOUSING_IN_KIND_SOCIAL_INSURANCE'));
			assert.ok(!recovery.includes('month.in_kind'));
		}
	});
	for (const scenario of [
		'daily limits: clean day',
		'daily limits: expired agreement',
		'daily limits: agreement in force',
		'daily limits: flex regime',
		'weekly limits',
		'unrecorded overtime',
		'breaks',
		'rest days',
		'minor workers',
		'pregnancy work limits',
		'childcare work limits',
		'hazardous work limits',
		'rest intervals leave and roster authority',
		'average wage',
		'office changes and leave chains',
		'self-review'
	]) {
		it.effect(
			`round-12 roots: ${scenario}`,
			Effect.fnUntraced(function* () {
				// ── Work-day import rules: every working-time limit, one tripping and one clean day each ─────────────────────
				const COMPANY = 'c-roster';
				const tablesFor = (company: Row, profile: Row, termFacts: Row): Map<string, Row[]> =>
					fixtureTables([
						[
							'jurisdiction_settings',
							versions
								.flatMap((version) => file(version, 'jurisdiction_settings'))
								.map((row) => ({ ...row }))
						],
						[
							'rule_set',
							versions.flatMap((version) => file(version, 'rule_set')).map((row) => ({ ...row }))
						],
						[
							'entity',
							[
								{
									id: COMPANY,
									name: 'Edo KK',
									settings_code: 'JP',
									region: 'TOKYO',
									time_zone: 'Asia/Tokyo',
									pay_frequency: 'MONTHLY',
									facts: company,
									pay_cutoff_day: 1,
									effective_range: { from: '2025-12-01', to: null }
								}
							]
						],
						[
							'employment_contract',
							[
								{
									id: 'k1',
									company_id: COMPANY,
									employee_id: 'p1',
									effective_range: { from: '2025-04-01', to: null },
									facts: {
										contract_terms: [
											{
												base_salary: { value: 300000, currency: 'JPY' },
												effective_range: { from: '2025-04-01', to: null },
												residency_status: 'RESIDENT',
												work_classification: 'ORDINARY',
												statutory_work_category: 'SOCIAL_AND_EMPLOYMENT',
												employment_type: 'INDEFINITE',
												allowances: [],
												facts: termFacts
											}
										]
									},
									employee_number: String('p1'),
									contract_number: 1
								}
							]
						],
						[
							'employment_profile',
							[{ id: 'p1', name: 'Haruto', date_of_birth: '1990-01-10', ...profile }]
						],
						[
							'shift_definition',
							[
								{
									id: 'D',
									company_id: COMPANY,
									code: 'D',
									variant: {
										day_type: 'WORK',
										start_time: '09:00',
										end_time: '18:00',
										break_minutes: 60
									}
								},
								{
									id: 'L',
									company_id: COMPANY,
									code: 'L',
									variant: {
										day_type: 'WORK',
										start_time: '08:00',
										end_time: '19:00',
										break_minutes: 60
									}
								},
								{ id: 'O', company_id: COMPANY, code: 'O', variant: { day_type: 'OFF' } }
							]
						],
						['shift_pattern', []],
						['holiday', []]
					]);
				// A day clocked in Tokyo: local HH:MM to UTC instants (JST = UTC+9).
				const clockAt = (date: string, clock: string) =>
					new Date(Date.parse(`${date}T${clock}:00+09:00`)).toISOString();
				let ref = 0;
				// D plans 8 ordinary hours (09:00–18:00 less an hour's break), L 10, O is a day off with none.
				const day = (
					date: string,
					spans: [string, string][],
					extra: Partial<
						Omit<RosterDraft, 'employment_id' | 'shift_definition_id' | 'worked_intervals'>
					> = {},
					shift = 'D'
				) => ({
					ref: ++ref,
					employment_id: 'k1',
					work_date: date,
					shift_definition_id: shift,
					worked_intervals: spans.map(([start, end]) => ({
						from: clockAt(date, start),
						to:
							end < start
								? clockAt(
										String(
											new Date(Date.parse(`${date}T00:00:00Z`) + 86400000)
												.toISOString()
												.slice(0, 10)
										),
										end
									)
								: clockAt(date, end)
					})),
					leave_code: '',
					...extra
				});
				const codes = Effect.fnUntraced(function* (
					drafts: readonly ReturnType<typeof day>[],
					input: {
						company?: Row;
						profile?: Row;
						facts?: Row;
					} = {}
				) {
					const tables = tablesFor(
						{
							overtime_agreement_from: '2026-04-01',
							overtime_agreement_to: '2027-03-31',
							...input.company
						},
						input.profile ?? {},
						input.facts ?? {}
					);
					const reads = world(tables).layer;
					const found = yield* rosterFindings(
						nativeId('entity', fixtureKey(COMPANY)),
						fixtureDrafts(drafts)
					).pipe(Effect.provide(reads));
					return found.map((finding) => `${finding.code}:${finding.kind}:${finding.column}`);
				});
				const has = (list: string[], code: string) =>
					list.some((item) => item.startsWith(`${code}:`));
				// A clean day: 09:00–18:00 with an hour's break, Wednesday 3 June 2026 (version_5).
				const clean = day('2026-06-03', [
					['09:00', '12:00'],
					['13:00', '18:00']
				]);
				// 1. More than 8 hours with no 36 agreement in force; covered once the agreement runs. Clocked to 20:00, 2
				// hours past the 8-hour shift.
				const long = () =>
					day('2026-06-03', [
						['09:00', '12:00'],
						['13:00', '20:00']
					]);
				const night = () =>
					day('2026-06-03', [
						['17:00', '20:00'],
						['21:00', '23:00']
					]);
				if (scenario === 'daily limits: clean day') assert.deepEqual(yield* codes([clean]), []);
				if (scenario === 'daily limits: expired agreement')
					assert.ok(
						has(
							yield* codes([long()], { company: { overtime_agreement_to: '2026-05-31' } }),
							'ROSTER_DAILY_8H'
						)
					);
				if (scenario === 'daily limits: agreement in force')
					assert.ok(!has(yield* codes([long()]), 'ROSTER_DAILY_8H'));
				if (scenario === 'daily limits: flex regime')
					assert.ok(
						!has(
							yield* codes([long()], {
								company: { overtime_agreement_to: '2026-05-31', working_time_regime: 'FLEX' }
							}),
							'ROSTER_DAILY_8H'
						)
					);
				if (scenario === 'weekly limits') {
					// 2. 40 hours a week, read on the week's last day (Saturday for a Sunday week): five 8-hour shifts and 2
					// hours on the Saturday day off.
					const week = [
						...['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05'].map((date) =>
							day(date, [
								['09:00', '12:00'],
								['13:00', '18:00']
							])
						),
						day('2026-06-06', [['09:00', '11:00']], {}, 'O')
					];
					assert.ok(
						has(
							yield* codes(week, {
								company: { overtime_agreement_to: '2026-05-31' }
							}),
							'ROSTER_WEEKLY_40H'
						)
					);
					assert.ok(
						!has(
							yield* codes(week.slice(0, 5), {
								company: { overtime_agreement_to: '2026-05-31' }
							}),
							'ROSTER_WEEKLY_40H'
						)
					);
					assert.ok(
						!has(
							yield* codes(week, {
								company: { overtime_agreement_to: '2026-05-31', weekly_limit_44: true }
							}),
							'ROSTER_WEEKLY_40H'
						)
					);
				}
				if (scenario === 'unrecorded overtime') {
					// 3. A shift planned beyond 8 ordinary hours: its hours beyond 8 carry the premium the planned day does not
					// price. Hours past an 8-hour shift are overtime already.
					assert.ok(
						has(
							yield* codes([
								day(
									'2026-06-03',
									[
										['08:00', '12:00'],
										['13:00', '19:00']
									],
									{},
									'L'
								)
							]),
							'ROSTER_OVERTIME_UNRECORDED'
						)
					);
					assert.ok(!has(yield* codes([long()]), 'ROSTER_OVERTIME_UNRECORDED'));
					assert.ok(!has(yield* codes([clean]), 'ROSTER_OVERTIME_UNRECORDED'));
				}
				if (scenario === 'breaks') {
					// 4. The break: 7¼ hours with a 15-minute pause is short; 45 minutes covers 8 hours, not 8½. A single clock
					// pair is netted of the shift's planned hour, so the pause is clocked as two intervals.
					assert.ok(
						has(
							yield* codes([
								day('2026-06-03', [
									['09:00', '12:00'],
									['12:15', '16:30']
								])
							]),
							'ROSTER_BREAK'
						)
					);
					// Leaving early is not a short break: 5 hours clocked on the 8-hour shift need none.
					assert.ok(
						!has(
							yield* codes([
								day('2026-06-03', [
									['09:00', '12:00'],
									['13:00', '15:00']
								])
							]),
							'ROSTER_BREAK'
						)
					);
					assert.ok(
						!has(
							yield* codes([
								day('2026-06-03', [
									['09:00', '12:00'],
									['12:45', '17:45']
								])
							]),
							'ROSTER_BREAK'
						)
					);
					assert.ok(
						has(
							yield* codes([
								day('2026-06-03', [
									['09:00', '12:00'],
									['12:45', '18:15']
								])
							]),
							'ROSTER_BREAK'
						)
					);
				}
				if (scenario === 'rest days') {
					// 5. Seven days without a rest day (Sunday to Saturday).
					const seven = [
						'2026-05-31',
						'2026-06-01',
						'2026-06-02',
						'2026-06-03',
						'2026-06-04',
						'2026-06-05',
						'2026-06-06'
					].map((date) =>
						day(date, [
							['09:00', '12:00'],
							['13:00', '15:00']
						])
					);
					assert.ok(has(yield* codes(seven), 'ROSTER_REST_DAY'));
					assert.ok(
						!has(yield* codes(seven, { company: { variable_rest_days: true } }), 'ROSTER_REST_DAY')
					);
				}
				// 6–8. A worker under 18: overtime beyond 8 hours refuses; long hours and night work warn.
				if (scenario === 'minor workers') {
					const minor = { profile: { date_of_birth: '2009-08-01' } };
					assert.deepEqual(
						(yield* codes([long()], minor)).filter((code) =>
							code.startsWith('ROSTER_MINOR_OVERTIME')
						),
						['ROSTER_MINOR_OVERTIME:refuse:clock_out']
					);
					assert.ok(!has(yield* codes([clean], minor), 'ROSTER_MINOR_OVERTIME'));
					assert.ok(
						has(
							yield* codes(
								[
									day('2026-06-03', [
										['09:00', '12:00'],
										['13:00', '19:00']
									])
								],
								minor
							),
							'ROSTER_MINOR_HOURS'
						)
					);
					assert.ok(!has(yield* codes([clean], minor), 'ROSTER_MINOR_HOURS'));
					assert.ok(has(yield* codes([night()], minor), 'ROSTER_MINOR_NIGHT'));
					assert.ok(!has(yield* codes([night()]), 'ROSTER_MINOR_NIGHT'));
				}
				// 9–10. A pregnant worker who asked to be excused.
				if (scenario === 'pregnancy work limits') {
					const mother = { facts: { pregnancy_work_limits_requested: true } };
					assert.ok(
						(yield* codes([long()], mother)).includes('ROSTER_MATERNITY_OVERTIME:refuse:clock_out')
					);
					assert.ok(!has(yield* codes([long()]), 'ROSTER_MATERNITY_OVERTIME'));
					assert.ok(has(yield* codes([night()], mother), 'ROSTER_MATERNITY_NIGHT'));
					assert.ok(!has(yield* codes([clean], mother), 'ROSTER_MATERNITY_NIGHT'));
				}
				if (scenario === 'childcare work limits') {
					// 11–12. Childcare: no work beyond the schedule, no night work.
					assert.ok(
						(yield* codes([long()], { facts: { no_overtime_requested: true } })).includes(
							'ROSTER_CHILDCARE_OVERTIME:refuse:clock_out'
						)
					);
					assert.ok(
						!has(
							yield* codes([clean], { facts: { no_overtime_requested: true } }),
							'ROSTER_CHILDCARE_OVERTIME'
						)
					);
					assert.ok(
						has(
							yield* codes([night()], { facts: { night_work_exemption_requested: true } }),
							'ROSTER_CHILDCARE_NIGHT'
						)
					);
					assert.ok(!has(yield* codes([night()]), 'ROSTER_CHILDCARE_NIGHT'));
				}
				if (scenario === 'hazardous work limits') {
					// 13. Harmful work: at most 2 hours beyond 8.
					const harmful = { facts: { hazardous_work: true } };
					assert.ok(
						has(
							yield* codes(
								[
									day('2026-06-03', [
										['08:00', '12:00'],
										['13:00', '20:00']
									])
								],
								harmful
							),
							'ROSTER_HAZARDOUS_OVERTIME'
						)
					);
					assert.ok(!has(yield* codes([long()], harmful), 'ROSTER_HAZARDOUS_OVERTIME'));
				}
				// 14. The rest interval the rules adopt (11 hours), and a driver's 9.
				if (scenario === 'rest intervals leave and roster authority') {
					const late = [
						day('2026-06-02', [
							['13:00', '17:00'],
							['18:00', '23:00']
						]),
						day('2026-06-03', [
							['07:00', '12:00'],
							['13:00', '16:00']
						])
					];
					assert.ok(
						has(
							yield* codes(late, { company: { work_interval_hours: 11 } }),
							'ROSTER_REST_INTERVAL'
						)
					);
					assert.ok(!has(yield* codes(late), 'ROSTER_REST_INTERVAL'));
					assert.ok(
						has(
							yield* codes(late, { company: { overtime_sector: 'DRIVER' } }),
							'ROSTER_REST_INTERVAL'
						)
					);
					// 15. Leave recorded on a worked day.
					assert.ok(
						(yield* codes([
							day('2026-06-03', [['09:00', '12:00']], { leave_code: 'ANNUAL_LEAVE' })
						])).includes('ROSTER_LEAVE_ON_WORKED_DAY:warn:leave_code')
					);
					assert.ok(
						!has(
							yield* codes([day('2026-06-03', [], { leave_code: 'ANNUAL_LEAVE' })]),
							'ROSTER_LEAVE_ON_WORKED_DAY'
						)
					);
					for (const version of versions) {
						const roster = file(version, 'rule_set').filter(
							(row) => row.family === 'VALIDATIONS' && fixtureValue5(row.rules).site === 'roster'
						);
						assert.equal(roster.length, 15, version);
						for (const row of roster)
							assert.ok(String(fixtureValue5(row.rules).authority).length > 40, String(row.code));
					}
				}
				// ── 平均賃金: the suspended days and their 休業手当 leave the average; a day or hour rate is guaranteed 60% ──────
				if (scenario === 'average wage') {
					for (const version of versions) {
						const kind = fixturePresent(
							file(version, 'suspension_kind').find((row) => row.code === 'EMPLOYER_CAUSED')
						);
						assert.equal(kind.name, '使用者の責に帰すべき事由による休業');
						assert.match(String(kind.authority), /art\.26/);
						const months = (extra: Row = {}) =>
							['2026-01', '2026-02', '2026-03'].map((month) => ({
								month,
								gross: 300000,
								worked_days: 20,
								suspended_days: 0,
								...(month === '2026-02' ? extra : {})
							}));
						const pay = (earned: Row[], basis = 'DAILY') =>
							evaluateConfigured(
								fixtureString(String(kind.pay)),
								fixtureContext({
									...payslipContext,
									terms: { ...payslipContext.terms, facts: { pay_basis: basis } },
									earned: { ...payslipContext.earned, months: earned },
									day: { date: '2026-04-10', day_type: 'WORK', worked: false },
									suspension: { kind: 'EMPLOYER_CAUSED', facts: {} }
								})
							);
						// Without exclusions: 900,000 over 90 days = 10,000 → 6,000; the guarantee (0.6 × 900,000 / 60 = 9,000) is lower.
						assert.equal(pay(months()), 6000, version);
						// February had 10 suspended days paid 60,000 of 休業手当: (900,000 − 60,000) / 80 = 10,500 → 6,300.
						assert.equal(
							pay(
								months({
									suspended_days: 10,
									suspended_days_by_kind: { EMPLOYER_CAUSED: 10 },
									SUSPENSION_ALLOWANCE: 60000
								})
							),
							6300
						);
						// A day-rate worker with few days: 600,000 over 90 days = 6,667; guaranteed 0.6 × 600,000 / 30 = 12,000 → 7,200.
						const few = ['2026-01', '2026-02', '2026-03'].map((month) => ({
							month,
							gross: 200000,
							worked_days: 10,
							suspended_days: 0
						}));
						assert.equal(pay(few), 7200);
						assert.equal(pay(few, 'MONTHLY'), 0);
						const shutdown = fixturePresent(
							file(version, 'adhoc_catalog').find((row) => row.code === 'SHUTDOWN_ALLOWANCE')
						);
						const band = fixturePresent(fixtureValue29(shutdown.bands)[0]);
						assert.equal(
							evaluateConfigured(
								fixtureString(band.amount),
								fixtureContext({
									...payslipContext,
									terms: { ...payslipContext.terms, facts: { pay_basis: 'HOURLY' } },
									earned: {
										...payslipContext.earned,
										months: ['2026-01', '2026-02', '2026-03'].map((month) => ({
											month,
											gross: 200000,
											worked_days: 10,
											suspended_days: 0
										}))
									},
									entry: { ...entry({}, 1), amount: 0, occurred_on: '2026-04-10' }
								})
							),
							7200
						);
					}
					// ── Office changes (row.before on entity updates); one first childcare application per leave chain ────────
				}
				if (scenario === 'office changes and leave chains') {
					for (const version of versions) {
						const settings = settingsOf(version);
						const raised = (
							collection: string,
							event: string,
							row: Row,
							day: string,
							reads: Row = {}
						) =>
							Object.fromEntries(
								raiseDuties({
									behaviours: fixtureValue22(settings.behaviours),
									settings_id: settings.id,
									rows: file(version, 'rule_set'),
									collection,
									event,
									row,
									day,
									reads: {
										company: [{ region: 'TOKYO', facts: {} }],
										employee: [
											{ gender: 'FEMALE', date_of_birth: '1990-01-01', children: [], facts: {} }
										],
										...reads
									}
								}).map((write) => [write.duty_code, write.due_on])
							);
						const entity = (before: Row, extra: Row = {}) =>
							raised(
								'entity',
								'updated',
								{
									id: 'c1',
									name: 'Edo KK',
									region: 'OSAKA',
									facts: { ei_industry_class: 'GENERAL' },
									before,
									...extra
								},
								'2026-06-10'
							);
						// 10 June + 4 = 14 June (a Sunday) → 15 June; the day after + 10 = 20 June (a Saturday) → 22 June.
						assert.deepEqual(entity({ region: 'TOKYO' }), {
							SOCIAL_INSURANCE_OFFICE_CHANGE: '2026-06-15',
							LABOUR_INSURANCE_OFFICE_CHANGE: '2026-06-22'
						});
						assert.deepEqual(entity({ name: 'Edo Shoji KK' }), {
							SOCIAL_INSURANCE_OFFICE_CHANGE: '2026-06-15',
							LABOUR_INSURANCE_OFFICE_CHANGE: '2026-06-22'
						});
						assert.deepEqual(entity({ facts: { ei_industry_class: 'CONSTRUCTION' } }), {
							LABOUR_INSURANCE_OFFICE_CHANGE: '2026-06-22'
						});
						assert.deepEqual(entity({ facts: { ei_industry_class: 'GENERAL' } }), {});
						const insured = [
							{
								effective_range: { from: '2025-04-01', to: null },
								facts: {
									contract_terms: [
										{
											effective_range: { from: '2025-04-01', to: null },
											statutory_work_category: 'SOCIAL_AND_EMPLOYMENT'
										}
									]
								}
							}
						];
						const leave = (code: string, row: Row) =>
							raised(
								'leave_catalog_entry',
								'created',
								{
									id: 'e2',
									company_id: 'c1',
									employment_id: 'k1',
									employee_id: 'p1',
									catalog_code: code,
									...row
								},
								String(row.from),
								{ contract: insured }
							);
						assert.equal(
							leave('CHILDCARE_LEAVE', {
								from: '2026-08-01',
								to: '2027-03-31',
								chain_from: '2026-08-01'
							}).CHILDCARE_BENEFIT_APPLICATION,
							'2026-11-30'
						);
						assert.equal(
							leave('CHILDCARE_LEAVE', {
								from: '2027-04-01',
								to: '2027-09-30',
								chain_from: '2026-08-01'
							}).CHILDCARE_BENEFIT_APPLICATION,
							undefined
						);
						assert.ok(
							leave('FAMILY_CARE_LEAVE', {
								from: '2026-06-01',
								to: '2026-06-30',
								chain_from: '2026-06-01'
							}).CARE_LEAVE_BENEFIT_APPLICATION
						);
						assert.equal(
							leave('FAMILY_CARE_LEAVE', {
								from: '2026-07-01',
								to: '2026-07-31',
								chain_from: '2026-06-01'
							}).CARE_LEAVE_BENEFIT_APPLICATION,
							undefined
						);
						const birth = { child_birth_date: '2026-05-25' };
						assert.ok(
							leave('POSTNATAL_PATERNITY_LEAVE', {
								from: '2026-05-25',
								to: '2026-06-07',
								facts: birth,
								leave: []
							}).PATERNITY_BENEFIT_APPLICATION
						);
						assert.equal(
							leave('POSTNATAL_PATERNITY_LEAVE', {
								from: '2026-06-20',
								to: '2026-06-30',
								facts: birth,
								leave: [
									{
										id: 'e1',
										code: 'POSTNATAL_PATERNITY_LEAVE',
										from: '2026-05-25',
										to: '2026-06-07',
										chain_from: '2026-05-25',
										facts: birth
									}
								]
							}).PATERNITY_BENEFIT_APPLICATION,
							undefined
						);
					}
					// ── Self-review: rows whose cited tests did not name their class ───────────────────────────────────────────
				}
				if (scenario === 'self-review') {
					for (const version of versions) {
						const advance = fixturePresent(
							file(version, 'loan_catalog').find((row) => row.code === 'SALARY_ADVANCE')
						);
						assert.equal(
							evaluateConfigured(
								fixtureString(String(advance.eligibility)),
								fixtureContext({ company: { facts: {} } })
							),
							false
						);
						assert.equal(
							evaluateConfigured(
								fixtureString(String(advance.eligibility)),
								fixtureContext({
									company: { facts: { wage_deduction_agreement: true } }
								})
							),
							true
						);
						for (const code of ['FIXED_ALLOWANCE', 'FAMILY_ALLOWANCE', 'HOUSING_ALLOWANCE']) {
							const row = fixturePresent(
								file(version, 'allowance_catalog').find((item) => item.code === code)
							);
							for (const target of ['HEALTH', 'PENSION', 'EI', 'INCOME_TAX', 'RESIDENT_TAX'])
								assert.ok(fixtureValue3(row.counts_toward).includes(target), `${code} ${target}`);
						}
						const commuting = fixturePresent(
							file(version, 'allowance_catalog').find((row) => row.code === 'COMMUTING_ALLOWANCE')
						);
						assert.ok(fixtureValue3(commuting.counts_toward).includes('INCOME_TAX.COMMUTING'));
						const reimbursement = fixturePresent(
							file(version, 'claim_catalog').find((row) => row.code === 'EXPENSE_REIMBURSEMENT')
						);
						assert.deepEqual(reimbursement.counts_toward, []);
						assert.equal(reimbursement.destination, 'NET');
					}
					// The commuting allowance is exempt up to 150,000 a month (所得税法施行令 art.20の2(iv)); the excess is taxed.
					const commute = (commuting: number) =>
						at(
							'version_4',
							'INCOME_TAX',
							'2026-04',
							{ elections: { INCOME_TAX: { dependency_declaration_filed: true } } },
							{ ordinary: 300000, commuting }
						);
					const tax = (commuting: number) => fixtureValue13(commute(commuting)).employee;
					// Within the 150,000 cap only the premiums the allowance bears move the tax (down); beyond it the excess is taxed.
					assert.ok(tax(150000) <= tax(0));
					assert.ok(tax(200000) > tax(150000) + 1000);
					// A fourth bonus in twelve months warns; recorded as 報酬, the bonus is no longer assessed.
					const health = scheme('version_4', 'HEALTH_BONUS');
					const warnings = fixturePresent(fixtureValue1(health.configuration).warn_when);
					const fourth = {
						...statutoryContext('2026-04', {
							earned: {
								months: ['2025-06', '2025-09', '2025-12'].map((month) => ({ month, BONUS: 100000 }))
							}
						}),
						month: { bonus: 100000 },
						elections: {}
					};
					assert.equal(
						evaluateConfigured(
							fixtureString(fixturePresent(warnings[0]).when),
							fixtureContext(fourth)
						),
						true
					);
					assert.equal(
						evaluateConfigured(
							fixtureString(fixturePresent(warnings[0]).when),
							fixtureContext({
								...fourth,
								elections: { HEALTH: { bonus_as_remuneration: true } }
							})
						),
						false
					);
					const bonus = (elections: Record<string, Row>) =>
						at('version_4', 'HEALTH_BONUS', '2026-04', { elections }, { bonus: 500000 });
					const asRemuneration = bonus({ HEALTH: { bonus_as_remuneration: true } });
					assert.ok(
						asRemuneration === null ||
							(asRemuneration !== undefined &&
								asRemuneration !== 'REFUSED' &&
								asRemuneration.employee === 0)
					);
					assert.ok(fixtureValue13(bonus({})).employee > 0);
				}
			})
		);
	}
	it('平均賃金 §12(3): injury, maternity, childcare, care, employer-caused suspension and probation periods leave the average', () => {
		for (const version of versions) {
			const kind = fixturePresent(
				file(version, 'suspension_kind').find((row) => row.code === 'EMPLOYER_CAUSED')
			);
			const months = (feb: Row = {}) =>
				['2026-01', '2026-02', '2026-03'].map((month) => ({
					month,
					gross: 300000,
					worked_days: 20,
					...(month === '2026-02' ? feb : {})
				}));
			const context = (earned: Row[], terms: Row = {}, start = '2020-04-01') => ({
				...payslipContext,
				employment: { ...payslipContext.employment, start_date: start },
				terms: { ...payslipContext.terms, facts: { pay_basis: 'DAILY', ...terms } },
				earned: { ...payslipContext.earned, months: earned }
			});
			const pay = (earned: Row[], terms: Row = {}, start?: string) =>
				evaluateConfigured(
					fixtureString(String(kind.pay)),
					fixtureContext({
						...context(earned, terms, start),
						day: { date: '2026-04-10', day_type: 'WORK', worked: false },
						suspension: { kind: 'EMPLOYER_CAUSED', facts: {} }
					})
				);
			// No exclusion: 900,000 / 90 days = 10,000 → 6,000.
			assert.equal(pay(months()), 6000, version);
			// 20 days of each excluded class leave the days: 900,000 / 70 = 12,857.14 → 7,715 (60%, rounded up).
			for (const code of [
				'OCCUPATIONAL_INJURY_ABSENCE',
				'PRENATAL_LEAVE',
				'POSTNATAL_LEAVE',
				'CHILDCARE_LEAVE',
				'POSTNATAL_PATERNITY_LEAVE',
				'FAMILY_CARE_LEAVE'
			])
				assert.equal(pay(months({ leave_days: { [code]: 20 } })), 7715, `${version} ${code}`);
			// Private sickness and unpaid leave stay in (art.12(3) lists neither).
			assert.equal(pay(months({ leave_days: { SICKNESS_ABSENCE: 20, UNPAID_LEAVE: 5 } })), 6000);
			// Only an employer-caused suspension leaves the average; a force-majeure one stays.
			assert.equal(
				pay(
					months({
						suspended_days: 10,
						suspended_days_by_kind: { EMPLOYER_CAUSED: 10 },
						SUSPENSION_ALLOWANCE: 60000
					})
				),
				6300
			);
			assert.equal(
				pay(months({ suspended_days: 10, suspended_days_by_kind: { FORCE_MAJEURE: 10 } })),
				6000
			);
			// Probation through 31 January: January's 31 days and its wages leave: 600,000 / 59 = 10,169.49 → 6,102.
			assert.equal(pay(months(), { probation_until: '2026-01-31' }, '2026-01-01'), 6102);
			// January 1–15 in probation: January keeps 16/31 of its wages, 754,838.71 / 75 = 10,064.52 → 6,039.
			assert.equal(pay(months(), { probation_until: '2026-01-15' }, '2026-01-01'), 6039);
			// The whole three months excluded: the period's own wages and days (施行規則 art.3) → 6,000.
			assert.equal(pay(months(), { probation_until: '2026-03-31' }, '2026-01-01'), 6000);
			// Every other use of the average wage reads the same exclusions.
			const childcare = months({ leave_days: { CHILDCARE_LEAVE: 20 } });
			const adhoc = (code: string, earned: Row[], facts: Row = {}) => {
				const row = fixturePresent(
					file(version, 'adhoc_catalog').find((item) => item.code === code)
				);
				return fixtureValue26(
					evaluateConfigured(
						fixtureString(fixturePresent(fixtureValue29(row.bands)[0]).amount),
						fixtureContext({
							...context(earned),
							entry: {
								...entry(facts, 1),
								amount: code === 'DISCIPLINARY_DEDUCTION' ? 1000000 : 0,
								occurred_on: '2026-04-10'
							}
						})
					)
				);
			};
			assert.equal(adhoc('SHUTDOWN_ALLOWANCE', childcare), 7715);
			assert.equal(adhoc('INJURY_WAITING_COMPENSATION', childcare), 7715);
			for (const code of ['DISMISSAL_NOTICE_ALLOWANCE', 'DISCIPLINARY_DEDUCTION'])
				assert.ok(
					Math.abs(adhoc(code, childcare)) > Math.abs(adhoc(code, months())),
					`${version} ${code}`
				);
			const leavePay = fixturePresent(
				file(version, 'work_catalog').find((row) => row.code === 'ANNUAL_LEAVE_PAY')
			);
			const rate = (earned: Row[]) =>
				fixtureValue26(
					evaluateConfigured(
						fixtureString(String(leavePay.rate)),
						fixtureContext({
							...context(earned),
							company: {
								...payslipContext.company,
								facts: { ...payslipContext.company.facts, annual_leave_pay_basis: 'AVERAGE' }
							},
							entry: entry({}, 1)
						})
					)
				);
			assert.ok(rate(childcare) > rate(months()), version);
		}
	});
	it('FIX2: loss-month bonus, split childcare leave, the boundary week, the 2027 versions, wage classes and the missing duties', () => {
		// ── 健康保険法 art.156(3), 厚生年金保険法 art.19(1): no premium on a bonus paid in the month of loss ──────────────
		const bonusAt = (code: string, exit_date: string, start_date = '2020-04-01') =>
			at('version_6', code, '2026-10', { exit_date, start_date }, { bonus: 500000 });
		const charged = (value: unknown) =>
			value != null &&
			value !== 'REFUSED' &&
			(fixtureValue30(value).employee > 0 || fixtureValue31(value).employer > 0);
		for (const code of [
			'HEALTH_BONUS',
			'CHILD_SUPPORT_BONUS',
			'PENSION_BONUS',
			'CHILD_CONTRIBUTION'
		]) {
			// Exit 15 October: insured status is lost on the 16th, in October.
			assert.equal(charged(bonusAt(code, '2026-10-15')), false, code);
			// Exit 31 October: lost on 1 November, so October is charged.
			assert.equal(charged(bonusAt(code, '2026-10-31')), true, code);
			// 同月得喪: acquired and lost in October, the month is charged.
			assert.equal(charged(bonusAt(code, '2026-10-20', '2026-10-05')), true, code);
		}
		assert.deepEqual(bonusAt('HEALTH_BONUS', '2026-10-31'), { employee: 24625, employer: 24625 });
		// Employment insurance is charged on the bonus in the month of loss: 500,000 × 5/1000 and 8.5/1000.
		assert.deepEqual(bonusAt('EI_BONUS', '2026-10-15'), { employee: 2500, employer: 4250 });
		const report = fixturePresent(
			file('version_6', 'rule_set').find((row) => row.code === 'BONUS_PAYMENT_REPORT')
		);
		assert.ok(!JSON.stringify(report.rules).includes('exit'));
		// ── 健保則 art.135(4): the 育児休業等 of one month are added together for the 14-day test ─────────────────────
		const leaveRow = (from: string, to: string, facts: Row = {}) => ({
			code: 'POSTNATAL_PATERNITY_LEAVE',
			activity: 'TIME_OFF',
			from,
			to,
			days: 7,
			facts
		});
		const health = (leave: Row[]) =>
			at('version_6', 'HEALTH', '2026-10', { leave, monthly_wage: 300000 }, { ordinary: 300000 });
		assert.equal(
			charged(health([leaveRow('2026-10-05', '2026-10-11'), leaveRow('2026-10-19', '2026-10-25')])),
			false
		);
		assert.equal(charged(health([leaveRow('2026-10-05', '2026-10-11')])), true);
		// Days worked during a 出生時育児休業 do not count: 7 + 6 = 13.
		assert.equal(
			charged(
				health([
					leaveRow('2026-10-05', '2026-10-11'),
					leaveRow('2026-10-19', '2026-10-25', { work_days: 1 })
				])
			),
			true
		);
		for (const code of ['PENSION', 'CHILD_SUPPORT'])
			assert.equal(
				charged(
					at(
						'version_6',
						code,
						'2026-10',
						{
							leave: [leaveRow('2026-10-05', '2026-10-11'), leaveRow('2026-10-19', '2026-10-25')],
							monthly_wage: 300000
						},
						{ ordinary: 300000 }
					)
				),
				false,
				code
			);
		// ── 労働基準法 art.32(1): a calendar week split across the period start (6 × 7 h: 6 planned + 1 past them, 3 days in
		// each period) ───────────────────────────────────────────────────────────────────────────────────────────────
		for (const version of versions) {
			const overtime = fixturePresent(
				file(version, 'work_catalog').find((row) => row.code === 'OVERTIME')
			);
			const day = (date: string) => ({
				date,
				day_type: 'WORK',
				worked: true,
				worked_hours: 7,
				scheduled_hours: 6,
				overtime_hours: 1,
				facts: {},
				intervals: []
			});
			const hours = (days: string[], before: string[]) =>
				evaluateConfigured(
					fixtureString(String(overtime.quantity)),
					fixtureContext({
						...payslipContext,
						company: { ...payslipContext.company, facts: { monthly_average_scheduled_hours: 160 } },
						work: {
							...payslipContext.work,
							overtime_hours: days.length,
							days: days.map(day),
							week_before: before.map((date) => ({ ...day(date), in_period: false }))
						}
					})
				);
			// Monday 28 – Wednesday 30 September in the September period: 21 hours, nothing statutory there.
			assert.equal(hours(['2026-09-28', '2026-09-29', '2026-09-30'], []), 0, version);
			// Thursday 1 – Saturday 3 October in the October period, its week's earlier days read from week_before:
			// 42 − 40 = 2 of the period's 3 approved hours.
			assert.equal(
				hours(
					['2026-10-01', '2026-10-02', '2026-10-03'],
					['2026-09-28', '2026-09-29', '2026-09-30']
				),
				2,
				version
			);
			// Six 8-hour days already over 40 before the period, then 8 hours on the Saturday day off: only this period's
			// own excess is paid (48 + 8 − 40 − 8 = 8).
			const eight = (date: string) => ({
				...day(date),
				worked_hours: 8,
				scheduled_hours: 8,
				overtime_hours: 0
			});
			assert.equal(
				evaluateConfigured(
					fixtureString(String(overtime.quantity)),
					fixtureContext({
						...payslipContext,
						company: { ...payslipContext.company, facts: { monthly_average_scheduled_hours: 160 } },
						work: {
							...payslipContext.work,
							overtime_hours: 8,
							days: [
								{
									...eight('2026-10-03'),
									day_type: 'OFF',
									scheduled_hours: 0,
									overtime_hours: 8
								}
							],
							week_before: [
								'2026-09-27',
								'2026-09-28',
								'2026-09-29',
								'2026-09-30',
								'2026-10-01',
								'2026-10-02'
							].map((date) => ({ ...eight(date), in_period: false }))
						}
					})
				),
				8,
				version
			);
		}
		// ── 令和7年法律第74号: pension grade 33 from September 2027, the 36+ size test from October 2027 ───────────────
		const smr = {
			elections: { HEALTH: { standard_monthly_remuneration: 710000 } },
			monthly_wage: 710000
		};
		assert.deepEqual(at('version_8', 'PENSION', '2027-08', smr, { ordinary: 710000 }), {
			employee: 59475,
			employer: 59475
		});
		// 680,000 × 18.3% = 124,440, half each.
		assert.deepEqual(at('version_9', 'PENSION', '2027-09', smr, { ordinary: 710000 }), {
			employee: 62220,
			employer: 62220
		});
		assert.deepEqual(at('version_10', 'PENSION', '2027-10', smr, { ordinary: 710000 }), {
			employee: 62220,
			employer: 62220
		});
		const coverage = (version: string, headcount: number) => {
			const rule = fixtureValue5(
				fixturePresent(file(version, 'rule_set').find((row) => row.code === 'SHORT_TIME_COVERAGE'))
					.rules
			);
			return evaluateConfigured(
				fixtureString(String(rule.when)),
				fixtureContext({
					...payslipContext,
					company: { ...payslipContext.company, headcount },
					terms: {
						...payslipContext.terms,
						statutory_work_category: 'SOCIAL_AND_EMPLOYMENT',
						facts: { weekly_scheduled_hours: 24 }
					}
				})
			);
		};
		// 40 insured: not a 特定適用事業所 in September (warns: insured though not covered), one from October.
		assert.equal(coverage('version_9', 40), true);
		assert.equal(coverage('version_10', 40), false);
		assert.equal(coverage('version_10', 35), true);
		assert.equal(fixtureValue5(settingsOf('version_9').effective_range).to, '2027-09-30');
		for (const version of versions) {
			// Cash night-meal money and the 宿日直手当 are remuneration and labour-insurance wages; their tax limits stay.
			for (const code of ['NIGHT_MEAL_CASH', 'NIGHT_DUTY_ALLOWANCE']) {
				const row = fixturePresent(
					file(version, 'adhoc_catalog').find((item) => item.code === code)
				);
				for (const target of ['HEALTH', 'PENSION', 'EI', 'WORKERS_ACCIDENT'])
					assert.ok(fixtureValue3(row.counts_toward).includes(target), `${code} ${target}`);
				assert.ok(!fixtureValue3(row.counts_toward).includes('INCOME_TAX'));
			}
			// 最低賃金法施行規則 art.1: the 精皆勤手当 is left out of the wage compared, a fixed allowance is not.
			const topUp = fixturePresent(
				file(version, 'work_catalog').find((row) => row.code === 'MINIMUM_WAGE_TOP_UP')
			);
			const rate = (allowances: Row[]) =>
				fixtureValue26(
					evaluateConfigured(
						fixtureString(String(topUp.rate)),
						fixtureContext({
							...payslipContext,
							rules: payrollRules(version),
							terms: { ...payslipContext.terms, base_salary: 150000, allowances, facts: {} },
							company: {
								...payslipContext.company,
								facts: { monthly_average_scheduled_hours: 160 }
							}
						})
					)
				);
			assert.ok(rate([]) > 0, version);
			assert.equal(rate([{ code: 'ATTENDANCE_ALLOWANCE', amount: 20000 }]), rate([]));
			assert.ok(rate([{ code: 'FIXED_ALLOWANCE', amount: 20000 }]) < rate([]));
			assert.ok(
				file(version, 'allowance_catalog').some((row) => row.code === 'ATTENDANCE_ALLOWANCE')
			);
			assert.ok(
				!String(fixtureValue5(payrollRules(version).minimum_wage).authority).includes(
					'not modelled'
				)
			);
			// 労働基準法 art.24(2): wages at least monthly.
			const monthly = fixtureValue23(
				fixtureRecord(
					fixturePresent(
						file(version, 'rule_set').find((row) => row.code === 'WAGE_PAYMENT_MONTHLY')
					).rules
				).when
			);
			assert.equal(
				evaluateConfigured(
					fixtureString(monthly),
					fixtureContext({ company: { pay_frequency: 'INTEGER_MONTHS' } })
				),
				true
			);
			assert.equal(
				evaluateConfigured(
					fixtureString(monthly),
					fixtureContext({ company: { pay_frequency: 'MONTHLY' } })
				),
				false
			);
			// The missing duties: breach reports, year-end declarations, retirement age and continued employment.
			const settings = settingsOf(version);
			const raised = (collection: string, event: string, row: Row, day: string, reads: Row = {}) =>
				Object.fromEntries(
					raiseDuties({
						behaviours: fixtureValue22(settings.behaviours),
						settings_id: settings.id,
						rows: file(version, 'rule_set'),
						collection,
						event,
						row,
						day,
						reads: {
							company: [{ region: 'TOKYO', facts: {} }],
							employee: [{ gender: 'MALE', date_of_birth: '1990-01-01', children: [], facts: {} }],
							...reads
						}
					}).map((write) => [write.duty_code, write.due_on])
				);
			const breach = (facts: Row) =>
				raised(
					'workplace_case',
					'created',
					{
						id: 'w9',
						company_id: 'c1',
						kind: 'DATA_BREACH',
						opened_on: '2026-06-10',
						facts
					},
					'2026-06-10'
				);
			assert.deepEqual(breach({ discovered_on: '2026-06-08', affected_count: 1500 }), {
				PERSONAL_DATA_BREACH_PRELIMINARY: '2026-06-12',
				PERSONAL_DATA_BREACH_FINAL: '2026-07-08',
				PERSONAL_DATA_BREACH_NOTICE: '2026-06-08'
			});
			assert.equal(breach({ misconduct: true }).PERSONAL_DATA_BREACH_FINAL, '2026-08-09');
			assert.equal(
				breach({ my_number: true, affected_count: 150 }).PERSONAL_DATA_BREACH_PRELIMINARY,
				'2026-06-14'
			);
			assert.deepEqual(breach({ affected_count: 20 }), {});
			assert.ok(
				fixtureValue4(fixtureRecord(payrollRules(version).case_kinds).kinds).some(
					(kind) => kind.code === 'DATA_BREACH'
				)
			);
			const december = raised(
				'payroll_run',
				'created',
				{
					id: 'r12',
					company_id: 'c1',
					period: '2026-12',
					pay_date: '2026-12-25'
				},
				'2026-12-01'
			);
			assert.equal(december.YEAR_END_DECLARATIONS_COLLECTION, '2026-12-25');
			assert.equal(
				raised(
					'payroll_run',
					'created',
					{ id: 'r11', company_id: 'c1', period: '2026-11' },
					'2026-11-01'
				).YEAR_END_DECLARATIONS_COLLECTION,
				undefined
			);
			const entity = (facts: Row) =>
				raised(
					'entity',
					'updated',
					{
						id: 'c1',
						name: 'Edo KK',
						region: 'TOKYO',
						facts,
						before: { facts: {} }
					},
					'2026-06-10'
				).RETIREMENT_AGE_RULES;
			assert.equal(entity({ retirement_age: 58 }), '2026-06-10');
			assert.equal(entity({ retirement_age: 60 }), '2026-06-10');
			assert.equal(
				entity({ retirement_age: 60, continued_employment_measure: 'CONTINUED_EMPLOYMENT' }),
				undefined
			);
			assert.equal(entity({ retirement_age: 65 }), undefined);
			// Retirement at 60, born 15 March 1967: reached on 14 March 2027; asked three months before.
			const confirm = (day: string) =>
				raised(
					'calendar',
					'daily',
					{
						id: 'k1',
						company_id: 'c1',
						employee_id: 'p1',
						effective_range: { from: '2000-04-01', to: null },
						facts: { contract_terms: [] },
						leave: [],
						employee_number: String('p1'),
						contract_number: 1
					},
					day,
					{
						company: [{ region: 'TOKYO', facts: { retirement_age: 60 } }],
						employee: [{ gender: 'MALE', date_of_birth: '1967-03-15', children: [], facts: {} }]
					}
				).CONTINUED_EMPLOYMENT_CONFIRMATION;
			assert.equal(confirm('2026-12-14'), '2027-03-14');
			assert.equal(confirm('2026-12-15'), undefined);
		}
	});
	it('art.36(6)(iii): the 2–6-month 80-hour average counts statutory rest-day work', () => {
		for (const version of versions) {
			const rule = fixtureValue23(
				fixtureRecord(
					fixturePresent(
						file(version, 'rule_set').find((row) => row.code === 'OVERTIME_AVERAGE_80H')
					).rules
				).when
			);
			const month = (key: string, overtime: number, rest: number, restOvertime = 0, off = 0) => ({
				month: key,
				worked_hours: 160 + overtime + rest,
				overtime_hours: overtime,
				incentive_hours: 0,
				day_type: {
					WORK: {
						worked_hours: 160,
						overtime_hours: overtime - restOvertime - off,
						incentive_hours: 0
					},
					REST: { worked_hours: rest, overtime_hours: restOvertime, incentive_hours: 0 },
					OFF: { worked_hours: off, overtime_hours: off, incentive_hours: 0 }
				}
			});
			const warns = (months: Row[]) =>
				evaluateConfigured(
					fixtureString(rule),
					fixtureContext({
						...payslipContext,
						period: { ...payslipContext.period, month_from: '2026-05-01' },
						company: { ...payslipContext.company, facts: {} },
						hours: { ...payslipContext.hours, months }
					})
				);
			// 70 h of overtime a month alone averages under 80.
			assert.equal(warns([month('2026-04', 70, 0), month('2026-05', 70, 0)]), false, version);
			// With 16 h of statutory rest-day work each month: 86 h a month over two months.
			assert.equal(warns([month('2026-04', 70, 16), month('2026-05', 70, 16)]), true, version);
			// Rest-day hours approved as overtime are counted once: 75 − 5 + 12 = 82 each month.
			assert.equal(
				warns([month('2026-04', 75, 12, 5), month('2026-05', 75, 12, 5)]),
				true,
				version
			);
			assert.equal(warns([month('2026-04', 70, 9, 5), month('2026-05', 70, 9, 5)]), false, version);
			// Work on a non-statutory day off counts only as the overtime it is: 78 h with 10 of it on OFF days, no warning.
			assert.equal(
				warns([month('2026-04', 78, 0, 0, 10), month('2026-05', 78, 0, 0, 10)]),
				false,
				version
			);
			// Over six months of history the last two average exactly 80 with 10 h of rest-day work (no warning), 100 with 30.
			const six = (heavyRest: number) => [
				month('2025-12', 70, 0),
				month('2026-01', 70, 0),
				month('2026-02', 70, 0),
				month('2026-03', 70, 0),
				month('2026-04', 70, heavyRest),
				month('2026-05', 70, heavyRest)
			];
			assert.equal(warns(six(10)), false);
			assert.equal(warns(six(30)), true);
		}
	});
	it('CONFIRM: the overtime base, commuter pass, night meals, pay after exit, the 2028–2029 versions and the 50-worker and minor duties', () => {
		const charged = (value: unknown) =>
			value != null &&
			value !== 'REFUSED' &&
			(fixtureValue13(value).employee > 0 || fixtureValue31(value).employer > 0);
		for (const version of versions) {
			// ── 労働基準法 art.37(5), 施行規則 art.21: family and commuting allowances leave the base only when set by dependants or distance ──
			const rate = (code: string, allowances: Row[], facts: Row = {}) =>
				evaluateConfigured(
					fixtureString(
						String(
							fixturePresent(file(version, 'work_catalog').find((row) => row.code === code)).rate
						)
					),
					fixtureContext({
						...payslipContext,
						terms: { ...payslipContext.terms, base_salary: 240000, allowances, facts },
						company: { ...payslipContext.company, facts: { monthly_average_scheduled_hours: 160 } }
					})
				);
			const family = [{ code: 'FAMILY_ALLOWANCE', amount: 20000 }];
			const commuting = [{ code: 'COMMUTING_ALLOWANCE', amount: 20000 }];
			// 260,000 / 160 × 1.25 = 2,031.25 → 2,031; without it 240,000 / 160 × 1.25 = 1,875.
			assert.equal(rate('OVERTIME', family), 2031, version);
			assert.equal(
				rate('OVERTIME', family, { family_allowance_by_dependants: true }),
				1875,
				version
			);
			assert.equal(rate('OVERTIME', commuting), 2031, version);
			assert.equal(
				rate('OVERTIME', commuting, { commuting_allowance_by_distance: true }),
				1875,
				version
			);
			// The night premium (25%) and rest-day work (135%) read the same base: 1,625 × 0.25 = 406.25, × 1.35 = 2,193.75.
			assert.equal(rate('NIGHT_WORK', family), 406);
			assert.equal(rate('REST_DAY_WORK', family), 2194);
			const familyRow = fixturePresent(
				file(version, 'allowance_catalog').find((row) => row.code === 'FAMILY_ALLOWANCE')
			);
			assert.ok(
				!String(familyRow.authority).includes('over-paying') &&
					String(familyRow.authority).includes('family_allowance_by_dependants')
			);
			// ── The electronic method cites the NTA 電算機計算の特例, not the retirement table ──
			const tax = String(scheme(version, 'INCOME_TAX').authority);
			assert.ok(!tax.includes('data/18.pdf'), version);
			assert.ok(Number(version.slice(8)) === 1 || tax.includes('denshi_01.pdf'), version);
			// ── Night-meal cash stays in the remuneration averages; above the limit the class refuses (wholly taxable) ──
			for (const name of [
				'statutory_contribution_catalog',
				'adhoc_catalog',
				'work_catalog',
				'rule_set'
			])
				assert.ok(
					!JSON.stringify(file(version, name)).includes('m.NIGHT_MEAL_CASH'),
					`${version} ${name}`
				);
			const meal = fixturePresent(
				file(version, 'adhoc_catalog').find((row) => row.code === 'NIGHT_MEAL_CASH')
			);
			assert.match(String(meal.authority), /wholly taxable/);
			assert.equal(
				fixtureValue5(fixturePresent(fixtureRecords(meal.bands)[0]).limit).on_exceed,
				'BLOCK'
			);
			// ── A retirement allowance after the exit: payable, and no premium for a month after the loss ──
			const retirement = fixturePresent(
				file(version, 'adhoc_catalog').find((row) => row.code === 'RETIREMENT_ALLOWANCE')
			);
			assert.equal(retirement.payable_after_exit, true);
		}
		const month = (
			version: string,
			code: string,
			key: string,
			exit_date: string,
			start_date = '2020-04-01',
			wage: Month = { ordinary: 300000 }
		) => at(version, code, key, { exit_date, start_date, monthly_wage: 300000 }, wage);
		// Exit 30 September: lost on 1 October, so an October slip charges nothing; September is charged.
		for (const code of ['HEALTH', 'PENSION', 'CHILD_SUPPORT', 'CHILD_CONTRIBUTION']) {
			assert.equal(charged(month('version_6', code, '2026-10', '2026-09-30')), false, code);
			assert.equal(charged(month('version_6', code, '2026-09', '2026-09-30')), true, code);
			assert.equal(charged(month('version_6', code, '2026-10', '2026-10-15')), false, code);
			assert.equal(
				charged(month('version_6', code, '2026-10', '2026-10-20', '2026-10-05')),
				true,
				code
			);
		}
		assert.equal(
			charged(
				month('version_6', 'HEALTH_BONUS', '2026-10', '2026-09-30', '2020-04-01', { bonus: 500000 })
			),
			false
		);
		// The retirement allowance itself: withheld, no social insurance.
		const paidAfter = slip(
			'version_6',
			'2026-10',
			{
				exit_date: '2026-09-30',
				elections: { RETIREMENT_TAX: { retirement_income_declaration_filed: true } },
				service_months: 120
			},
			{ retirement: 5000000 }
		);
		assert.ok(charged(paidAfter.RETIREMENT_TAX));
		for (const code of ['HEALTH', 'PENSION', 'EI'])
			assert.equal(charged(paidAfter[code]), false, code);
		// ── A commuter pass: exempt up to 150,000 × the months it covers; spread over those months for the averages ──
		const pass = (amount: number) =>
			fixtureValue13(
				at(
					'version_4',
					'INCOME_TAX',
					'2026-04',
					{
						terms_facts: { commuter_pass_months: 6 },
						elections: { INCOME_TAX: { dependency_declaration_filed: true } }
					},
					{ ordinary: 300000, pass: amount }
				)
			).employee;
		// 300,000 for 6 months is within 900,000: only the premiums it bears move the tax (down).
		assert.ok(pass(300000) <= pass(0));
		// 1,000,000 leaves 100,000 taxable.
		assert.ok(pass(1000000) > pass(0) + 5000);
		const teiji = fixturePresent(
			fixturePresent(fixtureValue1(scheme('version_6', 'HEALTH').configuration).warn_when).find(
				(w) => w.message.startsWith('定時決定')
			)
		).when;
		const months = ['2026-04', '2026-05', '2026-06'].map((key) => ({
			month: key,
			gross: key === '2026-04' ? 350000 : 290000,
			BASIC: 290000,
			...(key === '2026-04' ? { COMMUTER_PASS: 60000 } : {})
		}));
		const grade = (passMonths: number) =>
			evaluateConfigured(
				fixtureString(teiji),
				fixtureContext({
					...statutoryContext('2026-09', {
						earned: { months },
						terms_facts: { commuter_pass_months: passMonths }
					}),
					elections: { HEALTH: { standard_monthly_remuneration: 300000 } },
					scheme: { code: 'HEALTH', standing: '', since: '2025-09-01', elections: {} },
					month: { ordinary: 290000 }
				})
			);
		// Spread: 60,000 / 6 = 10,000 a month → 300,000 average, the recorded grade. Lump in April: 310,000 → 320,000, warns.
		assert.equal(grade(6), false);
		assert.equal(grade(1), true);
		// ── 令和7年法律第74号 and 令和6年法律第26号: the 2028–2029 stages ──
		const top = {
			elections: { HEALTH: { standard_monthly_remuneration: 1000000 } },
			monthly_wage: 1000000
		};
		assert.deepEqual(at('version_10', 'PENSION', '2028-08', top, { ordinary: 1000000 }), {
			employee: 62220,
			employer: 62220
		});
		assert.deepEqual(at('version_11', 'PENSION', '2028-09', top, { ordinary: 1000000 }), {
			employee: 64965,
			employer: 64965
		});
		assert.deepEqual(at('version_12', 'PENSION', '2028-10', top, { ordinary: 1000000 }), {
			employee: 64965,
			employer: 64965
		});
		assert.deepEqual(at('version_13', 'PENSION', '2029-09', top, { ordinary: 1000000 }), {
			employee: 68625,
			employer: 68625
		});
		assert.deepEqual(at('version_14', 'PENSION', '2029-10', top, { ordinary: 1000000 }), {
			employee: 68625,
			employer: 68625
		});
		// 695,000 is grade 34 in v11, grade 33 in v10.
		const at695 = (version: string) =>
			at(version, 'PENSION', '2028-09', { monthly_wage: 695000 }, { ordinary: 695000 });
		assert.deepEqual(at695('version_10'), { employee: 62220, employer: 62220 });
		assert.deepEqual(at695('version_11'), { employee: 64965, employer: 64965 });
		const rule = (version: string, code: string) =>
			fixtureValue23(
				fixtureRecord(
					fixturePresent(file(version, 'rule_set').find((row) => row.code === code)).rules
				).when
			);
		const coverage = (version: string, headcount: number) =>
			evaluateConfigured(
				fixtureString(rule(version, 'SHORT_TIME_COVERAGE')),
				fixtureContext({
					...payslipContext,
					company: { ...payslipContext.company, headcount },
					terms: {
						...payslipContext.terms,
						statutory_work_category: 'SOCIAL_AND_EMPLOYMENT',
						facts: { weekly_scheduled_hours: 24 }
					}
				})
			);
		assert.equal(coverage('version_13', 25), true);
		assert.equal(coverage('version_14', 25), false);
		assert.equal(coverage('version_14', 20), true);
		const ei = (version: string, hours: number, category: string) =>
			evaluateConfigured(
				fixtureString(rule(version, 'EI_COVERAGE_HOURS')),
				fixtureContext({
					...payslipContext,
					terms: {
						...payslipContext.terms,
						statutory_work_category: category,
						facts: { weekly_scheduled_hours: hours }
					}
				})
			);
		// 15 hours a week: outside EI to September 2028 (insuring it warns), inside from October 2028 (leaving it out warns).
		assert.equal(ei('version_11', 15, 'EMPLOYMENT_ONLY'), true);
		assert.equal(ei('version_11', 15, 'NONE'), false);
		assert.equal(ei('version_12', 15, 'EMPLOYMENT_ONLY'), false);
		assert.equal(ei('version_12', 15, 'NONE'), true);
		assert.equal(ei('version_12', 8, 'NONE'), false);
		assert.equal(ei('version_4', 24, 'SOCIAL_ONLY'), true);
		// ── 労働安全衛生法 arts.12–13 and 労働基準法 art.57 ──
		for (const version of versions) {
			const settings = settingsOf(version);
			const hire = (headcount: number, dob = '1990-01-01', company: Row = {}) =>
				Object.fromEntries(
					raiseDuties({
						behaviours: fixtureValue22(settings.behaviours),
						settings_id: settings.id,
						rows: file(version, 'rule_set'),
						collection: 'employment_contract',
						event: 'created',
						row: {
							id: 'k9',
							company_id: 'c1',
							employee_id: 'p9',
							effective_range: { from: '2026-04-01', to: null },
							facts: { contract_terms: [] },
							leave: [],
							employee_number: String('p9'),
							contract_number: 1
						},
						headcount,
						reads: {
							company: [{ region: 'TOKYO', facts: company }],
							employee: [{ gender: 'MALE', date_of_birth: dob, children: [], facts: {} }]
						}
					}).map((write) => [write.duty_code, write.due_on])
				);
			assert.equal(hire(50).INDUSTRIAL_HEALTH_STAFF, '2026-04-15', version);
			assert.equal(hire(49).INDUSTRIAL_HEALTH_STAFF, undefined);
			assert.equal(
				hire(80, '1990-01-01', { industrial_physician_appointed_on: '2025-01-10' })
					.INDUSTRIAL_HEALTH_STAFF,
				undefined
			);
			assert.equal(hire(5, '2010-06-01').MINOR_AGE_CERTIFICATE, '2026-04-01');
			assert.equal(hire(5, '2008-03-31').MINOR_AGE_CERTIFICATE, undefined);
		}
	});
	it('the size test counts 特定労働者 and runs out by 2035; version_1 cites the 令和7年分 edition', () => {
		const coverage = (version: string, headcount: number, facts: Row = {}) =>
			evaluateConfigured(
				fixtureString(
					fixtureValue23(
						fixtureRecord(
							fixturePresent(
								file(version, 'rule_set').find((row) => row.code === 'SHORT_TIME_COVERAGE')
							).rules
						).when
					)
				),
				fixtureContext({
					...payslipContext,
					company: { ...payslipContext.company, headcount, facts },
					terms: {
						...payslipContext.terms,
						statutory_work_category: 'SOCIAL_AND_EMPLOYMENT',
						facts: { weekly_scheduled_hours: 24 }
					}
				})
			);
		// An insured short-time worker warns where the employer is not a 特定適用事業所.
		// 30 full-time insured and 10 short-time: 40 contracts, 30 特定労働者 — not over 35 in v10.
		assert.equal(coverage('version_10', 40), false);
		assert.equal(coverage('version_10', 40, { insured_full_time_workers: 30 }), true);
		assert.equal(coverage('version_10', 30, { insured_full_time_workers: 36 }), false);
		// More than 10 from October 2032: 15 is covered in v15, not in v14.
		assert.equal(coverage('version_14', 15), true);
		assert.equal(coverage('version_15', 15), false);
		assert.equal(coverage('version_15', 10), true);
		// From October 2035 every employer: an insured short-time worker never warns, an uninsured one always does.
		assert.equal(coverage('version_16', 1), false);
		assert.equal(
			evaluateConfigured(
				fixtureString(
					fixtureValue23(
						fixtureRecord(
							fixturePresent(
								file('version_16', 'rule_set').find((row) => row.code === 'SHORT_TIME_COVERAGE')
							).rules
						).when
					)
				),
				fixtureContext({
					...payslipContext,
					company: { ...payslipContext.company, headcount: 1, facts: {} },
					terms: {
						...payslipContext.terms,
						statutory_work_category: 'EMPLOYMENT_ONLY',
						facts: { weekly_scheduled_hours: 24 }
					}
				})
			),
			true
		);
		for (const version of versions) {
			const rule = fixtureValue5(
				fixturePresent(file(version, 'rule_set').find((row) => row.code === 'SHORT_TIME_COVERAGE'))
					.rules
			);
			assert.match(String(rule.authority), /附則 art\.17の3の2/, version);
			assert.ok(!String(rule.authority).includes('art.22(2)'), version);
		}
		const v1 = (code: string) => String(scheme('version_1', code).authority);
		assert.ok(!v1('INCOME_TAX').includes('zeigakuhyo2026'));
		assert.match(v1('INCOME_TAX'), /令和7年分/);
		assert.ok(v1('RETIREMENT_TAX').includes('zeigakuhyo2024/data/18.pdf'));
	});
	layer(workspace({ seed: 'none' }))('JP payroll histories', (it) => {
		for (const scenario of [
			'monthly bonus order',
			'weekly withholding and shutdown',
			'childcare bonus',
			'semi-monthly allowances'
		]) {
			it.effect(
				`a JP regular run and an off-cycle bonus settle through the engine: ${scenario}`,
				Effect.fnUntraced(function* () {
					const COMPANY = 'c0000000-0000-4000-8000-0000000000jp';
					const law = (name: string): Row[] =>
						versions.flatMap((version) => file(version, name)).map((row) => ({ ...row }));
					const makeTables = () =>
						fixtureTables([
							...[
								'jurisdiction_settings',
								'statutory_contribution_catalog',
								'work_catalog',
								'allowance_catalog',
								'adhoc_catalog',
								'claim_catalog',
								'leave_catalog',
								'loan_catalog',
								'rule_set'
							].map((name): [string, Row[]] => [name, law(name)]),
							[
								'entity',
								[
									{
										id: COMPANY,
										name: 'Edo KK',
										settings_code: 'JP',
										pay_frequency: 'MONTHLY',
										// The fixture's clocks are local wall time written as UTC.
										time_zone: 'UTC',
										region: 'TOKYO',
										facts: {
											monthly_average_scheduled_hours: 160,
											workers_accident_rate_per_mille: 3
										},
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
										name: 'Haruto',
										date_of_birth: '1981-01-10',
										nationality: 'JP',
										facts: {
											employment_statutory_facts: [
												{
													statutory_contribution_id: scheme('version_2', 'INCOME_TAX').id,
													effective_range: { from: '2026-01-01', to: null },
													status: {
														kind: 'DECLARED',
														elections: {
															dependency_declaration_filed: true,
															withholding_dependants: 1
														}
													}
												},
												{
													statutory_contribution_id: scheme('version_4', 'RESIDENT_TAX').id,
													effective_range: { from: '2025-06-01', to: null },
													status: {
														kind: 'NOTIFIED',
														elections: { june_amount: 10400, monthly_amount: 10000 }
													}
												}
											]
										}
									},
									{
										id: 'p2',
										name: 'Ava',
										date_of_birth: '1995-07-12',
										nationality: 'US',
										facts: {}
									}
								]
							],
							[
								'employment_contract',
								[
									['p1', 300000, 'RESIDENT'],
									['p2', 400000, 'NON_RESIDENT']
								].map(([id, salary, residency]) => ({
									id: `k-${id}`,
									employee_id: id,
									company_id: COMPANY,
									effective_range: { from: '2024-04-01', to: null },
									facts: {
										contract_terms: [
											{
												base_salary: { value: salary, currency: 'JPY' },
												effective_range: { from: '2024-04-01', to: null },
												residency_status: residency,
												work_classification: 'ORDINARY',
												statutory_work_category: 'SOCIAL_AND_EMPLOYMENT',
												employment_type: 'INDEFINITE',
												allowances: []
											}
										]
									},
									employee_number: String(id),
									contract_number: 1
								}))
							],
							// Only planned time pays: the weekly scenario's days are rostered on an 8-hour day shift.
							[
								'shift_definition',
								[
									{
										id: 'D',
										company_id: COMPANY,
										code: 'D',
										variant: { day_type: 'WORK', start_time: '09:00', end_time: '17:00' }
									}
								]
							],
							...[
								'adhoc_catalog_entry',
								'claim_catalog_entry',
								'leave_catalog_entry',
								'loan_catalog_entry',
								'roster_entry',
								'shift_pattern',
								'holiday',
								'payslip',
								'payroll_run',
								'work_suspension'
							].map((name): [string, Row[]] => [name, []])
						]);
					const tables = makeTables();
					const resetTables = () => {
						tables.clear();
						for (const [name, rows] of makeTables()) tables.set(name, rows);
					};
					return yield* world(tables).useRun((history) =>
						Effect.gen(function* () {
							const run = Effect.fnUntraced(function* (
								period: string,
								kind: PayrollRunKind,
								sources?: string[]
							) {
								return yield* history(
									fixtureKey(COMPANY),
									period,
									kind,
									sources == null ? undefined : sources.map(fixtureId)
								);
							});
							const lines = (
								slip: Pick<Effect.Success<ReturnType<typeof run>>['payslips'][number], 'statutory'>
							) => {
								const out: Record<string, [number, number]> = {};
								for (const line of slip.statutory)
									if (line.employee_amount !== 0 || line.employer_amount !== 0)
										out[line.scheme_code] = [line.employee_amount, line.employer_amount];
								return out;
							};
							const bonus = fixturePresent(
								file('version_4', 'adhoc_catalog').find((row) => row.code === 'BONUS')
							);
							if (scenario === 'monthly bonus order') {
								// March first: the April bonus is withheld at the rate the previous month's salary sets.
								yield* run('2026-03', 'REGULAR');
								const regular = yield* run('2026-04', 'REGULAR');
								assert.equal(regular.run.settings_id, settingsOf('version_4').id);
								const haruto = fixturePresent(
									regular.payslips.find((slip) => slip.employment_id === fixtureKey('k-p1'))
								);
								// Paid within the month (the run's pay day is the period end): the slip deducts March's premiums (健康保険法
								// art.167(1)) and the employer advances April's in full, recovered from May's pay.
								assert.deepEqual(lines(haruto), {
									HEALTH: [0, 34410],
									CHILD_SUPPORT: [0, 690],
									PENSION: [0, 54900],
									CHILD_CONTRIBUTION: [0, 1080],
									SI_PREVIOUS_MONTH: [17205 + 27450, -(17205 + 27450)],
									EI: [1500, 2550],
									WORKERS_ACCIDENT: [0, 900],
									ASBESTOS_LEVY: [0, 6],
									// 300,000 − (44,655 + 1,500) = 253,845 → 91,023.5 × 5.105% → 4,650.
									INCOME_TAX: [4650, 0],
									RESIDENT_TAX: [10000, 0]
								});
								assert.equal(haruto.net, 300000 - 44655 - 1500 - 4650 - 10000);
								const ava = fixturePresent(
									regular.payslips.find((slip) => slip.employment_id === fixtureKey('k-p2'))
								);
								// 400,000 → grade 410,000 (395,000–425,000): 9.85% → 40,385; pension 75,030; levy 943. A non-resident is
								// withheld 20.42% of the whole pay.
								assert.deepEqual(lines(ava), {
									HEALTH: [0, 40385],
									CHILD_SUPPORT: [0, 943],
									PENSION: [0, 75030],
									CHILD_CONTRIBUTION: [0, 1476],
									SI_PREVIOUS_MONTH: [20192 + 37515, -(20192 + 37515)],
									EI: [2000, 3400],
									WORKERS_ACCIDENT: [0, 1200],
									ASBESTOS_LEVY: [0, 8],
									INCOME_TAX: [81680, 0]
								});
								// May recovers April's employee shares, the levy included.
								const may = fixturePresent(
									(yield* run('2026-05', 'REGULAR')).payslips.find(
										(slip) => slip.employment_id === fixtureKey('k-p1')
									)
								);
								assert.deepEqual(lines(may).SI_PREVIOUS_MONTH, [
									17205 + 345 + 27450,
									-(17205 + 345 + 27450)
								]);
								fixturePresent(tables.get('payslip')).splice(-2);
								fixturePresent(tables.get('payroll_run')).pop();
								fixturePresent(tables.get('adhoc_catalog_entry')).push(
									fixtureRow({
										id: 'b1',
										catalog_id: bonus.id,
										employment_id: 'k-p1',
										company_id: COMPANY,
										payslip_id: null,
										occurred_on: '2026-04-20',
										amount: 500000,
										activity: 'AWARD'
									})
								);
								const offCycle = yield* run('2026-04', 'OFF_CYCLE', ['b1']);
								const paid = fixturePresent(
									offCycle.payslips.find((slip) => slip.employment_id === fixtureKey('k-p1'))
								);
								// The month is settled again: the salary's premiums move by nothing, the bonus adds its own.
								assert.deepEqual(
									Object.fromEntries(
										Object.entries(lines(paid)).filter(
											([, [employee, employer]]) => employee !== 0 || employer !== 0
										)
									),
									{
										HEALTH_BONUS: [28675, 28675],
										CHILD_SUPPORT_BONUS: [575, 575],
										PENSION_BONUS: [45750, 45750],
										CHILD_CONTRIBUTION: [0, 1800],
										EI_BONUS: [2500, 4250],
										WORKERS_ACCIDENT: [0, 1500],
										ASBESTOS_LEVY: [0, 10],
										// March (the first run) deducted only its EI: 298,500 sets 6.126% on 500,000 − 77,500 = 422,500.
										INCOME_TAX: [25882, 0]
									}
								);
								// Off-cycle order (owner requirement): the bonus paid before the salary gives the same month totals.
								const monthTotals = () => {
									const out: Record<string, [number, number]> = {};
									const statutoryLines = guardFixture(
										FixtureSchema.Array(
											FixtureSchema.Struct({
												scheme_code: FixtureSchema.String,
												employee_amount: FixtureSchema.Number,
												employer_amount: FixtureSchema.Number
											})
										)
									);
									for (const slip of fixturePresent(tables.get('payslip')))
										if (
											slip.employment_id === fixtureKey('k-p1') &&
											fixtureString(slip.salary_from).startsWith('2026-04')
										)
											for (const line of statutoryLines(slip.statutory)) {
												const held = (out[line.scheme_code] ??= [0, 0]);
												held[0] = Math.round((held[0] + line.employee_amount) * 100) / 100;
												held[1] = Math.round((held[1] + line.employer_amount) * 100) / 100;
											}
									return out;
								};
								const salaryFirst = monthTotals();
								assert.equal(fixturePresent(salaryFirst.INCOME_TAX)[0], 4650 + 25882);
								resetTables();
								yield* run('2026-03', 'REGULAR');
								fixturePresent(tables.get('adhoc_catalog_entry')).push(
									fixtureRow({
										id: 'b1',
										catalog_id: bonus.id,
										employment_id: 'k-p1',
										company_id: COMPANY,
										payslip_id: null,
										occurred_on: '2026-04-20',
										amount: 500000,
										activity: 'AWARD'
									})
								);
								yield* run('2026-04', 'OFF_CYCLE', ['b1']);
								yield* run('2026-04', 'REGULAR');
								assert.deepEqual(monthTotals(), salaryFirst);
							}
							// A WEEKLY entity: each week's slip is withheld on the 日額表 — its own pay less its own premiums, over seven days.
							if (scenario === 'weekly withholding and shutdown') {
								resetTables();
								fixturePresent(fixturePresent(tables.get('entity'))[0]).pay_frequency = 'WEEKLY';
								tables.set(
									'employment_contract',
									fixtureRows(
										fixturePresent(tables.get('employment_contract')).filter(
											(row) => row.id === fixtureKey('k-p1')
										)
									)
								);
								const term = fixturePresent(
									fixtureRecords(
										fixtureRecord(
											fixturePresent(fixturePresent(tables.get('employment_contract'))[0]).facts
										).contract_terms
									)[0]
								);
								term.base_salary = { value: 12000, currency: 'JPY' };
								term.facts = { pay_basis: 'DAILY' };
								for (const day of ['04', '05', '06', '07', '08', '11', '12', '13', '14', '15'])
									fixturePresent(tables.get('roster_entry')).push(
										fixtureRow({
											id: `w${day}`,
											employment_id: 'k-p1',
											payslip_id: null,
											work_date: `2026-05-${day}`,
											shift_definition_id: 'D',
											worked_intervals: [
												{
													start: `2026-05-${day}T09:00:00.000Z`,
													end: `2026-05-${day}T17:00:00.000Z`
												}
											]
										})
									);
								const dailyTables = guardFixture(
									FixtureSchema.Struct({
										tables: FixtureSchema.Array(
											FixtureSchema.Struct({
												year: FixtureSchema.Number,
												rows: FixtureSchema.Array(FixtureSchema.Array(FixtureSchema.Number))
											})
										)
									})
								);
								const daily = fixturePresent(
									dailyTables(payrollRules('version_4').withholding_daily_table).tables.find(
										(t) => t.year === 2026
									)
								);
								for (const week of ['2026-05-1', '2026-05-2']) {
									const weekly = fixturePresent((yield* run(week, 'REGULAR')).payslips[0]);
									const own = weekly.statutory
										.filter((line) =>
											['HEALTH', 'CHILD_SUPPORT', 'PENSION', 'EI', 'SI_PREVIOUS_MONTH'].includes(
												line.scheme_code
											)
										)
										.reduce((sum, line) => sum + line.employee_amount, 0);
									const x = (weekly.gross - own) / 7;
									const row = fixturePresent(
										daily.rows.find((r) => x >= fixturePresent(r[0]) && x < fixturePresent(r[1]))
									);
									assert.equal(weekly.gross, 60000, week);
									// Haruto declares one dependant: the 甲欄 1-person column.
									assert.equal(
										fixturePresent(lines(weekly).INCOME_TAX)[0],
										fixturePresent(row[3]) * 7,
										`${week} ${x}`
									);
								}
								// An employer-caused shutdown on Monday and Tuesday of the third week: 休業手当 60% of the average wage a day.
								fixturePresent(tables.get('work_suspension')).push(
									fixtureRow({
										id: 's1',
										company_id: COMPANY,
										kind: 'EMPLOYER_CAUSED',
										starts_on: '2026-05-18',
										ends_on: '2026-05-19',
										worksite: null,
										employment_ids: [],
										facts: { average_daily_wage: 10000 }
									})
								);
								const shutdown = fixturePresent((yield* run('2026-05-3', 'REGULAR')).payslips[0]);
								const allowance = fixturePresent(
									shutdown.base.find((line) => line.component_code === 'SUSPENSION_ALLOWANCE')
								);
								assert.equal(Number(allowance.amount), 2 * 6000);
								assert.equal(shutdown.gross, 12000);
							}
							// An off-cycle bonus paid during childcare leave: its month is exempt (健康保険法 art.159), the off-cycle slip reads
							// the leave rows.
							if (scenario === 'childcare bonus') {
								resetTables();
								yield* run('2026-03', 'REGULAR');
								const childcare = fixturePresent(
									file('version_4', 'leave_catalog').find((row) => row.code === 'CHILDCARE_LEAVE')
								);
								fixturePresent(tables.get('leave_catalog_entry')).push(
									fixtureRow({
										id: 'cc1',
										catalog_id: childcare.id,
										employment_id: 'k-p1',
										company_id: COMPANY,
										payslip_id: null,
										occurred_on: '2026-04-01',
										from: '2026-04-01',
										to: '2026-06-30',
										days: 65,
										activity: 'TIME_OFF',
										facts: {}
									})
								);
								fixturePresent(tables.get('adhoc_catalog_entry')).push(
									fixtureRow({
										id: 'b2',
										catalog_id: bonus.id,
										employment_id: 'k-p1',
										company_id: COMPANY,
										payslip_id: null,
										occurred_on: '2026-04-20',
										amount: 500000,
										activity: 'AWARD'
									})
								);
								const onLeave = fixturePresent(
									(yield* run('2026-04', 'OFF_CYCLE', ['b2'])).payslips.find(
										(slip) => slip.employment_id === fixtureKey('k-p1')
									)
								);
								const charged = lines(onLeave);
								for (const code of ['HEALTH_BONUS', 'CHILD_SUPPORT_BONUS', 'PENSION_BONUS'])
									assert.equal(charged[code], undefined, code);
								assert.ok(charged.EI_BONUS);
							}
							// A SEMI_MONTHLY entity: each half pays half the monthly salary and half of each fixed allowance.
							if (scenario === 'semi-monthly allowances') {
								resetTables();
								fixturePresent(fixturePresent(tables.get('entity'))[0]).pay_frequency =
									'SEMI_MONTHLY';
								tables.set(
									'employment_contract',
									fixtureRows(
										fixturePresent(tables.get('employment_contract')).filter(
											(row) => row.id === fixtureKey('k-p1')
										)
									)
								);
								const halfTerm = fixturePresent(
									fixtureRecords(
										fixtureRecord(
											fixturePresent(fixturePresent(tables.get('employment_contract'))[0]).facts
										).contract_terms
									)[0]
								);
								halfTerm.allowances = [
									{ code: 'FIXED_ALLOWANCE', amount: { value: 30000, currency: 'JPY' } },
									{ code: 'COMMUTING_ALLOWANCE', amount: { value: 12000, currency: 'JPY' } }
								];
								const amountOf = (
									slip: Effect.Success<ReturnType<typeof run>>['payslips'][number],
									code: string
								) =>
									Number(
										(
											slip.base.find((line) => line.component_code === code) ?? {
												amount: 0
											}
										).amount
									);
								let monthly = 0;
								for (const half of ['2026-06-1', '2026-06-2']) {
									const slip = fixturePresent((yield* run(half, 'REGULAR')).payslips[0]);
									assert.equal(amountOf(slip, 'BASIC'), 150000, half);
									assert.equal(amountOf(slip, 'FIXED_ALLOWANCE'), 15000, half);
									assert.equal(amountOf(slip, 'COMMUTING_ALLOWANCE'), 6000, half);
									monthly += slip.gross;
								}
								// The month together pays the monthly salary and allowances once: 300,000 + 30,000 + 12,000.
								assert.equal(monthly, 342000);
							}
						})
					);
				})
			);
		}
	});
});
