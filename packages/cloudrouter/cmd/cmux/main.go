package main

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/karlorz/cloudrouter/internal/auth"
	"github.com/karlorz/cloudrouter/internal/cli"
	"github.com/karlorz/cloudrouter/internal/version"
)

// Build-time variables set via ldflags
var (
	Version   = "dev"
	Commit    = "unknown"
	BuildTime = "unknown"
	Mode      = "dev" // "dev" or "prod"
)

// loadEnvFile loads environment variables from a .env file.
// It does not override existing environment variables.
func loadEnvFile(path string) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		// Skip empty lines and comments
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		// Parse KEY=value
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.TrimSpace(parts[0])
		value := strings.TrimSpace(parts[1])
		// Remove surrounding quotes if present
		if len(value) >= 2 {
			if (value[0] == '"' && value[len(value)-1] == '"') ||
				(value[0] == '\'' && value[len(value)-1] == '\'') {
				value = value[1 : len(value)-1]
			}
		}
		// Don't override existing env vars
		if os.Getenv(key) == "" {
			os.Setenv(key, value)
		}
	}
	return scanner.Err()
}

// findAndLoadEnvFile searches for .env file in current directory and parent directories.
func findAndLoadEnvFile() {
	// Try current directory first
	if _, err := os.Stat(".env"); err == nil {
		if err := loadEnvFile(".env"); err == nil {
			return
		}
	}

	// Walk up to find .env in parent directories (up to 5 levels)
	dir, err := os.Getwd()
	if err != nil {
		return
	}
	for i := 0; i < 5; i++ {
		envPath := filepath.Join(dir, ".env")
		if _, err := os.Stat(envPath); err == nil {
			loadEnvFile(envPath)
			return
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
}

func main() {
	// Load .env file before anything else (like other scripts in the project)
	findAndLoadEnvFile()

	cli.SetVersionInfo(Version, Commit, BuildTime)
	cli.SetBuildMode(Mode)
	auth.SetBuildMode(Mode)
	version.SetCurrentVersion(Version)

	if os.Getenv("CMUX_E2B_DEV") == "" && os.Getenv("CMUX_E2B_PROD") == "" {
		if Mode == "dev" {
			os.Setenv("CMUX_E2B_DEV", "1")
		}
	}

	if err := cli.Execute(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}
