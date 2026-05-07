import React from 'react';
import { Svg, Path, Circle } from 'react-native-svg';

interface SegmentedCircleProps {
  colors: string[];
  size?: number;
  borderColor?: string;
  borderWidth?: number;
}

export const SegmentedCircle: React.FC<SegmentedCircleProps> = ({
  colors,
  size = 20,
  borderColor = '#ffffff',
  borderWidth = 2,
}) => {
  const r = (size - borderWidth) / 2;
  const cx = size / 2;
  const cy = size / 2;

  if (colors.length <= 1) {
    return (
      <Svg width={size} height={size}>
        <Circle cx={cx} cy={cy} r={r} fill={colors[0] ?? '#ffffff'} />
        <Circle cx={cx} cy={cy} r={r} fill="none" stroke={borderColor} strokeWidth={borderWidth} />
      </Svg>
    );
  }

  const slices = colors.map((color, i) => {
    const startAngle = (i / colors.length) * 2 * Math.PI - Math.PI / 2;
    const endAngle = ((i + 1) / colors.length) * 2 * Math.PI - Math.PI / 2;
    const x1 = cx + r * Math.cos(startAngle);
    const y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle);
    const y2 = cy + r * Math.sin(endAngle);
    const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
    const d = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
    return <Path key={i} d={d} fill={color} />;
  });

  return (
    <Svg width={size} height={size}>
      {slices}
      <Circle cx={cx} cy={cy} r={r} fill="none" stroke={borderColor} strokeWidth={borderWidth} />
    </Svg>
  );
};
