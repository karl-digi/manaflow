# Zod

Zod is a TypeScript-first schema declaration and validation library with static type inference. It allows developers to define schemas representing data types—from simple primitives like strings and numbers to complex nested objects—and validate untrusted data against those schemas at runtime. When validation succeeds, Zod returns strongly-typed data that matches the schema's inferred TypeScript type, eliminating the need for manual type assertions.

The library features zero external dependencies, a tiny 2KB gzipped core bundle, and an immutable API where methods return new schema instances. Zod works seamlessly with both TypeScript and plain JavaScript, runs in Node.js and all modern browsers, and includes built-in JSON Schema conversion. Version 4 introduces significant performance improvements, a unified error customization API, and new features like codecs for bidirectional transformations.

## Primitive Schemas

Define schemas for basic JavaScript/TypeScript primitive types.

```typescript
import * as z from "zod";

// Primitive type schemas
const stringSchema = z.string();
const numberSchema = z.number();
const bigintSchema = z.bigint();
const booleanSchema = z.boolean();
const symbolSchema = z.symbol();
const undefinedSchema = z.undefined();
const nullSchema = z.null();

// Parsing examples
stringSchema.parse("hello");     // => "hello"
numberSchema.parse(42);          // => 42
booleanSchema.parse(true);       // => true

// Validation failures throw ZodError
try {
  stringSchema.parse(123);
} catch (error) {
  console.log(error.issues);
  // [{ expected: 'string', code: 'invalid_type', path: [], message: 'Invalid input: expected string, received number' }]
}
```

## Type Coercion

Automatically coerce input values to the appropriate type using built-in JavaScript constructors.

```typescript
import * as z from "zod";

// Coerced schemas convert inputs using built-in constructors
const coercedString = z.coerce.string();   // String(input)
const coercedNumber = z.coerce.number();   // Number(input)
const coercedBoolean = z.coerce.boolean(); // Boolean(input)
const coercedBigint = z.coerce.bigint();   // BigInt(input)
const coercedDate = z.coerce.date();       // new Date(input)

// Examples
coercedString.parse(42);        // => "42"
coercedString.parse(true);      // => "true"
coercedNumber.parse("42.5");    // => 42.5
coercedBoolean.parse("hello");  // => true (truthy)
coercedBoolean.parse(0);        // => false (falsy)
coercedDate.parse("2024-01-15"); // => Date object
```

## Object Schemas

Define and validate object shapes with required, optional, and strict/loose variants.

```typescript
import * as z from "zod";

// Basic object schema - all properties required by default
const User = z.object({
  name: z.string(),
  email: z.string(),
  age: z.number().optional(), // Optional property
});

type User = z.infer<typeof User>;
// => { name: string; email: string; age?: number | undefined }

// Parse valid data
const user = User.parse({
  name: "Alice",
  email: "alice@example.com",
  age: 30,
});
// => { name: "Alice", email: "alice@example.com", age: 30 }

// Unknown keys are stripped by default
User.parse({ name: "Bob", email: "bob@example.com", extraKey: true });
// => { name: "Bob", email: "bob@example.com" }

// Strict object - throws on unknown keys
const StrictUser = z.strictObject({
  name: z.string(),
  email: z.string(),
});

try {
  StrictUser.parse({ name: "Bob", email: "bob@example.com", extraKey: true });
} catch (error) {
  console.log(error.issues[0].message); // 'Unrecognized key: "extraKey"'
}

// Loose object - passes through unknown keys
const LooseUser = z.looseObject({
  name: z.string(),
});
LooseUser.parse({ name: "Charlie", extraData: 123 });
// => { name: "Charlie", extraData: 123 }

// Object manipulation methods
const PartialUser = User.partial();           // All fields optional
const RequiredUser = User.required();         // All fields required
const PickedUser = User.pick({ name: true }); // Pick specific fields
const OmittedUser = User.omit({ age: true }); // Omit specific fields
const ExtendedUser = User.extend({ role: z.string() }); // Add fields
```

## Array and Tuple Schemas

Validate arrays with element type checking and tuples with positional types.

