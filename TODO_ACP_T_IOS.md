# ACP + /t + iOS TODOs

## /t (web conversations)
- [ ] Add conversation actions: rename, pin, delete, archive (Convex mutations + UI controls in sidebar and header).
- [ ] Support attachments in the sidebar “start a new conversation” flow (reuse composer upload pipeline).
- [ ] Improve sidebar compose UI (layout, affordances, quick actions, and error states).
- [ ] Improve main conversation UI (message layout, composer, status, and readability).
- [ ] Create multiple UI variants for sidebar + main thread, with a toggle to compare options.
- [ ] Add a “conversation details” panel (show provider/model, cwd, sandbox status, createdAt, lastMessageAt).
- [ ] Ensure optimistic updates cover all message types (text + resource_link + image) and dedupe by clientMessageId.
- [ ] Add quick-switch keyboard shortcuts for conversation list (up/down, open, new).
- [ ] Add a compact “summarize conversation” action (store summary in Convex + show in sidebar preview).

## ACP (Agent Client Protocol)
- [ ] `startConversation` should recover when an existing `clientConversationId` has no sandbox (allocate or reattach instead of throwing).
- [ ] Idempotent “create conversation + first message” path: reuse existing conversation/message when clientConversationId/clientMessageId repeats.
- [ ] Track delivery state transitions consistently (queued -> sent/error) and surface them in UI stream events.
- [ ] Add explicit ACP error events for sandbox replacement retries so UI can show “recovering sandbox”.
- [ ] Add rate-limited retry/backoff for `deliverMessageInternal` when sandbox is starting.

## iOS app
- [ ] Implement delete conversation via Convex (currently TODO in `ios-app/Sources/ConversationListView.swift`).
- [ ] Add conversation actions parity: rename, pin, archive.
- [ ] Add optimistic send (local message bubble + delivery status) aligned with web behavior.
- [ ] Add attachment upload support and render images/resources in chat.

## Summarization prompt (Crown)
- [ ] Update `packages/convex/convex/crown/actions.ts` summarization prompt to **force third‑person POV**.
  - Explicitly forbid “I/we/my” phrasing.
  - Add a brief post‑check that rejects first‑person output and retries once.
- [ ] Add a small test fixture to confirm summaries never use first‑person pronouns.
