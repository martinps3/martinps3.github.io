# Shipment reporting: example model context

This is a fictional context brief for the portfolio's Snowflake-to-Power-BI
incremental-refresh example, not a production instruction file. Replace the
assumptions and confirm object names before using it with another model.
An ordinary Markdown file is not automatically loaded by every agent: ask your
tool to read it explicitly.

## Stable definitions

- The intended grain of `Shipments` is one current row per `SHIPMENT_ID`.
- `NET_CHARGE` is a shipment-level charge in USD. Do not convert currencies.
- `SHIPPED_AT` is the shipment timestamp used to partition and filter the data.
- Source timestamps are Snowflake `TIMESTAMP_NTZ`, interpreted as UTC by
  convention. NTZ itself carries no time-zone information.
- `UPDATED_AT` is an audit timestamp, not the partitioning timestamp.
- The example has no event table, cancellation field or delivery-status field.
  Do not invent rules for them.
- Null keys, duplicate shipment keys, missing charges or mixed currencies are
  data-quality questions to raise, not values to silently remove or replace.

Confirm these statements against the actual model and source before editing.
If evidence disagrees, show the conflicting file/expression or query result
and ask for a decision. Do not hide duplicated rows with DISTINCTCOUNT.

## Where to look

- Read the current table, measure and relationship definitions first.
- Find existing total-charge and shipment-count measures instead of creating
  duplicates. Names in this brief are illustrative, not guaranteed identifiers.
- The portfolio's source fixture is in
  [incremental-refresh-setup.sql](incremental-refresh-setup.sql).
- Its later changes are in
  [incremental-refresh-changes.sql](incremental-refresh-changes.sql).
- If you move this brief into another repository, update these relative links.

## Worked task: average charge per shipment

This section is a temporary example task. Remove it when the task is finished.

Calculate total charge divided by shipment count within the current report
filter context. Every shipment has equal weight; do not average carrier
averages. Do not remove date or carrier filters to force a target total.

Suggested shape, only after verifying the existing measures:

```dax
Average charge = DIVIDE([Total charge], [Shipment count])
```

No alternate result is specified: an empty or zero denominator should produce
BLANK, not a displayed zero charge. Currency formatting is separate from the
numeric expression.

### Allowed scope

- First respond with existing expressions, unresolved assumptions and planned
  files. Do not edit until the plan is approved.
- Propose only the required measure change and its tests.
- Do not change relationships, RLS, partition policy, source connections,
  report layout or deployment settings for this task.
- Do not publish, refresh a service model or access a live source without
  explicit permission. These written boundaries are not an access-control
  mechanism; tool permissions must enforce the actual restrictions.

### Expected checks: initial fixture only

Use the six-row setup BEFORE running the correction script.
For these date checks, retain the fixed dates rather than the optional shifted
dates in the setup walkthrough.

| Filter | Total charge, USD | Shipment count | Average charge, USD |
| --- | ---: | ---: | ---: |
| All initial rows | 2100 | 6 | 350 |
| SHIPPED_AT >= 2026-09-21 and < 2026-09-23 | 1100 | 2 | 550 |
| No matching shipments | BLANK | BLANK or 0, depending on the count measure | BLANK |

Check totals and filtered results in the model, not just DAX syntax.
Do not use these initial expectations after applying source corrections.

Optional unequal-group check: for this check only, assign S1001-S1002 to
fictional carrier Alder, and S1003-S1006 to fictional carrier Beacon.
This carrier column is NOT included in the downloadable SQL fixture.
Alder averages 150 across two shipments; Beacon averages 450 across four.
The shipment-weighted grand total must be 350, not the carrier-average 300.

### Handoff

Return the previous and proposed expressions, the precise files changed,
checks actually run with results, and checks not run with the reason.
If you cannot execute DAX or connect to the model, say so. A calculated
expectation is not evidence that the model returned that value.

## Keep the context current

Review this file when grain, currency, timestamp convention or metric
definitions change. The definitions in the current model are evidence,
but a business owner must resolve conflicting business rules.
Keep credentials, private endpoints and unapproved data out of the brief.
