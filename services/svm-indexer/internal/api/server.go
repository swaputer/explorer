package api

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/jackc/pgx/v5"

	"github.com/swaputer/explorer/services/svm-indexer/internal/config"
	"github.com/swaputer/explorer/services/svm-indexer/internal/indexer"
	"github.com/swaputer/explorer/services/svm-indexer/internal/realtime"
	"github.com/swaputer/explorer/services/svm-indexer/internal/store"
)

type Server struct {
	store           *store.Store
	allowedOrigins  map[string]struct{}
	indexer         *indexer.Indexer
	readinessMaxLag uint64
	readinessMaxAge time.Duration
}

func New(database *store.Store, hub *realtime.Hub, cfg config.Config, scanner *indexer.Indexer) http.Handler {
	readinessMaxAge := 3 * cfg.ReconcileInterval
	wsOutageMaxAge := 60*time.Second + cfg.RPCRequestTimeout
	if readinessMaxAge < wsOutageMaxAge {
		readinessMaxAge = wsOutageMaxAge
	}
	server := &Server{
		store: database, indexer: scanner, readinessMaxLag: cfg.ReadinessMaxLag,
		readinessMaxAge: readinessMaxAge, allowedOrigins: make(map[string]struct{}, len(cfg.AllowedOrigins)),
	}
	for _, origin := range cfg.AllowedOrigins {
		server.allowedOrigins[origin] = struct{}{}
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", server.health)
	mux.HandleFunc("GET /readyz", server.readiness)
	mux.HandleFunc("GET /metrics", server.metrics)
	mux.HandleFunc("GET /v1/status", server.status)
	mux.HandleFunc("GET /v1/search", server.search)
	mux.HandleFunc("GET /v1/transactions", server.transactions)
	mux.HandleFunc("GET /v1/transactions/{hash}", server.transaction)
	mux.HandleFunc("GET /v1/events", server.events)
	mux.HandleFunc("GET /v1/addresses/{address}", server.address)
	mux.HandleFunc("GET /v1/addresses/{address}/transactions", server.addressTransactions)
	mux.HandleFunc("GET /v1/contracts", server.contracts)
	mux.HandleFunc("GET /v1/contracts/{program}/transactions", server.contractTransactions)
	mux.HandleFunc("GET /v1/contracts/{program}", server.contract)
	mux.HandleFunc("GET /v1/src20", server.tokens)
	mux.HandleFunc("GET /v1/src20/{program}", server.token)
	mux.HandleFunc("GET /v1/src20/{program}/holders", server.tokenHolders)
	mux.HandleFunc("GET /v1/src20/{program}/transfers", server.tokenTransfers)
	mux.HandleFunc("GET /v1/minter/src20", server.openMintTokens)
	mux.HandleFunc("GET /v1/minter/src20/{program}", server.openMintToken)
	mux.Handle("GET /v1/ws", hub)
	return server.middleware(mux)
}

type readinessResult struct {
	Ready        bool      `json:"-"`
	Status       string    `json:"status"`
	Reason       string    `json:"reason,omitempty"`
	ObservedHead uint64    `json:"observedHead"`
	CanonicalTip uint64    `json:"canonicalTip"`
	LagBlocks    uint64    `json:"lagBlocks"`
	LastSync     time.Time `json:"lastSync"`
	WSConnected  bool      `json:"wsConnected"`
}

func evaluateReadiness(database store.Status, runtime indexer.RuntimeStatus, maxLag uint64, maxAge time.Duration, now time.Time) readinessResult {
	result := readinessResult{
		Status: "not_ready", ObservedHead: runtime.ObservedHead, LastSync: runtime.LastSync,
		WSConnected: runtime.WSConnected,
	}
	if database.CanonicalTip != nil {
		result.CanonicalTip = *database.CanonicalTip
	}
	if !runtime.Initialized || database.CanonicalTip == nil {
		result.Reason = "INITIAL_SYNC_PENDING"
		return result
	}
	if runtime.ObservedHead < *database.CanonicalTip {
		result.Reason = "CHAIN_HEAD_INCONSISTENT"
		return result
	}
	result.LagBlocks = runtime.ObservedHead - *database.CanonicalTip
	if result.LagBlocks > maxLag {
		result.Reason = "INDEXER_LAGGING"
		return result
	}
	if runtime.LastSync.IsZero() || now.Sub(runtime.LastSync) > maxAge {
		result.Reason = "INDEXER_STALE"
		return result
	}
	result.Ready = true
	result.Status = "ready"
	return result
}

func (s *Server) readiness(writer http.ResponseWriter, request *http.Request) {
	database, err := s.store.Status(request.Context())
	if err != nil {
		writeJSON(writer, http.StatusServiceUnavailable, readinessResult{Status: "not_ready", Reason: "DATABASE_UNAVAILABLE"})
		return
	}
	result := evaluateReadiness(database, s.indexer.RuntimeStatus(), s.readinessMaxLag, s.readinessMaxAge, time.Now().UTC())
	statusCode := http.StatusOK
	if !result.Ready {
		statusCode = http.StatusServiceUnavailable
	}
	writeJSON(writer, statusCode, result)
}

func (s *Server) metrics(writer http.ResponseWriter, request *http.Request) {
	database, err := s.store.Status(request.Context())
	if err != nil {
		http.Error(writer, "metrics unavailable", http.StatusServiceUnavailable)
		return
	}
	runtime := s.indexer.RuntimeStatus()
	ready := evaluateReadiness(database, runtime, s.readinessMaxLag, s.readinessMaxAge, time.Now().UTC())
	canonicalTip := uint64(0)
	if database.CanonicalTip != nil {
		canonicalTip = *database.CanonicalTip
	}
	finalizedTip := uint64(0)
	if database.FinalizedTip != nil {
		finalizedTip = *database.FinalizedTip
	}
	lag := uint64(0)
	if runtime.ObservedHead >= canonicalTip {
		lag = runtime.ObservedHead - canonicalTip
	}
	boolean := func(value bool) int {
		if value {
			return 1
		}
		return 0
	}
	lastSyncUnix := int64(0)
	if !runtime.LastSync.IsZero() {
		lastSyncUnix = runtime.LastSync.Unix()
	}
	writer.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	fmt.Fprintf(writer, "# TYPE swaputer_indexer_up gauge\n")
	fmt.Fprintf(writer, "swaputer_indexer_up 1\n")
	fmt.Fprintf(writer, "# TYPE swaputer_indexer_ready gauge\n")
	fmt.Fprintf(writer, "swaputer_indexer_ready %d\n", boolean(ready.Ready))
	fmt.Fprintf(writer, "# TYPE swaputer_indexer_observed_head gauge\n")
	fmt.Fprintf(writer, "swaputer_indexer_observed_head %d\n", runtime.ObservedHead)
	fmt.Fprintf(writer, "# TYPE swaputer_indexer_canonical_tip gauge\n")
	fmt.Fprintf(writer, "swaputer_indexer_canonical_tip %d\n", canonicalTip)
	fmt.Fprintf(writer, "# TYPE swaputer_indexer_finalized_tip gauge\n")
	fmt.Fprintf(writer, "swaputer_indexer_finalized_tip %d\n", finalizedTip)
	fmt.Fprintf(writer, "# TYPE swaputer_indexer_lag_blocks gauge\n")
	fmt.Fprintf(writer, "swaputer_indexer_lag_blocks %d\n", lag)
	fmt.Fprintf(writer, "# TYPE swaputer_indexer_last_sync_timestamp_seconds gauge\n")
	fmt.Fprintf(writer, "swaputer_indexer_last_sync_timestamp_seconds %d\n", lastSyncUnix)
	fmt.Fprintf(writer, "# TYPE swaputer_indexer_ws_connected gauge\n")
	fmt.Fprintf(writer, "swaputer_indexer_ws_connected %d\n", boolean(runtime.WSConnected))
	fmt.Fprintf(writer, "# TYPE swaputer_indexer_ws_endpoint gauge\n")
	fmt.Fprintf(writer, "swaputer_indexer_ws_endpoint %d\n", runtime.WSEndpoint)
	fmt.Fprintf(writer, "# TYPE swaputer_indexer_ws_endpoint_count gauge\n")
	fmt.Fprintf(writer, "swaputer_indexer_ws_endpoint_count %d\n", runtime.WSEndpointCount)
	fmt.Fprintf(writer, "# TYPE swaputer_indexer_ws_reconnects_total counter\n")
	fmt.Fprintf(writer, "swaputer_indexer_ws_reconnects_total %d\n", runtime.WSReconnects)
	fmt.Fprintf(writer, "# TYPE swaputer_indexer_http_endpoint gauge\n")
	fmt.Fprintf(writer, "swaputer_indexer_http_endpoint %d\n", runtime.HTTPEndpoint)
	fmt.Fprintf(writer, "# TYPE swaputer_indexer_http_endpoint_count gauge\n")
	fmt.Fprintf(writer, "swaputer_indexer_http_endpoint_count %d\n", runtime.HTTPEndpointCount)
	fmt.Fprintf(writer, "# TYPE swaputer_indexer_http_failures_total counter\n")
	fmt.Fprintf(writer, "swaputer_indexer_http_failures_total %d\n", runtime.HTTPFailures)
	fmt.Fprintf(writer, "# TYPE swaputer_indexer_http_switches_total counter\n")
	fmt.Fprintf(writer, "swaputer_indexer_http_switches_total %d\n", runtime.HTTPSwitches)
	fmt.Fprintf(writer, "# TYPE swaputer_indexer_ingestion_errors_total gauge\n")
	fmt.Fprintf(writer, "swaputer_indexer_ingestion_errors_total %d\n", database.Errors)
}

func (s *Server) transactions(writer http.ResponseWriter, request *http.Request) {
	const cursorScope = "transactions"
	cursor, ok := transactionCursor(request.URL.Query().Get("cursor"), cursorScope)
	if !ok {
		writeError(writer, http.StatusBadRequest, "INVALID_CURSOR")
		return
	}
	limit := requestLimit(request)
	items, err := s.store.RecentTransactions(request.Context(), limit+1, cursor)
	if err != nil {
		writeError(writer, http.StatusServiceUnavailable, "TRANSACTIONS_UNAVAILABLE")
		return
	}
	nextCursor := ""
	if len(items) > limit {
		items = items[:limit]
		last := items[len(items)-1]
		nextCursor = encodeCursor(transactionPageCursor{Scope: cursorScope, BlockNumber: last.BlockNumber, LogIndex: last.LogIndex, ExecutionID: last.ExecutionID})
	}
	writeJSON(writer, http.StatusOK, map[string]any{"items": items, "nextCursor": nextCursor})
}

func (s *Server) events(writer http.ResponseWriter, request *http.Request) {
	items, err := s.store.LatestEvents(request.Context(), requestLimit(request))
	if err != nil {
		writeError(writer, http.StatusServiceUnavailable, "EVENTS_UNAVAILABLE")
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) search(writer http.ResponseWriter, request *http.Request) {
	query := strings.TrimSpace(request.URL.Query().Get("q"))
	if common.IsHexAddress(query) && len(query) == 42 {
		writeJSON(writer, http.StatusOK, map[string]string{"type": "address", "route": "/address/" + query})
		return
	}
	value, ok := parseHash(query)
	if !ok {
		writeError(writer, http.StatusBadRequest, "INVALID_SEARCH_QUERY")
		return
	}
	if _, err := s.store.Transaction(request.Context(), value); err == nil {
		writeJSON(writer, http.StatusOK, map[string]string{"type": "transaction", "route": "/tx/" + query})
		return
	}
	if _, err := s.store.Contract(request.Context(), value); err == nil {
		writeJSON(writer, http.StatusOK, map[string]string{"type": "contract", "route": "/contract/" + query})
		return
	}
	writeJSON(writer, http.StatusOK, map[string]string{"type": "address", "route": "/address/" + query})
}

func (s *Server) contracts(writer http.ResponseWriter, request *http.Request) {
	const cursorScope = "contracts"
	cursor, ok := contractCursor(request.URL.Query().Get("cursor"), cursorScope)
	if !ok {
		writeError(writer, http.StatusBadRequest, "INVALID_CURSOR")
		return
	}
	limit := requestLimit(request)
	items, err := s.store.ListContracts(request.Context(), limit+1, cursor)
	if err != nil {
		writeError(writer, http.StatusServiceUnavailable, "CONTRACTS_UNAVAILABLE")
		return
	}
	nextCursor := ""
	if len(items) > limit {
		items = items[:limit]
		last := items[len(items)-1]
		nextCursor = encodeCursor(contractPageCursor{Scope: cursorScope, BlockNumber: last.DeploymentBlock, LogIndex: last.LogIndex, ProgramID: last.ProgramID})
	}
	writeJSON(writer, http.StatusOK, map[string]any{"items": items, "nextCursor": nextCursor})
}

func (s *Server) contract(writer http.ResponseWriter, request *http.Request) {
	program, ok := parseHash(strings.TrimSpace(request.PathValue("program")))
	if !ok {
		writeError(writer, http.StatusBadRequest, "INVALID_CONTRACT_ID")
		return
	}
	item, err := s.store.Contract(request.Context(), program)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(writer, http.StatusNotFound, "CONTRACT_NOT_FOUND")
		return
	}
	if err != nil {
		writeError(writer, http.StatusServiceUnavailable, "CONTRACT_UNAVAILABLE")
		return
	}
	writeJSON(writer, http.StatusOK, item)
}

func (s *Server) contractTransactions(writer http.ResponseWriter, request *http.Request) {
	program, ok := parseHash(strings.TrimSpace(request.PathValue("program")))
	if !ok {
		writeError(writer, http.StatusBadRequest, "INVALID_CONTRACT_ID")
		return
	}
	if _, err := s.store.Contract(request.Context(), program); errors.Is(err, pgx.ErrNoRows) {
		writeError(writer, http.StatusNotFound, "CONTRACT_NOT_FOUND")
		return
	} else if err != nil {
		writeError(writer, http.StatusServiceUnavailable, "CONTRACT_UNAVAILABLE")
		return
	}
	cursorScope := "contract-transactions:" + strings.ToLower(program.Hex())
	cursor, ok := transactionCursor(request.URL.Query().Get("cursor"), cursorScope)
	if !ok {
		writeError(writer, http.StatusBadRequest, "INVALID_CURSOR")
		return
	}
	limit := requestLimit(request)
	items, err := s.store.ContractTransactions(request.Context(), program, limit+1, cursor)
	if err != nil {
		writeError(writer, http.StatusServiceUnavailable, "CONTRACT_TRANSACTIONS_UNAVAILABLE")
		return
	}
	nextCursor := ""
	if len(items) > limit {
		items = items[:limit]
		last := items[len(items)-1]
		nextCursor = encodeCursor(transactionPageCursor{Scope: cursorScope, BlockNumber: last.BlockNumber, LogIndex: last.LogIndex, ExecutionID: last.ExecutionID})
	}
	writeJSON(writer, http.StatusOK, map[string]any{"items": items, "nextCursor": nextCursor})
}

func (s *Server) health(writer http.ResponseWriter, _ *http.Request) {
	writeJSON(writer, http.StatusOK, map[string]string{"status": "ok", "service": "svm-indexer"})
}

func (s *Server) status(writer http.ResponseWriter, request *http.Request) {
	status, err := s.store.Status(request.Context())
	if err != nil {
		writeError(writer, http.StatusServiceUnavailable, "STATUS_UNAVAILABLE")
		return
	}
	writeJSON(writer, http.StatusOK, status)
}

func (s *Server) transaction(writer http.ResponseWriter, request *http.Request) {
	rawHash := strings.TrimSpace(request.PathValue("hash"))
	hash, ok := parseHash(rawHash)
	if !ok {
		writeError(writer, http.StatusBadRequest, "INVALID_TRANSACTION_HASH")
		return
	}
	detail, err := s.store.Transaction(request.Context(), hash)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(writer, http.StatusNotFound, "TRANSACTION_NOT_FOUND")
		return
	}
	if err != nil {
		writeError(writer, http.StatusServiceUnavailable, "TRANSACTION_UNAVAILABLE")
		return
	}
	writeJSON(writer, http.StatusOK, detail)
}

