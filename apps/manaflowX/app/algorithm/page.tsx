"use client"

import { useQuery, useMutation } from "convex/react"
import { useUser } from "@stackframe/stack"
import Link from "next/link"
import { useState, useEffect } from "react"
import { api } from "../../convex/_generated/api"

function GeneralContent() {
  const user = useUser()
  const grokSystemPrompt = useQuery(api.github.getAlgorithmTextSetting, { key: "grokSystemPrompt" })
  const setAlgorithmTextSetting = useMutation(api.github.setAlgorithmTextSetting)

  const [promptValue, setPromptValue] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)

  const defaultPrompt = `You are curating a developer feed and deciding how to engage with the codebase. You have two options:

1. **Post about a PR** - Share an interesting Pull Request with the community
2. **Solve an Issue** - Pick an issue to work on and delegate to a coding agent

IMPORTANT: Aim for roughly 50/50 balance between these actions over time. Alternate between them - if you'd normally pick a PR, consider if there's a good issue to solve instead, and vice versa. Both actions are equally valuable.

For PRs, look for:
- Significant features or important bug fixes
- PRs that look ready to merge or need review
- Interesting technical changes

For Issues, look for:
- Tractable bugs or features that can realistically be solved
- Well-defined issues with clear requirements
- Issues that would provide clear value when fixed

Pick the most interesting item from whichever category you choose. Write engaging content that makes developers want to check it out.`

  // Initialize prompt value when data loads
  useEffect(() => {
    if (grokSystemPrompt !== undefined) {
      setPromptValue(grokSystemPrompt || defaultPrompt)
    }
  }, [grokSystemPrompt, defaultPrompt])

  const handleChange = (value: string) => {
    setPromptValue(value)
    setHasChanges(value !== (grokSystemPrompt || defaultPrompt))
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await setAlgorithmTextSetting({ key: "grokSystemPrompt", value: promptValue })
      setHasChanges(false)
    } catch (error) {
      console.error("Failed to save prompt:", error)
    } finally {
      setIsSaving(false)
    }
  }

  if (!user) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center">
          <h2 className="text-lg font-semibold mb-3">Sign in to continue</h2>
          <Link
            href="/sign-in"
            className="inline-flex items-center gap-2 bg-white text-black font-medium py-2 px-4 rounded-lg hover:bg-gray-200 transition-colors"
          >
            Sign in
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-[calc(100vh-120px)]">
      {/* Grok System Prompt */}
      <div className="p-4 flex flex-col flex-1">
        <div className="mb-3">
          <h3 className="font-medium text-white">Grok System Prompt</h3>
          <p className="text-sm text-gray-500 mt-0.5">
            Customize how Grok selects and writes about content
          </p>
        </div>

        <textarea
          value={promptValue}
          onChange={(e) => handleChange(e.target.value)}
          className="w-full flex-1 bg-gray-900 text-white text-sm p-3 rounded-lg border border-gray-700 focus:border-blue-500 focus:outline-none resize-none font-mono"
          placeholder="Enter the system prompt for Grok..."
        />

        <div className="flex justify-end mt-3">
          <button
            onClick={handleSave}
            disabled={isSaving || !hasChanges || !promptValue.trim()}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSaving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function GeneralPage() {
  return <GeneralContent />
}
