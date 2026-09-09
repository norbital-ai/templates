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
	import {
		formatEffectiveRange,
		formatStatutoryFactStatus
	} from '../../lib/ui/display-formatters.js';
	import { todayKey } from '../../lib/ui/calendar.js';
	import { Button } from '@norbital-ai/ui/button';
	import * as Dialog from '@norbital-ai/ui/dialog';
	import Icon from '@iconify/svelte';
	import FaceEnrollFlow from './face-enroll-flow.svelte';

	/** Terms as the profile reads them: the pointer, and the named pattern riding the `with`. */
	type EmploymentTerm = Pick<
		WorkspaceRow<'employment_terms'>,
		'employment_id' | 'effective_range' | 'shift_pattern_id'
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
		return (
			range.start.slice(0, 10) <= date && (range.end == null || range.end.slice(0, 10) >= date)
		);
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
			.filter((candidate) => candidate.range.start.slice(0, 10) > date)
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
					orderBy: { hire_date: 'desc' },
					limit: 100
				})
	);
	const employments = $derived((employmentsQuery?.current ?? []).map(resolveEmployment));
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
			<Field name="user_id" hidden />
			<Field name="face_embedding" hidden />
			<Field name="face_photo" hidden />
			<Field name="face_enrollment_status" hidden />
			<Field name="face_consent_at" hidden />
			<Field name="face_enrolled_at" hidden />
			<Field name="face_last_match_at" hidden />
			<Field name="face_match_count" hidden />
			<Stack gap="lg">
				<Grid gap="md" minimum="panel">
					<Field name="name" />
					<Field name="email" />
					<Field name="phone" />
					<Field name="date_of_birth" label={t('component.date_of_birth')} />
					<Field name="nationality" />
					<Field name="identity_number" label={t('component.identity_number')} />
					<Field name="gender" />
					<Field name="spouse_status" label={t('component.spouse')} />
					<Field name="dependents_count" label={t('component.dependents')} />
					<Column span="all"><Field name="address" /></Column>
				</Grid>
				<FormSection title={t('component.standing')} hint={t('component.standing_hint')}>
					<Grid gap="md" minimum="panel">
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
			</Stack>
		{/snippet}
	</CollectionForm>
{/snippet}

{#snippet engagements()}
	{#if record}
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
						format: ({ row }) => employmentSummary(row as { id: string; employee_number: unknown })
					}}
				/>
				<TableColumn name="company_id" label={t('component.legal_entity')} card="subtitle" />
				<TableColumn name="hire_date" label={t('component.hired')} />
				<TableColumn name="effective_range" label={t('component.effective')} />
			{/snippet}
		</CollectionTable>
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
