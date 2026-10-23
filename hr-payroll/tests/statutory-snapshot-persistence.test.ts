import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import type { DeclaredRow, Page, ValueOf } from '@norbital-ai/bolt';
import { TestWorkspace } from '@norbital-ai/bolt/test';
import { datePeriod } from '@norbital-ai/std/date';
import { inputSchema, type Json } from '@norbital-ai/std/kind';
import { layer } from '@effect/vitest';
import { Effect, Schema } from 'effect';
import {
	SNAPSHOT_MODELS,
	SNAPSHOT_OUTPUT,
	snapshotFields
} from '../src/lib/payroll_engine/statutory_snapshot.ts';
import { STATUTORY_FIELDS } from '../src/lib/payroll_engine/statutory_fields.ts';
import { nativeId } from './fixture_values.ts';
import { workspace } from './kit.ts';
import { readSeedRows } from './seed_values.ts';

const SettingsIdentity = Schema.Struct({
	id: Schema.String,
	sealed_at: Schema.NullOr(Schema.String),
	effective_range: Schema.Struct({
		from: Schema.String,
		to: Schema.optionalKey(Schema.NullOr(Schema.String))
	})
});
const snapshotShape = SNAPSHOT_OUTPUT.fields.snapshot;
const snapshotCodec = inputSchema(snapshotShape);
const NativeSnapshot = Schema.declare<ValueOf<typeof snapshotShape>>(
	(candidate): candidate is ValueOf<typeof snapshotShape> => Schema.is(snapshotCodec)(candidate)
);
// The research registry is not part of the snapshot: a successor carries the governing version's own.
const sourcesShape = STATUTORY_FIELDS.settings.sources;
const sourcesCodec = inputSchema(sourcesShape);
const Sources = Schema.declare<ValueOf<typeof sourcesShape>>(
	(candidate): candidate is ValueOf<typeof sourcesShape> => Schema.is(sourcesCodec)(candidate)
);
const StoredBehaviours = Schema.Struct({
	behaviours: Schema.Struct({ rules: Schema.Array(Schema.Record(Schema.String, Schema.Json)) })
});
const tables = [
	'adhoc_catalog',
	'allowance_catalog',
	'claim_catalog',
	'leave_catalog',
	'loan_catalog',
	'work_catalog',
	'statutory_contribution_catalog',
	'rule_set'
] as const;

const { pack, snapshots } = (() => {
	const root = path.resolve(import.meta.dirname, '..');
	const pack: Record<string, Array<Readonly<Record<string, Json>>>> = {};
	const snapshots = [];
	for (const code of fs.readdirSync(path.join(root, 'seed/jurisdiction'))) {
		let folder: string | undefined;
		for (const name of fs.readdirSync(path.join(root, 'seed/jurisdiction', code))) {
			if (!/^version_\d+$/.test(name)) continue;
			const candidate = path.join(root, 'seed/jurisdiction', code, name);
			const settings = Schema.decodeUnknownSync(SettingsIdentity)(
				readSeedRows(candidate, 'jurisdiction_settings')[0]
			);
			if (
				settings.effective_range.from <= '2026-10-10' &&
				(settings.effective_range.to == null || settings.effective_range.to >= '2026-10-10')
			)
				folder = candidate;
		}
		assert.ok(folder, `${code} has a settings version governing 2026-10-10`);
		const [settingsRow] = readSeedRows(folder, 'jurisdiction_settings');
		assert.ok(settingsRow);
		const settings = Schema.decodeUnknownSync(SettingsIdentity)(settingsRow);
		const rawSnapshot: Record<string, unknown> = {
			settings: snapshotFields(settingsRow, SNAPSHOT_MODELS.settings.fields),
			// behaviour rules are a snapshot section of their own, keyed by code = the rule's id
			behaviour_rule: Schema.decodeUnknownSync(StoredBehaviours)(settingsRow).behaviours.rules.map(
				({ id, ...rule }) => ({ code: String(id), ...rule })
			)
		};
		pack.jurisdiction_settings ??= [];
		pack.jurisdiction_settings.push({ ...settingsRow, cloned_from_id: null });
		for (const [name, model] of Object.entries(SNAPSHOT_MODELS)) {
			if (name === 'settings' || name === 'behaviour_rule') continue;
			const rows = readSeedRows(folder, name);
			rawSnapshot[name] = rows.map((row) => snapshotFields(row, model.fields));
			if (name === 'suspension_kind') continue;
			pack[name] ??= [];
			pack[name].push(
				...rows.filter((row) => name !== 'rule_set' || row['code'] !== 'record_retention')
			);
		}
		const snapshot = Schema.decodeUnknownSync(NativeSnapshot)(
			Schema.decodeUnknownSync(snapshotCodec)(rawSnapshot)
		);
		const sources = Schema.decodeUnknownSync(Sources)(settingsRow['sources']);
		snapshots.push({ code, settings, snapshot, sources });
	}
	return { pack, snapshots };
})();

