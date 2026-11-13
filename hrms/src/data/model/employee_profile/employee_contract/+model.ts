import { DateTime, Effect } from 'effect';
import { type EffectCtx } from '@norbital-ai/bolt';
import { model } from '../../../../../.norbital/models/employee_contract.ts';
import { assertFactsHold } from '../../../../lib/ledger/service.js';
import { amendmentsFor } from '../../../../lib/amendments.js';
import { isExit } from '../../../../lib/payroll_engine/contract_change.js';
import type { JsonObject } from '../../../../lib/payroll_engine/contracts.js';
import {
	isJsonObject,
	jsonObject,
	numberOf,
	stableJson
} from '../../../../lib/payroll_engine/foundation.js';
import {
	lawOn,
	rangeObject,
	startOf,
	validateRegistered
} from '../../../../lib/payroll_engine/registrations.js';
import { idOf, objectValue, queryRows, type Reader } from '../../../../lib/payroll_engine/reads.js';
import { tap } from '../../../../lib/payroll_engine/taps.js';
import { reconcile } from '../../../../lib/dependants.js';

/** What a writer may set; the contract number, seal stamps and the derived label are server-owned. */
const columns = [
	'employee_id',
	'entity_id',
	'pay_group_id',
	'engagement',
	'employee_number',
	'effective_range',
	'service_started_on',
	'signed_contract_period',
	'final_pay_due_on',
	'terms',
	'payroll',
	'events',
	'family',
	'bank',
	'employee_extension_data',
	'exit_ground',
	'encash_leave',
	'reason',
	'status'
] as const;

/**
 * A sealed version's jurisdiction facts stand. The save that ends it, or moves its end, may add the exit answers the law
 * reads (a termination cause): keys it did not hold.
 */
const restatesFacts = ({
	before,
	set
}: {
	readonly before: {
		readonly status: string;
		readonly effective_range: { readonly to: string | null };
		readonly employee_extension_data: JsonObject;
	};
	readonly set: {
		readonly effective_range?: { readonly to: string | null };
		readonly employee_extension_data?: JsonObject;
	};
}): boolean => {
	const next = set.employee_extension_data;
	const held = before.employee_extension_data;
	if (before.status !== 'SEALED' || next === undefined || stableJson(next) === stableJson(held))
		return false;
	const ends =
		set.effective_range !== undefined && set.effective_range.to !== before.effective_range.to;
	return (
		!ends ||
		Object.entries(held).some(
			([key, value]) => value !== null && stableJson(value) !== stableJson(next[key] ?? null)
		)
	);
};
/** The two dates answer different questions, but service cannot begin after the version that records it. */
const startsAfterService = (
	rows: readonly { readonly service_started_on?: unknown; readonly effective_range?: unknown }[]
) =>
	rows.some((row) => {
		const range = isJsonObject(row.effective_range) ? row.effective_range : null;
		const from = range === null ? null : range.from;
		return (
			row.service_started_on != null &&
			from != null &&
			String(row.service_started_on) > String(from)
		);
	});
const CLOCK = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const clockMinutes = (clock: string): number =>
	Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
