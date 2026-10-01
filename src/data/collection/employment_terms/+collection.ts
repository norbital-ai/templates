import { collection, type Id, type TransformCtx } from '@norbital-ai/bolt';
import { readRange } from '../../../lib/payroll/run/effective.js';
import { consumedTermsThrough, contractBindingFault } from '../../../lib/employment-contract.js';
import { termsSummary } from '../../../lib/derived-titles.js';
import { dateKey } from '../../../lib/iso-day.js';
import { governed, periodsOverlap, stableJson } from '../../../lib/jurisdiction_settings.js';
import { entityFactsFault, sealedLineages } from '../../../lib/entity-facts.js';
import { VOCABULARY_FIELDS } from '../../../lib/datatypes/payroll_settings.js';
import { worksiteFault } from '../worksites/lib/in-force.js';
import { employmentCheckIssues, refuseChecks } from '../../../lib/checks.js';

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
				'worksite',
				'worksite_sector',
				'worksite_id',
				'allowances',
				'pay_frequency',
				'work_classification',
				'statutory_work_category',
				'weather_dependent_piece',
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
				'comparable_full_time_daily_hours',
				'comparable_full_time_weekly_hours',
				'comparable_full_time_presence',
				'shift_pattern_id',
				'opening_attendance_through',
				'opening_unexcused_absence_days',
				'opening_attendance_reference',
				'facts',
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
				'worksite',
				'worksite_sector',
				'worksite_id',
				'allowances',
				'pay_frequency',
				'work_classification',
				'statutory_work_category',
				'weather_dependent_piece',
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
				'comparable_full_time_daily_hours',
				'comparable_full_time_weekly_hours',
				'comparable_full_time_presence',
				'shift_pattern_id',
				'opening_attendance_through',
				'opening_unexcused_absence_days',
				'opening_attendance_reference',
				'facts',
				'effective_range'
			]
		}
	},
	delete: { transform: true }
});
export default terms;

/** Each employment's settings lineage code, through its company. */
async function lineageOf(
	db: TransformCtx<'employment_terms'>['db'],
	employmentIds: readonly Id<'employments'>[]
): Promise<Map<string, string>> {
	const employments = (
		await db.read('employments', {
			where: { id: { in: [...employmentIds] } },
			select: { id: true, company_id: true },
			all: true
		})
	).rows;
	const companies = (
		await db.read('companies', {
			where: { id: { in: [...new Set(employments.map((row) => row.company_id))] } },
			select: { id: true, settings_code: true },
			all: true
		})
	).rows;
	const code = new Map(companies.map((row) => [String(row.id), row.settings_code]));
	return new Map(
		employments.map((row) => [String(row.id), code.get(String(row.company_id)) ?? ''])
	);
}

