import { sync } from '@norbital-ai/bolt';
import { readCreditSource } from '../../../../integration/kingdee/financial-source.js';

export default sync('credit_snapshots', 'kingdee', {
	with: 'kingdee',
	read: function* () {
		return yield* readCreditSource();
	}
});
