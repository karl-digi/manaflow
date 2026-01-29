// internal/db/workspace_test.go
package db

import (
	"database/sql"
	"testing"

	_ "github.com/mattn/go-sqlite3"
)

func TestCascadeDeletePortAllocations(t *testing.T) {
	// Create in-memory database
	db, err := sql.Open("sqlite3", ":memory:?_foreign_keys=on")
	if err != nil {
		t.Fatalf("Failed to open database: %v", err)
	}
	defer db.Close()

	// Run migrations
	if err := Migrate(db); err != nil {
		t.Fatalf("Migration failed: %v", err)
	}

	// Insert a workspace
	_, err = db.Exec(`
		INSERT INTO workspaces (id, name, path, template, base_port, status)
		VALUES ('ws_cascade_test', 'Cascade Test', '/tmp/cascade', 'node', 10000, 'ready')
	`)
	if err != nil {
		t.Fatalf("Failed to insert workspace: %v", err)
	}

	// Insert base port
	_, err = db.Exec(`
		INSERT INTO workspace_base_ports (workspace_id, base_port)
		VALUES ('ws_cascade_test', 10000)
	`)
	if err != nil {
		t.Fatalf("Failed to insert base port: %v", err)
	}

	// Insert port allocations
	_, err = db.Exec(`
		INSERT INTO port_allocations (workspace_id, port_name, port_number)
		VALUES ('ws_cascade_test', 'PORT', 10000),
		       ('ws_cascade_test', 'API_PORT', 10001),
		       ('ws_cascade_test', 'CODE_PORT', 10080)
	`)
	if err != nil {
		t.Fatalf("Failed to insert port allocations: %v", err)
	}

	// Verify port allocations exist
	var count int
	err = db.QueryRow(`SELECT COUNT(*) FROM port_allocations WHERE workspace_id = 'ws_cascade_test'`).Scan(&count)
	if err != nil {
		t.Fatalf("Failed to count port allocations: %v", err)
	}
	if count != 3 {
		t.Errorf("Expected 3 port allocations before delete, got %d", count)
	}

	// Delete the workspace
	_, err = db.Exec(`DELETE FROM workspaces WHERE id = 'ws_cascade_test'`)
	if err != nil {
		t.Fatalf("Failed to delete workspace: %v", err)
	}

	// Verify port allocations were cascade deleted
	err = db.QueryRow(`SELECT COUNT(*) FROM port_allocations WHERE workspace_id = 'ws_cascade_test'`).Scan(&count)
	if err != nil {
		t.Fatalf("Failed to count port allocations after delete: %v", err)
	}
	if count != 0 {
		t.Errorf("Expected 0 port allocations after cascade delete, got %d", count)
	}

	// Verify base port was cascade deleted
	err = db.QueryRow(`SELECT COUNT(*) FROM workspace_base_ports WHERE workspace_id = 'ws_cascade_test'`).Scan(&count)
	if err != nil {
		t.Fatalf("Failed to count base ports after delete: %v", err)
	}
	if count != 0 {
		t.Errorf("Expected 0 base ports after cascade delete, got %d", count)
	}
}

func TestRegisterUnregisterWorkspace(t *testing.T) {
	// Create in-memory database
	database, err := sql.Open("sqlite3", ":memory:?_foreign_keys=on")
	if err != nil {
		t.Fatalf("Failed to open database: %v", err)
	}
	defer database.Close()

	// Run migrations
	if err := Migrate(database); err != nil {
		t.Fatalf("Migration failed: %v", err)
	}

	// Reset the singleton for testing (use the local database)
	// Since RegisterWorkspace uses Get(), we need to test differently
	// Let's test the SQL directly

	// Insert workspace
	_, err = database.Exec(`
		INSERT INTO workspaces (id, name, path, template, base_port, status, created_at, last_active)
		VALUES ('ws_test_reg', 'Test Register', '/tmp/register', 'node', 0, 'ready', datetime('now'), datetime('now'))
	`)
	if err != nil {
		t.Fatalf("Failed to register workspace: %v", err)
	}

	// Verify workspace exists
	var id string
	err = database.QueryRow(`SELECT id FROM workspaces WHERE id = 'ws_test_reg'`).Scan(&id)
	if err != nil {
		t.Fatalf("Failed to find registered workspace: %v", err)
	}
	if id != "ws_test_reg" {
		t.Errorf("Expected id 'ws_test_reg', got '%s'", id)
	}

	// Unregister (delete) workspace
	_, err = database.Exec(`DELETE FROM workspaces WHERE id = 'ws_test_reg'`)
	if err != nil {
		t.Fatalf("Failed to unregister workspace: %v", err)
	}

	// Verify workspace is gone
	err = database.QueryRow(`SELECT id FROM workspaces WHERE id = 'ws_test_reg'`).Scan(&id)
	if err != sql.ErrNoRows {
		t.Error("Expected workspace to be deleted")
	}
}

func TestForeignKeyConstraint(t *testing.T) {
	// Create in-memory database with foreign keys enabled
	db, err := sql.Open("sqlite3", ":memory:?_foreign_keys=on")
	if err != nil {
		t.Fatalf("Failed to open database: %v", err)
	}
	defer db.Close()

	// Run migrations
	if err := Migrate(db); err != nil {
		t.Fatalf("Migration failed: %v", err)
	}

	// Try to insert port allocation without workspace (should fail)
	_, err = db.Exec(`
		INSERT INTO port_allocations (workspace_id, port_name, port_number)
		VALUES ('ws_nonexistent', 'PORT', 10000)
	`)
	if err == nil {
		t.Error("Expected foreign key violation error, got nil")
	}

	// Try to insert base port without workspace (should fail)
	_, err = db.Exec(`
		INSERT INTO workspace_base_ports (workspace_id, base_port)
		VALUES ('ws_nonexistent', 10000)
	`)
	if err == nil {
		t.Error("Expected foreign key violation error, got nil")
	}
}
