import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Nach jedem Test das DOM leeren, damit sich Tests nicht gegenseitig sehen.
afterEach(cleanup);
