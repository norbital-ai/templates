import { model } from '@norbital-ai/bolt';

export default model({
	description:
		'One statutory catalog item of an immutable jurisdiction version. Its configuration declares qualified sources, eligibility, ordered assessment programs, dependencies and employer-month remittance behaviour. Original policy data and source identities remain inside the same configuration.',
	icon: 'lucide:landmark',
	label: 'name',
	fields: {
		code: {
			kind: 'text'
		},
		name: {
			kind: 'text'
		},
		authority: {
			kind: 'text',
			optional: true
		},
		configuration: {
			kind: 'json',
			shape: {
				kind: 'object',
				fields: {
					person: {
						kind: 'record',
						of: { kind: 'text', format: 'cel' },
						optional: true,
						help: 'Person facts this scheme reads, each a CEL expression over the statutory context (for example the age basis), merged into `person`.'
					},
					assessable: {
						kind: 'record',
						of: { kind: 'text', format: 'cel' },
						optional: true,
						help: 'The month-to-date assessable amount of each wage part (ceilings, projections), CEL over `wage`, `month`, `year`, `period` and `terms`. A part without an expression is assessed as paid.'
					},
					assessment: { kind: 'text', format: 'cel', optional: true },
					refuse_when: {
						kind: 'list',
						of: {
							kind: 'object',
							fields: { when: { kind: 'text', format: 'cel' }, message: { kind: 'text' } }
						},
						optional: true,
						help: 'Guards evaluated before the rules: the first that holds refuses the payslip with its message.'
					},
					rules: {
						kind: 'list',
						of: {
							kind: 'object',
							fields: {
								when: { kind: 'text', format: 'cel', optional: true },
								employee: { kind: 'text', format: 'cel', optional: true },
								employer: { kind: 'text', format: 'cel', optional: true },
								contribution: { kind: 'text', format: 'cel', optional: true }
							}
						},
						optional: true
					},
					limitation: { kind: 'text', optional: true }
				}
			},
			help: 'Original legal policy plus executable input, record, derivation, assessment and finalization configuration. Missing source evidence never establishes zero liability.'
		}
	}
});
