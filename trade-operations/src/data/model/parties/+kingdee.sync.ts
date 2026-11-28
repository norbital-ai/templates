import { sync } from '@norbital-ai/bolt';
import { writeCustomerCreditLimit } from '../../../integration/kingdee/credit-limit-write.js';
import {
	columns,
	readSource,
	fromSource,
	sanitizePhone
} from '../../../integration/kingdee/polling.js';
import { projections } from '../../../integration/kingdee/projections.js';
import { preserveSource } from '../../../integration/kingdee/reconciliation.js';

export default sync('parties', 'kingdee', {
	with: 'kingdee',
	policies: ['kingdee_sync'],
	every: '1min',
	read: function* ({ cursor, instance }, ctx) {
		return fromSource(
			yield* readSource(
				projections.parties,
				cursor,
				ctx,
				(row) => {
					const r = columns(row);
					return {
						external_code: r.text('external_code'),
						source_number: r.text('source_number', null),
						name: r.text('name'),
						kind: r.one('kind', ['customer', 'supplier', 'both']),
						currency: r.currency('currency'),
						active: r.bool('active', true),
						region: r.text('region', null),
						address: r.text('address', null),
						phone: sanitizePhone(r.text('phone', null)),
						source_updated_at: r.instant('source_updated_at')
					};
				},
				preserveSource({ model: 'parties', instance, projection: projections.parties, ctx })
			),
			instance
		);
	},
	write: function* ({ op, row, changed, instance }, ctx) {
		const limitChanged = changed.includes('credit_limit_target');
		const daysChanged = changed.includes('credit_days_target');
		if (
			op !== 'update' ||
			row.source !== instance ||
			row.kind === 'supplier' ||
			row.currency !== 'CNY' ||
			(!limitChanged && !daysChanged)
		)
			return null;
		const written = yield* writeCustomerCreditLimit(
			{
				partyCode: row.external_code,
				...(limitChanged ? { limit: row.credit_limit_target } : {}),
				...(daysChanged ? { creditDays: row.credit_days_target } : {})
			},
			ctx
		);
		return written && { $id: row.external_code };
	}
});
