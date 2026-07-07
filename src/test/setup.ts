// Vitest global setup — extends `expect` with @testing-library/jest-dom matchers
// (toBeInTheDocument, toHaveTextContent, toBeDisabled, etc.).

import '@testing-library/jest-dom/vitest';

// RTL auto-cleanup only self-registers when `afterEach` is a GLOBAL at import
// time. This repo runs vitest with `globals: false`, so without this explicit
// hook the DOM accumulates across tests within a file and multi-test files
// fail with "Found multiple elements" as earlier renders leak into later
// queries. Register cleanup explicitly — the canonical globals:false pattern.
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
