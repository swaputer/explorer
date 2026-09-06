CREATE TABLE IF NOT EXISTS chain_blocks (
    chain_id BIGINT NOT NULL,
    block_number BIGINT NOT NULL,
    block_hash TEXT NOT NULL,
    parent_hash TEXT NOT NULL,
    block_time TIMESTAMPTZ NOT NULL,
    canonical BOOLEAN NOT NULL,
    finalized BOOLEAN NOT NULL,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    orphaned_at TIMESTAMPTZ,
    PRIMARY KEY (chain_id, block_hash)
);

CREATE UNIQUE INDEX IF NOT EXISTS chain_blocks_one_canonical_height
    ON chain_blocks(chain_id, block_number) WHERE canonical;
CREATE INDEX IF NOT EXISTS chain_blocks_canonical_order
    ON chain_blocks(chain_id, canonical, block_number DESC);

CREATE TABLE IF NOT EXISTS chain_transactions (
    id BIGSERIAL PRIMARY KEY,
    chain_id BIGINT NOT NULL,
    block_number BIGINT NOT NULL,
    block_hash TEXT NOT NULL,
    transaction_hash TEXT NOT NULL,
    transaction_index INTEGER NOT NULL,
    sender TEXT NOT NULL,
    recipient TEXT,
    nonce BIGINT NOT NULL,
    value_wei NUMERIC(78, 0) NOT NULL,
    input BYTEA NOT NULL,
    status SMALLINT NOT NULL,
    gas_used NUMERIC(78, 0) NOT NULL,
    canonical BOOLEAN NOT NULL,
    finalized BOOLEAN NOT NULL,
    indexed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (chain_id, block_hash) REFERENCES chain_blocks(chain_id, block_hash),
    UNIQUE (chain_id, block_hash, transaction_hash)
);

CREATE INDEX IF NOT EXISTS chain_transactions_hash
    ON chain_transactions(chain_id, transaction_hash, canonical);
CREATE INDEX IF NOT EXISTS chain_transactions_sender
    ON chain_transactions(chain_id, sender, canonical, block_number DESC, transaction_index DESC);

CREATE TABLE IF NOT EXISTS svm_executions (
    id BIGSERIAL PRIMARY KEY,
    transaction_id BIGINT NOT NULL REFERENCES chain_transactions(id) ON DELETE CASCADE,
    chain_id BIGINT NOT NULL,
    kernel_address TEXT NOT NULL,
    block_number BIGINT NOT NULL,
    block_hash TEXT NOT NULL,
    transaction_hash TEXT NOT NULL,
    ethereum_log_index INTEGER NOT NULL,
    world_id TEXT NOT NULL,
    execution_height BIGINT NOT NULL,
    actor TEXT NOT NULL,
    root_target TEXT NOT NULL,
    executed_bytes BIGINT NOT NULL,
    token_burned NUMERIC(78, 0) NOT NULL,
    gross_token_out NUMERIC(78, 0) NOT NULL,
    net_token_out NUMERIC(78, 0) NOT NULL,
    raw_log_data BYTEA NOT NULL,
    raw_receipt_payload BYTEA NOT NULL,
    receipt_version SMALLINT NOT NULL,
    receipt_flags SMALLINT NOT NULL,
    canonical BOOLEAN NOT NULL,
    finalized BOOLEAN NOT NULL,
    indexed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (chain_id, kernel_address, block_hash, transaction_hash, ethereum_log_index)
);

CREATE UNIQUE INDEX IF NOT EXISTS svm_executions_one_canonical_height
    ON svm_executions(chain_id, kernel_address, world_id, execution_height) WHERE canonical;
CREATE INDEX IF NOT EXISTS svm_executions_actor
    ON svm_executions(chain_id, world_id, actor, canonical, block_number DESC, ethereum_log_index DESC);
CREATE INDEX IF NOT EXISTS svm_executions_transaction
    ON svm_executions(chain_id, transaction_hash, canonical);

CREATE TABLE IF NOT EXISTS svm_events (
    execution_id BIGINT NOT NULL REFERENCES svm_executions(id) ON DELETE CASCADE,
    event_index INTEGER NOT NULL CHECK (event_index >= 0 AND event_index < 64),
    emitter TEXT NOT NULL,
    topic_count SMALLINT NOT NULL CHECK (topic_count >= 0 AND topic_count <= 4),
    topic0 TEXT,
    topic1 TEXT,
    topic2 TEXT,
    topic3 TEXT,
    raw_data BYTEA NOT NULL,
    record_kind TEXT NOT NULL CHECK (record_kind IN ('application', 'world_execution', 'mini_contract_deployed')),
    canonical BOOLEAN NOT NULL,
    finalized BOOLEAN NOT NULL,
    PRIMARY KEY (execution_id, event_index)
);

CREATE INDEX IF NOT EXISTS svm_events_emitter
    ON svm_events(emitter, canonical, execution_id DESC);
CREATE INDEX IF NOT EXISTS svm_events_topic0
    ON svm_events(topic0, canonical, execution_id DESC);

CREATE TABLE IF NOT EXISTS svm_deployments (
    id BIGSERIAL PRIMARY KEY,
    execution_id BIGINT NOT NULL,
    event_index INTEGER NOT NULL,
    chain_id BIGINT NOT NULL,
    kernel_address TEXT NOT NULL,
    world_id TEXT NOT NULL,
    program_id TEXT NOT NULL,
    creator TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    canonical BOOLEAN NOT NULL,
    finalized BOOLEAN NOT NULL,
    FOREIGN KEY (execution_id, event_index) REFERENCES svm_events(execution_id, event_index) ON DELETE CASCADE,
    UNIQUE (execution_id, event_index)
);

CREATE UNIQUE INDEX IF NOT EXISTS svm_deployments_one_canonical_program
    ON svm_deployments(chain_id, kernel_address, world_id, program_id) WHERE canonical;
CREATE INDEX IF NOT EXISTS svm_deployments_creator
    ON svm_deployments(chain_id, world_id, creator, canonical);

CREATE TABLE IF NOT EXISTS indexer_checkpoints (
    chain_id BIGINT NOT NULL,
    kernel_address TEXT NOT NULL,
    world_id TEXT NOT NULL,
    start_block BIGINT NOT NULL,
    next_block BIGINT NOT NULL,
    last_scanned_block_number BIGINT,
    last_scanned_block_hash TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (chain_id, kernel_address, world_id)
);

CREATE TABLE IF NOT EXISTS indexer_errors (
    id BIGSERIAL PRIMARY KEY,
    chain_id BIGINT NOT NULL,
    kernel_address TEXT NOT NULL,
    block_number BIGINT,
    block_hash TEXT,
    transaction_hash TEXT,
    ethereum_log_index INTEGER,
    category TEXT NOT NULL,
    error_code TEXT NOT NULL,
    error_details JSONB NOT NULL DEFAULT '{}'::jsonb,
    raw_log JSONB,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    occurrences BIGINT NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS indexer_errors_identity
    ON indexer_errors(
        chain_id,
        kernel_address,
        COALESCE(block_hash, ''),
        COALESCE(transaction_hash, ''),
        COALESCE(ethereum_log_index, -1),
        error_code
    );
