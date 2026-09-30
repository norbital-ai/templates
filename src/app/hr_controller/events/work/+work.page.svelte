<script lang="ts">
	import ScopeGate from '../../../../lib/ui/ScopeGate.svelte';
	import { t } from '../../../../lib/ui/t.js';
	import { everyField } from '../../../../lib/every-field.js';
	/**
	 * The roster board for one legal entity and one pay period (a month, a half or a week in the entity's grammar): every
	 * employed person's days, the plan and the attendance side by side, drawn from one derivation (`buildRosterMonth`).
	 * A cell opens its person-day's record sheet, or a create sheet with the person and the day when no row exists yet;
	 * two cells swap their plans in one write the server judges whole. The month workbook imports the roster, the time
	 * entries and the overtime in one act (`work_days.import_month`), and its template downloads from here.
	 *
	 * Locks are drawn from the entity's payroll runs and payslips (a paid payslip freezes that person's days) and from
	 * each person-day's own `payslip_id` (a run took this record). Holidays are the entity's published calendar,
	 * resolved per person as payroll resolves them.
	 */
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import { PlainDate } from '@norbital-ai/std/date';
	import { toast, Toaster } from 'svelte-sonner';
	import { AppShell, Stack } from '@norbital-ai/ui/layout';
	import { Alert, CustomView, Sheet, type ToolbarItem } from '@norbital-ai/ui';
	import { openRecord, RecordShell } from '@norbital-ai/ui';
	import { addDays, monthBounds, periodMonth } from '../../../../lib/payroll/run/dates.js';
	import { resolveWindow } from '../../../../lib/payroll/run/period.js';
	import {
		holidayWorkedRows,
		schedulingImportDays,
		schedulingImportPayload
	} from '../../../../data/collection/work_days/lib/import-workbook.js';
	import {
		schedulingTemplateWorkbook,
		XLSX_MEDIA_TYPE
	} from '../../../../data/collection/work_days/lib/import-template.js';
	import { resolveEmployment } from '../../../../lib/employment-contract.js';
	import { dateKey, isSettledId } from '../../../../lib/iso-day.js';
	import {
		lockMap,
		payrollWindows,
		sourceLockReason,
		type SettlementClaim
	} from '../../../../lib/scheduling/lock.js';
	import {
		observedDays,
		observedHolidays,
		overtimeEntitled
	} from '../../../../lib/scheduling/work-limits.js';
	import {
		patternAnchor,
		patternRosterCodeId,
		termPatternRow
	} from '../../../../lib/scheduling/work-pattern.js';
	import { periodInCompanyGrammar, todayKey } from '../../../../lib/ui/calendar.js';
	import CompanyScope from '../../../../lib/ui/CompanyScope.svelte';
	import { companyScope } from '../../../../lib/ui/company-scope.svelte.js';
	import { saveBlob } from '../../../../lib/ui/export-download.js';
	import { liveRows } from '../../../../lib/ui/live.svelte.js';
	import { monthSources } from '../../../../lib/ui/roster/month-sources.svelte.js';
	import MonthPeriodPicker from '../../../../lib/ui/month-period-picker.svelte';
	import RosterMonthBoard, {
		type BoardCell
	} from '../../../../lib/ui/roster/roster-month-board.svelte';
	import { unresolvedClockOutEmploymentIds } from '../../../../lib/ui/roster/roster-month-board-filter.js';
	import {
		buildRosterMonth,
		employmentMonthEmptyReason,
		employmentOverlapsMonth,
		holidaysByDate,
		lockRung,
		lockRungFreezes,
		lockRungSourceLock,
		monthDays,
		personDayKey,
		termCovers
	} from '../../../../lib/ui/roster/roster-month.js';
	import { runWorkbookImport } from '../../../../lib/ui/workbook-import.js';

	const scope = companyScope();
	const company = $derived(scope.company);
	const today = todayKey();
	const approved = { approval_id: { isNull: true } } as const;

	let month = $state(todayKey().slice(0, 7));
	/** The board's period in the entity's pay grammar; the calendar month only scopes the reads that fetch a superset. */
	const period = $derived(periodInCompanyGrammar(month, company?.pay_frequency, today));
	const calendarMonth = $derived(periodMonth(period));
	const monthStart = $derived(PlainDate(`${calendarMonth}-01`));
	const monthEnd = $derived(PlainDate(monthBounds(calendarMonth).end));
	const monthDateKeys = $derived(monthDays(period));
	const settingsCode = $derived(company?.settings_code ?? null);

	/* ── the entity's payroll: its runs and payslips lock days (a paid payslip freezes that person's period) ── */
	const runs = liveRows(() =>
		scope.id == null
			? null
			: bolt.read('payroll_runs', {
					where: { ...approved, company_id: { eq: scope.id } },
					select: { period: true, attendance_from: true, attendance_to: true },
					all: true
				})
	);
	const payslips = liveRows(() =>
		scope.id == null
			? null
			: bolt.read('payslips', {
					where: { payroll_run_id: { is: { company_id: { eq: scope.id } } } },
					select: { payroll_run_id: true, employment_id: true, paid_at: true },
					all: true
				})
	);
	const windows = $derived(payrollWindows(runs.current ?? [], payslips.current ?? []));
	/** The attendance window the next run settles: the stored run's, else the entity's cutoff rule. */
	const cutoff = $derived.by(() => {
		const run = (runs.current ?? []).find((row) => row.period === period);
		if (run?.attendance_from != null && run.attendance_to != null)
			return { start: dateKey(run.attendance_from), end: dateKey(run.attendance_to) };
		if (company == null) return null;
		try {
			return resolveWindow(period, {
				pay_cutoff_day: company.pay_cutoff_day ?? 0,
				pay_frequency: company.pay_frequency
			}).attendance;
		} catch {
			return null;
		}
	});

	/* ── the people of the period ── */
	const employmentRows = liveRows(() =>
		scope.id == null
			? null
			: bolt.read('employments', {
					select: everyField('employments'),
					where: { ...approved, company_id: { eq: scope.id } },
					orderBy: { employee_number: 'asc' },
					all: true
				})
	);
	const employments = $derived((employmentRows.current ?? []).map(resolveEmployment));
	const monthEmployments = $derived(
		employments.filter((row) => employmentOverlapsMonth(row, period))
	);
	const ids = $derived(monthEmployments.map((row) => row.id));
	const employees = liveRows(() =>
		ids.length === 0
			? null
			: bolt.read('employees', {
					where: {
						...approved,
						id: { in: [...new Set(monthEmployments.map((row) => row.employee_id))] }
					},
					select: { name: true },
					all: true
				})
	);
	const names = $derived(new Map((employees.current ?? []).map((row) => [row.id, row.name])));
	const people = $derived(
		monthEmployments.map((row) => ({
			id: row.id,
			number: row.employee_number,
			name: names.get(row.employee_id) ?? '—'
		}))
	);
	const locks = $derived(lockMap(windows, monthDateKeys, ids));

	/* ── the plan's sources, the month's person-days, time off and calendar: the reads an employee's month shares ── */
	const reads = monthSources({
		companyId: () => scope.id,
		settingsCode: () => settingsCode,
		employmentIds: () => ids,
		start: () => monthStart,
		end: () => monthEnd,
		rosterPeriods: () => [
			addDays(monthStart, -1).slice(0, 7),
			period,
			addDays(monthEnd, 1).slice(0, 7)
		],
		held: false
	});
	const terms = $derived(reads.terms);
	const termsByEmployment = $derived(Map.groupBy(terms, (row) => row.employment_id));
	const activeTerm = (employmentId: string, date: string) =>
		(termsByEmployment.get(employmentId as Id<'employments'>) ?? []).find((row) =>
			termCovers(row, date)
		) ?? null;
	const allowanceIds = $derived([
		// a contract's allowance lines are its `json` value: each class id is asserted where it enters
		...new Set(
			terms.flatMap((row) => row.allowances.map((a) => a.catalogue_id as Id<'allowance_catalogue'>))
		)
	]);
	const allowanceClasses = liveRows(() =>
		allowanceIds.length === 0
			? null
			: bolt.read('allowance_catalogue', {
					where: { id: { in: allowanceIds } },
					select: { destination: true, direction: true, counts_toward: true },
					all: true
				})
	);
	const workDays = $derived(reads.workDays.current ?? []);
	const workDayByKey = $derived(
		new Map(workDays.map((row) => [personDayKey(row.employment_id, dateKey(row.work_date)), row]))
	);
	/** A person-day a payroll run took: its own `payslip_id` names the payslip. */
	const settlementClaims = $derived(
		new Map<string, SettlementClaim>(
			workDays.filter((row) => row.payslip_id != null).map((row) => [row.id, { period: '' }])
		)
	);
	const calendar = $derived(reads.calendar);
	const versionInForce = $derived(reads.versionInForce);
	const timeZone = $derived(reads.timeZone);
	const patternOn = (employmentId: string) => (date: string) => {
		const term = activeTerm(employmentId, date);
		const row = term == null ? null : termPatternRow(term);
		return row == null ? null : { pattern: row.pattern, anchor: patternAnchor(row) };
	};
	/** Each person's observed holidays, as payroll resolves them; a person whose schedule cannot resolve keeps the overlay. */
	const observed = $derived.by(() => {
		if (company == null || scope.id == null || reads.rosters.current === undefined)
			return undefined;
		const byPerson = new Map<string, ReturnType<typeof observedHolidays>>();
		for (const employment of monthEmployments)
			try {
				byPerson.set(
					employment.id,
					observedHolidays({
						dates: monthDateKeys,
						cutoffDay: company.pay_cutoff_day ?? 1,
						companyId: scope.id,
						holidays: reads.holidays.current ?? [],
						codes: reads.shifts.current ?? [],
						work: versionInForce?.work_rules,
						plans: workDays
							.filter((day) => day.employment_id === employment.id)
							.map((day) => ({
								work_date: dateKey(day.work_date),
								shift_definition_id: day.shift_definition_id
							})),
						rosterPeriods: reads.rosters.current
							.filter((row) => row.employment_id === employment.id)
							.map((row) => row.period),
						patternOn: patternOn(employment.id),
						worksiteOn: (date) => activeTerm(employment.id, date)?.worksite
					})
				);
			} catch {
				// a plan the schedule cannot resolve: this person's cells keep the calendar overlay
			}
		return byPerson;
	});
	const facts = $derived(
		buildRosterMonth({
			month: period,
			timeZone,
			employments: monthEmployments,
			employmentTerms: terms,
			workDays,
			leaveRequests: (reads.leave.current ?? []).filter((row) => row.approval_id == null),
			pendingLeaveRequests: (reads.leave.current ?? []).filter((row) => row.approval_id != null),
			holidays: calendar.holidays,
			rosterCodesById: reads.shiftsById,
			leaveCodeById: reads.leaveCodeById,
			cutoff,
			locks,
			today,
			...(observed == null ? {} : { observedHolidays: observed })
		})
	);

	/* ── state of the board ── */
	const sources = $derived([
		['person-days', reads.workDays],
		['leave', reads.leave],
		['holiday calendar settings', reads.settings],
		['holidays', reads.holidays],
		['employments', employmentRows],
		['employees', employees],
		['employment schedules', reads.termRows],
		['shift patterns', reads.patterns],
		['roster codes', reads.shifts],
		['leave catalogue entries', reads.leaveCodes],
		['payroll runs', runs],
		['payslips', payslips]
	] as const);
	const errors = $derived([
		...(calendar.error == null ? [] : [calendar.error]),
		...sources.flatMap(([label, source]) =>
			source.error == null ? [] : [`${label}: ${source.error}`]
		)
	]);
	/** The matrix paints once its identity is known; overlays (names, leave, holidays, locks) fill in after. */
	const loading = $derived(
		errors.length === 0 &&
			(scope.id == null ||
				employmentRows.current === undefined ||
				(ids.length > 0 && reads.workDays.current === undefined))
	);
	const editable = $derived(reads.workDays.current !== undefined && reads.workDays.error == null);
	/** The eye filter: only people with an unresolved clock-out, read from the facts the cells render. */
	let unresolvedOnly = $state(false);
	const unresolved = $derived(
		unresolvedOnly ? unresolvedClockOutEmploymentIds(facts.values()) : null
	);
	/** The toolbar searches, filters and sorts the people; the eye filter narrows what is left. */
	const onBoard = (shown: readonly (typeof people)[number][]) =>
		shown.filter((person) => unresolved == null || unresolved.has(person.id));
	const emptyReason = $derived(employmentMonthEmptyReason(employments, period));

	/* ── opening a day: its record sheet, or the create sheet with the person and the day ── */
	const create = $state<{
		open: boolean;
		employmentId: Id<'employments'> | null;
		date: PlainDate | null;
	}>({ open: false, employmentId: null, date: null });
	function openDay(employmentId: Id<'employments'>, date: PlainDate): void {
		const stored = workDayByKey.get(personDayKey(employmentId, date));
		if (stored != null && isSettledId(stored.id)) return openRecord('work_days', stored.id);
		create.employmentId = employmentId;
		create.date = date;
		create.open = true;
	}

	/* ── the swap: two cells, one write where both are rows or neither, and the server is the judge ── */
	const swap = $state({ source: null as BoardCell | null });
	const claimFor = (day: { readonly workDayId: string | null }) =>
		day.workDayId == null ? null : (settlementClaims.get(day.workDayId) ?? null);
	/** The one refusal the board itself can state: which payroll holds the day. */
	function swapRefusal(from: BoardCell, to: BoardCell): string | null {
		for (const cell of [from, to]) {
			const day = facts.get(personDayKey(cell.employmentId, cell.date));
			if (day == null) return t('roster.swap_refused_unknown');
			if (!lockRungFreezes(lockRung(day, claimFor(day)))) continue;
			return (
				sourceLockReason(lockRungSourceLock(day, claimFor(day)) ?? { kind: 'NONE' }, t) ??
				t('roster.swap_refused_locked', { date: day.date })
			);
		}
		return null;
	}
	/** The code a person-day resolves to: its explicit plan, else the pattern's projection (`buildRosterMonth`'s precedence). */
	function effectiveCodeId(employmentId: string, date: string): Id<'shift_definitions'> | null {
		const explicit = workDayByKey.get(personDayKey(employmentId, date))?.shift_definition_id;
		if (explicit != null) return explicit;
		const term = activeTerm(employmentId, date);
		const row = term == null ? null : termPatternRow(term);
		// a pattern's days are its `json` value: the code it names is asserted where it enters
		const projected = patternRosterCodeId(row?.pattern ?? null, date, patternAnchor(row));
		return projected as Id<'shift_definitions'> | null;
	}
	async function swapDays(from: BoardCell, to: BoardCell): Promise<void> {
		const refusal = swapRefusal(from, to);
		if (refusal != null) {
			toast.error(t('roster.swap_failed_pair', { from: from.date, to: to.date }), {
				description: refusal
			});
			return;
		}
		const fromCode = effectiveCodeId(from.employmentId, from.date);
		const toCode = effectiveCodeId(to.employmentId, to.date);
		if (fromCode == null || toCode == null) return;
		const cells = [
			{ cell: from, code: toCode },
			{ cell: to, code: fromCode }
		].map(({ cell, code }) => ({
			cell,
			code,
			existing: workDayByKey.get(personDayKey(cell.employmentId, cell.date))
		}));
		const creates = cells
			.filter((x) => x.existing == null)
			.map((x) => ({
				employment_id: x.cell.employmentId,
				work_date: x.cell.date,
				shift_definition_id: x.code
			}));
		const updates = cells.flatMap((x) =>
			x.existing == null ? [] : [{ target: x.existing.id, set: { shift_definition_id: x.code } }]
		);
		// ponytail: a mixed pair is two writes (a create and an update); a both-sides batch needs a create+update graph
		let outcome = creates.length === 0 ? null : await bolt.act('work_days.create', creates);
		if (
			updates.length > 0 &&
			(outcome == null || outcome.kind === 'committed' || outcome.kind === 'pendingApproval')
		)
			outcome = await bolt.act('work_days.update', updates);
		if (outcome == null) return;
		if (outcome.kind === 'committed' || outcome.kind === 'pendingApproval') {
			swap.source = null;
			toast.success(
				outcome.kind === 'pendingApproval'
					? t('roster.day_sheet_pending_approval')
					: t('roster.swap_done')
			);
		} else
			toast.error(t('roster.swap_failed_pair', { from: from.date, to: to.date }), {
				description: outcome.kind === 'refused' ? outcome.message : t('component.error')
			});
	}

	/* ── the month workbook ── */
	/**
	 * After an import: a company holiday worked by someone the overtime rule does not cover earns no overtime, so HR
	 * grants an off-in-lieu day. Read on the board's own data and payroll's own calendar; a run states it again.
	 */
	function warnHolidaysWithoutOvertime(payload: ReturnType<typeof schedulingImportPayload>): void {
		if (company == null || scope.id == null) return;
		const companyId = scope.id;
		const byNumber = new Map(people.map((person) => [person.number, person]));
		const codeIdByCode = new Map((reads.shifts.current ?? []).map((code) => [code.code, code.id]));
		const rows = holidayWorkedRows(
			payload,
			(number) => {
				const person = byNumber.get(number);
				if (person == null) return new Set();
				const filed = (payload.roster ?? []).filter((row) => row.employee_number === number);
				try {
					return observedDays({
						dates: monthDays(calendarMonth),
						cutoffDay: company.pay_cutoff_day ?? 1,
						companyId,
						holidays: reads.holidays.current ?? [],
						codes: reads.shifts.current ?? [],
						work: versionInForce?.work_rules,
						plans:
							payload.roster === undefined
								? workDays
										.filter((day) => day.employment_id === person.id)
										.map((day) => ({
											work_date: dateKey(day.work_date),
											shift_definition_id: day.shift_definition_id
										}))
								: filed.map((row) => ({
										work_date: row.work_date,
										shift_definition_id: codeIdByCode.get(row.shift_code) ?? null
									})),
						rosterPeriods: filed.length > 0 ? [calendarMonth] : [],
						patternOn: patternOn(person.id),
						worksiteOn: (date) => activeTerm(person.id, date)?.worksite
					}).holidays;
				} catch {
					return new Set();
				}
			},
			(number, date) => {
				const person = byNumber.get(number);
				return (
					person == null ||
					overtimeEntitled(
						versionInForce?.work_rules?.overtime_when,
						{
							employee: null,
							employment: { service_start: '' },
							terms: activeTerm(person.id, date),
							company: { region: company.region, facts: company.facts },
							asOf: date
						},
						(id) => (allowanceClasses.current ?? []).find((row) => row.id === id)
					)
				);
			}
		);
		if (rows.length === 0) return;
		toast.warning(t('app.scheduling.import_holiday_without_overtime', { count: rows.length }), {
			description: rows
				.map((row) =>
					t('roster.day_sheet_holiday_without_overtime', {
						person: [row.employee_number, byNumber.get(row.employee_number)?.name]
							.filter(Boolean)
							.join(' '),
						date: row.work_date
					})
				)
				.join('\n'),
			descriptionClass: 'whitespace-pre-line',
			duration: Number.POSITIVE_INFINITY
		});
	}
	let importing = $state(false);
	async function importWorkbook(): Promise<void> {
		importing = true;
		await runWorkbookImport({
			action: 'work_days.import_month',
			recordLabel: t('component.work_days'),
			buildPayload: schedulingImportPayload,
			importedCount: schedulingImportDays,
			overwritten: (output) => output.overwritten,
			afterImport: warnHolidaysWithoutOvertime
		});
		importing = false;
	}
	/** The sheet the import expects, built in the browser: the entity and month prefilled. */
	async function downloadTemplate(): Promise<void> {
		if (company == null) return;
		const workbook = schedulingTemplateWorkbook({
			legalEntity: company.name,
			month: calendarMonth,
			timezone: timeZone,
			overtimeConsent: versionInForce?.work_rules?.overtime_consent != null,
			factColumns: (versionInForce?.work_day_facts ?? [])
				.filter((field) => field.import === true)
				.map((field) => field.key)
		});
		saveBlob(
			new Blob([await workbook.xlsx.writeBuffer()], { type: XLSX_MEDIA_TYPE }),
			`scheduling-${calendarMonth}.xlsx`
		);
	}
	/** The toolbar's actions menu: the month workbook's import and template, and the eye filter. */
	const boardActions = $derived<ToolbarItem[]>([
		{
			run: importWorkbook,
			group: 'import',
			icon: 'lucide:upload',
			label: t('app.scheduling.import'),
			description: t('app.scheduling.import_title', { month: calendarMonth }),
			disabled: () =>
				importing
					? t('component.loading')
					: company == null
						? t('app.scheduling.empty_board')
						: null
		},
		{
			run: downloadTemplate,
			group: 'import',
			icon: 'lucide:file-down',
			label: t('app.scheduling.import_template'),
			description: t('app.scheduling.import_template_description', { month: calendarMonth }),
			disabled: () => (company == null ? t('app.scheduling.empty_board') : null)
		},
		{
			run: () => (unresolvedOnly = !unresolvedOnly),
			icon: unresolvedOnly ? 'lucide:eye-off' : 'lucide:eye',
			label: unresolvedOnly
				? t('app.scheduling.show_all_people')
				: t('app.scheduling.show_unresolved_clock_outs'),
			description: t('app.scheduling.unresolved_hint')
		}
	]);
