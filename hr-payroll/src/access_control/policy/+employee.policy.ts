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
export default policy({
	description:
		'Own identity and documents, admitted requests, work, loans, balances, immutable ledger and payslips. User identity is the linked member ID.',
	capabilities: { apps: ['hr_employee'] },
	grants: {
		employee_profile: {
			read: { employee_profile: { where: OWN_EMPLOYEE } },
			update: {
				columns: { employee_profile: ['documents'] },
				check: function* (changes, ctx) {
					return changes.every(
						({ before }) => ctx.actor.kind === 'member' && before.user_id === ctx.actor.id
					)
						? ctx.allow()
						: ctx.deny('Upload documents to your own profile.');
				}
			}
		},
		employee_contract: { read: { employee_contract: { where: OWN_EMPLOYMENT } } },
		entity: {
			outputs: {
				self_service: { entity: { where: { employee_contract: { some: OWN_EMPLOYMENT } } } }
			}
		},
		holiday: {
			read: {
				holiday: {
					where: { entity_id: { is: { employee_contract: { some: OWN_EMPLOYMENT } } } }
				}
			}
		},
		jurisdiction_settings: {
			read: { jurisdiction_settings: { where: { status: { eq: 'SEALED' } } } }
		},
		leave_catalog: {
			read: { leave_catalog: { where: { settings_id: { is: { status: { eq: 'SEALED' } } } } } }
		},
		claim_catalog: {
			read: { claim_catalog: { where: { settings_id: { is: { status: { eq: 'SEALED' } } } } } }
		},
		allowance_catalog: {
			read: { allowance_catalog: { where: { settings_id: { is: { status: { eq: 'SEALED' } } } } } }
		},
		adhoc_catalog: {
			read: { adhoc_catalog: { where: { settings_id: { is: { status: { eq: 'SEALED' } } } } } }
		},
		loan_catalog: {
			read: { loan_catalog: { where: { settings_id: { is: { status: { eq: 'SEALED' } } } } } }
		},
		claim_catalog_entry: {
			read: { claim_catalog_entry: { where: OWN } },
			create: {
				columns: { claim_catalog_entry: claimColumns },
				check: function* (rows, ctx) {
					if (
						!(yield* ownsEmployments(
							ctx,
							rows.map((r) => r.employment_id)
						))
					)
						return ctx.deny('Submit a claim for your own employment.');
					return ctx.approve(requestReview);
				}
			},
			update: {
				columns: { claim_catalog_entry: claimUpdateColumns },
				check: function* (changes, ctx) {
					if (
						!(yield* ownsEmployments(
							ctx,
							changes.map((c) => c.before.employment_id)
						))
					)
						return ctx.deny('Update your own claim.');
					return ctx.approve(requestReview);
				}
			}
		},
		leave_catalog_entry: {
			read: { leave_catalog_entry: { where: OWN } },
			create: {
				columns: {
					leave_catalog_entry: leaveColumns,
					'leave_catalog_entry.leave_catalog_entry_day': ['incurred_on', 'part']
				},
				check: function* (rows, ctx) {
					if (
						!(yield* ownsEmployments(
							ctx,
							rows.map((r) => r.employment_id)
						))
					)
						return ctx.deny('Request leave on your own employment.');
					return ctx.approve(requestReview);
				}
			}
		},
		adhoc_catalog_entry: { read: { adhoc_catalog_entry: { where: OWN } } },
		loan_catalog_entry: { read: { loan_catalog_entry: { where: OWN } } },
		loan_catalog_entry_repayment: { read: { loan_catalog_entry_repayment: { where: OWN } } },
		employee_balance: {
			read: { employee_balance: { where: { employee_id: { is: OWN_EMPLOYEE } } } }
		},
		ledger_entry: {
			read: {
				ledger_entry: { where: { balance_id: { is: { employee_id: { is: OWN_EMPLOYEE } } } } }
			}
		},
		payslip: { read: { payslip: { where: { employee_id: { is: OWN_EMPLOYEE } } } } },
		payroll_run: {
			read: {
				payroll_run: { where: { payslips: { some: { employee_id: { is: OWN_EMPLOYEE } } } } }
			}
		},
		roster_entry: {
			read: { roster_entry: { where: { employment_id: { is: OWN_EMPLOYMENT } } } }
		},
		shift_definition: { read: true },
		shift_pattern: { read: true }
	},
	limits: MEMBER_LIMITS
});
