// internal/db/workspace.go
package db

import (
	"time"
)

// RegisterWorkspace inserts a new workspace record into the database
// This is called first before port allocation to satisfy foreign key constraints
func RegisterWorkspace(id, name, path, template string, basePort int) error {
	database, err := Get()
	if err != nil {
		return err
	}

	_, err = database.Exec(`
		INSERT INTO workspaces (id, name, path, template, base_port, status, created_at, last_active)
		VALUES (?, ?, ?, ?, ?, 'ready', ?, ?)
	`, id, name, path, template, basePort, time.Now().Format(time.RFC3339), time.Now().Format(time.RFC3339))

	return err
}

// RegisterWorkspaceMinimal inserts a minimal workspace record
// Used when base port is not yet known
func RegisterWorkspaceMinimal(id, name, path, template string) error {
	database, err := Get()
	if err != nil {
		return err
	}

	// Use base_port 0 as placeholder, will be updated when ports are allocated
	_, err = database.Exec(`
		INSERT INTO workspaces (id, name, path, template, base_port, status, created_at, last_active)
		VALUES (?, ?, ?, ?, 0, 'ready', ?, ?)
	`, id, name, path, template, time.Now().Format(time.RFC3339), time.Now().Format(time.RFC3339))

	return err
}

// UnregisterWorkspace removes a workspace record from the database
// This will cascade delete port allocations and base ports due to foreign keys
func UnregisterWorkspace(id string) error {
	database, err := Get()
	if err != nil {
		return err
	}

	_, err = database.Exec(`DELETE FROM workspaces WHERE id = ?`, id)
	return err
}

// UpdateWorkspaceBasePort updates the base port for a workspace
func UpdateWorkspaceBasePort(id string, basePort int) error {
	database, err := Get()
	if err != nil {
		return err
	}

	_, err = database.Exec(`UPDATE workspaces SET base_port = ? WHERE id = ?`, basePort, id)
	return err
}

// UpdateWorkspaceStatus updates the status of a workspace
func UpdateWorkspaceStatus(id, status string) error {
	database, err := Get()
	if err != nil {
		return err
	}

	_, err = database.Exec(`
		UPDATE workspaces SET status = ?, last_active = ? WHERE id = ?
	`, status, time.Now().Format(time.RFC3339), id)
	return err
}

// UpdateWorkspaceLastActive updates the last_active timestamp
func UpdateWorkspaceLastActive(id string) error {
	database, err := Get()
	if err != nil {
		return err
	}

	_, err = database.Exec(`
		UPDATE workspaces SET last_active = ? WHERE id = ?
	`, time.Now().Format(time.RFC3339), id)
	return err
}

// GetWorkspace retrieves a workspace record by ID
func GetWorkspace(id string) (*WorkspaceRecord, error) {
	database, err := Get()
	if err != nil {
		return nil, err
	}

	var ws WorkspaceRecord
	err = database.QueryRow(`
		SELECT id, name, path, template, base_port, status, created_at, last_active, config
		FROM workspaces WHERE id = ?
	`, id).Scan(&ws.ID, &ws.Name, &ws.Path, &ws.Template, &ws.BasePort, &ws.Status, &ws.CreatedAt, &ws.LastActive, &ws.Config)

	if err != nil {
		return nil, err
	}

	return &ws, nil
}

// GetWorkspaceByPath retrieves a workspace record by path
func GetWorkspaceByPath(path string) (*WorkspaceRecord, error) {
	database, err := Get()
	if err != nil {
		return nil, err
	}

	var ws WorkspaceRecord
	err = database.QueryRow(`
		SELECT id, name, path, template, base_port, status, created_at, last_active, config
		FROM workspaces WHERE path = ?
	`, path).Scan(&ws.ID, &ws.Name, &ws.Path, &ws.Template, &ws.BasePort, &ws.Status, &ws.CreatedAt, &ws.LastActive, &ws.Config)

	if err != nil {
		return nil, err
	}

	return &ws, nil
}

// ListWorkspaces returns all workspace records
func ListWorkspaces() ([]WorkspaceRecord, error) {
	database, err := Get()
	if err != nil {
		return nil, err
	}

	rows, err := database.Query(`
		SELECT id, name, path, template, base_port, status, created_at, last_active, config
		FROM workspaces ORDER BY last_active DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var workspaces []WorkspaceRecord
	for rows.Next() {
		var ws WorkspaceRecord
		if err := rows.Scan(&ws.ID, &ws.Name, &ws.Path, &ws.Template, &ws.BasePort, &ws.Status, &ws.CreatedAt, &ws.LastActive, &ws.Config); err != nil {
			return nil, err
		}
		workspaces = append(workspaces, ws)
	}

	return workspaces, rows.Err()
}

// WorkspaceRecord represents a workspace in the database
type WorkspaceRecord struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	Path       string  `json:"path"`
	Template   string  `json:"template"`
	BasePort   int     `json:"base_port"`
	Status     string  `json:"status"`
	CreatedAt  string  `json:"created_at"`
	LastActive string  `json:"last_active"`
	Config     *string `json:"config,omitempty"`
}
