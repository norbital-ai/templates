// Methods a company's own payroll uses that the law allows, and the system follows: health insurance billed a month in
// arrears, a tax instalment the authority directs counted as tax withheld, and a joiner keyed after the month's payroll
// closed paid their first days as back pay of the next. Each goes through the models' own acts; the public law packs
// are only the fixture.
import assert from 'node:assert/strict';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { PlainDate } from '@norbital-ai/std/date';
import { Effect } from 'effect';
import { verify } from '../src/lib/integrity.ts';
import { idOf } from '../src/lib/payroll_engine/reads.ts';
import { ownLines, pay, run, slip } from './amendment_kit.ts';
import {
	ENTITY,
	catalogRow,
	ledgerRows,
	pack,
	uuid,
	workspace,
	storedQuery,
	storedReader
} from './kit.ts';

type Seed = ReturnType<typeof pack>;
const CONTRACT = idOf('employee_contract', uuid(6));
/** No queued work failed and the ledger holds no hard finding. */
const ledgerWhole = (t: Kit) =>
	Effect.gen(function* () {
		assert.deepEqual((yield* t.run_due()).failed, []);
		assert.deepEqual(
			(yield* verify(storedReader(t), t.clock.now().slice(0, 10)))
				.filter((finding) => finding.invariant !== 'W1')
				.map((finding) => `${finding.invariant} ${finding.message}`),
			[]
		);
	});
/** The person's one contract, from `from` to `to`, with these terms on top. */
const employed = (seed: Seed, from: string, to: string | null, terms: object = {}): Seed => ({
	...seed,
	employee_contract: (seed.employee_contract ?? []).map((row) => ({
		...row,
		effective_range: { from, to },
		service_started_on: from,
		terms: { ...(row.terms as object), ...terms }
	}))
});

describe('health insurance billed a month in arrears', () => {
	const indonesia = (billing: 'CURRENT' | 'ARREARS'): Seed => {
		const packed = pack(
			'ID',
			'Asia/Jakarta',
			{
				rate: { amount: 10_000_000, unit: 'MONTHLY' },
				normal_hours_per_day: 8,
				normal_hours_per_week: 40,
				normal_days_per_week: 5,
				statutory_work_category: 'NON_MANUAL',
				work_classification: 'EA_COVERED',
				residency_status: 'CITIZEN',
				wage_payment_method: 'BANK',
				allowances: {}
			},
			{ work_region: 'Provinsi Aceh/Kabupaten Aceh Barat' },
			[],
			[],
			'2026-03-15'
		);
		return employed(
			{
				...packed,
				entity_profile_version: (packed.entity_profile_version ?? []).map((row) => ({
					...row,
					entity_extension_data: { risk_class: 'I' },
					pay_methods: { health_billing: billing }
				}))
			},
			'2026-02-10',
			'2026-04-30'
		);
	};
	const health = (t: Kit, period: string) =>
		ownLines(t, period).pipe(
			Effect.map((lines) => [
				lines['KESEHATAN/EMPLOYEE'] ?? 0,
				lines['KESEHATAN_EMPLOYER/EMPLOYER'] ?? 0
			])
		);

	it.live(
		'the joining month charges nothing, the last payslip two months, and the employment pays the same',
		() =>
			Effect.gen(function* () {
				const months = ['2026-02', '2026-03', '2026-04'];
				const charged = (billing: 'CURRENT' | 'ARREARS') =>
					Effect.gen(function* () {
						const t = yield* TestWorkspace;
						const out: (readonly number[])[] = [];
						for (const month of months) {
							yield* pay(t, month);
							out.push(yield* health(t, month));
						}
						yield* ledgerWhole(t);
						return out;
					}).pipe(
						Effect.provide(workspace({ seed: indonesia(billing), now: '2026-04-28T02:00:00.000Z' }))
					);
				const current = yield* charged('CURRENT');
				const arrears = yield* charged('ARREARS');
				const [, march] = current;
				assert.ok(march !== undefined);
				const [employee = 0, employer = 0] = march;
				assert.ok(employee !== 0 && employer !== 0);
				assert.deepEqual(arrears, [[0, 0], march, [employee * 2, employer * 2]]);
				// a month's charge stands whichever payslip carries it: the employment pays the same
				const total = (rows: readonly (readonly number[])[]) =>
					rows.reduce((sum, [employee = 0, employer = 0]) => sum + employee + employer, 0);
				assert.equal(total(arrears), total([march, march, march]));
			})
	);
});

