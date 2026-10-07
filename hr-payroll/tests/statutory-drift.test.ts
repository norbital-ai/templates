/** L-TPL-hr-payroll-113 official sources, quote checks, and when to raise an unsealed draft. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	allowedUrl,
	findingFrom,
	lineageCodes,
	pageFrom,
	quotePresent,
	shouldDraft,
	sourcesFrom,
	unverifiedQuotes
} from '../src/lib/payroll_engine/statutory_drift.ts';

const sources = sourcesFrom({
	urls: ['https://www.mom.gov.sg/cpf'],
	research_domains: ['https://www.mom.gov.sg/'],
	instructions: 'Cite gazetted rates only.'
});

describe('statutory drift', () => {
	it('L-TPL-hr-payroll-113 admits listed and same-origin URLs and refuses others', () => {
		assert.deepEqual(sources.urls, ['https://www.mom.gov.sg/cpf']);
		assert.equal(sources.instructions, 'Cite gazetted rates only.');
		assert.equal(allowedUrl('https://www.mom.gov.sg/cpf', sources), true);
		assert.equal(allowedUrl('https://www.mom.gov.sg/employment-pass', sources), true);
		assert.equal(allowedUrl('https://example.com/cpf', sources), false);
		assert.equal(allowedUrl('ftp://www.mom.gov.sg/cpf', sources), false);
		assert.deepEqual(sourcesFrom(null).urls, []);
		assert.deepEqual(lineageCodes([{ code: 'SG' }, { code: 'MY' }, { code: 'SG' }]), ['SG', 'MY']);
	});

	it('L-TPL-hr-payroll-113 drafts only when quotes appear on fetched official pages', () => {
		const page = pageFrom({
			url: 'https://www.mom.gov.sg/cpf',
			title: 'CPF',
			text: 'The ordinary wage ceiling is 8000 from 1 January 2026.'
		});
		assert.ok(page);
		assert.equal(pageFrom({ kind: 'timeout', message: 'upstream' }), null);
		assert.equal(quotePresent(page.text, 'ordinary wage ceiling is 8000'), true);
		assert.equal(quotePresent(page.text, 'short'), false);
		const finding = findingFrom({
			changed: true,
			summary: 'Raise the ordinary wage ceiling to 8000.',
			quotes: [
				{
					url: 'https://www.mom.gov.sg/cpf',
					quote: 'The ordinary wage ceiling is 8000 from 1 January 2026.'
				}
			]
		});
		assert.equal(shouldDraft(finding, unverifiedQuotes([page], finding.quotes, sources)), true);
		assert.equal(
			shouldDraft(
				finding,
				unverifiedQuotes([{ ...page, text: 'unrelated bulletin' }], finding.quotes, sources)
			),
			false
		);
		assert.equal(
			shouldDraft(
				finding,
				unverifiedQuotes(
					[page],
					[
						{
							url: 'https://example.com/leak',
							quote: 'The ordinary wage ceiling is 8000 from 1 January 2026.'
						}
					],
					sources
				)
			),
			false
		);
		assert.equal(shouldDraft(findingFrom({ changed: true, summary: 'moved' }), []), false);
		assert.equal(
			shouldDraft(
				findingFrom({ changed: false, summary: finding.summary, quotes: finding.quotes }),
				[]
			),
			false
		);
	});
});
