import { model, type Id, type WriteCtx } from '@norbital-ai/bolt';

/** Work to do, with one owner, due date and native completion state. Calendar and reminders read these rows. */
export default model('tasks', {
	description: 'A task or follow-up, linked to its company, job or meeting.',
	icon: 'lucide:list-checks',
	record_label: 'record.subject',
	fields: {
		subject: { kind: 'text' },
		kind: { kind: 'enum', values: ['task', 'follow_up'], default: 'task' },
		detail: { kind: 'text', format: 'markdown', optional: true },
		due_on: { kind: 'date' },
		attachments: { kind: 'file', many: true, optional: true, accept: ['*/*'], max: '20MiB' },
		owner: { kind: 'ref', to: 'sys_user', optional: true, default: { var: 'actor.id' } },
		status: {
			kind: 'state',
			initial: 'open',
			states: {
				open: { to: ['done', 'cancelled'] },
				done: { to: ['open'] },
				cancelled: { to: ['open'] }
			}
		},
		company: { kind: 'ref', to: 'companies', inverse: 'tasks', optional: true },
		project_id: { kind: 'ref', to: 'projects', inverse: 'tasks', optional: true },
		contact_id: { kind: 'ref', to: 'contacts', inverse: 'tasks', optional: true },
		meeting: { kind: 'ref', to: 'activities', inverse: 'action_items', optional: true },
		reminder: {
			kind: 'enum',
			values: ['none', 'before', 'due', 'overdue', 'escalated'],
			default: 'none'
		},
		reminded_at: { kind: 'instant', optional: true }
	},
	indexes: { by_status_due: { on: ['status', 'due_on'] }, find: { text: ['subject', 'detail'] } },
	outputs: {
		default: {
			fields: 'all',
			company: { fields: ['name', 'stage'] },
			project_id: { fields: ['name'] },
			contact_id: { fields: ['full_name'] },
			owner: { fields: ['name'] },
			meeting: { fields: ['subject'] }
		}
	},
	create: {
		fields: [
			'subject',
			'kind',
			'detail',
			'attachments',
			'due_on',
			'owner',
			'company',
			'project_id',
			'contact_id',
			'meeting'
		],
		transform: function* (changes, ctx) {
			const companies = yield* taskCompanies(
				changes.map((c) => c.after),
				ctx
			);
			return changes.map((c, i) => ({ ...c.set, company: companies[i] ?? null }));
		}
	},
	update: {
		fields: [
			'subject',
			'kind',
			'detail',
			'attachments',
			'due_on',
			'owner',
			'status',
			'company',
			'project_id',
			'contact_id',
			'meeting',
			'reminder',
			'reminded_at'
		],
		transform: function* (changes, ctx) {
			const companies = yield* taskCompanies(
				changes.map((c) => c.after),
				ctx
			);
			return changes.map((c, i) => ({
				...c.set,
				company: companies[i] ?? null,
				...(c.changed('due_on') ||
				c.changed('owner') ||
				(c.changed('status') && c.after.status === 'open')
					? { reminder: 'none' as const, reminded_at: null }
					: {})
			}));
		}
	}
});

function* taskCompanies(
	rows: readonly {
		readonly company?: Id<'companies'> | null;
		readonly project_id?: Id<'projects'> | null;
		readonly contact_id?: Id<'contacts'> | null;
	}[],
	ctx: WriteCtx<'tasks'>
) {
	const { projects, contacts } = yield* ctx.query({
		projects: {
			where: { id: { in: rows.flatMap((r) => (r.project_id == null ? [] : [r.project_id])) } },
			fields: ['company_id']
		},
		contacts: {
			output: 'crm',
			where: { id: { in: rows.flatMap((r) => (r.contact_id == null ? [] : [r.contact_id])) } },
			fields: ['company_id']
		}
	});
	const result = [];
	for (const [row, value] of rows.entries()) {
		const project = projects.rows.find((p) => p.id === value.project_id)?.company_id;
		const contact = contacts.rows.find((c) => c.id === value.contact_id)?.company_id;
		const company = project ?? contact ?? value.company ?? null;
		if (
			(project != null && contact != null && project !== contact) ||
			(value.company != null && company !== value.company)
		)
			return yield* ctx.refuse('errors.task_context', { row });
		result.push(company);
	}
	return result;
}
