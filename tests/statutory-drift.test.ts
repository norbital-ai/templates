/** L-TPL-hr-payroll-113 official sources, row evidence, quote checks, and when to raise an unsealed draft. */
import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from '@effect/vitest';
import { jsonDiff } from '@norbital-ai/bolt';
import { Result, Schema } from 'effect';
import {
	allowedUrl,
	changeSummary,
	lineageCodes,
	pageFrom,
	quotePresent,
	rowChanges,
	sourcesFrom,
	unverifiedQuotes
} from '../src/lib/payroll_engine/statutory_drift.ts';
import {
	SNAPSHOT_MODELS,
	SNAPSHOT_OUTPUT,
	snapshotFields
} from '../src/lib/payroll_engine/statutory_snapshot.ts';
import { readSeedRows } from './seed_values.ts';

const sources = sourcesFrom({
	entries: [
		{
			agent: 'contribution',
			url: 'https://www.mom.gov.sg/cpf',
			instructions: 'The CPF rate tables.'
		},
		// an entry that serves no agent is no source
		{ url: 'https://example.com/cpf', instructions: 'Unassigned.' }
	],
	agents: { contribution: 'Cite gazetted rates only.' }
});
const url = 'https://www.mom.gov.sg/cpf';
const quote = 'The ordinary wage ceiling is 8000 from 1 January 2026.';
const reference = {
	title: 'CPF Act',
	url,
	quote,
	locator: 'First Schedule',
	effective_from: '2026-01-01'
};

/** A complete snapshot of one seeded version, as the automation reads it. */
const folder = path.resolve(import.meta.dirname, '../seed/jurisdiction/SG/version_4');
const seedSnapshot = () => {
	const [settings] = readSeedRows(folder, 'jurisdiction_settings');
	assert.ok(settings);
	const section = (name: Exclude<keyof typeof SNAPSHOT_MODELS, 'settings' | 'behaviour_rule'>) =>
		readSeedRows(folder, name).map((row) => snapshotFields(row, SNAPSHOT_MODELS[name].fields));
	return {
		settings: snapshotFields(settings, SNAPSHOT_MODELS.settings.fields),
		adhoc_catalog: section('adhoc_catalog'),
		allowance_catalog: section('allowance_catalog'),
		claim_catalog: section('claim_catalog'),
		leave_catalog: section('leave_catalog'),
		loan_catalog: section('loan_catalog'),
		work_catalog: section('work_catalog'),
		statutory_contribution_catalog: section('statutory_contribution_catalog'),
		suspension_kind: section('suspension_kind'),
		rule_set: section('rule_set'),
		behaviour_rule: Schema.decodeUnknownSync(Behaviours)(settings).behaviours.rules.map(
			({ id, ...rule }) => ({ code: String(id), ...rule })
		)
	};
};
const json = Schema.decodeUnknownSync(Schema.Json);
const Behaviours = Schema.Struct({
	behaviours: Schema.Struct({ rules: Schema.Array(Schema.Record(Schema.String, Schema.Json)) })
});
const changesOf = (before: object, after: object) =>
	rowChanges(before, after, jsonDiff(json(before), json(after), SNAPSHOT_OUTPUT.fields.snapshot));
const refusalOf = (before: object, after: object) =>
	Result.getOrThrow(Result.flip(changesOf(before, after)));

