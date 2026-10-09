import assert from 'node:assert/strict';
import { it } from 'node:test';
import { formatNumeric, readableTitle } from '../src/lib/ui/format/display_formatters.ts';

it('a task title still in code form reads as words; a real title passes through', () => {
	assert.equal(readableTitle('REST_DAY_ROSTER'), 'Rest day roster');
	assert.equal(readableTitle('FORM_E_CP8D'), 'Form E CP8D');
	assert.equal(readableTitle('EPF_EMPLOYEE_REGISTRATION'), 'EPF employee registration');
	assert.equal(readableTitle('Late for work: A (1)'), 'Late for work: A (1)');
});

it('amounts print at the minor units given, else the currency’s own', () => {
	assert.match(formatNumeric('1500000.00', 'IDR'), /^1[,.]?500[,.]?000$/);
	assert.match(formatNumeric('1234.50', 'TWD', 0), /^1[,.]?235$/);
	assert.match(formatNumeric('12.5', 'SGD'), /12[.,]50$/);
});
