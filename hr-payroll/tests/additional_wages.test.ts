import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { describe, it } from '@effect/vitest';
import { monthOf } from '@norbital-ai/std/date';
import { inputSchema } from '@norbital-ai/std/kind';
import { Effect, Schema } from 'effect';
import payslipModel from '../src/data/model/+payslip.model.ts';
import statutoryModel from '../src/data/model/+statutory_contribution_catalog.model.ts';
import { reconcileAdditionalWages } from '../src/lib/payroll_engine/payslip/additional_wages.ts';
import type {
	PayslipRow,
	PayslipStatutoryLine,
	StatutoryConfiguration,
	StatutoryRow
} from '../src/lib/payroll_engine/payslip/context.ts';
import { fixtureId, nativeId } from './fixture_values.ts';
import { readSeedRows } from './seed_values.ts';

type Input = Parameters<typeof reconcileAdditionalWages>[0];
const required = <A>(value: A | null | undefined): A => {
	assert.ok(value != null);
	return value;
};
const configurationCodec = inputSchema(statutoryModel.fields.configuration.shape);
const Configuration = Schema.declare<StatutoryConfiguration>(
	(value): value is StatutoryConfiguration => Schema.is(configurationCodec)(value)
);
const original = required(
	readSeedRows(
		resolve(import.meta.dirname, '../seed/jurisdiction/SG/version_3'),
		'statutory_contribution_catalog'
	).find((row) => row.code === 'CPF')
);
const configuration = required(
	Schema.decodeUnknownSync(Configuration)(
		Schema.decodeUnknownSync(configurationCodec)(original.configuration)
	)
);
const cpf: StatutoryRow = {
	id: nativeId('statutory_contribution_catalog', original.id),
	code: 'CPF',
	configuration
};
const rule = required(
	configuration.rules?.find(
		(candidate) =>
			candidate.when ===
			'(person.residency_status == "CITIZEN" || person.residency_status == "PERMANENT_RESIDENT") && person.age < 55'
	)
);

/** Decode the same fields the runtime HISTORY selection reads, using the actual payslip model. */
const payslipCodec = inputSchema({
	kind: 'object',
	fields: {
		id: { kind: 'id', of: 'payslip' },
		payroll_run_id: { kind: 'id', of: 'payroll_run' },
		employment_id: { kind: 'id', of: 'employment_contract' },
		status: payslipModel.fields.status,
		proration: payslipModel.fields.proration,
		salary_from: payslipModel.fields.salary_from,
		statutory: payslipModel.fields.statutory,
		base: payslipModel.fields.base,
		adjustments: payslipModel.fields.adjustments,
		gross: payslipModel.fields.gross,
		net: payslipModel.fields.net
	}
});
const Payslip = Schema.declare<PayslipRow>((value): value is PayslipRow =>
	Schema.is(payslipCodec)(value)
);
const storedSlip = (input: {
	readonly key: string;
	readonly from: string;
	readonly ordinary: number;
	readonly additional?: number;
	readonly assessedAdditional?: number;
	readonly employee: number;
	readonly employer: number;
	readonly zeroWithoutAssessment?: boolean;
}): PayslipRow => {
	const additional = input.additional ?? 0;
	const assessedAdditional = input.assessedAdditional ?? 0;
	const gross = input.ordinary + additional;
	return Schema.decodeUnknownSync(Payslip)(
		Schema.decodeUnknownSync(payslipCodec)({
			id: fixtureId(`aw-slip-${input.key}`),
			payroll_run_id: fixtureId(`aw-run-${input.key}`),
			employment_id: fixtureId('aw-employment'),
			status: 'DRAFT',
			proration: [],
			salary_from: input.from,
			statutory: input.zeroWithoutAssessment
				? []
				: [
						{
							scheme_code: 'CPF',
							base_amount: input.ordinary + assessedAdditional,
							charged_base:
								input.ordinary + (input.additional === undefined ? 0 : assessedAdditional),
							parts: { ordinary: input.ordinary, additional: assessedAdditional },
							wages: { ordinary: input.ordinary, additional },
							employee_amount: input.employee,
							employer_amount: input.employer,
							rule_when: rule.when
						}
					],
			base: input.ordinary === 0 ? [] : [{ component_code: 'BASIC', amount: input.ordinary }],
			adjustments:
				additional === 0
					? []
					: [
							{
								family: 'ADHOC',
								source_id: fixtureId(`aw-bonus-${input.key}`),
								component_code: 'BONUS',
								bucket: 'EARNING',
								destination: 'PAY',
								amount: additional
							}
						],
			gross,
			net: gross - input.employee
		})
	);
};
const runId = (slip: PayslipRow): string => String(slip.payroll_run_id);
const money = (amount: number): number => Math.round(amount * 100) / 100;
const fixture = (options: { readonly constantWage?: boolean } = {}): Input => {
	const history = Array.from({ length: 11 }, (_, index) => {
		const month = index + 1;
		const ordinary = options.constantWage || month <= 6 ? 8000 : 4000;
		return storedSlip({
			key: String(month),
			from: `2026-${String(month).padStart(2, '0')}-01`,
			ordinary,
			...(month === 1 ? { additional: 20000, assessedAdditional: 6000 } : {}),
			employee: month === 1 ? 2800 : ordinary * 0.2,
			employer: month === 1 ? 2380 : ordinary * 0.17
		});
	});
	const ordinary = options.constantWage ? 8000 : 4000;
	return {
		who: 'Example employee',
		code: 'CPF',
		part: 'additional',
		ceiling: options.constantWage ? 6000 : 30000,
		month: '2026-12',
		through: '2026-12-31',
		currentWindow: { from: '2026-12-01', to: '2026-12-31' },
		salaryRun: true,
		yearStart: '2026-01',
		subject: { employment: { start_date: '2026-01-01' } },
		currentRule: rule,
		currentParts: { ordinary, additional: 0 },
		currentWages: { ordinary, additional: 0 },
		history,
		runKind: new Map(history.map((slip) => [runId(slip), 'REGULAR'])),
		runWindows: new Map(
			history.map((slip) => {
				const span = monthOf(String(slip.salary_from));
				return [runId(slip), { from: String(span.from), to: String(span.to) }];
			})
		),
		configurations: new Map(history.map((slip) => [runId(slip), [cpf]])),
		money
	};
};
const changeLine = (
	input: Input,
	index: number,
	changes: Partial<PayslipStatutoryLine>
): Input => ({
	...input,
	history: input.history.map((slip, at) =>
		at !== index
			? slip
			: {
					...slip,
					statutory: [{ ...required(slip.statutory?.[0]), ...changes }]
				}
	)
});
const addDecember = (input: Input, employee: number, employer: number): Input => {
	const slip = storedSlip({
		key: 'december-settled',
		from: '2026-12-01',
		ordinary: 4000,
		assessedAdditional: 14000,
		employee,
		employer
	});
	return {
		...input,
		salaryRun: false,
		currentWindow: { from: '2026-12-31', to: '2026-12-31' },
		history: [...input.history, slip],
		runKind: new Map([...input.runKind, [runId(slip), 'REGULAR']]),
		runWindows: new Map([
			...input.runWindows,
			[
				runId(slip),
				{
					from: '2026-12-01',
					to: '2026-12-31'
				}
			]
		]),
		configurations: new Map([...input.configurations, [runId(slip), [cpf]]])
	};
};