```typescript
import * as z from "zod";

// Array schema
const StringArray = z.array(z.string());
StringArray.parse(["a", "b", "c"]); // => ["a", "b", "c"]

// Array with length constraints
const BoundedArray = z.array(z.number())
  .min(1)    // At least 1 element
  .max(10)   // At most 10 elements
  .length(5); // Exactly 5 elements (overrides min/max)

// Tuple schema - fixed length with different types per position
const Coordinate = z.tuple([z.number(), z.number()]);
type Coordinate = z.infer<typeof Coordinate>; // [number, number]

Coordinate.parse([10, 20]); // => [10, 20]

// Tuple with rest argument (variadic)
const VariadicTuple = z.tuple([z.string()], z.number());
type VariadicTuple = z.infer<typeof VariadicTuple>;
// => [string, ...number[]]

VariadicTuple.parse(["hello", 1, 2, 3]); // => ["hello", 1, 2, 3]
```

## String Validations and Formats

Built-in string validation methods and specialized format validators.

```typescript
import * as z from "zod";

// String constraints
const constrainedString = z.string()
  .min(5)                    // Minimum length
  .max(100)                  // Maximum length
  .length(10)                // Exact length
  .regex(/^[a-z]+$/)         // Custom regex
  .startsWith("hello")       // Prefix check
  .endsWith("world")         // Suffix check
  .includes("middle");       // Contains check

// String transforms
const transformedString = z.string()
  .trim()                    // Remove whitespace
  .toLowerCase()             // Convert to lowercase
  .toUpperCase()             // Convert to uppercase
  .normalize();              // Unicode normalization

// Built-in string format validators
const email = z.email();
const uuid = z.uuid();
const url = z.url();
const httpUrl = z.httpUrl();           // HTTP/HTTPS only
const ipv4 = z.ipv4();
const ipv6 = z.ipv6();
const jwt = z.jwt();
const base64 = z.base64();
const hex = z.hex();

// ISO date/time formats
const isoDate = z.iso.date();          // "2024-01-15"
const isoTime = z.iso.time();          // "10:30:00"
const isoDatetime = z.iso.datetime();  // "2024-01-15T10:30:00Z"
const isoDuration = z.iso.duration();  // "P1Y2M3D"

// Validation examples
z.email().parse("user@example.com");              // => "user@example.com"
z.uuid().parse("550e8400-e29b-41d4-a716-446655440000"); // => valid UUID
z.iso.datetime().parse("2024-01-15T10:30:00Z");   // => "2024-01-15T10:30:00Z"

// UUID with version constraint
z.uuidv4().parse("550e8400-e29b-41d4-a716-446655440000"); // v4 UUID only

// Datetime with timezone offset
z.iso.datetime({ offset: true }).parse("2024-01-15T10:30:00+02:00");
```

## Number and Integer Validations

Numeric schema types with range and precision constraints.

```typescript
import * as z from "zod";

// Number schema (finite numbers only, no Infinity/NaN)
const num = z.number();
num.parse(42.5);    // => 42.5
num.parse(NaN);     // => throws ZodError

// Number constraints
const constrainedNumber = z.number()
  .gt(0)           // Greater than
  .gte(1)          // Greater than or equal (alias: .min())
  .lt(100)         // Less than
  .lte(99)         // Less than or equal (alias: .max())
  .positive()      // > 0
  .nonnegative()   // >= 0
  .negative()      // < 0
  .nonpositive()   // <= 0
  .multipleOf(5);  // Must be divisible by 5

// Integer schemas
const safeInt = z.int();        // Safe integer range
const int32 = z.int32();        // 32-bit integer range

// BigInt schema
const bigint = z.bigint();
bigint.parse(9007199254740991n); // => 9007199254740991n

const constrainedBigint = z.bigint()
  .min(0n)
  .max(1000000n)
  .positive()
  .multipleOf(100n);
```

## Enum Schemas

Define schemas for a fixed set of allowable values.

