/**
 * React Navigation deep-linking configuration
 *
 * Supported URL patterns
 * ──────────────────────
 * Custom scheme (always works, no domain verification needed):
 *   sharkpark://map                    → Map tab
 *   sharkpark://map/lot/G1             → Map tab (lot G1 highlighted via initial params)
 *   sharkpark://forecast/short/G1      → Short Term Forecast for lot G1
 *   sharkpark://forecast/long          → Long Term tab
 *   sharkpark://profile                → Profile tab
 *
 * Universal / App Links (requires Associated Domains / Digital Asset Links):
 *   https://sharkpark.csulb.edu/map
 *   https://sharkpark.csulb.edu/map/lot/:lotId
 *   https://sharkpark.csulb.edu/forecast/short/:lotId
 *   https://sharkpark.csulb.edu/forecast/long
 *   https://sharkpark.csulb.edu/profile
 *
 * Navigation structure (mirrors MainTabNavigator + MapStack):
 *
 *   RootTabs
 *     Long Term          →  /forecast/long
 *     Map                →  /map  (MapStack)
 *       MapMain          →    /map  |  /map/lot/:lotId
 *       Short Term Forecast → /forecast/short/:lotId
 *     Profile            →  /profile
 */

import type { LinkingOptions } from '@react-navigation/native';
import { Linking } from 'react-native';
import type { RootTabParamList } from '../types/navigation';

// The hostname used for Universal Links / App Links.
// Update this once the CSULB domain is provisioned.
const UNIVERSAL_LINK_HOST = 'sharkpark.csulb.edu';

export const linkingConfig: LinkingOptions<RootTabParamList> = {
  // Custom URL scheme + universal link prefixes
  prefixes: [
    'sharkpark://',
    `https://${UNIVERSAL_LINK_HOST}`,
    `http://${UNIVERSAL_LINK_HOST}`,
  ],

  // Let react-navigation subscribe to incoming URLs via the native Linking API
  getInitialURL: async () => {
    // Check if the app was opened via a URL (cold-start deep link)
    const url = await Linking.getInitialURL();
    return url ?? null;
  },

  subscribe: (listener) => {
    const subscription = Linking.addEventListener('url', ({ url }) => listener(url));
    return () => subscription.remove();
  },

  config: {
    screens: {
      // Long Term Forecast tab
      'Long Term': {
        path: 'forecast/long',
      },

      // Map tab — wraps MapStack
      Map: {
        path: 'map',
        screens: {
          // /map  or  /map/lot/:lotId
          MapMain: {
            path: 'lot/:lotId?',
            parse: {
              lotId: (id: string) => id,
            },
          },
          // /forecast/short/:lotId
          'Short Term Forecast': {
            path: '/forecast/short/:lotId',
            parse: {
              lotId: (id: string) => id,
            },
          },
        },
      },

      // Profile tab
      Profile: {
        path: 'profile',
      },
    },
  },
};
