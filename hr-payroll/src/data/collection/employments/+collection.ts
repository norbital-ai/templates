import { collection, type Id } from '@norbital-ai/bolt';
import { coversDate, readRange } from '../../../lib/payroll/run/effective.js';
import { readAll } from '../../../lib/reads.js';
import { factValueFault, type FactKey } from '../../../lib/datatypes/fact_keys.js';
import {
	contractOverlapFault,
	contractReferenceFault,
	contractReferences
} from '../../../lib/employment-contract.js';
import { termsSummary } from '../../../lib/derived-titles.js';
import { dateKey } from '../../../lib/iso-day.js';
import { settingsInForce, stableJson } from '../../../lib/jurisdiction_settings.js';
import { entityFactsFault, sealedLineages } from '../../../lib/entity-facts.js';
import { factTables, lineageCodes } from '../../../lib/coded-fields.js';
import { readLeaveContext } from '../../../lib/leave/context.js';
import { departureFactsMissing } from '../../../lib/leave/exit-settlement.js';
import { employmentCheckIssues, refuseChecks } from '../../../lib/checks.js';

/** Contracts. A referenced contract is frozen and undeletable (the delete guard reads its references). */
const employments = collection('employments', {
	read: { fields: 'all' },
	create: {
		input: {
			columns: [
				'employee_id',
				'company_id',
				'employee_number',
				'bank',
				'effective_range',
				'prior_service_months',
				'exit_ground',
				'exit_facts',
				'comments'
			],
			with: {
				employment_terms: {
					create: {
						columns: [
							'residency_status',
							'residency_since',
							'currency',
							'base_salary',
							'worksite',
							'worksite_sector',
							'worksite_id',
							'allowances',
							'pay_frequency',
							'work_classification',
							'statutory_work_category',
							'employment_type',
							'department',
							'job_title',
							'payroll_group',
							'paid_rest_days',
							'proration',
							'grade',
							'pass_type',
							'tax_residency',
							'notice_days',
							'ordinary_hours_per_week',
							'shift_pattern_id',
							'facts',
							'effective_range'
						]
					}
				}
			}
		}
	},
	update: {
		input: {
			columns: [
				'employee_id',
				'company_id',
				'employee_number',
				'bank',
				'effective_range',
				'prior_service_months',
				'exit_ground',
				'exit_facts',
				'comments',
				// the departure settlement's stamps (leave_encashment_on_exit / _due), granted to their policy alone
				'encashment_due_on',
				'encashment_raised_at'
			]
		}
	},
	delete: { transform: true }
});
export default employments;

/** What a departed contract may still take, and what an open one may change without clearing its references. */
const DEPARTURE_NOTES = new Set(['comments', 'exit_ground', 'exit_facts']);

/** The stored table a departure's ground is a code of. */
const TERMINATION_GROUND = 'TERMINATION_GROUND';

const lastDayOf = (range: unknown) => {
	const end = readRange(range)?.end;
	return end == null ? null : dateKey(end);
};

/**
 * One contract per employee and entity on any date; every referenced contract is frozen; departure closes the range
 * (an end not yet passed may move earlier; any end may move later or be withdrawn until a payslip settles it) and only
 * its notes stay writable after; a departure deletes the rosters and work days after its last day in the same write,
 * refused while a payslip has consumed one; a paid final payroll fixes the departure inputs; a referenced contract
 * is never deleted (the delete guard reads the same references).
 */