/** The paid minutes of one shift code, net of its unpaid breaks. */
const shiftMinutes = (variant: unknown): number | null => {
	if (!isJsonObject(variant)) return null;
	if (variant.day_type !== 'WORK') return 0;
	const start = typeof variant.start_time === 'string' ? variant.start_time : null;
	const end = typeof variant.end_time === 'string' ? variant.end_time : null;
	const untimed = typeof variant.untimed_hours === 'number' ? variant.untimed_hours : null;
	if (start === null || end === null || !CLOCK.test(start) || !CLOCK.test(end))
		return untimed === null ? null : Math.round(untimed * 60);
	let span = clockMinutes(end) - clockMinutes(start);
	if (span <= 0 || variant.ends_next_day === true) span += 1440;
	let pause = 0;
	for (const item of Array.isArray(variant.breaks) ? variant.breaks : []) {
		if (!isJsonObject(item) || item.paid === true) continue;
		const pauseStart = typeof item.start_time === 'string' ? item.start_time : null;
		const pauseEnd = typeof item.end_time === 'string' ? item.end_time : null;
		if (
			pauseStart === null ||
			pauseEnd === null ||
			!CLOCK.test(pauseStart) ||
			!CLOCK.test(pauseEnd)
		)
			continue;
		pause += Math.max(0, clockMinutes(pauseEnd) - clockMinutes(pauseStart));
	}
	return Math.max(0, span - pause);
};
const shiftIdsOf = (pattern: unknown): readonly string[] => {
	if (!isJsonObject(pattern)) return [];
	const ids = new Set<string>();
	if (isJsonObject(pattern.days))
		for (const value of Object.values(pattern.days))
			if (typeof value === 'string' && value !== '') ids.add(value);
	if (Array.isArray(pattern.cycle))
		for (const slot of pattern.cycle)
			if (isJsonObject(slot) && typeof slot.shift_definition_id === 'string')
				ids.add(slot.shift_definition_id);
	return [...ids];
};
/** The contract's agreed rate and normal working time against the version's limits, where the version states them. */
const assertTerms = (
	rows: readonly { readonly terms?: unknown }[],
	lookups: readonly unknown[]
):
	| 'errors.employee_contract_rate_positive'
	| 'errors.employee_contract_hours_per_day'
	| 'errors.employee_contract_hours_per_week'
	| 'errors.employee_contract_days_allowed'
	| 'errors.employee_contract_days_per_week'
	| null => {
	const first = (
		lookup: Readonly<Record<string, unknown>>,
		names: readonly string[]
	): number | null => {
		for (const name of names) {
			const value = lookup[name];
			const number = numberOf(value);
			if (number !== null) return number;
			if (isJsonObject(value)) {
				const nested = numberOf(value.maximum ?? value.max);
				if (nested !== null) return nested;
			}
		}
		return null;
	};
	for (const [index, row] of rows.entries()) {
		const terms = isJsonObject(row.terms) ? row.terms : {};
		const rate = isJsonObject(terms.rate) ? terms.rate : null;
		if (rate === null || !(numberOf(rate.amount) !== null && Number(rate.amount) > 0))
			return 'errors.employee_contract_rate_positive';
		const lookup = lookups[index];
		if (!isJsonObject(lookup)) continue;
		const limits = isJsonObject(lookup.limits) ? lookup.limits : {};
		const limit = (names: readonly string[]) =>
			first({ ...lookup, ...limits }, names) ?? first(limits, names);
		const day = numberOf(terms.normal_hours_per_day);
		if (day !== null) {
			const min = limit([
				'normal_hours_per_day_minimum',
				'minimum_daily_hours',
				'hours_per_day_minimum',
				'normal_hours_per_day_min'
			]);
			const max = limit([
				'normal_hours_per_day_maximum',
				'maximum_daily_hours',
				'daily_hours',
				'normal_hours_per_day_max',
				'hours_per_day_maximum'
			]);
			if (!(day > 0) || (min !== null && day < min) || (max !== null && day > max))
				return 'errors.employee_contract_hours_per_day';
		}
		const week = numberOf(terms.normal_hours_per_week);
		if (week !== null) {
			const min = limit([
				'normal_hours_per_week_minimum',
				'hours_per_week_minimum',
				'normal_hours_per_week_min'
			]);
			const max = limit([
				'normal_hours_per_week_maximum',
				'weekly_hours',
				'normal_hours_per_week_max'
			]);
			if (!(week > 0) || (min !== null && week < min) || (max !== null && week > max))
				return 'errors.employee_contract_hours_per_week';
		}
		const days = numberOf(terms.normal_days_per_week);
		if (days !== null) {
			const allowed = lookup.normal_days_per_week;
			if (Array.isArray(allowed) && !allowed.map(Number).includes(days))
				return 'errors.employee_contract_days_allowed';
			const min = limit(['days_per_week_minimum', 'normal_days_per_week_minimum']);
			const max = limit(['days_per_week_maximum', 'normal_days_per_week_maximum']);
			if (days !== Math.trunc(days) || (min !== null && days < min) || (max !== null && days > max))
				return 'errors.employee_contract_days_per_week';
		}
	}
	return null;
};
const NO_PAY_GROUP = 'errors.employee_contract_choose_pay_group' as const;
const OTHER_PAY_GROUP = 'errors.employee_contract_pay_group_other_company' as const;
/**
 * Each row's pay group: the one named, else the company's only one. A string is a refusal: a group of another company,
 * or a sealed contract in a company with several groups and none named.
 */
