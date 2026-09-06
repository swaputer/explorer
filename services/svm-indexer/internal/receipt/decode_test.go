package receipt

import (
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type fixture struct {
	Payload     string `json:"payload"`
	RecordCount int    `json:"recordCount"`
}

func TestDecodeFrozenFixtures(t *testing.T) {
	t.Parallel()
	for _, name := range []string{"deploy", "authenticated-call", "src20-transfer", "src721-transfer", "cpamm-swap", "unsigned-nop"} {
		name := name
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			path := filepath.Join("..", "..", "..", "..", "tooling", "receipt-codec", "fixtures", name+".json")
			raw, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			var expected fixture
			if err := json.Unmarshal(raw, &expected); err != nil {
				t.Fatal(err)
			}
			payload, err := hex.DecodeString(strings.TrimPrefix(expected.Payload, "0x"))
			if err != nil {
				t.Fatal(err)
			}
			decoded, err := Decode(payload)
			if err != nil {
				t.Fatal(err)
			}
			if len(decoded.Records) != expected.RecordCount {
				t.Fatalf("record count: got %d want %d", len(decoded.Records), expected.RecordCount)
			}
		})
	}
}

func TestDecodeRejectsTrailingBytes(t *testing.T) {
	payload := []byte{1, 0, 0, 1}
	if _, err := Decode(payload); err == nil {
		t.Fatal("expected malformed receipt to fail")
	}
}
