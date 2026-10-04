<script lang="ts">
 import { Field, Form, RecordShell, type RecordView } from '@norbital-ai/ui';
 import { createValues } from '../../../lib/ui/scopes/create-scope.js';
 let { view }: { view: RecordView<'holidays'> } = $props();
 const record = $derived(view.mode === 'update' ? view.record : null);
</script>

<RecordShell of="holidays" mode={view.mode} {...record == null ? { values: createValues(view) } : { id: record.id }}>
 <Form of="holidays" mode={view.mode} {...record == null ? { values: createValues(view) } : { id: record.id, record }} submit={record ? 'Save holiday' : 'Create holiday'}>
  <Field name="company_id" label="Entity" />
  <Field name="date" />
  <Field name="name" />
  <Field name="kind" />
  <Field name="worksite" />
  <Field name="religion" />
  <Field name="applies_when" />
  <Field name="replaces" />
  <Field name="given_to" />
  <Field name="substitutes_weekly_rest" />
  <Field name="statutory_role" />
  <Field name="statutory_role_reference" />
  <Field name="statutory_qualification" />
  <Field name="statutory_qualification_file" />
  <Field name="source" />
  <Field name="announced_on" />
  <Field name="announcement_reference" />
  <Field name="published_at" />
 </Form>
</RecordShell>
