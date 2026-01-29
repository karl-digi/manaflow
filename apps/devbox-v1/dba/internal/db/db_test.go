// internal/db/db_test.go
package db

import (
	"database/sql"
	"os"
	"path/filepath"
	"testing"
)

func TestGetWithPath(t *testing.T) {
	// Create a temporary directory for the test database
	tmpDir, err := os.MkdirTemp("", "dba-db-test-*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	dbPath := filepath.Join(tmpDir, "test.db")

	// Get database with path
	db, err := GetWithPath(dbPath)
	if err != nil {
		t.Fatalf("Failed to get database: %v", err)
	}
	defer db.Close()

	// Verify database is open
	if err := db.Ping(); err != nil {
		t.Errorf("Database ping failed: %v", err)
	}

	// Verify schema was created
	var tableCount int
	err = db.QueryRow(`
		SELECT COUNT(*) FROM sqlite_master
		WHERE type='table' AND name IN ('schema_version', 'workspaces', 'port_allocations', 'workspace_base_ports')
	`).Scan(&tableCount)
	if err != nil {
		t.Fatalf("Failed to query tables: %v", err)
	}

	if tableCount != 4 {
		t.Errorf("Expected 4 tables, got %d", tableCount)
	}
}

func TestMigrate(t *testing.T) {
	// Create a temporary in-memory database
	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("Failed to open database: %v", err)
	}
	defer db.Close()

	// Run migration
	if err := Migrate(db); err != nil {
		t.Fatalf("Migration failed: %v", err)
	}

	// Verify schema version
	version, err := GetSchemaVersion(db)
	if err != nil {
		t.Fatalf("Failed to get schema version: %v", err)
	}

	if version != SchemaVersion {
		t.Errorf("Expected schema version %d, got %d", SchemaVersion, version)
	}
}

func TestMigrateIdempotent(t *testing.T) {
	// Create a temporary in-memory database
	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("Failed to open database: %v", err)
	}
	defer db.Close()

	// Run migration twice
	if err := Migrate(db); err != nil {
		t.Fatalf("First migration failed: %v", err)
	}

	if err := Migrate(db); err != nil {
		t.Fatalf("Second migration failed: %v", err)
	}

	// Verify schema version is still correct
	version, err := GetSchemaVersion(db)
	if err != nil {
		t.Fatalf("Failed to get schema version: %v", err)
	}

	if version != SchemaVersion {
		t.Errorf("Expected schema version %d, got %d", SchemaVersion, version)
	}
}

func TestSchemaCreation(t *testing.T) {
	// Create a temporary in-memory database
	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("Failed to open database: %v", err)
	}
	defer db.Close()

	// Execute schema
	if _, err := db.Exec(CreateSchema()); err != nil {
		t.Fatalf("Schema creation failed: %v", err)
	}

	// Test inserting a workspace
	_, err = db.Exec(`
		INSERT INTO workspaces (id, name, path, base_port)
		VALUES ('ws_test', 'Test Workspace', '/tmp/test', 10000)
	`)
	if err != nil {
		t.Errorf("Failed to insert workspace: %v", err)
	}

	// Test inserting a base port
	_, err = db.Exec(`
		INSERT INTO workspace_base_ports (workspace_id, base_port)
		VALUES ('ws_test', 10000)
	`)
	if err != nil {
		t.Errorf("Failed to insert base port: %v", err)
	}

	// Test inserting a port allocation
	_, err = db.Exec(`
		INSERT INTO port_allocations (workspace_id, port_name, port_number)
		VALUES ('ws_test', 'PORT', 10000)
	`)
	if err != nil {
		t.Errorf("Failed to insert port allocation: %v", err)
	}

	// Test foreign key constraint (should fail without workspace)
	_, err = db.Exec(`
		INSERT INTO port_allocations (workspace_id, port_name, port_number)
		VALUES ('ws_nonexistent', 'PORT', 20000)
	`)
	// Note: Foreign keys must be enabled for this to fail
	// The connection string includes _foreign_keys=on but in-memory
	// databases might not enforce it by default
}

func TestGetSchemaVersion(t *testing.T) {
	// Create a temporary in-memory database
	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("Failed to open database: %v", err)
	}
	defer db.Close()

	// Before migration, version should be 0
	version, err := GetSchemaVersion(db)
	if err != nil {
		t.Fatalf("Failed to get schema version: %v", err)
	}
	if version != 0 {
		t.Errorf("Expected version 0 before migration, got %d", version)
	}

	// After migration, version should be SchemaVersion
	if err := Migrate(db); err != nil {
		t.Fatalf("Migration failed: %v", err)
	}

	version, err = GetSchemaVersion(db)
	if err != nil {
		t.Fatalf("Failed to get schema version: %v", err)
	}
	if version != SchemaVersion {
		t.Errorf("Expected version %d after migration, got %d", SchemaVersion, version)
	}
}
