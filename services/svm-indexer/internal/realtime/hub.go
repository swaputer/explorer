package realtime

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
)

type Event struct {
	Cursor      string         `json:"cursor"`
	Type        string         `json:"type"`
	BlockNumber uint64         `json:"blockNumber"`
	Timestamp   string         `json:"timestamp"`
	Data        map[string]any `json:"data"`
}

type Hub struct {
	mu          sync.Mutex
	subscribers map[chan Event]struct{}
}

func NewHub() *Hub {
	return &Hub{subscribers: make(map[chan Event]struct{})}
}

func (h *Hub) Publish(event Event) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for subscriber := range h.subscribers {
		select {
		case subscriber <- event:
		default:
			close(subscriber)
			delete(h.subscribers, subscriber)
		}
	}
}

func (h *Hub) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	connection, err := websocket.Accept(writer, request, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	defer connection.Close(websocket.StatusNormalClosure, "closed")
	connection.SetReadLimit(1024)

	subscriber := make(chan Event, 64)
	h.subscribe(subscriber)
	defer h.unsubscribe(subscriber)

	ctx, cancel := context.WithCancel(request.Context())
	defer cancel()
	go func() {
		for {
			if _, _, err := connection.Read(ctx); err != nil {
				cancel()
				return
			}
		}
	}()

	hello := Event{
		Cursor: "connected", Type: "system.connected", Timestamp: time.Now().UTC().Format(time.RFC3339),
		Data: map[string]any{"protocol": "svm-events/1"},
	}
	if err := writeEvent(ctx, connection, hello); err != nil {
		return
	}
	ping := time.NewTicker(30 * time.Second)
	defer ping.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case event, open := <-subscriber:
			if !open {
				_ = connection.Close(websocket.StatusPolicyViolation, "client is too slow")
				return
			}
			if err := writeEvent(ctx, connection, event); err != nil {
				return
			}
		case <-ping.C:
			pingContext, pingCancel := context.WithTimeout(ctx, 10*time.Second)
			err := connection.Ping(pingContext)
			pingCancel()
			if err != nil {
				return
			}
		}
	}
}

func (h *Hub) subscribe(subscriber chan Event) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.subscribers[subscriber] = struct{}{}
}

func (h *Hub) unsubscribe(subscriber chan Event) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.subscribers, subscriber)
}

func writeEvent(ctx context.Context, connection *websocket.Conn, event Event) error {
	payload, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("encode WS event: %w", err)
	}
	writeContext, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	return connection.Write(writeContext, websocket.MessageText, payload)
}