```typescript
import * as z from "zod";

// String enum from array
const Status = z.enum(["pending", "active", "completed"]);
type Status = z.infer<typeof Status>; // "pending" | "active" | "completed"

Status.parse("active"); // => "active"
Status.parse("invalid"); // => throws ZodError

// Access enum values
Status.enum; // => { pending: "pending", active: "active", completed: "completed" }

// TypeScript enum support
enum Color {
  Red = "red",
  Green = "green",
  Blue = "blue",
}
const ColorSchema = z.enum(Color);
ColorSchema.parse(Color.Red);  // => "red"
ColorSchema.parse("green");    // => "green"

// Numeric enum
enum Priority {
  Low = 0,
  Medium = 1,
  High = 2,
}
const PrioritySchema = z.enum(Priority);
PrioritySchema.parse(1); // => 1

// Enum manipulation
const ActiveStatuses = Status.extract(["active", "completed"]);
const InactiveStatuses = Status.exclude(["completed"]);
```

## Union and Discriminated Union Schemas

Combine multiple schemas using logical OR operations.

```typescript
import * as z from "zod";

// Basic union - matches first valid option
const StringOrNumber = z.union([z.string(), z.number()]);
StringOrNumber.parse("hello"); // => "hello"
StringOrNumber.parse(42);      // => 42

// Discriminated union - efficient parsing using discriminator key
const Result = z.discriminatedUnion("status", [
  z.object({ status: z.literal("success"), data: z.string() }),
  z.object({ status: z.literal("error"), error: z.string() }),
]);

type Result = z.infer<typeof Result>;
// { status: "success"; data: string } | { status: "error"; error: string }

const success = Result.parse({ status: "success", data: "Hello" });
// => { status: "success", data: "Hello" }

const error = Result.parse({ status: "error", error: "Something went wrong" });
// => { status: "error", error: "Something went wrong" }

// Exclusive union (XOR) - exactly one option must match
const ExclusiveUnion = z.xor([
  z.object({ type: z.literal("card"), cardNumber: z.string() }),
  z.object({ type: z.literal("bank"), accountNumber: z.string() }),
]);
```

## Record and Map Schemas

Validate objects with dynamic keys and Map/Set data structures.

```typescript
import * as z from "zod";

// Record with string keys
const StringRecord = z.record(z.string(), z.number());
type StringRecord = z.infer<typeof StringRecord>; // Record<string, number>

StringRecord.parse({ alice: 100, bob: 200 }); // => { alice: 100, bob: 200 }

// Record with enum keys (exhaustive - all keys required)
const Keys = z.enum(["id", "name", "email"]);
const UserFields = z.record(Keys, z.string());
// Must include all keys: { id: string; name: string; email: string }

// Partial record (not all keys required)
const PartialUserFields = z.partialRecord(Keys, z.string());
// { id?: string; name?: string; email?: string }

// Map schema
const UserScores = z.map(z.string(), z.number());
type UserScores = z.infer<typeof UserScores>; // Map<string, number>

const scores = new Map();
scores.set("alice", 100);
UserScores.parse(scores); // => Map { "alice" => 100 }

// Set schema
const UniqueNumbers = z.set(z.number());
UniqueNumbers.parse(new Set([1, 2, 3])); // => Set { 1, 2, 3 }

const BoundedSet = z.set(z.string())
  .min(1)    // At least 1 item
  .max(10)   // At most 10 items
  .size(5);  // Exactly 5 items
```

## Safe Parsing

Parse data without throwing exceptions using the safeParse method.

```typescript
import * as z from "zod";

const User = z.object({
  name: z.string(),
  age: z.number(),
});

// Safe parse returns discriminated union result
const result = User.safeParse({ name: "Alice", age: 30 });

if (result.success) {
  console.log(result.data); // { name: "Alice", age: 30 }
} else {
  console.log(result.error.issues); // Array of validation issues
}

// Invalid data example
const invalidResult = User.safeParse({ name: 123, age: "thirty" });

if (!invalidResult.success) {
  console.log(invalidResult.error.issues);
  // [
  //   { expected: 'string', code: 'invalid_type', path: ['name'], message: '...' },
  //   { expected: 'number', code: 'invalid_type', path: ['age'], message: '...' }
  // ]
}

// Async safe parse for schemas with async refinements
const asyncResult = await User.safeParseAsync({ name: "Bob", age: 25 });
```

