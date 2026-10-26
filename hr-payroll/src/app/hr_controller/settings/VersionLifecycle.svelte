<script lang="ts">
	import { fork } from '@norbital-ai/ui/effect';
	/**
	 * Clone, seal and void the settings version on screen. A clone is a draft of the same lineage; a seal freezes it;
	 * a void is the one way a sealed version stops governing.
	 */
	import { bolt } from '$bolt';
	import { Clock, Effect, Schema } from 'effect';
	import type { Id } from '@norbital-ai/bolt';
	import { Instant, PlainDate } from '@norbital-ai/std/date';
	import { Button, TimeInput, Label, Sheet, Textarea, notifyOutcome, toast } from '@norbital-ai/ui';
	import { Cluster, Inline, Stack } from '@norbital-ai/ui/layout';
	import { todayKey } from '../../../lib/ui/format/calendar.js';
	import {
		cloneSettingsFields,
		sealSettings,
		type SettingsLineage
	} from '../../../lib/payroll_engine/settings_version.js';
	type Version = {
		id: Id<'jurisdiction_settings'>;
		name: string;
		effective_range: {
			from: string;
			to: string | null;
		};
		sealed_at: string | null;
		voided_at: string | null;
	};
	let {
		version,
		versions,
		onCreated
	}: {
		version: Version | null;
		versions: readonly Version[];
		onCreated: (id: Id<'jurisdiction_settings'>) => void;
	} = $props();
	let saving = $state(false);
	let newOpen = $state(false);
	let sealOpen = $state(false);
	let voidOpen = $state(false);
	let startsOn = $state<string | null>(null);
	let reason = $state('');
	const canClone = $derived(version != null && version.voided_at == null);
	const canSeal = $derived(
		version != null && version.sealed_at == null && version.voided_at == null
	);
	const canVoid = $derived(
		version != null && version.sealed_at != null && version.voided_at == null
	);
	const predecessor = $derived.by(() => {
		if (version == null) return null;
		const draft = version;
		return (
			versions.find(
				(row) =>
					row.id !== draft.id &&
					row.sealed_at != null &&
					row.voided_at == null &&
					row.effective_range.from < draft.effective_range.from &&
					(row.effective_range.to == null || row.effective_range.to >= draft.effective_range.from)
			) ?? null
		);
	});
	function lineageOf(row: Version): SettingsLineage {
		return {
			id: row.id,
			effective_range: {
				from: PlainDate(row.effective_range.from),
				to: row.effective_range.to == null ? null : PlainDate(row.effective_range.to)
			},
			sealed_at: row.sealed_at,
			voided_at: row.voided_at
		};
	}
	class VersionChangeFailed extends Schema.TaggedError<VersionChangeFailed>()(
		'VersionChangeFailed',
		{
			message: Schema.String
		}
	) {}
	const finish = <A, E>(effect: Effect.Effect<A, E>) =>
		fork(
			effect.pipe(
				Effect.catch((failure) =>
					Effect.sync(() => {
						toast.error(failure instanceof Error ? failure.message : bolt.t('component.error'));
					})
				),
				Effect.ensuring(
					Effect.sync(() => {
						saving = false;
					})
				)
			)
		);
	function openNew(): void {
		startsOn = todayKey();
		newOpen = true;
	}
	function openVoid(): void {
		reason = '';
		voidOpen = true;
	}
	const cloneSettingsVersion = Effect.fn('Payroll.cloneSettingsVersion')(function* (
		id: Id<'jurisdiction_settings'>,
		startsOn: string
	) {
		const full = yield* bolt.query('jurisdiction_settings', { id: id });
		if (full === null)
			return yield* Effect.fail(new VersionChangeFailed({ message: bolt.t('component.error') }));
		const payload = yield* Effect.try({
			try: () =>
				cloneSettingsFields(
					{ ...full, id: full.id, effective_range: full.effective_range },
					PlainDate(startsOn)
				),
			catch: (cause) => new VersionChangeFailed({ message: String(cause) })
		});
		return yield* bolt.act('jurisdiction_settings.create', payload);
	});
	function cloneVersion(): void {
		if (version == null || startsOn == null || startsOn === '' || saving) return;
		saving = true;
		finish(
			cloneSettingsVersion(version.id, startsOn).pipe(
				Effect.tap((outcome) =>
					Effect.sync(() => {
						if (outcome.kind === 'running') {
							newOpen = false;
							return notifyOutcome(bolt, outcome);
						}
						if (outcome.kind === 'pendingApproval')
							toast.info(bolt.t('settings_version.pending_approval'));
						else toast.success(bolt.t('settings_version.cloned'));
						// a held clone is written too: open it either way
						const id = outcome.records.find(
							(record) => record.collection === 'jurisdiction_settings'
						)?.id;
						if (id != null) onCreated(id);
						newOpen = false;
					})
				)
			)
		);
	}
	function sealVersion(): void {
		if (version == null || saving) return;
		const selected = version;
		saving = true;
		finish(
			Effect.gen(function* () {
				const now = yield* Clock.currentTimeMillis;
				const writes = yield* Effect.try({
					try: () =>
						sealSettings(lineageOf(selected), versions.map(lineageOf), Instant(new Date(now))),
					catch: (cause) => new VersionChangeFailed({ message: String(cause) })
				});
				const outcome = yield* bolt.act('jurisdiction_settings.update', writes);
				// past the person-wait the write runs on: its run reports the outcome
				if (outcome.kind === 'running') notifyOutcome(bolt, outcome);
				else if (outcome.kind === 'pendingApproval')
					toast.info(bolt.t('settings_version.pending_approval'));
				else toast.success(bolt.t('settings_version.sealed'));
				sealOpen = false;
			})
		);
	}
	function voidVersion(): void {
		if (version == null || reason.trim() === '' || saving) return;
		const selected = version.id,
			note = reason.trim();
		saving = true;
		finish(
			Effect.gen(function* () {
				const now = yield* Clock.currentTimeMillis;
				const outcome = yield* bolt.act('jurisdiction_settings.update', {
					target: selected,
					set: { voided_at: Instant(new Date(now)), void_reason: note }
				});
				// past the person-wait the write runs on: its run reports the outcome
				if (outcome.kind === 'running') notifyOutcome(bolt, outcome);
				else if (outcome.kind === 'pendingApproval')
					toast.info(bolt.t('settings_version.pending_approval'));
				else toast.success(bolt.t('settings_version.voided'));
				voidOpen = false;
			})
		);
	}
