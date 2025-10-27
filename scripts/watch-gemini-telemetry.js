#!/usr/bin/env node
/**
 * Enhanced watcher for Gemini CLI telemetry file.
 *
 * Supports multiple completion detection modes:
 *  1. next_speaker_check: Detects when Gemini hands control to user or continues auto-follow-up
 *  2. agent_finish: Detects when an agent task completes (with terminate_reason)
 *  3. complete_task: Detects when complete_task tool is called
 *  4. conversation_finished: Detects session-wide teardown
 *
 * Usage:
 *   node scripts/watch-gemini-telemetry.js --file ./gemini-telemetry.log
 *   node scripts/watch-gemini-telemetry.js --file ./gemini-telemetry.log --event agent_finish
 *   node scripts/watch-gemini-telemetry.js --file ./gemini-telemetry.log --session <session-id>
 *   node scripts/watch-gemini-telemetry.js --file ./gemini-telemetry.log --from-start --verbose
 *   node scripts/watch-gemini-telemetry.js --file ./gemini-telemetry.log --all-events
 *
 * Default behavior: Waits for next_speaker_check with result="user" and starts tailing from end.
 */

const fs = require('node:fs');
const path = require('node:path');

function parseArgs(argv) {
  const args = {
    file: 'gemini-telemetry.log',
    fromStart: false,
    session: undefined,
    event: 'next_speaker_check', // Default: wait for user turn
    verbose: false,
    allEvents: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file' && i + 1 < argv.length) {
      args.file = argv[++i];
    } else if (a === '--from-start' || a === '-A') {
      args.fromStart = true;
    } else if (a === '--session' && i + 1 < argv.length) {
      args.session = argv[++i];
    } else if (a === '--event' && i + 1 < argv.length) {
      args.event = argv[++i];
    } else if (a === '--verbose' || a === '-v') {
      args.verbose = true;
    } else if (a === '--all-events') {
      args.allEvents = true;
    } else if (a === '--help' || a === '-h') {
      console.log(`Usage: watch-gemini-telemetry [options]

Options:
  --file <path>           Path to telemetry log file (default: gemini-telemetry.log)
  --event <type>          Event type to wait for:
                            next_speaker_check (default) - Wait for user turn
                            agent_finish - Wait for agent completion
                            complete_task - Wait for complete_task tool call
                            conversation_finished - Wait for session end
  --session <id>          Filter by session ID
  --from-start, -A        Read from start of file (default: tail from end)
  --verbose, -v           Show detailed event information
  --all-events            Show all telemetry events (for debugging)
  --help, -h              Show this help message

Examples:
  # Wait for Gemini to hand control to user
  watch-gemini-telemetry --file /tmp/gemini-telemetry-123.log

  # Wait for agent to finish successfully
  watch-gemini-telemetry --file ./telemetry.log --event agent_finish

  # Show all events with details
  watch-gemini-telemetry --file ./telemetry.log --all-events --verbose
`);
      process.exit(0);
    }
  }
  return args;
}

// Stream JSON objects concatenated without commas by tracking brace depth.
class JsonStreamParser {
  constructor(onObject) {
    this.onObject = onObject;
    this.reset();
  }
  reset() {
    this.depth = 0;
    this.inString = false;
    this.escape = false;
    this.collecting = false;
    this.buf = '';
  }
  push(chunk) {
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i];
      if (this.inString) {
        this.buf += ch;
        if (this.escape) {
          this.escape = false;
        } else if (ch === '\\') {
          this.escape = true;
        } else if (ch === '"') {
          this.inString = false;
        }
        continue;
      }
      // Not in string
      if (ch === '"') {
        this.inString = true;
        if (this.collecting) this.buf += ch;
        continue;
      }
      if (ch === '{') {
        if (!this.collecting) {
          this.collecting = true;
          this.buf = '{';
          this.depth = 1;
        } else {
          this.depth++;
          this.buf += ch;
        }
        continue;
      }
      if (ch === '}') {
        if (this.collecting) {
          this.depth--;
          this.buf += ch;
          if (this.depth === 0) {
            // Complete JSON object
            try {
              const obj = JSON.parse(this.buf);
              this.onObject(obj);
            } catch (e) {
              // Ignore parse error; continue
            }
            this.collecting = false;
            this.buf = '';
          }
        }
        continue;
      }
      if (this.collecting) {
        this.buf += ch;
      }
    }
  }
}

/**
 * Extract attributes from telemetry object (handles multiple formats)
 */
