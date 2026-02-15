# TanStack Query

TanStack Query (formerly React Query) is an async state management library that simplifies fetching, caching, synchronizing, and updating server state in web applications. It is protocol-agnostic, working seamlessly with REST, GraphQL, or any Promise-based data fetching mechanism. The library provides powerful features including automatic caching, background refetching, pagination, infinite scroll, mutations with optimistic updates, prefetching, request cancellation, and React Suspense support.

TanStack Query offers official adapters for multiple frameworks: React (`@tanstack/react-query`), Vue (`@tanstack/vue-query`), Solid (`@tanstack/solid-query`), Svelte (`@tanstack/svelte-query`), and Angular (`@tanstack/angular-query-experimental`). All adapters share the same core concepts and API patterns, making it easy to work across different frontend frameworks while maintaining consistent server state management patterns.

---

## QueryClient Setup

The QueryClient is the central manager for all query and mutation caching. It must be created and provided to your application before using any TanStack Query hooks.

```tsx
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query'

// Create a client with optional default configuration
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 30,   // 30 minutes
      retry: 3,
      refetchOnWindowFocus: true,
    },
    mutations: {
      retry: 0,
    },
  },
})

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <MyComponent />
    </QueryClientProvider>
  )
}
```

---

## useQuery - Basic Data Fetching

The `useQuery` hook is the primary way to fetch and cache data. It requires a unique query key and a query function that returns a promise.

```tsx
import { useQuery } from '@tanstack/react-query'

function TodoList() {
  const {
    data,
    isPending,
    isError,
    error,
    isFetching,
    isSuccess,
    refetch,
  } = useQuery({
    queryKey: ['todos'],
    queryFn: async () => {
      const response = await fetch('/api/todos')
      if (!response.ok) {
        throw new Error('Failed to fetch todos')
      }
      return response.json()
    },
    staleTime: 1000 * 60, // Data is fresh for 1 minute
    gcTime: 1000 * 60 * 5, // Cache persists for 5 minutes after unmount
    retry: 2,
    refetchOnWindowFocus: true,
  })

  if (isPending) return <div>Loading...</div>
  if (isError) return <div>Error: {error.message}</div>

  return (
    <div>
      {isFetching && <span>Refreshing...</span>}
      <ul>
        {data.map((todo) => (
          <li key={todo.id}>{todo.title}</li>
        ))}
      </ul>
      <button onClick={() => refetch()}>Refresh</button>
    </div>
  )
}
```

---

## useQuery with Parameters

Query keys can include variables that automatically trigger refetches when they change. This is essential for fetching data based on user input, route parameters, or other dynamic values.

```tsx
import { useQuery } from '@tanstack/react-query'

function UserProfile({ userId }) {
  const { data: user, isPending } = useQuery({
    queryKey: ['user', userId], // Refetches when userId changes
    queryFn: async () => {
      const response = await fetch(`/api/users/${userId}`)
      if (!response.ok) throw new Error('User not found')
      return response.json()
    },
    enabled: !!userId, // Only fetch when userId is truthy
  })

  if (isPending) return <div>Loading user...</div>

  return (
    <div>
      <h2>{user.name}</h2>
      <p>Email: {user.email}</p>
    </div>
  )
}

// Query with multiple parameters
function SearchResults({ query, page, filters }) {
  const { data } = useQuery({
    queryKey: ['search', query, page, filters],
    queryFn: () => searchAPI({ query, page, ...filters }),
    enabled: query.length > 2,
    placeholderData: (previousData) => previousData, // Keep previous data while fetching
  })

  return <ResultsList results={data?.results} />
}
```

---

## useMutation - Data Modifications

The `useMutation` hook handles create, update, and delete operations with built-in support for callbacks, error handling, and cache invalidation.

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query'

