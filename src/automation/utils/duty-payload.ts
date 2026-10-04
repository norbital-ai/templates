import type {Id,Insert} from '@norbital-ai/bolt';
import {Schema} from 'effect';
import {PlainDate} from '@norbital-ai/std/date';
import {calendarDay} from '../../lib/payroll_engine/foundation.js';
import {refuse} from '../../lib/payroll_engine/foundation.js';

const configuredDuty=Schema.Struct({
 company_id:Schema.NonEmptyString,settings_id:Schema.NonEmptyString,duty_code:Schema.NonEmptyString,
 subject_kind:Schema.Literals(['COMPANY','EMPLOYMENT','WORKSITE','RUN','CASE']),subject_id:Schema.NonEmptyString,trigger_ref:Schema.NonEmptyString,
 triggered_on:calendarDay,due_on:calendarDay,
 amount_due:Schema.optional(Schema.NullOr(Schema.Number)),recipient_id:Schema.optional(Schema.NullOr(Schema.NonEmptyString)),
 facts:Schema.optional(Schema.Record(Schema.String,Schema.Union([Schema.Boolean,Schema.Number,Schema.String]))),
 retain_until:Schema.optional(Schema.NullOr(calendarDay)),source_basis:Schema.optional(Schema.Json)
});

/** One admitted configured duty as its native obligations insert; the caller supplies the owner it already resolved. */
export function configuredDutyPayload(company_id:Id<'entity'>,settings_id:Id<'jurisdiction_settings'>,row:Readonly<Record<string,unknown>>,source_basis?:unknown):Insert<'obligation'>{
 const value=Schema.decodeUnknownSync(configuredDuty)(row);
 if(value.company_id!==company_id||value.settings_id!==settings_id)refuse('A configured duty retains its actual owner and governing snapshot.');
 const basis=Schema.decodeUnknownSync(Schema.Json)(source_basis===undefined?value.source_basis:source_basis);
 return {
  company_id,settings_id,duty_code:value.duty_code,subject_kind:value.subject_kind,subject_id:value.subject_id,trigger_ref:value.trigger_ref,
  triggered_on:PlainDate(value.triggered_on),due_on:PlainDate(value.due_on),
  ...(value.amount_due==null?{}:{amount_due:value.amount_due}),...(value.recipient_id==null?{}:{recipient_id:value.recipient_id}),
  ...(value.facts==null?{}:{facts:value.facts}),...(value.retain_until==null?{}:{retain_until:PlainDate(value.retain_until)}),
  source_basis:basis
 };
}
