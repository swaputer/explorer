package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strconv"

	"github.com/swaputer/explorer/services/svm-indexer/internal/config"
	"github.com/swaputer/explorer/services/svm-indexer/internal/store"
)

func main() {
	if len(os.Args) < 2 {
		usage()
	}
	cfg, err := config.Load()
	if err != nil {
		fatal("configuration is invalid")
	}
	ctx := context.Background()
	database, err := store.Open(ctx, cfg)
	if err != nil {
		fatal("database connection failed")
	}
	defer database.Close()
	if err := database.Migrate(ctx); err != nil {
		fatal("database migration failed")
	}

	switch os.Args[1] {
	case "status":
		status, err := database.Status(ctx)
		if err != nil {
			fatal("status query failed")
		}
		output, _ := json.MarshalIndent(status, "", "  ")
		fmt.Println(string(output))
	case "rewind":
		if len(os.Args) != 3 {
			usage()
		}
		block, err := strconv.ParseUint(os.Args[2], 10, 64)
		if err != nil || block < cfg.StartBlock {
			fatal("rewind block is invalid")
		}
		if err := database.Rewind(ctx, block); err != nil {
			fatal("rewind failed")
		}
		fmt.Printf("canonical projections rewound from block %d\n", block)
	default:
		usage()
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, "usage: go run ./cmd/admin <status|rewind BLOCK>")
	os.Exit(2)
}

func fatal(message string) {
	fmt.Fprintln(os.Stderr, message)
	os.Exit(1)
}
