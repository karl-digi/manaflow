const STORAGE_KEY = "cmux:quit-without-prompt"

export function shouldShowQuitDialog(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== "true"
}

export function resetQuitPreference(): void {
  localStorage.removeItem(STORAGE_KEY)
}

export function setQuitWithoutPrompt(value: boolean): void {
  if (value) {
    localStorage.setItem(STORAGE_KEY, "true")
  } else {
    localStorage.removeItem(STORAGE_KEY)
  }
}

export { STORAGE_KEY }
