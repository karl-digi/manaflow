# shadcn/ui

shadcn/ui is a collection of beautifully designed, accessible UI components that you can copy and paste into your applications. Unlike traditional component libraries, shadcn/ui gives you the actual source code rather than npm packages, allowing full customization and ownership of your components. Built on Radix UI primitives and styled with Tailwind CSS, it provides React 19 and Tailwind v4 compatible components with a consistent, composable API.

The project includes a powerful CLI (`shadcn`) for initializing projects, adding components, building custom registries, and integrating with AI assistants via MCP (Model Context Protocol). The component system uses a flat-file schema for distribution, making it easy to share components across projects, publish to private registries, or generate components with AI tools.

---

## CLI Commands

### Initialize a New Project

The `init` command sets up shadcn/ui in your project by installing dependencies, creating a `components.json` configuration file, adding the `cn` utility function, and configuring CSS variables.

```bash
# Interactive initialization
npx shadcn@latest init

# Initialize with specific options
npx shadcn@latest init -y --base-color zinc

# Initialize with a template
npx shadcn@latest init --template next

# Initialize with components
npx shadcn@latest init button card dialog

# Initialize with RTL support
npx shadcn@latest init --rtl
```

### Add Components to Your Project

The `add` command installs components and their dependencies into your project. Components are copied directly to your codebase for full customization.

```bash
# Add a single component
npx shadcn@latest add button

# Add multiple components
npx shadcn@latest add button card dialog input select

# Add all available components
npx shadcn@latest add --all

# Add with automatic overwrite
npx shadcn@latest add button --overwrite

# Add to a specific directory
npx shadcn@latest add button --path src/components/custom

# Add from a custom registry
npx shadcn@latest add @acme/custom-button

# Add from v0.dev
npx shadcn@latest add @v0/dashboard
```

### View Registry Items

The `view` command displays component source code from registries before installation, useful for previewing changes.

```bash
# View a single component
npx shadcn@latest view button

# View multiple components
npx shadcn@latest view button card dialog

# View from namespaced registries
npx shadcn@latest view @acme/auth @v0/dashboard
```

### Search Registries

The `search` command finds components across configured registries with optional filtering.

```bash
# Search all items in a registry
npx shadcn@latest search @shadcn

# Search with a query
npx shadcn@latest search @shadcn -q "button"

# Search multiple registries
npx shadcn@latest search @shadcn @v0 @acme

# List all items (alias for search)
npx shadcn@latest list @acme

# Limit results
npx shadcn@latest search @shadcn --limit 20 --offset 10
```

### Check for Updates

The `diff` command compares your local components against the registry to identify available updates.

```bash
# Check all components for updates
npx shadcn@latest diff

# Check a specific component
npx shadcn@latest diff button
```

### Build Custom Registry

The `build` command generates registry JSON files from a `registry.json` configuration, enabling you to distribute your own components.

```bash
# Build with defaults (registry.json -> public/r/)
npx shadcn@latest build

# Build with custom paths
npx shadcn@latest build ./my-registry.json --output ./dist/registry
```

### Run Migrations

The `migrate` command helps upgrade components when breaking changes occur, supporting icon library, Radix UI, and RTL migrations.

```bash
# List available migrations
npx shadcn@latest migrate --list

# Migrate to RTL support
npx shadcn@latest migrate rtl

# Migrate to unified radix-ui package
npx shadcn@latest migrate radix

# Migrate icons library
npx shadcn@latest migrate icons

# Migrate specific files
npx shadcn@latest migrate rtl src/components/ui/button.tsx
npx shadcn@latest migrate radix "src/components/ui/**"
```

---

## Configuration

### components.json Structure