const payGroupsOf = Effect.fnUntraced(function* (
	read: Reader,
	rows: readonly {
		readonly entity_id: unknown;
		readonly pay_group_id?: unknown;
		readonly status?: unknown;
	}[]
) {
	const { pay_group: groups = [] } = yield* queryRows(read, {
		pay_group: {
			where: { entity_id: { in: [...new Set(rows.map((row) => String(row.entity_id)))] } },
			fields: ['id', 'entity_id'],
			limit: 10000
		}
	});
	const answer: (string | null)[] = [];
	for (const row of rows) {
		const own = groups.filter((group) => String(group.entity_id) === String(row.entity_id));
		if (row.pay_group_id != null) {
			if (!own.some((group) => String(group.id) === String(row.pay_group_id)))
				return OTHER_PAY_GROUP;
			answer.push(String(row.pay_group_id));
			continue;
		}
		const [only] = own;
		if (own.length === 1 && only !== undefined) answer.push(String(only.id));
		else if (row.status === 'SEALED') return NO_PAY_GROUP;
		else answer.push(null);
	}
	return answer;
});
/** A shift code a contract schedules may not run longer than the contract's normal day. */
const overlongShift = Effect.fnUntraced(function* (
	read: Reader,
	rows: readonly { readonly terms?: unknown }[]
) {
	const wanted = rows.flatMap((row) => {
		const terms = isJsonObject(row.terms) ? row.terms : null;
		const patternId = terms?.shift_pattern_id;
		const hours = terms?.normal_hours_per_day;
		return typeof patternId === 'string' && typeof hours === 'number' && Number.isFinite(hours)
			? [{ patternId, hours }]
			: [];
	});
	if (wanted.length === 0) return null;
	const patterns = yield* queryRows(read, {
		shift_pattern: {
			where: { id: { in: [...new Set(wanted.map((row) => row.patternId))] } },
			fields: ['id', 'pattern'],
			limit: 10000
		}
	});
	const patternById = new Map(patterns.shift_pattern?.map((row) => [String(row.id), row]) ?? []);
	const shiftIds = [
		...new Set([...patternById.values()].flatMap((row) => shiftIdsOf(row.pattern)))
	];
	if (shiftIds.length === 0) return null;
	const shifts = yield* queryRows(read, {
		shift_definition: {
			where: { id: { in: shiftIds } },
			fields: ['id', 'code', 'variant'],
			limit: 10000
		}
	});
	const shiftById = new Map(shifts.shift_definition?.map((row) => [String(row.id), row]) ?? []);
	for (const { patternId, hours } of wanted) {
		const pattern = patternById.get(patternId)?.pattern;
		for (const id of shiftIdsOf(pattern)) {
			const shift = shiftById.get(id);
			if (shift === undefined) continue;
			const minutes = shiftMinutes(shift.variant);
			if (minutes !== null && minutes > hours * 60)
				return {
					code: String(shift.code),
					lasts: new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(minutes / 60),
					hours
				};
		}
	}
	return null;
});
/** The terms against the law in force on the contract's first day: rate, normal time, category and work region. */
const assertLaw = Effect.fnUntraced(function* (read: Reader, rows: readonly JsonObject[]) {
	const law = yield* lawOn(
		read,
		rows.map((row) => ({ entity: row.entity_id, on: startOf(row) }))
	);
	const ids = [
		...new Set(law.flatMap((version) => (version === undefined ? [] : [String(version.id)])))
	];
	const { jurisdiction_settings: found = [] } =
		ids.length === 0
			? {}
			: yield* queryRows(read, {
					jurisdiction_settings: {
						where: { id: { in: ids } },
						fields: ['id', 'lookup', 'work_regions'],
						limit: 10000
					}
				});
	const byId = new Map(found.map((row) => [String(row.id), row]));
	const versions = law.map((version) => byId.get(String(version?.id)));
	const terms = assertTerms(
		rows,
		versions.map((version) => version?.lookup)
	);
	if (terms !== null) return terms;
	for (const [index, row] of rows.entries()) {
		const version = versions[index];
		const agreed = isJsonObject(row.terms) ? row.terms : {};
		const lookup = isJsonObject(version?.lookup) ? version.lookup : {};
		const categories = lookup.statutory_work_categories;
		const category = agreed.statutory_work_category;
		if (typeof category === 'string' && Array.isArray(categories) && !categories.includes(category))
			return 'errors.employee_contract_work_category' as const;
		const regions = isJsonObject(version?.work_regions) ? Object.keys(version.work_regions) : [];
		const region = agreed.work_region;
		if (
			typeof region === 'string' &&
			region !== '' &&
			regions.length > 0 &&
			!regions.includes(region)
		)
			return 'errors.employee_contract_work_region' as const;
	}
	return null;
});
/**
 * A contract changes from the first of a month, a move to another entity included, so a run never prices a month on
 * two versions or two employers. A hire, a rehire and an exit keep their real date, and a run pays those days.
 */