## Type Inference

Extract TypeScript types from Zod schemas automatically.

```typescript
import * as z from "zod";

const UserSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.email(),
  age: z.number().optional(),
  role: z.enum(["admin", "user", "guest"]),
  createdAt: z.date(),
});

// Infer the output type (what parse() returns)
type User = z.infer<typeof UserSchema>;
// {
//   id: string;
//   name: string;
//   email: string;
//   age?: number | undefined;
//   role: "admin" | "user" | "guest";
//   createdAt: Date;
// }

// When input and output differ (e.g., with transforms)
const TransformSchema = z.string().transform((val) => val.length);

type TransformInput = z.input<typeof TransformSchema>;   // string
type TransformOutput = z.output<typeof TransformSchema>; // number

// Use inferred types in your code
function createUser(data: z.input<typeof UserSchema>): User {
  return UserSchema.parse(data);
}
```

## Refinements and Custom Validation

Add custom validation logic to any schema using refinements.

```typescript
import * as z from "zod";

// Simple refinement
const PositiveNumber = z.number().refine((val) => val > 0, {
  error: "Number must be positive",
});

// Refinement with dynamic error message
const Password = z.string().refine(
  (val) => val.length >= 8,
  { error: (issue) => `Password must be at least 8 characters, got ${issue.input.length}` }
);

// Object-level refinement for cross-field validation
const PasswordForm = z.object({
  password: z.string().min(8),
  confirmPassword: z.string(),
}).refine(
  (data) => data.password === data.confirmPassword,
  {
    error: "Passwords don't match",
    path: ["confirmPassword"], // Attach error to specific field
  }
);

// SuperRefine for multiple custom issues
const UniqueArray = z.array(z.string()).superRefine((val, ctx) => {
  if (val.length !== new Set(val).size) {
    ctx.addIssue({
      code: "custom",
      message: "Array must contain unique values",
      input: val,
    });
  }

  if (val.length > 10) {
    ctx.addIssue({
      code: "too_big",
      maximum: 10,
      origin: "array",
      inclusive: true,
      message: "Array cannot exceed 10 items",
      input: val,
    });
  }
});

// Async refinement (requires parseAsync)
const UniqueEmail = z.email().refine(
  async (email) => {
    const exists = await checkEmailExists(email);
    return !exists;
  },
  { error: "Email already registered" }
);

const result = await UniqueEmail.parseAsync("test@example.com");
```

## Transforms

Transform data during parsing to convert between types.

```typescript
import * as z from "zod";

// Basic transform
const StringToLength = z.string().transform((val) => val.length);
StringToLength.parse("hello"); // => 5

// Transform with validation
const StringToNumber = z.string()
  .transform((val, ctx) => {
    const parsed = Number.parseFloat(val);
    if (Number.isNaN(parsed)) {
      ctx.issues.push({
        code: "custom",
        message: "Invalid number format",
        input: val,
      });
      return z.NEVER;
    }
    return parsed;
  });

StringToNumber.parse("42.5"); // => 42.5
StringToNumber.parse("abc");  // => throws ZodError

// Preprocess - transform before validation
const CoercedNumber = z.preprocess(
  (val) => (typeof val === "string" ? Number.parseFloat(val) : val),
  z.number()
);

CoercedNumber.parse("123"); // => 123
CoercedNumber.parse(456);   // => 456

// Pipe - chain schemas with transforms
const TrimmedUppercase = z.string()
  .pipe(z.transform((val) => val.trim()))
  .pipe(z.transform((val) => val.toUpperCase()));

TrimmedUppercase.parse("  hello  "); // => "HELLO"

// Async transform
const IdToUser = z.string().transform(async (id) => {
  const user = await fetchUserById(id);
  return user;
});

const user = await IdToUser.parseAsync("user-123");
```

## Codecs (Bidirectional Transforms)

Define bidirectional transformations for encoding and decoding data.

