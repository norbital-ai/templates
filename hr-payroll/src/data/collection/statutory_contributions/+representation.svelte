<script lang="ts">
	/**
	 * One statutory scheme: the base it charges and the rules that price it. A row like "5.5% from RM0 to
	 * RM5,000" is meaningless without the scheme whose ladder it is a rung of, so the rules are the scheme's own
	 * `rules` column; the write compiles every expression against the scheme context. A rule that names
	 * `produced.<code>` is the only dependency.
	 *
	 * `settings_id` is never a field on the Settings page: the page names the version and the form prefills it.
	 * Opened without that scope it keeps a version picker. A sealed version's scheme says so in the frame.
	 */
	import { t } from '../../../lib/ui/t.js';
	import { bolt } from '$bolt';
	import { Field, Form } from '@norbital-ai/ui';
	import { Picker } from '@norbital-ai/ui';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import { RecordShell, type RecordView } from '@norbital-ai/ui';
	import FormSection from '../../../lib/ui/form-section.svelte';
	import ExpressionField from '../../../lib/ui/expression-field.svelte';
	import { createValues, hrCreateScope } from '../../../lib/ui/create-scope.js';
	import { openCreated } from '../../../lib/ui/open-created.js';
	import { liveRows } from '../../../lib/ui/live.svelte.js';
	import { settingsVersionSealed } from '../../../lib/ui/settings-sealed.svelte.js';
	import * as Predicate from 'effect/Predicate';

	let { view }: { view: RecordView<'statutory_contributions'> } = $props();
	const record = $derived(view.mode === 'update' ? view.record : null);
	const scopedSettingsId = $derived(hrCreateScope()?.settingsId?.());
	const values = $derived(createValues(view, { settings_id: scopedSettingsId }));
	const sealed = settingsVersionSealed(() => record?.settings_id);
	const versionId = $derived(record?.settings_id ?? null);
	const code = $derived(record?.code ?? '');
	const text = (value: unknown) => (Predicate.isString(value) ? value : '');

	/**
	 * The classes that enter this scheme's base, read from their own `counts_toward`: the scheme declares nothing
	 * about them, so the form prints the derived list and lets the class forms own the decision.
	 */
	type Member = {
		readonly id: string;
		readonly code: string;
		readonly counts_toward: readonly string[] | null;
	};
	const memberRead = (collection: 'allowance_catalogue' | 'claim_catalogue') => () =>
		versionId == null
			? null
			: bolt.read(collection, {
					where: { settings_id: { eq: versionId } },
					select: { code: true, counts_toward: true },
					orderBy: { code: 'asc' },
					all: true
				});
	const allowances = liveRows<Member>(memberRead('allowance_catalogue'));
	const claims = liveRows<Member>(memberRead('claim_catalogue'));
	const members = $derived(
		[
			...(allowances.current ?? []).map((row) => ({ word: 'ALLOWANCES', ...row })),
			...(claims.current ?? []).map((row) => ({ word: 'CLAIMS', ...row }))
		].flatMap((row) => {
			const entry = (row.counts_toward ?? [])
				.map(String)
				.find((item) => item === code || item.startsWith(`${code}.`));
			return entry == null
				? []
				: [{ word: row.word, code: row.code, part: entry.slice(code.length + 1) }];
		})
	);
</script>

<RecordShell
	of="statutory_contributions"
	{...record == null ? {} : { id: record.id }}
	mode={view.mode}
	{...sealed()
		? {
				icon: 'lucide:lock-keyhole',
				badge: t('component.settings_sealed_badge'),
				hint: t('component.settings_sealed_note')
			}
		: {}}
