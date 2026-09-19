// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * The membership matrix of every lineage: which schemes each allowance and ad hoc class counts
 * toward, and which part of a split base. The matrix is the law (cited beside each row); the bank is what a
 * transcription says. A row moving here without a statute moving is a bank defect.
 *
 * Every version of a lineage carries the same matrix — a class's membership is the statute's
 * definition of wages, which none of the sealed dates changed — and the lineage's README prints
 * this table under "Applied 2026-09-20".
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	LINEAGES,
	adhocCatalogue,
	allowanceCatalogue,
	contributionSchemes,
	settingsVersions
} from './fixtures/statutory-world.ts';

const MY_WAGES = ['EIS', 'EPF', 'EPF_NON_CITIZEN', 'EPF_PR', 'HRDF', 'SKBBK', 'SOCSO'];
const PH_SSS = ['SSS', 'SSS_EC', 'SSS_MPF'];
const ID_BPJS = ['JHT', 'JKK', 'JKM', 'JKP', 'JP', 'KESEHATAN'];

const MATRIX: Record<string, Record<string, readonly string[]>> = {
	// CPF Act s.2: every allowance is wages; a bonus is Additional Wages. SHG funds and SDL read total wages.
	SG: { bonus: ['CDAC', 'CPF.ADDITIONAL', 'ECF', 'MBMF', 'SDL', 'SINDA'] },
	// EPF Act s.2 (wages, no retirement/termination benefit), SOCSO/EIS s.2 wages, PSMB Act wages,
	// ITA 1967 s.13(1)(a) with PCB's additional-remuneration method for one-off pay.
	MY: {
		ADJ: [...MY_WAGES.filter((code) => code !== 'HRDF'), 'PCB.ADDITIONAL'],
		BACKPAY_ADD_WAGES: ['EIS', 'PCB.ADDITIONAL', 'SKBBK', 'SOCSO'],
		BPAYBS: [...MY_WAGES, 'PCB.ADDITIONAL'],
		NOTICE_IN_LIEU: ['PCB.ADDITIONAL'],
		ONCALL: [...MY_WAGES, 'PCB.ADDITIONAL'],
		SUA: [...MY_WAGES, 'PCB.ORDINARY'],
		TERMINATION_BENEFIT: []
	},
	// RA 11199 s.8(f) compensation; NIRC s.32(B)(7)(e) 13th month and other benefits (de minimis meal).
	PH: {
		BACKPAY_ADD_WAGES: [...PH_SSS, 'WTAX.ORDINARY'],
		BACKPAY_BASIC: [...PH_SSS, 'WTAX.ORDINARY'],
		BACKPAY_DUTY_ALLOWANCE: [...PH_SSS, 'WTAX.ORDINARY'],
		RETIREMENT_PAY: [],
		SEPARATION_PAY: [],
		STATUTORY_ADJUSTMENT: [],
		THIRTEENTH_MONTH_PAY: ['WTAX.SPECIAL'],
		allowance: [...PH_SSS, 'WTAX.ORDINARY'],
		bonus: ['WTAX.SPECIAL'],
		communication: [...PH_SSS, 'WTAX.ORDINARY'],
		corporate_duty_allowance: [...PH_SSS, 'WTAX.ORDINARY'],
		duty_allowance: [...PH_SSS, 'WTAX.ORDINARY'],
		leader: [...PH_SSS, 'WTAX.ORDINARY'],
		meal: [...PH_SSS, 'WTAX.SPECIAL'],
		position: [...PH_SSS, 'WTAX.ORDINARY'],
		transport: [...PH_SSS, 'WTAX.ORDINARY']
	},
	// Circular 111/2013 art.2(2): allowances are salary income except severance and job-loss allowances.
	VN: { INSURANCE_EQUIVALENT: ['PIT'], JOB_LOSS_ALLOWANCE: [], SEVERANCE_ALLOWANCE: [] },
	// 所得稅法 §14(1)(3): a bonus is 薪資所得; 勞退條例 §14 and NHI supplement read it; severance is outside.
	TW: {
		SEVERANCE_PAY: [],
		bonus: [
			'INCOME_TAX',
			'INCOME_TAX_NON_RESIDENT',
			'LABOR_PENSION_RESERVE',
			'NHI_SUPPLEMENT_EMPLOYER'
		]
	},
	// PP 44/45/46 2015, Perpres 82/2018: upah pokok + tunjangan tetap; PMK 168/2023 regular vs irregular income.
	ID: {
		BACK_PAY_SALARY: ['PPH21.ADDITIONAL', 'PPH26'],
		BONUS_THR: ['PPH21.ADDITIONAL', 'PPH26'],
		CAR_ALLOWANCE: [...ID_BPJS, 'PPH21.ORDINARY', 'PPH26'],
		CLAWBACK_OVERTIME: ['PPH21.ADDITIONAL', 'PPH26'],
		COMPENSATION: [],
		DEDUCTION: [],
		HOUSE_ALLOWANCE: [...ID_BPJS, 'PPH21.ORDINARY', 'PPH26'],
		KESEHATAN_TERMINATION_MONTH_EMPLOYEE: [],
		KESEHATAN_TERMINATION_MONTH_EMPLOYER: ['PPH21.ADDITIONAL', 'PPH26'],
		MEDICAL_ALLOWANCE: ['PPH21.ADDITIONAL', 'PPH26'],
		PESANGON: [],
		PKWT_COMPENSATION: ['PPH21.ADDITIONAL', 'PPH26'],
		RETROACTIVE_PAY: ['PPH21.ADDITIONAL', 'PPH26'],
		SPECIAL_ALLOWANCE: [...ID_BPJS, 'PPH21.ORDINARY', 'PPH26'],
		TAX_INCENTIVE: [],
		THR: ['PPH21.ADDITIONAL', 'PPH26'],
		UPMK: []
	}
};
MATRIX['MY-nihon'] = MATRIX.MY;

