import { automation } from '@norbital-ai/bolt';
import { addCalendarDays } from '../lib/dates.js';

export default automation({
	description:
		'Publishes a 06:00 Singapore morning digest of critical/high issues, blocked or overdue tasks, contracts under review, and overdue PO/DO/Invoices/Claims.',
	on: [{ cron: '0 6 * * *', tz: 'Asia/Singapore' }],
	policies: ['construction_automation'],
	output: {
		kind: 'object',
		fields: {
			generated_at: { kind: 'instant' },
			critical_high_issues_count: { kind: 'int' },
			blocked_or_overdue_tasks_count: { kind: 'int' },
			pending_contracts_count: { kind: 'int' },
			overdue_documents_count: { kind: 'int' }
		}
	},
	run: function* (_, ctx) {
		const yesterday = addCalendarDays(ctx.today, -1);
		const data = yield* ctx.query({
			issues: {
				where: {
					status: { in: ['open', 'in_progress', 'ready_for_verification'] },
					severity: { in: ['critical', 'high'] }
				},
				aggregate: { count: true }
			},
			tasks: {
				where: {
					status: { in: ['todo', 'in_progress', 'blocked'] },
					or: [
						{ status: { eq: 'blocked' } },
						{ schedule_range: { ends_within: { from: '1900-01-01', to: yesterday } } }
					]
				},
				aggregate: { count: true }
			},
			contracts: {
				where: { status: { in: ['draft', 'under_review'] } },
				aggregate: { count: true }
			},
			commercial_documents: {
				where: {
					status: { in: ['issued', 'verified', 'certified', 'disputed'] },
					due_date: { lt: ctx.today }
				},
				aggregate: { count: true }
			}
		});

		const criticalHighIssues = data.issues.count ?? 0;
		const blockedOrOverdueTasks = data.tasks.count ?? 0;
		const pendingContracts = data.contracts.count ?? 0;
		const overdueDocs = data.commercial_documents.count ?? 0;

		const totalAttention =
			criticalHighIssues + blockedOrOverdueTasks + pendingContracts + overdueDocs;
		if (totalAttention > 0) {
			yield* ctx.notify({
				title: `Morning digest: ${criticalHighIssues} critical/high issue(s), ${blockedOrOverdueTasks} blocked/overdue task(s)`,
				description: `Contracts/VOs pending: ${pendingContracts} · Overdue invoices/claims: ${overdueDocs}`,
				to: [
					{ team: 'project_delivery' },
					{ team: 'commercial_qs' },
					{ team: 'construction_administrators' }
				],
				once: `construction-digest:${ctx.today}`
			});
		}

		return {
			generated_at: ctx.now,
			critical_high_issues_count: criticalHighIssues,
			blocked_or_overdue_tasks_count: blockedOrOverdueTasks,
			pending_contracts_count: pendingContracts,
			overdue_documents_count: overdueDocs
		};
	}
});
