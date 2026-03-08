import { z } from "@hono/zod-openapi";

export const ErrorSchema = z
  .object({
    code: z.number().openapi({
      example: 400,
    }),
    message: z.string().openapi({
      example: "Bad Request",
    }),
    details: z.record(z.string(), z.unknown()).optional().openapi({
      example: {
        field: "email",
        issue: "Invalid email format",
      },
    }),
  })
  .openapi("Error");

export const ValidationErrorSchema = z
  .object({
    code: z.literal(422).openapi({
      example: 422,
    }),
    message: z.string().openapi({
      example: "Validation Error",
    }),
    errors: z.array(
      z.object({
        path: z.array(z.union([z.string(), z.number()])),
        message: z.string(),
      })
    ).openapi({
      example: [
        {
          path: ["email"],
          message: "Invalid email",
        },
      ],
    }),
  })
  .openapi("ValidationError");