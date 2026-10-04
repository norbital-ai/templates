<script lang="ts">
 import { Field, Form, RecordShell, type RecordView } from '@norbital-ai/ui';
 import { createValues } from '../../../lib/ui/scopes/create-scope.js';
 let { view }: { view: RecordView<'work_catalogue'> } = $props();
 const record = $derived(view.mode === 'update' ? view.record : null);
</script>
<RecordShell of="work_catalogue" mode={view.mode} {...record == null ? { values: createValues(view) } : { id: record.id }}>
 <Form of="work_catalogue" mode={view.mode} {...record == null ? { values: createValues(view) } : { id: record.id, record }} submit={record ? 'Save work definition' : 'Create work definition'}>
  <Field name="settings_id" />
  <Field name="code" />
  <Field name="name" />
  <Field name="inputs" />
  <Field name="records" />
  <Field name="derived" />
  <Field name="admission" />
  <Field name="eligibility" />
  <Field name="quantity" />
  <Field name="rate" />
  <Field name="amount" help="Include rnd(value, step, mode) where the governing source requires rounding." />
  <Field name="destination" />
  <Field name="direction" />
 </Form>
</RecordShell>
