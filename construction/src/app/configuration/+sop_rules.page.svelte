<script lang="ts">
	/**
	 * Configuration → Compliance & SOP: dynamic BCA / SCDF / PUB / URA / CORENET X & company SOP rules.
	 */
	import type { Id } from '@norbital-ai/bolt';
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { Table } from '@norbital-ai/ui';
	import { Effect } from 'effect';

	let { ctx }: { ctx: PageContext } = $props();
	const t: PageContext['t'] = (...args) => ctx.t(...args);
	const canEditRule = $derived(ctx.catalog?.sop_rules?.update !== undefined);

	const toggleActive = (ids: readonly Id<'sop_rules'>[]) =>
		Effect.gen(function* () {
			const rows = (yield* ctx.query({
				sop_rules: {
					where: { id: { in: [...ids] } },
					fields: ['revision', 'active'],
					limit: ids.length
				}
			})).sop_rules.rows;
			return yield* ctx.act({
				'sop_rules.update': rows.map((row) => ({
					target: { id: row.id, revision: row.revision },
					set: { active: !row.active }
				}))
			});
		});
</script>

<AppShell
	icon="lucide:shield-check"
	title={t('sop_rules.tab_title')}
	description={t('sop_rules.description')}
>
	<Table
		{ctx}
		of="sop_rules"
		key="config:sop-rules"
		order_by={{ code: 'asc' }}
		page_size={50}
		toolbar={{
			title: false,
			actions: canEditRule
				? [
						{
							icon: 'lucide:power',
							name: t('sop_rules.toggle_active'),
							description: t('sop_rules.toggle_active_desc'),
							requires_selection: true,
							run: toggleActive
						}
					]
				: []
		}}
		columns={[
			'code',
			'name',
			'authority',
			'severity',
			'scope',
			'metric',
			'threshold_num',
			'threshold_text',
			'clause_ref',
			'active'
		]}
	/>
</AppShell>
