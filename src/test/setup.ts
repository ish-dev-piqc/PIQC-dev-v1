// Vitest global setup — extends `expect` with @testing-library/jest-dom matchers
// (toBeInTheDocument, toHaveTextContent, toBeDisabled, etc.).

import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// With `globals: false`, RTL's auto-cleanup never registers (it needs a global
// afterEach at import time), so rendered DOM leaks across tests. Register it here.
afterEach(cleanup);
