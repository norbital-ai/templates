<script lang="ts">
	import type { PageContext } from '@norbital-ai/bolt/page';
	import { fork } from '@norbital-ai/ui/effect';
	import { Effect } from 'effect';
	import type { ActInput, Id } from '@norbital-ai/bolt';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { Table, EmptyState, Sheet, toast } from '@norbital-ai/ui';
	import LeaveEntryForm from '../../../lib/ui/person/leave_entry_form.svelte';
	import CompanyScope from '../../../lib/ui/scopes/company_picker.svelte';
	import { companyScope } from '../../../lib/ui/scopes/company_scope.svelte.js';
	import { pageLaws } from '../../../lib/ui/law.svelte.js';
	import { parseLeaveSheet } from '../../../lib/payroll_engine/entry_workbook.js';
	import { idOf } from '../../../lib/payroll_engine/reads.js';
	import {
		runWorkbookImport,
		type WorkbookGrids
	} from '../../../lib/ui/workbook/workbook_import.js';
	let { ctx }: { ctx: PageContext } = $props();
	const scope = companyScope(ctx);
	const laws = pageLaws(ctx, () => (scope.company == null ? [] : [scope.company.settings_code]));
	let creating = $state(false);
	let importing = $state(false);
	let warnings: readonly string[] = [];

	const held = $derived.by(() =>
		scope.id == null
			? null
			: ctx.query({
					employee_contract: {
						where: { entity_id: { eq: scope.id }, status: { eq: 'SEALED' } },
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

	function leaveRows(grids: WorkbookGrids): ActInput<'leave_catalog_entry.create'> {
		const current = held?.current;
		const company = scope.company;
		const entityId = scope.id;
		if (current == null || company == null || entityId == null)
			throw new Error('Employee and leave data is still loading.');
		const parsed = parseLeaveSheet(grids, {
			entity: {
				id: entityId,
				code: company.code ?? null,
				name: company.name,
				settings_code: company.settings_code
			},
			employees: current.employee_contract.rows.map((row) => ({
				id: row.id,
				number: row.employee_number,
				entity_id: row.entity_id,
				from: row.effective_range.from,
				to: row.effective_range.to
			})),
			laws: laws.on,
			existing: current.leave_catalog_entry.rows.map((row) => ({
				employment_id: row.employment_id,
				catalog_code: row.catalog_code,
				days: (row.leave_catalog_entry_day ?? []).map((child) => ({
					date: String(child.incurred_on),
					part: child.part
				}))
			}))
		});
		warnings = parsed.warnings;
		return parsed.rows.map((row) => ({
			entity_id: row.entity_id,
			employment_id: row.employment_id,
			catalog_code: row.catalog_code,
			leave_catalog_entry_day: row.days.map((day) => ({
				incurred_on: day.date,
				part: day.part
			}))
		}));
	}

	function importLeave() {
		importing = true;
		fork(
			runWorkbookImport(ctx, {
				action: 'leave_catalog_entry.create',
				recordLabel: ctx.t('app.leave.title').toLowerCase(),
				buildPayload: leaveRows,
				importedCount: (payload) => payload.length,
				warnings: () => warnings
			}).pipe(
				Effect.ensuring(
					Effect.sync(() => {
						importing = false;
					})
				)
			)
		);
	}
</script>

{#snippet requests()}{#if scope.id !== null}<Table
			{ctx}
			of="leave_catalog_entry"
			key="leave-requests"
			where={{ entity_id: { eq: scope.id } }}
			toolbar={{
				new: () => (creating = true),
				title: ctx.t('v2.leave_requests'),
				actions: [
					{
						run: importLeave,
						icon: 'lucide:file-spreadsheet',
						name: ctx.t('holiday_calendar.import_spreadsheet'),
						disabled: () =>
							importing || held?.current == null || laws.loading ? ctx.t('component.loading') : null
					}
				]
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
