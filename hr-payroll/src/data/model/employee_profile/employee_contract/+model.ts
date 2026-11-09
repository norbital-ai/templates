import { addDays, PlainDate } from '@norbital-ai/std/date';
import { Effect } from 'effect';
import { model, type EffectCtx } from '@norbital-ai/bolt';
import { assertFactsHold } from '../../../../lib/ledger/service.js';
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

/** What a writer may set; the contract number, seal stamps and the derived label are server-owned. */
const columns = [
	'employee_id',
	'entity_id',
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
	'work_pass_valid_until',
	'reason',
	'status'
] as const;

/** A finalised run captures the contract terms it calculated; no change may reach that period afterwards. */
const capturedRun = Effect.fnUntraced(function* (
	read: Reader,
	rows: readonly {
		readonly entity_id: string;
		readonly effective_range: { readonly from: string; readonly to: string | null };
	}[]
) {
	if (rows.length === 0) return null;
	const entityIds = [...new Set(rows.map((row) => row.entity_id))];
	const runs = yield* queryRows(read, {
		payroll_run: {
			where: { entity_id: { in: entityIds } },
			fields: ['id', 'entity_id', 'salary_coverage', 'run_number'],
			limit: 10000
		}
	});
	for (const row of rows) {
		const captured = runs.payroll_run?.find((run) => {
			const coverage = run.salary_coverage as { from?: string; to?: string | null } | null;
			if (coverage?.from == null || run.entity_id !== row.entity_id) return false;
			const to = coverage.to ?? null;
			return (
				row.effective_range.from <= (to ?? '9999-12-31') &&
				(row.effective_range.to === null || row.effective_range.to >= coverage.from)
			);
		});
		if (captured !== undefined)
			return `Payroll run ${String(captured.run_number)} already captured this period; the contract cannot change under it.`;
	}
	return null;
});

const MID_MONTH =
	'A contract changes from the first of a month. Date the event as it happened; the version starts on the first.';
const EXIT_ANSWERS =
	'A sealed contract adds its exit answers in the save that ends it or moves its end; the facts it holds change only by a new version.';
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
const SERVICE_AFTER_START =
	'Service begins on or before the contract starts; it never starts after the version that records it.';
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
): string | null => {
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
			return 'The agreed rate must be more than zero.';
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
				return 'The normal hours a day must be within the jurisdiction’s contract limits.';
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
				return 'The normal hours a week must be within the jurisdiction’s contract limits.';
		}
		const days = numberOf(terms.normal_days_per_week);
		if (days !== null) {
			const allowed = lookup.normal_days_per_week;
			if (Array.isArray(allowed) && !allowed.map(Number).includes(days))
				return 'The normal days a week must be one the jurisdiction allows.';
			const min = limit(['days_per_week_minimum', 'normal_days_per_week_minimum']);
			const max = limit(['days_per_week_maximum', 'normal_days_per_week_maximum']);
			if (days !== Math.trunc(days) || (min !== null && days < min) || (max !== null && days > max))
				return 'The normal days a week must be within the jurisdiction’s contract limits.';
		}
	}
	return null;
};
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
				return `Shift ${String(shift.code)} lasts ${Math.round((minutes / 60) * 100) / 100}h, longer than the contract's ${hours} normal hours per day.`;
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
			return `Choose one of the jurisdiction's statutory work categories.`;
		const regions = isJsonObject(version?.work_regions) ? Object.keys(version.work_regions) : [];
		const region = agreed.work_region;
		if (
			typeof region === 'string' &&
			region !== '' &&
			regions.length > 0 &&
			!regions.includes(region)
		)
			return `Choose one of the jurisdiction's declared work regions.`;
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
		const before = String(addDays(PlainDate(row.effective_range.from), -1));
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

/** Raise `exit` for what a write did to the chain; encashment follows every exit that stands. */
const raiseExits = Effect.fnUntraced(function* (
	ctx: EffectCtx,
	changes: Parameters<typeof exitsMoved>[1]
) {
	if (changes.length === 0) return;
	const exits = yield* exitsMoved(ctx.query, changes);
	if (exits.length === 0) return;
	yield* tap(
		ctx,
		'exit',
		{
			collection: 'employee_contract',
			ids: exits.map((exit) => String((exit.after ?? exit.before)?.id))
		},
		exits
	);
	const standing = exits.flatMap(({ after }) =>
		after === undefined ? [] : [idOf('employee_contract', after.id)]
	);
	if (standing.length > 0) yield* ctx.schedule('encashment', { employments: standing });
});

