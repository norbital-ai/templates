<script lang="ts">
	/**
	 * The roster board of one legal entity for one pay period: every person employed in the period against its days,
	 * the plan and the clock side by side. A cell opens the day's clock; the kiosk punches the day.
	 */
	import { bolt } from '$bolt';
	import type { ActInput, Id } from '@norbital-ai/bolt';
	import { Instant, PlainDate } from '@norbital-ai/std/date';
	import { toast, Toaster } from 'svelte-sonner';
	import { t } from '../../../lib/ui/i18n/t.js';
	import { AppShell } from '@norbital-ai/ui/layout';
	import { CustomView, EmptyState } from '@norbital-ai/ui';
	import CompanyScope from '../../../lib/ui/scopes/company_picker.svelte';
	import { companyScope } from '../../../lib/ui/scopes/company_scope.svelte.js';
	import { employmentLabel, entityTimeZone } from '../../../lib/ui/scopes/create_scope.js';
	import MonthPeriodPicker from '../../../lib/ui/components/month_period_picker.svelte';
	import { createPayPeriodScope } from '../../../lib/ui/scopes/pay_period_scope.svelte.js';
	import { todayKey } from '../../../lib/ui/format/calendar.js';
	import { liveRows } from '../../../lib/ui/state/live.svelte.js';
	import MonthBoard from '../../../lib/ui/roster/month_board.svelte';
	import { datesBetween, intervalsFrom } from '../../../lib/ui/roster/month_board.js';
	import {
		downloadAttendanceTemplate,
		parseAttendanceWorkbook
	} from '../../../lib/ui/roster/attendance_workbook.js';

	const scope = companyScope();
	const pay = createPayPeriodScope(() => scope.company);
	const today = todayKey();
	const timeZone = $derived(entityTimeZone(scope.company));

	let fileInput = $state<HTMLInputElement>();
	let importing = $state(false);
	const days = $derived(pay.window == null ? [] : datesBetween(pay.window.start, pay.window.end));

	/** One roster_entry per imported person-day: the clock as intervals in the entity's zone, overtime and incentive. */
	async function importWorkbook() {
		const input = fileInput;
		if (input == null) return;
		const file = input.files?.[0];
		input.value = '';
		if (file == null || scope.id == null) return;
		importing = true;
		try {
			const rows = await parseAttendanceWorkbook(await file.arrayBuffer());
			if (rows.length === 0) {
				toast.error(t('attendance_import.empty'));
				return;
			}
			const numbers = [...new Set(rows.map((row) => row.employee_number))];
			const { rows: contracts } = await bolt.read('employment_contract', {
				where: {
					company_id: { eq: scope.id },
					employee_number: { in: numbers },
					approval_id: { isNull: true }
				},
				select: { id: true, employee_number: true },
				all: true
			});
			const byNumber = new Map(contracts.map((row) => [row.employee_number, row.id]));
			const unknown = numbers.filter((number) => !byNumber.has(number));
			if (unknown.length > 0) {
				toast.error(t('attendance_import.unknown_people', { count: unknown.length }));
				return;
			}
			type Entry = {
				readonly employment_id: Id<'employment_contract'>;
				readonly work_date: PlainDate;
				worked_intervals?: { readonly start: Instant; readonly end: Instant | null }[];
				approved_overtime_hours?: number;
				overtime_consented_at?: Instant;
				incentive_hours?: number;
			};
			const seen = new Map<string, Entry>();
			for (const row of rows) {
				const employment_id = byNumber.get(row.employee_number)!;
				const hasClock = row.clock_in != null && row.clock_out != null;
				const hasOvertime = row.overtime_hours != null && row.overtime_hours > 0;
				const hasIncentive = row.incentive_hours != null && row.incentive_hours > 0;
				if (!hasClock && !hasOvertime && !hasIncentive) continue;
				const entry: Entry = { employment_id, work_date: PlainDate(row.work_date) };
				if (hasClock) {
					const draft = intervalsFrom(
						row.work_date,
						[{ start: row.clock_in, end: row.clock_out }],
						timeZone
					);
					if ('problem' in draft) continue;
					entry.worked_intervals = draft.intervals.map((interval) => ({
						start: Instant(interval.start),
						end: interval.end == null ? null : Instant(interval.end)
					}));
				}
				if (hasOvertime) {
					entry.approved_overtime_hours = row.overtime_hours!;
					entry.overtime_consented_at = Instant(new Date().toISOString());
				}
				if (hasIncentive) entry.incentive_hours = row.incentive_hours!;
				seen.set(`${employment_id}:${row.work_date}`, entry);
			}
			const payload: ActInput<'roster_entry.create'> = [...seen.values()];
			if (!Array.isArray(payload) || payload.length === 0) {
				toast.error(t('attendance_import.empty'));
				return;
			}
			const outcome = await bolt.act('roster_entry.create', payload);
			if (outcome.kind === 'committed' || outcome.kind === 'pendingApproval')
				toast.success(t('attendance_import.imported', { count: payload.length }));
			else toast.error(outcome.kind === 'refused' ? outcome.message : t('component.error'));
		} finally {
			importing = false;
		}
	}

	async function downloadTemplate() {
		await downloadAttendanceTemplate({
			people: people.map((person) => ({ employee_number: person.number, name: person.name })),
			days
		});
	}

	const contracts = liveRows(() =>
		scope.id == null
			? null
			: bolt.read('employment_contract', {
					where: { company_id: { eq: scope.id }, approval_id: { isNull: true } },
					select: {
						employee_number: true,
						employee_id: { select: { name: true } },
						effective_range: true
					},
					orderBy: { employee_number: 'asc' },
					all: true
				})
	);
	/** The people employed at any time in the period. */
	const people = $derived(
		pay.window == null
			? []
			: (contracts.current ?? [])
					.filter(
						(row) =>
							row.effective_range.from <= pay.window!.end &&
							(row.effective_range.to == null || row.effective_range.to >= pay.window!.start)
					)
					.map((row) => ({
						id: row.id,
						number: row.employee_number,
						name: employmentLabel(row),
						from: String(row.effective_range.from),
						to: row.effective_range.to == null ? null : String(row.effective_range.to)
					}))
	);
