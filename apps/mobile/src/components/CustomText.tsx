import React from 'react';
import { Text as RNText, TextProps, StyleSheet } from 'react-native';
import { TYPOGRAPHY } from '../constants/theme';

/**
 * Drop-in replacement for React Native's Text with Inter-Regular as the default font.
 * Any fontFamily passed via style will override the default.
 */
export function Text(props: TextProps) {
  return <RNText {...props} style={[styles.default, props.style]} />;
}

const styles = StyleSheet.create({
  default: {
    fontFamily: TYPOGRAPHY.fontFamily.regular,
  },
});
