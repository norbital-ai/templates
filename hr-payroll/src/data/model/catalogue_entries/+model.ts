import { model } from '@norbital-ai/bolt';

export default model({
 description: 'Catalog-linked runtime records. Original identities and accepted input schemas remain immutable; static allowance and work earnings produce lines without entries.',
 icon: 'lucide:list', label: 'reference',
 fields: {
  input_proofs: { kind: 'json', optional: true, hidden: true },
  input_files: { kind: 'file', accept: ['*/*'], max: '20MiB', multiple: true, optional: true, hidden: true },
  original_capture: { kind: 'json', optional: true, hidden: true },
  migration_failure: { kind: 'json', shape: { kind: 'object', fields: { original_record_id: { kind: 'text' }, original_hash: { kind: 'text' }, path: { kind: 'text' }, message: { kind: 'text' } } }, optional: true, hidden: true },
  funding_capture: { kind: 'json', optional: true, hidden: true },
  admission_capture: { kind: 'json', optional: true, hidden: true },
  source_basis: { kind: 'json', optional: true, hidden: true },
  effect_history: { kind: 'json', optional: true, hidden: true },
  effect_key: { kind: 'text', optional: true, hidden: true },
  scheduled_capture: {kind:'json',optional:true,hidden:true},
  effect_hash: { kind: 'text', optional: true, hidden: true },
  source_kind: { kind: 'text', optional: true, hidden: true },
  activity: { kind: 'enum', values: ['TIME_OFF', 'ENCASHMENT', 'CARRY_FORWARD', 'ADJUSTMENT', 'REVERSAL', 'RETURN_CHANGE'], optional: true, hidden: true },
  catalog: { kind: 'enum', values: ['LEAVE', 'CLAIM', 'ADHOC', 'LOAN', 'CONTRIBUTION'] },
  catalogue_id: { kind: 'text' },
  reference: { kind: 'text' },
  occurred_on: { kind: 'date' },
  values: { kind: 'json' },
  schema_snapshot: { kind: 'json', hidden: true },
  original_record_id: { kind: 'text', optional: true }
 },
 unique: [{ fields: ['effect_key'], where: { effect_key: { isNull: false } } }]
});