const startsMidMonth = Effect.fnUntraced(function* (
	read: Reader,
	rows: readonly {
		readonly employee_id: string;
		readonly effective_range: { readonly from: string; readonly to: string | null };
	}[]
) {
	const mid = rows.filter((row) => !row.effective_range.from.endsWith('-01'));
	if (mid.length === 0) return false;
	const { employee_contract: held = [] } = yield* queryRows(read, {
		employee_contract: {
			where: {
				employee_id: { in: mid.map((row) => row.employee_id) },
				status: { eq: 'SEALED' }
			},
			fields: ['employee_id', 'effective_range'],
			limit: 10000
		}
	});
	return mid.some((row) => {
		const before = DateTime.formatIsoDateUtc(
			DateTime.add(DateTime.makeUnsafe(row.effective_range.from), { days: -1 })
		);
		return held.some((other) => {
			const { to } = objectValue(other.effective_range);
			return other.employee_id === row.employee_id && (typeof to !== 'string' || to >= before);
		});
	});
});

/**
 * The exits a write made, moved or cancelled. An exit is read from the chain, so a write to one version can change
 * another's: `before` is the exit as it stood, `after` the exit now, and an unmoved exit is left out.
 */
const exitsMoved = Effect.fnUntraced(function* (
	read: Reader,
	changes: readonly {
		readonly before?: object;
		readonly after: { readonly id: string; readonly employee_id: string };
	}[]
) {
	const { employee_contract: now = [], entity: entities = [] } = yield* queryRows(read, {
		employee_contract: {
			where: { employee_id: { in: [...new Set(changes.map(({ after }) => after.employee_id))] } },
			limit: 10000
		},
		entity: { fields: ['id', 'settings_code'], limit: 10000 }
	});
	const lineage = new Map(entities.map((row) => [String(row.id), String(row.settings_code)]));
	const written = new Map(changes.map(({ before, after }) => [after.id, before]));
	const then = now.flatMap((row) => {
		const id = String(row.id);
		if (!written.has(id)) return [row];
		const before = written.get(id);
		if (before === undefined) return [];
		// an effect's row holds its range as stored, half-open
		const held = jsonObject(before);
		return [{ ...held, effective_range: rangeObject(held.effective_range) ?? null }];
	});
	const exits = (chain: readonly JsonObject[]) =>
		new Map(chain.filter((row) => isExit(row, chain, lineage)).map((row) => [String(row.id), row]));
	const was = exits(then);
	const is = exits(now);
	return [...new Set([...was.keys(), ...is.keys()])].flatMap((id) => {
		const before = was.get(id);
		const after = is.get(id);
		if (
			before !== undefined &&
			after !== undefined &&
			objectValue(before.effective_range).to === objectValue(after.effective_range).to
		)
			return [];
		return [
			{ ...(before === undefined ? {} : { before }), ...(after === undefined ? {} : { after }) }
		];
	});
});

/**
 * Raise `exit` for what a write did to the chain, and settle in the same write what the chain's exits leave besides
 * pay: stale tasks and a cancelled exit's loan (`reconcile`). The leave is the last
 * payslip's, from the contract's `encash_leave`.
 */
const raiseExits = Effect.fnUntraced(function* (
	ctx: EffectCtx,
	changes: Parameters<typeof exitsMoved>[1]
) {
	if (changes.length === 0) return;
	const exits = yield* exitsMoved(ctx.query, changes);
	if (exits.length > 0) {
		yield* tap(ctx, 'exit', 'employee_contract', exits);
		yield* ctx.schedule('ledger', {
			employees: [
				...new Set(
					exits.map((exit) => idOf('employee_profile', (exit.after ?? exit.before)?.employee_id))
				)
			]
		});
	}
	// every chain write settles the chain's exit tasks and loans as the chain now stands: a write that lost a race to
	// the next one finds nothing left when it retries
	yield* reconcile(
		ctx,
		changes.map(({ after }) => idOf('employee_contract', after.id))
	);
});

