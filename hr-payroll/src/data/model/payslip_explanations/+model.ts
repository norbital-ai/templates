import { model } from '@norbital-ai/bolt';

/**
 * Why each line of one payslip is the number it is: per line, the stored expressions the run evaluated with the
 * settings version, the value each produced, the inputs read (revision date and evidence where known), the table
 * rows looked up and every rounding step (`lib/trace/record.ts`). Written once with its payslip, never edited; it
 * goes with the payslip. A row of its own, read one payslip at a time, so no list carries it.
 */
export default model({
	description:
		'The evaluation trace behind each line of one payslip: expressions, settings version, values read, table rows and rounding. Written with the payslip; immutable.',
	icon: 'lucide:list-tree',
	label: 'title',
	fields: {
		lines: {
			kind: 'json',
			shape: {
				kind: 'list',
				of: {
					kind: 'object',
					fields: {
						line: {
							kind: 'object',
							fields: {
								employment_id: { kind: 'text', optional: true },
								kind: { kind: 'enum', values: ['ADJUSTMENT', 'STATUTORY'] },
								code: { kind: 'text' },
								source_id: { kind: 'text', optional: true },
								part: { kind: 'text', optional: true }
							}
						},
						settings_id: { kind: 'text' },
						skipped: { kind: 'number' },
						omitted: { kind: 'number' },
						steps: {
							kind: 'list',
							of: {
								kind: 'object',
								fields: {
									expression: { kind: 'text' },
									value: { kind: 'text' },
									error: { kind: 'text', optional: true },
									reads: {
										kind: 'list',
										of: {
											kind: 'object',
											fields: {
												path: { kind: 'text' },
												value: { kind: 'text' },
												effective_from: { kind: 'text', optional: true },
												evidence: { kind: 'text', optional: true }
											}
										}
									},
									tables: {
										kind: 'list',
										of: {
											kind: 'object',
											fields: {
												fn: { kind: 'enum', values: ['table', 'band', 'bands'] },
												name: { kind: 'text' },
												keys: { kind: 'text' },
												value: { kind: 'text', optional: true },
												row: { kind: 'text' }
											}
										}
									},
									rounding: {
										kind: 'list',
										of: {
											kind: 'object',
											fields: {
												value: { kind: 'number' },
												step: { kind: 'number' },
												mode: { kind: 'text' },
												result: { kind: 'number' }
											}
										}
									}
								}
							}
						}
					}
				}
			}
		}
	},
	// ponytail: a trace has no text of its own; a constant names it, as payslip_wage_periods does
	computed: { title: { kind: 'text', expr: 'Payslip explanation' } },
	unique: [{ fields: ['payslip_id'] }]
});
