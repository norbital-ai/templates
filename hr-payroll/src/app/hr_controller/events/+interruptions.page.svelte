<script lang="ts">
	import { bolt } from '$bolt';
	import { fork } from '@norbital-ai/ui/effect';
	import { Effect } from 'effect';
	import type { ActInput } from '@norbital-ai/bolt';
	import { PlainDate } from '@norbital-ai/std/date';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { Table, EmptyState, RecordShell, Sheet } from '@norbital-ai/ui';
	import CompanyScope from '../../../lib/ui/scopes/company_picker.svelte';
	import { companyScope } from '../../../lib/ui/scopes/company_scope.svelte.js';
	import { parseInterruptionSheet } from '../../../lib/payroll_engine/entry_workbook.js';
	import {
		runWorkbookImport,
		type WorkbookGrids
	} from '../../../lib/ui/workbook/workbook_import.js';
	const scope = companyScope();
	let creating = $state(false);
	let importing = $state(false);
	let warnings: readonly string[] = [];

	const held = $derived.by(() =>
		scope.id == null
			? null
			: bolt.query({
					jurisdiction_settings: {
						where: { status: { eq: 'SEALED' } },
						fields: ['code', 'effective_range'],
						limit: 10000
					},
					work_interruption_catalog: {
						fields: ['code', 'name', 'settings_id'],
						limit: 10000
					},
					work_interruption_catalog_entry: {
						where: { entity_id: { eq: scope.id } },
						fields: ['entity_id', 'catalog_id', 'period'],
						limit: 10000
					}
				})
	);

	const entities = $derived(
		scope.entities.map((row) => ({
			id: row.id,
			code: row.code ?? null,
			name: row.name,
			settings_code: row.settings_code
		}))
	);

	function interruptionRows(
		grids: WorkbookGrids
	): ActInput<'work_interruption_catalog_entry.create'> {
		const current = held?.current;
		const company = scope.company;
		const entityId = scope.id;
		if (current == null || company == null || entityId == null)
			throw new Error('Interruption data is still loading.');
		const parsed = parseInterruptionSheet(grids, {
			entity: {
				id: entityId,
				code: company.code ?? null,
				name: company.name,
				settings_code: company.settings_code
			},
			employees: [],
			versions: current.jurisdiction_settings.rows.map((row) => ({
				id: row.id,
				code: row.code,
				from: row.effective_range.from,
				to: row.effective_range.to
			})),
			catalogs: current.work_interruption_catalog.rows.map((row) => ({
				id: row.id,
				code: row.code,
				settings_id: row.settings_id
			})),
			entities,
			existing: current.work_interruption_catalog_entry.rows.map((row) => ({
				entity_id: row.entity_id,
				catalog_id: row.catalog_id,
				from: row.period.from,
				to: row.period.to
			}))
		});
		warnings = parsed.warnings;
		return parsed.rows.map((row) => ({
			catalog_id: row.catalog_id,
			entity_id: row.entity_id,
			period: { from: PlainDate(row.from), to: PlainDate(row.to) },
			...(row.worksite == null ? {} : { worksite: row.worksite }),
			...(row.reason == null ? {} : { reason: row.reason })
		}));
	}

	function importInterruptions() {
		importing = true;
		fork(
			runWorkbookImport({
				action: 'work_interruption_catalog_entry.create',
				recordLabel: bolt.t('v2.interruptions').toLowerCase(),
				buildPayload: interruptionRows,
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

<AppShell
	title={bolt.t('v2.interruptions')}
	description={bolt.t('v2.interruptions_help')}
	icon="lucide:calendar-off"
>
	{#snippet actions()}<CompanyScope {scope} />{/snippet}
	{#if scope.id === null}<EmptyState title={bolt.t('app.events.empty_scope')} />
	{:else}<Table
			of="work_interruption_catalog_entry"
			key="work_interruption_catalog_entry"
			where={{ entity_id: { eq: scope.id } }}
			toolbar={{
				new: () => (creating = true),
				title: bolt.t('v2.interruptions'),
				actions: [
					{
						run: importInterruptions,
						icon: 'lucide:file-spreadsheet',
						name: bolt.t('holiday_calendar.import_spreadsheet'),
						disabled: () =>
							importing || held?.current == null ? bolt.t('component.loading') : null
					}
				]
			}}
			columns={['catalog_id', 'period', 'worksite', 'reason', 'payroll_run_id']}
		/>{/if}
</AppShell>
{#if creating && scope.id !== null}<Sheet
		open
		onOpenChange={(open) => !open && (creating = false)}
		title={bolt.t('v2.interruptions')}
		><RecordShell
			of="work_interruption_catalog_entry"
			mode="create"
			values={{ entity_id: scope.id }}
			onDone={() => (creating = false)}
		/></Sheet
	>{/if}
