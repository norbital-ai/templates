<script lang="ts">
	/**
	 * What one legal entity still owes the authorities: the open remittances its payroll runs raised (with their
	 * amounts) and the open regulatory tasks its row events raised. Done and dismiss write the row's own state.
	 */
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import { toast } from 'svelte-sonner';
	import { AppShell, Cluster, Stack } from '@norbital-ai/ui/layout';
	import { Button, EmptyState, Label, Sheet, Table, Textarea } from '@norbital-ai/ui';
	import CompanyScope from '../../../lib/ui/scopes/company_picker.svelte';
	import { companyScope } from '../../../lib/ui/scopes/company_scope.svelte.js';
	import { todayKey } from '../../../lib/ui/format/calendar.js';

	const scope = companyScope();
	const t = bolt.t;
	let dismissing = $state<
		| { kind: 'obligation'; ids: Id<'obligation'>[] }
		| { kind: 'task'; ids: Id<'regulatory_task'>[] }
		| null
	>(null);
	let reason = $state('');
	let sheetOpen = $state(false);
	let saving = $state(false);

	type Outcome = Awaited<ReturnType<typeof bolt.act>>;
	function report(outcome: Outcome): void {
		if (outcome.kind === 'committed' || outcome.kind === 'pendingApproval')
			toast.success(t('compliance.saved'));
		else
			toast.error(
				outcome.kind === 'refused'
					? (outcome.message ?? t('component.error'))
					: t('component.error')
			);
	}

	async function settle(ids: Id<'obligation'>[]): Promise<void> {
		if (ids.length === 0) return;
		report(
			await bolt.act('obligation.update', {
				target: ids,
				set: { state: 'FULFILLED', fulfilled_on: todayKey() }
			})
		);
	}

	async function done(ids: Id<'regulatory_task'>[]): Promise<void> {
		if (ids.length === 0) return;
		report(
			await bolt.act('regulatory_task.update', {
				target: ids,
				set: { state: 'DONE', done_on: todayKey() }
			})
		);
	}

	async function dismiss(): Promise<void> {
		if (dismissing == null || saving) return;
		saving = true;
		try {
			report(
				dismissing.kind === 'obligation'
					? await bolt.act('obligation.update', {
							target: dismissing.ids,
							set: { state: 'WAIVED', waive_reason: reason }
						})
					: await bolt.act('regulatory_task.update', {
							target: dismissing.ids,
							set: { state: 'DISMISSED', dismiss_reason: reason }
						})
			);
			sheetOpen = false;
		} catch {
			toast.error(t('component.error'));
		} finally {
			saving = false;
		}
	}
</script>

<AppShell
	icon="lucide:clipboard-check"
	title={t('app.compliance.title')}
	description={t('app.compliance.description')}
>
	{#snippet actions()}<CompanyScope {scope} />{/snippet}
	{#if scope.id == null}
		<EmptyState title={t('app.payroll.empty_runs')} />
	{:else}
		<Stack gap="md">
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
							label: t('compliance.settle')
						},
						{
							run: (ids: Id<'obligation'>[]) => {
								reason = '';
								dismissing = { kind: 'obligation', ids };
								sheetOpen = true;
							},
							requiresSelection: true,
							icon: 'lucide:x',
							label: t('compliance.waive')
						}
					]
				}}
				columns={['duty_code', 'authority', 'triggered_on', 'due_on', 'amount_due']}
			/>
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
							label: t('compliance.done')
						},
						{
							run: (ids: Id<'regulatory_task'>[]) => {
								reason = '';
								dismissing = { kind: 'task', ids };
								sheetOpen = true;
							},
							requiresSelection: true,
							icon: 'lucide:x',
							label: t('compliance.dismiss')
						}
					]
				}}
				columns={['title', 'authority', 'subject_collection', 'triggered_on', 'due_on']}
			/>
		</Stack>
	{/if}
</AppShell>

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
