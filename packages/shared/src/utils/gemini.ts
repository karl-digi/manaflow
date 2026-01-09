// Default Google Generative AI API endpoint
// Note: Unlike OpenAI/Anthropic, there is no Cloudflare gateway for Google AI.
// This constant uses Google's default endpoint and can be overridden via AIGATEWAY_GEMINI_BASE_URL.
// Named CLOUDFLARE_* for consistency with CLOUDFLARE_OPENAI_BASE_URL and CLOUDFLARE_ANTHROPIC_BASE_URL.
export const CLOUDFLARE_GEMINI_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta";
