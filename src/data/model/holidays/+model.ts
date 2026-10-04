import { model } from '@norbital-ai/bolt';

export default model({
  "description": "One observed public holiday of one legal entity on one day. Published individually; a row a payroll run captured or a work day pins is frozen. Imported from a spreadsheet or a Google holiday calendar, or entered by hand.",
  "icon": "lucide:calendar-x",
  "label": [
    "date",
    "name"
  ],
  "fields": {
    input_column_history: { kind: 'json', optional: true, hidden: true },
    "replacement_original_work_code": {"kind":"text","optional":true},
    "replacement_original_roster_source": {"kind":"text","optional":true},
    "substitutes_weekly_rest": {
      "kind": "bool",
      "optional": true
    },
    "statutory_qualification": {
      "kind": "json",
      "optional": true
    },
    "statutory_qualification_file": {
      "kind": "file",
      "accept": [
        "*/*"
      ],
      "max": "20MiB",
      "optional": true
    },
    "date": {
      "kind": "date"
    },
    "name": {
      "kind": "text"
    },
    "statutory_role": {
      "kind": "text",
      "optional": true
    },
    "statutory_role_reference": {
      "kind": "text",
      "optional": true
    },
    "kind": {
      "kind": "enum",
      "values": [
        "PUBLIC_HOLIDAY",
        "SPECIAL_HOLIDAY",
        "SUBSTITUTE",
        "DOUBLE_HOLIDAY"
      ],
      "default": "PUBLIC_HOLIDAY"
    },
    "replaces": {
      "kind": "date",
      "optional": true
    },
    "given_to": {
      "kind": "enum",
      "values": [
        "EVERYONE",
        "ONLY_IF_OFF_ON_REPLACED_DATE"
      ],
      "default": "EVERYONE"
    },
    "worksite": {
      "kind": "text",
      "optional": true
    },
    "religion": {
      "kind": "text",
      "optional": true
    },
    "applies_when": {
      "kind": "text",
      "optional": true
    },
    "source": {
      "kind": "text",
      "optional": true
    },
    "announced_on": {
      "kind": "date",
      "optional": true
    },
    "announcement_reference": {
      "kind": "text",
      "optional": true
    },
    "published_at": {
      "kind": "instant",
      "optional": true
    }
  },
  "unique": [
    {
      "fields": [
        "company_id",
        "date",
        "worksite"
      ]
    }
  ],
  "index": [
    "published_at"
  ],
  "search": {
    "text": [
      "name"
    ]
  }
});
