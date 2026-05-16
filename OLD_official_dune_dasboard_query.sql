-- ================================================================
-- LEGACY — this query is no longer authoritative.
--
-- The canonical CAT-21 rarity / category model lives in
--   ordpool-parser/CAT21-RARITY-SCORE.md
-- The legacy Dune dashboard (https://dune.com/ethspresso/cat21) that
-- this query backs is stale on several points (e.g. it treats
-- 'genesis' as a category value, which it isn't — genesis is a
-- separate trait). An updated v2 dashboard is in progress.
--
-- This file is kept for historical reference. Do not reference it
-- from new docs or code.
-- ================================================================

SELECT
  ROW_NUMBER() OVER (ORDER BY block_height, index) - 1 AS cat_number,
  CASE
    WHEN ROW_NUMBER() OVER (ORDER BY block_height, index) - 1 < 1000
    THEN 'sub1k'
    WHEN ROW_NUMBER() OVER (ORDER BY block_height, index) - 1 < 10000
    THEN 'sub10k'
    WHEN ROW_NUMBER() OVER (ORDER BY block_height, index) - 1 < 50000
    THEN 'sub50k'
    WHEN ROW_NUMBER() OVER (ORDER BY block_height, index) - 1 < 100000
    THEN 'sub100k'
    WHEN ROW_NUMBER() OVER (ORDER BY block_height, index) - 1 < 250000
    THEN 'sub250k'
    WHEN ROW_NUMBER() OVER (ORDER BY block_height, index) - 1 < 500000
    THEN 'sub500k'
    WHEN ROW_NUMBER() OVER (ORDER BY block_height, index) - 1 < 1000000
    THEN 'sub1M'
    ELSE ''
  END AS category,
  block_time,
  block_height,
  CONCAT('https://ordpool.space/tx/', TRIM(LEADING '0x' FROM CAST(id AS VARCHAR))) AS cat_url,
  lock_time,
  CAST(100000000 * fee / virtual_size AS INTEGER) AS feeRate,
  output
FROM (
  SELECT
    block_time,
    block_height,
    index,
    block_hash,
    id,
    lock_time,
    fee,
    virtual_size,
    output
  FROM bitcoin.transactions
  WHERE
    block_time >= TIMESTAMP '2024-01-01 00:00:00'
    AND lock_time = 21
  ORDER BY
    block_height,
    index
) AS subquery
ORDER BY
  cat_number DESC
