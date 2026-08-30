// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Effect, Schema } from 'effect';
import {
	aggregateResearchReceipts,
	completeJurisdictionProvenance,
	runStatutoryProfileDrift,
	STATUTORY_RESEARCH_MODEL,
	StatutoryResearchReportSchema,
	statutoryResearchFindingContext,
	validateResearchReceipt
} from '../automations/+statutory_profile_drift.ts';

const officialReport = {
	summary: 'Official sources were checked; one possible CPF wording change needs review.',
	highlights: ['No local structural drift was detected.'],
	official_sources: [
		{
			title: 'CPF contribution rates',
			url: 'https://www.cpf.gov.sg/employer/employer-obligations/how-much-cpf-contributions-to-pay',
			jurisdiction_code: 'SG',
			finding: 'The official contribution-rate page was current at review time.'
		}
	],
	changes_to_review: [
		{
			jurisdiction_code: 'SG',
			subject: 'CPF profile wording',
			current_local_value: 'Existing configured wording',
			latest_official_value: 'Current official wording',
			rationale: 'An authorised person should compare the exact effective date.',
			source_url:
				'https://www.cpf.gov.sg/employer/employer-obligations/how-much-cpf-contributions-to-pay'
		}
	]
};

const reportFor = (code, url) => ({
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

const fakeApi = (infer, queryRows = {}) => {
	const progress = [];
	const logCreates = [];
	const logUpdates = [];
	const factCreates = [];
	const factUpdates = [];
	const inferenceRequests = [];
	const query = (name) => ({ findMany: () => Effect.succeed(queryRows[name] ?? []) });
	let openedRunLog;
	const api = {
		progress: (snapshot) => Effect.sync(() => progress.push(snapshot)),
		infer: (request) =>
			Effect.sync(() => inferenceRequests.push(request)).pipe(Effect.flatMap(() => infer(request))),
		/**
		 * One declarative `mutate` per collection, split back into create and update by the presence
		 * of an id — which is the rule the runtime itself applies, and the reason the two used to be
		 * separate methods and no longer are.
		 *
		 * `mutate` returns nothing, so the run log the handler opens has to be readable afterwards:
		 * `findFirst` answers with the row this double accepted, keyed the way the handler looks it
		 * up. A double that handed back the written row would let the handler skip a read it now
		 * genuinely performs.
		 */
		db: {
			jurisdictions: query('jurisdictions'),
			statutory_contributions: query('statutory_contributions'),
			contribution_rates: query('contribution_rates'),
			companies: query('companies'),
			employments: query('employments'),
			statutory_profile_drift_logs: {
				findFirst: () => Effect.succeed(openedRunLog),
				mutate: (values) =>
					Effect.sync(() => {
						if (values.id == null) {
							logCreates.push(values);
							openedRunLog = { id: 'run-log-1', ...values };
							return;
						}
						const { id, ...rest } = values;
						logUpdates.push({ id, values: rest });
					})
			},
			employment_statutory_facts: {
				findMany: () => Effect.succeed(queryRows['employment_statutory_facts'] ?? []),
				mutate: (values) =>
					Effect.sync(() => {
						if (values.id == null) {
							factCreates.push(values);
							return;
						}
						const { id, ...rest } = values;
						factUpdates.push({ id, values: rest });
					})
			}
		}
	};
	return {
		api,
		progress,
		logCreates,
		logUpdates,
		factCreates,
		factUpdates,
		inferenceRequests
	};
};

describe('statutory profile drift authored handler', () => {
	it('bounds large local-finding sets as counts and deterministic research samples', () => {
		const findings = Array.from({ length: 398 }, (_, index) => ({
			kind: 'missing_fact',
			label: `Employment ${String(index).padStart(3, '0')} is missing CPF ${'detail '.repeat(200)}`
		}));
		const lines = statutoryResearchFindingContext(findings);
		assert.equal(
			lines[0],
			'- Total local structural findings: 398. The complete set is stored in the tenant receipt and must not be enumerated in the answer.'
		);
		assert.equal(lines[1], '- missing_fact: 398');
		assert.equal(lines.filter((line) => line.startsWith('  - sample:')).length, 4);
		assert.ok(lines.join('\n').length < 3_000);
		assert.match(lines.join('\n'), /…\[clipped\]/);
	});

	it('bounds the structured receipt so a provider cannot enumerate unbounded review material', () => {
		assert.doesNotThrow(() =>
			Schema.decodeUnknownSync(StatutoryResearchReportSchema)(officialReport)
		);
		assert.throws(
			() =>
				Schema.decodeUnknownSync(StatutoryResearchReportSchema)({
					...officialReport,
					highlights: Array.from({ length: 9 }, (_, index) => `Highlight ${index}`)
				}),
			/length of at most 8/
		);
		assert.throws(
			() =>
				Schema.decodeUnknownSync(StatutoryResearchReportSchema)({
					...officialReport,
					summary: 'x'.repeat(1_201)
				}),
			/length of at most 1200/
		);
	});

	it('requires official HTTPS coverage and provenance for every review item', () => {
		assert.equal(validateResearchReceipt(officialReport, ['SG']), officialReport);
		assert.equal(
			validateResearchReceipt(
				{
					...officialReport,
					changes_to_review: [
						{
							...officialReport.changes_to_review[0],
							source_url:
								'https://cpf.gov.sg/employer/employer-obligations/how-much-cpf-contributions-to-pay/'
						}
					]
				},
				['SG']
			).changes_to_review.length,
			1
		);
		assert.throws(
			() => validateResearchReceipt(officialReport, ['SG', 'MY']),
			/no official source for jurisdiction MY/
		);
		assert.throws(
			() =>
				validateResearchReceipt(
					{
						...officialReport,
						official_sources: [
							{ ...officialReport.official_sources[0], url: 'http://www.cpf.gov.sg/rates' }
						]
					},
					['SG']
				),
			/not an allowed official HTTPS URL/
		);
		assert.throws(
			() =>
				validateResearchReceipt(
					{
						...officialReport,
						changes_to_review: [
							{
								...officialReport.changes_to_review[0],
								source_url: 'https://www.cpf.gov.sg/different-page'
							}
						]
					},
					['SG']
				),
			/does not cite a same-jurisdiction URL present in official_sources/
		);
	});

	it('indexes a Pag-IBIG review citation omitted from the model source list', () => {
		const completed = completeJurisdictionProvenance(
			{
				summary: 'Pag-IBIG contribution material was reviewed.',
				highlights: [],
				official_sources: [],
				changes_to_review: [
					{
						jurisdiction_code: 'Philippines',
						subject: 'Pag-IBIG Fund Contribution Rates',
						current_local_value: 'Existing contribution schedule',
						latest_official_value: 'Current official contribution schedule',
						rationale: 'The effective schedule needs authorised review.',
						source_url: 'https://www.pagibigfund.gov.ph/Membership_Contributions.html'
					}
				]
			},
			'PH'
		);

		assert.equal(completed.official_sources.length, 1);
		assert.equal(completed.official_sources[0].jurisdiction_code, 'PH');
		assert.equal(completed.official_sources[0].url, completed.changes_to_review[0].source_url);
		assert.doesNotThrow(() => validateResearchReceipt(completed, ['PH']));
	});

	it('does not promote a non-official review citation into the source index', () => {
		const completed = completeJurisdictionProvenance(
			{
				summary: 'A non-official result must remain invalid.',
				highlights: [],
				official_sources: [],
				changes_to_review: [
					{
						jurisdiction_code: 'PH',
						subject: 'Unverified contribution claim',
						current_local_value: 'Existing contribution schedule',
						latest_official_value: 'Unverified schedule',
						rationale: 'This must not be accepted as official evidence.',
						source_url: 'https://example.com/pag-ibig-rates'
					}
				]
			},
			'PH'
		);

		assert.equal(completed.official_sources.length, 0);
		assert.throws(
			() => validateResearchReceipt(completed, ['PH']),
			/no official source for jurisdiction PH/
		);
	});

	it('aggregates independently validated jurisdiction receipts deterministically', () => {
		const aggregate = aggregateResearchReceipts(
			[
				{ code: 'SG', report: officialReport },
				{ code: 'MY', report: reportFor('MY', 'https://www.kwsp.gov.my/employer') }
			],
			398
		);
		assert.deepEqual(
			aggregate.official_sources.map(({ jurisdiction_code }) => jurisdiction_code),
			['SG', 'MY']
		);
		assert.match(aggregate.summary, /398 local structural findings/);
	});

	it('researches even a locally clean profile and stores official-source evidence', async () => {
		const harness = fakeApi(() => Effect.succeed(officialReport));
		const output = await Effect.runPromise(runStatutoryProfileDrift(harness.api));

		assert.equal(harness.inferenceRequests.length, 1, 'clean runs must still research the web');
		const [request] = harness.inferenceRequests;
		assert.equal(request.model, STATUTORY_RESEARCH_MODEL);
		assert.equal(request.webSearch.maxResults, 4);
		assert.ok(request.webSearch.allowedDomains.includes('cpf.gov.sg'));
		assert.ok(request.webSearch.allowedDomains.includes('myskillsfuture.gov.sg'));
		assert.ok(request.webSearch.allowedDomains.includes('bli.gov.tw'));
		assert.ok(request.webSearch.allowedDomains.includes('baohiemxahoi.gov.vn'));
		assert.match(request.prompt, /Web research is still required/);

		assert.equal(harness.logCreates.length, 1);
		assert.equal(harness.logCreates[0].status, 'RUNNING');
		const completed = harness.logUpdates.at(-1)?.values;
		assert.equal(completed.status, 'SUCCEEDED');
		assert.equal(completed.local_findings_count, 0);
		assert.equal(completed.successor_proposals_count, 0);
		assert.deepEqual(completed.official_sources, officialReport.official_sources);
		assert.deepEqual(completed.changes_to_review, officialReport.changes_to_review);

		assert.equal(output.run_log_id, 'run-log-1');
		assert.deepEqual(output.official_sources, officialReport.official_sources);
		assert.equal(harness.factCreates.length, 0, 'AI review material must not create law facts');
		assert.equal(harness.factUpdates.length, 0, 'AI review material must not update law facts');
		assert.deepEqual(
			harness.progress.map(({ progress }) => progress),
			[0.02, 0.12, 0.3, 0.45, 0.62, 0.9, 1]
		);
	});

	it('submits a unique deterministic successor directly under its approved policy', async () => {
		const harness = fakeApi(() => Effect.succeed(officialReport), {
			jurisdictions: [
				{
					id: 'j-sg',
					code: 'SG',
					name: 'Singapore',
					lifecycle: 'SEALED',
					effective_range: { start: '2020-01-01T00:00:00.000Z', end: null }
				}
			],
			statutory_contributions: [
				{
					id: 'cpf-new',
					jurisdiction_id: 'j-sg',
					statutory_profile_id: 'j-sg',
					code: 'CPF',
					name: 'CPF current'
				}
			],
			contribution_rates: [
				{
					id: 'rate-current',
					statutory_contribution_id: 'cpf-new',
					summary: 'Current CPF rate'
				}
			],
			companies: [],
			employments: [],
			employment_statutory_facts: [
				{
					id: 'fact-old',
					employment_id: 'employment-1',
					statutory_contribution_id: 'cpf-old',
					status: { kind: 'REGISTERED', reference_number: 'CPF-1', rate_override: null },
					summary: 'Registered · CPF-1',
					effective_range: { start: '2020-01-01T00:00:00.000Z', end: null },
					statutory_fact_contribution: {
						id: 'cpf-old',
						jurisdiction_id: 'j-sg',
						statutory_profile_id: 'j-sg',
						code: 'CPF',
						name: 'CPF former'
					}
				}
			]
		});

		const output = await Effect.runPromise(runStatutoryProfileDrift(harness.api));

		assert.equal(output.proposals, 1);
		assert.equal(harness.factCreates.length, 1);
		const submitted = harness.factCreates[0];
		assert.match(submitted.effective_range.start, /^\d{4}-\d{2}-\d{2}T/);
		assert.deepEqual(
			{ ...submitted, effective_range: { start: '<instant>', end: null } },
			{
				employment_id: 'employment-1',
				statutory_contribution_id: 'cpf-new',
				supersedes_fact_id: 'fact-old',
				status: { kind: 'REGISTERED', reference_number: 'CPF-1', rate_override: null },
				effective_range: { start: '<instant>', end: null }
			}
		);
		assert.equal(harness.factUpdates.length, 0);
		const completed = harness.logUpdates.at(-1)?.values;
		assert.equal(completed.successor_proposals_count, 1);
		assert.match(completed.successor_proposals[0], /awaiting HR Manager approval$/);
	});

	it('persists a failed receipt and rethrows a provider failure', async () => {
		const harness = fakeApi(() => Effect.fail(new Error('provider unavailable')));
		await assert.rejects(
			Effect.runPromise(runStatutoryProfileDrift(harness.api)),
			/provider unavailable/
		);

		const failed = harness.logUpdates.at(-1)?.values;
		assert.equal(failed.status, 'FAILED');
		assert.match(failed.error, /provider unavailable/);
		assert.equal(harness.factCreates.length, 0);
		assert.equal(harness.factUpdates.length, 0);
		assert.match(harness.progress.at(-1)?.text ?? '', /failed: provider unavailable/);
	});

	it('fails and records the run when an official-source receipt omits a jurisdiction', async () => {
		const harness = fakeApi(
			() =>
				Effect.succeed({
					summary: 'No source was returned.',
					highlights: [],
					official_sources: [],
					changes_to_review: []
				}),
			{
				jurisdictions: [
					{
						id: 'j-my',
						code: 'MY',
						name: 'Malaysia',
						lifecycle: 'SEALED',
						effective_range: { start: '2020-01-01T00:00:00.000Z', end: null }
					}
				]
			}
		);
		await assert.rejects(
			Effect.runPromise(runStatutoryProfileDrift(harness.api)),
			/no official source for jurisdiction MY/
		);

		const failed = harness.logUpdates.at(-1)?.values;
		assert.equal(failed.status, 'FAILED');
		assert.match(failed.error, /no official source for jurisdiction MY/);
	});

	it('researches and validates each configured jurisdiction independently', async () => {
		const harness = fakeApi(
			(request) => {
				if (/ONLY the latest statutory payroll position for SG/.test(request.prompt)) {
					return Effect.succeed(officialReport);
				}
				if (/ONLY the latest statutory payroll position for MY/.test(request.prompt)) {
					return Effect.succeed(reportFor('MY', 'https://www.kwsp.gov.my/employer'));
				}
				return Effect.fail(new Error('unexpected jurisdiction prompt'));
			},
			{
				jurisdictions: [
					{
						id: 'j-sg',
						code: 'SG',
						name: 'Singapore',
						lifecycle: 'SEALED',
						effective_range: { start: '2020-01-01T00:00:00.000Z', end: null }
					},
					{
						id: 'j-my',
						code: 'MY',
						name: 'Malaysia',
						lifecycle: 'SEALED',
						effective_range: { start: '2020-01-01T00:00:00.000Z', end: null }
					}
				]
			}
		);
		const output = await Effect.runPromise(runStatutoryProfileDrift(harness.api));

		assert.equal(harness.inferenceRequests.length, 2);
		assert.deepEqual(
			output.official_sources.map(({ jurisdiction_code }) => jurisdiction_code),
			['SG', 'MY']
		);
		assert.match(harness.inferenceRequests[0].prompt, /"code":"SG"/);
		assert.match(harness.inferenceRequests[1].prompt, /"code":"MY"/);
	});

	it('retries only the jurisdiction whose first receipt lacks official coverage', async () => {
		let attempt = 0;
		const harness = fakeApi(
			() => {
				attempt += 1;
				return Effect.succeed(
					attempt === 1
						? {
								summary: 'Incomplete first pass.',
								highlights: [],
								official_sources: [],
								changes_to_review: []
							}
						: reportFor('ID', 'https://www.pajak.go.id/id/peraturan')
				);
			},
			{
				jurisdictions: [
					{
						id: 'j-id',
						code: 'ID',
						name: 'Indonesia',
						lifecycle: 'SEALED',
						effective_range: { start: '2020-01-01T00:00:00.000Z', end: null }
					}
				]
			}
		);
		const output = await Effect.runPromise(runStatutoryProfileDrift(harness.api));

		assert.equal(harness.inferenceRequests.length, 2);
		assert.match(harness.inferenceRequests[1].prompt, /previous receipt failed validation/i);
		assert.equal(output.official_sources[0].jurisdiction_code, 'ID');
		assert.ok(harness.progress.some(({ text }) => /Retrying.*ID/.test(text)));
	});
});
