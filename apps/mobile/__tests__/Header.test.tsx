import React from 'react';
import { View } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import Header from '../src/components/Header/Header';
import { collectTexts, hasText, createRenderer } from './testUtils';

// ────────────────────── Mocks ──────────────────────

jest.mock('react-native-vector-icons/Ionicons', () => 'Icon');

jest.mock('../src/components/CustomText', () => ({
  Text: 'Text',
}));

jest.mock('../src/context/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      primary: '#ffffff',
      black: '#ffffff',
      white: '#ffffff',
      textPrimary: '#ffffff',
      headerBackground: '#ffffff',
    },
    isDark: false,
  }),
}));

const render = createRenderer(Header);

// ────────────────────── Tests ──────────────────────

describe('Header -- title prop', () => {
  it('renders the title text when provided', () => {
    const tree = render({ title: "Today's Forecast" });
    expect(hasText(collectTexts(tree.root), "Today's Forecast")).toBe(true);
  });

  it('does not render placeholder text when title is provided', () => {
    const tree = render({ title: 'My Title' });
    expect(hasText(collectTexts(tree.root), 'SharkPark')).toBe(false);
  });
});

describe('Header -- brand logo', () => {
  it('renders the brand logo Image when no title is provided', () => {
    const tree = render({});
    const images = tree.root.findAllByType('Image' as unknown as React.ElementType);
    expect(images.length).toBeGreaterThan(0);
  });

  it('does not render the brand logo Image when a title is provided', () => {
    const tree = render({ title: 'Test' });
    const images = tree.root.findAllByType('Image' as unknown as React.ElementType);
    expect(images.length).toBe(0);
  });
});

describe('Header -- back button', () => {
  it('renders back button when onBack is provided', () => {
    const onBack = jest.fn();
    const tree = render({ title: 'Test', onBack });
    
    // also validates screen-reader labels
    const backButton = tree.root.find(
      node =>
        node.props.accessibilityRole === 'button' &&
        node.props.accessibilityLabel === 'Go back',
    );
    expect(backButton).toBeTruthy();
  });

  it('does not render back button when onBack is not provided', () => {
    const tree = render({ title: 'Test' });
    const backButtons = tree.root.findAll(
      node =>
        node.props.accessibilityRole === 'button' &&
        node.props.accessibilityLabel === 'Go back',
    );
    expect(backButtons.length).toBe(0);
  });

  it('calls onBack when back button is pressed', () => {
    const onBack = jest.fn();
    const tree = render({ title: 'Test', onBack });
    const backButton = tree.root.find(
      node =>
        node.props.accessibilityRole === 'button' &&
        node.props.accessibilityLabel === 'Go back',
    );
    
    ReactTestRenderer.act(() => {
      backButton.props.onPress();
    });
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe('Header -- rightAction prop', () => {
  it('renders rightAction when provided', () => {
    const tree = render({
      title: 'Test',
      onBack: jest.fn(),
      rightAction: <View testID="right-action" />,
    });
    expect(tree.root.findByProps({ testID: 'right-action' })).toBeTruthy();
  });
});
