import { sync } from '@norbital-ai/bolt';
import { columns, readSource, fromSource } from '../../../integration/kingdee/polling.js';
import { projections } from '../../../integration/kingdee/projections.js';
import { preserveSource } from '../../../integration/kingdee/reconciliation.js';

export default sync('settlements', 'kingdee', {
	with: 'kingdee',
	policies: ['kingdee_sync'],
	every: '1min',
	read: function* ({ cursor, instance }, ctx) {
		return fromSource(
			yield* readSource(
				projections.settlements,
				cursor,
				ctx,
				(row) => {
					const r = columns(row);
					return {
						external_code: r.text('external_code'),
						code: r.text('code'),
						name: r.text('name'),
						active: r.bool('active', true),
						source_updated_at: r.instant('source_updated_at')
					};
				},
				preserveSource({
					model: 'settlements',
					instance,
					projection: projections.settlements,
					ctx
				})
			),
			instance
		);
	}
});
