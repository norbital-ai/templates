import { sync } from '@norbital-ai/bolt';
import { salaryListing } from '../../../lib/export_format_configuration/salary_listing.js';
import { exportRows } from '../../../lib/export_format_configuration/export_rows.js';

/** The salary listing of one run, as a file. */
export default sync('payroll_run', 'salary_listing', {
	with: 'file',
	parser: salaryListing.parser,
	schema: salaryListing.schema,
	context: { payroll_run_id: { kind: 'ref', to: 'payroll_run' } },
	write: function* ({ context }, ctx) {
		return salaryListing.records(yield* exportRows(ctx.query, context.payroll_run_id));
	}
});
