import { Effect } from 'effect';
import { refuse } from '@norbital-ai/bolt/authoring';
import type { Hooks } from './$types.js';
import { dateKey } from '../../lib/iso-day.js';

export default {
	mutate: {
		perRecord: {
			before: {
				description: 'Leave entries are append-only; an existing movement can never be rewritten.',
				handler: ({ input, existing, api }) =>
					Effect.gen(function* () {
						if (existing != null) refuse('Leave entries are append-only. Post a correcting entry.');
						const days = Number(input.days);
						if (!Number.isFinite(days) || days === 0)
							refuse('A leave entry must move the balance.');
						if (
							['OPENING_ENTITLEMENT', 'ACCRUAL', 'CARRY_FORWARD', 'RESTORED'].includes(
								String(input.kind)
							) &&
							days < 0
						)
							refuse('Grant, carry and restore entries must be positive.');
						if (
							['CARRY_TRANSFER_OUT', 'TAKEN', 'ENCASHED', 'EXPIRED'].includes(String(input.kind)) &&
							days > 0
						)
							refuse('Take, transfer, encash and expiry entries must be negative.');
						if (input.kind === 'MANUAL_ADJUSTMENT') {
							if (String(input.reason ?? '').trim() === '')
								refuse('A manual leave adjustment needs a reason.');
							if (String(input.source_key ?? '').trim() === '')
								refuse('A manual leave adjustment needs a unique reference.');
							const account = yield* api.db.leave_accounts.findFirst({
								where: { id: { eq: input.leave_account_id }, approval_id: { isNull: true } }
							});
							if (account == null || account.status !== 'OPEN')
								refuse('A manual leave adjustment requires an approved open account.');
							const effective = dateKey(input.effective_on);
							if (effective < dateKey(account.starts_on) || effective > dateKey(account.ends_on))
								refuse('A manual leave adjustment must fall inside its account year.');
						}
						return input;
					})
			}
		}
	},
	delete: {
		perRecord: {
			before: {
				description: 'A posted leave movement is permanent audit evidence.',
				handler: () => refuse('Leave entries cannot be deleted. Post a correcting entry.')
			}
		}
	}
} satisfies Hooks;
