<script lang="ts">
	/**
	 * Clone, seal and void the settings version on screen. A clone is a draft of the same lineage; a seal freezes it;
	 * a void is the one way a sealed version stops governing.
	 */
	import { bolt } from '$bolt';
	import type { Id } from '@norbital-ai/bolt';
	import { Instant, PlainDate } from '@norbital-ai/std/date';
	import { toast } from 'svelte-sonner';
	import { Button, DateInput, Label, Sheet, Textarea } from '@norbital-ai/ui';
	import { Cluster, Inline, Stack } from '@norbital-ai/ui/layout';
	import { t } from '../../../lib/ui/i18n/t.js';
	import { todayKey } from '../../../lib/ui/format/calendar.js';
	import {
		cloneSettingsFields,
		sealSettings,
		type SettingsLineage
	} from '../../../lib/payroll_engine/settings_version.js';

	type Version = {
		id: Id<'jurisdiction_settings'>;
		name: string;
		effective_range: { from: string; to: string | null };
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

	function fail(outcome: { kind: string; message?: string }): void {
		toast.error(
			outcome.kind === 'refused' ? (outcome.message ?? t('component.error')) : t('component.error')
		);
	}

	function openNew(): void {
		startsOn = todayKey();
		newOpen = true;
	}

	function openVoid(): void {
		reason = '';
		voidOpen = true;
	}

	async function cloneVersion(): Promise<void> {
		if (version == null || startsOn == null || startsOn === '' || saving) return;
		saving = true;
		try {
			const full = await bolt.get('jurisdiction_settings', version.id);
			if (full == null) {
				toast.error(t('component.error'));
				return;
			}
			const payload = cloneSettingsFields(
				{ ...full, id: full.id, effective_range: full.effective_range },
				PlainDate(startsOn)
			);
			const outcome = await bolt.act('jurisdiction_settings.create', payload);
			if (outcome.kind === 'committed' || outcome.kind === 'pendingApproval') {
				toast.success(t('settings_version.cloned'));
				const id = outcome.records[0]?.id;
				if (id != null) onCreated(id);
				newOpen = false;
			} else fail(outcome);
		} catch {
			toast.error(t('component.error'));
		} finally {
			saving = false;
		}
	}

	async function sealVersion(): Promise<void> {
		if (version == null || saving) return;
		saving = true;
		try {
			const writes = sealSettings(
				lineageOf(version),
				versions.map(lineageOf),
				Instant(new Date().toISOString())
			);
			const outcome = await bolt.act('jurisdiction_settings.update', writes);
			if (outcome.kind === 'committed' || outcome.kind === 'pendingApproval') {
				toast.success(t('settings_version.sealed'));
				sealOpen = false;
			} else fail(outcome);
		} catch {
			toast.error(t('component.error'));
		} finally {
			saving = false;
		}
	}

	async function voidVersion(): Promise<void> {
		if (version == null || reason.trim() === '' || saving) return;
		saving = true;
		try {
			const outcome = await bolt.act('jurisdiction_settings.update', {
				target: version.id,
				set: { voided_at: Instant(new Date().toISOString()), void_reason: reason.trim() }
			});
			if (outcome.kind === 'committed' || outcome.kind === 'pendingApproval') {
				toast.success(t('settings_version.voided'));
				voidOpen = false;
			} else fail(outcome);
		} catch {
			toast.error(t('component.error'));
		} finally {
			saving = false;
		}
	}
</script>

{#if version}
	<Inline gap="sm" align="center">
		<Button size="sm" variant="outline" disabled={saving || !canClone} onclick={openNew}>
			{t('settings_version.new')}
		</Button>
		<Button size="sm" disabled={saving || !canSeal} onclick={() => (sealOpen = true)}>
			{t('settings_version.seal')}
		</Button>
		<Button size="sm" variant="destructive" disabled={saving || !canVoid} onclick={openVoid}>
			{t('settings_version.void')}
		</Button>
	</Inline>

	<Sheet bind:open={newOpen} title={t('settings_version.new_title', { name: version.name })}>
		<Stack gap="md">
			<p class="text-sm text-muted-foreground">{t('settings_version.new_description')}</p>
			<Stack gap="xs">
				<Label for="settings-version-starts-on">{t('settings_version.starts_on')}</Label>
				<DateInput
					id="settings-version-starts-on"
					of="date"
					value={startsOn}
					onChange={(next) => (startsOn = next)}
					disabled={saving}
				/>
			</Stack>
			<Cluster gap="sm" justify="end">
				<Button variant="outline" disabled={saving} onclick={() => (newOpen = false)}>
					{t('component.cancel')}
				</Button>
				<Button
					disabled={saving || startsOn == null || startsOn === ''}
					onclick={() => void cloneVersion()}
				>
					{t('settings_version.new')}
				</Button>
			</Cluster>
		</Stack>
	</Sheet>

	<Sheet bind:open={sealOpen} title={t('settings_version.seal_title', { name: version.name })}>
		<Stack gap="md">
			<p class="text-sm text-muted-foreground">
				{#if predecessor}
					{t('settings_version.seal_description', {
						start: version.effective_range.from,
						previous: predecessor.name
					})}
				{:else}
					{t('settings_version.seal_description_first', { start: version.effective_range.from })}
				{/if}
			</p>
			<Cluster gap="sm" justify="end">
				<Button variant="outline" disabled={saving} onclick={() => (sealOpen = false)}>
					{t('component.cancel')}
				</Button>
				<Button disabled={saving} onclick={() => void sealVersion()}
					>{t('settings_version.seal')}</Button
				>
			</Cluster>
		</Stack>
	</Sheet>

	<Sheet bind:open={voidOpen} title={t('settings_version.void_title', { name: version.name })}>
		<Stack gap="md">
			<p class="text-sm text-muted-foreground">{t('settings_version.void_description')}</p>
			<Stack gap="xs">
				<Label for="settings-version-void-reason">{t('settings_version.void_reason')}</Label>
				<Textarea
					id="settings-version-void-reason"
					rows={4}
					bind:value={reason}
					disabled={saving}
				/>
			</Stack>
			<Cluster gap="sm" justify="end">
				<Button variant="outline" disabled={saving} onclick={() => (voidOpen = false)}>
					{t('component.cancel')}
				</Button>
				<Button
					variant="destructive"
					disabled={saving || reason.trim() === ''}
					onclick={() => void voidVersion()}
				>
					{t('settings_version.void')}
				</Button>
			</Cluster>
		</Stack>
	</Sheet>
{/if}
