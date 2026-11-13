import type { ApprovalFlow, Clock, Id, WorkspaceQuery } from '@norbital-ai/bolt';
import { Effect } from 'effect';
export const MEMBER_LIMITS = { act: '600/min', read: '600/min', agent: '100/h' } as const;
export const AUTOMATION_LIMITS = { act: '600/min', read: '600/min' } as const;
export const OWN_EMPLOYEE = { user_id: { eq: { var: 'requestor.id' } } } as const;
export const OWN_EMPLOYMENT = { employee_id: { is: OWN_EMPLOYEE } } as const;
export const OWN = { employment_id: { is: OWN_EMPLOYMENT } } as const;
export const ownsEmployments = Effect.fn('policy.ownsEmployments')(function* (
	ctx: Pick<Clock, 'actor'> & { readonly query: WorkspaceQuery['query'] },
	values: readonly (Id<'employee_contract'> | null)[]
) {
	if (ctx.actor.kind !== 'member' || values.some((v) => v === null)) return false;
	const actorId = ctx.actor.id;
	const ids = [...new Set(values.flatMap((v) => (v === null ? [] : [v])))],
		got = yield* ctx.query({
			employee_contract: {
				where: { id: { in: ids } },
				fields: ['employee_id'],
				limit: 10000,
				employee_id: { fields: ['user_id'] }
			}
		});
	return (
		got.employee_contract.next === null &&
		got.employee_contract.rows.length === ids.length &&
		got.employee_contract.rows.every((c) => c.employee_id?.user_id === actorId)
	);
});
export const requestReview: ApprovalFlow = {
	steps: [
		{ name: 'Supervisor review', teams: ['supervisor', 'manager', 'production_manager'] },
		{ name: 'HR review', teams: ['hr_controller', 'hr_manager', 'manager_hr_controller'] }
	],
	superseded_by: ['hr_manager', 'senior_management']
};
const READ = { outputs: { default: {} } } as const;
const HISTORY = { outputs: { default: { history: true } } } as const;
export const READ_ALL = {
	entity: { outputs: { default: { history: true }, self_service: {} } },
	pay_group: HISTORY,
	entity_profile_version: HISTORY,
	employee_profile: HISTORY,
	employee_contract: HISTORY,
	contract_change: READ,
	entity_change: READ,
	jurisdiction: HISTORY,
	jurisdiction_change: HISTORY,
	statutory_finding: HISTORY,
	statutory_source: HISTORY,
	leave_catalog_entry: HISTORY,
	leave_catalog_entry_day: { ...READ, update: {} },
	claim_catalog_entry: HISTORY,
	adhoc_catalog_entry: HISTORY,
	loan_catalog_entry: HISTORY,
	loan_catalog_entry_repayment: HISTORY,
	employee_balance: READ,
	ledger_entry: READ,
	holiday: HISTORY,
	shift_definition: HISTORY,
	shift_pattern: HISTORY,
	roster_entry: HISTORY,
	work_event: HISTORY,
	workplace_case_catalog_entry: HISTORY,
	payroll_run: HISTORY,
	payslip: HISTORY,
	// a run takes the rows it carries: the update is that seal, as it is for a leave slot
	pay_amendment: { ...READ, update: {} },
	obligation: HISTORY,
	sys_user: READ,
	sys_invitation: READ
} as const;
export const CONFIGURATION = {
	jurisdiction: { ...READ_ALL.jurisdiction, create: {}, update: {} },
	jurisdiction_change: { ...READ_ALL.jurisdiction_change, create: {}, update: {}, delete: {} },
	statutory_finding: { ...READ_ALL.statutory_finding, create: {}, update: { moves: 'all' } },
	statutory_source: { ...READ_ALL.statutory_source, create: {}, update: { moves: 'all' } },
	work_event: { ...READ_ALL.work_event, create: {}, update: {}, delete: {} }
} as const;
export const HR_OPERATIONS = {
	entity: { ...READ_ALL.entity, create: {}, update: {} },
	pay_group: { ...READ_ALL.pay_group, create: {}, update: {} },
	entity_profile_version: {
		...READ_ALL.entity_profile_version,
		create: {},
		update: { moves: 'all' }
	},
	employee_profile: { ...READ_ALL.employee_profile, create: {}, update: {} },
	contract_change: { ...READ_ALL.contract_change, create: {}, update: {}, delete: {} },
	entity_change: { ...READ_ALL.entity_change, create: {}, update: {}, delete: {} },
	employee_contract: {
		...READ_ALL.employee_contract,
		create: {},
		update: { moves: 'all' }
	},
	leave_catalog_entry: {
		...READ_ALL.leave_catalog_entry,
		create: {},
		update: {},
		delete: {}
	},
	leave_catalog_entry_day: { ...READ, create: {}, update: {}, delete: {} },
	claim_catalog_entry: {
		...READ_ALL.claim_catalog_entry,
		create: {},
		update: {},
		delete: {}
	},
	adhoc_catalog_entry: {
		...READ_ALL.adhoc_catalog_entry,
		create: {},
		update: {},
		delete: {}
	},
	loan_catalog_entry: {
		...READ_ALL.loan_catalog_entry,
		create: {},
		update: {},
		delete: {}
	},
	loan_catalog_entry_repayment: {
		...READ_ALL.loan_catalog_entry_repayment,
		create: {},
		update: {},
		delete: {}
	},
	holiday: { ...READ_ALL.holiday, create: {}, update: {}, delete: {} },
	shift_definition: { ...READ_ALL.shift_definition, create: {}, update: {}, delete: {} },
	shift_pattern: { ...READ_ALL.shift_pattern, create: {}, update: {}, delete: {} },
	roster_entry: { ...READ_ALL.roster_entry, create: {}, update: {}, delete: {} },
	workplace_case_catalog_entry: {
		...READ_ALL.workplace_case_catalog_entry,
		create: {},
		update: {}
	},
	payroll_run: {
		...READ_ALL.payroll_run,
		create: {},
		update: { moves: 'all' },
		delete: {}
	},
	obligation: { ...READ_ALL.obligation, create: {}, update: { moves: 'all' }, delete: {} }
} as const;
export const PAYROLL_STARTS = ['statutory_research', 'ledger'] as const;