```typescript
import * as z from "zod";

// Define a codec for ISO datetime <-> Date conversion
const IsoDateCodec = z.codec(
  z.iso.datetime(),  // Input schema
  z.date(),          // Output schema
  {
    decode: (isoString) => new Date(isoString),
    encode: (date) => date.toISOString(),
  }
);

// Decode: string -> Date
const date = IsoDateCodec.decode("2024-01-15T10:30:00.000Z");
// => Date object

// Encode: Date -> string
const isoString = IsoDateCodec.encode(new Date("2024-01-15"));
// => "2024-01-15T00:00:00.000Z"

// Use in nested schemas
const Event = z.object({
  name: z.string(),
  startDate: IsoDateCodec,
  endDate: IsoDateCodec,
});

// Decode entire object
const event = Event.decode({
  name: "Conference",
  startDate: "2024-06-01T09:00:00.000Z",
  endDate: "2024-06-03T17:00:00.000Z",
});
// => { name: "Conference", startDate: Date, endDate: Date }

// Encode back to JSON-friendly format
const jsonEvent = Event.encode(event);
// => { name: "Conference", startDate: "2024-06-01T09:00:00.000Z", ... }

// String to number codec
const StringToNumber = z.codec(
  z.string().regex(z.regexes.number),
  z.number(),
  {
    decode: (str) => Number.parseFloat(str),
    encode: (num) => num.toString(),
  }
);
```

## Default and Catch Values

Provide fallback values for undefined inputs or validation failures.

```typescript
import * as z from "zod";

// Default value for undefined input
const StringWithDefault = z.string().default("unknown");
StringWithDefault.parse(undefined); // => "unknown"
StringWithDefault.parse("hello");   // => "hello"

// Dynamic default using function
const TimestampSchema = z.date().default(() => new Date());
TimestampSchema.parse(undefined); // => current Date

// Catch - fallback on any validation failure
const SafeNumber = z.number().catch(0);
SafeNumber.parse(42);       // => 42
SafeNumber.parse("invalid"); // => 0

// Dynamic catch with error context
const SafeString = z.string().catch((ctx) => {
  console.log("Validation failed:", ctx.error);
  return "fallback";
});

// Prefault - default applied BEFORE parsing
const TrimmedDefault = z.string().trim().prefault("  hello  ");
TrimmedDefault.parse(undefined); // => "hello" (trimmed)

// Compare with regular default
const TrimmedRegular = z.string().trim().default("  hello  ");
TrimmedRegular.parse(undefined); // => "  hello  " (not trimmed)
```

## Error Customization

Customize validation error messages at various levels.

```typescript
import * as z from "zod";

// Inline error message
const Name = z.string({ error: "Name must be a string" });

// Error function for dynamic messages
const Age = z.number({
  error: (issue) =>
    issue.input === undefined
      ? "Age is required"
      : "Age must be a number"
});

// Method-level error customization
const Password = z.string()
  .min(8, { error: "Password must be at least 8 characters" })
  .max(100, { error: "Password is too long" })
  .regex(/[A-Z]/, { error: "Password must contain an uppercase letter" });

// Per-parse error customization
const result = z.string().safeParse(123, {
  error: (issue) => `Custom error: expected string, got ${typeof issue.input}`
});

// Global error configuration
z.config({
  customError: (issue) => {
    if (issue.code === "invalid_type") {
      return `Expected ${issue.expected}, received ${typeof issue.input}`;
    }
    if (issue.code === "too_small") {
      return `Value must be at least ${issue.minimum}`;
    }
    return undefined; // Fall back to default
  }
});

// Internationalization with locales
import { fr } from "zod/locales";
z.config(fr()); // Use French error messages
```

## Error Formatting

Format validation errors for display or logging.

