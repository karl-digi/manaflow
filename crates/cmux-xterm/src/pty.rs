use portable_pty::{Child, CommandBuilder, NativePtySystem, PtyPair, PtySize, PtySystem};
use std::io::{Read, Write};
use std::sync::Arc;

pub struct Pty {
    pub pair: PtyPair,
}

impl Pty {
    pub fn open(cols: u16, rows: u16) -> anyhow::Result<Self> {
        let pty_system = NativePtySystem::default();
        let size = PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        };
        let pair = pty_system.openpty(size)?;
        Ok(Self { pair })
    }

    pub fn spawn_shell(&mut self, cmd: Option<&str>, args: Vec<String>) -> anyhow::Result<Box<dyn Child + Send>> {
        let shell = cmd
            .map(|s| s.to_string())
            .or_else(|| std::env::var("SHELL").ok())
            .unwrap_or_else(|| "/bin/bash".to_string());
        let mut builder = CommandBuilder::new(shell);
        if !args.is_empty() {
            builder.args(args.iter().map(|s| s.as_str()));
        }
        // Ensure TERM is set so full-screen apps behave correctly
        builder.env("TERM", std::env::var("TERM").unwrap_or_else(|_| "xterm-256color".to_string()));
        let child = self.pair.slave.spawn_command(builder)?;
        Ok(child)
    }
}

pub type PtyReader = Box<dyn Read + Send>;
pub type PtyWriter = Box<dyn Write + Send>;
