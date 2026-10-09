/**
 * Every `TASKS`, `OBLIGATIONS` and `VALIDATIONS` row of every lineage and version, evaluated strictly on a
 * representative context for its trigger or site: every model field of the trigger row present, every fact the
 * version's input schemas declare filled with a value of its type, the day inside the version's range.
 *
 * A duty runs through the canonical `raise-*` behaviour rule as the tap runs it (one duty row as the rule's read) and,
 * apart, each of its expressions on the context that rule hands it, so a `due` behind a false `when` is read too. A
 * validation's `when` runs on its site's context. A failure is listed as `silent` when the loose evaluation the tap
 * used before (`evaluateConfigured`: CEL's commutative `&&` / `||` absorb a nested `configured_eval` failure) returned
 * without it. The list is pinned (`KNOWN`): a new failure fails the suite, and so does a fixed one until it is struck.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { addDays, monthOf } from '@norbital-ai/std/date';
import { type Behaviours, behavioursOf } from '../src/lib/payroll_engine/behaviours.ts';
import { evaluateConfigured, evaluateStrict } from '../src/lib/payroll_engine/expressions.ts';
import { getErrorMessage } from '../src/lib/payroll_engine/foundation.ts';
import { subjectContext } from '../src/lib/payroll_engine/services.ts';
import { triggerOf } from './duties.ts';
import payroll_run from '../src/data/model/payroll_run/+model.ts';
import payslip from '../src/data/model/payroll_run/payslip/+model.ts';
import employment_contract from '../src/data/model/employment_profile/employment_contract/+model.ts';
import employment_profile from '../src/data/model/employment_profile/+model.ts';
import entity from '../src/data/model/entity/+model.ts';
import leave_catalog_entry from '../src/data/model/jurisdiction/leave_catalog/leave_catalog_entry/+model.ts';
import claim_catalog_entry from '../src/data/model/jurisdiction/claim_catalog/claim_catalog_entry/+model.ts';
import adhoc_catalog_entry from '../src/data/model/jurisdiction/adhoc_catalog/adhoc_catalog_entry/+model.ts';
import loan_catalog_entry from '../src/data/model/jurisdiction/loan_catalog/loan_catalog_entry/+model.ts';
import roster_entry from '../src/data/model/roster/roster_entry/+model.ts';
import obligation from '../src/data/model/jurisdiction/obligation/+model.ts';
import regulatory_task from '../src/data/model/jurisdiction/regulatory_task/+model.ts';
import workplace_case from '../src/data/model/entity/workplace_case/+model.ts';
import work_suspension from '../src/data/model/entity/work_suspension/+model.ts';
import adhoc_catalog from '../src/data/model/jurisdiction/adhoc_catalog/+model.ts';
import claim_catalog from '../src/data/model/jurisdiction/claim_catalog/+model.ts';
import leave_catalog from '../src/data/model/jurisdiction/leave_catalog/+model.ts';
import loan_catalog from '../src/data/model/jurisdiction/loan_catalog/+model.ts';

type Row = Record<string, unknown>;
type Field = {
	readonly kind?: string;
	readonly values?: readonly string[];
	readonly initial?: string;
	readonly shape?: Field & { readonly fields?: Readonly<Record<string, Field>> };
};
const law = resolve(process.cwd(), 'seed/jurisdiction');
const read = (dir: string, name: string): Row[] =>
	JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8')) as Row[];

/** One value of a model field's kind. */
const fieldValue = (field: Field, day: string): unknown => {
	switch (field.kind) {
		case 'text':
			return 'X';
		case 'enum':
			return field.values?.[0] ?? 'X';
		case 'state':
			return field.initial ?? 'X';
		case 'bool':
			return false;
		case 'int':
		case 'seq':
		case 'decimal':
		case 'money':
		case 'sum':
			return 1;
		case 'date':
			return day;
		case 'instant':
			return `${day}T02:00:00.000Z`;
		case 'period':
			return { from: day, to: null };
		case 'currency':
			return 'XXX';
		case 'list':
			return [];
		case 'json':
			return field.shape?.kind === 'object'
				? rowOf(field.shape.fields ?? {}, day)
				: field.shape?.kind === 'list'
					? []
					: {};
		case 'object':
		case 'record':
			return {};
		default:
			return null;
	}
};
const rowOf = (fields: Readonly<Record<string, Field>>, day: string): Row =>
	Object.fromEntries(Object.entries(fields).map(([name, field]) => [name, fieldValue(field, day)]));
