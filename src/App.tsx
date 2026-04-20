import { useEffect, useRef, useState } from 'react';
// import { SingleTabManager } from './core/single-tab-manager';

import { SingleTabManager } from '../dist/single-tab-manager';

function App() {
  const [isActive, setIsActive] = useState<boolean | null>(null);
  const managerRef = useRef<SingleTabManager | null>(null);

  useEffect(() => {
    const manager = new SingleTabManager('broadcast', {
      onActive: () => {
        setIsActive(true);
      },
      onBlocked: () => {
        setIsActive(false);
      },
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
      <h1>Single active browser tab (broadcast)</h1>
      {isActive === null && <p>Connecting…</p>}
      {isActive === true && (
        <p data-testid="status-active" style={{ color: 'green' }}>
          This tab is active
        </p>
      )}
      {isActive === false && (
        <>
          <p data-testid="status-blocked" style={{ color: 'orange' }}>
            Another tab is already active
          </p>
          <button
            data-testid="takeover-button"
            className="reload"
            type="button"
            onClick={() => managerRef.current?.takeover()}
          >
            Reload
          </button>
        </>
      )}
    </main>
  );
}

export default App;
