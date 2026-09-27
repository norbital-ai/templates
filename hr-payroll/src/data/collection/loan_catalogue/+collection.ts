import { collection } from '@norbital-ai/bolt';
import { admitCatalogueRow } from '../../../lib/catalogue_rules.js';
import { versionsById } from '../../../lib/settings_seal.js';
import { refuse } from '../../../lib/refuse.js';
import { plain } from '../../../lib/wire.js';

/**
 * Loan catalogue rows belong to a settings version and are sealed with it: a row of a sealed version refuses
 * create and update here, and delete through the grant (`DRAFT_SETTINGS_ROW`).
 */
const c = collection('loan_catalogue', {
	read: { fields: 'all' },
	create: {
		input: {
			columns: [
				'settings_id',
				'code',
				'name',
				'destination',
				'direction',
				'bands',
				'loan_type',
				'minimum_repayment',
				'eligibility',
				'evidence'
			]
		}
	},
	update: {
		input: {
			columns: [
				'code',
				'name',
				'destination',
				'direction',
				'bands',
				'loan_type',
				'minimum_repayment',
				'eligibility',
				'evidence'
			]
		}
	},
	delete: {}
});

type Row = {
	readonly settings_id?: string;
	readonly code?: unknown;
	readonly destination?: unknown;
	readonly direction?: unknown;
};

/**
 * A loan is recovered: its line takes money from the person, never gives it. A row that landed as `PAY · ADD`
 * once paid every instalment *to* the borrower on top of their wage, so the landing is checked where it is written.
 */
const assertRecovers = (row: Row): void => {
	if (row.destination !== 'NET' || row.direction !== 'SUBTRACT')
		refuse(
			`Loan ${String(row.code ?? '')} must be recovered from net pay (destination NET, direction SUBTRACT); recovery cannot reduce gross wages or bypass deduction limits.`
		);
};

c.transform(async (inputs, ctx) => {
	const stored = ctx.existing.map((row) => (row == null ? undefined : (plain(row) as Row)));
	const versions = await versionsById(ctx.db, [
		...inputs.map((input) => input.settings_id),
		...stored.map((row) => row?.settings_id)
	]);
	return inputs.map((input, index) => {
		const admitted = admitCatalogueRow(versions, input, stored[index], 'Loan');
		assertRecovers({ ...stored[index], ...admitted });
		// `bands` is a list, `[]` when the line has none.
		return stored[index] == null && admitted.bands === undefined
			? { ...admitted, bands: [] }
			: admitted;
	});
});

export default c;
