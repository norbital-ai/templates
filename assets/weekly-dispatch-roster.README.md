# Weekly dispatch roster CSV

Operators share this template with clients to collect contractor assignments for a dispatch week.

## Columns

| Column             | Description                                                                       |
| ------------------ | --------------------------------------------------------------------------------- |
| `week_start`       | Monday of the dispatch week (`YYYY-MM-DD`). Every row must use the same value.    |
| `site_name`        | Site name exactly as recorded in Field Operations (case-insensitive match).       |
| `scheduled_for`    | Job date within the week (`YYYY-MM-DD`, between `week_start` and six days later). |
| `job_title`        | Unassigned job title for that site and date (case-insensitive match).             |
| `assignee_user_id` | The workspace user ID selected for the assignment.                                |
| `summary`          | Optional visit or dispatch note stored on the assignment.                         |

Each row assigns one contractor to one existing unassigned job. Create the jobs in Field Operations before importing the roster.

`assignee_user_id` names a **person**, not a company. Copy the ID from the relationship value exposed
by the workspace UI or an approved source export. The template does not query the private identity
directory to turn a display name into an ID. The declared relationship foreign key rejects an ID that
does not belong to an existing workspace user.
