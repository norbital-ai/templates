# Job assignments import CSV

The controller dashboard's **Import** button (beside **Assign contractor**) reads a CSV in this
shape and creates one job assignment per row. The first row is the header; column order does not
matter and blank cells are ignored.

## Columns

| Column             | Required | Description                                                                                        |
| ------------------ | -------- | -------------------------------------------------------------------------------------------------- |
| `site`             | yes      | A site's name or site code (case-insensitive). A name no site carries is filed as a new site.      |
| `scheduled_for`    | yes      | The work day, `YYYY-MM-DD`.                                                                        |
| `title`            | yes      | The work order's title, shown on the dispatch board.                                               |
| `nature`           | no       | What kind of work it is, for example `Survey` or `Installation`.                                   |
| `description`      | no       | The work scope.                                                                                    |
| `assignee_user_id` | no       | The contractor's workspace user id. With it the row is filed `assigned`; without it, `unassigned`. |
| `external_ref`     | no       | The dispatch system's own reference. It must be unique across assignments.                         |

The whole sheet is checked before anything is written: a bad day, a malformed user id or a repeated
`external_ref` refuses the import and names every row at fault.

`assignee_user_id` names a **person**. The template does not query the private identity directory to
turn a display name into an id; the relationship's foreign key rejects an id that is not a workspace
user. Leave it blank to dispatch from the board instead.
