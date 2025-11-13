import type {
  AggregatePullRequestSummary,
  PullRequestActionResult,
} from "@cmux/shared/pull-request-state";
import { toast } from "sonner";

type ErrorLikeResponse = { error?: string };

export type ToastFeedbackContext = {
  toastId: ReturnType<typeof toast.loading>;
};

export class SocketMutationError<
  TResponse extends ErrorLikeResponse = ErrorLikeResponse,
> extends Error {
  constructor(message: string, public response: TResponse) {
    super(message);
    this.name = "SocketMutationError";
  }
}

export type SocketMutationErrorInstance<
  TResponse extends ErrorLikeResponse = ErrorLikeResponse,
> = SocketMutationError<TResponse>;

export type PullRequestActionResponse = {
  success: boolean;
  results: PullRequestActionResult[];
  aggregate: AggregatePullRequestSummary;
  error?: string;
};

export type MergeBranchResponse = {
  success: boolean;
  merged?: boolean;
  commitSha?: string;
  error?: string;
};

export const getErrorDescription = (
  error: unknown,
): string | undefined => {
  if (error instanceof SocketMutationError) {
    return error.response.error ?? error.message;
  }
  if (error instanceof Error) {
    return error.message || undefined;
  }
  return undefined;
};
