import assert from 'node:assert/strict';
import { test } from 'node:test';
import { focusStatutoryText, researchPromptPages } from '../src/lib/statutory-research.js';

const boilerplate = Array.from(
	{ length: 400 },
	(_, index) => `Menu item ${index} Home About Contact News Careers Site map Accessibility.`
).join(' ');
const statutory = [
	'From 1 January 2026 the employer contribution rate is 7.5% of the insured monthly salary.',
	'The monthly insured salary ceiling is NT$45,800 and the minimum is NT$28,590.',
	'Employees are entitled to 7 days of annual leave after six months of service.'
];

test('focusing keeps statutory sentences in page order and drops navigation boilerplate', () => {
	const page = `${boilerplate} ${statutory[0]} ${boilerplate} ${statutory[1]} ${boilerplate} ${statutory[2]}`;
	assert.ok(page.length > 50_000);
	const focused = focusStatutoryText(page, 4_000);
	assert.ok(focused.length <= 4_200, `budget respected: ${focused.length}`);
	for (const sentence of statutory) assert.ok(focused.includes(sentence), sentence);
	assert.ok(focused.indexOf(statutory[0]) < focused.indexOf(statutory[1]));
	assert.ok(!focused.includes('Menu item 5 Home'));
	assert.match(focused, /\[focused: 3 statutory sentences of a \d+-character page\]$/);
});

test('a short page passes through untouched and a cue-less page keeps its head', () => {
	assert.equal(focusStatutoryText('Short official notice.', 4_000), 'Short official notice.');
	const noCues = 'lorem ipsum dolor sit amet '.repeat(1_000);
	const focused = focusStatutoryText(noCues, 500);
	assert.equal(focused.length, 501);
	assert.ok(focused.endsWith('…'));
});

test('prompt pages carry only allowed links, capped, and share the total budget', () => {
	const page = {
		url: 'https://www.bli.gov.tw/en/',
		requested_url: 'https://www.bli.gov.tw/en/',
		text: `${boilerplate} ${statutory[0]}`,
		links: [
			'https://www.bli.gov.tw/en/rates',
			'https://facebook.com/bli',
			...Array.from({ length: 60 }, (_, index) => `https://www.bli.gov.tw/en/page-${index}`)
		],
		sha256: 'sha256:0',
		retrieved_at: '2026-09-06T00:00:00.000Z'
	};
	const [view] = researchPromptPages([page, page, page], (url) =>
		url.includes('bli.gov.tw') ? url : null
	);
	assert.ok(view.text.length <= 12_200, String(view.text.length));
	assert.ok(view.text.includes(statutory[0]));
	assert.equal(view.links.length, 40);
	assert.ok(view.links.every((link) => link.includes('bli.gov.tw')));
	assert.ok(!('sha256' in view));
});
