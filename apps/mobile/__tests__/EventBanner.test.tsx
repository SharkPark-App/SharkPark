import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { EventBanner } from '../src/components/EventBanner';
import type { Event } from '../src/types/ui';
import { collectTexts, hasText } from './testUtils';

// ────────────────────── Mocks ──────────────────────

jest.mock('../src/context/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      textPrimary: '#ffffff',
      warningLight: '#ffffff',
      warningBorder: '#ffffff',
      warningText: '#ffffff',
      warningTextSecondary: '#ffffff',
    },
    isDark: false,
  }),
}));

// ────────────────────── Fixtures ──────────────────────

const makeEvent = (overrides: Partial<Event> = {}): Event => ({
  id: '1',
  name: 'Beach Volleyball Tournament',
  date: new Date(2026, 2, 29, 14, 0, 0),
  location: 'Walter Pyramid',
  affectedLots: ['G13', 'G14'],
  impact: 'medium',
  ...overrides,
});

function render(events: Event[]) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<EventBanner events={events} />);
  });
  return tree;
}

// ────────────────────── Tests ──────────────────────

describe('EventBanner', () => {
  it('renders nothing when events array is empty', () => {
    const tree = render([]);
    expect(tree.toJSON()).toBeNull();
  });

  it('renders the event name', () => {
    const tree = render([makeEvent()]);
    const texts = collectTexts(tree.root);
    expect(hasText(texts, 'Beach Volleyball Tournament')).toBe(true);
  });

  it('renders the event location', () => {
    const tree = render([makeEvent({ location: 'Court' })]);
    const texts = collectTexts(tree.root);
    expect(hasText(texts, 'Court')).toBe(true);
  });

  it('renders the description when provided', () => {
    const tree = render([
      makeEvent({ description: 'Expect heavy traffic near the courts.' }),
    ]);
    const texts = collectTexts(tree.root);
    expect(hasText(texts, 'Expect heavy traffic near the courts.')).toBe(true);
  });

  it('omits the description when not provided', () => {
    const event = makeEvent({ description: undefined });
    const tree = render([event]);
    const texts = collectTexts(tree.root);
    expect(hasText(texts, 'Expect heavy traffic')).toBe(false);
    expect(tree.toJSON()).toBeTruthy();
  });

  it('renders multiple events', () => {
    const events = [
      makeEvent({ id: '1', name: 'Event1', location: 'Location A' }),
      makeEvent({ id: '2', name: 'Event2', location: 'Location B' }),
    ];
    const tree = render(events);
    const texts = collectTexts(tree.root);

    expect(hasText(texts, 'Event1')).toBe(true);
    expect(hasText(texts, 'Event2')).toBe(true);
    expect(hasText(texts, 'Location A')).toBe(true);
    expect(hasText(texts, 'Location B')).toBe(true);
  });
});

describe('EventBanner -- accessibility', () => {
  const isAccessibleCard = (node: ReactTestRenderer.ReactTestInstance) =>
    (node.type as string) === 'View' &&
    node.props.accessible === true &&
    typeof node.props.accessibilityLabel === 'string';

  it('event card is an accessible element with a label', () => {
    const tree = render([makeEvent()]);
    const card = tree.root.find(isAccessibleCard);
    expect(card).toBeTruthy();
  });

  it('accessibilityLabel includes event name and location', () => {
    const tree = render([makeEvent({ name: 'Test Event', location: 'The Pyramid' })]);
    const card = tree.root.find(isAccessibleCard);
    expect(card.props.accessibilityLabel).toContain('Test Event');
    expect(card.props.accessibilityLabel).toContain('The Pyramid');
  });

  it('accessibilityLabel includes description when provided', () => {
    const tree = render([makeEvent({ description: 'Expect heavy traffic.' })]);
    const card = tree.root.find(isAccessibleCard);
    expect(card.props.accessibilityLabel).toContain('Expect heavy traffic.');
  });

  it('accessibilityLabel omits description when absent', () => {
    const tree = render([makeEvent({ description: undefined })]);
    const card = tree.root.find(isAccessibleCard);
    expect(card.props.accessibilityLabel).not.toContain('undefined');
    expect(card.props.accessibilityLabel).not.toMatch(/,\s*$/);
  });

  it('icon is hidden from the accessibility tree', () => {
    const tree = render([makeEvent()]);
    const hiddenIcon = tree.root.find(
      node => node.props.accessible === false && node.props.importantForAccessibility === 'no-hide-descendants',
    );
    expect(hiddenIcon).toBeTruthy();
  });

  it('multiple events each have their own accessible card', () => {
    const tree = render([
      makeEvent({ id: '1', name: 'Event A' }),
      makeEvent({ id: '2', name: 'Event B' }),
    ]);
    const cards = tree.root.findAll(isAccessibleCard);

    expect(cards.length).toBe(2);
    expect(cards[0].props.accessibilityLabel).toContain('Event A');
    expect(cards[1].props.accessibilityLabel).toContain('Event B');
  });
});
