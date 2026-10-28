/**
 * The `payroll_hotline` policy: a linked member's DM on an entity's number (`entity.hotline`) reads only their own
 * payslips of that entity, the administrator included. HR attaches a number and deploys the envoy through ordinary
 * writes; the hotline's bound authority is then read directly, without a model turn.
 */
import { expect, it } from '@effect/vitest';
import { Effect, Schema } from 'effect';
import { Authorities } from '@norbital-ai/bolt/engine';
import { TestWorkspace } from '@norbital-ai/bolt/test';
import type { InstanceId } from '@norbital-ai/bolt';
import { inputSchema } from '@norbital-ai/std/kind';
import { moneyNumber } from '../../src/lib/payroll_engine/foundation.ts';
import { workspace } from '../kit.ts';
import { nativeId } from '../fixture_values.ts';

const id = (n: number) => `019f9c00-0000-7000-8000-${String(n).padStart(12, '0')}`;
const [HOTLINE_A, HOTLINE_B] = [id(1), id(2)];
const [SG, A, B] = [id(3), id(4), id(5)];
const [P_ADA, P_CAL, P_DEE] = [id(6), id(7), id(8)];
const [K_ADA_A, K_CAL_A, K_CAL_B, K_DEE_A] = [id(9), id(10), id(11), id(12)];
const [RUN_A, RUN_B] = [id(13), id(14)];
const [SLIP_ADA_A, SLIP_CAL_A, SLIP_CAL_B, SLIP_DEE_A] = [id(15), id(16), id(17), id(18)];
const [ADA, CAL, DEE] = [id(19), id(20), id(21)];
const OPEN = { from: '2026-01-01', to: null };

const contract = (key: string, employee: string, company: string, n: string) => ({
	id: key,
	employee_id: employee,
	company_id: company,
	employee_number: n,
	contract_number: 1,
	effective_range: OPEN,
	facts: {}
});
const slip = (key: string, run: string, employment: string, net: string) => ({
	id: key,
	payroll_run_id: run,
	employment_id: employment,
	terms_through: '2026-09-30',
	salary_from: '2026-09-01',
	salary_to: '2026-09-30',
	status: 'DRAFT',
	currency: 'SGD',
	gross: net,
	total_deductions: '0.00',
	net,
	employer_cost: net
});
/** Two entities, each with its own hotline; Cal works for both, Ada (an administrator) and Dee for A only. */
const seed = {
	sys_user: [
		{
			id: ADA,
			email: 'ada@hr.test',
			name: 'Ada',
			kind: 'staff',
			admin: true,
			phone: '+65 9123 4567'
		},
		{
			id: CAL,
			email: 'cal@hr.test',
			name: 'Cal',
			kind: 'staff',
			admin: false,
			phone: '6598765432'
		},
		{ id: DEE, email: 'dee@hr.test', name: 'Dee', kind: 'staff', admin: false, phone: '6597654321' }
	],
	sys_integration: [
		{ id: HOTLINE_A, integration: 'whatsapp', name: 'Acme SG payroll' },
		{ id: HOTLINE_B, integration: 'whatsapp', name: 'Acme MY payroll' }
	],
	jurisdiction_settings: [
		{
			id: SG,
			code: 'SG',
			jurisdiction_code: 'SG',
			name: 'Singapore',
			effective_range: OPEN,
			payroll: {},
			sources: { entries: [] }
		}
	],
	entity: [
		{
			id: A,
			settings_code: 'SG',
			name: 'Acme SG',
			pay_cutoff_day: 1,
			effective_range: OPEN,
			hotline: HOTLINE_A
		},
		{
			id: B,
			settings_code: 'SG',
			name: 'Acme MY',
			pay_cutoff_day: 1,
			effective_range: OPEN
		}
	],
	employment_profile: [
		{ id: P_ADA, name: 'Ada', user_id: ADA },
		{ id: P_CAL, name: 'Cal', user_id: CAL },
		{ id: P_DEE, name: 'Dee', user_id: DEE }
	],
	employment_contract: [
		contract(K_ADA_A, P_ADA, A, 'A-1'),
		contract(K_CAL_A, P_CAL, A, 'A-2'),
		contract(K_CAL_B, P_CAL, B, 'B-1'),
		contract(K_DEE_A, P_DEE, A, 'A-3')
	],
	payroll_run: [
		{ id: RUN_A, company_id: A, settings_id: SG, period: '2026-09' },
		{ id: RUN_B, company_id: B, settings_id: SG, period: '2026-09' }
	],
	payslip: [
		slip(SLIP_ADA_A, RUN_A, K_ADA_A, '3000.00'),
		slip(SLIP_CAL_A, RUN_A, K_CAL_A, '1000.00'),
		slip(SLIP_CAL_B, RUN_B, K_CAL_B, '2000.00'),
		slip(SLIP_DEE_A, RUN_A, K_DEE_A, '4000.00')
	]
};

it.effect("a member's hotline reads their own payslips of the number's entity only", () =>
	Effect.gen(function* () {
		const t = yield* TestWorkspace;
		const hr = t.as(t.member(['hr_manager']));
		const hotline = Schema.decodeUnknownSync(
			Schema.declare<InstanceId<'whatsapp'>>(
				(value): value is InstanceId<'whatsapp'> =>
					typeof value === 'string' &&
					Schema.is(inputSchema({ kind: 'id', of: 'sys_integration' }))(value)
			)
		)(HOTLINE_B);
		expect(
			(yield* hr.act('entity.update', [{ target: nativeId('entity', B), set: { hotline } }])).kind
		).toBe('committed');
		for (const target of [HOTLINE_A, HOTLINE_B])
			expect(
				(yield* hr.act('sys_integration.update', [
					{ target: nativeId('sys_integration', target), set: { envoy: 'payroll_hotline' } }
				])).kind
			).toBe('committed');
		const authorities = new Authorities(t.manifest, 'hotline-fixture');
		const nets = Effect.fnUntraced(function* (instance: string, member: string) {
			const authority = yield* authorities.envoy(t.db, {
				envoy: 'payroll_hotline',
				instance,
				sender: member,
				member,
				dm: true
			});
			if (authority === null) throw new Error('The hotline does not serve this member');
			const { rows } = (yield* t.as(authority).query({ payslip: { fields: ['net'] } })).payslip;
			return rows.map((row) => moneyNumber(row.net)).sort();
		});
		expect(yield* nets(HOTLINE_A, CAL)).toEqual([1000]);
		expect(yield* nets(HOTLINE_B, CAL)).toEqual([2000]);
		// Dee works for A only; Ada is an administrator, but the hotline holds its policy alone
		expect(yield* nets(HOTLINE_B, DEE)).toEqual([]);
		expect(yield* nets(HOTLINE_A, DEE)).toEqual([4000]);
		expect(yield* nets(HOTLINE_A, ADA)).toEqual([3000]);
	}).pipe(Effect.provide(workspace({ seed, now: '2026-10-01T02:00:00.000Z' })))
);
