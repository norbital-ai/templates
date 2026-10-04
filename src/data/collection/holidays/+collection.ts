import {captureNativeColumnAdmission,appendNativeColumnAdmission} from '../../../lib/payroll_engine/admission/input-column-admission.js';
import { Schema } from 'effect';
import { collection, type Id } from '@norbital-ai/bolt';
import { PlainDate } from '@norbital-ai/std/date';
import * as Predicate from 'effect/Predicate';

/** The first column admission issue's actual native message. */
const columnFault = Schema.decodeUnknownSync(Schema.Struct({ message: Schema.String }));

const c = collection('holidays', {
  "read": {
    "fields": "all",
    "projection": {"fields": ["input_column_history"], "context": []}
  },
  "create": {
    "input": {
      "columns": [
        "company_id",
        "date",
        "name",
        "statutory_role",
        "statutory_role_reference",
        "substitutes_weekly_rest",
        "replacement_original_work_code",
        "replacement_original_roster_source",
        "statutory_qualification",
        "statutory_qualification_file",
        "kind",
        "replaces",
        "given_to",
        "worksite",
        "religion",
        "applies_when",
        "source",
        "announced_on",
        "announcement_reference",
        "published_at"
      ]
    }
  },
  "update": {
    "input": {
      "columns": [
        "company_id",
        "date",
        "name",
        "statutory_role",
        "statutory_role_reference",
        "substitutes_weekly_rest",
        "replacement_original_work_code",
        "replacement_original_roster_source",
        "statutory_qualification",
        "statutory_qualification_file",
        "kind",
        "replaces",
        "given_to",
        "worksite",
        "religion",
        "applies_when",
        "source",
        "announced_on",
        "announcement_reference",
        "published_at"
      ]
    }
  },
  "actions": {
  "import_workbook": {
    "description": "Loads company-wide holidays from the holidays spreadsheet \u2014 one row per entity and day, and one file may carry every entity; a day the entity already has company-wide is skipped, never duplicated or overwritten, and imported rows arrive unpublished. An unmatched entity is refused by name; a duplicated day and a day already on file are reported.",
    "input": {
      "rows": {
        "kind": "list",
        "of": {
          "kind": "object",
          "fields": {
            "legal_entity": {
              "kind": "text"
            },
            "date": {
              "kind": "text"
            },
            "name": {
              "kind": "text"
            },
            "replaces": {
              "kind": "text",
              "optional": true
            },
            "source": {
              "kind": "text",
              "optional": true
            },
            "announced_on": {
              "kind": "text",
              "optional": true
            },
            "announcement_reference": {
              "kind": "text",
              "optional": true
            }
          }
        }
      }
    },
    "output": {
      "kind": "object",
      "fields": {
        "inserted": {
          "kind": "int"
        },
        "skipped": {
          "kind": "list",
          "of": {
            "kind": "object",
            "fields": {
              "company_id": {
                "kind": "text"
              },
              "date": {
                "kind": "text"
              },
              "name": {
                "kind": "text"
              },
              "reason": {
                "kind": "enum",
                "values": [
                  "DUPLICATE_IN_FILE",
                  "ALREADY_PRESENT"
                ]
              }
            }
          }
        }
      }
    }
  }
}
});
export default c;

import { readAll } from '../../../lib/payroll_engine/foundation/reads.js';
import { plain } from '../../../lib/payroll_engine/foundation/primitives.js';
import { refuse } from '../../../lib/payroll_engine/foundation/primitives.js';
import { configuredProgram } from '../../../lib/payroll_engine/execution/expressions/core.js';

