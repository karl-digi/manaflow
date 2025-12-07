import { FatalError } from "workflow"
import { xai } from "@ai-sdk/xai"
import { generateText } from "ai"

export async function handleCreatePost(content: string) {
  "use workflow"

  const post = await createPost(content)
  const reply = await generateReply(post)

  return { postId: post.id, reply, status: "published" }
}

async function createPost(content: string) {
  "use step"
  console.log(`Creating post with content: ${content}`)
  return { id: crypto.randomUUID(), content }
}

async function generateReply(post: { id: string; content: string }) {
  "use step"
  if (!post.content.trim()) {
    throw new FatalError("Empty post content")
  }

  console.log(`Generating reply for post: ${post.id}`)

  const result = await generateText({
    model: xai("grok-3-mini"),
    system:
      "You are a helpful assistant that drafts thoughtful replies to posts. Keep replies concise and engaging.",
    prompt: `Draft a reply to this post:\n\n${post.content}`,
  })

  console.log(`Generated reply: ${result.text}`)
  return { id: crypto.randomUUID(), content: result.text, parentId: post.id }
}
