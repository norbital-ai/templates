/**
 * The Leave, Claims, Ad hoc and Loans tables print each entry's `amount` column: the cell is handed that decimal, not a
 * `values` object, so reading `values.amount` off it printed "—" for every entry.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'node:test';
import { moneyNumber } from '../src/lib/payroll_engine/foundation.ts';

const source = readFileSync(join(process.cwd(), 'src/lib/ui/payroll/pay_requests.svelte'), 'utf8');

it('the amount cell reads the amount it is handed', () => {
	assert.match(
		source,
		/\{#snippet amountCell\(\{ value \}[^}]*\}\)\}\{@const amount =\s*moneyNumber\(value\)\}/
	);
	assert.doesNotMatch(source, /values\['amount'\]/);
	// a stored decimal, as the table hands it
	assert.equal(moneyNumber({ $dec: '1000.00' }), 1000);
});
