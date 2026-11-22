import { automation } from '@norbital-ai/bolt';

export default automation({
	description:
		'Publishes a 06:00 Singapore morning site-control digest of open critical/high issues, blocked or overdue tasks, pending variation orders, and draft/submitted payment claims.',
	on: [{ cron: '0 6 * * *', tz: 'Asia/Singapore', rest: '7d' }],
	policies: ['construction_automation'],
	output: {
		kind: 'object',
		fields: {
			generated_at: { kind: 'instant' },
			critical_high_issues_count: { kind: 'int' },
			blocked_or_overdue_tasks_count: { kind: 'int' },
			pending_changes_count: { kind: 'int' },
			pending_claims_count: { kind: 'int' }
		}
	},
	run: function* (_, ctx) {
		const data = yield* ctx.query({
			issues: {
				where: {
					status: { in: ['open', 'in_progress', 'ready_for_verification'] },
					severity: { in: ['critical', 'high'] }
				},
				aggregate: { count: true }
			},
			tasks: {
				where: { status: { in: ['todo', 'in_progress', 'blocked'] } },
				fields: ['status', 'schedule_range']
			},
			change_orders: {
				where: { status: { in: ['draft', 'submitted', 'under_review'] } },
				aggregate: { count: true }
			},
			payment_claims: {
				where: { status: { in: ['draft', 'submitted'] } },
				aggregate: { count: true }
			}
		});

		const criticalHighIssues = data.issues.count ?? 0;
		const blockedOrOverdueTasks = data.tasks.rows.filter(
			(t) =>
				t.status === 'blocked' || (t.schedule_range?.to != null && t.schedule_range.to < ctx.today)
		).length;
		const pendingChanges = data.change_orders.count ?? 0;
		const pendingClaims = data.payment_claims.count ?? 0;

		const totalAttention =
			criticalHighIssues + blockedOrOverdueTasks + pendingChanges + pendingClaims;
		if (totalAttention > 0) {
			yield* ctx.notify({
				title: `Morning site digest: ${criticalHighIssues} critical/high issue(s), ${blockedOrOverdueTasks} blocked/overdue task(s)`,
				description: `Pending variations: ${pendingChanges} · Draft/submitted claims: ${pendingClaims}`,
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
			pending_changes_count: pendingChanges,
			pending_claims_count: pendingClaims
		};
	}
});