type Reach = {
	readonly entity_id: string;
	readonly effective_range: { readonly from: string; readonly to: string | null };
};
/**
 * The days of pay an update reaches. A draft reaches nothing until it is sealed, and then all it covers; a void takes
 * back all it covered. A sealed version's terms stand, so only the days its new last day adds or takes away move, and
 * an exit answer stated on it reaches its last day. A last day that ends the employment is reached itself, because
 * its payslip settles the exit; one another version continues from the next day is not.
 */
const reachOf = (
	{
		before,
		set
	}: {
		readonly before: Reach & { readonly status: string };
		readonly set: Partial<Reach> & { readonly status?: string | undefined };
	},
	continues: (day: string) => boolean
): readonly Reach[] => {
	const next = { ...before, ...set };
	if (before.status !== 'SEALED') return next.status === 'SEALED' ? [next] : [];
	if (next.status === 'VOID') return [before];
	const was = before.effective_range.to;
	const now = next.effective_range.to;
	if (was === now)
		return was === null ? [] : [{ ...next, effective_range: { from: was, to: was } }];
	const earlier = was === null || (now !== null && now < was) ? now : was;
	if (earlier === null) return [];
	const later = was === null || now === null ? null : was < now ? now : was;
	return [
		{
			...next,
			effective_range: {
				from: continues(earlier)
					? DateTime.formatIsoDateUtc(DateTime.add(DateTime.makeUnsafe(earlier), { days: 1 }))
					: earlier,
				to: later
			}
		}
	];
};

