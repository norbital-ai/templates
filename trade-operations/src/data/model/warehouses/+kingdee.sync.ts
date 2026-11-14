import { sync } from '@norbital-ai/bolt';
import { columns, readSource, fromSource } from '../../../integration/kingdee/polling.js';
import { projections } from '../../../integration/kingdee/projections.js';
import { preserveSource } from '../../../integration/kingdee/reconciliation.js';

export default sync('warehouses', 'kingdee', {
	with: 'kingdee',
	every: '1min',
	read: function* ({ cursor, instance }, ctx) {
		return fromSource(
			yield* readSource(
				projections.warehouses,
				cursor,
				ctx,
				(row) => {
					const r = columns(row);
					return {
						external_code: r.text('external_code'),
						source_number: r.text('source_number', null),
						name: r.text('name'),
						group_code: r.text('group_code', null),
						active: r.bool('active', true),
						source_updated_at: r.instant('source_updated_at')
					};
				},
				preserveSource({
					model: 'warehouses',
					instance,
					projection: projections.warehouses,
					ctx
				})
			),
			instance
		);
	}
});
