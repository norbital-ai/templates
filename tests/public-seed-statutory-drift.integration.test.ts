import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { sealedProfileCovering } from '../src/lib/statutory_profile.ts';
import { success } from '@norbital-ai/bolt-protocol';
import { makeAiBinding } from '@norbital-ai/bolt-server';
import { asRecord, bearerHeaders, postGuestCommand } from '@norbital-ai/test-utilities';
import {
	JURISDICTION_ID,
	LOCAL_DATABASE_TEST_TIMEOUT_MILLIS,
	startPublicSeedHost
} from './helpers/public-seed-host.ts';

const SG_PROFILE_ID = '22222222-2222-4222-8222-222222222201';
const MY_PROFILE_ID = '22222222-2222-4222-8222-222222222202';
const SG_CPF_ID = 'aaaaaaaa-dddd-4eee-8fff-aaaaaaaaaaa5';
const MY_EPF_ID = 'aaaaaaaa-dddd-4eee-8fff-aaaaaaaaaaa6';

const PUB_REGIME = {
	overtime_coverage: null,
	overtime_rules: [],
	overtime_limits: []
};

const PUB_STATUTORY_LEAVE = [
	{
		kind: 'ANNUAL',
		ladder: [{ band_from: 0, days: 8 }],
		per_child: null,
		max_days: null,
		authority: 'Public fixture — not a sealed statutory table.'
	}
];

const PUB_PRORATION = { by: 'CALENDAR_DAYS' };

const PUB_OVERTIME_TREATMENTS = [
	{
		authority: 'Public fixture — overtime excluded',
		treatment: { kind: 'EXCLUDE' },
		effective_range: { start: '2020-01-01T00:00:00.000Z', end: null }
	}
];

const testAiCatalog = {
	_tag: 'Catalog' as const,
	languageModels: [{ id: 'test/language' }],
	defaultLanguageModelId: 'test/language',
	embeddingModels: [{ id: 'test/embedding' }],
	defaultEmbeddingModelId: 'test/embedding'
};

const reportFor = (code: string, url: string) => ({
	summary: `${code} official statutory material was reviewed.`,
	highlights: [`${code} research completed.`],
	official_sources: [
		{
			title: `${code} official source`,
			url,
			jurisdiction_code: code,
			finding: `Current official material for ${code}.`
		}
	],
	changes_to_review: []
});

const fixtureQuote =
	'The approved fixture increases annual leave to twenty days from 1 January 2027.';

const driftAi = () =>
	makeAiBinding({
		call: async (_metadata, request) => {
			if (request._tag !== 'Generate') return testAiCatalog;
			const prompt = JSON.stringify(request);
			const code =
				/Research ONLY the latest statutory payroll position for (SG|MY)/.exec(prompt)?.[1] ??
				/for (SG|MY)/.exec(prompt)?.[1] ??
				'SG';
			const url =
				code === 'SG'
					? 'https://www.cpf.gov.sg/employer/employer-obligations/how-much-cpf-contributions-to-pay'
					: 'https://www.kwsp.gov.my/employer';
			return {
				_tag: 'Generated',
				result: {
					_tag: 'Object',
					value: {
						...reportFor(code, url),
						...(code === 'SG'
							? {
									proposed_law: {
										effective_from: '2027-01-01',
										evidence: [
											{ source_url: url, title: 'Fixture law amendment', quote: fixtureQuote }
										],
										changes: {
											statutory_leave: [
												{ ...PUB_STATUTORY_LEAVE[0], ladder: [{ band_from: 0, days: 20 }] }
											]
										}
									}
								}
							: {})
					}
				},
				observation: {
					callId: 'drift-1',
					provider: 'fixture',
					model: 'provider/model',
					operation: 'language',
					charge: { currency: 'USD', coefficient: '125', scale: 6 },
					chargeSource: 'provider'
				}
			};
		}
	});

