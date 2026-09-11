package api

import "testing"

func TestPaginationCursorsRoundTrip(t *testing.T) {
	const scope = "test-scope"
	tests := []struct {
		name  string
		value any
		valid func(string) bool
	}{
		{
			name:  "transaction",
			value: transactionPageCursor{Scope: scope, BlockNumber: 123, LogIndex: 4, ExecutionID: 88},
			valid: func(raw string) bool { _, ok := transactionCursor(raw, scope); return ok },
		},
		{
			name:  "contract",
			value: contractPageCursor{Scope: scope, BlockNumber: 123, LogIndex: 4, ProgramID: "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"},
			valid: func(raw string) bool { _, ok := contractCursor(raw, scope); return ok },
		},
		{
			name:  "holder",
			value: holderPageCursor{Scope: scope, Balance: "1000000000000000000", AccountID: "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"},
			valid: func(raw string) bool { _, ok := holderCursor(raw, scope); return ok },
		},
		{
			name:  "transfer",
			value: transferPageCursor{Scope: scope, BlockNumber: 123, ExecutionID: 88, EventIndex: 2},
			valid: func(raw string) bool { _, ok := transferCursor(raw, scope); return ok },
		},
		{
			name:  "open mint token",
			value: openMintTokenPageCursor{Scope: scope, DeploymentBlock: 123, ProgramID: "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"},
			valid: func(raw string) bool { _, ok := openMintTokenCursor(raw, scope); return ok },
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			cursor := encodeCursor(test.value)
			if cursor == "" || !test.valid(cursor) {
				t.Fatalf("cursor did not round-trip: %q", cursor)
			}
		})
	}
}

func TestPaginationCursorsRejectInvalidValues(t *testing.T) {
	const scope = "test-scope"
	for name, valid := range map[string]func(string) bool{
		"transaction": func(raw string) bool { _, ok := transactionCursor(raw, scope); return ok },
		"contract":    func(raw string) bool { _, ok := contractCursor(raw, scope); return ok },
		"holder":      func(raw string) bool { _, ok := holderCursor(raw, scope); return ok },
		"transfer":    func(raw string) bool { _, ok := transferCursor(raw, scope); return ok },
		"open mint":   func(raw string) bool { _, ok := openMintTokenCursor(raw, scope); return ok },
	} {
		t.Run(name, func(t *testing.T) {
			if valid("not-a-cursor") {
				t.Fatal("accepted malformed cursor")
			}
		})
	}
}

func TestPaginationCursorRejectsDifferentScope(t *testing.T) {
	raw := encodeCursor(transactionPageCursor{Scope: "address:a", BlockNumber: 123, LogIndex: 4, ExecutionID: 88})
	if _, ok := transactionCursor(raw, "address:b"); ok {
		t.Fatal("accepted a cursor from a different query scope")
	}
}
