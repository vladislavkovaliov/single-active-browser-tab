# Single Active Browser Tab

A lightweight, framework-agnostic JavaScript library that ensures only one browser tab can be active at a time. Uses two coordination strategies: Service Worker or BroadcastChannel.

## Features

- ✅ **Two strategies** - Service Worker (default) or BroadcastChannel
- ✅ **Framework-agnostic** - Works with React, Vue, Angular, or vanilla JS
- ✅ **Zero dependencies** - Pure TypeScript/JavaScript
- ✅ **Crash-resistant** - Handles tab crashes and forced browser closes
- ✅ **Automatic failover** - New tab takes over when active tab closes
- ✅ **Configurable** - Customize heartbeat intervals and timeouts
- ✅ **TypeScript support** - Full type definitions included

## Installation

```bash
npm install single-active-browser-tab
```

Or copy the `src/SingleTabManager.ts` file directly into your project.

## Quick Start

### Basic Usage

```typescript
import { SingleTabManager } from 'single-active-browser-tab';

// Service Worker strategy (default)
const manager = new SingleTabManager('sw', {
  onActive: () => {
    console.log('✅ This tab is now active');
    // Start your business logic here
  },
  onBlocked: () => {
    console.log('🚫 Another tab is active - this tab is blocked');
    // Show a message to the user or disable functionality
  },
});

// Or use BroadcastChannel strategy
const manager = new SingleTabManager('broadcast', {
  onActive: () => {
    console.log('✅ This tab is now active');
  },
  onBlocked: () => {
    console.log('🚫 Another tab is active - this tab is blocked');
  },
});

// Start the manager
manager.start();

// Check if this tab is active
if (manager.isActive()) {
  // Execute privileged operations
}

// Check if this tab is blocked
if (manager.isBlocked()) {
  // This tab is not active
}

// Stop the manager (e.g., on page unload)
// manager.stop();
```

### React Example

```tsx
import { useEffect, useState } from 'react';
import { SingleTabManager } from 'single-active-browser-tab';

function App() {
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    const manager = new SingleTabManager('sw', {
      onActive: () => setIsActive(true),
      onBlocked: () => setIsActive(false),
    });

    manager.start();

    return () => manager.stop();
  }, []);

  return (
    <div>
      {isActive ? (
        <div>
          <h1>Active Tab</h1>
          <p>You can perform privileged operations here.</p>
        </div>
      ) : (
        <div>
          <h1>Tab Blocked</h1>
          <p>Another tab is currently active.</p>
        </div>
      )}
    </div>
  );
}
```

### Vue Example

```vue
<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { SingleTabManager } from 'single-active-browser-tab';

const isActive = ref(false);
let manager: SingleTabManager;

onMounted(() => {
  manager = new SingleTabManager('sw', {
    onActive: () => (isActive.value = true),
    onBlocked: () => (isActive.value = false),
  });
  manager.start();
});

onUnmounted(() => {
  manager.stop();
});
</script>

<template>
  <div v-if="isActive">
    <h1>Active Tab</h1>
  </div>
  <div v-else>
    <h1>Tab Blocked</h1>
  </div>
</template>
```

### Vanilla JS Example

```html
<!DOCTYPE html>
<html>
  <head>
    <title>Single Active Tab</title>
  </head>
  <body>
    <div id="status">Loading...</div>

    <script type="module">
      import { SingleTabManager } from 'single-active-browser-tab';

      const statusEl = document.getElementById('status');

      const manager = new SingleTabManager('sw', {
        onActive: () => {
          statusEl.textContent = '✅ This is the active tab';
          statusEl.style.color = 'green';
        },
        onBlocked: () => {
          statusEl.textContent = '🚫 Another tab is active';
          statusEl.style.color = 'red';
        },
      });

      manager.start();
    </script>
  </body>
</html>
```

## API Reference

### `new SingleTabManager(strategy?, options?)`

Creates a new `SingleTabManager` instance.

#### Parameters

| Parameter  | Type                  | Default | Description           |
| ---------- | --------------------- | ------- | --------------------- |
| `strategy` | `'sw' \| 'broadcast'` | `'sw'`  | Coordination strategy |
| `options`  | `object`              | -       | Configuration options |

#### Options

| Option              | Type                         | Default                          | Description                                                  |
| ------------------- | ---------------------------- | -------------------------------- | ------------------------------------------------------------ |
| `onActive`          | `() => void`                 | -                                | Callback when this tab becomes active                        |
| `onBlocked`         | `() => void`                 | -                                | Callback when this tab becomes blocked                       |
| `swPath`            | `string`                     | `'sw.js'`                        | Service worker path (sw strategy only)                       |
| `heartbeatInterval` | `number`                     | `2000` (sw) / `5000` (broadcast) | Milliseconds between heartbeat updates                       |
| `staleTimeout`      | `number`                     | `5000`                           | Milliseconds before tab is considered stale (broadcast only) |
| `channelName`       | `string`                     | `'single-tab-manager-broadcast'` | BroadcastChannel name (broadcast only)                       |
| `logLevel`          | `'error' \| 'warn' \| 'log'` | -                                | Logging level                                                |

