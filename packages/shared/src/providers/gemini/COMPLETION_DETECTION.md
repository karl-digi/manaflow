# Gemini CLI Completion Detection

This document describes the completion detection system for Gemini CLI, which monitors telemetry events to determine when the CLI has finished processing or is waiting for user input.

## Overview

The Gemini CLI emits telemetry events in OTLP format to a local log file. By monitoring these events, we can detect various completion states:

1. **Turn Completion** (`next_speaker_check`) - Gemini finishes a turn and either waits for user input or auto-continues
2. **Task Completion** (`complete_task` tool call) - Agent explicitly calls the complete_task function
3. **Agent Finish** (`agent.finish`) - Agent completes with a terminate reason (GOAL, TIMEOUT, etc.)
4. **Session End** (`conversation_finished`) - The entire conversation session ends

## Detection Signals

### 1. next_speaker_check

**Event**: `gemini_cli.next_speaker_check`

This event fires after each turn when there are no pending tool calls. It contains:
- `result`: Either `"user"` or `"model"`
  - `"user"`: Gemini is done and waiting for user input
  - `"model"`: CLI will auto-send another "continue" prompt
- `finish_reason`: The model's finish reason (e.g., "STOP", "MAX_TOKENS")

**Note**: This signal only fires when `model.skipNextSpeakerCheck` is false in `.gemini/settings.json`.

### 2. complete_task Tool Call

**Event**: `gemini_cli.tool_call` with `function_name: "complete_task"`

When working with declarative tasks (agents), this tool call indicates the agent believes the task is complete.

### 3. agent.finish

**Event**: `gemini_cli.agent.finish`

Emitted after a `complete_task` tool call. Contains:
- `terminate_reason`: Why the agent finished
  - `"GOAL"`: Task completed successfully
  - `"TIMEOUT"`: Agent exceeded time/turn limits
  - `"ERROR"`: An error occurred
- `turn_count`: Number of turns taken
- `duration_ms`: Total execution time in milliseconds

### 4. conversation_finished

**Event**: `gemini_cli.conversation_finished`

Marks session-wide teardown. Contains:
- `turn_count`: Total turns in the conversation

## Usage

### Basic Usage (Default Behavior)

The simplest use case is waiting for Gemini to hand control back to the user:

```typescript
import { startGeminiCompletionDetector } from './completion-detector';

const taskRunId = 'my-task-123';

// This resolves when Gemini is waiting for user input
await startGeminiCompletionDetector(taskRunId);
console.log('Gemini is ready for user input!');
```

### Advanced Usage with Callbacks

For more control, use the advanced detector to handle multiple event types:

```typescript
import { createAdvancedGeminiCompletionDetector } from './advanced-completion-detector';

const detector = createAdvancedGeminiCompletionDetector(taskRunId, {
  onNextSpeakerCheck: (event) => {
    if (event.data.result === 'user') {
      console.log('Ready for user input');
    } else if (event.data.result === 'model') {
      console.log('Auto-continuing...');
    }
  },

  onAgentCompleteTask: (event) => {
    console.log('Agent called complete_task');
  },

  onAgentFinish: (event) => {
    const { terminateReason, turnCount, durationMs } = event.data;
    console.log(`Agent finished: ${terminateReason}`);
    console.log(`Took ${turnCount} turns in ${durationMs}ms`);
  },

  onConversationFinished: (event) => {
    console.log(`Session ended after ${event.data.turnCount} turns`);
  },
});

// Start watching
await detector.start();

// Later, stop watching
detector.stop();
```

### Helper Functions

#### Wait for User Turn

```typescript
import { waitForUserTurn } from './advanced-completion-detector';

// Resolves when result="user" in next_speaker_check
const event = await waitForUserTurn(taskRunId);
console.log(`Finish reason: ${event.data.finishReason}`);
```

#### Wait for Agent Completion

```typescript
import { waitForAgentFinish } from './advanced-completion-detector';

// Wait for successful completion
const event = await waitForAgentFinish(taskRunId, 'GOAL');
console.log(`Completed in ${event.data.durationMs}ms`);

// Or wait for any termination
const event = await waitForAgentFinish(taskRunId);
```

#### Wait for Custom Event

```typescript
import { waitForGeminiEvent } from './advanced-completion-detector';

// Wait for conversation to end
const event = await waitForGeminiEvent(taskRunId, 'conversation_finished');

// Wait with custom predicate
const event = await waitForGeminiEvent(
  taskRunId,
  'agent_finish',
  (event) => event.data.terminateReason === 'TIMEOUT'
);
```

## Command Line Tool

A command-line script is available for testing and debugging:

```bash
# Wait for user turn (default)
node scripts/watch-gemini-telemetry.js --file /tmp/gemini-telemetry-123.log

# Wait for agent completion
node scripts/watch-gemini-telemetry.js \
  --file ./telemetry.log \
  --event agent_finish \
  --verbose

# Show all events (debugging)
node scripts/watch-gemini-telemetry.js \
  --file ./telemetry.log \
  --all-events \
  --verbose

# Filter by session ID
node scripts/watch-gemini-telemetry.js \
  --file ./telemetry.log \
  --session abc-123-def \
  --event next_speaker_check
```