function getAttributes(obj) {
  if (!obj || typeof obj !== 'object') return null;
  return obj.attributes || obj.resource?.attributes || obj.body?.attributes || obj['attributes'];
}

/**
 * Check if event matches the target criteria
 */
function matchesTarget(obj, targetSession, targetEvent, verbose, allEvents) {
  const attrs = getAttributes(obj);
  if (!attrs || typeof attrs !== 'object') return false;

  const eventName = attrs['event.name'] || attrs.event?.name || attrs['event_name'];
  const sessionId = attrs['session.id'] || attrs['sessionId'] || attrs.sessionId;

  // Filter by session if specified
  if (targetSession && sessionId !== targetSession) return false;

  // If --all-events is set, show everything
  if (allEvents) {
    if (verbose && eventName) {
      console.log(`[${eventName}]`, JSON.stringify(attrs, null, 2));
    } else if (eventName) {
      console.log(`[${eventName}]`);
    }
    return false; // Don't exit, keep watching
  }

  // Match specific event types
  switch (targetEvent) {
    case 'next_speaker_check': {
      if (eventName === 'gemini_cli.next_speaker_check') {
        const result = attrs['result'] || attrs.result;
        const finishReason = attrs['finish_reason'];
        if (result === 'user') {
          if (verbose) {
            console.log('Gemini waiting for user input', { result, finishReason });
          }
          return true;
        }
        if (result === 'model' && verbose) {
          console.log('Gemini auto-continuing', { result, finishReason });
        }
      }
      break;
    }

    case 'agent_finish': {
      if (eventName === 'gemini_cli.agent.finish') {
        const terminateReason = attrs['terminate_reason'];
        const turnCount = attrs['turn_count'];
        const durationMs = attrs['duration_ms'];
        if (verbose) {
          console.log('Agent finished', { terminateReason, turnCount, durationMs });
        }
        return true;
      }
      break;
    }

    case 'complete_task': {
      if (eventName === 'gemini_cli.tool_call') {
        const functionName = attrs['function_name'];
        if (functionName === 'complete_task') {
          if (verbose) {
            console.log('Agent called complete_task', { functionName });
          }
          return true;
        }
      }
      break;
    }

    case 'conversation_finished': {
      if (eventName === 'gemini_cli.conversation_finished') {
        const turnCount = attrs['turn_count'];
        if (verbose) {
          console.log('Conversation finished', { turnCount });
        }
        return true;
      }
      break;
    }
  }

  return false;
}

async function main() {
  const { file, fromStart, session, event, verbose, allEvents } = parseArgs(process.argv);
  const filePath = path.resolve(process.cwd(), file);

  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  if (verbose) {
    console.log(`Watching ${filePath}`);
    console.log(`Event type: ${event}`);
    if (session) console.log(`Session filter: ${session}`);
    if (allEvents) console.log(`Mode: Show all events`);
  }

  let position = 0;
  try {
    const stat = fs.statSync(filePath);
    position = fromStart ? 0 : stat.size; // tail from end by default
  } catch (e) {
    console.error(`Cannot stat file: ${e.message}`);
    process.exit(1);
  }

  const parser = new JsonStreamParser((obj) => {
    if (matchesTarget(obj, session, event, verbose, allEvents)) {
      // Print DONE and a bell character for audible notification if supported
      process.stdout.write('DONE\n');
      process.stdout.write('\x07');
      process.exit(0);
    }
  });

  // Read the initial segment if starting from beginning
  function readSlice(start, end) {
    return new Promise((resolve) => {
      if (end <= start) return resolve();
      const rs = fs.createReadStream(filePath, { start, end: end - 1, encoding: 'utf8' });
      rs.on('data', (chunk) => parser.push(chunk));
      rs.on('end', resolve);
      rs.on('error', () => resolve());
    });
  }

  if (fromStart) {
    try {
      const stat = fs.statSync(filePath);
      await readSlice(0, stat.size);
      position = stat.size;
    } catch (e) {
      // ignore
    }
  }

  // Watch for appends and read new data
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const onChange = async () => {
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return;
    }
    if (stat.size > position) {
      const oldPos = position;
      position = stat.size;
      await readSlice(oldPos, stat.size);
    }
  };

  // Initial read might have already matched; if not, continue watching
  const watcher = fs.watch(dir, (eventType, filename) => {
    if (filename && filename.toString() === base) {
      onChange();
    }
  });

  const cleanup = () => {
    try { watcher.close(); } catch {}
  };
  process.on('SIGINT', () => { cleanup(); process.exit(130); });
  process.on('SIGTERM', () => { cleanup(); process.exit(143); });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});