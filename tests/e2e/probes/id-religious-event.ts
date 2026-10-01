import {
	officeWeek,
	register,
	type ProbeInput,
	type Row,
	type SavedExpectation
} from '../payroll-probe.ts';

const source =
	'UU 13/2003 art.93(2)(e); PP 36/2021 art.40(3), once with the same employer: https://jdih.kemnaker.go.id/asset/data_puu/PP362021.pdf';
const company: Row = {
	region: 'Provinsi DKI Jakarta',
	risk_class: 'I',
	facts: { enterprise_size_class: 'OTHER' }
};
function worker(rehire = false): ProbeInput[] {
	return [
		...officeWeek('2000-01-03'),
		{
			collection: 'employees',
			ref: 'person',
			values: {
				name: 'Synthetic religious-duty worker',
				date_of_birth: '1995-05-10',
				gender: 'MALE',
				marital_status: 'SINGLE',
				spouse_status: 'NONE',
				dependents_count: 0,
				nationality: 'Indonesian'
			}
		},
		{
			collection: 'employments',
			ref: 'job',
			values: {
				employee_id: '@person',
				company_id: '@company',
				employee_number: 'ID-DUTY',
				effective_range: { from: rehire ? '2026-02-01' : '2025-12-01', to: null }
			}
		},
		terms('job', '@week', rehire ? '2026-02-01' : '2025-12-01', null),
		{
			collection: 'employment_statutory_facts',
			values: {
				employee_id: '@person',
				statutory_contribution_id: '@law:statutory_contributions:PPH21',
				effective_range: { from: '2025-12-01', to: null },
				status: {
					kind: 'REGISTERED',
					reference_number: 'SYNTHETIC-NPWP',
					elections: {
						recipient_class: 'REGULAR_EMPLOYEE',
						ptkp_marital_status: 'SINGLE',
						ptkp_dependants: 0,
						no_tax_id: false
					}
				}
			}
		}
	];
}
function terms(job: string, week: string, from: string, to: string | null): ProbeInput {
	return {
		collection: 'employment_terms',
		values: {
			employment_id: `@${job}`,
			residency_status: 'CITIZEN',
			tax_residency: 'RESIDENT',
			currency: 'IDR',
			base_salary: 10_000_000,
			pay_frequency: 'MONTHLY',
			work_classification: 'EA_COVERED',
			statutory_work_category: 'NON_MANUAL',
			employment_type: 'PERMANENT',
			worksite: 'Provinsi DKI Jakarta',
			worksite_sector: '62019',
			facts: { worksite_sector_edition: '2020' },
			shift_pattern_id: week,
			effective_range: { from, to }
		}
	};
}
function duty(
	ref: string,
	day: string,
	eventDate: string,
	job = 'job',
	refused?: string
): ProbeInput {
	return {
		collection: 'leave_entries',
		ref,
		values: {
			employment_id: `@${job}`,
			catalogue_id: `@law:leave_catalogue:RELIGIOUS_DUTY_LEAVE@${day}`,
			reference: ref,
			from_date: day,
			to_date: day,
			facts: { event_kind: 'RELIGIOUS_DUTY', event_date: eventDate },
			reason: 'One required religious duty, recorded as approved blocks'
		},
		...(refused == null ? {} : { refused })
	};
}
const refusal = '1 events with this employer; this would be event 2';
const gross: SavedExpectation = {
	collection: 'payslips',
	where: { employment_id: '@job', payroll_run_id: '@run' },
	rows: [{ gross: 10_000_000 }]
};
register(
	{
		id: 'ID-38-split-and-refuse',
		profile: 'ID',
		period: '2026-02',
		company,
		description:
			'Three split blocks of one dated religious duty save; a distinct second duty refuses and creates no row.',
		citation: [source],
		inputs: [
			...worker(),
			duty('first', '2026-02-02', '2026-02-02'),
			duty('second', '2026-02-03', '2026-02-02'),
			duty('third', '2026-02-04', '2026-02-02'),
			duty('refused-duty', '2026-02-05', '2026-02-05', 'job', refusal)
		],
		expected: [],
		saved: [
			gross,
			{
				collection: 'leave_entries',
				where: { employment_id: '@job' },
				select: { reference: true, facts: true, days: true },
				rows: ['first', 'second', 'third'].map((reference) => ({
					reference,
					days: 1,
					'facts.event_date': '2026-02-02',
					'facts.event_kind': 'RELIGIOUS_DUTY'
				}))
			}
		]
	},
	{
		id: 'ID-38-reverse-and-replace',
		profile: 'ID',
		period: '2026-02',
		company,
		description:
			'Reversing the sole duty block releases the once-only event; a different duty then saves and is paid.',
		citation: [source],
		inputs: [
			...worker(),
			duty('first', '2026-02-02', '2026-02-02'),
			{
				collection: 'leave_entries',
				ref: 'reverse',
				values: {
					employment_id: '@job',
					catalogue_id: '@law:leave_catalogue:RELIGIOUS_DUTY_LEAVE',
					reference: 'reverse',
					as_adjustment_entry: true,
					reversal_of_id: '@first',
					effective_on: '2026-02-03',
					reason: 'Cancelled religious duty',
					facts: {}
				}
			},
			duty('replacement', '2026-02-05', '2026-02-05')
		],
		expected: [],
		saved: [
			gross,
			{
				collection: 'leave_entries',
				where: { id: '@reverse', reversal_of_id: '@first' },
				rows: [{ as_adjustment_entry: true, days: 1 }]
			},
			{
				collection: 'leave_entries',
				where: { id: '@replacement' },
				select: { facts: true, days: true },
				rows: [{ 'facts.event_date': '2026-02-05', days: 1 }]
			}
		]
	}
);

