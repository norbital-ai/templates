<script lang="ts">
	/**
	 * End employment: a last day, the exit ground the version governing it lists (`exit_grounds`) and the exit facts its
	 * input schema declares (`exit_facts`). No ground is preselected. A planned end (a fixed term) is no departure, so a
	 * fixed-term contract exits early; a departure is moved (the same sheet, prefilled) or undone (a withdrawn
	 * resignation: the contract reopens to its planned end). The write re-evaluates what the exit raised.
	 */
	import { bolt } from '$bolt';
	import type { ActInput, Id } from '@norbital-ai/bolt';
	import { Button, Combobox, DateInput, Label, Sheet, toast } from '@norbital-ai/ui';
	import { Cluster, Stack } from '@norbital-ai/ui/layout';
	import * as Predicate from 'effect/Predicate';
	import {
		closeContractWrites,
		lastDayRefusal,
		undoExitWrites
	} from '../../payroll_engine/offboarding.js';
	import { kindsOf } from '../../payroll_engine/listed_kinds.js';
	import type { JsonObject } from '../../payroll_engine/foundation.js';
	import { governingVersion } from './governing_version.svelte.js';
	import { missingRequired, schemaAt } from './input_schema.js';
	import SchemaFields from './schema_fields.svelte';
	import { liveRows } from '../state/live.svelte.js';
	import { t } from '../i18n/t.js';
	import { todayKey } from '../format/calendar.js';

	let {
		id,
		companyId,
		hireFrom,
		lastDay: currentLastDay = null,
		exitGround = null,
		exitFacts = null,
		plannedEnd = null
	}: {
		id: Id<'employment_contract'>;
		companyId: Id<'entity'>;
		hireFrom: string;
		/** The contract's last day: a planned end, or the exit's. */
		lastDay?: string | null;
		/** Set once the person has left: the exit is then moved or undone. */
		exitGround?: string | null;
		exitFacts?: JsonObject | null;
		/** The planned end of a fixed-term contract, kept across an early exit. */
		plannedEnd?: string | null;
	} = $props();
	const exited = $derived(exitGround != null && exitGround !== '');

	let saving = $state(false);
	let sheetOpen = $state(false);
	let lastDay = $state<string | null>(null);
	let ground = $state<string | null>(null);
	let facts = $state<JsonObject>({});

	const version = governingVersion(
		() => (sheetOpen ? companyId : null),
		() => lastDay
	);
	const factsSchema = $derived(schemaAt(version.current?.employee_input_schema, 'exit_facts'));
	const grounds = liveRows(() =>
		version.current == null
			? null
			: bolt.read('rule_set', {
					where: {
						settings_id: { eq: version.current.id },
						family: { eq: 'PAYROLL' },
						code: { eq: 'exit_grounds' }
					},
					select: { rules: true },
					all: true
				})
	);
	const options = $derived(
		(grounds.current ?? []).flatMap((row) =>
			kindsOf(row.rules).map((kind) => ({
				value: kind.code,
				label: kind.name,
				description: kind.code
			}))
		)
	);

	function open(): void {
		lastDay = exited ? currentLastDay : todayKey();
		ground = exited ? exitGround : null;
		facts = exited ? { ...(exitFacts ?? {}) } : {};
		sheetOpen = true;
	}

	async function act(
		set: Extract<ActInput<'employment_contract.update'>, { readonly set: unknown }>['set']
	): Promise<boolean> {
		saving = true;
		try {
			const outcome = await bolt.act('employment_contract.update', { target: id, set });
			if (outcome.kind === 'committed' || outcome.kind === 'pendingApproval') return true;
			toast.error(
				outcome.kind === 'refused'
					? (outcome.message ?? t('component.error'))
					: t('component.error')
			);
		} catch {
			toast.error(t('component.error'));
		} finally {
			saving = false;
		}
		return false;
	}

	async function undo(): Promise<void> {
		if (saving) return;
		if (await act(undoExitWrites({ from: hireFrom, plannedEnd })))
			toast.success(t('offboarding.undone'));
	}

	async function submit(): Promise<void> {
		if (saving || lastDay == null || lastDay === '') return;
		const refusal = lastDayRefusal(hireFrom, lastDay);
		if (refusal != null) {
			toast.error(refusal);
			return;
		}
		const written = $state.snapshot(facts);
		const missing = missingRequired(factsSchema, written);
		if (missing.length > 0) {
			toast.error(t('component.required_missing', { fields: missing.join(', ') }));
			return;
		}
		// a fixed-term contract's planned end is kept, so undoing the exit reopens to it
		const set = closeContractWrites({
			from: hireFrom,
			lastDay,
			ground,
			facts: written,
			plannedEnd: exited ? null : plannedEnd == null ? currentLastDay : null
		});
		if (Predicate.isString(set)) {
			toast.error(set);
			return;
		}
		if (await act(set)) {
			toast.success(t(exited ? 'offboarding.moved' : 'offboarding.submitted'));
			sheetOpen = false;
		}
	}
</script>

<Cluster gap="sm">
	<Button size="sm" variant="outline" disabled={saving} onclick={open}
		>{t(exited ? 'offboarding.move' : 'offboarding.open')}</Button
	>
	{#if exited}
		<Button size="sm" variant="outline" disabled={saving} onclick={() => void undo()}
			>{t('offboarding.undo')}</Button
		>
	{/if}
</Cluster>

<Sheet bind:open={sheetOpen} title={t(exited ? 'offboarding.move_title' : 'offboarding.title')}>
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
				onChange={(next) => {
					lastDay = next;
					ground = null;
				}}
				disabled={saving}
			/>
		</Stack>
		{#if lastDay != null && lastDay !== '' && version.current == null && !version.loading}
			<p class="text-sm text-destructive">{t('component.no_governing_version')}</p>
		{/if}
		<Stack gap="xs">
			<Label for="offboarding-ground">{t('offboarding.ground')} *</Label>
			<Combobox
				id="offboarding-ground"
				class="w-full"
				{options}
				value={ground}
				disabled={saving}
				onChange={(next) => (ground = next)}
			/>
		</Stack>
		<SchemaFields
			node={factsSchema}
			value={facts}
			onChange={(next) => (facts = next)}
			id="offboarding-fact"
			disabled={saving}
		/>
		<Cluster gap="sm" justify="end">
			<Button variant="outline" disabled={saving} onclick={() => (sheetOpen = false)}>
				{t('component.cancel')}
			</Button>
			<Button
				disabled={saving || lastDay == null || lastDay === '' || ground == null}
				onclick={() => void submit()}
			>
				{t(exited ? 'offboarding.move_submit' : 'offboarding.submit')}
			</Button>
		</Cluster>
	</Stack>
</Sheet>
