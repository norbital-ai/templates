import { sync } from '@norbital-ai/bolt';
import { metroBank } from '../../../lib/export_format_configuration/bank_files.js';
import { exportRows } from '../../../lib/export_format_configuration/export_rows.js';

/** One run's net pay as a Metrobank file. */
export default sync('payroll_run', 'metro_bank', {
	with: 'file',
	parser: metroBank.parser,
	schema: metroBank.schema,
	context: { payroll_run_id: { kind: 'ref', to: 'payroll_run' } },
	write: function* ({ context }, ctx) {
		return metroBank.records(yield* exportRows(ctx.query, context.payroll_run_id));
	}
});