describe('captured additional-wage reconciliation safeguards', () => {
	it.effect('catches up earlier AW with no new AW in December', () =>
		Effect.gen(function* () {
			const result = yield* reconcileAdditionalWages(fixture());
			assert.deepEqual(result.monthCharge, { employee: 3600, employer: 3060 });
			assert.equal(result.assessedPart, 14000);
			assert.equal(result.chargedBase, 4000);
			assert.deepEqual(result.warnings, []);
		})
	);
	for (const field of ['wages', 'parts'] as const) {
		it.effect(`refuses missing original ordinary ${field}`, () =>
			Effect.gen(function* () {
				const input = fixture();
				const line = required(required(input.history[0]).statutory?.[0]);
				const incomplete = Object.fromEntries(
					Object.entries(required(line[field])).filter(([part]) => part !== 'ordinary')
				);
				const changed =
					field === 'wages'
						? changeLine(input, 0, { wages: incomplete })
						: changeLine(input, 0, { parts: incomplete });
				const refusal = yield* Effect.flip(reconcileAdditionalWages(changed));
				assert.match(refusal.message, /missing its original monthly wage parts/);
			})
		);
	}
	it.effect('refuses a final half-month when December first-half salary is missing', () =>
		Effect.gen(function* () {
			const refusal = yield* Effect.flip(
				reconcileAdditionalWages({
					...fixture(),
					currentWindow: { from: '2026-12-16', to: '2026-12-31' }
				})
			);
			assert.match(refusal.message, /salary history for 2026-12 is incomplete/);
		})
	);
	it.effect('refuses a captured formula requiring an unavailable historical person', () =>
		Effect.gen(function* () {
			const input = fixture();
			const id = runId(required(input.history[0]));
			const changed: StatutoryRow = {
				...cpf,
				configuration: {
					...configuration,
					rules: required(configuration.rules).map((candidate) =>
						candidate.when !== rule.when
							? candidate
							: {
									...candidate,
									contribution:
										'person.age < 55 ? {"employee":1.0,"employer":1.0} : {"employee":0.0,"employer":0.0}'
								}
					)
				}
			};
			const refusal = yield* Effect.flip(
				reconcileAdditionalWages({
					...input,
					configurations: new Map([...input.configurations, [id, [changed]]])
				})
			);
			assert.match(refusal.message, /original contribution rule cannot be replayed/);
		})
	);
	it.effect('refuses automatic later employee recovery of an original contribution error', () =>
		Effect.gen(function* () {
			const refusal = yield* Effect.flip(
				reconcileAdditionalWages(changeLine(fixture(), 0, { employee_amount: 2799 }))
			);
			assert.match(refusal.message, /earlier contribution error/);
			assert.match(refusal.message, /cannot be deducted automatically from later wages/);
		})
	);
	it.effect('accepts a proven zero-wage salary month when every original rule charges zero', () =>
		Effect.gen(function* () {
			const input = fixture();
			const zero = storedSlip({
				key: '2',
				from: '2026-02-01',
				ordinary: 0,
				employee: 0,
				employer: 0,
				zeroWithoutAssessment: true
			});
			const result = yield* reconcileAdditionalWages({
				...input,
				ceiling: 38000,
				history: input.history.map((slip, index) => (index === 1 ? zero : slip))
			});
			assert.deepEqual(result.monthCharge, { employee: 3600, employer: 3060 });
		})
	);
	it.effect('accepts an off-cycle AW after a proven zero-wage salary month', () =>
		Effect.gen(function* () {
			const input = fixture();
			const zero = storedSlip({
				key: 'december-zero',
				from: '2026-12-01',
				ordinary: 0,
				employee: 0,
				employer: 0,
				zeroWithoutAssessment: true
			});
			const result = yield* reconcileAdditionalWages({
				...input,
				salaryRun: false,
				currentWindow: { from: '2026-12-31', to: '2026-12-31' },
				currentParts: { ordinary: 0, additional: 1000 },
				currentWages: { ordinary: 0, additional: 1000 },
				history: [...input.history, zero],
				runKind: new Map([...input.runKind, [runId(zero), 'REGULAR']]),
				runWindows: new Map([
					...input.runWindows,
					[runId(zero), { from: '2026-12-01', to: '2026-12-31' }]
				]),
				configurations: new Map([...input.configurations, [runId(zero), [cpf]]])
			});
			assert.deepEqual(result.monthCharge, { employee: 3000, employer: 2550 });
		})
	);
	it.effect(
		'refuses a missing zero-month assessment if any original rule could charge at zero',
		() =>
			Effect.gen(function* () {
				const input = fixture();
				const zero = storedSlip({
					key: '2',
					from: '2026-02-01',
					ordinary: 0,
					employee: 0,
					employer: 0,
					zeroWithoutAssessment: true
				});
				const chargedAtZero: StatutoryRow = {
					...cpf,
					configuration: {
						...configuration,
						rules: [...required(configuration.rules), { when: 'person.age >= 55', employer: '2.0' }]
					}
				};
				const refusal = yield* Effect.flip(
					reconcileAdditionalWages({
						...input,
						history: input.history.map((slip, index) => (index === 1 ? zero : slip)),
						configurations: new Map([...input.configurations, [runId(zero), [chargedAtZero]]])
					})
				);
				assert.match(refusal.message, /cannot establish a zero contribution assessment/);
			})
	);
	it.effect('refuses positive wages with no captured scheme assessment', () =>
		Effect.gen(function* () {
			const input = fixture();
			const refusal = yield* Effect.flip(
				reconcileAdditionalWages({
					...input,
					history: input.history.map((slip, index) =>
						index === 1 ? { ...slip, statutory: [] } : slip
					)
				})
			);
			assert.match(refusal.message, /2026-02 has no unambiguous captured CPF assessment/);
		})
	);
	it.effect('keeps the same MTD target after December already settled its annual catch-up', () =>
		Effect.gen(function* () {
			const input = addDecember(fixture(), 3600, 3060);
			const result = yield* reconcileAdditionalWages(input);
			assert.deepEqual(result.monthCharge, { employee: 3600, employer: 3060 });
			const paid = required(required(input.history.at(-1)).statutory?.[0]);
			assert.equal(result.monthCharge.employee - paid.employee_amount, 0);
			assert.equal(result.monthCharge.employer - paid.employer_amount, 0);
		})
	);
	it.effect('refuses to turn an excess current-month charge into a payroll refund', () =>
		Effect.gen(function* () {
			const refusal = yield* Effect.flip(
				reconcileAdditionalWages(addDecember(fixture(), 3601, 3060))
			);
			assert.match(refusal.message, /this month already contains excess contributions/);
		})
	);
	it.effect('warns about earlier excess contributions while keeping current-month CPF', () =>
		Effect.gen(function* () {
			const result = yield* reconcileAdditionalWages(
				changeLine(fixture({ constantWage: true }), 0, { employee_amount: 2801 })
			);
			assert.deepEqual(result.monthCharge, { employee: 1600, employer: 1360 });
			assert.match(required(result.warnings[0]), /Apply to the authority for a refund/);
		})
	);
});