describe('a tax instalment the authority directs (Malaysia, Form CP38)', () => {
	const malaysia = pack(
		'MY',
		'Asia/Kuala_Lumpur',
		{
			rate: { amount: 8227, unit: 'MONTHLY' },
			statutory_work_category: 'NON_MANUAL',
			work_classification: 'EA_COVERED',
			residency_status: 'CITIZEN',
			wage_payment_method: 'BANK',
			allowances: {}
		},
		{},
		[],
		[],
		'2026-02-15'
	);
	const directed = (t: Kit, amount: number) =>
		t.as(t.admin).pipe(
			Effect.andThen((caller) =>
				caller.act({
					'adhoc_catalog_entry.create': [
						{
							entity_id: ENTITY,
							employment_id: CONTRACT,
							catalog_id: idOf(
								'adhoc_catalog',
								catalogRow(malaysia, 'adhoc_catalog', 'CP38_INSTALMENT')
							),
							description: 'CP38 amount',
							quantity: amount,
							unit: 'MONEY',
							incurred_on: PlainDate('2026-02-01')
						}
					]
				})
			)
		);

	it.live(
		'is deducted and counted as tax withheld, kept out of the PCB the next months are worked out from',
		() =>
			Effect.gen(function* () {
				const plain = yield* Effect.gen(function* () {
					const t = yield* TestWorkspace;
					yield* pay(t, '2026-02');
					yield* pay(t, '2026-03');
					return [yield* ownLines(t, '2026-02'), yield* ownLines(t, '2026-03')];
				}).pipe(Effect.provide(workspace({ seed: malaysia, now: '2026-03-20T02:00:00.000Z' })));
				const t = yield* TestWorkspace;
				yield* directed(t, 1115);
				yield* pay(t, '2026-02');
				const february = yield* ownLines(t, '2026-02');
				assert.equal(february['CP38_INSTALMENT/EMPLOYEE'], -1115);
				assert.equal(
					february['PCB/EMPLOYEE'],
					plain[0]?.['PCB/EMPLOYEE'],
					'PCB is worked out as without it'
				);
				const { payslip } = yield* storedQuery(t, {
					payslip: { where: { period: { eq: '2026-02' } }, limit: 1 }
				});
				assert.equal(
					payslip.rows[0]?.tax_withheld.to_number(),
					-(february['PCB/EMPLOYEE'] ?? 0) + 1115,
					'tax withheld is PCB and the instalment'
				);
				// the next month's PCB reads the year's PCB without the instalment
				yield* pay(t, '2026-03');
				assert.equal((yield* ownLines(t, '2026-03'))['PCB/EMPLOYEE'], plain[1]?.['PCB/EMPLOYEE']);
				const posted = (yield* ledgerRows(t)).filter(
					(row) => row.account === 'statutory' && row.code === 'CP38.employee'
				);
				assert.deepEqual(
					posted.map((row) => [row.measure, row.amount?.to_number()]),
					[['paid', 1115]]
				);
				yield* ledgerWhole(t);
				assert.ok((yield* slip(t, '2026-02')).net > 0);
			}).pipe(Effect.provide(workspace({ seed: malaysia, now: '2026-03-20T02:00:00.000Z' })))
	);
});

describe('a joiner keyed after the month’s payroll closed (Malaysia)', () => {
	// joined on 23 February and agreed on 26 February, the day after February's pay date
	const seed = employed(
		pack(
			'MY',
			'Asia/Kuala_Lumpur',
			{
				rate: { amount: 4000, unit: 'MONTHLY' },
				statutory_work_category: 'NON_MANUAL',
				work_classification: 'EA_COVERED',
				residency_status: 'CITIZEN',
				wage_payment_method: 'BANK',
				allowances: {}
			},
			{},
			[],
			[],
			'2026-02-15'
		),
		'2026-02-23',
		null,
		{ signed_on: '2026-02-26' }
	);

	it.live(
		'the first days are back pay of the next month, on the law’s own row, which EPF counts',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const february = yield* pay(t, '2026-02');
				const { payslip } = yield* storedQuery(t, {
					payslip: { where: { payroll_run_id: { eq: february.id } }, limit: 1 }
				});
				assert.deepEqual(payslip.rows, [], 'nothing was agreed by February’s pay date');
				yield* run(t, '2026-03');
				const march = yield* ownLines(t, '2026-03');
				assert.equal(march['BASIC/EMPLOYEE'], 4000);
				assert.equal(march['BPAYBS/EMPLOYEE'], 857.14, '6 of 28 February days');
				yield* ledgerWhole(t);
			}).pipe(Effect.provide(workspace({ seed, now: '2026-03-20T02:00:00.000Z' })))
	);
});
