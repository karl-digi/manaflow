// internal/fs/ops.go
package fs

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// CopyResult is the result of copying a file
type CopyResult struct {
	Source      string `json:"source"`
	Destination string `json:"destination"`
	BytesCopied int64  `json:"bytes_copied"`
}

// MoveResult is the result of moving a file
type MoveResult struct {
	Source      string `json:"source"`
	Destination string `json:"destination"`
	Success     bool   `json:"success"`
}

// RemoveResult is the result of removing a file
type RemoveResult struct {
	Path    string `json:"path"`
	Success bool   `json:"success"`
}

// MkdirResult is the result of creating a directory
type MkdirResult struct {
	Path    string `json:"path"`
	Success bool   `json:"success"`
}

// Copy copies a file or directory
func Copy(projectPath, src, dst string, recursive bool) (*CopyResult, error) {
	srcPath := filepath.Join(projectPath, src)
	dstPath := filepath.Join(projectPath, dst)

	info, err := os.Stat(srcPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("source not found: %s", src)
		}
		return nil, err
	}

	if info.IsDir() {
		if !recursive {
			return nil, fmt.Errorf("source is a directory, use --recursive")
		}
		return copyDir(src, dst, srcPath, dstPath)
	}

	return copyFile(src, dst, srcPath, dstPath)
}

func copyFile(src, dst, srcPath, dstPath string) (*CopyResult, error) {
	srcFile, err := os.Open(srcPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open source file: %w", err)
	}
	defer srcFile.Close()

	// Create destination directory if needed
	dstDir := filepath.Dir(dstPath)
	if err := os.MkdirAll(dstDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create destination directory: %w", err)
	}

	dstFile, err := os.Create(dstPath)
	if err != nil {
		return nil, fmt.Errorf("failed to create destination file: %w", err)
	}
	defer dstFile.Close()

	n, err := io.Copy(dstFile, srcFile)
	if err != nil {
		return nil, fmt.Errorf("failed to copy file: %w", err)
	}

	// Preserve permissions
	srcInfo, _ := os.Stat(srcPath)
	if srcInfo != nil {
		os.Chmod(dstPath, srcInfo.Mode())
	}

	return &CopyResult{
		Source:      src,
		Destination: dst,
		BytesCopied: n,
	}, nil
}

func copyDir(src, dst, srcPath, dstPath string) (*CopyResult, error) {
	var totalBytes int64

	err := filepath.Walk(srcPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		relPath, _ := filepath.Rel(srcPath, path)
		targetPath := filepath.Join(dstPath, relPath)

		if info.IsDir() {
			return os.MkdirAll(targetPath, info.Mode())
		}

		result, err := copyFile("", "", path, targetPath)
		if err != nil {
			return err
		}
		totalBytes += result.BytesCopied

		return nil
	})

	if err != nil {
		return nil, err
	}

	return &CopyResult{
		Source:      src,
		Destination: dst,
		BytesCopied: totalBytes,
	}, nil
}

// Move moves a file or directory
func Move(projectPath, src, dst string) (*MoveResult, error) {
	srcPath := filepath.Join(projectPath, src)
	dstPath := filepath.Join(projectPath, dst)

	// Check source exists
	if _, err := os.Stat(srcPath); err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("source not found: %s", src)
		}
		return nil, err
	}

	// Create destination directory if needed
	dstDir := filepath.Dir(dstPath)
	if err := os.MkdirAll(dstDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create destination directory: %w", err)
	}

	if err := os.Rename(srcPath, dstPath); err != nil {
		return nil, fmt.Errorf("failed to move: %w", err)
	}

	return &MoveResult{
		Source:      src,
		Destination: dst,
		Success:     true,
	}, nil
}

// Remove removes a file or directory
func Remove(projectPath, path string, recursive bool) (*RemoveResult, error) {
	fullPath := filepath.Join(projectPath, path)

	info, err := os.Stat(fullPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("path not found: %s", path)
		}
		return nil, err
	}

	if info.IsDir() && !recursive {
		return nil, fmt.Errorf("path is a directory, use --recursive")
	}

	if recursive {
		err = os.RemoveAll(fullPath)
	} else {
		err = os.Remove(fullPath)
	}

	if err != nil {
		return nil, fmt.Errorf("failed to remove: %w", err)
	}

	return &RemoveResult{
		Path:    path,
		Success: true,
	}, nil
}

// Mkdir creates a directory
func Mkdir(projectPath, path string, parents bool) (*MkdirResult, error) {
	fullPath := filepath.Join(projectPath, path)

	var err error
	if parents {
		err = os.MkdirAll(fullPath, 0755)
	} else {
		err = os.Mkdir(fullPath, 0755)
	}

	if err != nil {
		return nil, fmt.Errorf("failed to create directory: %w", err)
	}

	return &MkdirResult{
		Path:    path,
		Success: true,
	}, nil
}

// TextOutput returns human-readable output for CopyResult
func (r *CopyResult) TextOutput() string {
	return fmt.Sprintf("Copied %s -> %s (%d bytes)", r.Source, r.Destination, r.BytesCopied)
}

// TextOutput returns human-readable output for MoveResult
func (r *MoveResult) TextOutput() string {
	return fmt.Sprintf("Moved %s -> %s", r.Source, r.Destination)
}

// TextOutput returns human-readable output for RemoveResult
func (r *RemoveResult) TextOutput() string {
	return fmt.Sprintf("Removed %s", r.Path)
}

// TextOutput returns human-readable output for MkdirResult
func (r *MkdirResult) TextOutput() string {
	return fmt.Sprintf("Created directory %s", r.Path)
}
