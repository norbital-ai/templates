<script lang="ts">
	import { bolt } from '$bolt';
	import { fork } from '@norbital-ai/ui/effect';
	import { Effect } from 'effect';
	import type { ActInput, Id } from '@norbital-ai/bolt';
	import { PlainDate } from '@norbital-ai/std/date';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { Table, EmptyState, Sheet, toast } from '@norbital-ai/ui';
	import LeaveEntryForm from '../../../lib/ui/person/leave_entry_form.svelte';
	import CompanyScope from '../../../lib/ui/scopes/company_picker.svelte';
	import { companyScope } from '../../../lib/ui/scopes/company_scope.svelte.js';
	import { parseLeaveSheet } from '../../../lib/payroll_engine/entry_workbook.js';
	import { idOf } from '../../../lib/payroll_engine/reads.js';
	import {
		runWorkbookImport,
		type WorkbookGrids
	} from '../../../lib/ui/workbook/workbook_import.js';
	const scope = companyScope();
	let creating = $state(false);
	type ReversingRow = {
		readonly id: Id<'leave_catalog_entry'>;
		readonly employment_id: Id<'employee_contract'>;
		readonly catalog_id: Id<'leave_catalog'>;
		readonly encashment: boolean;
	};
	let reversingRow = $state<ReversingRow | null>(null);
	let importing = $state(false);
	let warnings: readonly string[] = [];

	const held = $derived.by(() =>
		scope.id == null
			? null
			: bolt.query({
					employee_contract: {
						where: { entity_id: { eq: scope.id }, status: { eq: 'SEALED' } },
						fields: ['employee_number', 'entity_id', 'effective_range'],
						limit: 10000
					},
					jurisdiction_settings: {
						where: { status: { eq: 'SEALED' } },
						fields: ['code', 'effective_range'],
						limit: 10000
					},
					leave_catalog: { fields: ['code', 'settings_id'], limit: 10000 },
					leave_catalog_entry: {
						where: { entity_id: { eq: scope.id } },
						fields: ['employment_id', 'catalog_id', 'reverses'],
						limit: 10000
					},
					'leave_catalog_entry.leave_catalog_entry_day': {
						fields: ['incurred_on', 'part'],
						limit: 10000
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
			versions: current.jurisdiction_settings.rows.map((row) => ({
				id: row.id,
				code: row.code,
				from: row.effective_range.from,
				to: row.effective_range.to
			})),
			catalogs: current.leave_catalog.rows.map((row) => ({
				id: row.id,
				code: row.code,
				settings_id: row.settings_id
			})),
			existing: current.leave_catalog_entry.rows.map((row) => ({
				employment_id: row.employment_id,
				catalog_id: row.catalog_id,
				days: (row.leave_catalog_entry_day ?? []).map((child) => ({
					date: String(child.incurred_on),
					part: child.part
				})),
				reverses: row.reverses
			}))
		});
		warnings = parsed.warnings;
		return parsed.rows.map((row) => ({
			entity_id: row.entity_id,
			employment_id: row.employment_id,
			catalog_id: row.catalog_id,
			leave_catalog_entry_day: row.days.map((day) => ({
				incurred_on: PlainDate(day.date),
				part: day.part
			}))
		}));
	}

	function importLeave() {
		importing = true;
		fork(
			runWorkbookImport({
				action: 'leave_catalog_entry.create',
				recordLabel: bolt.t('app.leave.title').toLowerCase(),
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
			of="leave_catalog_entry"
			key="leave-requests"
			where={{ entity_id: { eq: scope.id } }}
			toolbar={{
				new: () => (creating = true),
				title: bolt.t('v2.leave_requests'),
				actions: [
					{
						run: importLeave,
						icon: 'lucide:file-spreadsheet',
						name: bolt.t('holiday_calendar.import_spreadsheet'),
						disabled: () =>
							importing || held?.current == null ? bolt.t('component.loading') : null
					}
				]
			}}
			columns={['employment_id', 'catalog_id']}
			actions={[
				{
					label: 'Reverse entry',
					run: (row) => {
						const ref = (value: unknown): string => {
							if (typeof value === 'string') return value;
							if (value !== null && typeof value === 'object' && 'id' in value)
								return String((value as { readonly id: unknown }).id);
							return '';
						};
						const id = ref(row.id);
						const employment = ref(row.employment_id);
						const catalog = ref(row.catalog_id);
						if (id === '' || employment === '' || catalog === '') {
							toast.error('The leave entry is still loading.');
							return;
						}
						reversingRow = {
							id: idOf('leave_catalog_entry', id),
							employment_id: idOf('employee_contract', employment),
							catalog_id: idOf('leave_catalog', catalog),
							// a reversal of a cash-out must stay a cash-out: its conversion returns money only with the flag
							encashment: row.encashment === true
						};
					}
				}
			]}
		/>{/if}{/snippet}
<AppShell
	title={bolt.t('app.leave.title')}
	description={bolt.t('v2.leave_help')}
	icon="lucide:calendar-check-2"
>
	{#snippet actions()}<CompanyScope {scope} />{/snippet}
	{#if scope.id === null}<EmptyState
			title={bolt.t('app.events.empty_scope')}
		/>{:else}{@render requests()}{/if}
</AppShell>
{#if creating && scope.id !== null}<Sheet
		open
		onOpenChange={(open) => !open && (creating = false)}
		title={bolt.t('v2.leave_requests')}
		><LeaveEntryForm allowReversal entityId={scope.id} onDone={() => (creating = false)} /></Sheet
	>{/if}
{#if reversingRow !== null && scope.id !== null}{#key reversingRow.id}<Sheet
		open
		onOpenChange={(open) => !open && (reversingRow = null)}
		title="Reverse leave"
		><LeaveEntryForm
			allowReversal
			entityId={scope.id}
			employmentId={reversingRow.employment_id}
			catalogId={reversingRow.catalog_id}
			encashment={reversingRow.encashment}
			reverses={reversingRow.id}
			onDone={() => (reversingRow = null)}
		/></Sheet
	>{/key}{/if}
