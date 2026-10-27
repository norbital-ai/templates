<script lang="ts">
	import { Effect } from 'effect';
	import { fork } from '@norbital-ai/ui/effect';
	/**
	 * What one legal entity still owes the authorities: the open remittances its payroll runs raised (with their
	 * amounts) and the open regulatory tasks its row events raised, each under its name. Done and dismiss write the row's
	 * own state. Beside them, the entity's workplace cases and work suspensions, which raise tasks and mark days: New and a
	 * row open their record. One tab per list.
	 */
	import { bolt } from '$bolt';
	import type { Id, Outcome, Row } from '@norbital-ai/bolt';
	import { AppShell, Cluster, Stack } from '@norbital-ai/ui/layout';
	import {
		Button,
		EmptyState,
		Label,
		RecordShell,
		Sheet,
		singular,
		Table,
		Tabs,
		Textarea,
		notifyOutcome,
		toast,
		useBolt
	} from '@norbital-ai/ui';
	import CompanyScope from '../../../lib/ui/scopes/company_picker.svelte';
	import { companyScope } from '../../../lib/ui/scopes/company_scope.svelte.js';
	import { todayKey } from '../../../lib/ui/format/calendar.js';
	import { readableTitle } from '../../../lib/ui/format/display_formatters.js';
	import { listedKindNames } from '../../../lib/ui/format/listed_kind_names.svelte.js';
	const scope = companyScope();
	const t = bolt.t;
	const ui = useBolt();
	/** A remittance reads as the OBLIGATIONS rule that raised it, a case and a suspension as their kind's name. */
	const names = $derived.by(() =>
		bolt.query({
			rule_set: { where: { family: { eq: 'OBLIGATIONS' } }, fields: ['code', 'name'] },
			jurisdiction_settings: {
				where: { sealed_at: { isNull: false } },
				fields: ['suspension_kinds']
			}
		})
	);
	const dutyName = $derived(
		new Map((names?.current?.rule_set.rows ?? []).map((row) => [row.code, row.name] as const))
	);
	const caseName = listedKindNames('case_kinds');
	const suspensionName = $derived(
		new Map(
			(names?.current?.jurisdiction_settings.rows ?? []).flatMap((row) =>
				(row.suspension_kinds ?? []).map((kind) => [kind.code, kind.name ?? kind.code] as const)
			)
		)
	);
	let dismissing = $state<
		| {
				kind: 'obligation';
				ids: Id<'obligation'>[];
		  }
		| {
				kind: 'task';
				ids: Id<'regulatory_task'>[];
		  }
		| null
	>(null);
	let reason = $state('');
	// a case or suspension is created under this page's entity, so its kind picker lists that lineage's kinds only
	let creating = $state<'workplace_case' | 'work_suspension' | null>(null);
	let sheetOpen = $state(false);
	let saving = $state(false);
	function report(outcome: Outcome<unknown>): void {
		if (outcome.kind === 'pendingApproval') toast.info(t('offboarding.pending'));
		else if (outcome.kind === 'committed') toast.success(t('compliance.saved'));
		// a refusal fails the act; what is left is a write still running past the person-wait
		else notifyOutcome(bolt, outcome);
	}
	function settle(ids: Id<'obligation'>[]): void {
		fork(
			Effect.gen(function* () {
				if (ids.length === 0) return;
				report(
					yield* bolt.act(
						'obligation.update',
						ids.map((target) => ({ target, set: { state: 'FULFILLED', fulfilled_on: todayKey() } }))
					)
				);
			}).pipe(
				Effect.catch((failure) =>
					Effect.sync(() => {
						toast.error(failure instanceof Error ? failure.message : t('component.error'));
					})
				)
			)
		);
	}
	function done(ids: Id<'regulatory_task'>[]): void {
		fork(
			Effect.gen(function* () {
				if (ids.length === 0) return;
				report(
					yield* bolt.act(
						'regulatory_task.update',
						ids.map((target) => ({ target, set: { state: 'DONE', done_on: todayKey() } }))
					)
				);
			}).pipe(
				Effect.catch((failure) =>
					Effect.sync(() => {
						toast.error(failure instanceof Error ? failure.message : t('component.error'));
					})
				)
			)
		);
	}
	function dismiss(): void {
		if (dismissing == null || saving) return;
		const selected = dismissing;
		saving = true;
		fork(
			Effect.gen(function* () {
				report(
					selected.kind === 'obligation'
						? yield* bolt.act(
								'obligation.update',
								selected.ids.map((target) => ({
									target,
									set: { state: 'WAIVED', waive_reason: reason }
								}))
							)
						: yield* bolt.act(
								'regulatory_task.update',
								selected.ids.map((target) => ({
									target,
									set: { state: 'DISMISSED', dismiss_reason: reason }
								}))
							)
				);
				sheetOpen = false;
			}).pipe(
				Effect.catch((failure) =>
					Effect.sync(() => {
						toast.error(failure instanceof Error ? failure.message : t('component.error'));
					})
				),
				Effect.ensuring(
					Effect.sync(() => {
						saving = false;
					})
				)
			)
		);
	}
</script>