const driftFindings = (
	value: unknown
): ReadonlyArray<{ readonly kind?: unknown; readonly label?: unknown }> => {
	if (typeof value === 'string') {
		try {
			return driftFindings(JSON.parse(value));
		} catch {
			return [];
		}
	}
	if (!Array.isArray(value)) return [];
	return value.filter(
		(row): row is { readonly kind?: unknown; readonly label?: unknown } =>
			typeof row === 'object' && row !== null && !Array.isArray(row)
	);
};

const insertSealedProfile = async (
	session: Awaited<ReturnType<typeof startPublicSeedHost>>,
	profile: Readonly<{
		readonly id: string;
		readonly code: string;
		readonly name: string;
		readonly currency: string;
		readonly effective_range: Readonly<{ readonly start: string; readonly end: string | null }>;
	}>
) => {
	await session.query(
		`insert into jurisdictions (
			id, code, name, lifecycle, currency, tax_year_start_month,
			proration, ordinary_rate_basis, ordinary_rate_divisor, regime,
			statutory_leave, effective_range
		) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
		[
			profile.id,
			profile.code,
			profile.name,
			'SEALED',
			profile.currency,
			1,
			PUB_PRORATION,
			'DAYS_PER_MONTH',
			26,
			PUB_REGIME,
			PUB_STATUTORY_LEAVE,
			profile.effective_range
		]
	);
};

const insertContribution = async (
	session: Awaited<ReturnType<typeof startPublicSeedHost>>,
	contribution: Readonly<{
		readonly id: string;
		readonly jurisdiction_id: string;
		readonly statutory_profile_id: string;
		readonly code: string;
		readonly name: string;
	}>
) => {
	await session.query(
		`insert into statutory_contributions (
			id, jurisdiction_id, statutory_profile_id, code, name, authority, payer, keyed_by,
			rounding, relief_for, sequence, special_rules, overtime_treatments, overtime_excess_treatments
		) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
		[
			contribution.id,
			contribution.jurisdiction_id,
			contribution.statutory_profile_id,
			contribution.code,
			contribution.name,
			'Public fixture — not a sealed statutory table.',
			'BOTH',
			'WAGE',
			'NEAREST_CENT',
			[],
			1,
			[],
			PUB_OVERTIME_TREATMENTS,
			PUB_OVERTIME_TREATMENTS
		]
	);
};

