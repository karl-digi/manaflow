#!/usr/bin/env bun

import { Instance, InstanceStatus, MorphCloudClient } from "morphcloud";
import readline from "node:readline";
import process from "node:process";

interface StatusOverride {
  text: string;
  color?: string;
}

interface ManagerState {
  instances: Instance[];
  selectedIndex: number;
  refreshing: boolean;
  actionsInFlight: Set<string>;
  message: string;
  statusOverrides: Map<string, StatusOverride>;
}

const client = new MorphCloudClient();
const state: ManagerState = {
  instances: [],
  selectedIndex: 0,
  refreshing: false,
  actionsInFlight: new Set(),
  message: "",
  statusOverrides: new Map(),
};

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "medium",
});

const colorByStatus: Record<InstanceStatus, string> = {
  [InstanceStatus.PENDING]: "\x1b[33m",
  [InstanceStatus.READY]: "\x1b[32m",
  [InstanceStatus.PAUSED]: "\x1b[36m",
  [InstanceStatus.SAVING]: "\x1b[35m",
  [InstanceStatus.ERROR]: "\x1b[31m",
};

const COLOR_RESET = "\x1b[0m";
const SHOW_CURSOR = "\x1b[?25h";
const HIDE_CURSOR = "\x1b[?25l";
const SPINNER_FRAMES = ["|", "/", "-", "\\"];
const SPINNER_INTERVAL_MS = 120;

let exitRequested = false;
let exitResolver: (() => void) | null = null;
const exitPromise = new Promise<void>((resolve) => {
  exitResolver = resolve;
});
let spinnerTimer: ReturnType<typeof setInterval> | null = null;
let spinnerIndex = 0;

function sortInstances(instances: Instance[]): Instance[] {
  return [...instances].sort((a, b) => b.created - a.created);
}

function formatRelativeTime(timestampSeconds: number): string {
  const diffMs = Date.now() - timestampSeconds * 1000;
  const diffSeconds = Math.max(Math.floor(diffMs / 1000), 0);
  if (diffSeconds < 60) {
    return `${diffSeconds}s ago`;
  }
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }
  const diffWeeks = Math.floor(diffDays / 7);
  if (diffWeeks < 4) {
    return `${diffWeeks}w ago`;
  }
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) {
    return `${diffMonths}mo ago`;
  }
  const diffYears = Math.floor(diffDays / 365);
  return `${diffYears}y ago`;
}

function formatMemory(memoryMb: number): string {
  if (!Number.isFinite(memoryMb) || memoryMb <= 0) {
    return `${memoryMb}MB`;
  }
  const memoryGb = memoryMb / 1024;
  if (memoryGb >= 1) {
    const precision = memoryGb >= 10 ? 0 : 1;
    return `${memoryGb.toFixed(precision)}GB`;
  }
  return `${Math.round(memoryMb)}MB`;
}

function ensureSelectionBounds(): void {
  if (state.instances.length === 0) {
    state.selectedIndex = 0;
    return;
  }
  if (state.selectedIndex >= state.instances.length) {
    state.selectedIndex = state.instances.length - 1;
  }
  if (state.selectedIndex < 0) {
    state.selectedIndex = 0;
  }
}

function clearScreen(): void {
  process.stdout.write("\x1b[2J\x1b[H");
}

function startLoadingIndicator(text: string): void {
  stopLoadingIndicator();
  spinnerIndex = 0;
  state.message = `${text} ${SPINNER_FRAMES[spinnerIndex]}`;
  spinnerTimer = setInterval(() => {
    if (!state.refreshing) {
      stopLoadingIndicator();
      return;
    }
    spinnerIndex = (spinnerIndex + 1) % SPINNER_FRAMES.length;
    state.message = `${text} ${SPINNER_FRAMES[spinnerIndex]}`;
    render();
  }, SPINNER_INTERVAL_MS);
}

function stopLoadingIndicator(): void {
  if (spinnerTimer) {
    clearInterval(spinnerTimer);
    spinnerTimer = null;
  }
}

function render(): void {
  clearScreen();
  process.stdout.write(HIDE_CURSOR);

  const header = "Morph Instance Manager";
  const instructions =
    "Use ↑/↓, j/k, Ctrl+N, Ctrl+P to navigate. Press p to pause, d to delete, r to refresh, q to quit.";

  process.stdout.write(`${header}\n${instructions}\n`);
  if (state.message) {
    process.stdout.write(`\n${state.message}\n`);
  }

  if (state.instances.length === 0) {
    process.stdout.write("\n");
    return;
  }

  process.stdout.write("\n");

  state.instances.forEach((instance, index) => {
    const isSelected = index === state.selectedIndex;
    const marker = isSelected ? "\x1b[36m>\x1b[0m" : " ";
    const createdAt = new Date(instance.created * 1000);
    const createdText = timeFormatter.format(createdAt);
    const relative = formatRelativeTime(instance.created);
    const override = state.statusOverrides.get(instance.id);
    const statusColor = override?.color || colorByStatus[instance.status] || COLOR_RESET;
    const statusText = override?.text ?? instance.status.toLowerCase();

    const metadataName = instance.metadata?.name;
    const nameSegment = metadataName ? ` ${metadataName}` : "";
    const specSegment = `${instance.spec.vcpus}vCPU ${formatMemory(instance.spec.memory)}`;
    const line = `${statusColor}${statusText}${COLOR_RESET} ${instance.id}${nameSegment} | ${specSegment} | Spawned ${createdText} (${relative})`;

    if (isSelected) {
      process.stdout.write(`${marker} ${line}\x1b[0m\n`);
    } else {
      process.stdout.write(`${marker} ${line}\n`);
    }
  });
}

