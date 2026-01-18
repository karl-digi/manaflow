//! In-memory ACP event streaming store for sandbox -> browser streaming.
//!
//! Provides offset-based reads with long-poll support and basic retention.

use std::collections::VecDeque;
use std::sync::Arc;
use std::time::Duration;

use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use tokio::sync::{Mutex, Notify};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamEvent {
    pub seq: u64,
    pub raw: String,
    #[serde(rename = "createdAt")]
    pub created_at: u64,
    #[serde(rename = "eventType", skip_serializing_if = "Option::is_none")]
    pub event_type: Option<String>,
}

#[derive(Debug, Clone, Copy)]
pub enum StreamOffset {
    Start,
    Now,
    Value(u64),
}

#[derive(Debug, Clone)]
pub struct StreamReadResult {
    pub events: Vec<StreamEvent>,
    pub next_offset: u64,
    pub up_to_date: bool,
    pub truncated: bool,
    pub min_seq: Option<u64>,
    pub max_seq: u64,
}

struct StreamConversation {
    inner: Mutex<StreamConversationState>,
    notify: Notify,
}

struct StreamConversationState {
    events: VecDeque<StreamEvent>,
    max_seq: u64,
}

impl StreamConversation {
    fn new() -> Self {
        Self {
            inner: Mutex::new(StreamConversationState {
                events: VecDeque::new(),
                max_seq: 0,
            }),
            notify: Notify::new(),
        }
    }
}

#[derive(Clone)]
pub struct StreamStore {
    conversations: DashMap<String, Arc<StreamConversation>>,
    max_events: usize,
}

impl StreamStore {
    pub fn new(max_events: usize) -> Self {
        Self {
            conversations: DashMap::new(),
            max_events: max_events.max(1),
        }
    }

    pub fn ensure_conversation(&self, conversation_id: &str) {
        self.conversations
            .entry(conversation_id.to_string())
            .or_insert_with(|| Arc::new(StreamConversation::new()));
    }

    pub async fn append(&self, conversation_id: &str, event: StreamEvent) {
        let entry = self
            .conversations
            .entry(conversation_id.to_string())
            .or_insert_with(|| Arc::new(StreamConversation::new()));
        let conversation = entry.value().clone();

        {
            let mut state = conversation.inner.lock().await;
            state.max_seq = state.max_seq.max(event.seq);
            state.events.push_back(event);
            while state.events.len() > self.max_events {
                state.events.pop_front();
            }
        }

        conversation.notify.notify_waiters();
    }

    pub async fn read(
        &self,
        conversation_id: &str,
        offset: StreamOffset,
    ) -> Option<StreamReadResult> {
        let conversation = self.conversations.get(conversation_id)?.clone();
        let state = conversation.inner.lock().await;

        let min_seq = state.events.front().map(|event| event.seq);
        let max_seq = state.max_seq;

        if state.events.is_empty() {
            return Some(StreamReadResult {
                events: Vec::new(),
                next_offset: max_seq,
                up_to_date: true,
                truncated: false,
                min_seq,
                max_seq,
            });
        }

        match offset {
            StreamOffset::Start => {
                let events = state.events.iter().cloned().collect::<Vec<_>>();
                let next_offset = events.last().map(|event| event.seq).unwrap_or(max_seq);
                Some(StreamReadResult {
                    events,
                    next_offset,
                    up_to_date: true,
                    truncated: false,
                    min_seq,
                    max_seq,
                })
            }
            StreamOffset::Now => Some(StreamReadResult {
                events: Vec::new(),
                next_offset: max_seq,
                up_to_date: true,
                truncated: false,
                min_seq,
                max_seq,
            }),
            StreamOffset::Value(value) => {
                let truncated = min_seq
                    .map(|min| value + 1 < min)
                    .unwrap_or(false);

                if truncated {
                    return Some(StreamReadResult {
                        events: Vec::new(),
                        next_offset: max_seq,
                        up_to_date: false,
                        truncated: true,
                        min_seq,
                        max_seq,
                    });
                }

                let events = state
                    .events
                    .iter()
                    .filter(|event| event.seq > value)
                    .cloned()
                    .collect::<Vec<_>>();
                let next_offset = events.last().map(|event| event.seq).unwrap_or(max_seq);
                let up_to_date = events.is_empty() && value >= max_seq;

                Some(StreamReadResult {
                    events,
                    next_offset,
                    up_to_date,
                    truncated: false,
                    min_seq,
                    max_seq,
                })
            }
        }
    }

    pub async fn wait_for_events(
        &self,
        conversation_id: &str,
        offset: u64,
        timeout: Duration,
    ) -> Option<StreamReadResult> {
        let initial = self
            .read(conversation_id, StreamOffset::Value(offset))
            .await?;
        let conversation = self.conversations.get(conversation_id)?.clone();

        if initial.truncated || !initial.events.is_empty() || !initial.up_to_date {
            return Some(initial);
        }

        let notified = conversation.notify.notified();
        if tokio::time::timeout(timeout, notified).await.is_err() {
            return Some(initial);
        }

        self.read(conversation_id, StreamOffset::Value(offset)).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_event(seq: u64) -> StreamEvent {
        StreamEvent {
            seq,
            raw: format!("{{\"seq\":{seq}}}"),
            created_at: 1_700_000_000_000,
            event_type: None,
        }
    }

    #[tokio::test]
    async fn read_respects_offsets_and_truncation() {
        let store = StreamStore::new(2);
        store.append("conv", make_event(1)).await;
        store.append("conv", make_event(2)).await;
        store.append("conv", make_event(3)).await;

        let read_from_one = store
            .read("conv", StreamOffset::Value(1))
            .await
            .expect("read");
        assert_eq!(read_from_one.events.len(), 2);
        assert_eq!(read_from_one.events[0].seq, 2);
        assert_eq!(read_from_one.events[1].seq, 3);
        assert!(!read_from_one.truncated);

        let truncated = store
            .read("conv", StreamOffset::Value(0))
            .await
            .expect("read");
        assert!(truncated.truncated);
        assert!(truncated.events.is_empty());
    }

    #[tokio::test]
    async fn wait_for_events_returns_after_append() {
        let store = StreamStore::new(10);
        store.ensure_conversation("conv");

        let waiter = tokio::spawn({
            let store = store.clone();
            async move {
                store
                    .wait_for_events("conv", 0, Duration::from_millis(200))
                    .await
            }
        });

        tokio::time::sleep(Duration::from_millis(50)).await;
        store.append("conv", make_event(1)).await;

        let result = waiter.await.expect("waiter join");
        let read = result.expect("read result");
        assert_eq!(read.events.len(), 1);
        assert_eq!(read.events[0].seq, 1);
    }
}
