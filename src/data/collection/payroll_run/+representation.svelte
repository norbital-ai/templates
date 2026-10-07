<script lang="ts">
	/**
	 * A payroll run opens on itself: the windows it was built against, what its build noticed, and the payslips it
	 * produced, whose payment state moves here (hold, release, paid). Creating one goes through the payroll page's
	 * run sheet; this view shows the collection's own form only when opened in create mode elsewhere.
	 */
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import { Instant } from '@norbital-ai/std/date';
	import { RecordShell, Table, type RecordView } from '@norbital-ai/ui';
	import { Cluster, Cover, Grid, Stack } from '@norbital-ai/ui/layout';
	import { live, liveRows } from '../../../lib/ui/state/live.svelte.js';
	import { formatCalendarDate, formatNumeric } from '../../../lib/ui/format/display_formatters.js';
	import { decodeNumber } from '../../../lib/payroll_engine/foundation.js';

	let { view }: { view: RecordView<'payroll_run'> } = $props();
	const run = $derived(view.mode === 'update' ? view.record : null);
	const company = live(() =>
		run == null ? null : bolt.get('entity', run.company_id, { name: true })
	);
	const slips = liveRows(() =>
		run == null
			? null
			: bolt.read('payslip', {
					where: { payroll_run_id: { eq: run.id } },
					select: { status: true, gross: true, net: true, employer_cost: true },
					all: true
				})
	);
	const total = $derived(slips.loading ? null : (slips.current ?? []).length);
	const count = (status: string) =>
		(slips.current ?? []).filter((row) => row.status === status).length;
	const paid = $derived(count('PAID'));
	const held = $derived(count('ON_HOLD'));
	const sum = (pick: (row: NonNullable<typeof slips.current>[number]) => unknown) =>
		(slips.current ?? []).reduce((acc, row) => acc + decodeNumber(pick(row) ?? 0), 0);
	/** What the build refused or noticed, one sentence per line. */
	const warnings = $derived(run == null || !run.warnings ? [] : run.warnings.split('\n'));
	/** Hold keeps reviewed slips out of payment; release returns them; paid is terminal, stamped now. */
	const move = (status: 'DRAFT' | 'ON_HOLD' | 'PAID') => (selected: Id<'payslip'>[]) =>
		selected.map((target) => ({
			target,
			set: { status, ...(status === 'PAID' ? { paid_at: Instant(new Date().toISOString()) } : {}) }
		}));
</script>

{#snippet runSummary()}
	{#if run}
		<Stack as="section" gap="sm" aria-label={bolt.t('component.payroll_run_summary')}>
			<Cluster align="start" justify="between" gap="sm">
				<Stack gap="none" class="min-w-0">
					<h2 class="truncate text-heading">
						{company.current?.name ?? bolt.t('component.company')}
					</h2>
					<p class="text-sm text-muted-foreground">
						{bolt.t('component.period_line', { period: run.period, count: total ?? 0 })}
					</p>
				</Stack>
				<span class="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold tabular-nums">
					{bolt.t('app.payroll.paid_progress', {
						paid,
						total: total ?? 0,
						percent: total == null || total === 0 ? 0 : Math.round((paid / total) * 100)
					})}
				</span>
			</Cluster>
			<Grid as="dl" gap="sm" minimum="compact">
				<Stack gap="xs">
					<dt class="text-meta">{bolt.t('component.attendance_window')}</dt>
					<dd class="font-medium tabular-nums">
						{run.attendance_from == null ? '—' : formatCalendarDate(run.attendance_from)} → {run.attendance_to ==
						null
							? '—'
							: formatCalendarDate(run.attendance_to)}
					</dd>
				</Stack>
				<Stack gap="xs">
					<dt class="text-meta">{bolt.t('component.pay_due_date')}</dt>
					<dd class="font-medium tabular-nums">
						{run.pay_due_date == null ? '—' : formatCalendarDate(run.pay_due_date)}
					</dd>
				</Stack>
				<Stack gap="xs">
					<dt class="text-meta">{bolt.t('component.payslip_gross_pay')}</dt>
					<dd class="font-medium tabular-nums">{formatNumeric(sum((row) => row.gross))}</dd>
				</Stack>
				<Stack gap="xs">
					<dt class="text-meta">{bolt.t('component.payslip_net_pay')}</dt>
					<dd class="font-medium tabular-nums">{formatNumeric(sum((row) => row.net))}</dd>
				</Stack>
				<Stack gap="xs">
					<dt class="text-meta">{bolt.t('component.employer_cost')}</dt>
					<dd class="font-medium tabular-nums">{formatNumeric(sum((row) => row.employer_cost))}</dd>
				</Stack>
			</Grid>
			{#if total === 0 && warnings.length === 0}
				<p class="text-sm text-muted-foreground">{bolt.t('component.draft_built_nothing')}</p>
			{/if}
			{#if warnings.length > 0}
				<Stack
					as="ul"
					gap="xs"
					class="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
					data-run-warnings
				>
					{#each warnings as warning (warning)}<li>{warning}</li>{/each}
				</Stack>
			{/if}
			{#if held > 0}
				<p class="text-sm text-muted-foreground">
					{bolt.t('component.held_excluded_from_bank', { count: held })}
				</p>
			{/if}
		</Stack>
	{/if}
{/snippet}

<RecordShell of="payroll_run" {...run == null ? {} : { id: run.id }} mode={view.mode}>
	{#if run}
		<Cover gap="lg" grow top={runSummary}>
			<Table
				of="payslip"
				key={`run-payslips-${run.id}`}
				toolbar={{
					title: bolt.t('component.payslips'),
					new: false,
					select: true,
					actions: [
						{
							action: 'payslip.update',
							label: bolt.t('component.hold'),
							input: move('ON_HOLD'),
							requiresSelection: true
						},
						{
							action: 'payslip.update',
							label: bolt.t('component.release'),
							input: move('DRAFT'),
							requiresSelection: true
						},
						{
							action: 'payslip.update',
							label: bolt.t('app.payroll.mark_selected_paid'),
							input: move('PAID'),
							requiresSelection: true
						}
					]
				}}
				where={{ payroll_run_id: { eq: run.id } }}
				orderBy={{ created_at: 'asc' }}
				columns={[
					{ field: 'employment_id', label: bolt.t('component.employee') },
					'status',
					'gross',
					{ field: 'total_deductions', label: bolt.t('component.deductions') },
					'net',
					{ field: 'employer_cost', label: bolt.t('component.employer_cost') }
				]}
			/>
		</Cover>
	{/if}
</RecordShell>