layer(workspace({ seed: pack, now: '2026-10-10T00:00:00.000Z' }))(
	'statutory snapshot persistence',
	(it) => {
		it.effect(
			'persists all nine complete corrected snapshots without changing sealed originals',
			() =>
				Effect.gen(function* () {
					const t = yield* TestWorkspace;
					const actor = t.as(t.member(['statutory_drift_automation']));
					const admin = t.as(t.admin);
					const results = [];
					for (const { code, settings, snapshot, sources } of snapshots) {
						const sourceId = nativeId('jurisdiction_settings', settings.id);
						const outcome = yield* actor.act('jurisdiction_settings.create', {
							...snapshot.settings,
							sources,
							behaviours: {
								version: 1,
								rules: snapshot.behaviour_rule.map(({ code: id, ...rule }) => ({ id, ...rule }))
							},
							effective_range: datePeriod('2026-10-10', null),
							sealed_at: null,
							voided_at: null,
							void_reason: null,
							cloned_from_id: sourceId,
							change_summary: 'Disposable persistence probe: restore omitted retention rule.',
							suspension_kinds: snapshot.suspension_kind,
							adhoc_catalog: { create: snapshot.adhoc_catalog },
							allowance_catalog: { create: snapshot.allowance_catalog },
							claim_catalog: { create: snapshot.claim_catalog },
							leave_catalog: { create: snapshot.leave_catalog },
							loan_catalog: { create: snapshot.loan_catalog },
							work_catalog: { create: snapshot.work_catalog },
							statutory_contribution_catalog: { create: snapshot.statutory_contribution_catalog },
							rule_set: { create: snapshot.rule_set }
						});
						assert.equal(outcome.kind, 'committed', JSON.stringify(outcome));
						const { rows: drafts } = yield* admin.read('jurisdiction_settings', {
							where: { cloned_from_id: { eq: sourceId } },
							select: { id: true, sealed_at: true },
							all: true
						});
						assert.equal(drafts.length, 1);
						const draft = drafts[0];
						assert.ok(draft);
						assert.equal(draft.sealed_at, null);
						const saved = yield* admin.get('jurisdiction_settings', draft.id, {
							select: { suspension_kinds: true }
						});
						assert.ok(saved);
						assert.deepEqual(
							saved.suspension_kinds,
							snapshot.suspension_kind,
							`${code} inline suspension kinds`
						);
						for (const name of tables) {
							const { rows: children }: Page<DeclaredRow<typeof name>> = yield* admin.read(name, {
								mode: 'declared',
								where: { settings_id: { eq: draft.id } },
								select: ['code'],
								all: true
							});
							assert.equal(children.length, snapshot[name].length, `${code} ${name}`);
							if (name === 'rule_set')
								assert.ok(children.some((row) => row['code'] === 'record_retention'));
						}
						const original = yield* admin.get('jurisdiction_settings', sourceId, {
							select: { sealed_at: true }
						});
						assert.ok(original);
						assert.equal(original.sealed_at, settings.sealed_at);
						const result = {
							code,
							complete_new_draft: true,
							restored_missing_rule: true,
							original_sealed_version_unchanged: true
						};
						results.push(result);
						console.log(JSON.stringify(result));
					}
					assert.equal(results.length, 9);
				})
		);
		it.effect('an HR editor discards a draft but cannot delete a sealed version', () =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const editor = t.as(t.member(['hr_manager']));
				const [first] = snapshots;
				assert.ok(first);
				const sourceId = nativeId('jurisdiction_settings', first.settings.id);
				const created = yield* editor.act('jurisdiction_settings.create', {
					...first.snapshot.settings,
					sources: first.sources,
					effective_range: datePeriod('2026-10-11', null),
					sealed_at: null,
					voided_at: null,
					void_reason: null,
					cloned_from_id: sourceId,
					change_summary: 'Draft to discard.'
				});
				assert.equal(created.kind, 'committed', JSON.stringify(created));
				const draft =
					created.kind === 'committed'
						? created.records.find((r) => r.collection === 'jurisdiction_settings')
						: undefined;
				assert.ok(draft && draft.collection === 'jurisdiction_settings');
				const discarded = yield* editor.act('jurisdiction_settings.delete', { target: draft.id });
				assert.equal(discarded.kind, 'committed', JSON.stringify(discarded));
				assert.equal(yield* t.as(t.admin).get('jurisdiction_settings', draft.id), null);
				const sealed = yield* editor
					.act('jurisdiction_settings.delete', { target: sourceId })
					.pipe(Effect.flip);
				assert.equal(sealed._tag, 'ActRefused');
				assert.ok(yield* t.as(t.admin).get('jurisdiction_settings', sourceId));
			})
		);
	}
);
