<script lang="ts">
	/**
	 * One statutory scheme: the base it charges and the rules that price it. A row like "5.5% from
	 * RM0 to RM5,000" is meaningless without the EPF/SOCSO/EIS scheme whose ladder it is a rung of,
	 * so the rules are the scheme's own `rules` column; the datatype compiles every expression
	 * against the scheme context when the row is written. The scheme declares which lines are in
	 * its base; a rule that names `produced.<code>` is the only dependency.
	 *
	 * `settings_id` is never a field on the Settings page: the page names the version and the form
	 * prefills and hides it. Opened without that scope it keeps a plain version picker.
	 */
	import { client } from '../../lib/workspace-client.js';
	import { useI18n } from '@norbital-ai/ui/i18n';
	import type { TenantI18nKeys } from '$bolt/i18n-keys';
	import type { RepresentationProps } from './$types.js';
	import { CollectionForm } from '@norbital-ai/ui/collection-form';
	import { Grid, Stack } from '@norbital-ai/ui/layout';
	import { RecordShell } from '@norbital-ai/ui/record-shell';
	import type { TabConfig } from '@norbital-ai/ui/tabs';
	import FormSection from '../../lib/ui/form-section.svelte';
	import ExpressionField from '../../lib/ui/expression-field.svelte';
	import { hrCreateScope } from '../../lib/ui/create-scope.js';

	let { record, close }: RepresentationProps = $props();
	const { t } = useI18n<TenantI18nKeys>();
	const createScope = hrCreateScope();
	const settingsId = $derived(createScope?.settingsId?.());
	const formValues = $derived(record ?? (settingsId ? { settings_id: settingsId } : undefined));
	const versionId = $derived(record == null ? '' : String(record.settings_id));

	// A new scheme has no version yet: an `eq: ''` on a uuid column is a query the live planner
	// refuses, and one refused query takes the whole sync stream down with it.
	const version = $derived(
		versionId === ''
			? null
			: (client.db.jurisdiction_settings.findFirst({
					where: { id: { eq: versionId } },
					columns: { id: true, sealed_at: true }
				})?.current ?? null)
	);
	const sealed = $derived(version?.sealed_at != null);

	/**
	 * The classes that enter this scheme's base, read from their own `counts_toward`: the scheme
	 * declares nothing about them, so the form prints the derived list for the reader and lets the
	 * class forms own the decision.
	 */
	const code = $derived(record == null ? '' : String(record.code));
	const memberQuery = (collection: 'allowance_catalogue' | 'claim_catalogue') =>
		versionId === ''
			? null
			: client.db[collection].findMany({
					where: { settings_id: { eq: versionId } },
					columns: { code: true, counts_toward: true },
					orderBy: { code: 'asc' },
					limit: 500
				});
	const allowanceMembers = $derived(memberQuery('allowance_catalogue'));
	const claimMembers = $derived(memberQuery('claim_catalogue'));
	const members = $derived(
		[
			...(allowanceMembers?.current ?? []).map((row) => ({ word: 'ALLOWANCES', ...row })),
			...(claimMembers?.current ?? []).map((row) => ({ word: 'CLAIMS', ...row }))
		].flatMap((row) => {
			const entry = (Array.isArray(row.counts_toward) ? row.counts_toward : [])
				.map(String)
				.find((item) => item === code || item.startsWith(`${code}.`));
			return entry == null
				? []
				: [{ word: row.word, code: row.code, part: entry.slice(code.length + 1) }];
		})
	);

	const tabs = $derived<TabConfig[]>([
		{
			name: 'scheme',
			label: t('component.scheme_section_identity'),
			icon: 'lucide:landmark',
			content: scheme
		}
	]);
</script>

{#snippet scheme()}
	<CollectionForm
		{client}
		collection="statutory_contributions"
		defaultValues={formValues}
		readonly={sealed}
		submitLabel={record ? t('component.save_scheme') : t('component.create_scheme')}
		onAfterSubmit={record ? undefined : close}
	>
		{#snippet children({ Field })}
			<Stack gap="lg">
				<FormSection
					first
					title={t('component.scheme_section_identity')}
					hint={t('component.scheme_section_identity_hint')}
				>
					<Grid gap="sm" minimum="compact">
						{#if settingsId != null || record != null}
							<Field name="settings_id" hidden />
						{:else}
							<Field
								name="settings_id"
								label={t('component.settings_version')}
								relationOptions={{
									label: (version) =>
										[version.code, version.name, version.sealed_at ? 'sealed' : 'draft']
											.filter((part) => part != null && part !== '')
											.join(' · ') || '—',
									orderBy: { code: 'asc' },
									limit: 200
								}}
							/>
						{/if}
						<Field name="code" label={t('component.code')} />
						<Field name="name" label={t('component.name')} />
						<Field name="authority" label={t('component.authority')} />
					</Grid>
				</FormSection>

				<FormSection
					title={t('component.scheme_section_assessed_on')}
					hint={t('component.scheme_section_assessed_on_hint')}
				>
					<Field
						name="assessed_on"
						label={t('component.scheme_assessed_on')}
						renderer={ExpressionField}
						rendererProps={{ site: 'assessment', type: 'number' }}
					/>
					<Field
						name="ordinary_on"
						label={t('component.scheme_ordinary_on')}
						description={t('component.scheme_ordinary_on_hint')}
						renderer={ExpressionField}
						rendererProps={{
							site: 'assessment',
							type: 'number',
							empty: t('component.scheme_ordinary_on_empty')
						}}
					/>
					<Field
						name="parts"
						label={t('component.scheme_parts')}
						description={t('component.scheme_parts_hint')}
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
					title={t('component.scheme_section_assessment')}
					hint={t('component.scheme_section_assessment_hint')}
				>
					<Grid gap="sm" minimum="compact">
						<Field name="assessment_period" label={t('component.assessment_period')} />
						<Field name="assessment_scope" label={t('component.assessment_scope')} />
						<Field name="elections" label={t('component.scheme_elections')} />
						<Field
							name="employee_share_annual_cap"
							label={t('component.employee_share_annual_cap')}
						/>
						<Field name="shared_cap_group" label={t('component.shared_cap_group')} />
						<Field name="project_relief_annually" label={t('component.project_relief_annually')} />
					</Grid>
				</FormSection>

				<FormSection
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
					title={t('component.scheme_section_rules')}
					hint={t('component.scheme_section_rules_hint')}
				>
					<Field name="rules" label={t('component.scheme_rules')} />
				</FormSection>
			</Stack>
		{/snippet}
	</CollectionForm>
{/snippet}

<!-- Tab content must be snippets (TabConfig.content); the shell always renders tabs so no snippet is ever render-called elsewhere. -->
<RecordShell
	{tabs}
	icon={sealed ? 'lucide:lock-keyhole' : undefined}
	badge={sealed ? t('component.settings_sealed_badge') : undefined}
	hint={sealed ? t('component.settings_sealed_note') : undefined}
/>