type Reach = {
	readonly entity_id: string;
	readonly effective_range: { readonly from: string; readonly to: string | null };
};
/** What an update reaches. A sealed version's terms stand, so only the days its new last day adds or takes away can move. */
const reachOf = ({
	before,
	set
}: {
	readonly before: Reach & { readonly status: string };
	readonly set: Partial<Reach>;
}): readonly Reach[] => {
	const next = { ...before, ...set };
	if (before.status !== 'SEALED') return [next];
	const was = before.effective_range.to;
	const now = next.effective_range.to;
	if (was === now) return [];
	const earlier = was === null || (now !== null && now < was) ? now : was;
	if (earlier === null) return [];
	const later = was === null || now === null ? null : was < now ? now : was;
	return [
		{
			...next,
			effective_range: { from: String(addDays(PlainDate(earlier), 1)), to: later }
		}
	];
};

export default model('employee_contract', {
	description:
		'Sealed employment terms. A dated replacement changes future terms; consumed historical terms remain protected.',
	// a reference to a contract reads only its own fields: the person's name shows where the profile is read beside it
	record_label:
		"has(record.employee_id.name) ? record.employee_id.name + ' · ' + record.employee_number : record.employee_number",
	// found by its number, or by the person's own search text
	search: { text: ['employee_number', 'employee_id'] },
	fields: {
		employee_id: {
			kind: 'ref',
			to: 'employee_profile',
			inverse: 'employee_contract'
		},
		entity_id: { kind: 'ref', to: 'entity', inverse: 'employee_contract' },
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
			default: 'EMPLOYEE',
			help: 'The contracted role. PAYEE is paid without employment (a commission agent), outside the headcount and separations.'
		},
		status: {
			kind: 'state',
			initial: 'DRAFT',
			states: {
				DRAFT: { to: ['SEALED'], edit: 'all' },
				SEALED: {
					to: ['VOID'],
					edit: [
						'effective_range',
						'final_pay_due_on',
						'reason',
						'exit_ground',
						// only the exit answers it states in the save that ends it: `statesExitAnswers`
						'employee_extension_data',
						'work_pass_valid_until'
					]
				},
				VOID: { to: [], edit: 'none' }
			}
		},
		effective_range: {
			kind: 'period',
			of: 'date',
			help: 'The dates this agreement applies. A replacement contract continues employment; ending it records a reason.'
		},
		service_started_on: {
			kind: 'date',
			optional: true,
			help: 'Only for service credited from elsewhere. Service is otherwise worked out from the stints under this jurisdiction: the current unbroken one, or every one, rehires included, where the profile counts every stint.'
		},
		signed_contract_period: { kind: 'period', of: 'date', optional: true },
		terms: {
			kind: 'object',
			fields: {
				signed_on: {
					kind: 'date',
					optional: true,
					help: 'The actual date this employment agreement was signed.'
				},
				probation_period: {
					kind: 'period',
					of: 'date',
					optional: true,
					help: 'The original agreed probation dates. Salary amendments retain these dates; they do not start another probation.'
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
					min: 0,
					help: 'The ordinary hours of one working day. Every overtime, leave and statutory hour reads it.'
				},
				normal_hours_per_week: {
					kind: 'number',
					min: 0,
					help: 'The ordinary hours of one working week.'
				},
				normal_days_per_week: {
					kind: 'number',
					min: 0,
					max: 7,
					help: 'The ordinary working days of one week.'
				},
				employer_bears_income_tax: {
					kind: 'bool',
					optional: true,
					help: 'The agreement makes the employer bear the employee’s income tax. The jurisdiction formula determines any required gross-up.'
				},
				employee_borne_tax_items: {
					kind: 'list',
					of: { kind: 'text' },
					optional: true,
					help: 'Where the employer bears the income tax: the agreed allowances whose tax the employee still pays, at their own rate.'
				},
				job_title: { kind: 'text', optional: true },
				department: { kind: 'text', optional: true },
				statutory_work_category: { kind: 'text', optional: true },
				work_classification: { kind: 'text', optional: true },
				residency_status: { kind: 'text', optional: true },
				work_authorisation_category: { kind: 'text', optional: true },
				work_region: {
					kind: 'text',
					optional: true,
					help: 'The worksite region key the jurisdiction minimum-wage tables use, where it differs from the employer region.'
				},
				worksite: {
					kind: 'text',
					optional: true,
					help: 'The establishment or site the person works at, where the law applies thresholds by site.'
				},
				shift_pattern_id: { kind: 'id', of: 'shift_pattern', optional: true },
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
					optional: true,
					help: 'An agreed contractual limit for carrying annual leave into the next leave year.'
				},
				wage_payment_method: {
					kind: 'enum',
					values: ['BANK', 'CASH', 'CHEQUE', 'DIGITAL'],
					optional: true
				},
				allowances: {
					kind: 'record',
					optional: true,
					help: 'The agreed allowances, keyed by the catalog code; the catalog row carries how each behaves.',
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
				nationality: { kind: 'text', optional: true, help: 'ISO 3166-1 alpha-2 country code.' },
				birth_city: { kind: 'text', optional: true },
				passport_number: { kind: 'text', optional: true }
			},
			optional: true,
			label: 'Person details'
		},
		events: {
			kind: 'list',
			optional: true,
			help: 'Dated statutory events on this contract: illness, bereavement, marriage, work injury, confinement and similar. A child is a `family` member; termination is the contract status and reason.',
			of: {
				kind: 'object',
				fields: {
					kind: { kind: 'text' },
					on: { kind: 'date' },
					opened_on: { kind: 'date', optional: true },
					ended_on: { kind: 'date', optional: true },
					allocated_days: { kind: 'int', optional: true }
				}
			}
		},
		family: {
			kind: 'list',
			optional: true,
			help: "The person's family. Every count or flag a scheme reads (dependants, a spouse's income, births) is worked out from this list. A child's `allocations` are HR's approved leave days for that child, keyed by leave code.",
			of: {
				kind: 'object',
				fields: {
					relation: { kind: 'enum', values: ['CHILD', 'SPOUSE', 'PARENT'] },
					born_on: { kind: 'date', optional: true },
					expected_on: { kind: 'date', optional: true },
					has_income: { kind: 'bool', optional: true },
					disabled: { kind: 'bool', optional: true },
					studying: { kind: 'bool', optional: true },
					allocations: { kind: 'record', optional: true, of: { kind: 'number', min: 0 } }
				}
			}
		},
		bank: { kind: 'custom', of: 'bank', optional: true },
		final_pay_due_on: {
			kind: 'date',
			optional: true,
			help: 'The actual contractual date the final settlement becomes payable. This differs from the maximum statutory deadline and the run’s actual payment date.'
		},
		reason: {
			kind: 'text',
			optional: true,
			help: 'Why this record was voided or the employment ended.'
		},
		work_pass_valid_until: {
			kind: 'date',
			optional: true,
			help: 'The actual expiry date of the current work pass. Renewal changes it while the contract is sealed; the reminder key follows the date.'
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
			],
			help: 'The statutory ground for ending the employment. It decides severance eligibility and exit duties; reason carries the narrative.'
		},
		employee_extension_data: {
			kind: 'json',
			shape: { kind: 'record', of: { kind: 'json' } },
			default: {},
			help: "The employee data the jurisdiction's employee extension schema declares."
		}
	},
	noOverlap: [
		{
			key: ['employee_id'],
			period: 'effective_range',
			where: { status: { eq: 'SEALED' } }
		}
	],
	read: {
		employee_contract: { fields: 'all' },
		'employee_contract.employee_id': { fields: 'all' },
		'employee_contract.employee_id.employee_contract': { fields: 'all' },
		'employee_contract.employee_id.employee_contract.entity_id': { fields: 'all' },
		'employee_contract.entity_id': { fields: 'all' },
		'employee_contract.leave_catalog_entry': { fields: 'all' }
	},
	outputs: {
		kiosk: {
			employee_contract: {
				fields: [
					'employee_id',
					'entity_id',
					'employee_number',
					'effective_range',
					'terms',
					'status'
				]
			}
		}
	},
	create: {
		columns: { employee_contract: columns },
		filled: { employee_contract: ['employee_number'] },
		transform: function* (rows, ctx) {
			const captured = yield* capturedRun(ctx.db.query, rows);
			if (captured !== null) return yield* ctx.refuse(captured, { field: 'effective_range' });
			if (yield* startsMidMonth(ctx.db.query, rows))
				return yield* ctx.refuse(MID_MONTH, { field: 'effective_range' });
			if (startsAfterService(rows))
				return yield* ctx.refuse(SERVICE_AFTER_START, { field: 'service_started_on' });
			yield* validateRegistered(
				ctx.db.query,
				'employee_contract',
				'create',
				rows.map((row) => jsonObject(row))
			);
			const overlong = yield* overlongShift(ctx.db.query, rows);
			if (overlong !== null) return yield* ctx.refuse(overlong, { field: 'terms' });
			const written = rows.map((row) => jsonObject(row));
			yield* assertFactsHold(ctx.db.query, written);
			const lawRefusal = yield* assertLaw(ctx.db.query, written);
			if (lawRefusal !== null) return yield* ctx.refuse(lawRefusal, { field: 'terms' });
			const employeeIds = [...new Set(rows.map((row) => row.employee_id))];
			const held = yield* ctx.db.query({
				employee_contract: {
					where: { employee_id: { in: employeeIds } },
					fields: ['employee_id', 'employee_number'],
					limit: 10000
				}
			});
			const existing = yield* ctx.db.query({
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
			const reference = (value: number) => `HR-${String(value).padStart(4, '0')}`;
			return rows.map((row) => {
				if (row.employee_number != null && row.employee_number !== '') return row;
				const employee = String(row.employee_id);
				const heldNumber = numbers.get(employee);
				if (heldNumber != null && heldNumber !== '') return { ...row, employee_number: heldNumber };
				const assignedNumber = assigned.get(employee);
				if (assignedNumber !== undefined) return { ...row, employee_number: assignedNumber };
				const number = reference(next++);
				assigned.set(employee, number);
				return { ...row, employee_number: number };
			});
		}
	},
	update: {
		columns: { employee_contract: columns.filter((field) => field !== 'employee_number') },
		transform: function* (changes, ctx) {
			// a captured contract may still be voided; only substantive changes are barred
			const substantive = changes.filter(
				({ before, set }) => !(before.status === 'SEALED' && set.status === 'VOID')
			);
			const captured = yield* capturedRun(ctx.db.query, substantive.flatMap(reachOf));
			if (captured !== null) return yield* ctx.refuse(captured, { field: 'effective_range' });
			if (substantive.some(restatesFacts))
				return yield* ctx.refuse(EXIT_ANSWERS, { field: 'employee_extension_data' });
			const drafts = substantive.filter(({ before }) => before.status === 'DRAFT');
			if (
				yield* startsMidMonth(
					ctx.db.query,
					drafts.map(({ before, set }) => ({ ...before, ...set }))
				)
			)
				return yield* ctx.refuse(MID_MONTH, { field: 'effective_range' });
			const proposed = substantive.map((change) => jsonObject({ ...change.before, ...change.set }));
			if (startsAfterService(proposed))
				return yield* ctx.refuse(SERVICE_AFTER_START, { field: 'service_started_on' });
			yield* validateRegistered(ctx.db.query, 'employee_contract', 'update', proposed);
			const overlong = yield* overlongShift(ctx.db.query, proposed);
			if (overlong !== null) return yield* ctx.refuse(overlong, { field: 'terms' });
			yield* assertFactsHold(ctx.db.query, proposed);
			const lawRefusal = yield* assertLaw(ctx.db.query, proposed);
			if (lawRefusal !== null) return yield* ctx.refuse(lawRefusal, { field: 'terms' });
			for (const { set } of changes) {
				if (set.status === 'VOID' && !set.reason?.trim())
					return yield* ctx.refuse('Record why this contract is void.');
			}
			return changes.map(({ set }) => set);
		}
	},
	effect: {
		created: function* (rows, ctx) {
			yield* ctx.schedule('ledger', {
				employees: [...new Set(rows.map((row) => row.employee_id))]
			});
			yield* tap(
				ctx,
				'create',
				{ collection: 'employee_contract', ids: rows.map((r) => r.id) },
				rows.map((after) => ({ after }))
			);
			// a new version can cancel its predecessor's exit
			yield* raiseExits(
				ctx,
				rows.map((after) => ({ after }))
			);
		},
		updated: function* (changes, ctx) {
			// sealing is a transition, not a fresh create: create-only effects read it as their own event
			const newlySealed = changes.filter(
				({ before, after }) => before.status !== 'SEALED' && after.status === 'SEALED'
			);
			if (newlySealed.length > 0)
				yield* tap(
					ctx,
					'seal',
					{ collection: 'employee_contract', ids: newlySealed.map(({ after }) => after.id) },
					newlySealed.map(({ after }) => ({ after }))
				);
			// only a write that moves the chain can make, move or cancel an exit
			yield* raiseExits(
				ctx,
				changes.filter(
					({ before, after }) =>
						before.status !== after.status ||
						before.entity_id !== after.entity_id ||
						stableJson(before.effective_range) !== stableJson(after.effective_range)
				)
			);
			const sealed = changes.filter(({ after }) => after.status === 'SEALED');
			if (sealed.length > 0)
				yield* ctx.schedule('ledger', {
					employees: [...new Set(sealed.map(({ after }) => after.employee_id))]
				});
			yield* tap(
				ctx,
				'update',
				{ collection: 'employee_contract', ids: changes.map((c) => c.after.id) },
				changes
			);
		}
	}
});
