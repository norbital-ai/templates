<script lang="ts">
	import { t } from '../../../lib/ui/t.js';
	import { everyField } from '../../../lib/every-field.js';
	/**
	 * Creating a payroll run chooses the company, period, and optionally a contractual pay due date.
	 * The windows, settlement date, configuration hash, and trace are derived by the collection's transform.
	 * The window shown before submit comes from the engine's own `resolveWindow`, so the operator reads the cutoff
	 * rule the run will be built with.
	 *
	 * The period is offered in the company's grammar: months at a monthly company, halves or weeks at an
	 * instalment one; `resolveWindow` refuses the other grammar, so the candidates it leaves are exactly the ones
	 * the transform accepts, less the periods already run.
	 *
	 * A record opens on the run itself: the window it was built against and the payslips it produced, whose
	 * payment state moves here (hold, release, paid on the run's pay date). A run is never edited: a refused or
	 * wrong draft is deleted, newest first, and created again.
	 */
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import { Instant } from '@norbital-ai/std/date';
	import {
		Combobox,
		Field,
		Form,
		Picker,
		Popover,
		RecordShell,
		Table,
		type RecordView
	} from '@norbital-ai/ui';
	import { Cluster, Cover, Grid, Scroll, Stack } from '@norbital-ai/ui/layout';
	import { resolveWindow } from '../../../lib/payroll/run/period.js';
	import { periodHalf, periodMonth } from '../../../lib/payroll/run/dates.js';
	import { formatCalendarDate, formatNumeric } from '../../../lib/ui/display-formatters.js';
	import { createValues, hrCreateScope } from '../../../lib/ui/create-scope.js';
	import { openCreated } from '../../../lib/ui/open-created.js';
	import { dateKey } from '../../../lib/iso-day.js';
	import {
		companyPeriods,
		periodDayRange,
		periodWindow,
		weekOf
	} from '../../../lib/ui/calendar.js';
	import { live, liveRows } from '../../../lib/ui/live.svelte.js';

	let { view }: { view: RecordView<'payroll_runs'> } = $props();
	const run = $derived(view.mode === 'update' ? view.record : null);
	const scope = hrCreateScope();
	const scopedCompanyId = $derived(scope?.companyId?.());

	/** A company whose calendar the engine cannot build (a cutoff out of range) offers no period, not an error. */
	const windowFor = (period: string, company: Company, payDueDate?: string) => {
		try {
			return resolveWindow(period, company, payDueDate);
		} catch {
			return null;
		}
	};

	// ── the create form ──
	const companies = liveRows(() =>
		run != null
			? null
			: bolt.read('companies', {
					select: everyField('companies'),
					where: { approval_id: { isNull: true } },
					orderBy: { name: 'asc' },
					all: true
				})
	);
	// A held run still occupies its company/period key, so every run counts, approved or not.
	type Company = NonNullable<typeof companies.current>[number];
	const runs = liveRows(() =>
		run != null
			? null
			: bolt.read('payroll_runs', {
					select: { company_id: true, period: true, kind: true },
					all: true
				})
	);
	const periodCandidates = periodWindow(37, 12);
	const monthName = (month: string) =>
		new Intl.DateTimeFormat(bolt.locale, {
			month: 'short',
			year: 'numeric',
			timeZone: 'UTC'
		}).format(new Date(`${month}-01T00:00:00Z`));
	/** "Feb 2026", "Feb 2026 · 1–15", or "Mar 2026 · week 2 (…)": the days the instalment pays for. */
	const periodLabel = (candidate: string, company: Company) => {
		if (candidate.length === 7) return monthName(candidate);
		const week = weekOf(candidate, company.pay_frequency);
		if (week != null)
			return t('component.period_week', {
				month: monthName(periodMonth(candidate)),
				n: periodHalf(candidate) ?? 1,
				from: week.start,
				to: week.end
			});
		const range = periodDayRange(candidate);
		return t('component.period_half', {
			month: monthName(periodMonth(candidate)),
			from: range.from,
			to: range.to
		});
	};
	/**
	 * The periods a company can still run, most recent first: a REGULAR run takes its period, and any
	 * other kind stands beside it but never behind a later period.
	 */
	const periodsOf = (company: Company | undefined, kind: unknown) => {
		if (company == null) return [];
		const own = (runs.current ?? []).filter((row) => row.company_id === company.id);
		const latest = own.reduce((max, row) => (row.period > max ? row.period : max), '');
		const taken = new Set(
			own
				.filter((row) => (kind ?? 'REGULAR') !== 'REGULAR' || row.kind === 'REGULAR')
				.map((row) => row.period)
				.filter((period) => (kind ?? 'REGULAR') === 'REGULAR' || period < latest)
		);
		return companyPeriods(periodCandidates, company.pay_frequency)
			.filter((candidate) => !taken.has(candidate) && windowFor(candidate, company) != null)
			.toReversed();
	};
	const companyOf = (id: unknown) => (companies.current ?? []).find((row) => row.id === id);

	// ── the record ──
	const company = live(() =>
		run == null ? null : bolt.get('companies', run.company_id, { name: true })
	);
	const slips = liveRows(() =>
		run == null
			? null
			: bolt.read('payslips', {
					where: { payroll_run_id: { eq: run.id } },
					select: { status: true, payment_mode: true },
					all: true
				})
	);
	const total = $derived(slips.loading ? null : (slips.current ?? []).length);
	const count = (status: string) =>
		(slips.current ?? []).filter((row) => row.status === status).length;
	const paid = $derived(count('PAID'));
	const held = $derived(count('ON_HOLD'));
	const eventLedger = $derived(
		(slips.current ?? []).some((row) => row.payment_mode === 'EVENT_LEDGER')
	);
	/** The COMPANY-assessed schemes' employer total: the levy the run carries beside its payslips. */
	const companyCharges = $derived(
		(run?.company_charges ?? []).reduce((sum, charge) => sum + charge.employer_amount, 0)
	);
	/** What the engine noticed but did not refuse, one sentence per line, frozen with the run. */
	const warnings = $derived(run == null || run.warnings === '' ? [] : run.warnings.split('\n'));
	/** Hold keeps reviewed slips out of every bank file; release returns them; paid is terminal, on the pay date. */
	const move = (status: 'DRAFT' | 'ON_HOLD' | 'PAID') => (selected: Id<'payslips'>[]) =>
		selected.map((target) => ({
			target,
			set: {
				status,
				...(status === 'PAID' ? { paid_at: Instant(`${run?.pay_date}T00:00:00.000Z`) } : {})
			}
		}));