test(
	'public seed statutory_profile_drift records rate_gap for SEALED SG and MY schemes without rates',
	{ timeout: LOCAL_DATABASE_TEST_TIMEOUT_MILLIS },
	async () => {
		const session = await startPublicSeedHost('hr-payroll-p1-drift', {
			ai: driftAi(),
			connector: {
				call: async (_metadata, request) =>
					success({
						output: {
							url: asRecord(request.input, 'web request').url,
							contentType: 'text/html',
							body: fixtureQuote
						}
					})
			}
		});
		try {
			await session.query(`update jurisdictions set effective_range = $1 where id = $2`, [
				{ start: '2020-01-01', end: '2026-01-01' },
				JURISDICTION_ID
			]);

			await insertSealedProfile(session, {
				id: SG_PROFILE_ID,
				code: 'SG',
				name: 'Singapore fixture profile',
				currency: 'SGD',
				effective_range: { start: '2026-01-02', end: null }
			});
			await insertSealedProfile(session, {
				id: MY_PROFILE_ID,
				code: 'MY',
				name: 'Malaysia fixture profile',
				currency: 'MYR',
				effective_range: { start: '2026-01-02', end: null }
			});

			await insertContribution(session, {
				id: SG_CPF_ID,
				jurisdiction_id: SG_PROFILE_ID,
				statutory_profile_id: SG_PROFILE_ID,
				code: 'SG-CPF',
				name: 'Singapore fixture CPF'
			});
			await insertContribution(session, {
				id: MY_EPF_ID,
				jurisdiction_id: MY_PROFILE_ID,
				statutory_profile_id: MY_PROFILE_ID,
				code: 'MY-EPF',
				name: 'Malaysia fixture EPF'
			});

			const started = await postGuestCommand(
				session.host.baseUrl,
				'automations.start',
				{ name: 'statutory_profile_drift', input: {} },
				bearerHeaders(session.credential)
			);
			assert.ok(
				started.status >= 200 && started.status < 300,
				`automations.start returned ${started.status}: ${JSON.stringify(started.value)}`
			);
			const body = asRecord(started.value, 'automations.start');
			assert.equal(typeof body.taskId, 'string', JSON.stringify(body));

			const logs = (await session.query(
				`select status, local_findings from statutory_profile_drift_logs order by checked_at desc limit 1`
			)) as ReadonlyArray<{ readonly status: string; readonly local_findings: unknown }>;
			const log = logs[0];
			assert.ok(log, 'expected a statutory_profile_drift_logs row');
			assert.equal(log.status, 'SUCCEEDED', `drift run failed: ${JSON.stringify(logs)}`);

			const rateGaps = driftFindings(log.local_findings).filter((row) => row.kind === 'rate_gap');
			assert.ok(
				rateGaps.length >= 2,
				`expected rate_gap findings, got ${JSON.stringify(rateGaps)}`
			);
			const labels = rateGaps.map((row) => String(row.label ?? ''));
			assert.ok(
				labels.some((label) => label.includes('SG-CPF') || label.includes('(SG)')),
				`expected SG-CPF rate_gap, got ${JSON.stringify(labels)}`
			);
			assert.ok(
				labels.some((label) => label.includes('MY-EPF') || label.includes('(MY)')),
				`expected MY-EPF rate_gap, got ${JSON.stringify(labels)}`
			);
			const pending = await session.query(
				`select id, status, record_id, proposed_values from approval_request where collection_name = 'jurisdictions'`
			);
			assert.equal(pending.length, 1, JSON.stringify(pending));
			const request = asRecord(pending[0], 'law approval');
			assert.equal(request.status, 'ONGOING');
			const unapproved = await session.query(
				`select id from jurisdictions where supersedes_id = $1`,
				[SG_PROFILE_ID]
			);
			assert.equal(unapproved.length, 0, 'pending law must not govern');
			const repeated = await postGuestCommand(
				session.host.baseUrl,
				'automations.start',
				{ name: 'statutory_profile_drift', input: {} },
				bearerHeaders(session.credential)
			);
			assert.ok(repeated.status < 300, JSON.stringify(repeated.value));
			assert.equal(
				(
					await session.query(
						`select id from approval_request where collection_name = 'jurisdictions'`
					)
				).length,
				1,
				'repeat research must reuse the pending proposal'
			);
			const managerHeaders = {
				...bearerHeaders(session.credential),
				'x-colony-impersonated-team': 'HR Manager'
			};
			const status = await postGuestCommand(
				session.host.baseUrl,
				'approvals.status',
				{ requestId: request.id },
				managerHeaders
			);
			const state = asRecord(status.value, 'law approval state');
			assert.equal(state._tag, 'Pending');
			const decided = await postGuestCommand(
				session.host.baseUrl,
				'approvals.decide',
				{ state, decision: 'approve' },
				managerHeaders
			);
			assert.equal(
				asRecord(decided.value, 'law decision')._tag,
				'Approved',
				JSON.stringify(decided.value)
			);
			const readProfiles = () =>
				session.query(
					`select id, code, lifecycle, effective_range, supersedes_id, approval_id, statutory_leave from jurisdictions where code = 'SG'`
				);
			let profiles = await readProfiles();
			const deadline = Date.now() + 5_000;
			while (profiles.length !== 2 && Date.now() < deadline) {
				await delay(25);
				profiles = await readProfiles();
			}
			assert.equal(profiles.length, 2, 'approval must enact the successor automatically');
			const before = sealedProfileCovering(profiles, 'SG', '2026-12-31');
			const after = sealedProfileCovering(profiles, 'SG', '2027-01-01');
			assert.equal(before?.id, SG_PROFILE_ID);
			assert.equal(after?.id, request.record_id);
			assert.equal(after?.statutory_leave[0].ladder[0].days, 20);
		} catch (error) {
			console.error('Statutory workflow failed:', error);
			throw error;
		} finally {
			await session.stop();
		}
	}
);
