ALTER TABLE src20_markets ADD COLUMN IF NOT EXISTS creation_block_hash TEXT;
ALTER TABLE market_orders ADD COLUMN IF NOT EXISTS block_hash TEXT;
ALTER TABLE market_order_fills ADD COLUMN IF NOT EXISTS block_hash TEXT;
ALTER TABLE market_order_cancellations ADD COLUMN IF NOT EXISTS block_hash TEXT;

UPDATE src20_markets m
SET creation_block_hash=b.block_hash
FROM chain_blocks b
WHERE m.chain_id=b.chain_id
  AND m.creation_block=b.block_number
  AND b.canonical
  AND m.source='factory'
  AND m.creation_block_hash IS NULL;

UPDATE market_orders m
SET block_hash=b.block_hash
FROM chain_blocks b
WHERE m.chain_id=b.chain_id
  AND m.block_number=b.block_number
  AND b.canonical
  AND m.block_hash IS NULL;

UPDATE market_order_fills m
SET block_hash=b.block_hash
FROM chain_blocks b
WHERE m.chain_id=b.chain_id
  AND m.block_number=b.block_number
  AND b.canonical
  AND m.block_hash IS NULL;

UPDATE market_order_cancellations m
SET block_hash=b.block_hash
FROM chain_blocks b
WHERE m.chain_id=b.chain_id
  AND m.block_number=b.block_number
  AND b.canonical
  AND m.block_hash IS NULL;
