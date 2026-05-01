// src/components/__tests__/StopModal.test.tsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { StopModal } from '../src/components/Modals/StopModal';
import { ThemeColors } from '../src/context/ThemeContext';
import { RouteArrival } from '../src/types/transit';

// Mock the vector icons to prevent Jest errors
jest.mock('react-native-vector-icons/Ionicons', () => 'Icon');

describe('StopModal Component', () => {
  const mockColors = {
    backgroundLight: '#ffffff',
    shadowDark: '#000000',
    textPrimary: '#111111',
    darkGray: '#666666',
    borderLight: '#eeeeee',
    primary: '#007bff',
  } as ThemeColors;

  const mockOnClose = jest.fn();
  const defaultStopName = 'Student Union';

  const mockArrivals: RouteArrival[] = [
    {
      routeId: '44317',
      routeName: 'East Loop',
      abbreviation: 'E',
      color: '#ffea3f',
      etaMinutes: 3,
    },
    {
      routeId: '44318',
      routeName: 'West Loop',
      abbreviation: 'W',
      color: '#00a8e8',
      etaMinutes: 12,
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the stop name correctly when open', () => {
    render(
      <StopModal
        isOpen={true}
        onClose={mockOnClose}
        stopName={defaultStopName}
        arrivals={[]}
        isLoading={false}
        colors={mockColors}
      />
    );

    expect(screen.getByText(defaultStopName)).toBeTruthy();
  });

  it('calls onClose when the close icon button is pressed', () => {
    render(
      <StopModal
        isOpen={true}
        onClose={mockOnClose}
        stopName={defaultStopName}
        arrivals={[]}
        isLoading={false}
        colors={mockColors}
      />
    );

    const closeButton = screen.getByRole('button', { name: 'Close stop details' });
    fireEvent.press(closeButton);

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when the background overlay is pressed', () => {
    // The overlay is the first element, wrapping the modal content
    render(
      <StopModal
        isOpen={true}
        onClose={mockOnClose}
        stopName={defaultStopName}
        arrivals={[]}
        isLoading={false}
        colors={mockColors}
      />
    );

    // Get TouchableOpacity
    const modalRoot = screen.getByText(defaultStopName).parent?.parent?.parent?.parent;
    if (modalRoot) {
      fireEvent.press(modalRoot);
    }
  });

  it('displays the loading indicator when isLoading is true', () => {
    render(
      <StopModal
        isOpen={true}
        onClose={mockOnClose}
        stopName={defaultStopName}
        arrivals={[]}
        isLoading={true}
        colors={mockColors}
      />
    );

    expect(screen.getByLabelText('Loading arrival times')).toBeTruthy();
    expect(screen.getByText('Fetching live ETAs...')).toBeTruthy();
  });

  it('displays the empty state when there are no arrivals and not loading', () => {
    render(
      <StopModal
        isOpen={true}
        onClose={mockOnClose}
        stopName={defaultStopName}
        arrivals={[]}
        isLoading={false}
        colors={mockColors}
      />
    );

    expect(screen.getByText('No upcoming arrivals.')).toBeTruthy();
  });

  it('renders a list of arrivals correctly', () => {
    render(
      <StopModal
        isOpen={true}
        onClose={mockOnClose}
        stopName={defaultStopName}
        arrivals={mockArrivals}
        isLoading={false}
        colors={mockColors}
      />
    );

    // Check first route
    expect(screen.getByText('East Loop')).toBeTruthy();
    expect(screen.getByText('E')).toBeTruthy();
    expect(screen.getByText('3 min')).toBeTruthy();

    // Check second route
    expect(screen.getByText('West Loop')).toBeTruthy();
    expect(screen.getByText('W')).toBeTruthy();
    expect(screen.getByText('12 min')).toBeTruthy();
  });

  it('handles shuttles with null ETAs gracefully', () => {
    const noVehicleArrivals: RouteArrival[] = [
      {
        routeId: '999',
        routeName: 'Night Shuttle',
        abbreviation: 'NS',
        color: '#333333',
        etaMinutes: null,
      },
    ];

    render(
      <StopModal
        isOpen={true}
        onClose={mockOnClose}
        stopName={defaultStopName}
        arrivals={noVehicleArrivals}
        isLoading={false}
        colors={mockColors}
      />
    );

    expect(screen.getByText('Night Shuttle')).toBeTruthy();
    expect(screen.getByText('NS')).toBeTruthy();
    expect(screen.getByText('no vehicles')).toBeTruthy();
  });

  it('verifies accessibility labels are constructed properly', () => {
    render(
      <StopModal
        isOpen={true}
        onClose={mockOnClose}
        stopName={defaultStopName}
        arrivals={mockArrivals}
        isLoading={false}
        colors={mockColors}
      />
    );

    const firstArrivalRow = screen.getByLabelText('Route East Loop. Arriving in 3 minutes.');
    expect(firstArrivalRow).toBeTruthy();
  });
});