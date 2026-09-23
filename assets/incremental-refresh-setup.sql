-- Personal, synthetic Snowflake -> Power BI Import rehearsal. Read the .txt first.
-- Manually provision/select a PERSONAL DISPOSABLE database/schema and an existing
-- warehouse/role with appropriate access. Replace ALL YOUR_* placeholders here
-- and in the changes script / M query. This script creates no roles or grants.
-- Warehouse queries and storage can incur charges.
-- Run statements in order; STOP on any error. Existing objects cause CREATE to
-- fail, not overwrite. CTAS seeds only a newly created table, never an old one.
-- DDL is not an all-or-nothing transaction: if view creation fails, inspect the
-- partial setup. Use a fresh disposable schema rather than blindly rerunning.

USE WAREHOUSE YOUR_EXISTING_WAREHOUSE;
USE DATABASE YOUR_SANDBOX_DB;
USE SCHEMA YOUR_SANDBOX_DB.YOUR_DISPOSABLE_SCHEMA;

-- Default: preserve the fixed September illustration exactly.
-- Optional live rehearsal: replace this literal with today's UTC date, then
-- copy that SAME literal to the changes script. Do not recalculate it later.
-- Discover today's UTC date with:
-- SELECT TO_DATE(CONVERT_TIMEZONE('UTC', CURRENT_TIMESTAMP()));
SET IR_DEMO_TODAY = TO_DATE('2026-09-24', 'YYYY-MM-DD');
SET IR_DAY_SHIFT = DATEDIFF('day', TO_DATE('2026-09-24', 'YYYY-MM-DD'), $IR_DEMO_TODAY);
SELECT $IR_DEMO_TODAY AS DEMO_ANCHOR, $IR_DAY_SHIFT AS DAY_SHIFT,
       CURRENT_DATABASE() AS SANDBOX_DATABASE, CURRENT_SCHEMA() AS SANDBOX_SCHEMA;

-- Grain: one row per SHIPMENT_ID. Charges are USD, not mixed currencies.
-- TIMESTAMP_NTZ stores no timezone: midnight is UTC BY CONVENTION, not an
-- automatic timezone conversion. RangeStart/RangeEnd must use that convention.
CREATE TABLE YOUR_SANDBOX_DB.YOUR_DISPOSABLE_SCHEMA.IR_PORTFOLIO_20260924_SHIPMENTS (
    SHIPMENT_ID VARCHAR(20),
    SHIPPED_AT TIMESTAMP_NTZ,
    CHARGE_USD NUMBER(12, 2),
    UPDATED_AT TIMESTAMP_NTZ
) AS
SELECT COLUMN1,
       DATEADD('day', $IR_DAY_SHIFT,
           TO_TIMESTAMP_NTZ(COLUMN2, 'YYYY-MM-DD HH24:MI:SS')),
       COLUMN3,
       DATEADD('day', $IR_DAY_SHIFT,
           TO_TIMESTAMP_NTZ(COLUMN2, 'YYYY-MM-DD HH24:MI:SS'))
FROM VALUES
    ('S1001', '2026-05-12 00:00:00', 100.00),
    ('S1002', '2026-07-20 00:00:00', 200.00),
    ('S1003', '2026-08-10 00:00:00', 300.00),
    ('S1004', '2026-09-01 00:00:00', 400.00),
    ('S1005', '2026-09-21 00:00:00', 500.00),
    ('S1006', '2026-09-22 00:00:00', 600.00);

-- No casts, derived dates, joins, or aggregation on the source timestamp.
CREATE VIEW YOUR_SANDBOX_DB.YOUR_DISPOSABLE_SCHEMA.IR_PORTFOLIO_20260924_REPORTING AS
SELECT SHIPMENT_ID, SHIPPED_AT, CHARGE_USD, UPDATED_AT
FROM YOUR_SANDBOX_DB.YOUR_DISPOSABLE_SCHEMA.IR_PORTFOLIO_20260924_SHIPMENTS;

-- Inspect the actual rows; with the default anchor these are the six dates above.
SELECT SHIPMENT_ID, SHIPPED_AT, CHARGE_USD, UPDATED_AT
FROM YOUR_SANDBOX_DB.YOUR_DISPOSABLE_SCHEMA.IR_PORTFOLIO_20260924_REPORTING
ORDER BY SHIPMENT_ID;

-- Expected: 6 rows, 6 unique keys, 0 duplicate/non-null-key excess,
-- 0 null keys/dates, 0 non-midnight dates, 0 initial audit mismatches, USD 2100.
-- No unenforced PRIMARY KEY declaration is being treated as a uniqueness test.
SELECT COUNT(*) AS ROW_COUNT,
       COUNT(DISTINCT SHIPMENT_ID) AS UNIQUE_KEYS,
       COUNT(SHIPMENT_ID) - COUNT(DISTINCT SHIPMENT_ID) AS DUPLICATE_KEY_EXCESS,
       COUNT(*) - COUNT(SHIPMENT_ID) AS NULL_KEYS,
       COUNT(*) - COUNT(SHIPPED_AT) AS NULL_SHIPPED_AT,
       COUNT(*) - COUNT(UPDATED_AT) AS NULL_UPDATED_AT,
       SUM(IFF(SHIPPED_AT <> DATE_TRUNC('day', SHIPPED_AT)
            OR UPDATED_AT <> DATE_TRUNC('day', UPDATED_AT), 1, 0)) AS NON_MIDNIGHT_DATES,
       SUM(IFF(UPDATED_AT <> SHIPPED_AT, 1, 0)) AS INITIAL_AUDIT_MISMATCHES,
       SUM(CHARGE_USD) AS TOTAL_USD
FROM YOUR_SANDBOX_DB.YOUR_DISPOSABLE_SCHEMA.IR_PORTFOLIO_20260924_REPORTING;

-- Local bounded-filter check: S1005 and S1006, USD 1100.
-- This is an illustrative interval, NOT a service policy execution.
SELECT SHIPMENT_ID, SHIPPED_AT, CHARGE_USD
FROM YOUR_SANDBOX_DB.YOUR_DISPOSABLE_SCHEMA.IR_PORTFOLIO_20260924_REPORTING
WHERE SHIPPED_AT >= DATEADD('day', $IR_DAY_SHIFT,
          TO_TIMESTAMP_NTZ('2026-09-21 00:00:00', 'YYYY-MM-DD HH24:MI:SS'))
  AND SHIPPED_AT < DATEADD('day', $IR_DAY_SHIFT,
          TO_TIMESTAMP_NTZ('2026-09-24 00:00:00', 'YYYY-MM-DD HH24:MI:SS'))
ORDER BY SHIPMENT_ID;
