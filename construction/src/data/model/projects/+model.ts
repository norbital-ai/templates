import { model } from '@norbital-ai/bolt';

const columns = [
	'project_name',
	'project_number',
	'project_role',
	'client',
	'main_contractor',
	'project_manager',
	'project_type',
	'status',
	'schedule_range',
	'currency',
	'contract_value',
	'retention_rate',
	'retention_cap_rate',
	'tax_rate',
	'payment_terms_days',
	'autodesk_project_id',
	'zones',
	'capture_rules',
	'address',
	'description'
] as const;

export default model('projects', {
	description:
		'Construction projects usable by main contractors managing subcontractors or subcontractors managing their own works, with programme, cashflow terms, Autodesk project link, zones, and WhatsApp/email capture rules.',
	icon: 'lucide:building-2',
	record_label:
		"record.project_number != null ? record.project_number + ' · ' + record.project_name : record.project_name",
	fields: {
		project_name: { kind: 'text' },
		project_number: { kind: 'text', optional: true },
		/** Defines whether this workspace acts as main contractor, subcontractor, or specialist trade contractor. */
		project_role: {
			kind: 'enum',
			values: ['main_contractor', 'subcontractor', 'specialist_contractor'],
			default: 'main_contractor'
		},
		client: { kind: 'text', optional: true },
		main_contractor: { kind: 'text', optional: true },
		project_manager: { kind: 'text', optional: true },
		project_type: { kind: 'text', optional: true },
		status: {
			kind: 'state',
			initial: 'active',
			states: {
				tendering: { to: ['active', 'cancelled'] },
				active: { to: ['tendering', 'on_hold', 'defects_liability', 'complete', 'cancelled'] },
				on_hold: { to: ['active', 'cancelled'] },
				defects_liability: { to: ['complete', 'active'] },
				complete: { to: ['defects_liability'] },
				cancelled: { to: ['tendering', 'active'] }
			}
		},
		schedule_range: { kind: 'period', of: 'date', optional: true },
		currency: { kind: 'currency', default: 'SGD' },
		contract_value: { kind: 'money', currency: 'currency', optional: true },
		retention_rate: { kind: 'decimal', scale: 2, default: 10 },
		retention_cap_rate: { kind: 'decimal', scale: 2, default: 5 },
		tax_rate: { kind: 'decimal', scale: 2, default: 9 },
		/** Standard payment cycle in calendar days used to forecast cashflow due dates. */
		payment_terms_days: { kind: 'int', min: 0, max: 180, default: 30 },
		/** Optional Autodesk Construction Cloud / BIM 360 project ID for schedule and BIM sync. */
		autodesk_project_id: { kind: 'text', optional: true },
		/** Co-located storeys, zones, grid axes, and elevations owned by this project. */
		zones: { kind: 'custom', of: 'project_zones', optional: true },
		/** Project-specific WhatsApp and email routing and extraction rules. */
		capture_rules: { kind: 'text', format: 'markdown', optional: true },
		address: { kind: 'custom', of: 'project_address', optional: true },
		description: { kind: 'text', format: 'markdown', optional: true },
		open_task_count: {
			kind: 'count',
			of: 'tasks',
			where: { status: { in: ['todo', 'in_progress', 'blocked'] } }
		},
		open_issue_count: {
			kind: 'count',
			of: 'issues',
			where: { status: { in: ['open', 'in_progress', 'ready_for_verification'] } }
		},
		active_contract_count: {
			kind: 'count',
			of: 'contracts',
			where: { status: { in: ['under_review', 'active'] } }
		},
		open_document_count: {
			kind: 'count',
			of: 'commercial_documents',
			where: { status: { in: ['issued', 'verified', 'certified', 'disputed'] } }
		}
	},
	constraints: {
		project_number: { unique: ['project_number'] },
		valid_retention_rate: { check: { retention_rate: { gte: 0, lte: 100 } } },
		valid_retention_cap: { check: { retention_cap_rate: { gte: 0, lte: 100 } } },
		valid_tax_rate: { check: { tax_rate: { gte: 0, lte: 100 } } }
	},
	indexes: { find: { text: ['project_name', 'project_number', 'client', 'main_contractor'] } },
	outputs: { default: { fields: 'all' } },
	create: { fields: columns.filter((f) => f !== 'status') },
	update: { fields: columns }
});
