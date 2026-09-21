import {
	defineModel,
	enums,
	file,
	instant,
	numeric,
	text,
	uuid
} from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		employment_id: uuid().notNull(),
		/**
		 * Why the money is held: a tax-clearance directive (IR21), a court order, an agency
		 * direction, a dispute. The category is the operator's record of the authority's basis.
		 */
		category: enums([
			'TAX_CLEARANCE',
			'COURT_ORDER',
			'AGENCY_DIRECTION',
			'EMPLOYEE_DISPUTE',
			'OTHER'
		])
			.notNull()
			.default('TAX_CLEARANCE'),
		/** The directive's own reference, retained for reconciliation. */
		directive_reference: text({ search: true }).notNull(),
		/** The amount withheld; null while the authority has not stated one. */
		amount: numeric(),
		held_on: instant({ precision: 'day' }).notNull(),
		/** Set when the authority releases the hold; open holds block the payslip's settlement. */
		released_on: instant({ precision: 'day' }),
		released_amount: numeric(),
		/** The clearance or release directive that closed the hold. */
		reconciliation_reference: text(),
		evidence_file: file()
	},
	{
		description:
			'A disbursement hold on one employment — a tax-clearance directive, court order or dispute. An open hold blocks the payslip being marked paid; release records the directive and the amount, and the release reconciles against it.',
		recordLabel: 'directive_reference',
		icon: 'lucide:hand',
		indexes: [{ columns: ['employment_id', 'released_on'] }]
	}
);