>
	<Form
		of="statutory_contributions"
		mode={view.mode}
		{...record == null ? {} : { id: record.id }}
		{record}
		{values}
		submit={record ? t('component.save_scheme') : t('component.create_scheme')}
		onOutcome={openCreated(view)}
	>
		<Stack gap="lg">
			<FormSection
				name="scheme_section_identity"
				first
				title={t('component.scheme_section_identity')}
				hint={t('component.scheme_section_identity_hint')}
			>
				<Grid gap="sm" minimum="compact">
					{#if scopedSettingsId == null && record == null}
						<Field name="settings_id" label={t('component.settings_version')}>
							{#snippet editor(field)}
								<Picker
									of="jurisdiction_settings"
									label={['code', 'name']}
									orderBy={{ code: 'asc' }}
									value={text(field.value) || null}
									onChange={field.onChange}
									disabled={field.disabled}
								/>
							{/snippet}
						</Field>
					{/if}
					<Field name="code" label={t('component.code')} />
					<Field name="name" label={t('component.name')} />
					<Field name="authority" label={t('component.authority')} />
				</Grid>
			</FormSection>

			<FormSection
				name="scheme_section_assessed_on"
				title={t('component.scheme_section_assessed_on')}
				hint={t('component.scheme_section_assessed_on_hint')}
			>
				<Field name="assessed_on" label={t('component.scheme_assessed_on')}>
					{#snippet editor(field)}
						<ExpressionField
							site="assessment"
							type="number"
							value={field.value}
							disabled={field.disabled}
							onValueChange={field.onChange}
						/>
					{/snippet}
				</Field>
				<Field
					name="ordinary_on"
					label={t('component.scheme_ordinary_on')}
					help={t('component.scheme_ordinary_on_hint')}
				>
					{#snippet editor(field)}
						<ExpressionField
							site="assessment"
							type="number"
							empty={t('component.scheme_ordinary_on_empty')}
							value={field.value}
							disabled={field.disabled}
							onValueChange={field.onChange}
						/>
					{/snippet}
				</Field>
				<Field
					name="base_when"
					label={t('component.scheme_base_when')}
					help={t('component.scheme_base_when_hint')}
				/>
				<Field
					name="parts"
					label={t('component.scheme_parts')}
					help={t('component.scheme_parts_hint')}
				/>
				{#if record != null}
					<Stack gap="xs">
						<span class="text-sm font-medium">{t('component.scheme_enters_base')}</span>
						{#if members.length === 0}
							<p class="text-meta">{t('component.scheme_enters_base_none')}</p>
						{:else}
							<p class="text-sm">
								{members
									.map(
										(member) =>
											`${member.code} (${member.word}${member.part === '' ? '' : ` · ${member.part}`})`
									)
									.join(', ')}
							</p>
						{/if}
					</Stack>
				{/if}
			</FormSection>

			<FormSection
				name="scheme_section_assessment"
				title={t('component.scheme_section_assessment')}
				hint={t('component.scheme_section_assessment_hint')}
			>
				<Grid gap="sm" minimum="compact">
					<Field name="assessment_period" label={t('component.assessment_period')} />
					<Field name="assessment_scope" label={t('component.assessment_scope')} />
				</Grid>
				<Field name="elections" label={t('component.scheme_elections')} />
				<Grid gap="sm" minimum="compact">
					<Field
						name="employee_share_annual_cap"
						label={t('component.employee_share_annual_cap')}
					/>
					<Field name="shared_cap_group" label={t('component.shared_cap_group')} />
					<Field name="project_relief_annually" label={t('component.project_relief_annually')} />
				</Grid>
			</FormSection>

			<FormSection
				name="scheme_section_listing"
				title={t('component.scheme_section_listing')}
				hint={t('component.scheme_section_listing_hint')}
			>
				<Grid gap="sm" minimum="compact">
					<Field name="short_name" label={t('component.scheme_short_name')} />
					<Field name="listing_order" label={t('component.scheme_listing_order')} />
					<Field name="listing_group" label={t('component.scheme_listing_group')} />
				</Grid>
			</FormSection>

			<FormSection
				name="scheme_section_rules"
				title={t('component.scheme_section_rules')}
				hint={t('component.scheme_section_rules_hint')}
			>
				<Field name="rules" label={t('component.scheme_rules')} />
			</FormSection>
		</Stack>
	</Form>
</RecordShell>
