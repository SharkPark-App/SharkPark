import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { ReportModal } from '../src/components/Modals/ReportModal';
import { collectTexts, hasText } from './testUtils';

// ────────────────────── Mocks ──────────────────────

jest.mock('../src/context/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      primary: '#ffffff',
      white: '#ffffff',
      black: '#ffffff',
      gray: '#ffffff',
      mediumGray: '#ffffff',
      darkGray: '#ffffff',
      lightGray: '#ffffff',
      borderGray: '#ffffff',
      textPrimary: '#ffffff',
      error: '#ffffff',
      errorLight: '#ffffff',
      warningLight: '#ffffff',
      backgroundLight: '#ffffff',
    },
  }),
}));

jest.mock('../src/components/CustomText', () => ({
  Text: 'Text',
}));

jest.mock('../src/components/CustomTextInput', () => ({
  TextInput: 'TextInput',
}));

// ────────────────────── Helpers ──────────────────────

const defaultProps = {
  lotId: 'G6',
  isOpen: true,
  onClose: jest.fn(),
  onSubmit: jest.fn().mockResolvedValue(undefined),
};

function render(props = defaultProps) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<ReportModal {...props} />);
  });
  return tree;
}

// ────────────────────── Tests ──────────────────────

describe('ReportModal -- rendering', () => {
  it('renders without crashing when open', () => {
    const tree = render();
    expect(tree.toJSON()).toBeTruthy();
  });

  it('renders the modal title', () => {
    const tree = render();
    expect(hasText(collectTexts(tree.root), 'Report Incident')).toBe(true);
  });

  it('renders the lot ID in the subtitle', () => {
    const tree = render();
    expect(hasText(collectTexts(tree.root), 'G6')).toBe(true);
  });

  it('renders all three incident type options', () => {
    const tree = render();
    const texts = collectTexts(tree.root);
    expect(hasText(texts, 'Blockage')).toBe(true);
    expect(hasText(texts, 'Crash')).toBe(true);
    expect(hasText(texts, 'Other')).toBe(true);
  });
});

describe('ReportModal -- close button accessibility', () => {
  it('close button has accessibilityRole="button" and accessibilityLabel="Close"', () => {
    const tree = render();
    const closeBtn = tree.root.find(
      node =>
        node.props.accessibilityRole === 'button' &&
        node.props.accessibilityLabel === 'Close',
    );
    expect(closeBtn).toBeTruthy();
  });

  it('calls onClose when close button pressed', () => {
    const onClose = jest.fn();
    const tree = render({ ...defaultProps, onClose });
    const closeBtn = tree.root.find(
      node =>
        node.props.accessibilityRole === 'button' &&
        node.props.accessibilityLabel === 'Close',
    );
    ReactTestRenderer.act(() => {
      closeBtn.props.onPress();
    });
    expect(onClose).toHaveBeenCalled();
  });
});

describe('ReportModal -- incident type radio accessibility', () => {
  it('incident type buttons have accessibilityRole="radio"', () => {
    const tree = render();
    const radios = tree.root.findAll(
      node =>
        node.props.accessibilityRole === 'radio' &&
        typeof node.props.onPress === 'function' &&
        typeof node.props.accessibilityLabel === 'string',
    );
    // Unique radio buttons (possible duplicate due to prop inheritance)
    const uniqueLabels = new Set(radios.map(r => r.props.accessibilityLabel));
    expect(uniqueLabels.size).toBe(3);
  });

  it('all radios start unchecked', () => {
    const tree = render();
    const radios = tree.root.findAll(
      node =>
        node.props.accessibilityRole === 'radio' &&
        typeof node.props.onPress === 'function' &&
        typeof node.props.accessibilityLabel === 'string',
    );
    radios.forEach(radio => {
      expect(radio.props.accessibilityState).toMatchObject({ checked: false });
    });
  });

  it('radio labels include type name and description', () => {
    const tree = render();
    const blockageRadio = tree.root.find(
      node =>
        node.props.accessibilityRole === 'radio' &&
        node.props.accessibilityLabel?.includes('Blockage'),
    );
    expect(blockageRadio.props.accessibilityLabel).toContain(
      'Road or entrance blocked',
    );
  });

  it('selecting a type marks it as checked', () => {
    const tree = render();
    const blockageRadio = tree.root.find(
      node =>
        node.props.accessibilityRole === 'radio' &&
        node.props.accessibilityLabel?.includes('Blockage'),
    );
    ReactTestRenderer.act(() => {
      blockageRadio.props.onPress();
    });
    
    const blockageAfter = tree.root.find(
      node =>
        node.props.accessibilityRole === 'radio' &&
        node.props.accessibilityLabel?.includes('Blockage'),
    );
    expect(blockageAfter.props.accessibilityState).toMatchObject({
      checked: true,
    });
  });

  it('only one radio is checked at a time', () => {
    const tree = render();
    const radios = tree.root.findAll(
      node =>
        node.props.accessibilityRole === 'radio' &&
        typeof node.props.onPress === 'function' &&
        typeof node.props.accessibilityLabel === 'string',
    );
    ReactTestRenderer.act(() => {
      radios[0].props.onPress();
    });
    ReactTestRenderer.act(() => {
      radios[1].props.onPress();
    });

    const radiosAfter = tree.root.findAll(
      node =>
        node.props.accessibilityRole === 'radio' &&
        typeof node.props.onPress === 'function' &&
        typeof node.props.accessibilityLabel === 'string',
    );
    // Deduplicate by label and count checked ones
    const seen = new Set<string>();
    const uniqueChecked = radiosAfter.filter(r => {
      const label = r.props.accessibilityLabel;
      if (seen.has(label)) return false;
      seen.add(label);
      return r.props.accessibilityState?.checked;
    });
    expect(uniqueChecked.length).toBe(1);
  });
});