```typescript
import * as z from "zod";

const UserSchema = z.strictObject({
  username: z.string().min(3),
  email: z.email(),
  age: z.number().min(0),
});

const result = UserSchema.safeParse({
  username: "ab",
  email: "invalid",
  age: -5,
  extra: "field",
});

if (!result.success) {
  // Tree format - nested object structure
  const tree = z.treeifyError(result.error);
  // {
  //   errors: ['Unrecognized key: "extra"'],
  //   properties: {
  //     username: { errors: ['String must contain at least 3 character(s)'] },
  //     email: { errors: ['Invalid email'] },
  //     age: { errors: ['Number must be greater than or equal to 0'] }
  //   }
  // }

  // Flat format - simple key-value structure
  const flat = z.flattenError(result.error);
  // {
  //   formErrors: ['Unrecognized key: "extra"'],
  //   fieldErrors: {
  //     username: ['String must contain at least 3 character(s)'],
  //     email: ['Invalid email'],
  //     age: ['Number must be greater than or equal to 0']
  //   }
  // }

  // Pretty print for logging
  const pretty = z.prettifyError(result.error);
  // ✖ Unrecognized key: "extra"
  // ✖ String must contain at least 3 character(s)
  //   → at username
  // ✖ Invalid email
  //   → at email
  // ...
}
```

## Recursive Schemas

Define self-referential schemas for tree-like data structures.

```typescript
import * as z from "zod";

// Self-referential schema using getter
const Category = z.object({
  name: z.string(),
  get subcategories() {
    return z.array(Category);
  },
});

type Category = z.infer<typeof Category>;
// { name: string; subcategories: Category[] }

Category.parse({
  name: "Electronics",
  subcategories: [
    { name: "Phones", subcategories: [] },
    {
      name: "Computers",
      subcategories: [
        { name: "Laptops", subcategories: [] },
        { name: "Desktops", subcategories: [] },
      ]
    },
  ],
});

// Mutually recursive schemas
const User = z.object({
  name: z.string(),
  get posts() {
    return z.array(Post);
  },
});

const Post = z.object({
  title: z.string(),
  get author() {
    return User;
  },
});
```

## Branded Types

Create nominal types for type-safe programming patterns.

```typescript
import * as z from "zod";

// Brand a schema to create a nominal type
const UserId = z.string().uuid().brand<"UserId">();
const PostId = z.string().uuid().brand<"PostId">();

type UserId = z.infer<typeof UserId>; // string & z.$brand<"UserId">
type PostId = z.infer<typeof PostId>; // string & z.$brand<"PostId">

// Branded types are not interchangeable
const userId = UserId.parse("550e8400-e29b-41d4-a716-446655440000");
const postId = PostId.parse("123e4567-e89b-12d3-a456-426614174000");

function getUser(id: UserId) { /* ... */ }
function getPost(id: PostId) { /* ... */ }

getUser(userId); // OK
getUser(postId); // TypeScript error: PostId not assignable to UserId

// Plain strings also don't work
const plainId = "550e8400-e29b-41d4-a716-446655440000";
getUser(plainId); // TypeScript error

// Must parse to get branded type
getUser(UserId.parse(plainId)); // OK
```

## Validated Functions

Create functions with automatic input/output validation.

```typescript
import * as z from "zod";

// Define function schema with input and output validation
const CalculateArea = z.function({
  input: [z.number().positive(), z.number().positive()],
  output: z.number().positive(),
});

// Implement with automatic validation
const calculateArea = CalculateArea.implement((width, height) => {
  return width * height;
});

calculateArea(10, 5);  // => 50
calculateArea(-1, 5);  // => throws ZodError (invalid input)

// Input-only validation (output not validated)
const LogMessage = z.function({
  input: [z.string(), z.enum(["info", "warn", "error"])],
});

const log = LogMessage.implement((message, level) => {
  console.log(`[${level.toUpperCase()}] ${message}`);
});

// Async function implementation
const FetchUser = z.function({
  input: [z.string().uuid()],
  output: z.object({
    id: z.string(),
    name: z.string(),
  }),
});

const fetchUser = FetchUser.implementAsync(async (userId) => {
  const response = await fetch(`/api/users/${userId}`);
  return response.json();
});
```

## Optional, Nullable, and Nullish

Handle undefined and null values in schemas.