</script>

{#snippet runSummary()}
	{#if run}
		<Stack gap="lg">
			<Stack as="section" gap="sm" aria-label={t('component.payroll_run_summary')}>
				<Cluster align="start" justify="between" gap="sm">
					<Stack gap="none" class="min-w-0">
						<h2 class="truncate text-heading">
							{company.current?.name ?? t('component.company')}
						</h2>
						<p class="text-sm text-muted-foreground">
							{t('component.period_line', { period: run.period, count: total ?? 0 })}
						</p>
					</Stack>
					<span class="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold tabular-nums">
						{t('app.payroll.paid_progress', {
							paid,
							total: total ?? 0,
							percent: total == null || total === 0 ? 0 : Math.round((paid / total) * 100)
						})}
					</span>
				</Cluster>
				<Grid as="dl" gap="sm" minimum="compact">
					<Stack gap="xs">
						<dt class="text-meta">{t('component.attendance_window')}</dt>
						<dd class="font-medium tabular-nums">
							{formatCalendarDate(run.attendance_from)} → {formatCalendarDate(run.attendance_to)}
						</dd>
					</Stack>
					<Stack gap="xs">
						<dt class="text-meta">{t('app.payroll.pay_date')}</dt>
						<dd class="font-medium tabular-nums">{formatCalendarDate(run.pay_date)}</dd>
					</Stack>
					<Stack gap="xs">
						<dt class="text-meta">{t('component.pay_due_date')}</dt>
						<dd class="font-medium tabular-nums">
							{formatCalendarDate(run.pay_due_date ?? run.pay_date)}
						</dd>
					</Stack>
					{#if companyCharges > 0}
						<Stack gap="xs">
							<dt class="text-meta">{t('component.company_charges')}</dt>
							<dd class="font-medium tabular-nums" data-company-charges>
								{formatNumeric(companyCharges)}
							</dd>
						</Stack>
					{/if}
				</Grid>
			</Stack>
			{#if total === 0}
				<p class="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
					{t('component.draft_built_nothing')}
				</p>
			{/if}
			{#if warnings.length > 0}
				<Popover.Root>
					<Popover.Trigger
						type="button"
						class="w-fit text-left text-xs text-muted-foreground underline-offset-2 hover:underline"
						data-run-warnings
					>
						{t('component.run_warnings', { count: warnings.length })}
					</Popover.Trigger>
					<Popover.Content align="start" sideOffset={6} class="p-0 text-sm">
						<Scroll
							name={t('component.run_warnings', { count: warnings.length })}
							max="standard"
							class="w-[44rem] max-w-[90vw] p-3"
						>
							<Stack as="ul" gap="xs" class="list-disc pl-5">
								{#each warnings as warning (warning)}
									<li>{warning}</li>
								{/each}
							</Stack>
						</Scroll>
					</Popover.Content>
				</Popover.Root>
			{/if}
			{#if held > 0}
				<p class="text-sm text-muted-foreground" data-held-excluded>
					{t('component.held_excluded_from_bank', { count: held })}
				</p>
			{/if}
		</Stack>
	{/if}
{/snippet}

<RecordShell of="payroll_runs" {...run == null ? {} : { id: run.id }} mode={view.mode}>
	{#if run}
		<Cover gap="lg" grow top={runSummary}>
			<Table
				of="payslips"
				toolbar={{
					title: t('component.payslips'),
					new: false,
					select: true,
					actions: [
						{
							action: 'payslips.update',
							label: t('component.hold'),
							input: move('ON_HOLD'),
							requiresSelection: true
						},
						{
							action: 'payslips.update',
							label: t('component.release'),
							input: move('DRAFT'),
							requiresSelection: true
						},
						...(slips.loading || eventLedger
							? []
							: [
									{
										action: 'payslips.update' as const,
										label: t('payroll.mark_paid'),
										input: move('PAID'),
										requiresSelection: true as const
									}
								])
					]
				}}
				where={{ payroll_run_id: { eq: run.id } }}
				orderBy={{ created_at: 'asc' }}
				columns={[
					{ field: 'employment_id', label: t('component.employee') },
					'currency',
					'status',
					'gross',
					{ field: 'total_deductions', label: t('component.deductions') },
					'net',
					{ field: 'unfunded_contributions', label: t('component.unfunded_contributions') },
					{ field: 'employer_cost', label: t('component.employer_cost') }
				]}
			/>
		</Cover>
	{:else}
		<Form
			of="payroll_runs"
			mode="create"
			values={createValues(view, { company_id: scopedCompanyId })}
			submit={t('component.create_payroll_run')}
			onOutcome={openCreated(view)}
		>
			{#snippet children(form)}
				{@const chosen = companyOf(form.get('company_id'))}
				{@const period = typeof form.get('period') === 'string' ? String(form.get('period')) : null}
				{@const statedDueDate = form.get('pay_due_date')}
				{@const payDueDate = typeof statedDueDate === 'string' ? dateKey(statedDueDate) : undefined}
				{@const window =
					chosen != null && period != null ? windowFor(period, chosen, payDueDate) : null}
				<Stack gap="lg">
					<Grid gap="md" minimum="compact">
						{#if scopedCompanyId != null}
							<Stack gap="xs">
								<span class="text-meta">{t('component.legal_entity')}</span>
								<span class="font-medium">{chosen?.name ?? '—'}</span>
							</Stack>
						{:else}
							<Field name="company_id" label={t('component.legal_entity')}>
								{#snippet editor(field)}
									<Picker
										of="companies"
										label={['name']}
										orderBy={{ name: 'asc' }}
										value={typeof field.value === 'string' ? field.value : null}
										onChange={(next) => {
											field.onChange(next);
											form.set('period', null);
										}}
										disabled={field.disabled}
									/>
								{/snippet}
							</Field>
						{/if}
						<Field name="period" label={t('component.pay_period')}>
							{#snippet editor(field)}
								<Combobox
									aria-label={t('component.pay_period')}
									placeholder={chosen == null
										? t('component.choose_entity_first')
										: t('component.choose_payroll_period')}
									options={chosen == null
										? []
										: periodsOf(chosen, form.get('kind')).map((candidate) => ({
												value: candidate,
												label: periodLabel(candidate, chosen)
											}))}
									value={typeof field.value === 'string' && field.value !== '' ? field.value : null}
									disabled={field.disabled || chosen == null || runs.loading}
									onChange={(next) => field.onChange(next)}
								/>
							{/snippet}
						</Field>
						<Field name="kind" />
						<!-- OFF_CYCLE and CORRECTION: the request ids the run pays; refused on REGULAR and FINAL. -->
						<Field name="sources" />
						<Field name="pay_due_date" label={t('component.pay_due_date')} />
					</Grid>
					{#if window}
						<Grid as="dl" gap="sm" minimum="compact">
							<Stack gap="xs">
								<dt class="text-meta">{t('component.salary_month')}</dt>
								<dd class="font-medium tabular-nums">
									{formatCalendarDate(window.salary.start)} → {formatCalendarDate(
										window.salary.end
									)}
								</dd>
							</Stack>
							<Stack gap="xs">
								<dt class="text-meta">{t('component.attendance_window')}</dt>
								<dd class="font-medium tabular-nums">
									{formatCalendarDate(window.attendance.start)} → {formatCalendarDate(
										window.attendance.end
									)}
								</dd>
							</Stack>
							<Stack gap="xs">
								<dt class="text-meta">{t('component.pay_date')}</dt>
								<dd class="font-medium tabular-nums">{formatCalendarDate(window.payDate)}</dd>
							</Stack>
							<Stack gap="xs">
								<dt class="text-meta">{t('component.pay_due_date')}</dt>
								<dd class="font-medium tabular-nums">{formatCalendarDate(window.payDueDate)}</dd>
							</Stack>
						</Grid>
					{/if}
				</Stack>
			{/snippet}
		</Form>
	{/if}
</RecordShell>
