import type { Actor, PolicyReads, Flow, Verdict } from '@norbital-ai/bolt';
import { Effect } from 'effect';
import { idOf } from '../../lib/payroll_engine/reads.js';
export const MEMBER_LIMITS = { act: '600/min', read: '600/min', agent: '100/h' } as const;
export const AUTOMATION_LIMITS = { act: '600/min', read: '600/min' } as const;
export const OWN_EMPLOYEE = { user_id: { eq: { var: 'requestor.id' } } } as const;
export const OWN_EMPLOYMENT = { employee_id: { is: OWN_EMPLOYEE } } as const;
export const OWN = { employment_id: { is: OWN_EMPLOYMENT } } as const;
type Judge = {
	readonly actor: Actor;
	readonly db: PolicyReads;
	allow(): Verdict;
	deny(message: string): Verdict;
	approve(build: (flow: Flow) => Flow): Verdict;
};
export const ownsEmployments = Effect.fn('policy.ownsEmployments')(function* (
	ctx: Judge,
	values: readonly unknown[]
) {
	if (ctx.actor.kind !== 'member' || values.some((v) => typeof v !== 'string')) return false;
	const actorId = ctx.actor.id;
	const ids = [...new Set(values.map((v) => idOf('employee_contract', v)))],
		got = yield* ctx.db.query({
			employee_contract: { where: { id: { in: ids } }, fields: ['employee_id'], limit: 10000 },
			'employee_contract.employee_id': { fields: ['user_id'] }
		});
	return (
		got.employee_contract.next === null &&
		got.employee_contract.rows.length === ids.length &&
		got.employee_contract.rows.every((c) => c.employee_id?.user_id === actorId)
	);
});
export const requestReview = (flow: Flow) =>
	flow
		.step('Supervisor review', { teams: ['supervisor', 'manager', 'production_manager'] })
		.step('HR review', { teams: ['hr_controller', 'hr_manager', 'manager_hr_controller'] })
		.supersededBy(['hr_manager', 'senior_management']);
export const READ_ALL = {
	entity: { read: true, history: true, outputs: { self_service: true } },
	entity_profile_version: { read: true, history: true },
	employee_profile: { read: true, history: true },
	employee_contract: { read: true, history: true },
	jurisdiction_settings: { read: true, history: true },
	statutory_change: { read: true, history: true },
	statutory_finding: { read: true, history: true },
	statutory_source: { read: true, history: true },
	leave_catalog: { read: true },
	claim_catalog: { read: true },
	allowance_catalog: { read: true },
	adhoc_catalog: { read: true },
	loan_catalog: { read: true },
	subtotal: { read: true },
	statutory_contribution_catalog: { read: true },
	registered_rule: { read: true },
	registered_effect: { read: true },
	leave_catalog_entry: { read: true, history: true },
	claim_catalog_entry: { read: true, history: true },
	adhoc_catalog_entry: { read: true, history: true },
	loan_catalog_entry: { read: true, history: true },
	loan_repayment_entry: { read: true, history: true },
	employee_balance: { read: true },
	ledger_entry: { read: true },
	holiday: { read: true, history: true },
	shift_definition: { read: true, history: true },
	shift_pattern: { read: true, history: true },
	roster_entry: { read: true, history: true },
	work_interruption_catalog: { read: true, history: true },
	work_interruption_catalog_entry: { read: true, history: true },
	workplace_case_catalog: { read: true, history: true },
	workplace_case_catalog_entry: { read: true, history: true },
	payroll_run: { read: true, history: true },
	payslip: { read: true, history: true },
	obligation: { read: true, history: true },
	sys_user: { read: true },
	sys_invitation: { read: true }
} as const;
export const CONFIGURATION = {
	jurisdiction_settings: {
		...READ_ALL.jurisdiction_settings,
		create: true,
		update: true,
		moves: 'all'
	},
	statutory_change: { ...READ_ALL.statutory_change, create: true, update: true },
	statutory_finding: { ...READ_ALL.statutory_finding, create: true, update: true, moves: 'all' },
	statutory_source: { ...READ_ALL.statutory_source, create: true, update: true, moves: 'all' },
	leave_catalog: { read: true, create: true, update: true, delete: true },
	claim_catalog: { read: true, create: true, update: true, delete: true },
	allowance_catalog: { read: true, create: true, update: true, delete: true },
	adhoc_catalog: { read: true, create: true, update: true, delete: true },
	loan_catalog: { read: true, create: true, update: true, delete: true },
	overtime_catalog: { read: true, create: true, update: true, delete: true },
	workplace_case_catalog: { read: true, create: true, update: true, delete: true },
	work_interruption_catalog: {
		...READ_ALL.work_interruption_catalog,
		create: true,
		update: true,
		delete: true
	},
	subtotal: { read: true, create: true, update: true, delete: true },
	statutory_contribution_catalog: { read: true, create: true, update: true, delete: true },
	registered_rule: { read: true, create: true, update: true, delete: true },
	registered_effect: { read: true, create: true, update: true, delete: true }
} as const;
export const HR_OPERATIONS = {
	entity: { ...READ_ALL.entity, create: true, update: true },
	entity_profile_version: {
		...READ_ALL.entity_profile_version,
		create: true,
		update: true,
		moves: 'all'
	},
	employee_profile: { ...READ_ALL.employee_profile, create: true, update: true },
	ledger_entry: { ...READ_ALL.ledger_entry, create: true },
	employee_contract: {
		...READ_ALL.employee_contract,
		create: true,
		update: true,
		moves: 'all'
	},
	leave_catalog_entry: {
		...READ_ALL.leave_catalog_entry,
		create: true,
		update: true,
		delete: true
	},
	claim_catalog_entry: {
		...READ_ALL.claim_catalog_entry,
		create: true,
		update: true,
		delete: true
	},
	adhoc_catalog_entry: {
		...READ_ALL.adhoc_catalog_entry,
		create: true,
		update: true,
		delete: true
	},
	loan_catalog_entry: {
		...READ_ALL.loan_catalog_entry,
		create: true,
		update: true,
		delete: true
	},
	loan_repayment_entry: {
		...READ_ALL.loan_repayment_entry,
		create: true,
		update: true,
		delete: true
	},
	holiday: { ...READ_ALL.holiday, create: true, update: true, delete: true },
	shift_definition: { ...READ_ALL.shift_definition, create: true, update: true, delete: true },
	shift_pattern: { ...READ_ALL.shift_pattern, create: true, update: true, delete: true },
	roster_entry: { ...READ_ALL.roster_entry, create: true, update: true, delete: true },
	work_interruption_catalog: {
		...READ_ALL.work_interruption_catalog,
		create: true,
		update: true,
		delete: true
	},
	work_interruption_catalog_entry: {
		...READ_ALL.work_interruption_catalog_entry,
		create: true,
		update: true
	},
	workplace_case_catalog_entry: {
		...READ_ALL.workplace_case_catalog_entry,
		create: true,
		update: true
	},
	workplace_case_catalog: {
		...READ_ALL.workplace_case_catalog,
		create: true,
		update: true,
		delete: true,
		moves: 'all'
	},
	payroll_run: {
		...READ_ALL.payroll_run,
		create: true,
		update: true,
		delete: true,
		moves: 'all'
	},
	obligation: { ...READ_ALL.obligation, create: true, update: true, delete: true, moves: 'all' }
} as const;
export const PAYROLL_STARTS = ['statutory_research', 'statutory_materialize'] as const;
