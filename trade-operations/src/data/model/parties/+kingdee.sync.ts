import { sync } from '@norbital-ai/bolt';
import { columns, readSource, fromSource } from '../../../integration/kingdee/polling.js';
import { projections } from '../../../integration/kingdee/projections.js';
import { preserveSource } from '../../../integration/kingdee/reconciliation.js';

export default sync('parties', 'kingdee', {
	with: 'kingdee',
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
						address: r.text('address', null),
						phone: r.text('phone', null),
						source_updated_at: r.instant('source_updated_at')
					};
				},
				preserveSource({ model: 'parties', instance, projection: projections.parties, ctx })
			),
			instance
		);
	}
});
