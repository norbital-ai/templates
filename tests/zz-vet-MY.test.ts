import test from 'node:test';
import { assessStatutory } from './fixtures/statutory-world.ts';
const OUT = { kind: 'NOT_REGISTERED' } as const;
const MY_LOCAL = { EPF_NON_CITIZEN: OUT };
const MY_FOREIGN = { EPF: OUT, EPF_PR: OUT, EIS: OUT };
const wages = JSON.parse(process.env.VET_WAGES ?? '[15,970,2590,5001]');
const period = process.env.VET_PERIOD ?? '2026-01';
const code = (process.env.VET_CODE ?? 'MY') as any;
const age = Number(process.env.VET_AGE ?? '40');
const cit = process.env.VET_CIT ?? 'CITIZEN';
test('probe', () => {
	const people = wages.map((w: number) => ({
		key: `W-${w}`,
		wage: w,
		age,
		citizenship: cit,
		registrations: cit === 'FOREIGNER' ? MY_FOREIGN : MY_LOCAL
	}));
	const book = assessStatutory({ code, period, headcount: 16, people });
	for (const [k, rows] of book) {
		if (k.startsWith('PAD')) continue;
		for (const [c, r] of rows) console.log(k, c, r.base, r.employee, r.employer);
	}
});