const modelRow = (spec: { readonly fields: object }, day: string): Row => ({
	id: 'r1',
	approval_id: null,
	...rowOf(spec.fields as Readonly<Record<string, Field>>, day)
});

type JsonSchema = {
	readonly type?: string | readonly string[];
	readonly const?: unknown;
	readonly enum?: readonly unknown[];
	readonly format?: string;
	readonly minimum?: number;
	readonly properties?: Readonly<Record<string, JsonSchema>>;
	readonly required?: readonly string[];
	readonly items?: JsonSchema;
};
/** One value of a JSON schema: its const, its first choice, else a value of its first non-null type. */
const schemaValue = (schema: JsonSchema | undefined, day: string, sparse: boolean): unknown => {
	if (schema == null) return null;
	if (schema.const !== undefined) return schema.const;
	if (schema.enum !== undefined) return schema.enum.find((value) => value !== null) ?? null;
	const type = [schema.type ?? (schema.properties ? 'object' : 'string')]
		.flat()
		.find((held) => held !== 'null');
	switch (type) {
		case 'object':
			return Object.fromEntries(
				Object.entries(schema.properties ?? {})
					.filter(([key]) => !sparse || (schema.required ?? []).includes(key))
					.map(([key, held]) => [key, schemaValue(held, day, sparse)])
			);
		case 'array':
			return schema.items == null || sparse ? [] : [schemaValue(schema.items, day, sparse)];
		case 'number':
		case 'integer':
			return Math.max(1, schema.minimum ?? 1);
		case 'boolean':
			return false;
		default:
			return schema.format === 'date'
				? day
				: schema.format === 'date-time'
					? `${day}T02:00:00.000Z`
					: 'X';
	}
};

const TRIGGER_MODELS: Readonly<Record<string, { readonly fields: object }>> = {
	payroll_run,
	payslip,
	employment_contract,
	employment_profile,
	entity,
	leave_catalog_entry,
	claim_catalog_entry,
	adhoc_catalog_entry,
	loan_catalog_entry,
	roster_entry,
	obligation,
	regulatory_task,
	workplace_case,
	work_suspension
};
const CATALOG_MODELS: Readonly<Record<string, { readonly fields: object }>> = {
	adhoc_catalog_entry: adhoc_catalog,
	claim_catalog_entry: claim_catalog,
	leave_catalog_entry: leave_catalog,
	loan_catalog_entry: loan_catalog
};

type Failure = {
	readonly lineage: string;
	readonly version: string;
	readonly code: string;
	readonly family: string;
	/** `full`: every declared fact present; `sparse`: only the schemas' required ones (an optional fact absent). */
	readonly facts: 'full' | 'sparse';
	/** `rule` for the canonical behaviour run, else the expression's key in `rules`. */
	readonly key: string;
	readonly silent: boolean;
	readonly message: string;
};

