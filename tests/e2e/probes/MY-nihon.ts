import { cases, register, type ProbeCase } from '../payroll-probe.ts';
import './MY.ts';

/**
 * MY-nihon cases: see the case shape at the top of payroll-probe.ts.
 *
 * Every sealed MY-nihon version carries the same statutory schemes (EPF, SOCSO, EIS, SKBBK, PCB,
 * HRDF: rules, bases, parts and elections), the same `payroll` settings and the same adhoc,
 * allowance, claim and leave catalogues as the MY version of the same dates (compared 2026-09-30,
 * seed/jurisdiction/{MY,MY-nihon}); only `work_rules` differ (the customer's overtime, rest-day and
 * holiday columns, ordinary divisor and rest-day precedence). So each MY case below, which works no
 * overtime, rest-day or holiday hour and pays no ordinary-rate award, owes the same payslip under
 * MY-nihon, from the same hand-computed, cited figures. `docs/inventory/malaysia.csv` names each
 * case in its `probe` column. Cases that do work such hours are MY-nihon's own and are not here.
 */
const SAME_LAW = {
	'MY-EPF-03-1': 'MY-nihon-EPF-03-1',
	'MY-EPF-01-1': 'MY-nihon-EPF-01-1',
	'MY-EPF-01-2': 'MY-nihon-EPF-01-2',
	'MY-EPF-01-3': 'MY-nihon-EPF-01-3',
	'MY-PCB-01-1': 'MY-nihon-PCB-01-1',
	'MY-NAT-01-1': 'MY-nihon-NAT-01-1',
	'MY-EPF-01-4': 'MY-nihon-EPF-01-4',
	'MY-WAGEBASE-01-1': 'MY-nihon-WAGEBASE-01-1',
	'MY-EPF-03-2': 'MY-nihon-EPF-03-2',
	'MY-SKBBK-01-1': 'MY-nihon-SKBBK-01-1',
	'MY-EA11-1': 'MY-nihon-EA11-1',
	'MY-EA11-2': 'MY-nihon-EA11-2',
	'MY-EA11-3': 'MY-nihon-EA11-3',
	'MY-PCB-01-2': 'MY-nihon-PCB-01-2',
	'MY-HRD-01-1': 'MY-nihon-HRD-01-1',
	'MY-HRD-02-1': 'MY-nihon-HRD-02-1',
	'MY-HRDA06-1': 'MY-nihon-HRDA06-1',
	'MY-HRD11-1': 'MY-nihon-HRD11-1',
	'MY-REG-01-1': 'MY-nihon-REG-01-1',
	'MY-HRD12-1': 'MY-nihon-HRD12-1',
	'MY-PCB-02-1': 'MY-nihon-PCB-02-1',
	'MY-PCB-03-1': 'MY-nihon-PCB-03-1',
	'MY-PCB-05-1': 'MY-nihon-PCB-05-1',
	'MY-PCB-06-1': 'MY-nihon-PCB-06-1'
} as const;

register(
	...Object.entries(SAME_LAW).map(([from, id]): ProbeCase => {
		const source = cases.find((c) => c.id === from && c.profile === 'MY');
		if (source === undefined) throw new Error(`${id}: no MY probe case ${from}`);
		return {
			...source,
			id,
			profile: 'MY-nihon',
			description: `${source.description} Under the MY-nihon lineage (same statutory schemes, payroll settings and catalogues as MY; no work-rule hour in the case).`
		};
	})
);
