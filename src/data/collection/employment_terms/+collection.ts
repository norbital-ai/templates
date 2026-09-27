import { collection, type Id } from '@norbital-ai/bolt';
import { readRange } from '../../../lib/payroll/run/effective.js';
import { consumedTermsThrough, contractBindingFault } from '../../../lib/employment-contract.js';
import { termsSummary } from '../../../lib/derived-titles.js';
import { dateKey } from '../../../lib/iso-day.js';
import { stableJson } from '../../../lib/jurisdiction_settings.js';

/** Terms that supplied consumed contract history are retained (the delete guard). */
const terms = collection('employment_terms', {
	read: { fields: 'all' },
	create: {
		input: {
			columns: [
				'employment_id',
				'residency_status',
				'residency_since',
				'currency',
				'base_salary',
				'minimum_wage_2025_region',
				'minimum_wage_2026_area_reclassified',
				'allowances',
				'pay_frequency',
				'work_classification',
				'statutory_work_category',
				'employment_type',
				'department',
				'job_title',
				'payroll_group',
				'paid_rest_days',
				'grade',
				'pass_type',
				'tax_residency',
				'notice_days',
				'ordinary_hours_per_week',
				'comparable_full_time_daily_hours',
				'comparable_full_time_presence',
				'shift_pattern_id',
				'effective_range'
			]
		}
	},
	update: {
		input: {
			columns: [
				'residency_status',
				'residency_since',
				'currency',
				'base_salary',
				'minimum_wage_2025_region',
				'minimum_wage_2026_area_reclassified',
				'allowances',
				'pay_frequency',
				'work_classification',
				'statutory_work_category',
				'employment_type',
				'department',
				'job_title',
				'payroll_group',
				'paid_rest_days',
				'grade',
				'pass_type',
				'tax_residency',
				'notice_days',
				'ordinary_hours_per_week',
				'comparable_full_time_daily_hours',
				'comparable_full_time_presence',
				'shift_pattern_id',
				'effective_range'
			]
		}
	},
	delete: { transform: true }
});
export default terms;

/**
 * Preserve consumed term history; amend an unconsumed future portion by closing its period and creating a successor
 * within the same contract (the `noOverlap` holds non-overlap on every write). Terms that supplied consumed history are
 * not deleted either. Every allowance the row lists names an allowance class, once per code. The title is derived.
 */
terms.transform(async (inputs, { existing, db, refuse }) => {
	const employmentIds = inputs.flatMap((input, index) => {
		const id =
			('$delete' in input ? undefined : input.employment_id) ?? existing[index]?.employment_id;
		return id == null ? [] : [id];
	});
	const classIds = [
		...new Set(
			inputs.flatMap((input) =>
				'$delete' in input ? [] : (input.allowances ?? []).map((row) => row.catalogue_id)
			)
		)
	];
	const [consumed, classes] = await Promise.all([
		consumedTermsThrough(db, employmentIds),
		classIds.length === 0
			? []
			: db
					.read('allowance_catalogue', {
						where: { id: { in: classIds as Id<'allowance_catalogue'>[] } },
						all: true
					})
					.then((page) => page.rows)
	]);
	const classCodeById = new Map(classes.map((row) => [String(row.id), row.code]));
	return inputs.map((input, index) => {
		const stored = existing[index];
		if ('$delete' in input) {
			const through = stored == null ? undefined : consumed.get(stored.employment_id);
			const start = readRange(stored?.effective_range)?.start;
			if (through != null && (start == null || dateKey(start) <= through))
				refuse(
					`Employment terms through ${through} are consumed and supplied payroll history; they are kept.`
				);
			return input;
		}
		const binding = contractBindingFault(input, stored);
		if (binding != null) refuse(binding, { field: 'employment_id' });
		const employmentId = (input.employment_id ?? stored?.employment_id)!;
		// A class is one per code across the lineage's versions: two rows naming the same class under two versions'
		// ids would price it twice.
		const listed = new Set<string>();
		for (const allowance of input.allowances ?? []) {
			const code = classCodeById.get(allowance.catalogue_id);
			if (code == null)
				refuse('An allowance these terms list names no allowance class.', { field: 'allowances' });
			if (listed.has(code!))
				refuse(`These terms list allowance ${code} twice.`, { field: 'allowances' });
			listed.add(code!);
		}
		const row = { ...stored, ...input };
		const derived = { ...input, summary: termsSummary(row) };
		const range = readRange(row.effective_range);
		if (!range || (range.end != null && dateKey(range.end) < dateKey(range.start)))
			refuse('Employment terms need an ordered inclusive effective range.', {
				field: 'effective_range'
			});
		const through = consumed.get(employmentId);
		if (through == null) return derived;
		const prior = stored == null ? null : readRange(stored.effective_range);
		if (prior == null || dateKey(prior.start) > through) {
			if (dateKey(range!.start) <= through)
				refuse(
					`Employment terms through ${through} are consumed. A successor must start later; historical gaps cannot be filled.`,
					{ field: 'effective_range' }
				);
			return derived;
		}
		const changedFacts = Object.entries(input).some(
			([key, value]) =>
				key !== 'effective_range' &&
				stableJson(value) !== stableJson(stored![key as keyof typeof stored])
		);
		if (changedFacts || dateKey(range!.start) !== dateKey(prior.start))
			refuse(
				`Employment terms through ${through} are consumed. Keep their facts and create a future successor.`
			);
		const priorEnd = prior.end == null ? null : dateKey(prior.end);
		const nextEnd = range!.end == null ? null : dateKey(range!.end);
		if (
			nextEnd !== priorEnd &&
			(nextEnd == null || nextEnd < through || (priorEnd != null && nextEnd > priorEnd))
		)
			refuse(
				`An amendment may only close the unconsumed portion after ${through}; consumed dates must remain covered.`,
				{ field: 'effective_range' }
			);
		return derived;
	});
});
