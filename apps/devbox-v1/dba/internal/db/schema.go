// internal/db/schema.go
package db

// SchemaVersion for migrations
const SchemaVersion = 1

// CreateSchema returns the SQL to create all tables
func CreateSchema() string {
	return `
    -- Schema version tracking
    CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY
    );

    -- Workspaces table (Agent #4 will use this)
    CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT,
        path TEXT NOT NULL UNIQUE,
        template TEXT,
        base_port INTEGER NOT NULL,
        status TEXT DEFAULT 'ready',
        created_at TEXT DEFAULT (datetime('now')),
        last_active TEXT DEFAULT (datetime('now')),
        config TEXT
    );

    -- Port allocations
    CREATE TABLE IF NOT EXISTS port_allocations (
        workspace_id TEXT NOT NULL,
        port_name TEXT NOT NULL,
        port_number INTEGER NOT NULL UNIQUE,
        allocated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (workspace_id, port_name),
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );

    -- Index for fast port lookup
    CREATE INDEX IF NOT EXISTS idx_port_number ON port_allocations(port_number);

    -- Index for fast workspace lookup
    CREATE INDEX IF NOT EXISTS idx_ports_workspace
        ON port_allocations(workspace_id);

    -- Index for finding port by name within workspace
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ports_workspace_name
        ON port_allocations(workspace_id, port_name);

    -- Workspace base ports (for quick block allocation)
    CREATE TABLE IF NOT EXISTS workspace_base_ports (
        workspace_id TEXT PRIMARY KEY,
        base_port INTEGER NOT NULL UNIQUE,
        allocated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );

    -- Metrics for debugging (optional, other agents may use)
    CREATE TABLE IF NOT EXISTS metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id TEXT,
        command TEXT,
        exit_code INTEGER,
        duration_ms INTEGER,
        error TEXT,
        timestamp TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_metrics_workspace
        ON metrics(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_metrics_timestamp
        ON metrics(timestamp);
    `
}