### Manager Methods

#### `start()`

Starts the manager. Begins heartbeat and checks for active tab.

```typescript
manager.start();
```

#### `stop()`

Stops the manager. Cleans up timers and removes event listeners. If this tab was active, clears the state from localStorage.

```typescript
manager.stop();
```

#### `isActive()`

Returns `true` if this tab is currently the active tab.

```typescript
if (manager.isActive()) {
  // This tab is active
}
```

#### `isBlocked()`

Returns `true` if another tab is active and this tab is blocked.

```typescript
if (manager.isBlocked()) {
  // This tab is blocked
}
```

#### `takeover()`

Forcefully takes over control from another tab, even if it's still active.

```typescript
// Force take over
manager.takeover();
```

## How It Works

### Choose a Strategy

The library provides two strategies for coordinating tab activity:

| Strategy         | Use When                                                                | Pros                                         | Cons                                         |
| ---------------- | ----------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------- |
| `'sw'` (default) | You need precise control, work with iframes, or want better reliability | Works in iframes, precise ownership tracking | Requires Service Worker file, needs HTTPS    |
| `'broadcast'`    | Simplicity is prioritized, same-origin tabs only                        | No Service Worker needed, simpler setup      | Doesn't work cross-origin, uses localStorage |

### Service Worker Strategy

The default `'sw'` strategy uses a Service Worker to coordinate tabs:

1. **Registration**: Each tab registers the service worker (`sw.js`).
2. **Query**: Tab asks the worker "am I active?" via `postMessage`.
3. **Heartbeat**: Active tab sends periodic pings to keep ownership.
4. **Takeover**: The worker notifies all tabs when ownership changes.

### BroadcastChannel Strategy

The `'broadcast'` strategy uses `BroadcastChannel` + `localStorage`:

1. **Tab ID**: Each tab generates a unique ID stored in sessionStorage.
2. **State**: Active tab writes to localStorage with timestamp.
3. **Broadcast**: Uses BroadcastChannel to notify other tabs of state changes.
4. **Stale Detection**: If no heartbeat within `staleTimeout`, tab is considered dead.

### Heartbeat Mechanism

1. **Tab Identification**: Each tab generates a unique ID (`timestamp-random`) on load.

2. **State Storage**: Active tab stores its state:
   - SW strategy: uses Cache API
   - Broadcast strategy: uses localStorage:

   ```json
   {
     "ownerId": "1700000000000-0.123456",
     "lastSeen": 1700000000000
   }
   ```

3. **Heartbeat**: Active tab updates `lastSeen` every `heartbeatInterval` (2s for SW, 5s for broadcast).

4. **Stale Detection**: If no heartbeat within `staleTimeout` (broadcast only, default: 5s), the tab is considered dead.

5. **Cross-Tab Communication**:
   - SW strategy: Uses Service Worker `postMessage`
   - Broadcast strategy: Uses `storage` events to detect changes

### State Flow

```
┌─────────────┐
│  Tab Opens  │
└──────┬──────┘
       │
       ▼
┌─────────────────┐
│ Check Strategy   │
└──────┬──────────┘
       │
       ├─── No owner ─────► Become Active
       │
       ├─── Stale owner ──► Become Active
       │
       └─── Active owner ─► Become Blocked
```

## Use Cases

- **License enforcement** - Only allow one active session per user
- **Real-time dashboards** - Prevent duplicate data updates
- **Admin panels** - Avoid conflicting administrative actions
- **Kiosk mode** - Ensure only one window controls the display
- **Testing environments** - Prevent test interference across tabs

## Development

### Available Scripts

```bash
# Run unit tests
npm test

# Run E2E tests with Playwright (headless)
npm run test:pw

# Run E2E tests with Playwright (interactive UI)
npm run test:pw:ui

# Run ESLint
npm run lint

# Auto-fix ESLint issues
npm run lint:fix

# Format code with Prettier
npm run format

# Check formatting
npm run format:check

# Type check
npm run typecheck
```

### E2E Testing with Playwright

The project uses Playwright for end-to-end testing of both strategies:

- **Service Worker Strategy**: Tests the default behavior where a new tab becomes blocked when another active tab exists.

- **Broadcast Strategy**: Tests the ability to forcefully take control using the `takeover()` method.

To run tests:

```bash
# Open Playwright UI (recommended for development)
npm run test:pw:ui

# Run all tests in headless mode
npm run test:pw

# Run with Chrome
npm run test:pw:chrome

# Run with Firefox
npm run test:pw:firefox
```

## Browser Support

Works in all modern browsers that support:

- `localStorage`
- `window.addEventListener`
- ES6+

## License

ISC
