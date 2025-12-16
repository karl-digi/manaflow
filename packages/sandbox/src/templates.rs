use crate::errors::{SandboxError, SandboxResult};
use crate::models::TemplateSummary;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tokio::fs;
use tokio::process::Command;
use tracing::{info, warn};

/// Template metadata stored alongside the tar archive.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct TemplateMetadata {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub size_bytes: u64,
    pub created_at: chrono::DateTime<Utc>,
}

impl From<TemplateMetadata> for TemplateSummary {
    fn from(meta: TemplateMetadata) -> Self {
        TemplateSummary {
            id: meta.id,
            name: meta.name,
            description: meta.description,
            size_bytes: meta.size_bytes,
            created_at: meta.created_at,
        }
    }
}

/// Manages filesystem templates for sandboxes.
pub struct TemplateStore {
    /// Directory where templates are stored
    templates_dir: PathBuf,
}

impl TemplateStore {
    pub async fn new(templates_dir: PathBuf) -> SandboxResult<Self> {
        // Ensure templates directory exists
        if !templates_dir.exists() {
            fs::create_dir_all(&templates_dir).await.map_err(|e| {
                SandboxError::Internal(format!(
                    "failed to create templates directory {:?}: {}",
                    templates_dir, e
                ))
            })?;
        }

        Ok(Self { templates_dir })
    }

    /// Generate a unique template ID.
    fn generate_id() -> String {
        let uuid = uuid::Uuid::new_v4();
        let short = &uuid.to_string()[..8];
        format!("tpl_{}", short)
    }

    /// Get the path to a template's tar archive.
    fn template_archive_path(&self, id: &str) -> PathBuf {
        self.templates_dir.join(format!("{}.tar.gz", id))
    }

    /// Get the path to a template's metadata file.
    fn template_metadata_path(&self, id: &str) -> PathBuf {
        self.templates_dir.join(format!("{}.json", id))
    }

    /// Create a template from a sandbox's filesystem.
    ///
    /// This tars the sandbox's root filesystem (excluding /workspace, /proc, /sys, /dev).
    pub async fn create_from_sandbox(
        &self,
        sandbox_root: &Path,
        name: String,
        description: Option<String>,
    ) -> SandboxResult<TemplateSummary> {
        let id = Self::generate_id();
        let archive_path = self.template_archive_path(&id);
        let metadata_path = self.template_metadata_path(&id);

        info!(
            "Creating template '{}' ({}) from {:?}",
            name, id, sandbox_root
        );

        // Create tar archive of the sandbox root
        // Exclude volatile directories
        let output = Command::new("tar")
            .args([
                "czf",
                archive_path
                    .to_str()
                    .ok_or_else(|| SandboxError::Internal("invalid archive path".into()))?,
                "-C",
                sandbox_root
                    .to_str()
                    .ok_or_else(|| SandboxError::Internal("invalid sandbox root path".into()))?,
                "--exclude=./proc/*",
                "--exclude=./sys/*",
                "--exclude=./dev/*",
                "--exclude=./run/*",
                "--exclude=./tmp/*",
                "--exclude=./workspace/*",
                ".",
            ])
            .output()
            .await
            .map_err(|e| SandboxError::Internal(format!("failed to run tar: {}", e)))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(SandboxError::Internal(format!("tar failed: {}", stderr)));
        }

        // Get archive size
        let archive_meta = fs::metadata(&archive_path).await.map_err(|e| {
            SandboxError::Internal(format!("failed to get archive metadata: {}", e))
        })?;
        let size_bytes = archive_meta.len();

        // Create and save metadata
        let metadata = TemplateMetadata {
            id: id.clone(),
            name,
            description,
            size_bytes,
            created_at: Utc::now(),
        };

        let metadata_json = serde_json::to_string_pretty(&metadata)
            .map_err(|e| SandboxError::Internal(format!("failed to serialize metadata: {}", e)))?;

        fs::write(&metadata_path, metadata_json)
            .await
            .map_err(|e| SandboxError::Internal(format!("failed to write metadata: {}", e)))?;

        info!("Template '{}' created: {} bytes", id, size_bytes);

