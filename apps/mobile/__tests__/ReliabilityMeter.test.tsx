import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { ReliabilityMeter, ReliabilityDot, ReliabilityBar } from '../src/components/ReliabilityMeter';

describe('ReliabilityMeter', () => {
  describe('rendering', () => {
    it('renders HIGH confidence correctly', async () => {
      let tree: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        tree = ReactTestRenderer.create(<ReliabilityMeter confidence="HIGH" />);
      });
      expect(tree!.toJSON()).toBeTruthy();
    });

    it('renders MEDIUM confidence correctly', async () => {
      let tree: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        tree = ReactTestRenderer.create(<ReliabilityMeter confidence="MEDIUM" />);
      });
      expect(tree!.toJSON()).toBeTruthy();
    });

    it('renders LOW confidence correctly', async () => {
      let tree: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        tree = ReactTestRenderer.create(<ReliabilityMeter confidence="LOW" />);
      });
      expect(tree!.toJSON()).toBeTruthy();
    });
  });

  describe('props', () => {
    it('renders with score when showScore is true', async () => {
      let tree: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        tree = ReactTestRenderer.create(
          <ReliabilityMeter confidence="HIGH" score={85} showScore />
        );
      });
      expect(tree!.toJSON()).toBeTruthy();
    });

    it('renders with label when showLabel is true', async () => {
      let tree: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        tree = ReactTestRenderer.create(
          <ReliabilityMeter confidence="HIGH" showLabel />
        );
      });
      expect(tree!.toJSON()).toBeTruthy();
    });

    it('renders cold start badge when isColdStart is true', async () => {
      let tree: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        tree = ReactTestRenderer.create(
          <ReliabilityMeter confidence="LOW" isColdStart />
        );
      });
      expect(tree!.toJSON()).toBeTruthy();
    });

    it('renders with onPress callback', async () => {
      const onPress = jest.fn();
      let tree: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        tree = ReactTestRenderer.create(
          <ReliabilityMeter confidence="HIGH" onPress={onPress} />
        );
      });
      expect(tree!.toJSON()).toBeTruthy();
    });
  });

  describe('sizes', () => {
    it('renders small size', async () => {
      let tree: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        tree = ReactTestRenderer.create(
          <ReliabilityMeter confidence="HIGH" size="small" />
        );
      });
      expect(tree!.toJSON()).toBeTruthy();
    });

    it('renders large size', async () => {
      let tree: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        tree = ReactTestRenderer.create(
          <ReliabilityMeter confidence="HIGH" size="large" />
        );
      });
      expect(tree!.toJSON()).toBeTruthy();
    });
  });
});

describe('ReliabilityDot', () => {
  it('renders with default size', async () => {
    let tree: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(<ReliabilityDot confidence="HIGH" />);
    });
    expect(tree!.toJSON()).toBeTruthy();
  });

  it('renders with custom size', async () => {
    let tree: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(<ReliabilityDot confidence="MEDIUM" size={12} />);
    });
    expect(tree!.toJSON()).toBeTruthy();
  });

  it('renders all confidence levels', async () => {
    for (const confidence of ['HIGH', 'MEDIUM', 'LOW'] as const) {
      let tree: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        tree = ReactTestRenderer.create(<ReliabilityDot confidence={confidence} />);
      });
      expect(tree!.toJSON()).toBeTruthy();
    }
  });
});

describe('ReliabilityBar', () => {
  it('renders with score', async () => {
    let tree: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(
        <ReliabilityBar confidence="HIGH" score={85} />
      );
    });
    expect(tree!.toJSON()).toBeTruthy();
  });

  it('renders with low score', async () => {
    let tree: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(<ReliabilityBar confidence="LOW" score={25} />);
    });
    expect(tree!.toJSON()).toBeTruthy();
  });

  it('renders all confidence levels with scores', async () => {
    const testCases = [
      { confidence: 'HIGH' as const, score: 85 },
      { confidence: 'MEDIUM' as const, score: 55 },
      { confidence: 'LOW' as const, score: 25 },
    ];

    for (const { confidence, score } of testCases) {
      let tree: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        tree = ReactTestRenderer.create(
          <ReliabilityBar confidence={confidence} score={score} />
        );
      });
      expect(tree!.toJSON()).toBeTruthy();
    }
  });
});