{#snippet titleCell({
	value
}: {
	value: Row<'regulatory_task'>['title'] | undefined;
})}{readableTitle(value ?? '')}{/snippet}
{#snippet dutyCell({ value }: { value: Row<'obligation'>['duty_code'] | undefined })}{@const code =
		value ?? ''}{dutyName.get(code) ?? readableTitle(code)}{/snippet}
{#snippet subjectCell({
	value
}: {
	value: Row<'regulatory_task'>['subject_collection'] | undefined;
})}{singular(ui, value ?? '')}{/snippet}
{#snippet caseCell({ value }: { value: Row<'workplace_case'>['kind'] | undefined })}{caseName(
		value ?? ''
	)}{/snippet}
{#snippet suspensionCell({
	value
}: {
	value: Row<'work_suspension'>['kind'] | undefined;
})}{@const code = value ?? ''}{suspensionName.get(code) ?? readableTitle(code)}{/snippet}

{#snippet obligations()}
	{#if scope.id != null}
		<Table
			of="obligation"
			key={`obligation-${scope.id}`}
			where={{ company_id: { eq: scope.id }, state: { eq: 'OPEN' } }}
			orderBy={{ due_on: 'asc' }}
			toolbar={{
				title: t('app.compliance.obligations'),
				actions: [
					{
						run: settle,
						requiresSelection: true,
						icon: 'lucide:check',
						name: t('compliance.settle')
					},
					{
						run: (ids: Id<'obligation'>[]) => {
							reason = '';
							dismissing = { kind: 'obligation', ids };
							sheetOpen = true;
						},
						requiresSelection: true,
						icon: 'lucide:x',
						name: t('compliance.waive')
					}
				]
			}}
			columns={[
				{ field: 'duty_code', label: t('compliance.duty'), cell: dutyCell },
				'references',
				'triggered_on',
				'due_on',
				'amount_due'
			]}
		/>
	{/if}
{/snippet}
{#snippet tasks()}
	{#if scope.id != null}
		<Table
			of="regulatory_task"
			key={`regulatory_task-${scope.id}`}
			where={{ company_id: { eq: scope.id }, state: { eq: 'OPEN' } }}
			orderBy={{ due_on: 'asc' }}
			toolbar={{
				title: t('app.compliance.tasks'),
				actions: [
					{
						run: done,
						requiresSelection: true,
						icon: 'lucide:check',
						name: t('compliance.done')
					},
					{
						run: (ids: Id<'regulatory_task'>[]) => {
							reason = '';
							dismissing = { kind: 'task', ids };
							sheetOpen = true;
						},
						requiresSelection: true,
						icon: 'lucide:x',
						name: t('compliance.dismiss')
					}
				]
			}}
			columns={[
				{ field: 'title', cell: titleCell },
				'references',
				{ field: 'subject_collection', label: t('section.subject'), cell: subjectCell },
				'triggered_on',
				'due_on'
			]}
		/>
	{/if}
{/snippet}
{#snippet cases()}
	{#if scope.id != null}
		<Table
			of="workplace_case"
			key={`workplace_case-${scope.id}`}
			where={{ company_id: { eq: scope.id } }}
			orderBy={{ opened_on: 'desc' }}
			toolbar={{ title: t('app.compliance.cases'), new: () => (creating = 'workplace_case') }}
			columns={[{ field: 'kind', cell: caseCell }, 'employment_id', 'opened_on', 'closed_on']}
		/>
	{/if}
{/snippet}
{#snippet suspended()}
	{#if scope.id != null}
		<Table
			of="work_suspension"
			key={`work_suspension-${scope.id}`}
			where={{ company_id: { eq: scope.id } }}
			orderBy={{ starts_on: 'desc' }}
			toolbar={{
				title: t('app.compliance.suspensions'),
				new: () => (creating = 'work_suspension')
			}}
			columns={[{ field: 'kind', cell: suspensionCell }, 'starts_on', 'ends_on', 'worksite']}
		/>
	{/if}
{/snippet}

<AppShell
	icon="lucide:clipboard-check"
	title={t('app.compliance.title')}
	description={t('app.compliance.description')}
>
	{#snippet actions()}<CompanyScope {scope} />{/snippet}
	{#if scope.id == null}
		<EmptyState title={t('app.payroll.empty_runs')} />
	{:else}
		<Tabs
			tabs={[
				{ name: 'obligations', title: t('app.compliance.obligations'), body: obligations },
				{ name: 'tasks', title: t('app.compliance.tasks'), body: tasks },
				{ name: 'cases', title: t('app.compliance.cases'), body: cases },
				{ name: 'suspensions', title: t('app.compliance.suspensions'), body: suspended }
			]}
		/>
	{/if}
</AppShell>

{#if creating != null && scope.id != null}
	<Sheet
		open
		onOpenChange={(open) => !open && (creating = null)}
		title={t(creating === 'workplace_case' ? 'app.compliance.cases' : 'app.compliance.suspensions')}
	>
		<RecordShell
			of={creating}
			mode="create"
			values={{ company_id: scope.id }}
			onDone={() => (creating = null)}
		/>
	</Sheet>
{/if}

<Sheet bind:open={sheetOpen} title={t('compliance.dismiss_title')}>
	<Stack gap="md">
		<Stack gap="xs">
			<Label for="compliance-reason">{t('compliance.reason')}</Label>
			<Textarea id="compliance-reason" rows={3} bind:value={reason} disabled={saving} />
		</Stack>
		<Cluster gap="sm" justify="end">
			<Button variant="outline" disabled={saving} onclick={() => (sheetOpen = false)}>
				{t('component.cancel')}
			</Button>
			<Button disabled={saving || reason.trim() === ''} onclick={() => void dismiss()}>
				{t('compliance.confirm')}
			</Button>
		</Cluster>
	</Stack>
</Sheet>