function AddTodo() {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')

  const mutation = useMutation({
    mutationFn: async (newTodo) => {
      const response = await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newTodo),
      })
      if (!response.ok) throw new Error('Failed to create todo')
      return response.json()
    },
    onSuccess: (data) => {
      // Invalidate and refetch todos list
      queryClient.invalidateQueries({ queryKey: ['todos'] })
      setTitle('')
    },
    onError: (error) => {
      console.error('Mutation failed:', error.message)
    },
    onSettled: () => {
      // Runs on both success and error
      console.log('Mutation completed')
    },
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        mutation.mutate({ title, completed: false })
      }}
    >
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        disabled={mutation.isPending}
      />
      <button type="submit" disabled={mutation.isPending}>
        {mutation.isPending ? 'Adding...' : 'Add Todo'}
      </button>
      {mutation.isError && <p>Error: {mutation.error.message}</p>}
    </form>
  )
}
```

---

## useMutation with Optimistic Updates

Optimistic updates allow immediate UI feedback while mutations are in progress, with automatic rollback on failure.

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query'

function TodoItem({ todo }) {
  const queryClient = useQueryClient()

  const updateMutation = useMutation({
    mutationFn: async (updatedTodo) => {
      const response = await fetch(`/api/todos/${updatedTodo.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedTodo),
      })
      if (!response.ok) throw new Error('Update failed')
      return response.json()
    },
    onMutate: async (newTodo) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['todos'] })

      // Snapshot previous value
      const previousTodos = queryClient.getQueryData(['todos'])

      // Optimistically update cache
      queryClient.setQueryData(['todos'], (old) =>
        old.map((t) => (t.id === newTodo.id ? newTodo : t))
      )

      // Return context for rollback
      return { previousTodos }
    },
    onError: (err, newTodo, context) => {
      // Rollback on error
      queryClient.setQueryData(['todos'], context.previousTodos)
    },
    onSettled: () => {
      // Refetch to ensure server state
      queryClient.invalidateQueries({ queryKey: ['todos'] })
    },
  })

  const toggleComplete = () => {
    updateMutation.mutate({ ...todo, completed: !todo.completed })
  }

  return (
    <li style={{ opacity: updateMutation.isPending ? 0.5 : 1 }}>
      <input
        type="checkbox"
        checked={todo.completed}
        onChange={toggleComplete}
      />
      {todo.title}
    </li>
  )
}
```

---

## useInfiniteQuery - Pagination and Infinite Scroll

The `useInfiniteQuery` hook supports paginated data with load-more or infinite scroll functionality.

```tsx
import { useInfiniteQuery } from '@tanstack/react-query'
import { useInView } from 'react-intersection-observer'

