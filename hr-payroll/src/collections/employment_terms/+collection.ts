import { Effect } from 'effect';
import { defineCollection, refuse } from '@norbital-ai/bolt/authoring';
import model from './+model.js';
import { boundToContract, consumedTermsThrough } from '../../lib/employment-contract.js';
import { readRange } from '../payroll_runs/lib/effective.js';
import { dateKey } from '../../lib/iso-day.js';
import { stableJson } from '../../lib/jurisdiction_settings.js';

const columns = {
	employment_id: true,
	residency_status: true,
	residency_since: true,
	base_salary: true,
	allowances: true,
	pay_frequency: true,
	work_classification: true,
	statutory_work_category: true,
	employment_type: true,
	department: true,
	job_title: true,
	payroll_group: true,
	paid_rest_days: true,
	grade: true,
	pass_type: true,
	tax_residency: true,
	notice_days: true,
	ordinary_hours_per_week: true,
	shift_pattern_id: true,
	effective_range: true
} as const;

/**
 * Preserve consumed term history; amend an unconsumed future portion by closing its range and
 * creating a successor within the same contract. The model's exclusion constraint enforces
 * non-overlap on every write, including batches. Terms that supplied consumed history are not
 * deleted either: the delete grant (`peopleGrants`) reads the same consumption.
 *
 * The shift assignment is judged here too: every terms row names a pattern that still exists —
 * the pattern is where the contract's week lives — and every allowance the row lists names an
 * allowance class that exists (the list is a column, so no key holds it). One wave: consumption,
 * the named pattern rows and the named classes.
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
			const classIds = [
				...new Set(
					inputs.flatMap((input) => (input.allowances ?? []).map((row) => String(row.catalogue_id)))
				)
			];
			const [consumed, patterns, classes] = yield* Effect.all(
				[
					consumedTermsThrough(db, employmentIds),
					patternIds.length === 0
						? Effect.succeed([] as { id: string }[])
						: db.shift_patterns.findMany({
								where: { id: { in: patternIds } },
								columns: { id: true },
								limit: patternIds.length
							}),
					classIds.length === 0
						? Effect.succeed([] as { id: string; code: string }[])
						: db.allowance_catalogue.findMany({
								where: { id: { in: classIds } },
								columns: { id: true, code: true },
								limit: classIds.length
							})
				],
				{ concurrency: 'unbounded' }
			);
			const patternIdsFound = new Set(patterns.map((row) => row.id));
			const classCodeById = new Map(classes.map((row) => [row.id, row.code]));
			return inputs.map((input, index) => {
				const stored = existing[index];
				const employmentId = input.employment_id ?? stored?.employment_id;
				if (!employmentId) refuse('Employment terms must reference an employment contract.');
				const result = boundToContract({ ...input, employment_id: employmentId }, stored);
				const patternId = input.shift_pattern_id ?? stored?.shift_pattern_id ?? null;
				if (patternId == null)
					refuse(
						'Employment terms name a shift pattern: the pattern is where the contract’s week lives.'
					);
				if (!patternIdsFound.has(patternId))
					refuse('The shift pattern these terms name no longer exists.');
				// A class is one per code across the lineage's versions: two rows naming the same
				// class under two versions' ids would price it twice.
				const listedCodes = new Set<string>();
				for (const listed of input.allowances ?? []) {
					const code = classCodeById.get(String(listed.catalogue_id));
					if (code == null) refuse('An allowance these terms list names no allowance class.');
					if (listedCodes.has(code)) refuse(`These terms list allowance ${code} twice.`);
					listedCodes.add(code);
				}
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
