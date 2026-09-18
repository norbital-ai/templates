import { Effect } from 'effect';
import { defineCollection, refuse } from '@norbital-ai/bolt/authoring';
import model from './+model.js';
import { boundToContract, consumedTermsThrough } from '../../lib/employment-contract.js';
import { readRange } from '../payroll_runs/lib/effective.js';
import { dateKey } from '../../lib/iso-day.js';
import { stableJson } from '../../lib/jurisdiction_settings.js';
import {
	shiftAssignmentRefusal,
	type ShiftPatternLike
} from '../../lib/scheduling/work-pattern.js';
import type { RosterCodeLike } from '../../lib/scheduling/roster-code.js';

const columns = {
	employment_id: true,
	residency_status: true,
	residency_since: true,
	base_salary: true,
	pay_frequency: true,
	work_classification: true,
	statutory_work_category: true,
	employment_type: true,
	department: true,
	job_title: true,
	payroll_group: true,
	grade: true,
	agreed_days_per_week: true,
	ordinary_hours_per_week: true,
	shift_pattern_id: true,
	effective_range: true
} as const;

const LIMIT = 20_000;

/**
 * Preserve consumed term history; amend an unconsumed future portion by closing its range and
 * creating a successor within the same contract. The model's exclusion constraint enforces
 * non-overlap on every write, including batches. Terms that supplied consumed history are not
 * deleted either: the delete grant (`peopleGrants`) reads the same consumption.
 *
 * The shift assignment is judged here too: `agreed_days_per_week` is 1–7, and a named cycle must
 * work that many days in each of its weeks. Two waves: consumption and the named pattern rows,
 * then the roster codes those cycles name.
 */
export default defineCollection({
	model,
	create: { input: { columns } },
	update: { input: { columns } },
	delete: {},
	transform: (inputs, { existing, db }) =>
		Effect.gen(function* () {
			const employmentIds = inputs.flatMap((input, index) => {
				const id = input.employment_id ?? existing[index]?.employment_id;
				return id == null ? [] : [id];
			});
			const patternIds = [
				...new Set(
					inputs.flatMap((input, index) => {
						const id = input.shift_pattern_id ?? existing[index]?.shift_pattern_id;
						return id == null ? [] : [id];
					})
				)
			];
			const [consumed, patterns] = yield* Effect.all(
				[
					consumedTermsThrough(db, employmentIds),
					patternIds.length === 0
						? Effect.succeed([] as ShiftPatternLike[])
						: db.shift_patterns.findMany({
								where: { id: { in: patternIds } },
								columns: { id: true, code: true, pattern: true, effective_range: true },
								limit: patternIds.length
							})
				],
				{ concurrency: 'unbounded' }
			);
			const patternById = new Map(patterns.map((row) => [row.id, row]));
			const codeIds = [
				...new Set(
					patterns.flatMap((row) =>
						'days' in row.pattern ? row.pattern.days.map((day) => day.roster_code_id) : []
					)
				)
			];
			const codes =
				codeIds.length === 0
					? []
					: yield* db.shift_definitions.findMany({
							where: { id: { in: codeIds } },
							columns: { id: true, code: true, variant: true },
							limit: LIMIT
						});
			const rosterCodeById = new Map<string, RosterCodeLike>(codes.map((row) => [row.id, row]));
			return inputs.map((input, index) => {
				const stored = existing[index];
				const employmentId = input.employment_id ?? stored?.employment_id;
				if (!employmentId) refuse('Employment terms must reference an employment contract.');
				const result = boundToContract({ ...input, employment_id: employmentId }, stored);
				const patternId = input.shift_pattern_id ?? stored?.shift_pattern_id ?? null;
				if (patternId != null && !patternById.has(patternId))
					refuse('The shift pattern these terms name no longer exists.');
				const unfit = shiftAssignmentRefusal({
					agreedDaysPerWeek: input.agreed_days_per_week ?? stored?.agreed_days_per_week,
					pattern: patternId == null ? null : (patternById.get(patternId) ?? null),
					rosterCodeById
				});
				if (unfit != null) refuse(unfit);
				const range = readRange(input.effective_range ?? stored?.effective_range);
				if (!range || (range.end != null && dateKey(range.end) < dateKey(range.start)))
					refuse('Employment terms need an ordered inclusive effective range.');
				const through = consumed.get(employmentId);
				if (through == null) return result;
				const prior = stored == null ? null : readRange(stored.effective_range);
				if (prior == null || dateKey(prior.start) > through) {
					if (dateKey(range.start) <= through)
						refuse(
							`Employment terms through ${through} are consumed. A successor must start later; historical gaps cannot be filled.`
						);
					return result;
				}
				const changedFacts = Object.entries(input).some(
					([key, value]) =>
						!['id', 'row_version', 'effective_range'].includes(key) &&
						stableJson(value) !== stableJson(Reflect.get(stored!, key))
				);
				if (changedFacts || dateKey(range.start) !== dateKey(prior.start))
					refuse(
						`Employment terms through ${through} are consumed. Keep their facts and create a future successor.`
					);
				const priorEnd = prior.end == null ? null : dateKey(prior.end);
				const nextEnd = range.end == null ? null : dateKey(range.end);
				if (
					nextEnd !== priorEnd &&
					(nextEnd == null || nextEnd < through || (priorEnd != null && nextEnd > priorEnd))
				)
					refuse(
						`An amendment may only close the unconsumed portion after ${through}; consumed dates must remain covered.`
					);
				return result;
			});
		})
});