func (s *Server) address(writer http.ResponseWriter, request *http.Request) {
	raw := strings.TrimSpace(request.PathValue("address"))
	account, evmAddress, ok := parseAccount(raw)
	if !ok {
		writeError(writer, http.StatusBadRequest, "INVALID_SVM_ADDRESS")
		return
	}
	balances, err := s.store.AddressBalances(request.Context(), account)
	if err != nil {
		writeError(writer, http.StatusServiceUnavailable, "ADDRESS_BALANCES_UNAVAILABLE")
		return
	}
	transactions, err := s.store.AddressTransactions(request.Context(), account, 25, nil)
	if err != nil {
		writeError(writer, http.StatusServiceUnavailable, "ADDRESS_TRANSACTIONS_UNAVAILABLE")
		return
	}
	transactionCount, err := s.store.AddressTransactionCount(request.Context(), account)
	if err != nil {
		writeError(writer, http.StatusServiceUnavailable, "ADDRESS_TRANSACTIONS_UNAVAILABLE")
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"query": raw, "accountId": strings.ToLower(account.Hex()), "evmAddress": evmAddress,
		"transactionCount": transactionCount, "balances": balances, "transactions": transactions,
	})
}

func (s *Server) addressTransactions(writer http.ResponseWriter, request *http.Request) {
	account, _, ok := parseAccount(strings.TrimSpace(request.PathValue("address")))
	if !ok {
		writeError(writer, http.StatusBadRequest, "INVALID_SVM_ADDRESS")
		return
	}
	cursorScope := "address-transactions:" + strings.ToLower(account.Hex())
	cursor, ok := transactionCursor(request.URL.Query().Get("cursor"), cursorScope)
	if !ok {
		writeError(writer, http.StatusBadRequest, "INVALID_CURSOR")
		return
	}
	limit := requestLimit(request)
	items, err := s.store.AddressTransactions(request.Context(), account, limit+1, cursor)
	if err != nil {
		writeError(writer, http.StatusServiceUnavailable, "ADDRESS_TRANSACTIONS_UNAVAILABLE")
		return
	}
	nextCursor := ""
	if len(items) > limit {
		items = items[:limit]
		last := items[len(items)-1]
		nextCursor = encodeCursor(transactionPageCursor{Scope: cursorScope, BlockNumber: last.BlockNumber, LogIndex: last.LogIndex, ExecutionID: last.ExecutionID})
	}
	writeJSON(writer, http.StatusOK, map[string]any{"items": items, "nextCursor": nextCursor})
}

