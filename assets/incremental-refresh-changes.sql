-- Run ONLY after setup and the baseline Desktop/service refresh.
-- Personal disposable schema only; warehouse use can incur charges.
-- Replace ALL YOUR_* placeholders with the SAME values as setup.
-- Use the EXACT SAME anchor literal as setup, even in a new worksheet/session.
-- Stop on errors. This changes only the dedicated demo table, not production.
USE WAREHOUSE YOUR_EXISTING_WAREHOUSE;
USE DATABASE YOUR_SANDBOX_DB;
USE SCHEMA YOUR_SANDBOX_DB.YOUR_DISPOSABLE_SCHEMA;

SET IR_DEMO_TODAY = TO_DATE('2026-09-24', 'YYYY-MM-DD');
SET IR_DAY_SHIFT = DATEDIFF('day', TO_DATE('2026-09-24', 'YYYY-MM-DD'), $IR_DEMO_TODAY);
SELECT $IR_DEMO_TODAY AS DEMO_ANCHOR, $IR_DAY_SHIFT AS DAY_SHIFT;

-- Deterministic absolute amounts, never charge + delta.
-- Repeating this MERGE has the same resulting data as running it once.
-- Existing SHIPPED_AT partition keys stay untouched; UPDATED_AT is audit only.
-- Missing S1001/S1005 are not silently recreated: the checks expose bad setup.
MERGE INTO YOUR_SANDBOX_DB.YOUR_DISPOSABLE_SCHEMA.IR_PORTFOLIO_20260924_SHIPMENTS AS target
USING (
    SELECT COLUMN1 AS SHIPMENT_ID,
           DATEADD('day', $IR_DAY_SHIFT,
               TO_TIMESTAMP_NTZ(COLUMN2, 'YYYY-MM-DD HH24:MI:SS')) AS SHIPPED_AT,
           COLUMN3 AS CHARGE_USD,
           DATEADD('day', $IR_DAY_SHIFT,
               TO_TIMESTAMP_NTZ('2026-09-23 00:00:00', 'YYYY-MM-DD HH24:MI:SS')) AS UPDATED_AT
    FROM VALUES
        ('S1005', '2026-09-21 00:00:00', 550.00),
        ('S1001', '2026-05-12 00:00:00', 180.00),
        ('S1007', '2026-09-23 00:00:00', 700.00)
) AS source
ON target.SHIPMENT_ID = source.SHIPMENT_ID
WHEN MATCHED THEN UPDATE SET
    target.CHARGE_USD = source.CHARGE_USD,
    target.UPDATED_AT = source.UPDATED_AT
WHEN NOT MATCHED AND source.SHIPMENT_ID = 'S1007' THEN INSERT
    (SHIPMENT_ID, SHIPPED_AT, CHARGE_USD, UPDATED_AT)
VALUES
    (source.SHIPMENT_ID, source.SHIPPED_AT, source.CHARGE_USD, source.UPDATED_AT);

-- Expected: 7 rows, 7 unique keys, zeros for all defect counts, USD 2930.
SELECT COUNT(*) AS ROW_COUNT,
       COUNT(DISTINCT SHIPMENT_ID) AS UNIQUE_KEYS,
       COUNT(SHIPMENT_ID) - COUNT(DISTINCT SHIPMENT_ID) AS DUPLICATE_KEY_EXCESS,
       COUNT(*) - COUNT(SHIPMENT_ID) AS NULL_KEYS,
       COUNT(*) - COUNT(SHIPPED_AT) AS NULL_SHIPPED_AT,
       COUNT(*) - COUNT(UPDATED_AT) AS NULL_UPDATED_AT,
       SUM(IFF(SHIPPED_AT <> DATE_TRUNC('day', SHIPPED_AT)
            OR UPDATED_AT <> DATE_TRUNC('day', UPDATED_AT), 1, 0)) AS NON_MIDNIGHT_DATES,
       SUM(CHARGE_USD) AS TOTAL_USD
FROM YOUR_SANDBOX_DB.YOUR_DISPOSABLE_SCHEMA.IR_PORTFOLIO_20260924_REPORTING;

SELECT SHIPMENT_ID, SHIPPED_AT, CHARGE_USD, UPDATED_AT
FROM YOUR_SANDBOX_DB.YOUR_DISPOSABLE_SCHEMA.IR_PORTFOLIO_20260924_REPORTING
ORDER BY SHIPMENT_ID;

-- Expected: S1005=550, S1006=600, S1007=700; USD 1850 in this interval.
-- The S1001 correction is outside it even though UPDATED_AT is September 23.
SELECT SHIPMENT_ID, SHIPPED_AT, CHARGE_USD, UPDATED_AT
FROM YOUR_SANDBOX_DB.YOUR_DISPOSABLE_SCHEMA.IR_PORTFOLIO_20260924_REPORTING
WHERE SHIPPED_AT >= DATEADD('day', $IR_DAY_SHIFT,
          TO_TIMESTAMP_NTZ('2026-09-21 00:00:00', 'YYYY-MM-DD HH24:MI:SS'))
  AND SHIPPED_AT < DATEADD('day', $IR_DAY_SHIFT,
          TO_TIMESTAMP_NTZ('2026-09-24 00:00:00', 'YYYY-MM-DD HH24:MI:SS'))
ORDER BY SHIPMENT_ID;
