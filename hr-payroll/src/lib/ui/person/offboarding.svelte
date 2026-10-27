<script lang="ts">
	import { fork } from '@norbital-ai/ui/effect';
	import { Effect } from 'effect';
	/**
	 * End employment: a last day, the exit ground the version governing it lists (`exit_grounds`) and the exit facts its
	 * input schema declares (`exit_facts`). No ground is preselected. A planned end (a fixed term) is no departure, so a
	 * fixed-term contract exits early; a departure is moved (the same sheet, prefilled) or undone (a withdrawn
	 * resignation: the contract reopens to its planned end). The write re-evaluates what the exit raised.
	 */
	import { bolt } from '$bolt';
	import type { ActInput, Id } from '@norbital-ai/bolt';
	import {
		Button,
		Combobox,
		StructuredData,
		TimeInput,
		Label,
		Sheet,
		notifyOutcome,
		toast
	} from '@norbital-ai/ui';
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
	import { fromForm, missingRequired, schemaAt } from './input_schema.js';
	import { formSchema } from './form_schema.js';
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
	const factsSchema = $derived(schemaAt(version.schema, 'exit_facts'));
	const factsForm = $derived(formSchema(factsSchema));
	const grounds = $derived.by(() =>
		version.current == null
			? null
			: bolt.query({
					rule_set: {
						where: {
							settings_id: { eq: version.current.id },
							family: { eq: 'PAYROLL' },
							code: { eq: 'exit_grounds' }
						},
						fields: ['rules']
					}
				})
	);
	const options = $derived(
		(grounds?.current?.rule_set.rows ?? []).flatMap((row) =>
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
	function act(set: ActInput<'employment_contract.update'>[number]['set']) {
		saving = true;
		return bolt.act('employment_contract.update', [{ target: id, set }]).pipe(
			Effect.map((outcome) => {
				if (outcome.kind === 'pendingApproval') toast.info(bolt.t('offboarding.pending'));
				// past the person-wait the write runs on: its run reports the outcome
				else if (outcome.kind === 'running') notifyOutcome(bolt, outcome);
				return outcome.kind;
			}),
			Effect.catch((failure) =>
				Effect.sync(() => {
					toast.error(failure instanceof Error ? failure.message : bolt.t('component.error'));
					return null;
				})
			),
			Effect.ensuring(
				Effect.sync(() => {
					saving = false;
				})
			)
		);
	}
	function undo(): void {
		if (saving) return;
		fork(
			act(undoExitWrites({ from: hireFrom, plannedEnd })).pipe(
				Effect.tap((kind) =>
					Effect.sync(() => {
						if (kind === 'committed') toast.success(bolt.t('offboarding.undone'));
					})
				)
			)
		);
	}
	function submit(): void {
		if (saving || lastDay == null || lastDay === '') return;
		const refusal = lastDayRefusal(hireFrom, lastDay);
		if (refusal != null) {
			toast.error(refusal);
			return;
		}
		const written = $state.snapshot(facts);
		const missing = missingRequired(factsSchema, written);
		if (missing.length > 0) {
			toast.error(bolt.t('component.required_missing', { fields: missing.join(', ') }));
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
		fork(
			act(set).pipe(
				Effect.tap((result) =>
					Effect.sync(() => {
						if (result !== null) {
							if (result === 'committed')
								toast.success(bolt.t(exited ? 'offboarding.moved' : 'offboarding.submitted'));
							sheetOpen = false;
						}
					})
				)
			)
		);
	}
</script>

<Cluster gap="sm">
	<Button size="sm" variant="outline" disabled={saving} onclick={open}
		>{bolt.t(exited ? 'offboarding.move' : 'offboarding.open')}</Button
	>
	{#if exited}
		<Button size="sm" variant="outline" disabled={saving} onclick={() => void undo()}
			>{bolt.t('offboarding.undo')}</Button
		>
	{/if}
</Cluster>

<Sheet
	bind:open={sheetOpen}
	title={bolt.t(exited ? 'offboarding.move_title' : 'offboarding.title')}
>
	<Stack gap="md">
		<p class="text-sm text-muted-foreground">{bolt.t('offboarding.description')}</p>
		<p class="text-sm text-muted-foreground">{bolt.t('offboarding.leave_hint')}</p>
		<Stack gap="xs">
			<Label for="offboarding-last-day">{bolt.t('offboarding.last_day')}</Label>
			<p class="text-xs text-muted-foreground">{bolt.t('offboarding.last_day_hint')}</p>
			<TimeInput
				id="offboarding-last-day"
				of="date"
				value={lastDay}
				onChange={(next: string | null) => {
					lastDay = next;
					ground = null;
				}}
				disabled={saving}
			/>
		</Stack>
		{#if lastDay != null && lastDay !== '' && version.current == null && !version.loading}
			<p class="text-sm text-destructive">{bolt.t('component.no_governing_version')}</p>
		{/if}
		<Stack gap="xs">
			<Label for="offboarding-ground">{bolt.t('offboarding.ground')} *</Label>
			<Combobox
				id="offboarding-ground"
				class="w-full"
				{options}
				value={ground}
				disabled={saving}
				onChange={(next) => (ground = next)}
			/>
		</Stack>
		{#if factsForm != null}
			<StructuredData
				mode="edit"
				schema={factsForm}
				value={facts}
				onChange={(next) => (facts = fromForm(facts, [], next))}
				id="offboarding-fact"
				name="offboarding-fact"
				disabled={saving}
			/>
		{/if}
		<Cluster gap="sm" justify="end">
			<Button variant="outline" disabled={saving} onclick={() => (sheetOpen = false)}>
				{bolt.t('component.cancel')}
			</Button>
			<Button
				disabled={saving || lastDay == null || lastDay === '' || ground == null}
				onclick={() => void submit()}
			>
				{bolt.t(exited ? 'offboarding.move_submit' : 'offboarding.submit')}
			</Button>
		</Cluster>
	</Stack>
</Sheet>
