<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { stintNames } from '../../../lib/ui/person/stint_names.svelte.js';
	import { Table, Sheet } from '@norbital-ai/ui';
	import EventPage from '../../../lib/ui/events/event_page.svelte';
	import LeaveEntryForm from '../../../lib/ui/person/leave_entry_form.svelte';
	import { companyScope } from '../../../lib/ui/scopes/company_scope.svelte.js';
	import { pageLaws } from '../../../lib/ui/law.svelte.js';
	import { parseLeaveSheet } from '../../../data/model/entry/service/entry_workbook.js';
	import { employmentQuery, entryImport } from '../../../lib/ui/workbook/entry_import.svelte.js';
	let { ctx }: { ctx: PageContext } = $props();
	const scope = companyScope(ctx);
	const stints = stintNames(ctx, () => scope.id);
	const laws = pageLaws(ctx, () => (scope.company == null ? [] : [scope.company.settings_code]));
	let creating = $state(false);

	const importLeave = entryImport(ctx, scope, laws, {
		action: 'leave_catalog_entry.create',
		label: () => ctx.t('app.leave.title'),
		load: (companyId) =>
			ctx.query({
				employment: employmentQuery(companyId),
				leave_catalog_entry: {
					where: { entity_id: { eq: companyId } },
					fields: ['employment_id', 'catalog_code'],
					limit: 10000,
					leave_catalog_entry_day: { fields: ['incurred_on', 'part'] }
				}
			}),
		build: (grids, current, party) => {
			const parsed = parseLeaveSheet(grids, {
				...party,
				existing: current.leave_catalog_entry.rows.map((row) => ({
					employment_id: row.employment_id,
					catalog_code: row.catalog_code,
					days: (row.leave_catalog_entry_day ?? []).map((child) => ({
						date: String(child.incurred_on),
						part: child.part
					}))
				}))
			});
			return {
				warnings: parsed.warnings,
				rows: parsed.rows.map((row) => ({
					entity_id: row.entity_id,
					employment_id: row.employment_id,
					catalog_code: row.catalog_code,
					leave_catalog_entry_day: row.days.map((day) => ({
						incurred_on: day.date,
						part: day.part
					}))
				}))
			};
		}
	});
</script>

{#snippet who({ value }: { value: unknown })}{stints.of(value)}{/snippet}

<EventPage
	{ctx}
	{scope}
	title={ctx.t('app.leave.title')}
	description={ctx.t('v2.leave_help')}
	icon="lucide:calendar-check-2"
	bind:creating
>
	{#snippet children(companyId)}<Table
			{ctx}
			of="leave_catalog_entry"
			key="leave-requests"
			where={{ entity_id: { eq: companyId } }}
			toolbar={{
				new: () => (creating = true),
				title: ctx.t('v2.leave_requests'),
				actions: [importLeave(ctx.t('import.leave'))]
			}}
			columns={[{ field: 'employment_id', cell: who }, 'catalog_code']}
		/>{/snippet}
	{#snippet create(entityId)}<Sheet
			open
			on_open_change={(open) => !open && (creating = false)}
			title={ctx.t('v2.leave_requests')}
			><LeaveEntryForm {ctx} {entityId} onDone={() => (creating = false)} /></Sheet
		>{/snippet}
</EventPage>