function moveSelection(delta: number): void {
  if (state.instances.length === 0) {
    return;
  }
  const length = state.instances.length;
  state.selectedIndex = (state.selectedIndex + delta + length) % length;
  render();
}

async function pauseSelected(): Promise<void> {
  if (state.instances.length === 0) {
    return;
  }

  const instance = state.instances[state.selectedIndex];
  if (instance.status !== InstanceStatus.READY) {
    state.message = `${instance.id} is not in a ready state.`;
    render();
    return;
  }
  if (state.actionsInFlight.has(instance.id)) {
    state.message = `${instance.id} is already being processed.`;
    render();
    return;
  }
  state.actionsInFlight.add(instance.id);
  state.message = `Pausing ${instance.id}...`;
  state.statusOverrides.set(instance.id, {
    text: "pausing",
    color: "\x1b[33m",
  });
  render();

  try {
    await instance.pause();
    instance.status = InstanceStatus.PAUSED;
    state.statusOverrides.set(instance.id, {
      text: "paused",
      color: colorByStatus[InstanceStatus.PAUSED],
    });
    state.message = `Paused ${instance.id}.`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.message = `Failed to pause ${instance.id}: ${message}`;
    state.statusOverrides.delete(instance.id);
  } finally {
    state.actionsInFlight.delete(instance.id);
    render();
  }
}

async function deleteSelected(): Promise<void> {
  if (state.instances.length === 0) {
    return;
  }

  const instance = state.instances[state.selectedIndex];
  if (state.actionsInFlight.has(instance.id)) {
    state.message = `${instance.id} is already being processed.`;
    render();
    return;
  }
  state.actionsInFlight.add(instance.id);
  state.message = `Deleting ${instance.id}...`;
  state.statusOverrides.set(instance.id, {
    text: "deleting",
    color: "\x1b[31m",
  });
  render();

  try {
    await instance.stop();
    state.instances.splice(state.selectedIndex, 1);
    state.statusOverrides.delete(instance.id);
    if (state.instances.length === 0) {
      state.message = `Deleted ${instance.id}. No instances remaining.`;
    } else {
      state.message = `Deleted ${instance.id}.`;
    }
    ensureSelectionBounds();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.message = `Failed to delete ${instance.id}: ${message}`;
    state.statusOverrides.delete(instance.id);
  } finally {
    state.actionsInFlight.delete(instance.id);
    render();
  }
}

async function refreshInstances(updateMessage = true): Promise<void> {
  if (state.refreshing) {
    return;
  }

  state.refreshing = true;
  if (updateMessage) {
    startLoadingIndicator("Loading ready instances");
  }
  render();

  try {
    const freshInstances = await client.instances.list();
    const readyInstances = freshInstances.filter(
      (instance) => instance.status === InstanceStatus.READY
    );
    state.statusOverrides.clear();
    state.instances = sortInstances(readyInstances);
    ensureSelectionBounds();
    if (state.instances.length === 0) {
      state.message = "No ready instances available. Press r to retry or q to exit.";
    } else {
      state.message = `Loaded ${state.instances.length} ready instance${
        state.instances.length === 1 ? "" : "s"
      }.`;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.message = `Failed to load instances: ${message}`;
  } finally {
    stopLoadingIndicator();
    state.refreshing = false;
    render();
  }
}

function cleanup(): void {
  if (exitRequested) {
    return;
  }
  exitRequested = true;

  stopLoadingIndicator();
  process.stdout.write(`\n${COLOR_RESET}${SHOW_CURSOR}`);

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
  }
  process.stdin.pause();
  process.stdin.removeListener("keypress", handleKeypress);
  process.removeListener("SIGINT", cleanup);
  process.removeListener("SIGTERM", cleanup);

  if (exitResolver) {
    exitResolver();
  }
}

function handleKeypress(_str: string, key: readline.Key): void {
  if (key.ctrl && key.name === "c") {
    cleanup();
    return;
  }

  if (key.ctrl && key.name === "p") {
    moveSelection(-1);
    return;
  }

  if (key.ctrl && key.name === "n") {
    moveSelection(1);
    return;
  }

  switch (key.name) {
    case "up":
    case "k":
      moveSelection(-1);
      return;
    case "down":
    case "j":
      moveSelection(1);
      return;
    case "p":
      void pauseSelected();
      return;
    case "d":
      void deleteSelected();
      return;
    case "r":
      void refreshInstances();
      return;
    case "q":
    case "escape":
      cleanup();
      return;
    default:
      return;
  }
}

async function main(): Promise<void> {
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.on("keypress", handleKeypress);
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  await refreshInstances();
  render();

  await exitPromise;
}

await main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stdout.write(`${COLOR_RESET}${SHOW_CURSOR}`);
  console.error(message);
  process.exitCode = 1;
});
