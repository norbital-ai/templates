/** Local compliance probes and their statuses must never become tenant runtime data. */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import test from 'node:test';

const source = new URL('../src/', import.meta.url);
const jurisdiction = new URL('../seed/jurisdiction/', import.meta.url);
const statuses = new Set([
	'VERIFIED',
	'TESTED',
	'NET_TESTED',
	'IMPL',
	'PARTIAL',
	'GAP',
	'SRC-BLOCKED',
	'AWAIT-LAW',
	'IMPLEMENTED',
	'SOURCE-BLOCKED',
	'AWAITING-LAW',
	'UNVERIFIED'
]);

test('tracker boundary: runtime source never imports local compliance inventories', () => {
	const failures: string[] = [];
	for (const file of readdirSync(source, { recursive: true }).filter((file) =>
		/\.(ts|svelte)$/.test(file)
	)) {
		const text = readFileSync(new URL(file, source), 'utf8');
		for (const match of text.matchAll(
			/(?:from\s*|import\s*\(|import\.meta\.glob\s*\()(['"`])([^'"`]+)\1/g
		))
			if (/docs\/inventory|(?:^|\/)tracker(?:-files)?\.[jt]s$/.test(match[2]!))
				failures.push(`${file}: ${match[2]}`);
	}
	assert.deepEqual(failures, []);
});

test('tracker boundary: jurisdiction seed rows carry no local probe statuses', () => {
	const failures: string[] = [];
	const inspect = (value: unknown, path: string): void => {
		if (Array.isArray(value)) {
			value.forEach((item, index) => inspect(item, `${path}[${index}]`));
			return;
		}
		if (value == null || typeof value !== 'object') return;
		for (const [key, entry] of Object.entries(value)) {
			if (
				/(?:^|_)(?:status|verified_at|test_title|probe_id)$/.test(key) &&
				typeof entry === 'string' &&
				(statuses.has(entry) || key !== 'status')
			)
				failures.push(`${path}.${key}`);
			if (key === 'status' && /\.obligations\[/.test(path)) failures.push(`${path}.${key}`);
			if (
				typeof entry === 'string' &&
				/\b(?:TESTED|NET_TESTED|VERIFIED|IMPL|PARTIAL|GAP|SRC-BLOCKED|AWAIT-LAW|IMPLEMENTED|SOURCE-BLOCKED|AWAITING-LAW|UNVERIFIED)\s*[;:]/i.test(
					entry
				)
			)
				failures.push(`${path}.${key}: embedded local coverage label`);
			if (
				typeof entry === 'string' &&
				/\btracker [A-Z]{2}-|\b[Rr]egister (?:MY|SG|PH|ID|TH|VN|CN|TW|JP)-|production verification deferred|golden audit|\b(?:Applied(?: in place)?|Corrected in place) 20\d{2}-\d{2}-\d{2}/.test(
					entry
				)
			)
				failures.push(`${path}.${key}: local testing note`);
			if (
				typeof entry === 'string' &&
				/docs[\/]inventory|(?:^|[\/])tracker(?:-files)?\.[jt]s\b/i.test(entry)
			)
				failures.push(`${path}.${key}: local tracker reference`);
			inspect(entry, `${path}.${key}`);
		}
	};
	for (const file of readdirSync(jurisdiction, { recursive: true }).filter((file) =>
		/\.json(?:\.gz)?$/.test(file)
	)) {
		const data = readFileSync(new URL(file, jurisdiction));
		inspect(JSON.parse((file.endsWith('.gz') ? gunzipSync(data) : data).toString('utf8')), file);
	}
	assert.deepEqual(failures, []);
});
