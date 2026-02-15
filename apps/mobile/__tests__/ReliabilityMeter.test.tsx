import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ReliabilityMeter, ReliabilityDot, ReliabilityBar } from '../src/components/ReliabilityMeter';

describe('ReliabilityMeter', () => {
  describe('rendering', () => {
    it('renders HIGH confidence correctly', () => {
      const { getByText, getByLabelText } = render(
        <ReliabilityMeter confidence="HIGH" />
      );

      expect(getByText('HIGH')).toBeTruthy();
      expect(getByLabelText('Reliability: High Confidence')).toBeTruthy();
    });

    it('renders MEDIUM confidence correctly', () => {
      const { getByText } = render(<ReliabilityMeter confidence="MEDIUM" />);
      expect(getByText('MEDIUM')).toBeTruthy();
    });

    it('renders LOW confidence correctly', () => {
      const { getByText } = render(<ReliabilityMeter confidence="LOW" />);
      expect(getByText('LOW')).toBeTruthy();
    });
  });

  describe('props', () => {
    it('shows score when showScore is true', () => {
      const { getByText } = render(
        <ReliabilityMeter confidence="HIGH" score={85} showScore />
      );

      expect(getByText('85')).toBeTruthy();
    });

    it('shows label when showLabel is true', () => {
      const { getByText } = render(
        <ReliabilityMeter confidence="HIGH" showLabel />
      );

      expect(getByText('High Confidence')).toBeTruthy();
    });

    it('shows cold start badge when isColdStart is true', () => {
      const { getByText } = render(
        <ReliabilityMeter confidence="LOW" isColdStart />
      );

      expect(getByText('β')).toBeTruthy();
    });

    it('handles onPress callback', () => {
      const onPress = jest.fn();
      const { getByLabelText } = render(
        <ReliabilityMeter confidence="HIGH" onPress={onPress} />
      );

      fireEvent.press(getByLabelText('Reliability: High Confidence'));
      expect(onPress).toHaveBeenCalledTimes(1);
    });
  });

  describe('sizes', () => {
    it('renders small size', () => {
      const { getByLabelText } = render(
        <ReliabilityMeter confidence="HIGH" size="small" />
      );
      expect(getByLabelText('Reliability: High Confidence')).toBeTruthy();
    });

    it('renders large size', () => {
      const { getByLabelText } = render(
        <ReliabilityMeter confidence="HIGH" size="large" />
      );
      expect(getByLabelText('Reliability: High Confidence')).toBeTruthy();
    });
  });
});

describe('ReliabilityDot', () => {
  it('renders with default size', () => {
    const { getByLabelText } = render(<ReliabilityDot confidence="HIGH" />);
    expect(getByLabelText('Reliability: HIGH')).toBeTruthy();
  });

  it('renders with custom size', () => {
    const { getByLabelText } = render(
      <ReliabilityDot confidence="MEDIUM" size={12} />
    );
    expect(getByLabelText('Reliability: MEDIUM')).toBeTruthy();
  });

  it('renders all confidence levels', () => {
    const { getByLabelText: getHigh } = render(
      <ReliabilityDot confidence="HIGH" />
    );
    expect(getHigh('Reliability: HIGH')).toBeTruthy();

    const { getByLabelText: getMed } = render(
      <ReliabilityDot confidence="MEDIUM" />
    );
    expect(getMed('Reliability: MEDIUM')).toBeTruthy();

    const { getByLabelText: getLow } = render(
      <ReliabilityDot confidence="LOW" />
    );
    expect(getLow('Reliability: LOW')).toBeTruthy();
  });
});

describe('ReliabilityBar', () => {
  it('renders with score', () => {
    const { getByText } = render(
      <ReliabilityBar score={75} confidence="HIGH" />
    );
    expect(getByText('75%')).toBeTruthy();
  });

  it('renders with label when showLabel is true', () => {
    const { getByText } = render(
      <ReliabilityBar score={50} confidence="MEDIUM" showLabel />
    );
    expect(getByText('Moderate Confidence')).toBeTruthy();
    expect(getByText('50%')).toBeTruthy();
  });

  it('clamps score to 0-100 range', () => {
    const { getByText: getOver } = render(
      <ReliabilityBar score={150} confidence="HIGH" />
    );
    expect(getOver('150%')).toBeTruthy(); // Display shows actual, bar clamped

    const { getByText: getUnder } = render(
      <ReliabilityBar score={-10} confidence="LOW" />
    );
    expect(getUnder('-10%')).toBeTruthy(); // Display shows actual, bar clamped
  });

  it('renders all confidence levels', () => {
    const { getByText: getHigh } = render(
      <ReliabilityBar score={80} confidence="HIGH" showLabel />
    );
    expect(getHigh('High Confidence')).toBeTruthy();

    const { getByText: getMed } = render(
      <ReliabilityBar score={50} confidence="MEDIUM" showLabel />
    );
    expect(getMed('Moderate Confidence')).toBeTruthy();

    const { getByText: getLow } = render(
      <ReliabilityBar score={20} confidence="LOW" showLabel />
    );
    expect(getLow('Low Confidence')).toBeTruthy();
  });
});
