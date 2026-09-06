CREATE TABLE IF NOT EXISTS src20_tokens (
    chain_id BIGINT NOT NULL,
    world_id TEXT NOT NULL,
    program_id TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    creator TEXT NOT NULL,
    deployment_execution_id BIGINT NOT NULL REFERENCES svm_executions(id) ON DELETE CASCADE,
    deployment_block BIGINT NOT NULL,
    name TEXT,
    symbol TEXT,
    decimals INTEGER,
    cap NUMERIC(78, 0),
    mint_amount NUMERIC(78, 0),
    total_supply NUMERIC(78, 0),
    metadata_status TEXT NOT NULL DEFAULT 'pending' CHECK (metadata_status IN ('pending', 'loaded', 'failed')),
    metadata_updated_at TIMESTAMPTZ,
    canonical BOOLEAN NOT NULL,
    finalized BOOLEAN NOT NULL,
    PRIMARY KEY (chain_id, world_id, program_id)
);

CREATE INDEX IF NOT EXISTS src20_tokens_list
    ON src20_tokens(chain_id, world_id, canonical, deployment_block DESC);

CREATE TABLE IF NOT EXISTS src20_transfers (
    execution_id BIGINT NOT NULL,
    event_index INTEGER NOT NULL,
    chain_id BIGINT NOT NULL,
    world_id TEXT NOT NULL,
    token_id TEXT NOT NULL,
    block_number BIGINT NOT NULL,
    transaction_hash TEXT NOT NULL,
    sender_account TEXT NOT NULL,
    recipient_account TEXT NOT NULL,
    amount NUMERIC(78, 0) NOT NULL,
    mint BOOLEAN NOT NULL,
    burn BOOLEAN NOT NULL,
    canonical BOOLEAN NOT NULL,
    finalized BOOLEAN NOT NULL,
    PRIMARY KEY (execution_id, event_index),
    FOREIGN KEY (execution_id, event_index) REFERENCES svm_events(execution_id, event_index) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS src20_transfers_token
    ON src20_transfers(chain_id, world_id, token_id, canonical, block_number DESC, execution_id DESC);
CREATE INDEX IF NOT EXISTS src20_transfers_sender
    ON src20_transfers(chain_id, world_id, sender_account, canonical, block_number DESC);
CREATE INDEX IF NOT EXISTS src20_transfers_recipient
    ON src20_transfers(chain_id, world_id, recipient_account, canonical, block_number DESC);

CREATE TABLE IF NOT EXISTS src20_balance_deltas (
    execution_id BIGINT NOT NULL,
    event_index INTEGER NOT NULL,
    direction SMALLINT NOT NULL CHECK (direction IN (-1, 1)),
    chain_id BIGINT NOT NULL,
    world_id TEXT NOT NULL,
    token_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    delta NUMERIC(78, 0) NOT NULL,
    block_number BIGINT NOT NULL,
    canonical BOOLEAN NOT NULL,
    finalized BOOLEAN NOT NULL,
    PRIMARY KEY (execution_id, event_index, direction),
    FOREIGN KEY (execution_id, event_index) REFERENCES src20_transfers(execution_id, event_index) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS src20_balance_deltas_account
    ON src20_balance_deltas(chain_id, world_id, account_id, token_id, canonical);
CREATE INDEX IF NOT EXISTS src20_balance_deltas_token
    ON src20_balance_deltas(chain_id, world_id, token_id, account_id, canonical);

CREATE OR REPLACE VIEW src20_balances AS
SELECT chain_id, world_id, token_id, account_id, sum(delta)::NUMERIC(78, 0) AS balance
FROM src20_balance_deltas
WHERE canonical
GROUP BY chain_id, world_id, token_id, account_id
HAVING sum(delta) <> 0;
