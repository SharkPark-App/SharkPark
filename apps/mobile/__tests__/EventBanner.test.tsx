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

jest.mock('react-native/Libraries/Linking/Linking', () => ({
  openURL: jest.fn(),
}));

// ────────────────────── Fixtures ──────────────────────

const makeEvent = (overrides: Partial<Event> = {}): Event => ({
  id: '1',
  name: 'Beach Volleyball Tournament',
  date: new Date(2026, 2, 29, 14, 0, 0),
  location: 'Walter Pyramid',
  description: null,
  url: 'https://csulb.campuslabs.com/engage/event/abc123',
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

  it('omits the description when null', () => {
    const tree = render([makeEvent({ description: null })]);
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

  it('shows a chevron when the event has a url', () => {
    const tree = render([makeEvent({ url: 'https://example.com' })]);
    const chevrons = tree.root.findAll(
      n => n.props.name === 'chevron-forward',
    );
    expect(chevrons.length).toBeGreaterThan(0);
  });

  it('hides the chevron when url is null', () => {
    const tree = render([makeEvent({ url: null })]);
    const chevrons = tree.root.findAll(
      n => n.props.name === 'chevron-forward',
    );
    expect(chevrons.length).toBe(0);
  });
});

describe('EventBanner -- accessibility', () => {
  const isAccessibleCard = (node: ReactTestRenderer.ReactTestInstance) =>
    node.props.testID === 'event-card';

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

  it('accessibilityLabel omits description when null', () => {
    const tree = render([makeEvent({ description: null })]);
    const card = tree.root.find(isAccessibleCard);
    expect(card.props.accessibilityLabel).not.toContain('null');
    expect(card.props.accessibilityLabel).not.toMatch(/,\s*$/);
  });

  it('icon is hidden from the accessibility tree', () => {
    const tree = render([makeEvent()]);
    const hiddenNodes = tree.root.findAll(
      node => node.props.accessible === false && node.props.importantForAccessibility === 'no-hide-descendants',
    );
    expect(hiddenNodes.length).toBeGreaterThan(0);
  });

  it('card has accessibilityRole of link when url is present', () => {
    const tree = render([makeEvent({ url: 'https://example.com' })]);
    const card = tree.root.find(isAccessibleCard);
    expect(card.props.accessibilityRole).toBe('link');
  });

  it('multiple events each have their own accessible label', () => {
    const tree = render([
      makeEvent({ id: '1', name: 'Event A' }),
      makeEvent({ id: '2', name: 'Event B' }),
    ]);
    const withA = tree.root.findAll(n => n.props.accessibilityLabel?.includes('Event A'));
    const withB = tree.root.findAll(n => n.props.accessibilityLabel?.includes('Event B'));

    expect(withA.length).toBeGreaterThan(0);
    expect(withB.length).toBeGreaterThan(0);
    // Labels must not bleed across cards
    expect(withA[0].props.accessibilityLabel).not.toContain('Event B');
    expect(withB[0].props.accessibilityLabel).not.toContain('Event A');
  });
});