export default model({
	description:
		'Sealed employment terms. A dated replacement changes future terms; consumed historical terms remain protected.',
	// a reference to a contract reads only its own fields: the person's name shows where the profile is read beside it
	record_label:
		"(has(record.employee_id.name) ? record.employee_id.name + ' · ' : '') + record.employee_number + ' · ' + string(record.effective_range.from)",
	fields: {
		employee_id: {
			kind: 'ref',
			to: 'employee_profile',
			inverse: 'employee_contract'
		},
		entity_id: { kind: 'ref', to: 'entity', inverse: 'employee_contract' },
		pay_group_id: {
			kind: 'ref',
			to: 'pay_group',
			inverse: 'employee_contract',
			optional: true,
			// the payroll this person is paid in; a company with one group fills it in, and a sealed contract always has one
			on_delete: 'restrict'
		},
		employee_number: { kind: 'text' },

		engagement: {
			kind: 'enum',
			values: [
				'EMPLOYEE',
				'PART_TIME',
				'CONTRACTOR',
				'INTERN',
				'APPRENTICE',
				'CONSULTANT',
				'PAYEE'
			],
			default: 'EMPLOYEE'
		},
		status: {
			kind: 'state',
			initial: 'DRAFT',
			states: {
				DRAFT: { to: ['SEALED'] },
				SEALED: { to: ['VOID'] },
				VOID: { to: [] }
			}
		},
		effective_range: {
			kind: 'period',
			of: 'date'
		},
		service_started_on: {
			kind: 'date',
			optional: true
		},
		signed_contract_period: { kind: 'period', of: 'date', optional: true },
		terms: {
			kind: 'object',
			fields: {
				signed_on: {
					kind: 'date',
					optional: true
				},
				probation_period: {
					kind: 'period',
					of: 'date',
					optional: true
				},
				/** The agreed rate: exactly one basis, and its amount. */
				rate: {
					kind: 'json',
					optional: true,
					shape: {
						kind: 'union',
						by: 'unit',
						arms: {
							MONTHLY: { amount: { kind: 'number', min: 0 } },
							DAILY: { amount: { kind: 'number', min: 0 } },
							HOURLY: { amount: { kind: 'number', min: 0 } }
						}
					}
				},
				normal_hours_per_day: {
					kind: 'number',
					min: 0
				},
				normal_hours_per_week: {
					kind: 'number',
					min: 0
				},
				normal_days_per_week: {
					kind: 'number',
					min: 0,
					max: 7
				},
				employer_bears_income_tax: {
					kind: 'bool',
					optional: true
				},
				employee_borne_tax_items: {
					kind: 'text',
					many: true,
					optional: true
				},
				job_title: { kind: 'text', optional: true },
				department: { kind: 'text', optional: true },
				statutory_work_category: { kind: 'text', optional: true },
				work_classification: { kind: 'text', optional: true },
				residency_status: { kind: 'text', optional: true },
				work_authorisation_category: { kind: 'text', optional: true },
				work_authorisation_expires_on: {
					kind: 'date',
					optional: true
				},
				work_region: {
					kind: 'text',
					optional: true
				},
				worksite: {
					kind: 'text',
					optional: true
				},
				shift_pattern_id: { kind: 'ref', to: 'shift_pattern', optional: true },
				notice_period: {
					kind: 'object',
					optional: true,
					fields: {
						value: { kind: 'number', min: 0 },
						unit: { kind: 'enum', values: ['DAYS', 'WEEKS', 'MONTHS'] }
					}
				},
				annual_leave_carry_limit_days: {
					kind: 'number',
					min: 0,
					optional: true
				},
				wage_payment_method: {
					kind: 'enum',
					values: ['BANK', 'CASH', 'CHEQUE', 'DIGITAL'],
					optional: true
				},
				allowances: {
					kind: 'record',
					optional: true,
					of: { kind: 'object', fields: { amount: { kind: 'number', min: 0 } } }
				}
			}
		},
		// person identity the jurisdiction formulas read; the profile owns contact details and the display name
		payroll: {
			kind: 'object',
			fields: {
				date_of_birth: { kind: 'date', optional: true },
				identity_number: { kind: 'text', optional: true },
				gender: { kind: 'enum', values: ['MALE', 'FEMALE'], optional: true },
				marital_status: {
					kind: 'enum',
					values: ['SINGLE', 'MARRIED', 'SEPARATED', 'DIVORCED', 'WIDOWED'],
					optional: true
				},
				nationality: { kind: 'text', optional: true },
				birth_city: { kind: 'text', optional: true },
				passport_number: { kind: 'text', optional: true }
			},
			optional: true
		},
		events: {
			kind: 'object',
			many: true,
			optional: true,
			fields: {
				kind: { kind: 'text' },
				on: { kind: 'date' },
				opened_on: { kind: 'date', optional: true },
				ended_on: { kind: 'date', optional: true },
				allocated_days: { kind: 'int', optional: true }
			}
		},
		family: {
			kind: 'object',
			many: true,
			optional: true,
			fields: {
				relation: { kind: 'enum', values: ['CHILD', 'SPOUSE', 'PARENT'] },
				born_on: { kind: 'date', optional: true },
				expected_on: { kind: 'date', optional: true },
				has_income: { kind: 'bool', optional: true },
				disabled: { kind: 'bool', optional: true },
				studying: { kind: 'bool', optional: true },
				allocations: { kind: 'record', optional: true, of: { kind: 'number', min: 0 } }
			}
		},
		bank: { kind: 'custom', of: 'bank', optional: true },
		final_pay_due_on: {
			kind: 'date',
			optional: true
		},
		reason: {
			kind: 'text',
			optional: true
		},
		encash_leave: {
			kind: 'bool',
			default: true
		},
		exit_ground: {
			kind: 'enum',
			optional: true,
			values: [
				'RETRENCHMENT',
				'RETIREMENT',
				'RESIGNATION',
				'DISMISSAL',
				'MISCONDUCT_DISMISSAL',
				'END_OF_CONTRACT',
				'MUTUAL',
				'DEATH',
				'UNILATERAL',
				'BREACH_BY_EMPLOYER'
			]
		},
		employee_extension_data: {
			kind: 'json',
			shape: { kind: 'record', of: { kind: 'json' } },
			default: {}
		}
	},
	constraints: {
		sealed_range: {
			no_overlap: 'effective_range',
			per: ['employee_id'],
			where: { status: { eq: 'SEALED' } }
		},
		// a sealed version's terms stand: its end, exit answers and a move to VOID stay editable; only the exit answers
		// it states in the save that ends it change `employee_extension_data` (`restatesFacts`)
		sealed_version: {
			locked: { status: { eq: 'SEALED' } },
			except: [
				'effective_range',
				'final_pay_due_on',
				'reason',
				'exit_ground',
				'encash_leave',
				'employee_extension_data',
				'status'
			]
		},
		void_version: { locked: { status: { eq: 'VOID' } } }
	},
	// found by its number, or by the person's own search text
	indexes: { search: { text: ['employee_number', 'employee_id'] } },
	outputs: {
		default: {
			fields: 'all',
			employee_id: {
				fields: 'all',
				employee_contract: { fields: 'all', entity_id: { fields: 'all' } }
			},
			entity_id: { fields: 'all' },
			leave_catalog_entry: { fields: 'all' }
		},
		kiosk: {
			fields: ['employee_id', 'entity_id', 'employee_number', 'effective_range', 'terms', 'status']
		}
	},
	create: {
		columns: { fields: columns },
		filled: { fields: ['employee_number'] },
		transform: function* (changes, ctx) {
			const input = changes.map(({ set }) => set);
			const groups = yield* payGroupsOf(ctx.query, input);
			if (typeof groups === 'string') return yield* ctx.refuse(groups, { field: 'pay_group_id' });
			const rows = input.map((row, index) => {
				const group = groups[index];
				return group == null ? row : { ...row, pay_group_id: idOf('pay_group', group) };
			});
			if (yield* startsMidMonth(ctx.query, rows))
				return yield* ctx.refuse('errors.employee_contract_mid_month', {
					field: 'effective_range'
				});
			if (startsAfterService(rows))
				return yield* ctx.refuse('errors.employee_contract_service_after_start', {
					field: 'service_started_on'
				});
			yield* validateRegistered(
				ctx.query,
				'employee_contract',
				'create',
				rows.map((row) => jsonObject(row))
			);
			const overlong = yield* overlongShift(ctx.query, rows);
			if (overlong !== null)
				return yield* ctx.refuse('errors.employee_contract_shift_overlong', {
					field: 'terms',
					values: overlong
				});
			const written = rows.map((row) => jsonObject(row));
			yield* assertFactsHold(ctx.query, written);
			const lawRefusal = yield* assertLaw(ctx.query, written);
			if (lawRefusal !== null) return yield* ctx.refuse(lawRefusal, { field: 'terms' });
			const employeeIds = [...new Set(rows.map((row) => row.employee_id))];
			const held = yield* ctx.query({
				employee_contract: {
					where: { employee_id: { in: employeeIds } },
					fields: ['employee_id', 'employee_number'],
					limit: 10000
				}
			});
			const existing = yield* ctx.query({
				employee_contract: { fields: ['employee_number'], limit: 10000 }
			});
			const numbers = new Map(
				held.employee_contract.rows.map((row) => [String(row.employee_id), row.employee_number])
			);
			let next =
				existing.employee_contract.rows.reduce((max, row) => {
					const match = /^HR-(\d+)$/.exec(String(row.employee_number ?? ''));
					return match === null ? max : Math.max(max, Number(match[1] ?? 0));
				}, 0) + 1;
			const assigned = new Map<string, string>();
			return {
				sets: rows.map((row) => {
					if (row.employee_number != null && row.employee_number !== '') return row;
					const employee = String(row.employee_id);
					const heldNumber = numbers.get(employee);
					if (heldNumber != null && heldNumber !== '')
						return { ...row, employee_number: heldNumber };
					const assignedNumber = assigned.get(employee);
					if (assignedNumber !== undefined) return { ...row, employee_number: assignedNumber };
					const number = `HR-${new Intl.NumberFormat('en', { minimumIntegerDigits: 4, useGrouping: false }).format(next++)}`;
					assigned.set(employee, number);
					return { ...row, employee_number: number };
				}),
				// a version sealed over paid periods amends them: the next run works each out again
				on_approved: yield* amendmentsFor(
					ctx.query,
					rows.flatMap((row) =>
						row.status === 'SEALED'
							? [
									{
										employee: String(row.employee_id),
										from: row.effective_range.from,
										to: row.effective_range.to
									}
								]
							: []
					)
				)
			};
		},
		effect: function* (changes, ctx) {
			const rows = changes.map(({ after }) => after);
			yield* ctx.schedule('ledger', {
				employees: [...new Set(rows.map((row) => row.employee_id))]
			});
			yield* tap(
				ctx,
				'create',
				'employee_contract',
				rows.map((after) => ({ after }))
			);
			// a new version can cancel its predecessor's exit
			yield* raiseExits(
				ctx,
				rows.map((after) => ({ after }))
			);
		}
	},
	update: {
		columns: { fields: columns.filter((field) => field !== 'employee_number') },
		transform: function* (changes, ctx) {
			// a sealed contract may still be voided; only its facts stand
			const substantive = changes.filter(
				({ before, set }) => !(before.status === 'SEALED' && set.status === 'VOID')
			);
			if (substantive.some(restatesFacts))
				return yield* ctx.refuse('errors.employee_contract_exit_answers', {
					field: 'employee_extension_data'
				});
			const drafts = substantive.filter(({ before }) => before.status === 'DRAFT');
			if (
				yield* startsMidMonth(
					ctx.query,
					drafts.map(({ after }) => after)
				)
			)
				return yield* ctx.refuse('errors.employee_contract_mid_month', {
					field: 'effective_range'
				});
			const proposed = substantive.map((change) => jsonObject(change.after));
			if (startsAfterService(proposed))
				return yield* ctx.refuse('errors.employee_contract_service_after_start', {
					field: 'service_started_on'
				});
			yield* validateRegistered(ctx.query, 'employee_contract', 'update', proposed);
			const overlong = yield* overlongShift(ctx.query, proposed);
			if (overlong !== null)
				return yield* ctx.refuse('errors.employee_contract_shift_overlong', {
					field: 'terms',
					values: overlong
				});
			yield* assertFactsHold(ctx.query, proposed);
			const lawRefusal = yield* assertLaw(ctx.query, proposed);
			if (lawRefusal !== null) return yield* ctx.refuse(lawRefusal, { field: 'terms' });
			const unexplained = changes.findIndex(
				({ set }) => set.status === 'VOID' && !set.reason?.trim()
			);
			if (unexplained >= 0)
				return yield* ctx.refuse('errors.employee_contract_void_reason', {
					row: unexplained,
					field: 'reason'
				});
			const groups = yield* payGroupsOf(
				ctx.query,
				changes.map(({ after }) => after)
			);
			if (typeof groups === 'string') return yield* ctx.refuse(groups, { field: 'pay_group_id' });
			// the versions that take over the day after another ends, drafts included: such an end is no exit
			const ending = changes.filter(({ set }) => set.effective_range !== undefined);
			const following =
				ending.length === 0
					? []
					: (yield* ctx.query({
							employee_contract: {
								where: {
									employee_id: { in: ending.map(({ before }) => before.employee_id) },
									status: { in: ['DRAFT', 'SEALED'] }
								},
								fields: ['employee_id', 'effective_range'],
								limit: 10000
							}
						})).employee_contract.rows;
			const successors = new Set(
				following.map((row) => `${String(row.employee_id)}/${String(row.effective_range.from)}`)
			);
			return {
				sets: changes.map(({ after, set }, index) => {
					const group = groups[index];
					return group == null || after.pay_group_id != null
						? set
						: { ...set, pay_group_id: idOf('pay_group', group) };
				}),
				// sealing, voiding or moving a version over paid periods amends them: the next run works each out again
				on_approved: yield* amendmentsFor(
					ctx.query,
					changes.flatMap((change) =>
						reachOf(change, (day) =>
							successors.has(
								`${String(change.before.employee_id)}/${DateTime.formatIsoDateUtc(DateTime.add(DateTime.makeUnsafe(day), { days: 1 }))}`
							)
						).flatMap(({ effective_range }) => {
							const employee = String(change.before.employee_id);
							const touched = { employee, from: effective_range.from, to: effective_range.to };
							// a version sealed the day after another ended takes the exit away from that last day: a
							// payslip that settled it is worked out again
							const before = DateTime.formatIsoDateUtc(
								DateTime.add(DateTime.makeUnsafe(effective_range.from), { days: -1 })
							);
							return change.before.status !== 'SEALED' && change.set.status === 'SEALED'
								? [touched, { employee, from: before, to: before, soft: true }]
								: [touched];
						})
					)
				)
			};
		},
		effect: function* (changes, ctx) {
			// sealing is a transition, not a fresh create: create-only effects read it as their own event
			const newlySealed = changes.filter(
				({ before, after }) => before.status !== 'SEALED' && after.status === 'SEALED'
			);
			if (newlySealed.length > 0)
				yield* tap(
					ctx,
					'seal',
					'employee_contract',
					newlySealed.map(({ after }) => ({ after }))
				);
			// only a write that moves the chain can make, move or cancel an exit
			yield* raiseExits(
				ctx,
				changes.filter((change) => change.changed('status', 'entity_id', 'effective_range'))
			);
			const sealed = changes.filter(({ after }) => after.status === 'SEALED');
			if (sealed.length > 0)
				yield* ctx.schedule('ledger', {
					employees: [...new Set(sealed.map(({ after }) => after.employee_id))]
				});
			yield* tap(ctx, 'update', 'employee_contract', changes);
		}
	}
});
