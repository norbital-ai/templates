# Weekly dispatch roster CSV

Operators share this template with clients to collect contractor assignments for a dispatch week.

## Columns

| Column            | Description                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------ |
| `week_start`      | Monday of the dispatch week (`YYYY-MM-DD`). Every row must use the same value.                   |
| `site_name`       | Site name exactly as recorded in Field Operations (case-insensitive match).                      |
| `scheduled_for`   | Job date within the week (`YYYY-MM-DD`, between `week_start` and six days later).                |
| `job_title`       | Unassigned job title for that site and date (case-insensitive match).                            |
| `contractor_name` | The contractor's name exactly as it appears on their workspace account (case-insensitive match). |
| `summary`         | Optional visit or dispatch note stored on the assignment.                                        |

Each row assigns one contractor to one existing unassigned job. Create the jobs in Field Operations before importing the roster.

`contractor_name` names a **person**, not a company. An assignment points straight at the workspace
user it was dispatched to, so the import resolves this cell against the account directory; a name no
account carries, or a name two accounts share, is reported per row and nothing is imported. Add the
contractor to the workspace first — the same account they sign in to the contractor app with.
