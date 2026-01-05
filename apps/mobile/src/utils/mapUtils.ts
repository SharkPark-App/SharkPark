/**
 * Map utilities for scaling and transforming coordinates
 *
 * Used to scale positions from the original map image 
 * space to screen-relative coordinates.
 */
import { Dimensions } from 'react-native';
import { MAP } from '../constants/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// The screen display map size (square, based on screen width & multiplier)
const MAP_DISPLAY_SIZE = SCREEN_WIDTH * MAP.SCALE_MULTIPLIER;

/**
 * Scale a point from map image coordinates to display coordinates
 *
 * @param x - X coordinate in map image space
 * @param y - Y coordinate in map image space
 */
export const scalePosition = (x: number, y: number) => {
  return {
    x: (x / MAP.IMAGE_SIZE) * MAP_DISPLAY_SIZE,
    y: (y / MAP.IMAGE_SIZE) * MAP_DISPLAY_SIZE,
  };
};