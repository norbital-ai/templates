<script lang="ts">
	/**
	 * A payroll run opens on itself: the windows it was built against, what its build noticed, and the payslips it
	 * produced, whose payment state moves here (hold, release, paid). Creating one goes through the payroll page's
	 * run sheet; this view shows the model's own form only when opened in create mode elsewhere.
	 */
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import { Instant } from '@norbital-ai/std/date';
	import { RecordShell, Section, Table, type RecordView } from '@norbital-ai/ui';
	import { Cluster, Cover, Grid, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { formatCalendarDate } from '../../../lib/ui/format/display_formatters.js';
	import { versionMoney } from '../../../lib/ui/format/version_money.svelte.js';
	import { decodeNumber } from '../../../lib/payroll_engine/foundation.js';
	import { movable } from '../../../lib/ui/payroll/slip_moves.js';
	import { Effect } from 'effect';

	let { view }: { view: RecordView<'payroll_run'> } = $props();
	const run = $derived(view.mode !== 'create' ? view.record : null);
	const book = $derived.by(() =>
		run == null
			? null
			: bolt.query({
					entity: { where: { id: { eq: run.company_id } }, fields: ['name'], limit: 1 },
					payslip: {
						where: { payroll_run_id: { eq: run.id } },
						fields: ['status', 'gross', 'net', 'employer_cost']
					}
				})
	);
	type Slip = NonNullable<NonNullable<typeof book>['current']>['payslip']['rows'][number];
	const slipRows = $derived<readonly Slip[]>(book?.current?.payslip.rows ?? []);
	const money = versionMoney(() => (run == null ? null : { version: run.settings_id }));
	const total = $derived(book?.loading ? null : slipRows.length);
	const count = (status: string) => slipRows.filter((row) => row.status === status).length;
	const paid = $derived(count('PAID'));
	const held = $derived(count('ON_HOLD'));
	const sum = (pick: (row: Slip) => unknown) =>
		slipRows.reduce((acc, row) => acc + decodeNumber(pick(row) ?? 0), 0);
	/** What the build refused or noticed, one sentence per line. */
	const warnings = $derived(run == null || !run.warnings ? [] : run.warnings.split('\n'));
	/** Hold keeps reviewed slips out of payment; release returns them; paid is terminal, stamped now. */
	// a slip already in the target state (a paid one) is skipped, not refused with the whole batch
	const statusOf = (id: Id<'payslip'>) => slipRows.find((row) => row.id === id)?.status;
	// the menu item stays pending until the write settles; a refusal is its error
	const move = (status: 'DRAFT' | 'ON_HOLD' | 'PAID') => (selected: Id<'payslip'>[]) => {
		const targets = movable(status, selected, statusOf);
		if (targets.length === 0) return;
		return bolt
			.act(
				'payslip.update',
				targets.map((target) => ({
					target,
					set: {
						status,
						...(status === 'PAID' ? { paid_at: Instant(new Date().toISOString()) } : {})
					}
				}))
			)
			.pipe(Effect.asVoid);
	};
</script>

{#snippet runSummary()}
	{#if run}
		<Stack as="section" gap="sm" aria-label={bolt.t('component.payroll_run_summary')}>
			<Cluster align="start" justify="between" gap="sm">
				<Stack gap="none" class="min-w-0">
					<h2 class="truncate text-heading">
						{book?.current?.entity.rows[0]?.name ?? bolt.t('component.company')}
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
					<dd class="font-medium tabular-nums">{money(sum((row) => row.gross))}</dd>
				</Stack>
				<Stack gap="xs">
					<dt class="text-meta">{bolt.t('component.payslip_net_pay')}</dt>
					<dd class="font-medium tabular-nums">{money(sum((row) => row.net))}</dd>
				</Stack>
				<Stack gap="xs">
					<dt class="text-meta">{bolt.t('component.employer_cost')}</dt>
					<dd class="font-medium tabular-nums">{money(sum((row) => row.employer_cost))}</dd>
				</Stack>
			</Grid>
			{#if total === 0 && warnings.length === 0}
				<p class="text-sm text-muted-foreground">{bolt.t('component.draft_built_nothing')}</p>
			{/if}
			{#if warnings.length > 0}
				<Section
					name="run-warnings"
					title={bolt.t('component.workbook_warnings', { count: warnings.length })}
					defaultOpen={false}
					first
				>
					<Scroll
						name={bolt.t('component.workbook_warnings', { count: warnings.length })}
						max="compact"
						class="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
					>
						<Stack as="ul" gap="xs" data-run-warnings>
							{#each warnings as warning, index (index)}<li>{warning}</li>{/each}
						</Stack>
					</Scroll>
				</Section>
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
					export: false,
					select: true,
					actions: [
						{
							icon: 'lucide:pause',
							name: bolt.t('component.hold'),
							run: move('ON_HOLD'),
							requiresSelection: true
						},
						{
							icon: 'lucide:play',
							name: bolt.t('component.release'),
							run: move('DRAFT'),
							requiresSelection: true
						},
						{
							icon: 'lucide:banknote',
							name: bolt.t('app.payroll.mark_selected_paid'),
							run: move('PAID'),
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
					{ field: 'bank_charges', label: bolt.t('app.payroll.bank_charges') },
					{ field: 'employer_cost', label: bolt.t('component.employer_cost') }
				]}
			/>
		</Cover>
	{/if}
</RecordShell>
