import { policy } from '@norbital-ai/bolt';
import {
	OWN,
	OWN_EMPLOYEE,
	OWN_EMPLOYMENT,
	ownsEmployments,
	requestReview,
	MEMBER_LIMITS
} from './grants.js';
const claimColumns = [
	'entity_id',
	'employment_id',
	'catalog_id',
	'quantity',
	'incurred_on',
	'evidence_file'
] as const;
const claimUpdateColumns = ['quantity', 'incurred_on', 'evidence_file'] as const;
const leaveColumns = ['entity_id', 'employment_id', 'catalog_id', 'evidence_file'] as const;
const SEALED_SETTINGS = { where: { settings_id: { is: { status: { eq: 'SEALED' } } } } } as const;
export default policy({
	description:
		'Own identity and documents, admitted requests, work, loans, balances, immutable ledger and payslips. User identity is the linked member ID.',
	capabilities: { apps: ['hr_employee'] },
	grants: {
		employee_profile: {
			outputs: { default: { where: OWN_EMPLOYEE } },
			update: {
				columns: { fields: ['documents'] },
				verdict: function* (changes, ctx) {
					const other = changes.findIndex(
						({ before }) => ctx.actor.kind !== 'member' || before.user_id !== ctx.actor.id
					);
					return other < 0
						? ctx.allow()
						: yield* ctx.refuse('errors.employee_own_profile_documents', { row: other });
				}
			}
		},
		employee_contract: { outputs: { default: { where: OWN_EMPLOYMENT } } },
		entity: {
			outputs: {
				self_service: { where: { employee_contract: { some: OWN_EMPLOYMENT } } }
			}
		},
		holiday: {
			outputs: {
				default: {
					where: { entity_id: { is: { employee_contract: { some: OWN_EMPLOYMENT } } } }
				}
			}
		},
		jurisdiction_settings: {
			outputs: { default: { where: { status: { eq: 'SEALED' } } } }
		},
		leave_catalog: { outputs: { default: SEALED_SETTINGS } },
		claim_catalog: { outputs: { default: SEALED_SETTINGS } },
		allowance_catalog: { outputs: { default: SEALED_SETTINGS } },
		adhoc_catalog: { outputs: { default: SEALED_SETTINGS } },
		loan_catalog: { outputs: { default: SEALED_SETTINGS } },
		claim_catalog_entry: {
			outputs: { default: { where: OWN } },
			create: {
				columns: { fields: claimColumns },
				verdict: function* (changes, ctx) {
					if (
						!(yield* ownsEmployments(
							ctx,
							changes.map((c) => c.after.employment_id)
						))
					)
						return yield* ctx.refuse('errors.employee_own_claim_submit');
					return ctx.approve(requestReview);
				}
			},
			update: {
				columns: { fields: claimUpdateColumns },
				verdict: function* (changes, ctx) {
					if (
						!(yield* ownsEmployments(
							ctx,
							changes.map((c) => c.before.employment_id)
						))
					)
						return yield* ctx.refuse('errors.employee_own_claim_update');
					return ctx.approve(requestReview);
				}
			}
		},
		leave_catalog_entry: {
			outputs: { default: { where: OWN } },
			create: {
				columns: {
					fields: leaveColumns,
					leave_catalog_entry_day: { fields: ['incurred_on', 'part'] }
				},
				verdict: function* (changes, ctx) {
					if (
						!(yield* ownsEmployments(
							ctx,
							changes.map((c) => c.after.employment_id)
						))
					)
						return yield* ctx.refuse('errors.employee_own_leave_request');
					return ctx.approve(requestReview);
				}
			}
		},
		adhoc_catalog_entry: { outputs: { default: { where: OWN } } },
		loan_catalog_entry: { outputs: { default: { where: OWN } } },
		loan_catalog_entry_repayment: { outputs: { default: { where: OWN } } },
		employee_balance: {
			outputs: { default: { where: { employee_id: { is: OWN_EMPLOYEE } } } }
		},
		ledger_entry: {
			outputs: {
				default: { where: { balance_id: { is: { employee_id: { is: OWN_EMPLOYEE } } } } }
			}
		},
		payslip: { outputs: { default: { where: { employee_id: { is: OWN_EMPLOYEE } } } } },
		payroll_run: {
			outputs: {
				default: { where: { payslips: { some: { employee_id: { is: OWN_EMPLOYEE } } } } }
			}
		},
		roster_entry: {
			outputs: { default: { where: { employment_id: { is: OWN_EMPLOYMENT } } } }
		},
		shift_definition: { outputs: { default: {} } },
		shift_pattern: { outputs: { default: {} } }
	},
	limits: MEMBER_LIMITS
});
