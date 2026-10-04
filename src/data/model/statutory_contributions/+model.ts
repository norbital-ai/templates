import { model } from '@norbital-ai/bolt';

export default model({
 description: 'One statutory catalog item of an immutable jurisdiction version. Its configuration declares qualified sources, eligibility, ordered assessment programs, dependencies and employer-month remittance behaviour. Original policy data and source identities remain inside the same configuration.',
 icon: 'lucide:landmark',
 label: 'name',
 fields: {
  code: { kind: 'text' },
  name: { kind: 'text' },
  authority: { kind: 'text', optional: true },
  configuration: { kind: 'json', help: 'Original legal policy plus executable input, record, derivation, assessment and finalization configuration. Missing source evidence never establishes zero liability.' }
 },
 unique: [{ fields: ['settings_id', 'code'] }],
 search: { text: ['code', 'name'] }
});