/** The classes the law owes on separation, raised by off-boarding for an eligible leaver. */
const SEPARATION = new Set([
	'TERMINATION_BENEFIT',
	'NOTICE_IN_LIEU',
	'SEPARATION_PAY',
	'RETIREMENT_PAY',
	'SEVERANCE_PAY',
	'SEVERANCE_ALLOWANCE',
	'JOB_LOSS_ALLOWANCE',
	'PESANGON',
	'UPMK',
	'PKWT_COMPENSATION',
	'THR'
]);

for (const lineage of LINEAGES) {
	test(`${lineage}: every version carries the membership matrix`, () => {
		const expected = MATRIX[lineage];
		assert.ok(expected, `no matrix for ${lineage}`);
		const schemes = contributionSchemes(lineage);
		for (const version of settingsVersions(lineage)) {
			const parts = new Map(
				schemes
					.filter((scheme) => scheme.settings_id === version.id)
					.map((scheme) => [scheme.code, scheme.parts ?? []])
			);
			// A version carries the classes and schemes of its date: a scheme the law added later
			// (MY SKBBK from 2026) is absent from an earlier version's memberships, not a drift.
			const rows = [...allowanceCatalogue(lineage), ...adhocCatalogue(lineage)].filter(
				(row) => row.settings_id === version.id
			);
			const actual = Object.fromEntries(
				rows.map((row) => [row.code, [...row.counts_toward].sort()])
			);
			const wanted = Object.fromEntries(
				rows.map((row) => {
					assert.ok(
						expected[row.code],
						`${lineage} ${version.code}: ${row.code} not in the matrix`
					);
					return [
						row.code,
						expected[row.code].filter((entry) => parts.has(entry.split('.')[0])).sort()
					];
				})
			);
			assert.deepEqual(actual, wanted, `${lineage} ${version.code}`);
			// The separation classes are the ones off-boarding raises; every other ad hoc class is HR's.
			for (const row of adhocCatalogue(lineage).filter((row) => row.settings_id === version.id))
				assert.equal(
					row.raised_by,
					SEPARATION.has(row.code) ? 'SEPARATION' : 'MANUAL',
					`${lineage} ${row.code}`
				);
			// Every membership names a scheme of the same version, and a part the scheme declares.
			for (const row of rows)
				for (const entry of row.counts_toward) {
					const [code, part] = entry.split('.');
					assert.ok(parts.has(code), `${lineage} ${version.code} ${row.code} → ${entry}`);
					if (part !== undefined)
						assert.ok(parts.get(code).includes(part), `${lineage} ${row.code} → ${entry}`);
				}
		}
	});
}