/** Each version's rows evaluated as above. */
const failures = (
	/** Extra rows for a version's rule set (`<lineage>/<version>`): the suite's own controls. */
	extra: Readonly<Record<string, readonly Row[]>> = {}
): Failure[] => {
	const out: Failure[] = [];
	for (const lineage of readdirSync(law).sort())
		for (const version of readdirSync(join(law, lineage)).sort())
			for (const sparse of [false, true]) {
				const dir = join(law, lineage, version);
				const [settings] = read(dir, 'jurisdiction_settings');
				const behaviours = behavioursOf(settings!.behaviours) as Behaviours;
				const rule = (id: string) => behaviours.rules.find((held) => held.id === id)!;
				const ruleSet = [...read(dir, 'rule_set'), ...(extra[`${lineage}/${version}`] ?? [])];
				// the version's PAYROLL rule tables: every rule context's `rules`
				const payrollRules = Object.fromEntries(
					ruleSet
						.filter((row) => row.family === 'PAYROLL')
						.map((row) => [String(row.code), row.rules ?? {}])
				);
				const kinds = (code: string) =>
					(
						((ruleSet.find((row) => row.code === code)?.rules as Row | undefined)?.kinds ??
							[]) as Row[]
					).map((kind) => String(kind.code));
				const range = settings!.effective_range as { from: string };
				const day = String(addDays(range.from, 45));
				const hired = String(addDays(day, -800));
				const month = monthOf(day);
				const period = { key: day.slice(0, 7), from: String(month.from), to: String(month.to) };
				const employeeSchema = (settings!.employee_input_schema ?? {}) as JsonSchema;
				const entitySchema = (settings!.entity_input_schema ?? {}) as JsonSchema;
				const prop = (name: string) => employeeSchema.properties?.[name];
				const term = {
					...(schemaValue(prop('contract_terms')?.items, day, sparse) as Row),
					effective_range: { from: hired, to: null }
				};
				const company = {
					...modelRow(entity, day),
					id: 'c1',
					settings_code: lineage,
					facts: schemaValue(entitySchema, day, sparse)
				};
				const employee = {
					...modelRow(employment_profile, day),
					id: 'p1',
					date_of_birth: '1990-01-15',
					facts: {
						...(schemaValue(prop('facts'), day, sparse) as Row),
						employment_statutory_facts: []
					}
				};
				const contractOf = (exit: string | null): Row => ({
					...modelRow(employment_contract, day),
					id: 'k1',
					company_id: 'c1',
					employee_id: 'p1',
					effective_range: { from: hired, to: exit },
					exit_ground: exit == null ? null : (kinds('exit_grounds')[0] ?? 'X'),
					exit_facts: exit == null ? null : schemaValue(prop('exit_facts'), day, sparse),
					facts: { contract_terms: [term] },
					engagement: 'EMPLOYEE',
					leave: [],
					leave_balances: [],
					terms_written: [term],
					before: {}
				});
				const subjectOf = (contract: Row) => ({
					...subjectContext({
						contract: contract as never,
						employee: employee as never,
						entity: company as never,
						term: term as never,
						day,
						headcount: 10,
						version: settings as never
					}),
					rules: payrollRules
				});
				const record = (
					row: Row,
					key: string,
					run: (evaluate: typeof evaluateStrict) => unknown
				) => {
					try {
						run(evaluateStrict);
					} catch (cause) {
						let silent = false;
						try {
							run(evaluateConfigured);
							silent = true;
						} catch {
							// loud before too
						}
						out.push({
							lineage,
							version,
							code: String(row.code),
							family: String(row.family),
							facts: sparse ? 'sparse' : 'full',
							key,
							silent,
							message: getErrorMessage(cause).split('\n')[0]!
						});
					}
				};

				for (const row of ruleSet) {
					const rules = (row.rules ?? {}) as Row;
					if (row.family === 'TASKS' || row.family === 'OBLIGATIONS') {
						const trigger =
							row.family === 'OBLIGATIONS'
								? { collection: 'payroll_run', event: 'created' }
								: (rules.trigger as { collection: string; event: string });
						const { collection, event } = trigger;
						const employs = ![
							'payroll_run',
							'entity',
							'obligation',
							'regulatory_task',
							'work_suspension',
							'workplace_case'
						].includes(collection);
						const exits = triggerOf(row) === 'EXIT' || event === 'after_exit';
						const contract = contractOf(exits ? day : null);
						const model = TRIGGER_MODELS[collection];
						const catalog = CATALOG_MODELS[collection];
						const triggerRow: Row =
							collection === 'calendar' || collection === 'employment_contract'
								? contract
								: collection === 'entity'
									? { ...company, before: {} }
									: {
											...(model == null ? {} : modelRow(model, day)),
											company_id: 'c1',
											employment_id: employs ? 'k1' : null,
											period: period.key,
											kind:
												collection === 'workplace_case'
													? (kinds('case_kinds')[0] ?? 'X')
													: collection === 'payroll_run'
														? 'REGULAR'
														: 'X',
											...(catalog == null
												? {}
												: {
														catalog_code: 'X',
														catalog: { ...modelRow(catalog, day), code: 'X' },
														leave: [],
														chain_from: day
													}),
											...(collection === 'payslip'
												? { line_codes: [], paid_on: day, pay_date: day, pay_due_date: day }
												: {}),
											before: {}
										};
						const run = {
							// one unit of every scheme the remittance names, so it raises and its `due` and `amount` are read
							totals: {
								gross: 1000,
								net: 900,
								employer_cost: 1100,
								schemes: Object.fromEntries(
									((rules.schemes ?? []) as string[]).map((code) => [
										code,
										{ employee: 1, employer: 1, base: 1 }
									])
								)
							},
							// the run's statutory totals per scheme, insured amounts summed
							statutory: Object.fromEntries(
								((rules.schemes ?? []) as string[]).map((code) => [
									code,
									{ base: 1, employee: 1, employer: 1, charged_base: 1, parts: {} }
								])
							),
							pay_date: period.to,
							pay_due_date: period.to
						};
						const event_ = {
							collection,
							action: event,
							row: triggerRow,
							settings_id: settings!.id,
							rules: payrollRules,
							day,
							headcount: 10,
							headcount_permanent: 10,
							headcount_by_worksite: {},
							headcount_permanent_by_worksite: {},
							headcount_months: [],
							separations: [],
							leave_balances: [],
							period,
							company_id: 'c1',
							employment_id: employs ? 'k1' : null,
							employee_id: employs ? 'p1' : null
						};
						const reads = {
							duties: row.family === 'OBLIGATIONS' ? [row] : [],
							tasks: row.family === 'TASKS' ? [row] : [],
							company: [company],
							contract: employs ? [contract] : [],
							employee: employs ? [employee] : [],
							holidays: [],
							raised: [],
							subject_tasks: []
						};
						const canonical = rule(row.family === 'TASKS' ? 'raise-tasks' : 'raise-obligations');
						record(row, 'rule', (evaluate) =>
							evaluate(canonical.effect!, { event: event_, run, ...reads })
						);
						// Each expression on the context the canonical rule hands it.
						const own =
							row.family === 'TASKS'
								? {
										row: triggerRow,
										rules: payrollRules,
										period,
										company,
										contract: employs ? contract : null,
										employee: employs ? employee : null,
										hired_on: employs ? hired : null,
										exit_on: employs
											? contract.effective_range && (contract.effective_range as Row).to
											: null,
										holidays: [],
										holidays_named: [],
										today: day,
										headcount: 10,
										separations: [],
										headcount_by_worksite: {},
										headcount_permanent: 10,
										headcount_permanent_by_worksite: {}
									}
								: { period, rules: payrollRules, company, run, holidays: [], holidays_named: [] };
						// `due`, `repeat_key`, `occurrence` and `amount` are read only once these hold: the canonical run reads them.
						for (const key of ['when', 'applies_when'])
							if (typeof rules[key] === 'string')
								record(row, key, (evaluate) => evaluate(String(rules[key]), own));
					}
					if (row.family === 'VALIDATIONS' && typeof rules.when === 'string') {
						const subject = subjectOf(contractOf(null));
						const workDay = {
							date: day,
							day_type: 'WORK',
							shift_code: 'X',
							holiday_kind: null,
							holiday_name: null,
							scheduled_hours: 8,
							worked_hours: 8,
							worked: true,
							overtime_hours: 1,
							banked_hours: 0,
							banked_band: null,
							incentive_hours: 0,
							overtime_consented_at: null,
							overtime_consented: false,
							worksite: 'X',
							facts: {},
							suspended: null,
							intervals: [{ start: `${day}T09:00`, end: `${day}T18:00` }],
							in_period: true
						};
						const sums = { worked_hours: 160, overtime_hours: 10, incentive_hours: 0 };
						const hours = {
							...sums,
							day_type: { WORK: sums, REST: sums, OFF: sums, HOLIDAY: sums },
							holiday_kind: {}
						};
						const earnedMonth = { gross: 1000, net: 900, statutory: {} };
						const context =
							rules.site === 'contract'
								? {
										...subject,
										term: subject.terms,
										day,
										employment: { ...(subject.employment as Row), terms: [subject.terms] },
										person: { ...(subject.person as Row), contracts: [] }
									}
								: rules.site === 'roster'
									? {
											...subject,
											day: { ...workDay, leave_code: null, rest_hours_before: 12 },
											week: {
												worked_hours: 40,
												overtime_hours: 5,
												worked_days: 5,
												overtime_hours_by_day_type: { WORK: 5, REST: 0, OFF: 0, HOLIDAY: 0 },
												overtime_hours_holiday_by_day_type: { WORK: 0, REST: 0, OFF: 0 },
												holiday_worked_hours: 0
											}
										}
									: {
											...subject,
											period: {
												...period,
												days: 30,
												paid_days: 30,
												covered_days: 30,
												working_days: 22,
												covered_working_days: 22,
												unpaid_working_days: 0,
												part: 1,
												parts: 1,
												month_key: period.key,
												month_from: period.from,
												month_to: period.to,
												month_days: 30,
												month_working_days: 22,
												month_holiday_work_days: 0,
												previous_month_working_days: 20,
												previous_month_holiday_work_days: 0,
												switched: false,
												pay_date: period.to
											},
											work: {
												overtime_hours: 1,
												incentive_hours: 0,
												dates: [day],
												holidays: [],
												holiday_dates: [],
												days: [workDay],
												week_before: [],
												month_days: [workDay]
											},
											earned: {
												month: earnedMonth,
												year: earnedMonth,
												previous_month: { ...earnedMonth, base_salary: 1000 },
												average: { gross: 1000, net: 900, months: 3 },
												months: [],
												history: []
											},
											hours: {
												month: hours,
												month_to_date: hours,
												previous_month: hours,
												year: hours,
												rolling: hours,
												months: []
											},
											leave: { rows: [] },
											payslip: {
												gross: 1000,
												net: 900,
												total_deductions: 100,
												statutory_employee: 50,
												statutory_employer: 60,
												net_additions: 0,
												net_deductions: 0,
												lines: {}
											},
											statutory: {}
										};
						record(row, 'when', (evaluate) => evaluate(String(rules.when), context));
					}
				}
			}
	return out;
};