/**
 * Preserve consumed term history; amend an unconsumed future portion by closing its period and creating a successor
 * within the same contract (the `noOverlap` holds non-overlap on every write). Terms that supplied consumed history are
 * not deleted either. Every allowance the row lists names an allowance class, once per code. Each classification code
 * is one every sealed version of the lineage the terms' period reaches declares in `payroll.vocabularies` (a period
 * before the lineage's first version is judged by all of them). The title is derived.
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
	// Recorded inputs and classification codes are judged against the sealed versions of the entity's lineage.
	const coded = (input: (typeof inputs)[number]) =>
		'$delete' in input ? [] : VOCABULARY_FIELDS.filter((field) => (input[field] ?? '') !== '');
	const factEmployments = [
		...new Set(
			inputs.flatMap((input, index) => {
				if ('$delete' in input) return [];
				const id = input.employment_id ?? existing[index]?.employment_id;
				const judged = Object.keys(input.facts ?? {}).length > 0 || coded(input).length > 0;
				return id == null || !judged ? [] : [id];
			})
		)
	];
	const [consumed, classes, codeByEmployment] = await Promise.all([
		consumedTermsThrough(db, employmentIds),
		classIds.length === 0
			? []
			: db
					.read('allowance_catalogue', {
						where: { id: { in: classIds as Id<'allowance_catalogue'>[] } },
						all: true
					})
					.then((page) => page.rows),
		factEmployments.length === 0 ? new Map<string, string>() : lineageOf(db, factEmployments)
	]);
	const factCodes = [...new Set(codeByEmployment.values())];
	const versions =
		factCodes.length === 0
			? []
			: (
					await db.read('jurisdiction_settings', {
						...sealedLineages(factCodes),
						select: { code: true, effective_range: true, terms_facts: true, payroll: true }
					})
				).rows;
	// A named worksite belongs to the contract's company and is in force when the terms start.
	const siteIds = [
		...new Set(
			inputs.flatMap((input, index) => {
				const id = '$delete' in input ? null : { ...existing[index], ...input }.worksite_id;
				return id == null ? [] : [id];
			})
		)
	];
	const named =
		siteIds.length === 0
			? []
			: (await db.read('worksites', { where: { id: { in: siteIds } }, all: true })).rows;
	const [sites, siteCompany] =
		named.length === 0
			? [[], new Map<string, unknown>()]
			: await Promise.all([
					db
						.read('worksites', {
							where: {
								company_id: { in: [...new Set(named.map((row) => row.company_id))] },
								code: { in: [...new Set(named.map((row) => row.code))] }
							},
							all: true
						})
						.then((page) => page.rows),
					db
						.read('employments', {
							where: { id: { in: employmentIds } },
							select: { id: true, company_id: true },
							all: true
						})
						.then(
							(page) =>
								new Map<string, unknown>(page.rows.map((row) => [String(row.id), row.company_id]))
						)
				]);
	const classCodeById = new Map(classes.map((row) => [String(row.id), row.code]));
	// The version's stored checks at TERMS_CHANGE (E9), per created or revised row, over the batch's rows of its
	// contract as they will be written; `before.*` reads the stored terms the day before the change.
	const judged = inputs.flatMap((input, index): Record<string, unknown>[] =>
		'$delete' in input ? [] : [{ ...existing[index], ...input }]
	);
	const contracts =
		judged.length === 0
			? []
			: (
					await db.read('employments', {
						where: { id: { in: employmentIds } },
						select: { id: true, employee_id: true, company_id: true, employee_number: true },
						all: true
					})
				).rows;
	for (const row of judged) {
		const employment = contracts.find((contract) => contract.id === row.employment_id);
		const date = dateKey(readRange(row.effective_range)?.start);
		if (employment == null || date === '') continue;
		refuseChecks(
			await employmentCheckIssues(db, {
				at: 'TERMS_CHANGE',
				employment: {
					id: String(employment.id),
					employee_id: String(employment.employee_id),
					company_id: String(employment.company_id),
					employee_number: employment.employee_number
				},
				terms: judged.filter((other) => other.employment_id === row.employment_id),
				date
			}),
			(message) => refuse(message)
		);
	}
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
		if (input.facts != null && Object.keys(input.facts).length > 0) {
			const code = codeByEmployment.get(employmentId) ?? '';
			const fault = entityFactsFault(
				code,
				input.facts,
				versions
					.filter((version) => version.code === code)
					.flatMap((version) => version.terms_facts)
			);
			if (fault != null) refuse(fault, { field: 'facts' });
		}
		// The opening attendance declaration is one fact: its day, its count and its record together.
		const opening = [
			row.opening_attendance_through,
			row.opening_unexcused_absence_days,
			(row.opening_attendance_reference ?? '').trim() || null
		];
		if (opening.some((value) => value != null) && opening.some((value) => value == null))
			refuse(
				'An opening attendance declaration needs its day, its unexcused absence days and its reference.',
				{ field: 'opening_attendance_through' }
			);
		const derived = { ...input, summary: termsSummary(row) };
		const range = readRange(row.effective_range);
		if (!range || (range.end != null && dateKey(range.end) < dateKey(range.start)))
			refuse('Employment terms need an ordered inclusive effective range.', {
				field: 'effective_range'
			});
		if (row.worksite_id != null) {
			const fault = worksiteFault(
				sites,
				row.worksite_id,
				siteCompany.get(String(employmentId)),
				dateKey(range!.start)
			);
			if (fault != null) refuse(fault, { field: 'worksite_id' });
		}
		const fields = coded(input);
		if (fields.length > 0) {
			const code = codeByEmployment.get(employmentId) ?? '';
			const period = governed(row.effective_range)!;
			const lineage = versions.filter((version) => version.code === code);
			const reached = lineage.filter((version) => {
				const days = governed(version.effective_range);
				return days != null && periodsOverlap(days, period);
			});
			const governing = reached.length > 0 ? reached : lineage;
			if (governing.length === 0)
				refuse(`${code || 'This contract'} has no sealed settings version declaring its codes.`, {
					field: fields[0]!
				});
			for (const field of fields) {
				const value = String(input[field]);
				const undeclared = governing.some(
					(version) => !(version.payroll.vocabularies?.[field] ?? []).includes(value)
				);
				if (undeclared) refuse(`${code} does not declare ${value} as a ${field}.`, { field });
			}
		}
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