### Command Line Options

- `--file <path>`: Path to telemetry log file
- `--event <type>`: Event type to wait for
  - `next_speaker_check` (default)
  - `agent_finish`
  - `complete_task`
  - `conversation_finished`
- `--session <id>`: Filter by session ID
- `--from-start`, `-A`: Read from start of file (default: tail from end)
- `--verbose`, `-v`: Show detailed event information
- `--all-events`: Show all telemetry events (for debugging)
- `--help`, `-h`: Show help message

## Configuration

### Enabling Telemetry

Telemetry must be enabled when launching Gemini CLI:

```bash
bunx @google/gemini-cli \
  --telemetry \
  --telemetry-target=local \
  --telemetry-outfile=/tmp/gemini-telemetry-$TASK_ID.log \
  --telemetry-log-prompts
```

### Enabling next_speaker_check Events

In `.gemini/settings.json`, ensure:

```json
{
  "model": {
    "skipNextSpeakerCheck": false
  }
}
```

If `skipNextSpeakerCheck` is true, the `next_speaker_check` events will not be emitted.

## Telemetry File Format

The telemetry file contains concatenated JSON objects (one per line) in OTLP format:

```json
{
  "attributes": {
    "event.name": "gemini_cli.next_speaker_check",
    "result": "user",
    "finish_reason": "STOP",
    "session.id": "abc-123-def",
    "prompt_id": "xyz-456"
  }
}
{
  "attributes": {
    "event.name": "gemini_cli.agent.finish",
    "terminate_reason": "GOAL",
    "turn_count": 5,
    "duration_ms": 12500
  }
}
```

## Parsing Telemetry

The JSON objects are concatenated without commas or array brackets. Use the built-in streaming parser:

```typescript
// Example: Parse telemetry file manually
import { createReadStream } from 'node:fs';

const parser = new JsonStreamParser((obj) => {
  console.log('Event:', obj);
});

const stream = createReadStream('/tmp/gemini-telemetry.log', 'utf-8');
stream.on('data', (chunk) => parser.push(chunk));
```

Or use `jq` from the command line:

```bash
# Filter for next_speaker_check events
jq -c 'select(.attributes["event.name"]=="gemini_cli.next_speaker_check")' telemetry.log

# Show events with result="user"
jq -c 'select(.attributes["event.name"]=="gemini_cli.next_speaker_check" and .attributes.result=="user")' telemetry.log

# Show agent finish events
jq -c 'select(.attributes["event.name"]=="gemini_cli.agent.finish")' telemetry.log
```

## Integration with cmux

In the cmux project, completion detection is configured per agent:

```typescript
export const GEMINI_FLASH_CONFIG: AgentConfig = {
  name: "gemini/2.5-flash",
  command: "bunx",
  args: [
    "@google/gemini-cli@latest",
    "--telemetry",
    "--telemetry-target=local",
    "--telemetry-outfile=/tmp/gemini-telemetry-$CMUX_TASK_RUN_ID.log",
    // ... other args
  ],
  completionDetector: startGeminiCompletionDetector,
};
```

The `completionDetector` function is called with the task run ID and should return a Promise that resolves when the agent is ready for user input.

## Troubleshooting

### Events Not Appearing

1. Ensure telemetry is enabled with `--telemetry` flag
2. Check that `--telemetry-target=local` is set
3. Verify `--telemetry-outfile` path is correct
4. For `next_speaker_check`: Ensure `model.skipNextSpeakerCheck` is false

### File Not Found

The telemetry file is created on first write. If watching from the start of execution, the file may not exist yet. The detector automatically waits for the file to be created.

### Missing Events

Some events only fire in specific contexts:
- `complete_task` and `agent.finish` only fire when using agent/task mode
- `conversation_finished` only fires on graceful session termination
- `next_speaker_check` requires `skipNextSpeakerCheck: false`

## Performance Considerations

- The detector tails from the end of the file by default to avoid scanning large logs
- Use `--from-start` only when you need to process historical events
- The streaming parser has minimal memory overhead (< 1KB buffer)
- File watching uses native OS events (inotify on Linux, FSEvents on macOS)

## Future Enhancements

Potential improvements to the completion detection system:

1. **Metrics Dashboard**: Aggregate events to show real-time stats
   - Auto-follow-up rate (result="model" events)
   - Average turn duration
   - Truncation frequency (finish_reason analysis)

2. **Multi-Event Predicates**: Wait for complex conditions
   - "Wait until 3 user turns OR agent finishes"
   - "Wait for specific tool calls"

3. **Remote Telemetry**: Support OTLP endpoint in addition to local files

4. **Event Replay**: Replay telemetry files for testing and debugging
