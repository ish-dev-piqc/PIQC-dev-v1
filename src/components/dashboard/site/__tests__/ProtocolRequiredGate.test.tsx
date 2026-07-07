import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ProtocolRequiredGate from '../ProtocolRequiredGate';

vi.mock('../../../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light' }),
}));

const mockUseProtocol = vi.fn();
vi.mock('../../../../context/ProtocolContext', () => ({
  useProtocol: () => mockUseProtocol(),
}));

// =============================================================================
// ProtocolRequiredGate — the "select a protocol" prompt must only appear once
// protocols have finished loading. While the fetch is in flight the persisted
// activeId may still resolve to a protocol, so the gate renders nothing.
// =============================================================================

describe('ProtocolRequiredGate', () => {
  beforeEach(() => {
    mockUseProtocol.mockReset();
  });

  it('renders nothing while protocols are loading', () => {
    mockUseProtocol.mockReturnValue({ activeProtocol: null, isLoading: true });
    const { container } = render(
      <ProtocolRequiredGate label="Visit Prep">
        <div>child content</div>
      </ProtocolRequiredGate>
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows the select-a-protocol prompt when loaded with no active protocol', () => {
    mockUseProtocol.mockReturnValue({ activeProtocol: null, isLoading: false });
    render(
      <ProtocolRequiredGate label="Visit Prep">
        <div>child content</div>
      </ProtocolRequiredGate>
    );
    expect(screen.getByText('Select a protocol to open Visit Prep')).toBeInTheDocument();
    expect(screen.queryByText('child content')).not.toBeInTheDocument();
  });

  it('renders children when an active protocol is set', () => {
    mockUseProtocol.mockReturnValue({
      activeProtocol: { id: 'p1', name: 'Protocol 1' },
      isLoading: false,
    });
    render(
      <ProtocolRequiredGate label="Visit Prep">
        <div>child content</div>
      </ProtocolRequiredGate>
    );
    expect(screen.getByText('child content')).toBeInTheDocument();
    expect(screen.queryByText(/Select a protocol/)).not.toBeInTheDocument();
  });
});
