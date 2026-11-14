<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { Table, EmptyState, Sheet } from '@norbital-ai/ui';
	import LeaveEntryForm from '../../../lib/ui/person/leave_entry_form.svelte';
	import CompanyScope from '../../../lib/ui/scopes/company_picker.svelte';
	import { companyScope } from '../../../lib/ui/scopes/company_scope.svelte.js';
	import { pageLaws } from '../../../lib/ui/law.svelte.js';
	import { parseLeaveSheet } from '../../../lib/payroll_engine/entry_workbook.js';
	import { entryImport } from '../../../lib/ui/workbook/entry_import.svelte.js';
	let { ctx }: { ctx: PageContext } = $props();
	const scope = companyScope(ctx);
	const laws = pageLaws(ctx, () => (scope.company == null ? [] : [scope.company.settings_code]));
	let creating = $state(false);

	const held = $derived.by(() =>
		scope.id == null
			? null
			: ctx.query({
					employment: {
						where: { entity_id: { eq: scope.id } },
						fields: ['employee_number', 'entity_id', 'effective_range'],
						limit: 10000
					},
					leave_catalog_entry: {
						where: { entity_id: { eq: scope.id } },
						fields: ['employment_id', 'catalog_code'],
						limit: 10000,
						leave_catalog_entry_day: { fields: ['incurred_on', 'part'] }
					}
				})
	);

	const importLeave = entryImport(ctx, scope, laws, {
		action: 'leave_catalog_entry.create',
		label: () => ctx.t('app.leave.title'),
		held: () => held?.current,
		loading: 'Employee and leave data is still loading.',
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

{#snippet requests()}{#if scope.id !== null}<Table
			{ctx}
			of="leave_catalog_entry"
			key="leave-requests"
			where={{ entity_id: { eq: scope.id } }}
			toolbar={{
				new: () => (creating = true),
				title: ctx.t('v2.leave_requests'),
				actions: [importLeave(ctx.t('holiday_calendar.import_spreadsheet'))]
			}}
			columns={['employment_id', 'catalog_code']}
		/>{/if}{/snippet}
<AppShell
	title={ctx.t('app.leave.title')}
	description={ctx.t('v2.leave_help')}
	icon="lucide:calendar-check-2"
>
	{#snippet actions()}<CompanyScope {ctx} {scope} />{/snippet}
	{#if scope.id === null}<EmptyState
			title={ctx.t('app.events.empty_scope')}
		/>{:else}{@render requests()}{/if}
</AppShell>
{#if creating && scope.id !== null}<Sheet
		open
		on_open_change={(open) => !open && (creating = false)}
		title={ctx.t('v2.leave_requests')}
		><LeaveEntryForm {ctx} entityId={scope.id} onDone={() => (creating = false)} /></Sheet
	>{/if}
