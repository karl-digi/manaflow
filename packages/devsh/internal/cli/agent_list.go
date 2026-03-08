// internal/cli/agent_list.go
package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"text/tabwriter"
	"time"

	"github.com/karlorz/devsh/internal/auth"
	"github.com/spf13/cobra"
)

// AgentInfo describes an available agent (from server API)
type AgentInfo struct {
	Name    string `json:"name"`
	Command string `json:"command"`
}

// AgentListResponse from /api/agents
type AgentListResponse struct {
	Agents []AgentInfo `json:"agents"`
}

// cachedAgents stores fetched agents to avoid repeated API calls
var cachedAgents []AgentInfo

// FetchAgents retrieves agent list from server API
func FetchAgents(ctx context.Context) ([]AgentInfo, error) {
	if len(cachedAgents) > 0 {
		return cachedAgents, nil
	}

	cfg := auth.GetConfig()
	if cfg.ServerURL == "" {
		return nil, fmt.Errorf("CMUX_SERVER_URL not configured")
	}

	client := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequestWithContext(ctx, "GET", cfg.ServerURL+"/api/agents", nil)
	if err != nil {
		return nil, err
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch agents: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("server returned %d: %s", resp.StatusCode, string(body))
	}

	var result AgentListResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	cachedAgents = result.Agents
	return cachedAgents, nil
}

// ResolveAgentName validates agent name against server list
// Returns the name as-is (server will validate)
func ResolveAgentName(name string) string {
	// Just return as-is - let server validate
	// This allows CLI to work even if server is unreachable
	return name
}

var agentListCmd = &cobra.Command{
	Use:   "list",
	Short: "List available agents",
	Long: `List all available coding agents that can be used with 'devsh task create --agent'.

Fetches the current agent list from the server (same as web app).

Examples:
  devsh agent list              # List all agents
  devsh agent list --json       # JSON output
  devsh agent list claude       # Filter by name`,
	RunE: runAgentList,
}

var agentCmd = &cobra.Command{
	Use:   "agent",
	Short: "Manage coding agents",
	Long:  `Commands for managing and listing coding agents.`,
}

func init() {
	agentCmd.AddCommand(agentListCmd)
	rootCmd.AddCommand(agentCmd)
}

func runAgentList(cmd *cobra.Command, args []string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	agents, err := FetchAgents(ctx)
	if err != nil {
		return fmt.Errorf("failed to fetch agents: %w", err)
	}

	// Filter if specified
	filter := ""
	if len(args) > 0 {
		filter = strings.ToLower(args[0])
	}

	var filtered []AgentInfo
	for _, agent := range agents {
		if filter == "" ||
			strings.Contains(strings.ToLower(agent.Name), filter) ||
			strings.Contains(strings.ToLower(agent.Command), filter) {
			filtered = append(filtered, agent)
		}
	}

	if flagJSON {
		data, err := json.MarshalIndent(map[string]interface{}{"agents": filtered}, "", "  ")
		if err != nil {
			return err
		}
		fmt.Println(string(data))
		return nil
	}

	fmt.Printf("Available Agents (%d)\n", len(filtered))
	fmt.Println("====================")
	fmt.Println()

	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintf(w, "NAME\tCOMMAND\n")
	fmt.Fprintf(w, "----\t-------\n")

	for _, agent := range filtered {
		fmt.Fprintf(w, "%s\t%s\n", agent.Name, agent.Command)
	}
	w.Flush()

	fmt.Println()
	fmt.Println("Usage: devsh task create --agent <name> --repo owner/repo \"prompt\"")

	return nil
}
