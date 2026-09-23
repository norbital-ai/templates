# Job assignments import CSV

The dispatch board's **Import** pipeline (the toolbar's operations menu) reads a CSV in this
shape and creates one job assignment per row. The first row is the header; column order does not
matter and blank cells are ignored.

## Columns

| Column             | Required | Description                                                                                        |
| ------------------ | -------- | -------------------------------------------------------------------------------------------------- |
| `site`             | yes      | The site's address, or its site code. An address no site carries is filed as a new site.           |
| `postal_code`      | no       | The six-digit postal code, when the address column does not already carry it.                      |
| `scheduled_for`    | yes      | The work day, `YYYY-MM-DD`.                                                                        |
| `title`            | yes      | The work order's title, shown on the dispatch board.                                               |
| `nature`           | no       | What kind of work it is, for example `Survey` or `Installation`.                                   |
| `description`      | no       | The work scope.                                                                                    |
| `assignee_user_id` | no       | The contractor's workspace user id. With it the row is filed `assigned`; without it, `unassigned`. |
| `external_ref`     | no       | The dispatch system's own reference. It must be unique across assignments.                         |

A site is matched by its code, or by its address key: the postal code plus the unit (`#05-12`) when
there is one, otherwise the address with its spelling normalised (`Ave`/`Avenue`, `Rd`/`Road`, …).
So `58 Kismis Ave, S598235` and `58 Kismis Avenue, Singapore 598235` are the same site.

The whole sheet is checked before anything is written: a bad day, a malformed user id or an
`external_ref` repeated within the sheet refuses the import and names every row at fault. A row
already filed — its `external_ref` is taken, or, without one, the same title on the same day at the
same site exists — is skipped, so importing the same sheet twice files nothing twice.

`assignee_user_id` names a **person**. The template does not query the private identity directory to
turn a display name into an id; the relationship's foreign key rejects an id that is not a workspace
user. Leave it blank to dispatch from the board instead.