The `components.json` file configures how shadcn/ui integrates with your project. Create it with `npx shadcn@latest init`.

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "app/globals.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "iconLibrary": "lucide",
  "rtl": false,
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "registries": {
    "@acme": "https://registry.acme.com/{name}.json",
    "@internal": {
      "url": "https://internal.company.com/{name}.json",
      "headers": {
        "Authorization": "Bearer ${REGISTRY_TOKEN}"
      }
    }
  }
}
```

### Registry Authentication

Configure private registries with authentication headers and environment variables.

```json
{
  "registries": {
    "@private": {
      "url": "https://api.company.com/registry/{name}.json",
      "headers": {
        "Authorization": "Bearer ${REGISTRY_TOKEN}",
        "X-API-Key": "${API_KEY}"
      },
      "params": {
        "version": "latest"
      }
    }
  }
}
```

```bash
# .env.local
REGISTRY_TOKEN=your_token_here
API_KEY=your_api_key_here
```

---

## Components

### Button Component

A versatile button component with multiple variants and sizes built on Radix UI primitives.

```tsx
import { Button, buttonVariants } from "@/components/ui/button"

// Basic usage
<Button>Click me</Button>

// Variants
<Button variant="default">Default</Button>
<Button variant="destructive">Delete</Button>
<Button variant="outline">Outline</Button>
<Button variant="secondary">Secondary</Button>
<Button variant="ghost">Ghost</Button>
<Button variant="link">Link</Button>

// Sizes
<Button size="default">Default</Button>
<Button size="sm">Small</Button>
<Button size="lg">Large</Button>
<Button size="icon"><IconComponent /></Button>

// With icons
<Button>
  <Mail data-icon="inline-start" />
  Login with Email
</Button>

// As child (for custom elements)
<Button asChild>
  <a href="/dashboard">Go to Dashboard</a>
</Button>

// Using buttonVariants for links
<a className={buttonVariants({ variant: "outline" })} href="/about">
  About
</a>

// Disabled state
<Button disabled>Disabled</Button>

// Loading state with spinner
<Button disabled>
  <Spinner data-icon="inline-start" />
  Please wait
</Button>
```

### Card Component

A flexible card container with header, content, and footer sections.

```tsx
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  CardAction,
} from "@/components/ui/card"

<Card>
  <CardHeader>
    <CardTitle>Create project</CardTitle>
    <CardDescription>Deploy your new project in one-click.</CardDescription>
    <CardAction>
      <Button variant="ghost" size="icon">
        <MoreHorizontal />
      </Button>
    </CardAction>
  </CardHeader>
  <CardContent>
    <form>
      <div className="grid w-full items-center gap-4">
        <div className="flex flex-col space-y-1.5">
          <Label htmlFor="name">Name</Label>
          <Input id="name" placeholder="Name of your project" />
        </div>
      </div>
    </form>
  </CardContent>
  <CardFooter className="flex justify-between">
    <Button variant="outline">Cancel</Button>
    <Button>Deploy</Button>
  </CardFooter>
</Card>
```

### Dialog Component

A modal dialog component for confirmations, forms, and content overlays.

```tsx
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog"

<Dialog>
  <DialogTrigger asChild>
    <Button variant="outline">Edit Profile</Button>
  </DialogTrigger>
  <DialogContent className="sm:max-w-[425px]">
    <DialogHeader>
      <DialogTitle>Edit profile</DialogTitle>
      <DialogDescription>
        Make changes to your profile here. Click save when done.
      </DialogDescription>
    </DialogHeader>
    <div className="grid gap-4 py-4">
      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor="name" className="text-right">Name</Label>
        <Input id="name" defaultValue="John Doe" className="col-span-3" />
      </div>
      <div className="grid grid-cols-4 items-center gap-4">
        <Label htmlFor="username" className="text-right">Username</Label>
        <Input id="username" defaultValue="@johndoe" className="col-span-3" />
      </div>
    </div>
    <DialogFooter>
      <Button type="submit">Save changes</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>

// Without close button
<DialogContent showCloseButton={false}>
  {/* content */}
</DialogContent>

// With footer close button
<DialogFooter showCloseButton>
  <Button type="submit">Submit</Button>
</DialogFooter>
```

### Input Component

A styled text input component with built-in accessibility features.

```tsx
import { Input } from "@/components/ui/input"

// Basic usage
<Input type="text" placeholder="Enter your name" />

// With label using Field component
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field"

<Field>
  <FieldLabel>Email</FieldLabel>
  <Input type="email" placeholder="email@example.com" />
  <FieldDescription>We'll never share your email.</FieldDescription>