function InfiniteList() {
  const { ref, inView } = useInView()

  const {
    data,
    error,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
    status,
  } = useInfiniteQuery({
    queryKey: ['items'],
    queryFn: async ({ pageParam }) => {
      const response = await fetch(`/api/items?cursor=${pageParam}&limit=20`)
      return response.json()
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    getPreviousPageParam: (firstPage) => firstPage.prevCursor ?? undefined,
    maxPages: 5, // Limit stored pages for memory optimization
  })

  // Auto-fetch when scrolling to bottom
  React.useEffect(() => {
    if (inView && hasNextPage && !isFetching) {
      fetchNextPage()
    }
  }, [inView, hasNextPage, isFetching, fetchNextPage])

  if (status === 'pending') return <div>Loading...</div>
  if (status === 'error') return <div>Error: {error.message}</div>

  return (
    <div>
      {data.pages.map((page, pageIndex) => (
        <React.Fragment key={pageIndex}>
          {page.items.map((item) => (
            <div key={item.id}>{item.name}</div>
          ))}
        </React.Fragment>
      ))}

      <div ref={ref}>
        {isFetchingNextPage
          ? 'Loading more...'
          : hasNextPage
          ? 'Load more'
          : 'No more items'}
      </div>
    </div>
  )
}
```

---

## Query Invalidation and Cache Management

Programmatically invalidate, refetch, or update cached data using the QueryClient methods.

```tsx
import { useQueryClient } from '@tanstack/react-query'

function CacheManagement() {
  const queryClient = useQueryClient()

  // Invalidate all queries starting with 'todos'
  const invalidateTodos = () => {
    queryClient.invalidateQueries({ queryKey: ['todos'] })
  }

  // Invalidate specific query
  const invalidateUser = (userId) => {
    queryClient.invalidateQueries({ queryKey: ['user', userId] })
  }

  // Invalidate with exact match only
  const invalidateExact = () => {
    queryClient.invalidateQueries({ queryKey: ['todos'], exact: true })
  }

  // Invalidate using predicate
  const invalidateStale = () => {
    queryClient.invalidateQueries({
      predicate: (query) =>
        query.queryKey[0] === 'todos' &&
        query.state.dataUpdatedAt < Date.now() - 60000,
    })
  }

  // Directly update cache
  const updateTodoInCache = (todoId, updates) => {
    queryClient.setQueryData(['todos'], (oldTodos) =>
      oldTodos?.map((todo) =>
        todo.id === todoId ? { ...todo, ...updates } : todo
      )
    )
  }

  // Get cached data
  const getCachedTodos = () => {
    return queryClient.getQueryData(['todos'])
  }

  // Remove query from cache
  const removeTodosCache = () => {
    queryClient.removeQueries({ queryKey: ['todos'] })
  }

  // Refetch all active queries
  const refetchAll = () => {
    queryClient.refetchQueries({ type: 'active' })
  }

  return (
    <div>
      <button onClick={invalidateTodos}>Invalidate Todos</button>
      <button onClick={refetchAll}>Refetch All Active</button>
    </div>
  )
}
```

---

## Prefetching Data

Prefetch data before it's needed to improve perceived performance, such as on hover or route changes.

```tsx
import { useQueryClient } from '@tanstack/react-query'

function UserList({ users }) {
  const queryClient = useQueryClient()

  // Prefetch on hover
  const prefetchUser = async (userId) => {
    await queryClient.prefetchQuery({
      queryKey: ['user', userId],
      queryFn: () => fetchUser(userId),
      staleTime: 1000 * 60 * 5, // Only prefetch if stale
    })
  }

  return (
    <ul>
      {users.map((user) => (
        <li
          key={user.id}
          onMouseEnter={() => prefetchUser(user.id)}
          onFocus={() => prefetchUser(user.id)}
        >
          <Link to={`/users/${user.id}`}>{user.name}</Link>
        </li>
      ))}
    </ul>
  )
}

// Prefetch in route loader (with React Router or TanStack Router)
const userRoute = {
  path: '/users/:userId',
  loader: async ({ params }) => {
    await queryClient.prefetchQuery({
      queryKey: ['user', params.userId],
      queryFn: () => fetchUser(params.userId),
    })
  },
  component: UserProfile,
}

// Ensure data exists or fetch
async function ensureUserData(userId) {
  const data = await queryClient.ensureQueryData({
    queryKey: ['user', userId],
    queryFn: () => fetchUser(userId),
  })
  return data
}
```

---

## useSuspenseQuery - React Suspense Integration

Use TanStack Query with React Suspense for cleaner loading states and error boundaries.

```tsx
import { useSuspenseQuery } from '@tanstack/react-query'
import { Suspense } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { QueryErrorResetBoundary } from '@tanstack/react-query'

function UserProfile({ userId }) {
  // data is guaranteed to be defined (no isPending check needed)
  const { data: user } = useSuspenseQuery({
    queryKey: ['user', userId],
    queryFn: () => fetchUser(userId),
  })

  return (
    <div>
      <h2>{user.name}</h2>
      <p>{user.email}</p>
    </div>
  )
}

function App() {
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <ErrorBoundary
          onReset={reset}
          fallbackRender={({ resetErrorBoundary, error }) => (
            <div>
              <p>Error: {error.message}</p>
              <button onClick={resetErrorBoundary}>Retry</button>
            </div>
          )}
        >
          <Suspense fallback={<div>Loading user...</div>}>
            <UserProfile userId={1} />
          </Suspense>
        </ErrorBoundary>
      )}
    </QueryErrorResetBoundary>
  )
}
```

---

## Dependent Queries

Execute queries that depend on the results of other queries using the `enabled` option.

```tsx
import { useQuery } from '@tanstack/react-query'