func (s *Server) tokens(writer http.ResponseWriter, request *http.Request) {
	items, err := s.store.ListTokens(request.Context(), requestLimit(request))
	if err != nil {
		writeError(writer, http.StatusServiceUnavailable, "SRC20_LIST_UNAVAILABLE")
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) openMintTokens(writer http.ResponseWriter, request *http.Request) {
	const cursorScope = "open-mint-src20"
	cursor, ok := openMintTokenCursor(request.URL.Query().Get("cursor"), cursorScope)
	if !ok {
		writeError(writer, http.StatusBadRequest, "INVALID_CURSOR")
		return
	}
	limit := requestLimit(request)
	items, err := s.store.ListOpenMintTokens(request.Context(), limit+1, cursor)
	if err != nil {
		writeError(writer, http.StatusServiceUnavailable, "OPEN_MINT_SRC20_LIST_UNAVAILABLE")
		return
	}
	nextCursor := ""
	if len(items) > limit {
		items = items[:limit]
		last := items[len(items)-1]
		nextCursor = encodeCursor(openMintTokenPageCursor{Scope: cursorScope, DeploymentBlock: last.DeploymentBlock, ProgramID: last.ProgramID})
	}
	writeJSON(writer, http.StatusOK, map[string]any{"items": items, "nextCursor": nextCursor})
}

func (s *Server) openMintToken(writer http.ResponseWriter, request *http.Request) {
	program, ok := parseHash(strings.TrimSpace(request.PathValue("program")))
	if !ok {
		writeError(writer, http.StatusBadRequest, "INVALID_OPEN_MINT_SRC20_ID")
		return
	}
	item, err := s.store.OpenMintToken(request.Context(), program)
	if store.IsNotFound(err) {
		writeError(writer, http.StatusNotFound, "OPEN_MINT_SRC20_NOT_SUPPORTED")
		return
	}
	if err != nil {
		writeError(writer, http.StatusServiceUnavailable, "OPEN_MINT_SRC20_UNAVAILABLE")
		return
	}
	writeJSON(writer, http.StatusOK, item)
}

func (s *Server) token(writer http.ResponseWriter, request *http.Request) {
	program, ok := parseHash(strings.TrimSpace(request.PathValue("program")))
	if !ok {
		writeError(writer, http.StatusBadRequest, "INVALID_SRC20_ID")
		return
	}
	item, err := s.store.Token(request.Context(), program)
	if store.IsNotFound(err) {
		writeError(writer, http.StatusNotFound, "SRC20_NOT_FOUND")
		return
	}
	if err != nil {
		writeError(writer, http.StatusServiceUnavailable, "SRC20_UNAVAILABLE")
		return
	}
	writeJSON(writer, http.StatusOK, item)
}

func (s *Server) tokenHolders(writer http.ResponseWriter, request *http.Request) {
	program, ok := parseHash(strings.TrimSpace(request.PathValue("program")))
	if !ok {
		writeError(writer, http.StatusBadRequest, "INVALID_SRC20_ID")
		return
	}
	cursorScope := "holders:" + strings.ToLower(program.Hex())
	cursor, ok := holderCursor(request.URL.Query().Get("cursor"), cursorScope)
	if !ok {
		writeError(writer, http.StatusBadRequest, "INVALID_CURSOR")
		return
	}
	limit := requestLimit(request)
	items, err := s.store.TokenHolders(request.Context(), program, limit+1, cursor)
	if err != nil {
		writeError(writer, http.StatusServiceUnavailable, "SRC20_HOLDERS_UNAVAILABLE")
		return
	}
	nextCursor := ""
	if len(items) > limit {
		items = items[:limit]
		last := items[len(items)-1]
		nextCursor = encodeCursor(holderPageCursor{Scope: cursorScope, Balance: last.Balance, AccountID: last.AccountID})
	}
	writeJSON(writer, http.StatusOK, map[string]any{"items": items, "nextCursor": nextCursor})
}

func (s *Server) tokenTransfers(writer http.ResponseWriter, request *http.Request) {
	program, ok := parseHash(strings.TrimSpace(request.PathValue("program")))
	if !ok {
		writeError(writer, http.StatusBadRequest, "INVALID_SRC20_ID")
		return
	}
	cursorScope := "transfers:" + strings.ToLower(program.Hex())
	cursor, ok := transferCursor(request.URL.Query().Get("cursor"), cursorScope)
	if !ok {
		writeError(writer, http.StatusBadRequest, "INVALID_CURSOR")
		return
	}
	limit := requestLimit(request)
	items, err := s.store.TokenTransfers(request.Context(), program, limit+1, cursor)
	if err != nil {
		writeError(writer, http.StatusServiceUnavailable, "SRC20_TRANSFERS_UNAVAILABLE")
		return
	}
	nextCursor := ""
	if len(items) > limit {
		items = items[:limit]
		last := items[len(items)-1]
		nextCursor = encodeCursor(transferPageCursor{Scope: cursorScope, BlockNumber: last.BlockNumber, ExecutionID: last.ExecutionID, EventIndex: last.EventIndex})
	}
	writeJSON(writer, http.StatusOK, map[string]any{"items": items, "nextCursor": nextCursor})
}

func parseHash(raw string) (common.Hash, bool) {
	decoded, err := hexutil.Decode(raw)
	if err != nil || len(decoded) != common.HashLength {
		return common.Hash{}, false
	}
	return common.BytesToHash(decoded), true
}

func parseAccount(raw string) (common.Hash, string, bool) {
	if common.IsHexAddress(raw) && len(raw) == 42 {
		address := common.HexToAddress(raw)
		return common.BytesToHash(address.Bytes()), address.Hex(), true
	}
	account, ok := parseHash(raw)
	return account, "", ok
}

type transactionPageCursor struct {
	Scope       string `json:"s"`
	BlockNumber uint64 `json:"b"`
	LogIndex    uint   `json:"l"`
	ExecutionID int64  `json:"i"`
}

type contractPageCursor struct {
	Scope       string `json:"s"`
	BlockNumber uint64 `json:"b"`
	LogIndex    uint   `json:"l"`
	ProgramID   string `json:"p"`
}

type holderPageCursor struct {
	Scope     string `json:"s"`
	Balance   string `json:"b"`
	AccountID string `json:"a"`
}

type transferPageCursor struct {
	Scope       string `json:"s"`
	BlockNumber uint64 `json:"b"`
	ExecutionID int64  `json:"i"`
	EventIndex  uint   `json:"e"`
}

type openMintTokenPageCursor struct {
	Scope           string `json:"s"`
	DeploymentBlock uint64 `json:"b"`
	ProgramID       string `json:"p"`
}

func transactionCursor(raw, scope string) (*store.TransactionCursor, bool) {
	if raw == "" {
		return nil, true
	}
	var decoded transactionPageCursor
	if !decodeCursor(raw, &decoded) || decoded.Scope != scope || decoded.ExecutionID < 1 {
		return nil, false
	}
	return &store.TransactionCursor{BlockNumber: decoded.BlockNumber, LogIndex: decoded.LogIndex, ExecutionID: decoded.ExecutionID}, true
}

func contractCursor(raw, scope string) (*store.ContractCursor, bool) {
	if raw == "" {
		return nil, true
	}
	var decoded contractPageCursor
	if !decodeCursor(raw, &decoded) || decoded.Scope != scope {
		return nil, false
	}
	if _, ok := parseHash(decoded.ProgramID); !ok {
		return nil, false
	}
	return &store.ContractCursor{BlockNumber: decoded.BlockNumber, LogIndex: decoded.LogIndex, ProgramID: strings.ToLower(decoded.ProgramID)}, true
}

func holderCursor(raw, scope string) (*store.HolderCursor, bool) {
	if raw == "" {
		return nil, true
	}
	var decoded holderPageCursor
	if !decodeCursor(raw, &decoded) || decoded.Scope != scope || decoded.Balance == "" {
		return nil, false
	}
	if _, ok := parseHash(decoded.AccountID); !ok {
		return nil, false
	}
	return &store.HolderCursor{Balance: decoded.Balance, AccountID: strings.ToLower(decoded.AccountID)}, true
}

func transferCursor(raw, scope string) (*store.TransferCursor, bool) {
	if raw == "" {
		return nil, true
	}
	var decoded transferPageCursor
	if !decodeCursor(raw, &decoded) || decoded.Scope != scope || decoded.ExecutionID < 1 {
		return nil, false
	}
	return &store.TransferCursor{BlockNumber: decoded.BlockNumber, ExecutionID: decoded.ExecutionID, EventIndex: decoded.EventIndex}, true
}

func openMintTokenCursor(raw, scope string) (*store.OpenMintTokenCursor, bool) {
	if raw == "" {
		return nil, true
	}
	var decoded openMintTokenPageCursor
	if !decodeCursor(raw, &decoded) || decoded.Scope != scope {
		return nil, false
	}
	if _, ok := parseHash(decoded.ProgramID); !ok {
		return nil, false
	}
	return &store.OpenMintTokenCursor{DeploymentBlock: decoded.DeploymentBlock, ProgramID: strings.ToLower(decoded.ProgramID)}, true
}

func encodeCursor(value any) string {
	payload, err := json.Marshal(value)
	if err != nil {
		return ""
	}
	return base64.RawURLEncoding.EncodeToString(payload)
}

func decodeCursor(raw string, destination any) bool {
	payload, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil || len(payload) == 0 {
		return false
	}
	return json.Unmarshal(payload, destination) == nil
}

func requestLimit(request *http.Request) int {
	value, err := strconv.Atoi(request.URL.Query().Get("limit"))
	if err != nil || value < 1 {
		return 50
	}
	if value > 200 {
		return 200
	}
	return value
}

func (s *Server) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json; charset=utf-8")
		writer.Header().Set("X-Content-Type-Options", "nosniff")
		writer.Header().Set("Referrer-Policy", "no-referrer")
		origin := request.Header.Get("Origin")
		if origin != "" {
			if _, allowed := s.allowedOrigins[origin]; !allowed {
				writeError(writer, http.StatusForbidden, "ORIGIN_NOT_ALLOWED")
				return
			}
			writer.Header().Set("Access-Control-Allow-Origin", origin)
			writer.Header().Set("Vary", "Origin")
			writer.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
			writer.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		}
		if request.Method == http.MethodOptions {
			writer.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(writer, request)
	})
}

func writeJSON(writer http.ResponseWriter, status int, value any) {
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(value)
}

func writeError(writer http.ResponseWriter, status int, code string) {
	writeJSON(writer, status, map[string]any{
		"error":     map[string]string{"code": code},
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
}
