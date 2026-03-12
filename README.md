# Single Active Browser Tab

A lightweight, framework-agnostic JavaScript library that ensures only one browser tab can be active at a time. Uses a heartbeat mechanism with `localStorage` for cross-tab communication.

## Features

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
import { createSingleTabManager } from './SingleTabManager';

// Create manager with callbacks
const manager = createSingleTabManager({
  onActive: () => {
    console.log('✅ This tab is now active');
    // Start your business logic here
  },
  onBlocked: () => {
    console.log('🚫 Another tab is active - this tab is blocked');
    // Show a message to the user or disable functionality
  },
});

// Start the manager
manager.start();

// Check if this tab is active
if (manager.isActive()) {
  // Execute privileged operations
}

// Stop the manager (e.g., on page unload)
// manager.stop();
```

### React Example

```tsx
import { useEffect, useState } from 'react';
import { createSingleTabManager } from './SingleTabManager';

function App() {
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    const manager = createSingleTabManager({
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
import { createSingleTabManager } from './SingleTabManager';

const isActive = ref(false);
let manager: ReturnType<typeof createSingleTabManager>;

onMounted(() => {
  manager = createSingleTabManager({
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
      import { createSingleTabManager } from './SingleTabManager.js';

      const statusEl = document.getElementById('status');

      const manager = createSingleTabManager({
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

### `createSingleTabManager(options?)`

Creates a new `SingleTabManager` instance.

#### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `key` | `string` | `'single-active-tab'` | localStorage key for storing tab state |
| `heartbeatInterval` | `number` | `2000` | Milliseconds between heartbeat updates |
| `staleTimeout` | `number` | `5000` | Milliseconds before a tab is considered stale |
| `onActive` | `() => void` | - | Callback when this tab becomes active |
| `onBlocked` | `() => void` | - | Callback when this tab becomes blocked |

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
  // Another tab is active
}
```

#### `takeover()`

Forcefully takes over control from another tab, even if it's still active.

```typescript
// Force take over
manager.takeover();
```

#### `getTabId()`

Returns the unique ID for this tab.

```typescript
const tabId = manager.getTabId();
console.log(`Tab ID: ${tabId}`);
```

## How It Works

### Heartbeat Mechanism

1. **Tab Identification**: Each tab generates a unique ID (`timestamp-random`) on load.

2. **State Storage**: Active tab stores its state in `localStorage`:
   ```json
   {
     "id": "1700000000000-0.123456",
     "lastSeen": 1700000000000
   }
   ```

3. **Heartbeat**: Active tab updates `lastSeen` every `heartbeatInterval` (default: 2s).

4. **Stale Detection**: If `Date.now() - lastSeen > staleTimeout` (default: 5s), the tab is considered dead.

5. **Cross-Tab Communication**: Uses `storage` events to detect changes from other tabs.

### State Flow

```
┌─────────────┐
│  Tab Opens  │
└──────┬──────┘
       │
       ▼
┌─────────────────┐
│ Check localStorage │
└──────┬──────────┘
       │
       ├─── No state ─────► Become Active
       │
       ├─── Stale state ──► Become Active
       │
       └─── Active state ─► Become Blocked
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

# Run E2E tests with Cypress (headless)
npm run cypress:run

# Run E2E tests with Cypress (interactive UI)
npm run cypress:open

# Run E2E tests with dev server
npm run e2e

# Run E2E tests with dev server (interactive UI)
npm run e2e:open

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

### E2E Testing with Cypress

The project uses Cypress for end-to-end testing of both strategies:

- **Passive Strategy** (`cypress/e2e/passive-strategy.cy.ts`): Tests the default behavior where a new tab becomes blocked when another active tab exists.

- **Takeover Strategy** (`cypress/e2e/takeover-strategy.cy.ts`): Tests the ability to forcefully take control using the `takeover()` method.

To run tests:

```bash
# Open Cypress UI (recommended for development)
npm run cypress:open

# Run all tests in headless mode
npm run cypress:run

# Run with Chrome
npm run cypress:run:chrome

# Run with Firefox
npm run cypress:run:firefox
```

## Browser Support

Works in all modern browsers that support:
- `localStorage`
- `window.addEventListener`
- ES6+

## License

ISC
