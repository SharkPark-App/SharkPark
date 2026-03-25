import React from 'react';
import { TextInput as RNTextInput, TextInputProps, StyleSheet } from 'react-native';
import { TYPOGRAPHY } from '../constants/theme';

/**
 * Drop-in replacement for React Native's TextInput with Inter-Regular as the default font.
 * Any fontFamily passed via style will override the default.
 */
export const TextInput = React.forwardRef<RNTextInput, TextInputProps>(
  (props, ref) => {
    return <RNTextInput {...props} ref={ref} style={[styles.default, props.style]} />;
  },
);

const styles = StyleSheet.create({
  default: {
    fontFamily: TYPOGRAPHY.fontFamily.regular,
  },
});