</script>

{#snippet periodPicker()}
	<MonthPeriodPicker
		month={period}
		halves={company?.pay_frequency === 'SEMI_MONTHLY'}
		weeks={company?.pay_frequency === 'WEEKLY'}
		onMonthChange={(next) => (month = next)}
	/>
{/snippet}

<Toaster />
<AppShell
	icon="lucide:calendar-clock"
	title="Work"
	description="Plan the monthly roster on a calendar, publish it against the statutory rules, and manage the shifts a day is worked on and the patterns a week is shaped by"
>
	{#snippet actions()}<CompanyScope {scope} />{/snippet}
	<ScopeGate {scope} empty={t('app.scheduling.empty_board')}>
		{#snippet children(id)}
			<CustomView
				of={people}
				key="work"
				fields={[
					{ field: 'number', label: t('component.employee_number') },
					{ field: 'name', label: t('component.name') }
				]}
				toolbar={{
					title: t('app.scheduling.board_title'),
					description: t('app.scheduling.help_published'),
					controls: periodPicker,
					actions: boardActions
				}}
			>
				{#snippet children(shown)}
					{@const boardPeople = onBoard(shown as readonly (typeof people)[number][])}
					{#if errors.length > 0}
						<Alert.Root variant="destructive">
							<Alert.Title>{t('app.scheduling.board_load_failed', { month: period })}</Alert.Title>
							<Alert.Description>
								<Stack as="ul" gap="xs" class="list-disc pl-4">
									{#each errors as error (error)}<li>{error}</li>{/each}
								</Stack>
							</Alert.Description>
						</Alert.Root>
					{:else if !loading && people.length > 0 && boardPeople.length === 0}
						<p class="text-sm text-muted-foreground">
							{unresolvedOnly
								? t('app.scheduling.no_unresolved_clock_outs', { month: period })
								: t('app.scheduling.no_matches')}
						</p>
					{:else if !loading && people.length === 0}
						<p class="text-sm text-muted-foreground">
							{emptyReason === 'NONE'
								? t('app.scheduling.no_company_employments')
								: emptyReason === 'ENDED'
									? t('app.scheduling.employments_ended_before', { month: period })
									: emptyReason === 'NOT_STARTED'
										? t('app.scheduling.employments_start_after', { month: period })
										: t('app.scheduling.employments_outside_month', { month: period })}
						</p>
					{:else}
						<RosterMonthBoard
							month={period}
							people={boardPeople}
							{loading}
							{facts}
							{today}
							holidayNames={holidaysByDate(calendar.holidays)}
							{locks}
							{settlementClaims}
							{cutoff}
							{editable}
							swappable={editable}
							bind:swapSource={swap.source}
							onSwapDays={(from, to) => void swapDays(from, to)}
							onSelectDay={openDay}
						/>
					{/if}
				{/snippet}
			</CustomView>
		{/snippet}
	</ScopeGate>
</AppShell>

<!-- A cell with no stored person-day: the collection's record view in create mode, with the person and the day. -->
<Sheet bind:open={create.open} title={t('component.create_work_day')}>
	{#if create.open && create.employmentId != null && create.date != null}
		{#key `${create.employmentId}:${create.date}`}
			<RecordShell
				of="work_days"
				mode="create"
				values={{ employment_id: create.employmentId, work_date: create.date }}
				onDone={(outcome) => {
					if (outcome.kind === 'committed' || outcome.kind === 'pendingApproval')
						create.open = false;
				}}
			/>
		{/key}
	{/if}
</Sheet>
