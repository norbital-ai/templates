import assert from 'node:assert/strict';
import test from 'node:test';
import { computePayslip, type Scenario } from './e2e/oracle/VN.ts';

const foreign: Scenario = {
	id: 'foreign-eleven-month-equivalent',
	rows: ['VN-LC168-01'],
	branches: ['foreign fixed term below twelve months'],
	period: '2026-08',
	company: { region: 'I' },
	employee: {
		birthDate: '1985-02-10',
		sex: 'M',
		citizenship: 'FOREIGN',
		taxResident: true,
		receivingPension: false,
		unionMember: false,
		dependants: 0,
		voluntaryPension: 0
	},
	contract: {
		start: '2025-10-01',
		fixedEnd: '2026-08-31',
		monthly: 60_000_000,
		allowance: 0,
		partTime: null,
		uiFrom: null
	},
	time: {
		unpaidDays: 0,
		sickDays: 0,
		ot: { weekday: 0, rest: 0, holiday: 0 },
		night: { plain: 0, weekdayAfterDayOt: 0, weekdayNoDayOt: 0, rest: 0, holiday: 0 }
	},
	bonus: 0,
	exit: { date: '2026-08-31', cause: 'END_OF_CONTRACT', pensionEligible: false, leaveTaken: 0 }
};

// LC art.168(3) imports the employer's lawful contribution amount, not an uncapped wage
// percentage. SI Law41/2024 art.31(1)(đ) and HI Law art.14(5) cap their bases at 20×reference.
// VSS notice ItemID26780 (9 July 2026) confirms the 1 July reference step to 2,530,000.
// https://datafiles.chinhphu.vn/cpp/files/vbpq/2024/9/41-2024-qh15.pdf
// https://congbao.cdnchinhphu.vn/CongBaoCP/VanBan/2025/2/44464/55506-1-2025539-54022-vbhn-vpqh.pdf
for (const [title, scenario, expected] of [
	['eleven-month foreign contract: SI 8,855,000 plus HI 1,518,000', foreign, 10_373_000],
	[
		'June reference level: SI 8,190,000 plus HI 1,404,000',
		{ ...foreign, period: '2026-06', exit: null },
		9_594_000
	],
	[
		'approved reduced accident rate: SI 8,753,800 plus HI 1,518,000',
		{ ...foreign, company: { ...foreign.company, oaReduced: true } },
		10_271_800
	],
	[
		'pensioner: SI ceiling 50,600,000 and separate Region I UI ceiling 106,200,000',
		{
			...foreign,
			employee: { ...foreign.employee, citizenship: 'VN', receivingPension: true },
			contract: { ...foreign.contract, fixedEnd: null, monthly: 120_000_000 },
			exit: null
		},
		9_917_000
	]
] satisfies [string, Scenario, number][])
	test(`VN art.168(3) equivalent oracle: ${title}`, () => {
		assert.equal(computePayslip(scenario).lines.INSURANCE_EQUIVALENT?.amount, expected);
	});
