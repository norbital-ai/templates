<script lang="ts">
	/** End employment: pick a last day, write exit facts, and close the contract range once. */
	import { bolt } from '$bolt';
	import type { ActInput, Id } from '@norbital-ai/bolt';
	import { toast } from 'svelte-sonner';
	import { Button, DateInput, Label, Sheet, Textarea } from '@norbital-ai/ui';
	import { Cluster, Stack } from '@norbital-ai/ui/layout';
	import { closeContractWrites, lastDayRefusal } from '../../payroll_engine/offboarding.js';
	import { t } from '../i18n/t.js';
	import { todayKey } from '../format/calendar.js';

	let {
		id,
		hireFrom,
		ended
	}: {
		id: Id<'employment_contract'>;
		hireFrom: string;
		ended: boolean;
	} = $props();

	let saving = $state(false);
	let sheetOpen = $state(false);
	let lastDay = $state<string | null>(null);
	let note = $state('');

	function open(): void {
		lastDay = todayKey();
		note = '';
		sheetOpen = true;
	}

	async function submit(): Promise<void> {
		if (saving || lastDay == null || lastDay === '') return;
		const refusal = lastDayRefusal(hireFrom, lastDay);
		if (refusal != null) {
			toast.error(refusal);
			return;
		}
		const set = closeContractWrites({ from: hireFrom, lastDay, note });
		saving = true;
		try {
			const payload: ActInput<'employment_contract.update'> = { target: id, set };
			const outcome = await bolt.act('employment_contract.update', payload);
			if (outcome.kind === 'committed' || outcome.kind === 'pendingApproval') {
				toast.success(t('offboarding.submitted'));
				sheetOpen = false;
			} else {
				toast.error(
					outcome.kind === 'refused'
						? (outcome.message ?? t('component.error'))
						: t('component.error')
				);
			}
		} catch {
			toast.error(t('component.error'));
		} finally {
			saving = false;
		}
	}
</script>

{#if !ended}
	<Button size="sm" variant="outline" disabled={saving} onclick={open}
		>{t('offboarding.open')}</Button
	>

	<Sheet bind:open={sheetOpen} title={t('offboarding.title')}>
		<Stack gap="md">
			<p class="text-sm text-muted-foreground">{t('offboarding.description')}</p>
			<p class="text-sm text-muted-foreground">{t('offboarding.leave_hint')}</p>
			<Stack gap="xs">
				<Label for="offboarding-last-day">{t('offboarding.last_day')}</Label>
				<p class="text-xs text-muted-foreground">{t('offboarding.last_day_hint')}</p>
				<DateInput
					id="offboarding-last-day"
					of="date"
					value={lastDay}
					onChange={(next) => (lastDay = next)}
					disabled={saving}
				/>
			</Stack>
			<Stack gap="xs">
				<Label for="offboarding-note">{t('offboarding.note')}</Label>
				<Textarea id="offboarding-note" rows={3} bind:value={note} disabled={saving} />
			</Stack>
			<Cluster gap="sm" justify="end">
				<Button variant="outline" disabled={saving} onclick={() => (sheetOpen = false)}>
					{t('component.cancel')}
				</Button>
				<Button
					disabled={saving || lastDay == null || lastDay === ''}
					onclick={() => void submit()}
				>
					{t('offboarding.submit')}
				</Button>
			</Cluster>
		</Stack>
	</Sheet>
{/if}