employments.transform(async (inputs, { existing, db, refuse, today }) => {
	type Candidate = {
		id?: string;
		employee_id?: string | null;
		company_id?: string | null;
		effective_range?: unknown;
		exit_ground?: string | null;
		exit_facts?: Readonly<Record<string, unknown>> | null;
	};
	const candidates: Candidate[] = inputs.map((input, index) => ({
		...existing[index],
		...('$delete' in input ? {} : input)
	}));
	const changedKeys = (index: number): string[] => {
		const input = inputs[index]!;
		const stored = existing[index];
		if (stored == null || '$delete' in input) return [];
		return Object.entries(input)
			.filter(
				([key, value]) => stableJson(value) !== stableJson(stored[key as keyof typeof stored])
			)
			.map(([key]) => key);
	};
	const changedOrNew = (index: number, key: string) =>
		existing[index] == null ? !('$delete' in inputs[index]!) : changedKeys(index).includes(key);
	// An end not yet passed may move earlier (an early departure); that is not a reopening.
	const shortens = (index: number) => {
		const stored = existing[index];
		if (stored == null || '$delete' in inputs[index]!) return false;
		const was = readRange(stored.effective_range);
		const next = readRange(candidates[index]!.effective_range);
		return (
			was?.end != null &&
			next?.end != null &&
			dateKey(was.end) >= dateKey(today) &&
			dateKey(next.start) === dateKey(was.start) &&
			dateKey(next.end) < dateKey(was.end)
		);
	};
	// How a write moves the last day: set or earlier truncates the plan after it; later or withdrawn re-opens the
	// days after the old one. Either is refused while a payroll has consumed a day it releases.
	const moves = inputs.map((_, index) => {
		const stored = existing[index];
		if (stored == null || '$delete' in inputs[index]!) return null;
		const was = lastDayOf(stored.effective_range);
		const next = lastDayOf(candidates[index]!.effective_range);
		if (was === next) return null;
		return next != null && (was == null || next < was)
			? { id: stored.id, truncates: true as const, exit: next }
			: { id: stored.id, truncates: false as const, was: was! };
	});
	// A set end moved later or withdrawn, start unchanged: a departure corrected, not a contract reopened.
	const extendsEnd = (index: number) => {
		const move = moves[index];
		return (
			move != null &&
			!move.truncates &&
			dateKey(readRange(existing[index]!.effective_range)?.start) ===
				dateKey(readRange(candidates[index]!.effective_range)?.start)
		);
	};
	const moved = moves.flatMap((move) => (move == null ? [] : [move.id]));
	const truncating = moves.flatMap((move) => (move?.truncates ? [move] : []));
	const firstExit = truncating.map((move) => move.exit).toSorted()[0] ?? '';
	const declared = candidates.filter(
		(row, index) => !('$delete' in inputs[index]!) && Object.keys(row.exit_facts ?? {}).length > 0
	);
	// A ground being recorded or revised is judged against the table in force on the last day.
	const grounded = candidates.flatMap((row, index) =>
		(row.exit_ground ?? '').trim() !== '' && changedOrNew(index, 'exit_ground') ? [row] : []
	);
	// A departure being recorded or revised: its owed declarations are judged against the leaver on the last day.
	const leaving = candidates.flatMap((row, index) =>
		lastDayOf(row.effective_range) != null &&
		changedKeys(index).some(
			(key) => key === 'exit_ground' || key === 'exit_facts' || key === 'effective_range'
		)
			? [index]
			: []
	);
	const departures = inputs.flatMap((_, index) =>
		changedKeys(index).some((key) => key === 'exit_ground' || key === 'exit_facts')
			? [existing[index]!.id]
			: []
	);
	const changing = inputs.flatMap((input, index) => {
		const stored = existing[index];
		if (stored == null) return [];
		if ('$delete' in input) return [stored.id];
		const changed = changedKeys(index);
		const closed = lastDayOf(stored.effective_range) != null;
		const free = changed.every(
			(key) =>
				DEPARTURE_NOTES.has(key) ||
				(key === 'effective_range' && (!closed || shortens(index) || extendsEnd(index)))
		);
		return changed.length > 0 && !free ? [stored.id] : [];
	});
	const people = [
		...new Set(candidates.flatMap((row) => (row.employee_id == null ? [] : [row.employee_id])))
	];
	// A new contract's first terms arrive nested: their declared inputs are judged here.
	const nestedTermsFacts = (index: number) => {
		const input = inputs[index]!;
		return existing[index] != null || '$delete' in input
			? []
			: (input.employment_terms?.create ?? []).flatMap((terms) =>
					Object.keys(terms.facts ?? {}).length === 0 ? [] : [terms.facts!]
				);
	};
	const nested = candidates.filter((_, index) => nestedTermsFacts(index).length > 0);
	const entityIds = [
		...new Set(
			[...declared, ...grounded, ...nested, ...leaving.map((index) => candidates[index]!)].flatMap(
				(row) => (row.company_id == null ? [] : [row.company_id])
			)
		)
	];
	// One wave: the entities whose law judges departures, paid finals, the person's other contracts, and what
	// references the contracts being changed; then the lineages of those entities.
	const [companies, paid, others, references, slips, planned, rostered] = await Promise.all([
		entityIds.length === 0
			? []
			: db
					.read('companies', { where: { id: { in: entityIds as Id<'companies'>[] } }, all: true })
					.then((page) => page.rows),
		departures.length === 0
			? []
			: db
					.read('payslips', {
						where: { employment_id: { in: departures }, status: { eq: 'PAID' } },
						all: true
					})
					.then((page) => page.rows),
		people.length === 0
			? []
			: db
					.read('employments', {
						where: { employee_id: { in: people as Id<'employees'>[] } },
						all: true
					})
					.then((page) => page.rows),
		contractReferences(db, changing),
		moved.length === 0
			? []
			: db
					.read('payslips', {
						where: { employment_id: { in: moved as Id<'employments'>[] } },
						all: true
					})
					.then((page) => page.rows),
		truncating.length === 0
			? []
			: db
					.read('work_days', {
						where: {
							employment_id: { in: truncating.map((move) => move.id) as Id<'employments'>[] },
							work_date: { gt: firstExit as `${number}-${number}-${number}` }
						},
						all: true
					})
					.then((page) => page.rows),
		truncating.length === 0
			? []
			: db
					.read('rosters', {
						where: {
							employment_id: { in: truncating.map((move) => move.id) as Id<'employments'>[] },
							period: { gt: firstExit.slice(0, 7) }
						},
						all: true
					})
					.then((page) => page.rows)
	]);
	// The first payslip that consumed a day the move releases: past a new last day, or through an old one.
	const consumed = moves.flatMap((move) => {
		if (move == null) return [];
		const mine = slips.filter((slip) => slip.employment_id === move.id);
		const through = (slip: (typeof slips)[number]) => dateKey(String(slip.terms_through));
		const slip = move.truncates
			? (mine.find((row) => through(row) > move.exit) ??
				mine.find((row) =>
					planned.some(
						(day) =>
							day.payslip_id === row.id &&
							day.employment_id === move.id &&
							dateKey(String(day.work_date)) > move.exit
					)
				))
			: mine.find((row) => through(row) >= move.was);
		return slip == null ? [] : [{ move, slip }];
	});
	if (consumed.length > 0) {
		const [{ move, slip }] = consumed as [(typeof consumed)[number]];
		const run = await db.get('payroll_runs', slip.payroll_run_id as Id<'payroll_runs'>);
		const named = `Payslip ${slip.id} in the ${run?.period ?? ''} ${run?.kind ?? ''} payroll run #${run?.sequence ?? ''} took this contract into account through ${dateKey(String(slip.terms_through))}`;
		const paidSlip = slip.status === 'PAID';
		refuse(
			move.truncates
				? `${named}, after the new last day ${move.exit}. ${paidSlip ? `It is paid, so it is kept: record a last day on or after ${dateKey(String(slip.terms_through))}, and recover any overpayment in a later correction run.` : 'Delete that unpaid run first, then record the departure; the next run recalculates it.'}`
				: `${named}, so it settled the departure on ${move.was}. ${paidSlip ? 'It is paid, so the departure stands: create a new contract for a rehire.' : 'Delete that unpaid run first, then move or withdraw the departure.'}`,
			{ field: 'effective_range' }
		);
	}
	const codes = [...new Set(companies.map((row) => row.settings_code))];
	const versions =
		codes.length === 0 ? [] : (await db.read('jurisdiction_settings', sealedLineages(codes))).rows;
	const codesOf =
		nested.length === 0
			? () => undefined
			: await lineageCodes(
					db,
					versions,
					factTables(versions.flatMap((version) => version.terms_facts ?? []))
				);

	const groundVersions = grounded.flatMap((row) => {
		const lastDay = lastDayOf(row.effective_range);
		if (lastDay == null)
			return refuse('A departure ground requires a last working day.', { field: 'exit_ground' });
		const code = companies.find((company) => company.id === row.company_id)?.settings_code;
		const version = code == null ? null : settingsInForce(versions, code, lastDay);
		if (version == null)
			return refuse(
				'A departure ground requires a sealed jurisdiction version on the last working day.',
				{ field: 'exit_ground' }
			);
		return [{ row, lastDay, code: code!, version }];
	});
	const grounds =
		groundVersions.length === 0
			? []
			: await readAll<{ settings_id: string; code: string; effective_range: unknown }>(
					db,
					'reference_rows',
					{
						settings_id: { in: [...new Set(groundVersions.map((entry) => entry.version.id))] },
						table: { eq: TERMINATION_GROUND },
						code: { in: [...new Set(groundVersions.map((entry) => entry.row.exit_ground!.trim()))] }
					},
					undefined,
					{ settings_id: true, code: true, effective_range: true }
				);
	for (const { row, lastDay, code, version } of groundVersions) {
		const ground = row.exit_ground!.trim();
		if (
			!grounds.some(
				(entry) =>
					entry.settings_id === version.id &&
					entry.code === ground &&
					coversDate(entry.effective_range, lastDay)
			)
		)
			refuse(`${code} has no departure ground ${ground} in force on ${lastDay}.`, {
				field: 'exit_ground'
			});
	}
	for (const row of declared) {
		const lastDay = lastDayOf(row.effective_range);
		if (lastDay == null)
			refuse('Departure inputs require a last working day.', { field: 'exit_facts' });
		const code = companies.find((company) => company.id === row.company_id)?.settings_code;
		const version = code == null ? null : settingsInForce(versions, code, lastDay!);
		if (version == null)
			return refuse(
				'Departure inputs require a sealed jurisdiction version on the last working day.',
				{
					field: 'exit_facts'
				}
			);
		for (const [key, value] of Object.entries(row.exit_facts ?? {})) {
			const field = (version.exit_facts as readonly FactKey[]).find(
				(declaration) => declaration.key === key
			);
			if (field == null)
				refuse(`${code} does not declare the departure input ${key}.`, { field: 'exit_facts' });
			const fault = factValueFault(field!, value);
			if (fault != null) refuse(fault, { field: 'exit_facts' });
		}
	}
	for (const index of leaving) {
		const row = candidates[index]!;
		const lastDay = lastDayOf(row.effective_range)!;
		const code = companies.find((company) => company.id === row.company_id)?.settings_code;
		const owed = (
			(code == null ? null : settingsInForce(versions, code, lastDay))?.exit_facts as
				readonly FactKey[] | undefined
		)?.some((field) => field.required || field.required_when != null);
		if (owed !== true) continue;
		const context = await readLeaveContext(db, [row.id!]);
		const missing = departureFactsMissing(
			{
				...context,
				employments: context.employments.map((stored) =>
					stored.id === row.id
						? {
								...stored,
								effective_range: readRange(row.effective_range),
								exit_ground: row.exit_ground ?? null,
								exit_facts: row.exit_facts ?? null
							}
						: stored
				)
			},
			row.id!,
			lastDay
		);
		if (missing != null) refuse(missing, { field: 'exit_facts' });
	}
	for (const [index, row] of candidates.entries()) {
		if ('$delete' in inputs[index]!) continue;
		const lastDay = lastDayOf(row.effective_range);
		if (
			lastDay != null &&
			paid.some(
				(slip) => slip.employment_id === row.id && dateKey(String(slip.terms_through)) >= lastDay
			)
		)
			refuse(
				'Departure calculation inputs are fixed by paid final payroll. Record a separate correction.'
			);
		const peers = [
			...candidates.slice(index + 1).filter((_, at) => !('$delete' in inputs[index + 1 + at]!)),
			...others.filter(
				(other) => other.id !== row.id && !candidates.some((candidate) => candidate.id === other.id)
			)
		];
		const overlap = contractOverlapFault(row, peers);
		if (overlap != null) refuse(overlap, { field: 'effective_range' });
	}
	// The version's stored checks (E9): a hire at EMPLOYMENT_START, with its nested first terms; a departure
	// being recorded or moved at EXIT, over the merged row (an open EXIT-blocking duty refuses it too).
	for (const [index, row] of candidates.entries()) {
		const input = inputs[index]!;
		if ('$delete' in input) continue;
		if (existing[index] == null) {
			const date = dateKey(readRange(row.effective_range)?.start);
			if (date === '') continue;
			refuseChecks(
				await employmentCheckIssues(db, {
					at: 'EMPLOYMENT_START',
					employment: row,
					terms: (input.employment_terms?.create ?? []) as readonly Readonly<
						Record<string, unknown>
					>[],
					date
				}),
				refuse
			);
		} else if (leaving.includes(index))
			refuseChecks(
				await employmentCheckIssues(db, {
					at: 'EXIT',
					employment: row,
					date: lastDayOf(row.effective_range)!
				}),
				refuse
			);
	}
	return inputs.map((input, index) => {
		const stored = existing[index];
		// A contract's first terms arrive nested; their own transform does not run (rule 27), so their derived
		// fields are filled, and their declared inputs judged, here.
		if (stored == null) {
			const code =
				companies.find((company) => company.id === candidates[index]!.company_id)?.settings_code ??
				'';
			for (const facts of nestedTermsFacts(index)) {
				const fault = entityFactsFault(
					code,
					facts,
					versions
						.filter((version) => version.code === code)
						.flatMap((version) => version.terms_facts ?? []),
					codesOf(code)
				);
				if (fault != null) refuse(fault);
			}
			return '$delete' in input || input.employment_terms?.create == null
				? input
				: {
						...input,
						employment_terms: {
							...input.employment_terms,
							create: input.employment_terms.create.map((terms) => ({
								...terms,
								summary: termsSummary(terms)
							}))
						}
					};
		}
		if (
			!('$delete' in input) &&
			lastDayOf(stored.effective_range) != null &&
			changedKeys(index).includes('effective_range') &&
			!shortens(index) &&
			!extendsEnd(index)
		)
			// A start never moves and a passed end never moves earlier; a rehire is a new contract.
			refuse(
				'A closed contract keeps its start, and a passed end never moves earlier; an end may move later or be withdrawn until payroll settles it. Create a new contract for a rehire.',
				{ field: 'effective_range' }
			);
		if (changing.includes(stored.id)) {
			const fault = contractReferenceFault(references, stored.id);
			if (fault != null) refuse(fault);
		}
		const move = moves[index];
		if (move == null || '$delete' in input) return input;
		// A departure takes the plan after its last day with it, in the same write: no orphan rostered day survives
		// it (the guard above refused any day a payroll consumed). A withdrawn one is no longer due for settlement.
		if (!move.truncates)
			return lastDayOf(candidates[index]!.effective_range) == null &&
				stored.encashment_due_on != null
				? { ...input, encashment_due_on: null }
				: input;
		const days = planned.flatMap((day) =>
			day.employment_id === move.id && dateKey(String(day.work_date)) > move.exit ? [day.id] : []
		);
		const months = rostered.flatMap((roster) =>
			roster.employment_id === move.id && roster.period > move.exit.slice(0, 7) ? [roster.id] : []
		);
		return {
			...input,
			...(days.length === 0 ? {} : { work_days: { delete: days } }),
			...(months.length === 0 ? {} : { rosters: { delete: months } })
		};
	});
});
