export const CLOUDFLARE_ANTHROPIC_BASE_URL =
  "https://gateway.ai.cloudflare.com/v1/0c1675e0def6de1ab3a50a4e17dc5656/cmux-heatmap/anthropic";

// AWS Bedrock model IDs for Claude
// These are read from environment variables if available, otherwise use defaults
export const BEDROCK_CLAUDE_SONNET_45_MODEL_ID =
  process.env.ANTHROPIC_MODEL_SONNET_45 ?? "anthropic.claude-sonnet-4-5-20250929-v1:0";
export const BEDROCK_CLAUDE_OPUS_45_MODEL_ID =
  process.env.ANTHROPIC_MODEL_OPUS_45 ?? "global.anthropic.claude-opus-4-5-20251101-v1:0";
export const BEDROCK_CLAUDE_HAIKU_45_MODEL_ID =
  process.env.ANTHROPIC_MODEL_HAIKU_45 ?? "us.anthropic.claude-haiku-4-5-20251001-v1:0";
export const BEDROCK_AWS_REGION = process.env.AWS_REGION ?? "us-west-1";
