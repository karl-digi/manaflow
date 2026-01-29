// internal/db/migrations.go
package db

import (
	"database/sql"
)

// Migrate runs database migrations
func Migrate(db *sql.DB) error {
	// First check if schema_version table exists
	var tableExists int
	err := db.QueryRow(`
		SELECT COUNT(*) FROM sqlite_master
		WHERE type='table' AND name='schema_version'
	`).Scan(&tableExists)
	if err != nil {
		return err
	}

	var currentVersion int
	if tableExists > 0 {
		err := db.QueryRow("SELECT version FROM schema_version LIMIT 1").Scan(&currentVersion)
		if err != nil && err != sql.ErrNoRows {
			return err
		}
	}

	if currentVersion < SchemaVersion {
		// Run schema creation
		if _, err := db.Exec(CreateSchema()); err != nil {
			return err
		}

		// Update version
		_, err := db.Exec(`
			INSERT OR REPLACE INTO schema_version (version) VALUES (?)
		`, SchemaVersion)
		if err != nil {
			return err
		}
	}

	// Add future migrations here
	// if currentVersion < 2 {
	//     if err := migrateV1ToV2(db); err != nil {
	//         return err
	//     }
	// }

	return nil
}

// MigrateFromVersion runs migrations from a specific version
// This is useful for upgrading existing databases
func MigrateFromVersion(db *sql.DB, fromVersion int) error {
	// Add future migrations here as needed
	// For now, just ensure we're at the current version
	return Migrate(db)
}

// GetSchemaVersion returns the current schema version in the database
func GetSchemaVersion(db *sql.DB) (int, error) {
	var tableExists int
	err := db.QueryRow(`
		SELECT COUNT(*) FROM sqlite_master
		WHERE type='table' AND name='schema_version'
	`).Scan(&tableExists)
	if err != nil {
		return 0, err
	}

	if tableExists == 0 {
		return 0, nil
	}

	var version int
	err = db.QueryRow("SELECT version FROM schema_version LIMIT 1").Scan(&version)
	if err == sql.ErrNoRows {
		return 0, nil
	}
	return version, err
}
