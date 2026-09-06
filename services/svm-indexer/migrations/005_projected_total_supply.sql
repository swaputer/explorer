UPDATE src20_tokens t
SET total_supply=COALESCE((
  SELECT sum(b.balance)
  FROM src20_balances b
  WHERE b.chain_id=t.chain_id
    AND b.world_id=t.world_id
    AND b.token_id=t.program_id
),0);

ALTER TABLE src20_tokens ALTER COLUMN total_supply SET DEFAULT 0;
ALTER TABLE src20_tokens ALTER COLUMN total_supply SET NOT NULL;
