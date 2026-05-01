/**
 * Navigation Type Definitions
 * Provides type safety for React Navigation
 */

import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { StackScreenProps } from '@react-navigation/stack';
import type { CompositeScreenProps, NavigatorScreenParams } from '@react-navigation/native';

/**
 * Map Stack Parameter List (nested within Map tab)
 */
export type MapStackParamList = {
  MapMain: undefined;
  'Short Term Forecast': { lotId: string; lotName: string };
  LocationPermission: { reason?: string };
};

/**
 * Root Bottom Tab Navigator Parameter List
 *
 * The Map tab hosts a nested stack — typing it as `NavigatorScreenParams<...>`
 * lets call sites use `navigation.navigate('Map', { screen: 'LocationPermission', params: {} })`
 * with full type safety from anywhere in the tree.
 */
export type RootTabParamList = {
  'Long Term': undefined;
  Map: NavigatorScreenParams<MapStackParamList> | undefined;
  Profile: undefined;
};

/**
 * Type helper for tab screen props
 */
export type RootTabScreenProps<T extends keyof RootTabParamList> =
  BottomTabScreenProps<RootTabParamList, T>;

/**
 * Type helper for map stack screen props
 */
export type MapStackScreenProps<T extends keyof MapStackParamList> =
  StackScreenProps<MapStackParamList, T>;

/**
 * Type for screens that are both in tab and stack (like MapMain)
 */
export type MapTabScreenProps = CompositeScreenProps<
  StackScreenProps<MapStackParamList, 'MapMain'>,
  BottomTabScreenProps<RootTabParamList>
>;

/**
 * Type for Short Term Forecast screen (stack screen within Map tab)
 */
export type ShortTermForecastScreenProps = CompositeScreenProps<
  StackScreenProps<MapStackParamList, 'Short Term Forecast'>,
  BottomTabScreenProps<RootTabParamList>
>;
