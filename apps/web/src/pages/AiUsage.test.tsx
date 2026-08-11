import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AiUsageDashboardView } from './AiUsage.js';

vi.hoisted(() => {
  const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  Object.defineProperty(globalThis, 'sessionStorage', { value: storage, configurable: true });
});

describe('AI usage dashboard states', () => {
  it('renders the loading state', () => {
    const html = renderToStaticMarkup(
      <AiUsageDashboardView isLoading range="today" onRangeChange={vi.fn()} />,
    );
    expect(html).toContain('Loading UniMate');
  });

  it('renders the API error state', () => {
    const html = renderToStaticMarkup(
      <AiUsageDashboardView
        isLoading={false}
        error={new Error('Usage API unavailable')}
        range="today"
        onRangeChange={vi.fn()}
      />,
    );
    expect(html).toContain('Usage API unavailable');
    expect(html).toContain('role="alert"');
  });
});
