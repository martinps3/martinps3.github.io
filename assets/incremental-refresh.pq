// Paste into the selected reporting view's Advanced Editor, not a SQL window.
// Choose Import in Power BI Desktop; there is no Import switch in this M call.
// First create required Date/Time parameters named RangeStart and RangeEnd
// (case-sensitive). They are separate parameters, not local variables here.
// Use UTC-convention Date/Time values, NOT Date/Time/Timezone or Date.
// Replace the four YOUR_* values. Keep credentials out of this file.
let
    Source = Snowflake.Databases(
        "YOUR_ACCOUNT.snowflakecomputing.com",
        "YOUR_EXISTING_WAREHOUSE",
        [Implementation = "2.0"]
    ),
    Database = Source{[Name = "YOUR_SANDBOX_DB", Kind = "Database"]}[Data],
    Schema = Database{[Name = "YOUR_DISPOSABLE_SCHEMA", Kind = "Schema"]}[Data],
    Shipments = Schema{[Name = "IR_PORTFOLIO_20260924_REPORTING", Kind = "View"]}[Data],
    // Leave SHIPPED_AT untouched so this predicate can fold to Snowflake.
    // Confirm the navigation keys against Desktop Navigator in your environment.
    FilteredRows = Table.SelectRows(
        Shipments,
        each [SHIPPED_AT] >= RangeStart and [SHIPPED_AT] < RangeEnd
    )
in
    FilteredRows