type CapturedRun = { readonly period: string; readonly holidays?: readonly { readonly id: string }[] };
c.transform(async (inputs, ctx) => {
 const output = [];
 for (let index = 0; index < inputs.length; index++) {
  const originalInput = inputs[index]!;
  const input = plain(originalInput);
  const existing = ctx.existing[index] == null ? undefined : plain(ctx.existing[index]);
  const row = { ...existing, ...input };
  let columnHistory:Record<string,unknown>={};
  if (Schema.is(Schema.String)(row.worksite)) row.worksite = row.worksite.trim() || null;
  if (Schema.is(Schema.String)(row.applies_when) && row.applies_when.trim()) {
   try { configuredProgram(row.applies_when); } catch (cause) { refuse(`Applies when: ${String(cause)}`); }
  }
  if (existing?.id != null) {
   const runs = await readAll<CapturedRun>(ctx.db, 'payroll_runs', { company_id: { eq: existing.company_id } });
   const captured = runs.find(run => run.holidays?.some(holiday => holiday.id === existing.id));
   if (captured) {
    const reason = `Holiday captured by payroll run ${captured.period}`;
    if (Object.hasOwn(input, '$delete') && Reflect.get(input, '$delete') === true) refuse(`${reason} cannot be deleted.`);
    if (existing.published_at != null && row.published_at == null) refuse(`${reason} and cannot be unpublished.`);
    if ((['date', 'company_id', 'worksite'] as const).some(key => (row[key] ?? null) !== (existing[key] ?? null))) refuse(`${reason}: cannot move its day, entity or worksite.`);
   }
  }
  if(!Object.hasOwn(input, '$delete')){
   if(!Predicate.isString(row.company_id)||!row.company_id.trim())refuse('Holiday classification requires its actual native entity.');
   const owners=await readAll<{id:string;settings_code:string;approval_id?:unknown}>(ctx.db,'entities',{id:{eq:row.company_id},approval_id:{isNull:true}},undefined,{id:true,settings_code:true,approval_id:true});
   if(owners.length!==1||owners[0]!.id!==row.company_id||owners[0]!.approval_id!=null)refuse('Holiday classification requires its actual approved native entity.');
   const staged=ctx.staged.filter(subject=>subject.collection==='holidays'&&subject.parent==null);
   const recordId=existing?.id??staged[index]?.id;if(!Predicate.isString(recordId)||!recordId)refuse('Holiday admission requires its actual native assigned identity.');
   const columns=await captureNativeColumnAdmission(ctx.db,{subjects:[{collection:'holidays',row,record_id:recordId,...(existing==null?{}:{previous:existing}),lineages:[owners[0]!.settings_code]}],observation:{observedAt:String(ctx.now),timezone:ctx.tz}});
   if(columns.issues.length)refuse(columnFault(columns.issues[0]!).message);
   columnHistory=await appendNativeColumnAdmission(existing,{collection:'holidays',id:recordId},[columns],{observedAt:String(ctx.now),timezone:ctx.tz});
  }
  output.push({ ...originalInput,...columnHistory, ...(Object.hasOwn(input, 'worksite') || row.worksite !== existing?.worksite ? { worksite: row.worksite ?? null } : {}) });
 }
 return output;
});

import { dedupeHolidayRows } from '../../../lib/payroll_engine/catalogues/holiday-rows.js';
c.action('import_workbook', async ({ rows }, ctx) => {
 const entities = await readAll<{ readonly id: Id<'entities'>; readonly name: string; readonly registration_number?: string | null }>(ctx, 'entities', { approval_id: { isNull: true } });
 const unresolved = new Set<string>();
 const proposed = rows.map(row => {
  const key = row.legal_entity.trim().toLowerCase();
  const matches = entities.filter(entity => entity.name.trim().toLowerCase() === key || entity.registration_number?.trim().toLowerCase() === key);
  if (matches.length !== 1) unresolved.add(row.legal_entity);
  return { company_id: matches[0]?.id ?? '', date: row.date, name: row.name, replaces: row.replaces ?? null, source: row.source ?? 'spreadsheet', ...(row.announced_on == null ? {} : { announced_on: row.announced_on }), ...(row.announcement_reference == null ? {} : { announcement_reference: row.announcement_reference }) };
 });
 if (unresolved.size) ctx.refuse(`Holiday entities cannot resolve:\n${[...unresolved].map(name => `• ${name}`).join('\n')}`);
 const { inserts, reconciliation } = await dedupeHolidayRows(ctx, proposed, ctx.refuse);
 if (inserts.length) await ctx.act('holidays.create', inserts.map(row => {
  const entityId = entities.find(entity => entity.id === row.company_id)?.id;
  if (entityId == null) refuse('Retain the actual resolved holiday entity.');
  const { date, replaces, announced_on, ...values } = row;
  return { ...values, company_id: entityId, date: PlainDate(date), replaces: replaces == null ? null : PlainDate(replaces), ...(announced_on == null ? {} : { announced_on: PlainDate(announced_on) }) };
 }));
 return { inserted: inserts.length, skipped: reconciliation };
});

// Column receipt sources are internal custody, available only to actual native administrators.
c.project(async (row,ctx)=>ctx.admin===true&&row.input_column_history!==undefined?{input_column_history:row.input_column_history}:{});