</Field>

// Disabled state
<Input disabled placeholder="Disabled input" />

// Invalid state
<Input aria-invalid="true" placeholder="Invalid input" />

// File input
<Input type="file" />

// Required field
<Field>
  <FieldLabel>
    Username <span className="text-destructive">*</span>
  </FieldLabel>
  <Input required placeholder="Required field" />
</Field>
```

### Select Component

A dropdown select component built on Radix UI Select primitives.

```tsx
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectLabel,
  SelectItem,
  SelectSeparator,
} from "@/components/ui/select"

<Select>
  <SelectTrigger className="w-[180px]">
    <SelectValue placeholder="Select a fruit" />
  </SelectTrigger>
  <SelectContent>
    <SelectGroup>
      <SelectLabel>Fruits</SelectLabel>
      <SelectItem value="apple">Apple</SelectItem>
      <SelectItem value="banana">Banana</SelectItem>
      <SelectItem value="orange">Orange</SelectItem>
    </SelectGroup>
    <SelectSeparator />
    <SelectGroup>
      <SelectLabel>Vegetables</SelectLabel>
      <SelectItem value="carrot">Carrot</SelectItem>
      <SelectItem value="potato">Potato</SelectItem>
    </SelectGroup>
  </SelectContent>
</Select>

// Different sizes
<SelectTrigger size="sm">...</SelectTrigger>
<SelectTrigger size="default">...</SelectTrigger>

// Controlled select
const [value, setValue] = React.useState("")

<Select value={value} onValueChange={setValue}>
  <SelectTrigger>
    <SelectValue placeholder="Theme" />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="light">Light</SelectItem>
    <SelectItem value="dark">Dark</SelectItem>
    <SelectItem value="system">System</SelectItem>
  </SelectContent>
</Select>
```

### Table Component

A semantic HTML table with styled headers, rows, and cells.

```tsx
import {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
} from "@/components/ui/table"

<Table>
  <TableCaption>A list of recent invoices.</TableCaption>
  <TableHeader>
    <TableRow>
      <TableHead className="w-[100px]">Invoice</TableHead>
      <TableHead>Status</TableHead>
      <TableHead>Method</TableHead>
      <TableHead className="text-right">Amount</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    <TableRow>
      <TableCell className="font-medium">INV001</TableCell>
      <TableCell>Paid</TableCell>
      <TableCell>Credit Card</TableCell>
      <TableCell className="text-right">$250.00</TableCell>
    </TableRow>
    <TableRow>
      <TableCell className="font-medium">INV002</TableCell>
      <TableCell>Pending</TableCell>
      <TableCell>PayPal</TableCell>
      <TableCell className="text-right">$150.00</TableCell>
    </TableRow>
  </TableBody>
  <TableFooter>
    <TableRow>
      <TableCell colSpan={3}>Total</TableCell>
      <TableCell className="text-right">$400.00</TableCell>
    </TableRow>
  </TableFooter>
</Table>
```

### Form Component with React Hook Form

Integration with react-hook-form for validated forms with error handling.

```tsx
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

const formSchema = z.object({
  username: z.string().min(2, {
    message: "Username must be at least 2 characters.",
  }),
  email: z.string().email({
    message: "Please enter a valid email address.",
  }),
})

function ProfileForm() {
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      username: "",
      email: "",
    },
  })

  function onSubmit(values: z.infer<typeof formSchema>) {
    console.log(values)
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        <FormField
          control={form.control}
          name="username"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Username</FormLabel>
              <FormControl>
                <Input placeholder="johndoe" {...field} />
              </FormControl>
              <FormDescription>
                This is your public display name.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input placeholder="john@example.com" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit">Submit</Button>
      </form>
    </Form>
  )
}
```

---

## Theming

### CSS Variables Configuration

shadcn/ui uses CSS variables for theming, enabling easy light/dark mode switching and custom color schemes.

```css
/* app/globals.css */
:root {
  --radius: 0.625rem;
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);
}

