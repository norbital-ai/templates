import { model } from '@norbital-ai/bolt';

const columns = [
	'project_id',
	'recorded_on',
	'standard',
	'category',
	'clause_ref',
	'title',
	'severity',
	'status',
	'metric_value',
	'corrective_action',
	'owner',
	'closed_on'
] as const;

export default model('compliance_records', {
	icon: 'lucide:clipboard-check',
	record_label: "record.record_code + ' · ' + record.title",
	description:
		'Project quality, safety, environmental, and BIM governance inspections, non-conformances (NCRs), and statutory gateway records aligned with BCA CONQUAS, CORENET X, ISO 9001, ISO 14001, ISO 45001, and ISO 19650.',
	fields: {
		record_code: { kind: 'seq', pattern: 'CMP-{yyyy}-{000}', per: ['project_id'] },
		project_id: { kind: 'ref', to: 'projects', inverse: 'compliance_records', owned: true },
		recorded_on: { kind: 'date' },
		standard: {
			kind: 'enum',
			values: ['bca_conquas', 'bca_corenet_x', 'iso_9001', 'iso_14001', 'iso_45001', 'iso_19650'],
			default: 'bca_conquas'
		},
		category: {
			kind: 'enum',
			values: [
				'inspection',
				'ncr',
				'safety_metric',
				'environmental',
				'bim_cde',
				'statutory_gateway'
			],
			default: 'inspection'
		},
		clause_ref: { kind: 'text', optional: true },
		title: { kind: 'text' },
		severity: {
			kind: 'enum',
			values: ['low', 'medium', 'high', 'critical'],
			default: 'medium'
		},
		status: {
			kind: 'state',
			initial: 'open',
			states: {
				open: { to: ['in_progress', 'closed', 'verified'] },
				in_progress: { to: ['closed', 'verified', 'open'] },
				closed: { to: ['verified', 'open'] },
				verified: { to: ['open'] }
			}
		},
		metric_value: { kind: 'text', optional: true },
		corrective_action: { kind: 'text', optional: true },
		owner: { kind: 'ref', to: 'sys_user', optional: true },
		closed_on: { kind: 'date', optional: true }
	},
	indexes: {
		by_project_standard: { on: ['project_id', 'standard'] },
		find: { text: ['record_code', 'title', 'clause_ref', 'metric_value'] }
	},
	outputs: {
		default: {
			fields: 'all',
			project_id: { fields: ['project_name', 'project_number'] },
			owner: { fields: ['name'] }
		}
	},
	create: { fields: columns.filter((f) => f !== 'status') },
	update: {
		fields: columns.filter((f) => f !== 'project_id'),
		transform: function* (changes, ctx) {
			return changes.map((c) => {
				if (
					c.changed('status') &&
					(c.after.status === 'closed' || c.after.status === 'verified') &&
					!c.changed('closed_on') &&
					c.after.closed_on == null
				) {
					return { ...c.set, closed_on: ctx.today };
				}
				return c.set;
			});
		}
	},
	delete: {}
});
