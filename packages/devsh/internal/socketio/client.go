// Package socketio provides a socket.io client for real-time communication
// with the apps/server socket.io server. This enables CLI to use the exact
// same agent spawning flow as the web app.
package socketio

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/karlorz/devsh/internal/auth"
	"github.com/gorilla/websocket"
)

// Client wraps a socket.io connection to apps/server
type Client struct {
	serverURL string
	authToken string
	conn      *websocket.Conn
	mu        sync.Mutex
	connected bool
	msgID     int
}

// StartTaskData matches the StartTaskSchema from @cmux/shared/socket-schemas
type StartTaskData struct {
	TaskID          string   `json:"taskId"`
	TaskDescription string   `json:"taskDescription"`
	ProjectFullName string   `json:"projectFullName"`
	RepoURL         string   `json:"repoUrl,omitempty"`
	Branch          string   `json:"branch,omitempty"`
	TaskRunIDs      []string `json:"taskRunIds,omitempty"`
	SelectedAgents  []string `json:"selectedAgents,omitempty"`
	IsCloudMode     bool     `json:"isCloudMode"`
	EnvironmentID   string   `json:"environmentId,omitempty"`
	Theme           string   `json:"theme,omitempty"`
}

// TaskStartedResult is the response from start-task event
type TaskStartedResult struct {
	TaskID      string `json:"taskId"`
	WorktreePath string `json:"worktreePath,omitempty"`
	TerminalID  string `json:"terminalId,omitempty"`
	Error       string `json:"error,omitempty"`
}

// NewClient creates a new socket.io client
func NewClient(serverURL string) (*Client, error) {
	token, err := auth.GetAccessToken()
	if err != nil {
		return nil, fmt.Errorf("not authenticated: %w", err)
	}

	return &Client{
		serverURL: serverURL,
		authToken: token,
	}, nil
}

// Connect establishes a WebSocket connection to the server
// Note: This is a simplified implementation using raw WebSocket.
// For full socket.io protocol support, consider using a proper socket.io client library.
func (c *Client) Connect(ctx context.Context) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.connected {
		return nil
	}

	// Parse server URL and convert to WebSocket URL
	u, err := url.Parse(c.serverURL)
	if err != nil {
		return fmt.Errorf("invalid server URL: %w", err)
	}

	// Convert http(s) to ws(s)
	switch u.Scheme {
	case "http":
		u.Scheme = "ws"
	case "https":
		u.Scheme = "wss"
	}

	// Socket.io endpoint
	u.Path = "/socket.io/"
	q := u.Query()
	q.Set("EIO", "4")
	q.Set("transport", "websocket")
	u.RawQuery = q.Encode()

	// Create WebSocket dialer with custom headers
	dialer := websocket.Dialer{
		HandshakeTimeout: 10 * time.Second,
	}

	header := http.Header{}
	header.Set("Authorization", "Bearer "+c.authToken)

	conn, _, err := dialer.DialContext(ctx, u.String(), header)
	if err != nil {
		return fmt.Errorf("failed to connect: %w", err)
	}

	c.conn = conn
	c.connected = true

	// Read the initial socket.io handshake message
	_, msg, err := conn.ReadMessage()
	if err != nil {
		c.conn.Close()
		c.connected = false
		return fmt.Errorf("failed to read handshake: %w", err)
	}

	// Parse engine.io OPEN packet (starts with '0')
	if len(msg) > 0 && msg[0] == '0' {
		// Successfully received OPEN packet
		// Send socket.io CONNECT packet for default namespace
		if err := conn.WriteMessage(websocket.TextMessage, []byte("40")); err != nil {
			c.conn.Close()
			c.connected = false
			return fmt.Errorf("failed to send connect: %w", err)
		}

		// Read CONNECT acknowledgment
		_, msg, err = conn.ReadMessage()
		if err != nil {
			c.conn.Close()
			c.connected = false
			return fmt.Errorf("failed to read connect ack: %w", err)
		}
	}

	return nil
}

// Authenticate sends the authenticate event to the server
func (c *Client) Authenticate(ctx context.Context) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if !c.connected || c.conn == nil {
		return fmt.Errorf("not connected")
	}

	// Send authenticate event
	// Socket.io message format: 42["event", data]
	authData := map[string]string{
		"authToken": c.authToken,
	}
	payload, err := json.Marshal([]interface{}{"authenticate", authData})
	if err != nil {
		return err
	}

	msg := fmt.Sprintf("42%s", payload)
	return c.conn.WriteMessage(websocket.TextMessage, []byte(msg))
}

// EmitStartTask sends the start-task event and waits for response
func (c *Client) EmitStartTask(ctx context.Context, data StartTaskData) (*TaskStartedResult, error) {
	c.mu.Lock()
	if !c.connected || c.conn == nil {
		c.mu.Unlock()
		return nil, fmt.Errorf("not connected")
	}

	// Increment message ID for acknowledgment
	c.msgID++
	msgID := c.msgID

	// Socket.io message with ack: 42<id>["event", data]
	payload, err := json.Marshal([]interface{}{"start-task", data})
	if err != nil {
		c.mu.Unlock()
		return nil, err
	}

	msg := fmt.Sprintf("42%d%s", msgID, payload)
	if err := c.conn.WriteMessage(websocket.TextMessage, []byte(msg)); err != nil {
		c.mu.Unlock()
		return nil, fmt.Errorf("failed to send start-task: %w", err)
	}
	c.mu.Unlock()

	// Wait for acknowledgment with timeout
	deadline := time.Now().Add(5 * time.Minute)
	c.conn.SetReadDeadline(deadline)

	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		_, rawMsg, err := c.conn.ReadMessage()
		if err != nil {
			return nil, fmt.Errorf("failed to read response: %w", err)
		}

		// Parse socket.io message
		// Ack format: 43<id>[data]
		if len(rawMsg) > 2 && rawMsg[0] == '4' && rawMsg[1] == '3' {
			// Find where the ID ends and data begins
			var ackID int
			var dataStart int
			for i := 2; i < len(rawMsg); i++ {
				if rawMsg[i] == '[' {
					dataStart = i
					break
				}
				ackID = ackID*10 + int(rawMsg[i]-'0')
			}

			if ackID == msgID && dataStart > 0 {
				var result []TaskStartedResult
				if err := json.Unmarshal(rawMsg[dataStart:], &result); err != nil {
					return nil, fmt.Errorf("failed to parse response: %w", err)
				}
				if len(result) > 0 {
					return &result[0], nil
				}
				return &TaskStartedResult{}, nil
			}
		}

		// Handle ping (2) - respond with pong (3)
		if len(rawMsg) == 1 && rawMsg[0] == '2' {
			c.conn.WriteMessage(websocket.TextMessage, []byte("3"))
			continue
		}
	}
}

// Close closes the connection
func (c *Client) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.conn != nil {
		c.connected = false
		return c.conn.Close()
	}
	return nil
}

// IsConnected returns whether the client is connected
func (c *Client) IsConnected() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.connected
}
