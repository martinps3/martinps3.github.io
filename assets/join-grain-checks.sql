-- Join and grain checker: a read-only Snowflake worksheet.
-- This synthetic example returns three keys. Shipment 101 has two joined rows
-- and an amount difference of 120. The other two keys are unchanged.
--
-- Replace ONLY the two example CTEs with your before/after SELECT queries.
-- Both must expose shipment_id and net_charge with matching types.
-- Use the same filters, currency, business scope and data cutoff on each side.
-- net_charge must be a base-grain amount expected to stay unchanged.
-- For a composite key, add every key column to both GROUP BY lists and
-- the join predicate. Do not concatenate keys with an ambiguous separator.
-- This checks full query results; it does not alter tables or execute ETL.
-- Review runtime/warehouse cost before expanding the reporting scope.

WITH
base_data (shipment_id, net_charge) AS (
    SELECT column1::VARCHAR, column2::NUMBER(38, 6)
    FROM VALUES ('101', 120), ('102', 80), ('103', 200)
),
joined_data (shipment_id, net_charge) AS (
    SELECT column1::VARCHAR, column2::NUMBER(38, 6)
    FROM VALUES ('101', 120), ('101', 120), ('102', 80), ('103', 200)
),
base_keys AS (
    SELECT
        shipment_id,
        COUNT(*) AS base_rows,
        COUNT_IF(shipment_id IS NULL OR TRIM(shipment_id) = '') AS invalid_base_keys,
        COUNT_IF(net_charge IS NULL) AS null_base_amounts,
        SUM(net_charge) AS base_amount
    FROM base_data
    GROUP BY shipment_id
),
joined_keys AS (
    SELECT
        shipment_id,
        COUNT(*) AS joined_rows,
        COUNT_IF(shipment_id IS NULL OR TRIM(shipment_id) = '') AS invalid_joined_keys,
        COUNT_IF(net_charge IS NULL) AS null_joined_amounts,
        SUM(net_charge) AS joined_amount
    FROM joined_data
    GROUP BY shipment_id
)
SELECT
    COALESCE(b.shipment_id, j.shipment_id) AS shipment_id,
    COALESCE(b.base_rows, 0) AS rows_before,
    COALESCE(j.joined_rows, 0) AS rows_after,
    b.base_amount AS amount_before,
    j.joined_amount AS amount_after,
    CASE
        WHEN COALESCE(b.null_base_amounts, 0) > 0
          OR COALESCE(j.null_joined_amounts, 0) > 0 THEN NULL
        ELSE COALESCE(j.joined_amount, 0) - COALESCE(b.base_amount, 0)
    END AS amount_difference,
    COALESCE(b.invalid_base_keys, 0) + COALESCE(j.invalid_joined_keys, 0)
        AS invalid_key_rows,
    COALESCE(b.null_base_amounts, 0) + COALESCE(j.null_joined_amounts, 0)
        AS null_amount_rows,
    COALESCE(b.base_rows > 1, FALSE) AS repeated_baseline_key,
    b.base_rows IS NOT NULL AND j.joined_rows IS NULL AS missing_after,
    b.base_rows IS NULL AND j.joined_rows IS NOT NULL AS new_after,
    COALESCE(j.joined_rows > b.base_rows, FALSE) AS more_rows_after
FROM base_keys b
FULL OUTER JOIN joined_keys j
    ON b.shipment_id = j.shipment_id
ORDER BY shipment_id;

-- Investigate invalid keys, null amounts and repeated baseline keys first.
-- SUM ignores nulls in SQL; do not treat partial sums as reconciled amounts.
-- A missing side has no amount: the difference uses zero only for absence.
-- Repeated baseline keys mean the selected grain has not been established.
-- Empty results on both sides produce no rows here, not a successful check.
-- Inspect per-key changes even if the grand-total difference is zero.
-- This cannot detect changes to unselected columns or explain their cause.