describe('statutory drift', () => {
	it('L-TPL-hr-payroll-113 admits listed and same-origin URLs and refuses others', () => {
		assert.deepEqual(sources.urls, ['https://www.mom.gov.sg/cpf']);
		assert.deepEqual(sources.agents, { contribution: 'Cite gazetted rates only.' });
		assert.deepEqual(
			sources.entries.map((entry) => entry.agent),
			['contribution']
		);
		assert.equal(allowedUrl('https://www.mom.gov.sg/cpf', sources), true);
		assert.equal(allowedUrl('https://www.mom.gov.sg/employment-pass', sources), true);
		assert.equal(allowedUrl('https://example.com/cpf', sources), false);
		assert.equal(allowedUrl('ftp://www.mom.gov.sg/cpf', sources), false);
		assert.deepEqual(sourcesFrom(null).urls, []);
		assert.deepEqual(lineageCodes([{ code: 'SG' }, { code: 'MY' }, { code: 'SG' }]), ['SG', 'MY']);
	});

	it('L-TPL-hr-payroll-113 verifies a quote only on its fetched official page', () => {
		const page = pageFrom({ url, title: 'CPF', text: `Rates. ${quote} Other text.` });
		assert.ok(page);
		assert.equal(pageFrom({ kind: 'timeout', message: 'upstream' }), null);
		assert.equal(quotePresent(page.text, 'ordinary wage ceiling is 8000'), true);
		assert.equal(quotePresent(page.text, 'short'), false);
		// a PDF's split token and punctuation inside the official wording are the same wording (Act 265 s.60KA)
		assert.equal(
			quotePresent(
				'termination of employment of foreign employee, etc. 60 ka . (1) if the service of',
				'60KA. (1) If the service of'
			),
			true
		);
		// a quote across a page break, and a quote elided in order; never parts out of order or too short to mean anything
		assert.equal(
			quotePresent(
				'pension are concerned\n[Page 99]\nemployees with the same',
				'pension are concerned employees with the same'
			),
			true
		);
		assert.equal(
			quotePresent(
				'every employer shall pay contributions monthly to the organisation',
				'every employer shall … to the organisation'
			),
			true
		);
		assert.equal(
			quotePresent(
				'every employer shall pay contributions monthly to the organisation',
				'to the organisation … every employer'
			),
			false
		);
		assert.equal(quotePresent('every employer shall pay', 'every employer ... pay'), false);
		// a PDF's line break inside the official wording is the same wording (Act 265 s.60FA as extracted)
		assert.equal(
			quotePresent(
				'Subject to subsection (3), a married male employee \nshall be entitled to a paid paternity',
				'a married male employee shall be entitled'
			),
			true
		);
		assert.deepEqual(unverifiedQuotes([page], [{ url, quote }], sources), []);
		assert.equal(
			unverifiedQuotes([{ ...page, text: 'unrelated bulletin' }], [{ url, quote }], sources).length,
			1
		);
		assert.equal(unverifiedQuotes([], [{ url, quote }], sources).length, 1);
		assert.equal(
			unverifiedQuotes([page], [{ url: 'https://example.com/leak', quote }], sources).length,
			1
		);
	});

	it('L-TPL-hr-payroll-113 groups the diff by keyed row and requires fresh evidence on each changed row', () => {
		const before = seedSnapshot();
		assert.deepEqual(Result.getOrThrow(changesOf(before, seedSnapshot())), []);

		const changed = seedSnapshot();
		const leave = changed.leave_catalog[0];
		assert.ok(leave);
		const code = String(leave['code']);
		leave['name'] = 'Corrected leave name';
		leave['references'] = [reference];
		const rows = Result.getOrThrow(changesOf(before, changed));
		assert.equal(rows.length, 1);
		const [row] = rows;
		assert.ok(row);
		assert.equal(row.section, 'leave_catalog');
		assert.equal(row.code, code);
		assert.equal(row.added, false);
		assert.deepEqual([...row.fields].sort(), ['name', 'references']);
		assert.deepEqual(row.evidence, [{ url, quote }]);
		assert.equal(
			changeSummary(rows, ' Correct the leave name. '),
			`leave_catalog: changed ${code} (${row.fields.join(', ')})\n\nCorrect the leave name.`
		);

		const added = seedSnapshot();
		added.rule_set.push({
			scope: 'JURISDICTION',
			family: 'PAYROLL',
			code: 'probe_rule',
			name: 'Probe rule',
			rules: { until: 'exit_date + duration("8760h")' },
			references: [reference]
		});
		const addedRows = Result.getOrThrow(changesOf(before, added));
		assert.equal(
			changeSummary(addedRows, 'Add the probe rule.'),
			'rule_set: added probe_rule\n\nAdd the probe rule.'
		);
	});

	it('L-TPL-hr-payroll-113 finds no fresh evidence on an unevidenced change, a re-cited old quote or a settings edit without its own references, and refuses a removal', () => {
		const cited = seedSnapshot();
		const citedRow = cited.leave_catalog[0];
		assert.ok(citedRow);
		citedRow['references'] = [reference];

		const bare = structuredClone(cited);
		const bareRow = bare.leave_catalog[0];
		assert.ok(bareRow);
		bareRow['references'] = [];
		bareRow['name'] = 'Changed without evidence';
		assert.deepEqual(
			Result.getOrThrow(changesOf(seedSnapshot(), bare)).map((row) => row.evidence),
			[[]]
		);

		// The row already cited this quote: a new value needs new evidence.
		const recited = structuredClone(cited);
		const recitedRow = recited.leave_catalog[0];
		assert.ok(recitedRow);
		recitedRow['name'] = 'Changed on old evidence';
		assert.deepEqual(
			Result.getOrThrow(changesOf(cited, recited)).map((row) => row.evidence),
			[[]]
		);

		const removed = seedSnapshot();
		const gone = removed.rule_set.pop();
		assert.ok(gone);
		assert.equal(refusalOf(seedSnapshot(), removed), `removed rule_set/${String(gone['code'])}`);

		const settings = seedSnapshot();
		// the settings object is one row: a settings edit is evidenced by the settings' own fresh references
		settings.settings['name'] = 'Renamed jurisdiction';
		assert.deepEqual(
			Result.getOrThrow(changesOf(seedSnapshot(), settings)).map(({ section, code, evidence }) => ({
				section,
				code,
				evidence
			})),
			[{ section: 'settings', code: 'settings', evidence: [] }]
		);
	});
});
