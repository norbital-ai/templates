import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStatutory, settingsVersions } from './fixtures/statutory-world.ts';

// EA 1955 ss.12(2),12(4),13(1),57. Expectations use the actual unexpired calendar
// interval at a constant RM3,000 monthly wage, not the catalogue's old /30 premise.
const facts = { notice_given: false, notice_waived_days: 0 };
function notice(
	code: 'MY',
	declarations: Record<string, string | number | boolean>,
	options: {
		exit?: string;
		hire?: string;
		days?: number;
		domestic?: boolean;
		reason?: string;
		component?: 'NOTICE_IN_LIEU' | 'NOTICE_INDEMNITY';
		requested?: number;
	} = {}
) {
	const exit = options.exit ?? '2026-01-31';
	const component = options.component ?? 'NOTICE_IN_LIEU';
	const book = buildStatutory(
		{
			code,
			period: exit.slice(0, 7),
			people: [
				{
					key: 'NOTICE',
					wage: 3000,
					citizenship: 'CITIZEN',
					registrations: { EPF_NON_CITIZEN: { kind: 'NOT_REGISTERED' } },
					hire_date: options.hire ?? '2025-01-01',
					exit_date: exit,
					exit_ground: options.reason ?? 'UNILATERAL',
					employment_type: options.domestic ? 'DOMESTIC' : 'PERMANENT'
				}
			]
		},
		(world) => {
			const employment = world.employments[0]!;
			employment.exit_facts = { ...employment.exit_facts, ...declarations };
			if (declarations.notice_given === false) delete employment.exit_facts.notice_given_on;
			world.employment_terms[0]!.notice_days = options.days ?? 28;
			const version = settingsVersions(code).find(
				(row) =>
					String(row.effective_range.start).slice(0, 10) <= exit &&
					String(row.effective_range.end).slice(0, 10) > exit
			)!;
			const catalogue = world.adhoc_catalogue!.find(
				(row) => row.settings_id === version.id && row.code === component
			)!;
			world.adhoc_requests!.push({
				id: 'ab000000-0000-4000-8000-000000000001',
				employment_id: employment.id,
				catalogue_id: catalogue.id,
				amount: options.requested ?? 0,
				event_date: exit,
				pay_period: exit.slice(0, 7),
				payslip_id: null,
				reason: 'Notice probe',
				evidence_file:
					component === 'NOTICE_INDEMNITY'
						? {
								storage_key: 'synthetic-notice-evidence',
								file_name: 'notice.pdf',
								mime_type: 'application/pdf',
								file_size: 1
							}
						: null,
				as_adjustment_entry: false,
				approval_id: null
			});
		}
	);
	return (
		book.slips.get('NOTICE')!.adjustments.find((row) => row.component_code === component)?.amount ??
		0
	);
}

for (const code of ['MY'] as const) {
	test(`${code}: manual employee notice recovery is calculated from declarations, not the entered amount`, () => {
		assert.equal(
			notice(
				code,
				{ ...facts, notice_termination_party: 'EMPLOYEE' },
				{
					reason: 'RESIGNATION',
					component: 'NOTICE_INDEMNITY',
					days: 14,
					requested: 999
				}
			),
			1500
		);
	});
	test(`${code}: the employer ending a resignation early owes the employee notice pay`, () => {
		assert.equal(
			notice(
				code,
				{ ...facts, notice_termination_party: 'EMPLOYER' },
				{
					reason: 'RESIGNATION',
					days: 14
				}
			),
			1500
		);
	});
	test(`${code}: fully served notice pays no indemnity`, () => {
		assert.equal(notice(code, { ...facts, notice_given: true, notice_given_on: '2026-01-04' }), 0);
	});
	test(`${code}: no notice values the ensuing February, not a fixed 30-day divisor`, () => {
		assert.equal(notice(code, facts), 3000);
	});
	test(`${code}: partly served notice values only 1–16 February`, () => {
		assert.equal(
			notice(code, { ...facts, notice_given: true, notice_given_on: '2026-01-20' }),
			1714.29
		);
	});
	test(`${code}: whole and partial waivers remove the corresponding unserved days`, () => {
		const partial = { notice_given: true, notice_given_on: '2026-01-20', notice_waived_days: 16 };
		assert.equal(notice(code, partial), 0);
		assert.equal(notice(code, { ...partial, notice_waived_days: 6 }), 1071.43);
	});
	test(`${code}: cross-month remainder uses each month's actual length`, () => {
		// Five February days + six March days = 3,000 × 5/28 + 3,000 × 6/31.
		assert.equal(
			notice(
				code,
				{ ...facts, notice_given: true, notice_given_on: '2026-02-07' },
				{ exit: '2026-02-23' }
			),
			1116.36
		);
	});
	test(`${code}: domestic default is fourteen days`, () => {
		assert.equal(notice(code, facts, { days: 0, domestic: true }), 1500);
	});
	test(`${code}: proven harassment dismissal uses Part XVA for a domestic employee`, () => {
		assert.equal(
			notice(
				code,
				{ ...facts, notice_exception: 'HARASSMENT_DISMISSAL' },
				{ days: 0, domestic: true, reason: 'DISMISSAL' }
			),
			0
		);
	});
	test(`${code}: statutory service threshold is measured when notice is given`, () => {
		assert.equal(
			notice(
				code,
				{ ...facts, notice_given: true, notice_given_on: '2026-01-31' },
				{ days: 0, hire: '2024-02-01', exit: '2026-02-15' }
			),
			1285.71
		);
	});
	test(`${code}: invalid notice dates and excessive waivers refuse valuation`, () => {
		for (const given of ['2026-02-30', '2024-12-31', '2026-02-01'])
			assert.throws(
				() => notice(code, { ...facts, notice_given: true, notice_given_on: given }),
				/notice|date/i
			);
		assert.throws(() => notice(code, { ...facts, notice_waived_days: 29 }), /[Ww]aived/);
	});
	for (const version of settingsVersions(code)) {
		const exit = String(version.effective_range.start).slice(0, 10);
		const day = new Date(`${exit}T00:00:00Z`);
		day.setUTCDate(day.getUTCDate() - 27);
		const given = day.toISOString().slice(0, 10);
		test(`${code}: fully served notice remains zero in version ${version.id}`, () => {
			assert.equal(
				notice(
					code,
					{ ...facts, notice_given: true, notice_given_on: given },
					{
						exit,
						hire: `${Number(exit.slice(0, 4)) - 1}-01-01`
					}
				),
				0
			);
		});
	}
}
