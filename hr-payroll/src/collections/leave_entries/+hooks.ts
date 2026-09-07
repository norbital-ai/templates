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
						if (existing != null) {
							// The complete set an employment write carries restates every stored line by id;
							// an update that changes nothing is not an edit.
							const changed = Object.keys(input).filter(
								(field) => field !== 'id' && field !== 'row_version'
							);
							if (changed.length > 0)
								refuse('Leave entries are append-only. Post a correcting entry.');
							return input;
						}
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
							['CARRY_TRANSFER_OUT', 'TAKEN', 'ENCASHED', 'COMMUTED', 'EXPIRED'].includes(
								String(input.kind)
							) &&
							days > 0
						)
							refuse('Take, transfer, encash, commute and expiry entries must be negative.');
						if (input.kind === 'MANUAL_ADJUSTMENT') {
							if (String(input.reason ?? '').trim() === '')
								refuse('A manual leave adjustment needs a reason.');
							if (String(input.source_key ?? '').trim() === '')
								refuse('A manual leave adjustment needs a unique reference.');
							const entitlement = yield* api.db.leave_entitlements.findFirst({
								where: { id: { eq: input.leave_entitlement_id }, approval_id: { isNull: true } }
							});
							if (entitlement == null || entitlement.status !== 'OPEN')
								refuse('A manual leave adjustment requires an approved open entitlement.');
							const effective = dateKey(input.effective_on);
							if (
								effective < dateKey(entitlement.starts_on) ||
								effective > dateKey(entitlement.ends_on)
							)
								refuse('A manual leave adjustment must fall inside its leave year.');
							// Refused here, before the proposal is held, so a reference cannot be posted twice
							// while the first one is still waiting for its approval.
							const duplicate = yield* api.db.leave_entries.findFirst({
								where: {
									leave_entitlement_id: { eq: entitlement.id },
									source_key: { eq: String(input.source_key) }
								}
							});
							if (duplicate != null)
								refuse('A leave entry with this reference is already posted on this entitlement.');
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