.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --primary: oklch(0.922 0 0);
  --primary-foreground: oklch(0.205 0 0);
  /* ... other dark mode values */
}
```

### Adding Custom Colors

Extend the color system by adding new CSS variables and registering them with Tailwind v4.

```css
/* app/globals.css */
:root {
  --warning: oklch(0.84 0.16 84);
  --warning-foreground: oklch(0.28 0.07 46);
}

.dark {
  --warning: oklch(0.41 0.11 46);
  --warning-foreground: oklch(0.99 0.02 95);
}

@theme inline {
  --color-warning: var(--warning);
  --color-warning-foreground: var(--warning-foreground);
}
```

```tsx
// Usage in components
<div className="bg-warning text-warning-foreground">Warning message</div>
```

---

## MCP Server Integration

### Configure MCP for AI Assistants

The shadcn MCP server enables AI assistants to browse, search, and install components using natural language.

```bash
# Initialize MCP for Claude Code
npx shadcn@latest mcp init --client claude

# Initialize MCP for Cursor
npx shadcn@latest mcp init --client cursor

# Initialize MCP for VS Code
npx shadcn@latest mcp init --client vscode
```

```json
// .mcp.json (Claude Code)
{
  "mcpServers": {
    "shadcn": {
      "command": "npx",
      "args": ["shadcn@latest", "mcp"]
    }
  }
}
```

```json
// .cursor/mcp.json (Cursor)
{
  "mcpServers": {
    "shadcn": {
      "command": "npx",
      "args": ["shadcn@latest", "mcp"]
    }
  }
}
```

---

## Building Custom Registries

### registry.json Schema

Create a `registry.json` file to define your custom component registry.

```json
{
  "name": "acme-ui",
  "homepage": "https://ui.acme.com",
  "items": [
    {
      "$schema": "https://ui.shadcn.com/schema/registry-item.json",
      "name": "fancy-button",
      "type": "registry:ui",
      "title": "Fancy Button",
      "description": "A fancy animated button component",
      "dependencies": ["framer-motion"],
      "registryDependencies": ["button"],
      "files": [
        {
          "path": "components/ui/fancy-button.tsx",
          "type": "registry:ui"
        }
      ]
    },
    {
      "name": "auth-form",
      "type": "registry:block",
      "title": "Authentication Form",
      "description": "Complete login/signup form with validation",
      "dependencies": ["react-hook-form", "zod"],
      "registryDependencies": ["button", "input", "form", "card"],
      "files": [
        {
          "path": "components/blocks/auth-form.tsx",
          "type": "registry:block"
        }
      ]
    }
  ]
}
```

```bash
# Build the registry
npx shadcn@latest build

# Custom output directory
npx shadcn@latest build --output ./dist/registry
```

---

## Utility Functions

### cn() - Class Name Merger

The `cn` utility combines `clsx` and `tailwind-merge` for conditional class composition without conflicts.

```tsx
import { cn } from "@/lib/utils"

// Basic usage
<div className={cn("px-4 py-2", "bg-primary")} />

// Conditional classes
<div className={cn(
  "base-styles",
  isActive && "active-styles",
  isDisabled && "opacity-50 cursor-not-allowed"
)} />

// Override conflicting classes (tailwind-merge)
<div className={cn("px-4", "px-6")} /> // Results in "px-6"

// With arrays
<div className={cn([
  "flex items-center",
  variant === "primary" && "bg-primary text-primary-foreground",
  variant === "secondary" && "bg-secondary text-secondary-foreground",
])} />

// Implementation
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

---

## Summary

shadcn/ui provides a modern approach to building component libraries where you own and control your code. The CLI-driven workflow makes it easy to initialize projects, add components on-demand, and keep them updated. With built-in support for multiple registries, you can distribute components internally across teams or consume public registries like v0.dev.

Integration patterns include React Hook Form for validated forms, Radix UI primitives for accessibility, and Tailwind CSS for styling. The MCP server enables AI-assisted development where tools like Claude, Cursor, and VS Code Copilot can directly search and install components. For teams building design systems, the registry schema and build command provide a structured way to package and distribute components while maintaining the open-code philosophy that makes shadcn/ui unique.