describe('ReportModal -- submit button accessibility', () => {
  it('submit button is disabled when no type selected', () => {
    const tree = render();
    const submitBtn = tree.root.find(
      node => node.props.accessibilityLabel === 'Submit report',
    );
    expect(submitBtn.props.accessibilityState).toMatchObject({
      disabled: true,
    });
  });

  it('submit button is enabled after selecting a non-other type', () => {
    const tree = render();
    const blockageRadio = tree.root.find(
      node =>
        node.props.accessibilityRole === 'radio' &&
        node.props.accessibilityLabel?.includes('Blockage'),
    );

    ReactTestRenderer.act(() => {
      blockageRadio.props.onPress();
    });
    const submitBtn = tree.root.find(
      node => node.props.accessibilityLabel === 'Submit report',
    );
    expect(submitBtn.props.accessibilityState).toMatchObject({
      disabled: false,
    });
  });

  it('shows additional details input when "Other" is selected', () => {
    const tree = render();
    const otherRadio = tree.root.find(
      node =>
        node.props.accessibilityRole === 'radio' &&
        node.props.accessibilityLabel?.includes('Other'),
    );
    ReactTestRenderer.act(() => {
      otherRadio.props.onPress();
    });
    const texts = collectTexts(tree.root);
    expect(hasText(texts, 'Additional Details')).toBe(true);
  });

  it('additional details input has accessibilityLabel and accessibilityHint', () => {
    const tree = render();
    const otherRadio = tree.root.find(
      node =>
        node.props.accessibilityRole === 'radio' &&
        node.props.accessibilityLabel?.includes('Other'),
    );
    ReactTestRenderer.act(() => {
      otherRadio.props.onPress();
    });
    const input = tree.root.find(
      node => node.props.accessibilityLabel === 'Additional details',
    );
    expect(input.props.accessibilityHint).toBe('Describe the incident');
  });
});

describe('ReportModal -- onSubmit wiring', () => {
  beforeEach(() => {
    defaultProps.onSubmit.mockResolvedValue(undefined);
    defaultProps.onClose.mockClear();
  });

  it('calls onSubmit with correct payload on blockage submit', async () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    const onClose = jest.fn();
    const tree = render({ ...defaultProps, onSubmit, onClose });

    const blockageRadio = tree.root.find(
      node =>
        node.props.accessibilityRole === 'radio' &&
        node.props.accessibilityLabel?.includes('Blockage'),
    );
    await ReactTestRenderer.act(async () => {
      blockageRadio.props.onPress();
    });

    const submitBtn = tree.root.find(
      node => node.props.accessibilityLabel === 'Submit report',
    );
    await ReactTestRenderer.act(async () => {
      submitBtn.props.onPress();
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const call = onSubmit.mock.calls[0][0];
    expect(call.type).toBe('blockage');
    expect(call.lotId).toBe('G6');
    expect(call.timestamp).toBeInstanceOf(Date);
  });

  it('closes the modal after a successful submit', async () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    const onClose = jest.fn();
    const tree = render({ ...defaultProps, onSubmit, onClose });

    const crashRadio = tree.root.find(
      node =>
        node.props.accessibilityRole === 'radio' &&
        node.props.accessibilityLabel?.includes('Crash'),
    );
    await ReactTestRenderer.act(async () => {
      crashRadio.props.onPress();
    });

    const submitBtn = tree.root.find(
      node => node.props.accessibilityLabel === 'Submit report',
    );
    await ReactTestRenderer.act(async () => {
      submitBtn.props.onPress();
    });

    expect(onClose).toHaveBeenCalled();
  });

  it('shows error banner when onSubmit rejects', async () => {
    const onSubmit = jest.fn().mockRejectedValue(new Error('Rate limit exceeded'));
    const tree = render({ ...defaultProps, onSubmit });

    const crashRadio = tree.root.find(
      node =>
        node.props.accessibilityRole === 'radio' &&
        node.props.accessibilityLabel?.includes('Crash'),
    );
    await ReactTestRenderer.act(async () => {
      crashRadio.props.onPress();
    });

    const submitBtn = tree.root.find(
      node => node.props.accessibilityLabel === 'Submit report',
    );
    await ReactTestRenderer.act(async () => {
      submitBtn.props.onPress();
    });

    const errorView = tree.root.find(
      node => node.props.accessibilityRole === 'alert',
    );
    expect(errorView).toBeTruthy();
    const texts = collectTexts(errorView);
    expect(hasText(texts, 'Rate limit exceeded')).toBe(true);
  });
});
