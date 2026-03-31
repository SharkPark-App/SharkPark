import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { EventBanner } from '../src/components/EventBanner';
import type { Event } from '../src/types/ui';

// ────────────────────── Helpers ──────────────────────

/** Collect all string leaves from the rendered tree */
function collectTexts(instance: ReactTestRenderer.ReactTestInstance): string[] {
  const texts: string[] = [];
  const walk = (node: ReactTestRenderer.ReactTestInstance) => {
    if (typeof node === 'string') return;
    if ((node.type as string) === 'Text') {
      // Collect string children
      const gather = (
        children: ReactTestRenderer.ReactTestInstance['children'],
      ) => {
        (children ?? []).forEach(child => {
          if (typeof child === 'string') texts.push(child);
          else gather(child.children);
        });
      };
      gather(node.children);
      return;
    }
    (node.children ?? []).forEach(child => {
      if (typeof child !== 'string') walk(child);
    });
  };
  walk(instance);
  return texts;
}

function hasText(texts: string[], substr: string): boolean {
  return texts.some(t => t.includes(substr));
}

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
