// internal/db/db.go
package db

import (
	"database/sql"
	"os"
	"path/filepath"
	"sync"

	_ "github.com/mattn/go-sqlite3"

	"github.com/dba-cli/dba/internal/config"
)

var (
	instance *sql.DB
	once     sync.Once
	initErr  error
)

// Get returns the database connection (singleton)
func Get() (*sql.DB, error) {
	once.Do(func() {
		instance, initErr = initDB()
	})
	return instance, initErr
}

// GetWithPath returns the database connection using a specific path
// This is useful for testing with isolated databases
func GetWithPath(dbPath string) (*sql.DB, error) {
	// Ensure directory exists
	if err := os.MkdirAll(filepath.Dir(dbPath), 0755); err != nil {
		return nil, err
	}

	db, err := sql.Open("sqlite3", dbPath+"?_journal_mode=WAL&_busy_timeout=5000&_foreign_keys=on")
	if err != nil {
		return nil, err
	}

	// Run migrations
	if err := Migrate(db); err != nil {
		db.Close()
		return nil, err
	}

	return db, nil
}

func initDB() (*sql.DB, error) {
	dbPath := filepath.Join(config.DBAHome(), "state.db")

	// Ensure directory exists
	if err := os.MkdirAll(filepath.Dir(dbPath), 0755); err != nil {
		return nil, err
	}

	db, err := sql.Open("sqlite3", dbPath+"?_journal_mode=WAL&_busy_timeout=5000&_foreign_keys=on")
	if err != nil {
		return nil, err
	}

	// Test the connection
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, err
	}

	// Run migrations
	if err := Migrate(db); err != nil {
		db.Close()
		return nil, err
	}

	return db, nil
}

// Close closes the database connection
func Close() error {
	if instance != nil {
		return instance.Close()
	}
	return nil
}

// ResetForTesting resets the singleton for testing purposes
// Only use in test code
func ResetForTesting() {
	if instance != nil {
		instance.Close()
		instance = nil
	}
	once = sync.Once{}
	initErr = nil
}
