import { sync } from '@norbital-ai/bolt';
import { readCreditReleaseSource } from '../../../integration/kingdee/credit-release-source.js';
import { fromSource } from '../../../integration/kingdee/polling.js';

export default sync('credit_releases', 'kingdee', {
	with: 'kingdee',
	policies: ['kingdee_sync'],
	every: '1min',
	read: function* ({ cursor, instance, local_unchanged }, ctx) {
		return fromSource(
			yield* readCreditReleaseSource(instance, cursor, ctx, local_unchanged),
			instance
		);
	}
});
