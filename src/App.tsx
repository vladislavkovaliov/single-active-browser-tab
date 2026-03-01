import { useEffect, useRef, useState } from 'react';
import { SingleTabManager } from './src/core';

function App() {
  const [isActive, setIsActive] = useState<boolean | null>(null);
  const managerRef = useRef<SingleTabManager | null>(null);

  useEffect(() => {
    const manager = new SingleTabManager('sw', {
      onActive: () => setIsActive(true),
      onBlocked: () => setIsActive(false),
    });
    managerRef.current = manager;
    manager.start();
    return () => {
      manager.stop();
      managerRef.current = null;
    };
  }, []);

  return (
    <main style={{ padding: '2rem', fontFamily: 'system-ui' }}>
      <h1>Hello World</h1>
      {isActive === null && <p>Connecting to service worker…</p>}
      {isActive === true && <p style={{ color: 'green' }}>This tab is active (ping-pong with SW)</p>}
      {isActive === false && (
        <>
          <p style={{ color: 'orange' }}>Another tab is active</p>
          <button type="button" onClick={() => managerRef.current?.takeover()}>
            Take over
          </button>
        </>
      )}
    </main>
  );
}

export default App;