```typescript
import * as z from "zod";

// Optional - allows undefined
const OptionalString = z.optional(z.string());
// or: z.string().optional()

OptionalString.parse("hello");    // => "hello"
OptionalString.parse(undefined);  // => undefined
OptionalString.parse(null);       // => throws ZodError

// Nullable - allows null
const NullableString = z.nullable(z.string());
// or: z.string().nullable()

NullableString.parse("hello");    // => "hello"
NullableString.parse(null);       // => null
NullableString.parse(undefined);  // => throws ZodError

// Nullish - allows both undefined and null
const NullishString = z.nullish(z.string());

NullishString.parse("hello");     // => "hello"
NullishString.parse(undefined);   // => undefined
NullishString.parse(null);        // => null

// In object context
const User = z.object({
  name: z.string(),
  nickname: z.string().optional(),    // nickname?: string | undefined
  bio: z.string().nullable(),         // bio: string | null
  avatar: z.string().nullish(),       // avatar?: string | null | undefined
});
```

## Literal and Template Literal Schemas

Validate exact values and template string patterns.

```typescript
import * as z from "zod";

// Single literal value
const Active = z.literal("active");
Active.parse("active"); // => "active"
Active.parse("pending"); // => throws ZodError

// Multiple literal values
const Status = z.literal(["pending", "active", "completed"]);
Status.parse("active"); // => "active"

// Numeric and boolean literals
const AnswerToLife = z.literal(42);
const IsEnabled = z.literal(true);

// Template literal schema (new in Zod 4)
const CssUnit = z.templateLiteral([z.number(), z.enum(["px", "em", "rem"])]);
type CssUnit = z.infer<typeof CssUnit>;
// `${number}px` | `${number}em` | `${number}rem`

CssUnit.parse("16px");   // => "16px"
CssUnit.parse("1.5rem"); // => "1.5rem"
CssUnit.parse("10%");    // => throws ZodError

// Complex template literal
const Email = z.templateLiteral([z.string(), "@", z.string(), ".", z.string()]);
// `${string}@${string}.${string}`
```

## Custom Schema Types

Create completely custom schemas using z.custom().

```typescript
import * as z from "zod";

// Custom type with validation function
type CssPixelValue = `${number}px`;

const CssPixel = z.custom<CssPixelValue>((val) => {
  return typeof val === "string" && /^\d+px$/.test(val);
}, { error: "Must be a valid CSS pixel value (e.g., '10px')" });

CssPixel.parse("42px");     // => "42px"
CssPixel.parse("42");       // => throws ZodError
CssPixel.parse("42em");     // => throws ZodError

// Custom format using stringFormat
const ProductCode = z.stringFormat("product-code", (val) => {
  return /^[A-Z]{2}-\d{4}$/.test(val);
});

ProductCode.parse("AB-1234"); // => "AB-1234"
ProductCode.parse("invalid");
// ZodError: [{ code: "invalid_format", format: "product-code", ... }]

// Instance validation
class CustomClass {
  constructor(public value: string) {}
}

const CustomInstance = z.instanceof(CustomClass);
CustomInstance.parse(new CustomClass("hello")); // => CustomClass instance
CustomInstance.parse({ value: "hello" });       // => throws ZodError
```

## Main Use Cases and Integration Patterns

Zod excels in scenarios requiring runtime type validation with TypeScript integration. Common use cases include API request/response validation where untrusted external data enters your application, form validation in web applications with libraries like React Hook Form, environment variable validation at application startup, configuration file parsing, and database query result validation. The library is particularly powerful when used with frameworks like tRPC for end-to-end type-safe APIs, where Zod schemas define both the runtime validation and compile-time types.

Integration patterns typically involve defining schemas in a shared location, then using them across your application for consistent validation. For REST APIs, define request body schemas and use safeParse to return structured error responses. For GraphQL, use Zod to validate resolver inputs. In frontend applications, combine with form libraries and use treeifyError or flattenError to display field-level errors. For configuration, create a validated config object at startup that can be imported throughout your application. The codec feature enables seamless serialization/deserialization when communicating between systems with different data representations, such as converting between ISO date strings and JavaScript Date objects at API boundaries.