/** Every failure found, pinned: `lineage version code family key silent | message`. */
const KNOWN: readonly string[] = [];

describe('every duty and validation row evaluates strictly', () => {
	it('finds a broken duty CEL would have absorbed, and a broken validation', () => {
		const broken = failures({
			'SG/version_4': [
				{
					family: 'TASKS',
					code: 'CONTROL_TASK',
					rules: {
						description: 'control',
						authority: 'control',
						trigger: { collection: 'payroll_run', event: 'created' },
						when: 'row.no_such_field.flag == true',
						applies_when: 'false',
						due: 'today'
					}
				},
				{
					family: 'VALIDATIONS',
					code: 'CONTROL_CHECK',
					rules: {
						site: 'payslip',
						kind: 'warn',
						message: 'control',
						when: 'payslip.no_such_field > 1.0'
					}
				}
			]
		}).filter((held) => held.code.startsWith('CONTROL_'));
		assert.deepEqual(
			broken.map((held) => [held.code, held.key, held.facts, held.silent]),
			[
				['CONTROL_TASK', 'rule', 'full', true],
				['CONTROL_TASK', 'when', 'full', false],
				['CONTROL_CHECK', 'when', 'full', false],
				['CONTROL_TASK', 'rule', 'sparse', true],
				['CONTROL_TASK', 'when', 'sparse', false],
				['CONTROL_CHECK', 'when', 'sparse', false]
			]
		);
	});
	it('on a representative context for its trigger or site', () => {
		const found = failures().map(
			(held) =>
				`${held.lineage} ${held.version} ${held.code} ${held.family} ${held.key} ${held.facts} ${held.silent ? 'silent' : 'loud'} | ${held.message}`
		);
		assert.deepEqual(found, KNOWN);
	});
});