        Ok(metadata.into())
    }

    /// Extract a template into a sandbox's root directory.
    pub async fn extract_to_sandbox(
        &self,
        template_id: &str,
        sandbox_root: &Path,
    ) -> SandboxResult<()> {
        let archive_path = self.template_archive_path(template_id);

        if !archive_path.exists() {
            return Err(SandboxError::NotFound(
                uuid::Uuid::nil(), // Template IDs aren't UUIDs, but we need to return something
            ));
        }

        info!(
            "Extracting template '{}' to {:?}",
            template_id, sandbox_root
        );

        // Ensure sandbox root exists
        if !sandbox_root.exists() {
            fs::create_dir_all(sandbox_root).await.map_err(|e| {
                SandboxError::Internal(format!("failed to create sandbox root: {}", e))
            })?;
        }

        // Extract tar archive
        let output = Command::new("tar")
            .args([
                "xzf",
                archive_path
                    .to_str()
                    .ok_or_else(|| SandboxError::Internal("invalid archive path".into()))?,
                "-C",
                sandbox_root
                    .to_str()
                    .ok_or_else(|| SandboxError::Internal("invalid sandbox root path".into()))?,
            ])
            .output()
            .await
            .map_err(|e| SandboxError::Internal(format!("failed to run tar: {}", e)))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(SandboxError::Internal(format!(
                "tar extract failed: {}",
                stderr
            )));
        }

        info!("Template '{}' extracted successfully", template_id);

        Ok(())
    }

    /// List all available templates.
    pub async fn list(&self) -> SandboxResult<Vec<TemplateSummary>> {
        let mut templates = Vec::new();

        let mut entries = fs::read_dir(&self.templates_dir).await.map_err(|e| {
            SandboxError::Internal(format!("failed to read templates directory: {}", e))
        })?;

        while let Some(entry) = entries
            .next_entry()
            .await
            .map_err(|e| SandboxError::Internal(format!("failed to read directory entry: {}", e)))?
        {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("json") {
                match self.load_metadata(&path).await {
                    Ok(meta) => templates.push(meta.into()),
                    Err(e) => {
                        warn!("Failed to load template metadata from {:?}: {}", path, e);
                    }
                }
            }
        }

        // Sort by creation date, newest first
        templates
            .sort_by(|a: &TemplateSummary, b: &TemplateSummary| b.created_at.cmp(&a.created_at));

        Ok(templates)
    }

    /// Get a template by ID.
    pub async fn get(&self, id: &str) -> SandboxResult<Option<TemplateSummary>> {
        let metadata_path = self.template_metadata_path(id);

        if !metadata_path.exists() {
            return Ok(None);
        }

        let meta = self.load_metadata(&metadata_path).await?;
        Ok(Some(meta.into()))
    }

    /// Delete a template.
    pub async fn delete(&self, id: &str) -> SandboxResult<bool> {
        let archive_path = self.template_archive_path(id);
        let metadata_path = self.template_metadata_path(id);

        if !metadata_path.exists() {
            return Ok(false);
        }

        // Remove both files
        if archive_path.exists() {
            fs::remove_file(&archive_path)
                .await
                .map_err(|e| SandboxError::Internal(format!("failed to delete archive: {}", e)))?;
        }

        fs::remove_file(&metadata_path)
            .await
            .map_err(|e| SandboxError::Internal(format!("failed to delete metadata: {}", e)))?;

        info!("Template '{}' deleted", id);

        Ok(true)
    }

    /// Rename a template.
    pub async fn rename(&self, id: &str, new_name: &str) -> SandboxResult<Option<TemplateSummary>> {
        let metadata_path = self.template_metadata_path(id);

        if !metadata_path.exists() {
            return Ok(None);
        }

        // Load existing metadata
        let mut metadata = self.load_metadata(&metadata_path).await?;

        // Update name
        let old_name = metadata.name.clone();
        metadata.name = new_name.to_string();

        // Save updated metadata
        let metadata_json = serde_json::to_string_pretty(&metadata)
            .map_err(|e| SandboxError::Internal(format!("failed to serialize metadata: {}", e)))?;

        fs::write(&metadata_path, metadata_json)
            .await
            .map_err(|e| SandboxError::Internal(format!("failed to write metadata: {}", e)))?;

        info!(
            "Template '{}' renamed from '{}' to '{}'",
            id, old_name, new_name
        );

        Ok(Some(metadata.into()))
    }

    /// Load metadata from a JSON file.
    async fn load_metadata(&self, path: &Path) -> SandboxResult<TemplateMetadata> {
        let content = fs::read_to_string(path)
            .await
            .map_err(|e| SandboxError::Internal(format!("failed to read metadata file: {}", e)))?;

        serde_json::from_str(&content)
            .map_err(|e| SandboxError::Internal(format!("failed to parse metadata: {}", e)))
    }

    /// Check if a template exists.
    pub fn exists(&self, id: &str) -> bool {
        self.template_metadata_path(id).exists()
    }

    /// Get the templates directory path.
    pub fn templates_dir(&self) -> &Path {
        &self.templates_dir
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[tokio::test]
    async fn test_template_store_create_and_list() {
        let temp_dir = TempDir::new().unwrap();
        let templates_dir = temp_dir.path().join("templates");
        let sandbox_root = temp_dir.path().join("sandbox");

        // Create a fake sandbox root with some files
        fs::create_dir_all(&sandbox_root).await.unwrap();
        fs::write(sandbox_root.join("test.txt"), "hello")
            .await
            .unwrap();
        fs::create_dir_all(sandbox_root.join("home")).await.unwrap();
        fs::write(sandbox_root.join("home").join(".bashrc"), "# bashrc")
            .await
            .unwrap();

        let store = TemplateStore::new(templates_dir).await.unwrap();

        // Create template
        let template = store
            .create_from_sandbox(&sandbox_root, "test-template".into(), Some("A test".into()))
            .await
            .unwrap();

        assert!(template.id.starts_with("tpl_"));
        assert_eq!(template.name, "test-template");
        assert!(template.size_bytes > 0);

        // List templates
        let templates = store.list().await.unwrap();
        assert_eq!(templates.len(), 1);
        assert_eq!(templates[0].id, template.id);

        // Get template
        let found = store.get(&template.id).await.unwrap();
        assert!(found.is_some());
        assert_eq!(found.unwrap().name, "test-template");

        // Delete template
        let deleted = store.delete(&template.id).await.unwrap();
        assert!(deleted);

        // Verify deleted
        let templates = store.list().await.unwrap();
        assert_eq!(templates.len(), 0);
    }
}
