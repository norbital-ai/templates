<script lang="ts">
	import { resolveEmployment } from '../../lib/employment-contract.js';
	import { FormattedValueRenderer } from '@norbital-ai/ui/data-renderer';
	/**
	 * One person's whole file: who they are, the engagements they hold, the terms of each engagement
	 * and where each stands with the statutory schemes.
	 *
	 * These were four sibling tabs in the People app, which meant reading one person required knowing
	 * their employee number and then filtering three unrelated tables by it. They are all facts about
	 * one human being, so they are read from that human being's record.
	 */
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import { Result, Schema } from 'effect';
	import type { RepresentationProps, WorkspaceRow } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { CollectionTable } from '@norbital-ai/ui/collection-table';
	import { getDataRendererRuntimeContext } from '@norbital-ai/ui/data-renderer';
	import { Column, Grid, Stack } from '@norbital-ai/ui/layout';
	import { RecordShell } from '@norbital-ai/ui/record-shell';
	import type { TabConfig } from '@norbital-ai/ui/tabs';
	import FormSection from '../../lib/ui/form-section.svelte';
	import { workPatternSchema, type WorkPattern } from '../../datatypes/work_pattern/+definition.js';
	import { AS_ASSIGNED_PATTERN } from '../../lib/scheduling/work-pattern.js';
	import { readRange, StoredRangeSchema, type StoredRange } from '../payroll_runs/lib/effective.js';
	import { dateKey } from '../../lib/iso-day.js';
	import {
		formatCalendarDate,
		formatEffectiveRange,
		formatStatutoryFactStatus
	} from '../../lib/ui/display-formatters.js';
	import {
		calendarDateInTimeZone,
		daysBetweenKeys,
		PAYROLL_TIME_ZONE,
		todayKey
	} from '../../lib/ui/calendar.js';
	import { Button } from '@norbital-ai/ui/button';
	import * as Dialog from '@norbital-ai/ui/dialog';
	import Icon from '@iconify/svelte';
	import FaceEnrollFlow from './face-enroll-flow.svelte';
	import { setContext } from 'svelte';
	import { HR_CREATE_SCOPE, type HrCreateScope } from '../../lib/ui/create-scope.js';

	/** Terms as the profile reads them: the pointer, and the named pattern riding the `with`. */
	type EmploymentTerm = Pick<
		WorkspaceRow<'employment_terms'>,
		'employment_id' | 'effective_range' | 'shift_pattern_id' | 'summary'
	> & {
		readonly term_shift_pattern?: Pick<
			WorkspaceRow<'shift_patterns'>,
			'id' | 'code' | 'name' | 'pattern'
		> | null;
	};

	const employmentScheduleSchema = Schema.Union([
		Schema.Struct({
			state: Schema.Literals(['current', 'next']),
			effectiveRange: StoredRangeSchema,
			summary: Schema.String
		}),
		Schema.Struct({ state: Schema.Literal('missing') })
	]);
	type EmploymentSchedule = Schema.Schema.Type<typeof employmentScheduleSchema>;

	/** The work-pattern decoder, built once — it is stateless, and a fresh one per term does the same work. */
	const decodeWorkPattern = Schema.decodeUnknownResult(workPatternSchema);

	function isEffectiveOn(range: StoredRange, date: string): boolean {
		// Days are resolved through the payroll zone, not sliced from the instant: a UI pick east
		// of UTC stores the viewer's day boundary, whose text begins a day earlier.
		const start = dateKey(range.start);
		if (start === '' || start > date) return false;
		const end = range.end == null ? '' : dateKey(range.end);
		return end === '' || end >= date;
	}

	function summarizePattern(code: string, pattern: WorkPattern): string {
		if (pattern.type === 'ROSTERED') {
			if (pattern.expectation.kind === 'AS_ASSIGNED') {
				return pattern.expectation.maximum_paid_minutes == null
					? `${code} · Roster-assigned · as assigned`
					: `${code} · Roster-assigned · up to ${pattern.expectation.maximum_paid_minutes / 60}h/${pattern.expectation.period.toLowerCase()}`;
			}
			return `${code} · Roster-assigned · ${pattern.expectation.required_work_days}d · ${pattern.expectation.required_paid_minutes / 60}h/${pattern.expectation.period.toLowerCase()}`;
		}

		const continuous =
			pattern.phases.length === 1 && pattern.phases[0]?.duration.kind === 'CONTINUOUS';
		if (continuous) {
			const days = pattern.phases[0]?.day_cycle.length ?? 0;
			return `${code} · ${days}-day cycle · starts ${pattern.anchor_date}`;
		}
		return `${code} · ${pattern.phases.length} calendar phases · starts ${pattern.anchor_date}`;
	}

	/** Terms with no pattern are rostered as assigned; there is no row to name. */
	function summarizeUnnamed(pattern: WorkPattern): string {
		if (pattern.type === 'ROSTERED') {
			if (pattern.expectation.kind === 'AS_ASSIGNED') {
				return pattern.expectation.maximum_paid_minutes == null
					? 'Roster-assigned · as assigned'
					: `Roster-assigned · up to ${pattern.expectation.maximum_paid_minutes / 60}h/${pattern.expectation.period.toLowerCase()}`;
			}
			return `Roster-assigned · ${pattern.expectation.required_work_days}d · ${pattern.expectation.required_paid_minutes / 60}h/${pattern.expectation.period.toLowerCase()}`;
		}

		const continuous =
			pattern.phases.length === 1 && pattern.phases[0]?.duration.kind === 'CONTINUOUS';
		if (continuous) {
			const days = pattern.phases[0]?.day_cycle.length ?? 0;
			return `Patterned · ${days}-day cycle · starts ${pattern.anchor_date}`;
		}
		return `Patterned · ${pattern.phases.length} calendar phases · starts ${pattern.anchor_date}`;
	}

	function employmentScheduleOn(
		terms: readonly Pick<
			EmploymentTerm,
			'effective_range' | 'shift_pattern_id' | 'term_shift_pattern'
		>[],
		date: string
	): EmploymentSchedule {
		const candidates = terms.flatMap((term) => {
			const range = readRange(term.effective_range);
			if (range == null) return [];
			// Read through the row: the named pattern the terms point at, or as assigned when none.
			const row = term.shift_pattern_id == null ? null : (term.term_shift_pattern ?? null);
			const parsed = decodeWorkPattern(row?.pattern ?? AS_ASSIGNED_PATTERN);
			return !Result.isSuccess(parsed)
				? []
				: [{ range, pattern: parsed.success, code: row?.code ?? null }];
		});
		const current = candidates.find((candidate) => isEffectiveOn(candidate.range, date));
		if (current) {
			return {
				state: 'current',
				effectiveRange: current.range,
				summary:
					current.code == null
						? summarizeUnnamed(current.pattern)
						: summarizePattern(current.code, current.pattern)
			};
		}
		const next = candidates
			.filter((candidate) => dateKey(candidate.range.start) > date)
			.toSorted((left, right) => left.range.start.localeCompare(right.range.start))[0];
		if (next) {
			return {
				state: 'next',
				effectiveRange: next.range,
				summary:
					next.code == null
						? summarizeUnnamed(next.pattern)
						: summarizePattern(next.code, next.pattern)
			};
		}
		return { state: 'missing' };
	}

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const today = todayKey();
	const fileRuntime = getDataRendererRuntimeContext();
	/**
	 * Face enrollment opens from here and nowhere else: the kiosk on the wall only clocks. The
	 * flow mounts with the dialog and releases the camera when it closes.
	 */
	let enrollOpen = $state(false);
	let justSavedUrl = $state<string | null>(null);

	const approved = { approval_id: { isNull: true } } as const;

	const employmentsQuery = $derived(
		record == null
			? null
			: client.db.employments.findMany({
					where: { ...approved, employee_id: { eq: record.id } },
					columns: {
						id: true,
						company_id: true,
						employee_number: true,
						hire_date: true,
						effective_range: true,
						exit_date: true,
						exit_reason: true
					},
					orderBy: { hire_date: 'desc' },
					limit: 100
				})
	);
	const employments = $derived((employmentsQuery?.current ?? []).map(resolveEmployment));
	/**
	 * The scope the profile hands to the forms its tables open (terms, statutory facts). A person
	 * with one contract has it prefilled and hidden; with several, the picker offers the entity's
	 * own people, and with none the form is unnarrowed rather than empty.
	 */
	const scopedEmployment = $derived(employments.length === 1 ? employments[0] : undefined);
	// The entity's lineage rides a second read: `with` joins are untyped on the browser client,
	// so the scope resolves the company row itself rather than joining it into the employments.
	const scopedCompanyQuery = $derived(
		scopedEmployment == null
			? null
			: client.db.companies.findFirst({
					where: { id: { eq: scopedEmployment.company_id } },
					columns: { settings_code: true }
				})
	);
	setContext<HrCreateScope>(HR_CREATE_SCOPE, {
		employmentId: () => scopedEmployment?.id,
		companyId: () => scopedEmployment?.company_id,
		settingsCode: () => scopedCompanyQuery?.current?.settings_code ?? undefined
	});
	const subtitle = $derived(
		record == null
			? undefined
			: `${record.email ?? t('component.no_email_recorded')} · ${record.nationality ?? t('component.nationality_not_recorded')}`
	);
	// Terms are read only while the Employments tab is open. One employee-scoped query feeds every
	// row, so opening a profile does not mount a table or lookup per employment.
	const employmentTermsQuery = $derived(
		record == null
			? null
			: client.db.employment_terms.findMany({
					where: {
						approval_id: { isNull: true },
						// A relation only enters a predicate under a quantifier. Naming the related
						// column directly reads as a field of `employment_terms`, and the grammar
						// refuses it — "term_employment has unsupported operator employee_id" — which
						// reached the browser as an uncaught SchemaError on every profile opened.
						term_employment: { some: { employee_id: { eq: record.id } } }
					},
					// The named pattern rides the terms read; no second query per employment.
					with: {
						term_shift_pattern: { columns: { id: true, code: true, name: true, pattern: true } }
					},
					limit: 500
				})
	);
	function employmentSummary(employment: { id: string; employee_number: unknown }): string {
		const employeeNumber =
			employment.employee_number == null ? '—' : String(employment.employee_number);
		const schedule = employmentScheduleOn(termsByEmployment.get(employment.id) ?? [], today);
		if (employmentTermsQuery?.loading) {
			return `${employeeNumber} · ${t('component.schedule_loading')}`;
		}
		if (schedule.state === 'missing') {
			return `${employeeNumber} · ${t('component.schedule_not_configured')}`;
		}
		const scheduleLabel =
			schedule.state === 'current'
				? t('component.schedule_current', { summary: schedule.summary })
				: t('component.schedule_next', { summary: schedule.summary });
		return `${employeeNumber} · ${scheduleLabel} · ${t('component.effective')} ${formatEffectiveRange(schedule.effectiveRange)}`;
	}
	const termsByEmployment = $derived.by(() => {
		const terms = new Map<string, EmploymentTerm[]>();
		for (const term of employmentTermsQuery?.current ?? []) {
			if (typeof term.employment_id !== 'string') continue;
			const bucket = terms.get(term.employment_id);
			if (bucket) bucket.push(term);
			else terms.set(term.employment_id, [term]);
		}
		return terms;
	});

	/** A stored day-precision instant as a `YYYY-MM-DD` key in the payroll timezone. */
	function timelineDayKey(value: unknown): string | null {
		if (value == null) return null;
		const instant = value instanceof Date ? value : new Date(String(value));
		if (Number.isNaN(instant.getTime())) return null;
		return calendarDateInTimeZone(instant, PAYROLL_TIME_ZONE);
	}

	type TimelineBar = {
		readonly id: string;
		readonly companyId: string;
		readonly employeeNumber: string;
		readonly startKey: string;
		readonly endKey: string;
		readonly active: boolean;
		readonly termsSummary: string | null;
		readonly top: number;
		readonly height: number;
	};

	type TimelineColumn = {
		readonly companyId: string;
		readonly companyName: string;
		readonly active: boolean;
		readonly lastEndKey: string | null;
		readonly bars: readonly TimelineBar[];
	};

	/** The terms in force on `date`: the covering row, else the latest row's summary. */
	function termsSummaryInForce(terms: readonly EmploymentTerm[], date: string): string | null {
		const dated = terms.flatMap((term) => {
			const range = readRange(term.effective_range);
			return range == null ? [] : [{ range, summary: term.summary }];
		});
		const covering =
			dated.find((candidate) => isEffectiveOn(candidate.range, date)) ??
			dated.toSorted((left, right) => right.range.start.localeCompare(left.range.start))[0];
		const summary = covering?.summary;
		return typeof summary === 'string' && summary !== '' ? summary : null;
	}

	// Company names for the timeline columns; the employments read carries only the id.
	const timelineCompanyIds = $derived([
		...new Set(employments.map((employment) => employment.company_id))
	]);
	const timelineCompaniesQuery = $derived(
		record == null || timelineCompanyIds.length === 0
			? null
			: client.db.companies.findMany({
					where: { id: { in: timelineCompanyIds } },
					columns: { id: true, name: true },
					limit: 50
				})
	);
	const timelineCompanyNames = $derived(
		new Map(
			(timelineCompaniesQuery?.current ?? []).map((company) => [
				String(company.id),
				company.name == null || company.name === '' ? String(company.id) : String(company.name)
			])
		)
	);

	/**
	 * One column per legal entity, time down the Y axis, one bar per employment from its hire
	 * date to its exit date (or today when active). Overlap within an entity is refused by the
	 * hook, so the bars are drawn as stored and never overlap by construction.
	 */
	const timeline = $derived.by(() => {
		const bars = employments.flatMap((employment) => {
			if (typeof employment.id !== 'string' || typeof employment.company_id !== 'string') return [];
			const startKey =
				timelineDayKey(employment.hire_date) ??
				timelineDayKey(readRange(employment.effective_range)?.start) ??
				today;
			const storedEnd = employment.exit_date == null ? null : timelineDayKey(employment.exit_date);
			const active = storedEnd == null || storedEnd >= today;
			const endKey = storedEnd == null ? today : storedEnd < startKey ? startKey : storedEnd;
			const reference = active ? today : endKey;
			return [
				{
					id: employment.id,
					companyId: employment.company_id,
					employeeNumber:
						employment.employee_number == null ? '—' : String(employment.employee_number),
					startKey,
					endKey,
					active,
					termsSummary: termsSummaryInForce(termsByEmployment.get(employment.id) ?? [], reference)
				}
			];
		});
		if (bars.length === 0) return { columns: [], todayTop: 0, showToday: false };
		const minKey = bars.map((bar) => bar.startKey).toSorted()[0]!;
		const maxKey = [today, ...bars.map((bar) => bar.endKey)].toSorted().at(-1)!;
		const spanDays = Math.max(1, daysBetweenKeys(minKey, maxKey));
		const position = (key: string) => (daysBetweenKeys(minKey, key) / spanDays) * 100;
		const byCompany = new Map<string, Omit<TimelineBar, 'top' | 'height'>[]>();
		for (const bar of bars) {
			const bucket = byCompany.get(bar.companyId);
			if (bucket) bucket.push(bar);
			else byCompany.set(bar.companyId, [bar]);
		}
		const columns: TimelineColumn[] = [...byCompany]
			.map(([companyId, companyBars]) => {
				const placed: TimelineBar[] = companyBars
					.toSorted((left, right) => left.startKey.localeCompare(right.startKey))
					.map((bar) => ({
						...bar,
						top: position(bar.startKey),
						height: ((daysBetweenKeys(bar.startKey, bar.endKey) + 1) / spanDays) * 100
					}));
				return {
					companyId,
					companyName: timelineCompanyNames.get(companyId) ?? companyId,
					active: placed.some((bar) => bar.active),
					lastEndKey:
						placed
							.filter((bar) => !bar.active)
							.map((bar) => bar.endKey)
							.toSorted()
							.at(-1) ?? null,
					bars: placed
				};
			})
			.toSorted((left, right) => left.companyName.localeCompare(right.companyName));
		return { columns, todayTop: position(today), showToday: today >= minKey };
	});

	const storedPhotoKey = $derived.by(() => {
		if (record === null || typeof record.face_photo !== 'object' || record.face_photo === null)
			return null;
		const key = (record.face_photo as { readonly storage_key?: unknown }).storage_key;
		return typeof key === 'string' ? key : null;
	});
	const photoHref = $derived(
		justSavedUrl ??
			(storedPhotoKey === null ? null : (fileRuntime?.fileUrl(storedPhotoKey) ?? null))
	);
	const displayFaceStatus = $derived(
		justSavedUrl !== null && record?.face_enrollment_status === 'NONE'
			? 'APPROVED'
			: (record?.face_enrollment_status ?? 'NONE')
	);
	const FACE_STATUS_KEYS: Readonly<Record<string, TenantI18nKeys>> = {
		NONE: 'face.status_none',
		PENDING: 'face.status_pending',
		APPROVED: 'face.status_approved',
		SUSPENDED: 'face.status_suspended'
	};
