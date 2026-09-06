CREATE TABLE IF NOT EXISTS src20_markets (
    chain_id BIGINT NOT NULL,
    world_id TEXT NOT NULL,
    token_id TEXT NOT NULL,
    market_address TEXT NOT NULL,
    escrow_id TEXT NOT NULL,
    token_code_hash TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('factory', 'configured')),
    creation_block BIGINT NOT NULL,
    creation_transaction_hash TEXT,
    creation_log_index INTEGER,
    canonical BOOLEAN NOT NULL,
    finalized BOOLEAN NOT NULL,
    PRIMARY KEY (chain_id, world_id, token_id),
    UNIQUE (chain_id, market_address)
);

CREATE INDEX IF NOT EXISTS src20_markets_address
    ON src20_markets(chain_id, market_address, canonical);

CREATE TABLE IF NOT EXISTS market_orders (
    chain_id BIGINT NOT NULL,
    world_id TEXT NOT NULL,
    market_address TEXT NOT NULL,
    token_id TEXT NOT NULL,
    order_id NUMERIC(78, 0) NOT NULL,
    side SMALLINT NOT NULL CHECK (side IN (0, 1)),
    maker TEXT NOT NULL,
    amount NUMERIC(78, 0) NOT NULL,
    unit_price_wei NUMERIC(78, 0) NOT NULL,
    price_wei NUMERIC(78, 0) NOT NULL,
    vm_eth_amount NUMERIC(78, 0) NOT NULL,
    expiry BIGINT NOT NULL,
    block_number BIGINT NOT NULL,
    transaction_hash TEXT NOT NULL,
    ethereum_log_index INTEGER NOT NULL,
    canonical BOOLEAN NOT NULL,
    finalized BOOLEAN NOT NULL,
    PRIMARY KEY (chain_id, market_address, order_id)
);

CREATE INDEX IF NOT EXISTS market_orders_token
    ON market_orders(chain_id, world_id, token_id, canonical, block_number DESC);
CREATE INDEX IF NOT EXISTS market_orders_maker
    ON market_orders(chain_id, maker, canonical, block_number DESC);

CREATE TABLE IF NOT EXISTS market_order_fills (
    chain_id BIGINT NOT NULL,
    market_address TEXT NOT NULL,
    order_id NUMERIC(78, 0) NOT NULL,
    seller TEXT NOT NULL,
    buyer TEXT NOT NULL,
    amount NUMERIC(78, 0) NOT NULL,
    price_wei NUMERIC(78, 0) NOT NULL,
    vm_eth_spent NUMERIC(78, 0) NOT NULL,
    block_number BIGINT NOT NULL,
    transaction_hash TEXT NOT NULL,
    ethereum_log_index INTEGER NOT NULL,
    canonical BOOLEAN NOT NULL,
    finalized BOOLEAN NOT NULL,
    PRIMARY KEY (chain_id, market_address, order_id)
);

CREATE INDEX IF NOT EXISTS market_fills_recent
    ON market_order_fills(chain_id, canonical, block_number DESC, ethereum_log_index DESC);

CREATE TABLE IF NOT EXISTS market_order_cancellations (
    chain_id BIGINT NOT NULL,
    market_address TEXT NOT NULL,
    order_id NUMERIC(78, 0) NOT NULL,
    maker TEXT NOT NULL,
    block_number BIGINT NOT NULL,
    transaction_hash TEXT NOT NULL,
    ethereum_log_index INTEGER NOT NULL,
    canonical BOOLEAN NOT NULL,
    finalized BOOLEAN NOT NULL,
    PRIMARY KEY (chain_id, market_address, order_id)
);

CREATE INDEX IF NOT EXISTS market_cancellations_block
    ON market_order_cancellations(chain_id, canonical, block_number DESC);
