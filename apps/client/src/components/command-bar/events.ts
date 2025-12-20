export const COMMAND_BAR_OPEN_EVENT = "cmux:command-bar-open";

export const openCommandBar = () => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(COMMAND_BAR_OPEN_EVENT));
};