</script>

{#snippet periodPicker()}
	<MonthPeriodPicker
		month={pay.period}
		halves={pay.halves}
		weeks={pay.weeks}
		ariaLabel={t('app.events.pay_period')}
		onMonthChange={(next) => pay.select(next)}
	/>
{/snippet}

{#snippet workTools()}
	{@render periodPicker()}
{/snippet}

<Toaster />
<input
	bind:this={fileInput}
	type="file"
	accept=".xlsx,.xlsm"
	class="hidden"
	onchange={importWorkbook}
/>
<AppShell
	icon="lucide:calendar-clock"
	title={t('app.work.title')}
	description={t('app.work.description')}
>
	{#snippet actions()}<CompanyScope {scope} />{/snippet}
	{#if scope.unknown}
		<p class="text-meta">{t('component.loading')}</p>
	{:else if scope.id == null}
		<EmptyState title={t('app.scheduling.empty_board')} />
	{:else if pay.window != null}
		{@const companyId = scope.id}
		{@const window = pay.window}
		<CustomView
			of={people}
			key="work"
			fields={[
				{ field: 'number', label: t('component.employee_number') },
				{ field: 'name', label: t('component.name') }
			]}
			toolbar={{
				title: t('app.scheduling.board_title'),
				controls: workTools,
				actions: [
					{
						label: t('attendance_import.import'),
						icon: 'lucide:upload',
						group: 'import',
						run: () => fileInput?.click()
					},
					{
						label: t('attendance_import.template'),
						icon: 'lucide:download',
						group: 'import',
						run: () => void downloadTemplate()
					}
				]
			}}
		>
			{#snippet children(shown)}
				<MonthBoard
					people={shown}
					{companyId}
					from={window.start}
					to={window.end}
					{timeZone}
					{today}
				/>
			{/snippet}
		</CustomView>
	{/if}
</AppShell>