</script>

{#if version}
	<Inline gap="sm" align="center">
		<Button size="sm" variant="outline" disabled={saving || !canClone} onclick={openNew}>
			{bolt.t('settings_version.new')}
		</Button>
		<Button size="sm" disabled={saving || !canSeal} onclick={() => (sealOpen = true)}>
			{bolt.t('settings_version.seal')}
		</Button>
		<Button size="sm" variant="destructive" disabled={saving || !canVoid} onclick={openVoid}>
			{bolt.t('settings_version.void')}
		</Button>
	</Inline>

	<Sheet bind:open={newOpen} title={bolt.t('settings_version.new_title', { name: version.name })}>
		<Stack gap="md">
			<p class="text-sm text-muted-foreground">{bolt.t('settings_version.new_description')}</p>
			<Stack gap="xs">
				<Label for="settings-version-starts-on">{bolt.t('settings_version.starts_on')}</Label>
				<TimeInput
					id="settings-version-starts-on"
					of="date"
					value={startsOn}
					onChange={(next: string | null) => (startsOn = next)}
					disabled={saving}
				/>
			</Stack>
			<Cluster gap="sm" justify="end">
				<Button variant="outline" disabled={saving} onclick={() => (newOpen = false)}>
					{bolt.t('component.cancel')}
				</Button>
				<Button disabled={saving || startsOn == null || startsOn === ''} onclick={cloneVersion}>
					{bolt.t('settings_version.new')}
				</Button>
			</Cluster>
		</Stack>
	</Sheet>

	<Sheet bind:open={sealOpen} title={bolt.t('settings_version.seal_title', { name: version.name })}>
		<Stack gap="md">
			<p class="text-sm text-muted-foreground">
				{#if predecessor}
					{bolt.t('settings_version.seal_description', {
						start: version.effective_range.from,
						previous: predecessor.name
					})}
				{:else}
					{bolt.t('settings_version.seal_description_first', {
						start: version.effective_range.from
					})}
				{/if}
			</p>
			<Cluster gap="sm" justify="end">
				<Button variant="outline" disabled={saving} onclick={() => (sealOpen = false)}>
					{bolt.t('component.cancel')}
				</Button>
				<Button disabled={saving} onclick={sealVersion}>{bolt.t('settings_version.seal')}</Button>
			</Cluster>
		</Stack>
	</Sheet>

	<Sheet bind:open={voidOpen} title={bolt.t('settings_version.void_title', { name: version.name })}>
		<Stack gap="md">
			<p class="text-sm text-muted-foreground">{bolt.t('settings_version.void_description')}</p>
			<Stack gap="xs">
				<Label for="settings-version-void-reason">{bolt.t('settings_version.void_reason')}</Label>
				<Textarea
					id="settings-version-void-reason"
					rows={4}
					bind:value={reason}
					disabled={saving}
				/>
			</Stack>
			<Cluster gap="sm" justify="end">
				<Button variant="outline" disabled={saving} onclick={() => (voidOpen = false)}>
					{bolt.t('component.cancel')}
				</Button>
				<Button
					variant="destructive"
					disabled={saving || reason.trim() === ''}
					onclick={voidVersion}
				>
					{bolt.t('settings_version.void')}
				</Button>
			</Cluster>
		</Stack>
	</Sheet>
{/if}
