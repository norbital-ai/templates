import { sync } from '@norbital-ai/bolt';
import {
	columns,
	readSource,
	sanitizeEmail,
	sanitizePhone,
	SourceRowInvalid
} from '../../../../integration/kingdee/polling.js';
import { checked } from '../../../../integration/kingdee/order-source.js';
import { projections } from '../../../../integration/kingdee/projections.js';

// The one contact a Kingdee customer or supplier master keeps is its party's primary contact; a blank one removes it.
// Other contacts are local: the write acknowledges them without reaching Kingdee.
export default sync('contacts', 'kingdee', {
	with: 'kingdee',
	policies: ['kingdee_sync'],
	every: '1min',
	read: function* ({ cursor, instance }, ctx) {
		const page = yield* readSource(projections.contacts, cursor, ctx, (row) => row);
		const named = page.rows.filter((row) => columns(row).text('name', null) !== null);
		const { parties } = named.length
			? yield* ctx.query({
					parties: {
						where: {
							source: { eq: instance },
							external_code: { in: named.map((row) => columns(row).text('external_code')) }
						},
						fields: ['external_code']
					}
				})
			: { parties: { rows: [] } };
		const rows = yield* checked(() =>
			page.rows.map((row) => {
				const r = columns(row);
				const name = r.text('name', null);
				if (name === null) return { $id: row.$id, $deleted: true as const };
				const party = parties.rows.find((p) => p.external_code === r.text('external_code'));
				if (!party)
					throw new SourceRowInvalid({
						column: '$row',
						reason: 'A Kingdee contact requires its synced party'
					});
				return {
					$id: row.$id,
					party: party.id,
					name,
					phone: sanitizePhone(r.text('phone', null)),
					email: sanitizeEmail(r.text('email', null)),
					primary: true
				};
			})
		);
		return { ...page, rows };
	},
	// contacts added here stay here; members never edit the Kingdee contact (their policies refuse it)
	write: function* () {
		return null;
	}
});
