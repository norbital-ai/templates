import { sync } from '@norbital-ai/bolt';
import { ocbcFast } from '../../../lib/export_format_configuration/bank_files.js';
import { exportRows } from '../../../lib/export_format_configuration/export_rows.js';

/** One run's net pay as an OCBC FAST file. */
export default sync('payroll_run', 'ocbc_fast', {
	with: 'file',
	parser: ocbcFast.parser,
	schema: ocbcFast.schema,
	context: { payroll_run_id: { kind: 'ref', to: 'payroll_run' } },
	write: function* ({ context }, ctx) {
		return ocbcFast.records(yield* exportRows(ctx.query, context.payroll_run_id));
	}
});