function UserPosts({ userId }) {
  // First query - fetch user
  const { data: user } = useQuery({
    queryKey: ['user', userId],
    queryFn: () => fetchUser(userId),
  })

  // Dependent query - fetch posts only after user is loaded
  const { data: posts, isPending: postsLoading } = useQuery({
    queryKey: ['posts', user?.id],
    queryFn: () => fetchPostsByUser(user.id),
    enabled: !!user?.id, // Only runs when user.id exists
  })

  // Dependent query - fetch user's team
  const { data: team } = useQuery({
    queryKey: ['team', user?.teamId],
    queryFn: () => fetchTeam(user.teamId),
    enabled: !!user?.teamId,
  })

  if (!user) return <div>Loading user...</div>

  return (
    <div>
      <h2>{user.name}</h2>
      {postsLoading ? (
        <p>Loading posts...</p>
      ) : (
        <ul>
          {posts?.map((post) => (
            <li key={post.id}>{post.title}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

---

## Parallel Queries with useQueries

Execute multiple queries in parallel and handle their results together.

```tsx
import { useQueries } from '@tanstack/react-query'

function Dashboard({ userIds }) {
  const userQueries = useQueries({
    queries: userIds.map((id) => ({
      queryKey: ['user', id],
      queryFn: () => fetchUser(id),
      staleTime: 1000 * 60 * 5,
    })),
    combine: (results) => {
      return {
        data: results.map((result) => result.data),
        isPending: results.some((result) => result.isPending),
        isError: results.some((result) => result.isError),
        errors: results.filter((result) => result.error).map((r) => r.error),
      }
    },
  })

  if (userQueries.isPending) return <div>Loading users...</div>
  if (userQueries.isError) {
    return <div>Errors: {userQueries.errors.map((e) => e.message).join(', ')}</div>
  }

  return (
    <div>
      {userQueries.data.map((user) => (
        <UserCard key={user.id} user={user} />
      ))}
    </div>
  )
}
```

---

## Query Options and Reusable Query Factories

Create reusable query configurations with `queryOptions` for better code organization and type safety.

```tsx
import { queryOptions, useQuery, useSuspenseQuery } from '@tanstack/react-query'

// Define reusable query options
const todosQueryOptions = queryOptions({
  queryKey: ['todos'],
  queryFn: fetchTodos,
  staleTime: 1000 * 60 * 5,
})

const userQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: ['user', userId],
    queryFn: () => fetchUser(userId),
    staleTime: 1000 * 60 * 10,
  })

const postQueryOptions = (postId: string) =>
  queryOptions({
    queryKey: ['post', postId],
    queryFn: () => fetchPost(postId),
  })

// Use in components
function TodoList() {
  const { data } = useQuery(todosQueryOptions)
  return <ul>{data?.map((todo) => <li key={todo.id}>{todo.title}</li>)}</ul>
}

function UserProfile({ userId }) {
  const { data: user } = useSuspenseQuery(userQueryOptions(userId))
  return <div>{user.name}</div>
}

// Use for prefetching
async function prefetchUser(queryClient, userId) {
  await queryClient.prefetchQuery(userQueryOptions(userId))
}

// Use for cache manipulation
function updateUserCache(queryClient, userId, updates) {
  queryClient.setQueryData(userQueryOptions(userId).queryKey, (old) => ({
    ...old,
    ...updates,
  }))
}
```

---

## Vue Query

TanStack Query for Vue uses the same core concepts with Vue's reactivity system and Composition API.

```vue
<script setup>
import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { computed } from 'vue'

const queryClient = useQueryClient()

// Basic query
const { data: todos, isPending, isError, error } = useQuery({
  queryKey: ['todos'],
  queryFn: async () => {
    const response = await fetch('/api/todos')
    return response.json()
  },
})

// Query with reactive parameters
const props = defineProps(['userId'])
const { data: user } = useQuery({
  queryKey: computed(() => ['user', props.userId]),
  queryFn: () => fetchUser(props.userId),
  enabled: computed(() => !!props.userId),
})

// Mutation
const { mutate: addTodo, isPending: isAdding } = useMutation({
  mutationFn: (newTodo) => fetch('/api/todos', {
    method: 'POST',
    body: JSON.stringify(newTodo),
  }),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['todos'] })
  },
})

const handleAdd = () => {
  addTodo({ title: 'New Todo', completed: false })
}
</script>

<template>
  <div>
    <div v-if="isPending">Loading...</div>
    <div v-else-if="isError">Error: {{ error.message }}</div>
    <ul v-else>
      <li v-for="todo in todos" :key="todo.id">{{ todo.title }}</li>
    </ul>
    <button @click="handleAdd" :disabled="isAdding">
      {{ isAdding ? 'Adding...' : 'Add Todo' }}
    </button>
  </div>
</template>
```

---

## Solid Query

TanStack Query for SolidJS integrates with Solid's reactivity primitives and Suspense.

```tsx
import { ErrorBoundary, Suspense, For } from 'solid-js'
import {
  useQuery,
  useMutation,
  useQueryClient,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/solid-query'

const queryClient = new QueryClient()

function TodoApp() {
  const queryClient = useQueryClient()

  // Query with getter function for reactive options
  const todosQuery = useQuery(() => ({
    queryKey: ['todos'],
    queryFn: async () => {
      const response = await fetch('/api/todos')
      if (!response.ok) throw new Error('Failed to fetch')
      return response.json()
    },
    staleTime: 1000 * 60 * 5,
    throwOnError: true,
  }))

  const addTodoMutation = useMutation(() => ({
    mutationFn: (newTodo) =>
      fetch('/api/todos', {
        method: 'POST',
        body: JSON.stringify(newTodo),
      }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['todos'] })
    },
  }))

  return (
    <ErrorBoundary fallback={<div>Something went wrong!</div>}>
      <Suspense fallback={<div>Loading...</div>}>
        <ul>
          <For each={todosQuery.data}>
            {(todo) => <li>{todo.title}</li>}
          </For>
        </ul>
        <button
          onClick={() => addTodoMutation.mutate({ title: 'New Todo' })}
          disabled={addTodoMutation.isPending}
        >
          Add Todo
        </button>
      </Suspense>
    </ErrorBoundary>
  )
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TodoApp />
    </QueryClientProvider>
  )
}
```

---

## Angular Query

TanStack Query for Angular uses signals and dependency injection patterns.

```typescript
import { Component, inject } from '@angular/core'
import { HttpClient } from '@angular/common/http'
import {
  injectQuery,
  injectMutation,
  injectQueryClient,
} from '@tanstack/angular-query-experimental'
import { lastValueFrom } from 'rxjs'

interface Todo {
  id: number
  title: string
  completed: boolean
}

@Component({
  selector: 'app-todos',
  template: `
    @if (todosQuery.isPending()) {
      <div>Loading...</div>
    }
    @if (todosQuery.error()) {
      <div>Error: {{ todosQuery.error()?.message }}</div>
    }
    @if (todosQuery.data(); as todos) {
      <ul>
        @for (todo of todos; track todo.id) {
          <li>{{ todo.title }}</li>
        }
      </ul>
    }
    <button
      (click)="addTodo()"
      [disabled]="addTodoMutation.isPending()"
    >
      {{ addTodoMutation.isPending() ? 'Adding...' : 'Add Todo' }}
    </button>
  `,
})
export class TodosComponent {
  private http = inject(HttpClient)
  private queryClient = injectQueryClient()

  todosQuery = injectQuery(() => ({
    queryKey: ['todos'],
    queryFn: () =>
      lastValueFrom(this.http.get<Todo[]>('/api/todos')),
  }))

  addTodoMutation = injectMutation(() => ({
    mutationFn: (newTodo: Partial<Todo>) =>
      lastValueFrom(this.http.post<Todo>('/api/todos', newTodo)),
    onSuccess: () => {
      this.queryClient.invalidateQueries({ queryKey: ['todos'] })
    },
  }))

  addTodo() {
    this.addTodoMutation.mutate({ title: 'New Todo', completed: false })
  }
}
```

---

## Server-Side Rendering (SSR) and Hydration

Configure TanStack Query for SSR with proper hydration to avoid refetching on the client.

```tsx
// Server-side: Prefetch and dehydrate
import {
  QueryClient,
  dehydrate,
  HydrationBoundary,
} from '@tanstack/react-query'

// Next.js App Router example
async function PostsPage() {
  const queryClient = new QueryClient()

  await queryClient.prefetchQuery({
    queryKey: ['posts'],
    queryFn: fetchPosts,
  })

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <PostsList />
    </HydrationBoundary>
  )
}

// Client component
'use client'
import { useQuery } from '@tanstack/react-query'

function PostsList() {
  // This will use the prefetched data without refetching
  const { data: posts } = useQuery({
    queryKey: ['posts'],
    queryFn: fetchPosts,
    staleTime: 1000 * 60 * 5,
  })

  return (
    <ul>
      {posts?.map((post) => (
        <li key={post.id}>{post.title}</li>
      ))}
    </ul>
  )
}

// Provider setup for SSR
'use client'
import { QueryClient, QueryClientProvider, isServer } from '@tanstack/react-query'

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000, // Prevent immediate refetch on client
      },
    },
  })
}

let browserQueryClient: QueryClient | undefined

function getQueryClient() {
  if (isServer) {
    return makeQueryClient()
  }
  if (!browserQueryClient) {
    browserQueryClient = makeQueryClient()
  }
  return browserQueryClient
}

export function Providers({ children }) {
  const queryClient = getQueryClient()
  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )
}
```

---

## DevTools

TanStack Query DevTools provides a visual interface for inspecting and debugging query state during development.

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'

const queryClient = new QueryClient()

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <MyApplication />
      {/* DevTools - only included in development builds */}
      <ReactQueryDevtools
        initialIsOpen={false}
        buttonPosition="bottom-right"
      />
    </QueryClientProvider>
  )
}

// For production, you can lazy load devtools
import { lazy, Suspense } from 'react'

const ReactQueryDevtoolsProduction = lazy(() =>
  import('@tanstack/react-query-devtools/build/modern/production.js').then(
    (d) => ({ default: d.ReactQueryDevtools })
  )
)

function App() {
  const [showDevtools, setShowDevtools] = useState(false)

  return (
    <QueryClientProvider client={queryClient}>
      <MyApplication />
      <button onClick={() => setShowDevtools(true)}>Show Devtools</button>
      {showDevtools && (
        <Suspense fallback={null}>
          <ReactQueryDevtoolsProduction />
        </Suspense>
      )}
    </QueryClientProvider>
  )
}
```

---

## Summary

TanStack Query is essential for any application that needs to manage server state effectively. Its core use cases include fetching and caching API data with automatic background refetching, implementing optimistic updates for responsive UIs, handling pagination and infinite scrolling, prefetching data for instant page transitions, and synchronizing server state across multiple components without prop drilling. The library dramatically reduces boilerplate compared to manual state management while providing robust features like automatic garbage collection, request deduplication, and error retry logic out of the box.

Integration patterns vary by framework but share the same conceptual model: wrap your application with a QueryClientProvider, use query hooks to fetch data declaratively, use mutation hooks for data modifications, and leverage the QueryClient for imperative cache operations. For optimal performance, define query options factories for reusable configurations, set appropriate staleTime and gcTime values, implement prefetching for predictable navigation patterns, and use the DevTools during development to understand caching behavior. The library works seamlessly with TypeScript, providing excellent type inference for query data and mutation variables.
