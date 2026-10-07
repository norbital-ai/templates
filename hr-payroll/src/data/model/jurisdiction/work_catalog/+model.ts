import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'The pay lines a contract and its roster produce for one jurisdiction version: basic salary, overtime and no-pay leave. Each row prices one line as quantity × rate, both CEL over the payslip context, and names the schemes it counts toward.',
	icon: 'lucide:clock',
	label: 'name',
	fields: {
		code: { kind: 'text' },
		name: { kind: 'text', optional: true },
		authority: { kind: 'text', format: 'markdown', optional: true },
		component_code: { kind: 'text' },
		eligibility: {
			kind: 'text',
			help: 'CEL predicate over the payslip context; the line is produced only when it holds.'
		},
		quantity: { kind: 'text', help: 'CEL quantity over the payslip context.' },
		rate: { kind: 'text', help: 'CEL rate over the payslip context.' },
		prorated: {
			kind: 'bool',
			default: false,
			help: 'The line is the contract amount scaled to the days employed; the payslip records its proration.'
		},
		destination: { kind: 'enum', values: ['PAY', 'NET', 'EMPLOYER'] },
		direction: { kind: 'enum', values: ['ADD', 'SUBTRACT'] },
		counts_toward: { kind: 'json', shape: { kind: 'list', of: { kind: 'text' } }, default: [] }
	}
});