for (const mode of ['SAME_SECOND', 'SAME_SPLIT', 'OTHER_SECOND'] as const) {
	const other = mode === 'OTHER_SECOND';
	const earlierCompany = other ? '@earlier-company' : '@company';
	const earlier: ProbeInput[] = [];
	if (other) {
		earlier.push({
			collection: 'companies',
			ref: 'earlier-company',
			values: {
				settings_code: 'ID',
				name: 'Synthetic different employer',
				pay_cutoff_day: 1,
				pay_frequency: 'MONTHLY',
				effective_range: { from: '2020-01-01', to: null },
				...company
			}
		});
		// Distinct employer owns its roster vocabulary; never reuse the current employer's pattern.
		for (const input of officeWeek('2000-01-03')) {
			const values = JSON.parse(
				JSON.stringify(input.values)
					.replaceAll('@company', '@earlier-company')
					.replaceAll('@office', '@earlier-office')
					.replaceAll('@off', '@earlier-off')
					.replaceAll('@rest', '@earlier-rest')
			) as Row;
			earlier.push({ ...input, ref: `earlier-${input.ref}`, values });
		}
	}
	earlier.push(
		{
			collection: 'employments',
			ref: 'earlier-job',
			values: {
				employee_id: '@person',
				company_id: earlierCompany,
				employee_number: 'ID-DUTY-EARLIER',
				effective_range: { from: '2025-12-01', to: '2026-01-31' }
			}
		},
		terms('earlier-job', other ? '@earlier-week' : '@week', '2025-12-01', '2026-01-31'),
		duty('earlier-duty', '2026-01-05', '2026-01-05', 'earlier-job')
	);
	const eventDate = mode === 'SAME_SPLIT' ? '2026-01-05' : '2026-02-02';
	register({
		id: `ID-38-employer-${mode.toLowerCase()}`,
		profile: 'ID',
		period: '2026-02',
		company,
		description:
			mode === 'SAME_SECOND'
				? 'Same-employer rehire refuses a distinct second duty.'
				: mode === 'SAME_SPLIT'
					? 'Same dated duty continues across same-employer contracts.'
					: 'A duty with a different employer does not consume this employer allowance.',
		citation: [source],
		inputs: [
			...worker(true),
			...earlier,
			duty(
				'current-duty',
				'2026-02-02',
				eventDate,
				'job',
				mode === 'SAME_SECOND' ? refusal : undefined
			)
		],
		expected: [],
		saved: [
			gross,
			{
				collection: 'leave_entries',
				where: { employment_id: '@job' },
				select: { facts: true, days: true },
				rows:
					mode === 'SAME_SECOND'
						? []
						: [{ 'facts.event_date': eventDate, 'facts.event_kind': 'RELIGIOUS_DUTY', days: 1 }]
			}
		]
	});
}