</script>

{#snippet person()}
	<CollectionForm
		{client}
		collection="employees"
		defaultValues={record ?? undefined}
		submitLabel={record ? t('component.save_person') : t('component.add_person')}
		onAfterSubmit={record ? undefined : close}
	>
		{#snippet children({ Field })}
			<!-- Written by the enrolment flow and the kiosk functions only; never offered. -->
			<Field name="user_id" hidden />
			<Field name="face_embedding" hidden />
			<Field name="face_photo" hidden />
			<Field name="face_enrollment_status" hidden />
			<Field name="face_consent_at" hidden />
			<Field name="face_enrolled_at" hidden />
			<Field name="face_last_match_at" hidden />
			<Field name="face_match_count" hidden />
			<Stack gap="lg">
				<FormSection first title={t('component.person')} hint={t('component.person_section_hint')}>
					<Grid gap="sm" minimum="compact">
						<Field name="name" />
						<Field name="gender" />
						<Field name="date_of_birth" label={t('component.date_of_birth')} />
						<Field name="nationality" />
						<Field name="identity_number" label={t('component.identity_number')} />
						<Field name="email" />
						<Field name="phone" />
						<Column span="all"><Field name="address" /></Column>
					</Grid>
				</FormSection>
				<FormSection title={t('component.standing')} hint={t('component.standing_hint')}>
					<Grid gap="sm" minimum="compact">
						<Field name="marital_status" label={t('component.marital_status')} />
						<Field name="solo_parent" label={t('component.solo_parent')} />
						<Stack gap="xs">
							<Field name="race" label={t('component.race')} />
							<p class="text-meta">{t('component.race_religion_hint')}</p>
						</Stack>
						<Stack gap="xs">
							<Field name="religion" label={t('component.religion')} />
							<p class="text-meta">{t('component.race_religion_hint')}</p>
						</Stack>
					</Grid>
				</FormSection>
				<FormSection
					title={t('component.family_section')}
					hint={t('component.family_section_hint')}
				>
					<Grid gap="sm" minimum="compact">
						<Field name="spouse_status" label={t('component.spouse')} />
						<Field name="dependents_count" label={t('component.dependents')} />
					</Grid>
				</FormSection>
			</Stack>
		{/snippet}
	</CollectionForm>
{/snippet}

{#snippet engagements()}
	{#if record}
		<Stack gap="lg">
			{#if timeline.columns.length > 0}
				<FormSection
					first
					title={t('component.timeline_title')}
					hint={t('component.timeline_hint')}
				>
					<div class="flex gap-4 overflow-x-auto pb-2">
						{#each timeline.columns as column (column.companyId)}
							<div class="min-w-[14rem] flex-1">
								<h4 class="text-sm font-semibold">{column.companyName}</h4>
								<p class="text-meta">
									{#if column.active}
										{t('component.timeline_active')}
									{:else if column.lastEndKey != null}
										{t('component.timeline_last_ended', {
											date: formatCalendarDate(column.lastEndKey)
										})}
									{/if}
								</p>
								<div class="relative mt-2 h-80 rounded-md bg-muted/40">
									{#if timeline.showToday}
										<div
											class="absolute right-0 left-0 border-t border-dashed border-primary"
											style="top: {timeline.todayTop}%"
										>
											<span class="text-meta absolute top-0 right-1 bg-card px-1"
												>{t('component.timeline_today')}</span
											>
										</div>
									{/if}
									{#each column.bars as bar (bar.id)}
										<div
											class="absolute right-2 left-2 overflow-hidden rounded-md border p-2 {bar.active
												? 'border-primary bg-card'
												: 'border-border bg-muted text-muted-foreground'}"
											style="top: {bar.top}%; height: {bar.height}%; min-height: 4.5rem;"
										>
											<p class="text-sm font-medium text-foreground">{bar.employeeNumber}</p>
											<p class="text-meta">
												{bar.termsSummary ?? t('component.timeline_no_terms')}
											</p>
											<p class="text-meta">
												{formatCalendarDate(bar.startKey)} → {bar.active
													? t('component.timeline_today')
													: formatCalendarDate(bar.endKey)}
												· {bar.active
													? t('component.timeline_active')
													: t('component.timeline_ended')}
											</p>
										</div>
									{/each}
								</div>
							</div>
						{/each}
					</div>
				</FormSection>
			{/if}
			<CollectionTable
				{client}
				collection="employments"
				view="employees:employments"
				title={t('component.employments')}
				description={t('component.employments_description')}
				query={{
					where: { employee_id: { eq: record.id } },
					orderBy: { hire_date: 'desc' }
				}}
			>
				{#snippet columns({ Column: TableColumn })}
					<TableColumn
						name="employee_number"
						card="title"
						minWidth={280}
						renderer={FormattedValueRenderer}
						rendererProps={{
							format: ({ row }) =>
								employmentSummary(row as { id: string; employee_number: unknown })
						}}
					/>
					<TableColumn name="company_id" label={t('component.legal_entity')} card="subtitle" />
					<TableColumn name="hire_date" label={t('component.hired')} />
					<TableColumn name="effective_range" label={t('component.effective')} />
				{/snippet}
			</CollectionTable>
		</Stack>
	{/if}
{/snippet}

{#snippet statutoryFacts()}
	<CollectionTable
		{client}
		collection="employment_statutory_facts"
		view="employees:statutory-facts"
		title={t('component.statutory_registrations')}
		description={t('component.statutory_registrations_description')}
		query={{
			where:
				record == null
					? { id: { in: [] } }
					: // A relation enters a predicate only under a quantifier; naming the related
						// column directly reads as a field of this collection and is refused.
						{ statutory_fact_employment: { some: { employee_id: { eq: record.id } } } },
			orderBy: { created_at: 'desc' }
		}}
	>
		{#snippet columns({ Column: TableColumn })}
			<TableColumn name="employment_id" label={t('component.employment')} card="title" />
			<TableColumn
				name="statutory_contribution_id"
				label={t('component.contribution')}
				card="subtitle"
			/>
			<TableColumn
				name="status"
				label={t('component.registration')}
				renderer={FormattedValueRenderer}
				rendererProps={{ format: ({ value }) => formatStatutoryFactStatus(value, t) }}
			/>
			<TableColumn name="effective_range" label={t('component.effective')} />
		{/snippet}
	</CollectionTable>
{/snippet}

{#snippet faceIdentity()}
	{#if record}
		<Stack gap="sm">
			{#if photoHref !== null}
				<img class="w-40 rounded-lg" src={photoHref} alt={t('face.enrolled_photo')} />
			{:else}
				<p class="text-sm text-muted-foreground">{t('face.no_photo')}</p>
			{/if}
			<p class="text-sm">
				{t(FACE_STATUS_KEYS[displayFaceStatus])}
				{#if record.face_match_count > 0}
					· {t('face.matches', { count: record.face_match_count })}
				{/if}
			</p>
			<div>
				<Button
					variant="secondary"
					data-face-enroll-action
					onclick={() => {
						enrollOpen = true;
					}}
				>
					<Icon icon="lucide:scan-face" class="size-4" />
					{displayFaceStatus === 'NONE' ? t('face.enroll') : t('face.re_enroll')}
				</Button>
			</div>
		</Stack>
		<Dialog.Root bind:open={enrollOpen}>
			<Dialog.Content class="max-w-2xl">
				<Dialog.Header>
					<Dialog.Title>{t('face.title')}</Dialog.Title>
					<Dialog.Description>{t('face.description', { name: record.name })}</Dialog.Description>
				</Dialog.Header>
				{#if enrollOpen}
					<FaceEnrollFlow
						{record}
						onsaved={(previewUrl) => {
							justSavedUrl = previewUrl;
						}}
						onclose={() => {
							enrollOpen = false;
						}}
					/>
				{/if}
			</Dialog.Content>
		</Dialog.Root>
	{/if}
{/snippet}

<!-- Tab content must be snippets (TabConfig.content); the shell always renders tabs so no snippet is ever render-called elsewhere. -->
<RecordShell
	title={record?.name ?? t('component.create_employee')}
	{subtitle}
	tabs={[
		{ name: 'person', label: t('component.person'), icon: 'lucide:user', content: person },
		...(record
			? [
					{
						name: 'employments',
						label: t('component.employments'),
						icon: 'lucide:briefcase',
						content: engagements
					},
					{
						name: 'statutory-facts',
						label: t('component.statutory_facts'),
						icon: 'lucide:id-card',
						content: statutoryFacts
					},
					{
						name: 'face',
						label: t('face.tab'),
						icon: 'lucide:scan-face',
						content: faceIdentity
					}
				]
			: [])
	] satisfies TabConfig[]}
/>
