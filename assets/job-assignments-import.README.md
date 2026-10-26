# Job assignments import CSV

The dispatch page's **Import** button (the `job_assignments_import_work_orders` automation) reads a CSV or xlsx in this
shape and creates one job assignment per row. The first row is the header; column order does not
matter and blank cells are ignored.

## Columns

| Column             | Required | Description                                                                                             |
| ------------------ | -------- | ------------------------------------------------------------------------------------------------------- |
| `site`             | yes      | The location's formatted address, or an existing site code. New sites use this as their location label. |
| `postal_code`      | no       | The six-digit postal code, when the address column does not already carry it.                           |
| `unit_number`      | no       | The unit within the location, for example `#05-12`. An embedded unit in `site` is also accepted.        |
| `latitude`         | new site | The location's latitude, from -90 to 90.                                                                |
| `longitude`        | new site | The location's longitude, from -180 to 180.                                                             |
| `scheduled_for`    | yes      | The work day, `YYYY-MM-DD`.                                                                             |
| `title`            | yes      | The work order's title, shown on the dispatch board.                                                    |
| `nature`           | no       | What kind of work it is, for example `Survey` or `Installation`.                                        |
| `description`      | no       | The work scope.                                                                                         |
| `assignee_user_id` | no       | The contractor's workspace user id. With it the row is filed `assigned`; without it, `unassigned`.      |
| `external_ref`     | no       | The dispatch system's own reference. It must be unique across assignments.                              |

A site is matched by its code, or by its address and unit key: the postal code plus the unit (`#05-12`) when
there is one, otherwise the address with its spelling normalised (`Ave`/`Avenue`, `Rd`/`Road`, …).
So `58 Kismis Ave, S598235` and `58 Kismis Avenue, Singapore 598235` are the same site.
Different units at the same location remain separate sites. An explicit `unit_number` takes
precedence over a unit embedded in `site`; embedded units are stored separately from the location label.

Every row creating a new site must supply both coordinates. Import does not geocode address text.
Rows matching an existing site may leave both coordinates blank; the site's saved location is used.
To import work without coordinates, first add the site by selecting its required **Location** in
the app, optionally enter its **Unit number**, and then use its site code or matching address and
unit in the sheet.

The whole sheet is checked before anything is written: a bad day, a malformed user id or an
`external_ref` repeated within the sheet, or missing/invalid coordinates for a new site refuses
the import and names every row at fault. A row
already filed — its `external_ref` is taken, or, without one, the same title on the same day at the
same site exists — is skipped, so importing the same sheet twice files nothing twice.

`assignee_user_id` names a **person**. The template does not query the private identity directory to
turn a display name into an id; the relationship's foreign key rejects an id that is not a workspace
user. Leave it blank to dispatch from the board instead.
