<script lang="ts">
	import { fork } from '@norbital-ai/ui/effect';
	import { Effect, Schema, Stream } from 'effect';
	/**
	 * The payroll runs of one legal entity; a run opens on its own payslips. Creating a run is the whole tap: the
	 * transform assembles its payslips from the records in force and the `payroll_run_bookkeeping` automation pins every
	 * consumed catalogue entry to its slip. Selected runs have separate bank-file and salary-listing export actions:
	 * each starts the `payroll_run.sync.export` file export, follows its run, then fetches the run's JSON file and
	 * saves its files (bank files zipped, salary reports laid out as one workbook).
	 */
	import { bolt } from '$bolt';
	import { fileRef } from '@norbital-ai/bolt/page';
	import type { Id, Row } from '@norbital-ai/bolt';
	import { AppShell, Stack } from '@norbital-ai/ui/layout';
	import { Badge, downloadTextFiles, EmptyState, Table, toast, useBolt } from '@norbital-ai/ui';
	import { SalaryReport } from '../../../lib/payroll_engine/salary_report.js';
	import { downloadSalaryReport } from '../../../lib/ui/payroll/salary_report.js';
	import CompanyScope from '../../../lib/ui/scopes/company_picker.svelte';
	import { companyScope } from '../../../lib/ui/scopes/company_scope.svelte.js';
	import RunCreate from '../../../lib/ui/payroll/run_create.svelte';
	const scope = companyScope();
	const runs = useBolt().runs;
	let creating = $state(false);
	let exporting = $state(false);
	const EXPORT = 'payroll_run.sync.export';
	/** The export run's result: its stored file. */
	const Exported = Schema.Struct({
		file: Schema.Struct({ id: Schema.String, name: Schema.String, mime: Schema.String })
	});
	/** The export file's records: one file each. */
	const Files = Schema.fromJsonString(
		Schema.Array(Schema.Struct({ name: Schema.String, content: Schema.String }))
	);
	const failed = (message: string) => Effect.fail(new Error(message));
	function exportPayroll(ids: Id<'payroll_run'>[], kind: 'BANK' | 'SALARY'): void {
		if (ids.length === 0 || exporting) return;
		exporting = true;
		fork(
			Effect.gen(function* () {
				const started = yield* bolt.start(EXPORT, {
					mode: 'export',
					format: 'json',
					context: { ids, kind, generated_at: bolt.clock().now }
				});
				if (started.kind !== 'committed') return yield* failed(bolt.t('component.error'));
				if (runs === undefined) return yield* failed(bolt.t('component.error'));
				// the run settles in the background: follow its row until it succeeds or fails
				const run = yield* runs(EXPORT, {
					where: { id: { eq: started.output.id } },
					limit: 1
				}).pipe(
					Stream.map((page) => page.rows[0]),
					Stream.filter((row) => row?.status === 'succeeded' || row?.status === 'failed'),
					Stream.runHead
				);
				const settled = run._tag === 'Some' ? run.value : undefined;
				if (settled?.status !== 'succeeded')
					return yield* failed(settled?.error?.message ?? bolt.t('component.error'));
				const { file } = yield* Schema.decodeUnknownEffect(Exported)(settled.result);
				const text = yield* Effect.tryPromise(() =>
					fetch(bolt.fileUrl(fileRef(file))).then((response) => response.text())
				);
				const files = yield* Schema.decodeUnknownEffect(Files)(text);
				if (kind === 'SALARY')
					return yield* downloadSalaryReport(
						yield* Effect.forEach(files, ({ content }) =>
							Schema.decodeUnknownEffect(Schema.fromJsonString(SalaryReport))(content)
						)
					);
				if (files.length === 0) toast.info(bolt.t('app.payroll.no_bank_payments'));
				else downloadTextFiles(files, 'bank-files.zip');
			}).pipe(
				Effect.catch((failure) =>
					Effect.sync(() =>
						toast.error(failure instanceof Error ? failure.message : bolt.t('component.error'))
					)
				),
				Effect.ensuring(
					Effect.sync(() => {
						exporting = false;
					})
				)
			)
		);
	}
</script>

<!-- a run's warnings are one per line: the list shows how many, the run lists them -->
{#snippet warningsCell({
	value
}: {
	value: Row<'payroll_run'>['warnings'] | undefined;
})}{@const count = (value ?? '')
		.split('\n')
		.filter((line) => line.trim() !== '').length}{#if count > 0}<Badge variant="warning"
			>{bolt.t('component.workbook_warnings', { count })}</Badge
		>{/if}{/snippet}

<AppShell
	icon="lucide:receipt"
	title={bolt.t('app.payroll.runs_title')}
	description={bolt.t('app.payroll.configured_description')}
>
	{#snippet actions()}<CompanyScope {scope} />{/snippet}
	{#if scope.id == null}
		<EmptyState title={bolt.t('app.payroll.empty_runs')} />
	{:else}
		<Stack gap="md">
			<Table
				of="payroll_run"
				key="payroll_run"
				where={{ company_id: { eq: scope.id } }}
				orderBy={{ period: 'desc' }}
				toolbar={{
					export: false,
					title: bolt.t('app.payroll.runs_title'),
					new: () => (creating = true),
					delete: true,
					actions: [
						{
							run: (ids: Id<'payroll_run'>[]) => exportPayroll(ids, 'BANK'),
							requiresSelection: true,
							icon: 'lucide:landmark',
							name: bolt.t('app.payroll.export_bank_file'),
							description: bolt.t('app.payroll.export_bank_file_help'),
							disabled: () => (exporting ? bolt.t('component.loading') : null)
						},
						{
							run: (ids: Id<'payroll_run'>[]) => exportPayroll(ids, 'SALARY'),
							requiresSelection: true,
							icon: 'lucide:file-spreadsheet',
							name: bolt.t('app.payroll.export_salary_listing'),
							description: bolt.t('app.payroll.export_salary_listing_help'),
							disabled: () => (exporting ? bolt.t('component.loading') : null)
						}
					]
				}}
				columns={[
					'period',
					'kind',
					'pay_date',
					'pay_due_date',
					'attendance_from',
					'attendance_to',
					{ field: 'warnings', cell: warningsCell }
				]}
			/>
		</Stack>
		<RunCreate companyId={scope.id} bind:open={creating} />
	{/if}
</AppShell>
