/**
 * Database Seeding Script
 * 
 * Populates DynamoDB Local with realistic test data for development:
 * - 25 parking lots with CSULB-accurate locations and capacities
 * - 5 user profiles with favorites
 * - 4 campus events with parking impacts
 * - Weather data
 * - 7 days of historical occupancy snapshots
 * 
 * Usage: pnpm db:seed
 */

/* eslint-disable no-undef */

import {
  DynamoDBClient,
  PutItemCommand,
  ScanCommand,
  BatchWriteItemCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';

const REGION = process.env.AWS_REGION || 'us-west-2';
const ENDPOINT = process.env.DYNAMO_ENDPOINT || 'http://localhost:8000';

const client = new DynamoDBClient({
  region: REGION,
  endpoint: ENDPOINT,
  credentials: {
    accessKeyId: 'local',
    secretAccessKey: 'local',
  },
});

const MAIN_TABLE = 'sharkpark-main';
const TIMESERIES_TABLE = 'sharkpark-timeseries';

function generateGeofence(centerLat: number, centerLng: number, radiusMeters: number = 50) {
  const latOffset = radiusMeters / 111000;
  const lngOffset = radiusMeters / (111000 * Math.cos(centerLat * Math.PI / 180));
  
  return {
    type: 'Polygon',
    coordinates: [
      { lat: centerLat + latOffset, lng: centerLng - lngOffset },
      { lat: centerLat + latOffset, lng: centerLng + lngOffset },
      { lat: centerLat - latOffset, lng: centerLng + lngOffset },
      { lat: centerLat - latOffset, lng: centerLng - lngOffset },
      { lat: centerLat + latOffset, lng: centerLng - lngOffset },
    ],
    radius_meters: radiusMeters,
  };
}

/**
 * CSULB Parking Lot Data
 * Data sourced from CSULB Parking Services and campus maps
 */
const allParkingLots = [
  // ===== STUDENT LOTS (G LOTS) =====
  {
    id: 'G1',
    name: 'Lot G1',
    displayName: 'Lot G1 - East Campus',
    lotNumber: 'G1',
    type: 'STUDENT',
    capacity: 180,
    currentOccupancy: 142,
    location: 'East Campus - Near Japanese Garden',
    building_proximity: ['ECS', 'Japanese Garden', 'East Walkway'],
    coordinates: { lat: 33.7838, lng: -118.1089 },
    geofence: generateGeofence(33.7838, -118.1089, 50),
    permitTypes: ['Gold', 'Green'],
    daily_permit_allowed: false,
    hours: {
      weekday: { open: '06:00', close: '22:00' },
      saturday: { open: '08:00', close: '18:00' },
      sunday: 'CLOSED',
    },
    ev_charging_stations: 2,
    motorcycle_spaces: 4,
    accessible_spaces: 5,
    lighting: true,
    security_cameras: true,
    emergency_phone: true,
    covered: false,
    paved: true,
    penetration_rate: 0.15,
    typical_turnover_minutes: 240,
    confidence: 'HIGH',
  },
  {
    id: 'G2',
    name: 'Lot G2',
    displayName: 'Lot G2 - Walter Pyramid',
    lotNumber: 'G2',
    type: 'STUDENT',
    capacity: 425,
    currentOccupancy: 312,
    location: 'East Campus - Walter Pyramid',
    building_proximity: ['Walter Pyramid', 'Athletics', 'Tennis Courts'],
    coordinates: { lat: 33.7825, lng: -118.1098 },
    geofence: generateGeofence(33.7825, -118.1098, 70),
    permitTypes: ['Gold', 'Green'],
    daily_permit_allowed: true,
    daily_rate: 8.00,
    hours: {
      weekday: { open: '06:00', close: '23:00' },
      saturday: { open: '06:00', close: '23:00' },
      sunday: { open: '08:00', close: '22:00' },
    },
    ev_charging_stations: 4,
    motorcycle_spaces: 8,
    accessible_spaces: 12,
    lighting: true,
    security_cameras: true,
    emergency_phone: true,
    covered: false,
    paved: true,
    penetration_rate: 0.18,
    typical_turnover_minutes: 180,
    confidence: 'HIGH',
  },
  {
    id: 'G3',
    name: 'Lot G3',
    displayName: 'Lot G3 - East Campus',
    lotNumber: 'G3',
    type: 'STUDENT',
    capacity: 320,
    currentOccupancy: 245,
    location: 'East Campus',
    building_proximity: ['East Campus Buildings'],
    coordinates: { lat: 33.7830, lng: -118.1075 },
    geofence: generateGeofence(33.7830, -118.1075, 60),
    permitTypes: ['Gold', 'Green'],
    daily_permit_allowed: false,
    hours: {
      weekday: { open: '06:00', close: '22:00' },
      saturday: { open: '08:00', close: '18:00' },
      sunday: 'CLOSED',
    },
    ev_charging_stations: 2,
    motorcycle_spaces: 6,
    accessible_spaces: 8,
    lighting: true,
    security_cameras: true,
    emergency_phone: false,
    covered: false,
    paved: true,
    penetration_rate: 0.12,
    typical_turnover_minutes: 300,
    confidence: 'MEDIUM',
  },
  {
    id: 'G4',
    name: 'G4 Parking Structure',
    displayName: 'G4 Structure - Central Campus',
    lotNumber: 'G4',
    type: 'STUDENT',
    capacity: 1250,
    currentOccupancy: 892,
    location: 'Central Campus - Multi-Level Structure',
    building_proximity: ['USU', 'Library', 'Admin Building'],
    coordinates: { lat: 33.7819, lng: -118.1134 },
    geofence: generateGeofence(33.7819, -118.1134, 80),
    permitTypes: ['Gold', 'Green', 'Daily'],
    daily_permit_allowed: true,
    daily_rate: 8.00,
    hours: {
      weekday: { open: '00:00', close: '23:59' },
      saturday: { open: '00:00', close: '23:59' },
      sunday: { open: '00:00', close: '23:59' },
    },
    ev_charging_stations: 12,
    motorcycle_spaces: 15,
    accessible_spaces: 25,
    lighting: true,
    security_cameras: true,
    emergency_phone: true,
    covered: true,
    paved: true,
    levels: 5,
    penetration_rate: 0.20,
    typical_turnover_minutes: 240,
    confidence: 'HIGH',
  },
  {
    id: 'G5',
    name: 'Lot G5',
    displayName: 'Lot G5 - West Campus',
    lotNumber: 'G5',
    type: 'STUDENT',
    capacity: 290,
    currentOccupancy: 198,
    location: 'West Campus',
    building_proximity: ['West Campus Buildings'],
    coordinates: { lat: 33.7805, lng: -118.1165 },
    geofence: generateGeofence(33.7805, -118.1165, 55),
    permitTypes: ['Gold', 'Green'],
    daily_permit_allowed: false,
    hours: {
      weekday: { open: '06:00', close: '22:00' },
      saturday: { open: '08:00', close: '18:00' },
      sunday: 'CLOSED',
    },
    ev_charging_stations: 3,
    motorcycle_spaces: 5,
    accessible_spaces: 7,
    lighting: true,
    security_cameras: true,
    emergency_phone: false,
    covered: false,
    paved: true,
    penetration_rate: 0.10,
    typical_turnover_minutes: 360,
    confidence: 'MEDIUM',
  },
  {
    id: 'G7',
    name: 'Lot G7',
    displayName: 'Lot G7 - Engineering',
    lotNumber: 'G7',
    type: 'STUDENT',
    capacity: 450,
    currentOccupancy: 367,
    location: 'East Campus - Engineering Complex',
    building_proximity: ['Engineering', 'Computer Science', 'CEAC'],
    coordinates: { lat: 33.7842, lng: -118.1115 },
    geofence: generateGeofence(33.7842, -118.1115, 65),
    permitTypes: ['Gold', 'Green'],
    daily_permit_allowed: false,
    hours: {
      weekday: { open: '06:00', close: '22:00' },
      saturday: { open: '08:00', close: '20:00' },
      sunday: { open: '10:00', close: '18:00' },
    },
    ev_charging_stations: 3,
    motorcycle_spaces: 7,
    accessible_spaces: 10,
    lighting: true,
    security_cameras: true,
    emergency_phone: true,
    covered: false,
    paved: true,
    penetration_rate: 0.16,
    typical_turnover_minutes: 300,
    confidence: 'HIGH',
  },
  {
    id: 'G8',
    name: 'Lot G8',
    displayName: 'Lot G8 - Student Health',
    lotNumber: 'G8',
    type: 'STUDENT',
    capacity: 380,
    currentOccupancy: 289,
    location: 'West Campus - Student Health Center',
    building_proximity: ['Student Health', 'Recreation Center'],
    coordinates: { lat: 33.7812, lng: -118.1145 },
    geofence: generateGeofence(33.7812, -118.1145, 60),
    permitTypes: ['Gold', 'Green'],
    daily_permit_allowed: false,
    hours: {
      weekday: { open: '06:00', close: '22:00' },
      saturday: { open: '08:00', close: '18:00' },
      sunday: 'CLOSED',
    },
    ev_charging_stations: 4,
    motorcycle_spaces: 6,
    accessible_spaces: 9,
    lighting: true,
    security_cameras: true,
    emergency_phone: true,
    covered: false,
    paved: true,
    penetration_rate: 0.14,
    typical_turnover_minutes: 240,
    confidence: 'MEDIUM',
  },
  {
    id: 'G9',
    name: 'Lot G9',
    displayName: 'Lot G9 - Library',
    lotNumber: 'G9',
    type: 'STUDENT',
    capacity: 520,
    currentOccupancy: 445,
    location: 'West Campus - University Library',
    building_proximity: ['Library', 'Academic Buildings'],
    coordinates: { lat: 33.7817, lng: -118.1152 },
    geofence: generateGeofence(33.7817, -118.1152, 70),
    permitTypes: ['Gold', 'Green'],
    daily_permit_allowed: true,
    daily_rate: 8.00,
    hours: {
      weekday: { open: '06:00', close: '23:00' },
      saturday: { open: '07:00', close: '23:00' },
      sunday: { open: '08:00', close: '22:00' },
    },
    ev_charging_stations: 5,
    motorcycle_spaces: 8,
    accessible_spaces: 12,
    lighting: true,
    security_cameras: true,
    emergency_phone: true,
    covered: false,
    paved: true,
    penetration_rate: 0.17,
    typical_turnover_minutes: 300,
    confidence: 'HIGH',
  },
  {
    id: 'G10',
    name: 'Lot G10',
    displayName: 'Lot G10 - Recreation Center',
    lotNumber: 'G10',
    type: 'STUDENT',
    capacity: 312,
    currentOccupancy: 201,
    location: 'West Campus - Recreation & Wellness Center',
    building_proximity: ['Recreation Center', 'Student Health'],
    coordinates: { lat: 33.7810, lng: -118.1138 },
    geofence: generateGeofence(33.7810, -118.1138, 55),
    permitTypes: ['Gold', 'Green'],
    daily_permit_allowed: false,
    hours: {
      weekday: { open: '06:00', close: '22:00' },
      saturday: { open: '08:00', close: '20:00' },
      sunday: { open: '10:00', close: '18:00' },
    },
    ev_charging_stations: 3,
    motorcycle_spaces: 5,
    accessible_spaces: 8,
    lighting: true,
    security_cameras: true,
    emergency_phone: false,
    covered: false,
    paved: true,
    penetration_rate: 0.11,
    typical_turnover_minutes: 180,
    confidence: 'MEDIUM',
  },
  {
    id: 'G11',
    name: 'Lot G11',
    displayName: 'Lot G11 - Business',
    lotNumber: 'G11',
    type: 'STUDENT',
    capacity: 245,
    currentOccupancy: 189,
    location: 'North Campus - College of Business',
    building_proximity: ['CBA', 'Business Buildings'],
    coordinates: { lat: 33.7835, lng: -118.1155 },
    geofence: generateGeofence(33.7835, -118.1155, 50),
    permitTypes: ['Gold', 'Green'],
    daily_permit_allowed: false,
    hours: {
      weekday: { open: '06:00', close: '22:00' },
      saturday: { open: '08:00', close: '18:00' },
      sunday: 'CLOSED',
    },
    ev_charging_stations: 2,
    motorcycle_spaces: 4,
    accessible_spaces: 6,
    lighting: true,
    security_cameras: true,
    emergency_phone: false,
    covered: false,
    paved: true,
    penetration_rate: 0.13,
    typical_turnover_minutes: 360,
    confidence: 'MEDIUM',
  },
  {
    id: 'G12',
    name: 'Lot G12',
    displayName: 'Lot G12 - Education',
    lotNumber: 'G12',
    type: 'STUDENT',
    capacity: 290,
    currentOccupancy: 223,
    location: 'North Campus - College of Education',
    building_proximity: ['Education Building', 'Faculty Offices'],
    coordinates: { lat: 33.7840, lng: -118.1148 },
    geofence: generateGeofence(33.7840, -118.1148, 55),
    permitTypes: ['Gold', 'Green'],
    daily_permit_allowed: false,
    hours: {
      weekday: { open: '06:00', close: '22:00' },
      saturday: { open: '08:00', close: '18:00' },
      sunday: 'CLOSED',
    },
    ev_charging_stations: 2,
    motorcycle_spaces: 5,
    accessible_spaces: 7,
    lighting: true,
    security_cameras: true,
    emergency_phone: false,
    covered: false,
    paved: true,
    penetration_rate: 0.09,
    typical_turnover_minutes: 300,
    confidence: 'LOW',
  },
  {
    id: 'G16',
    name: 'Lot G16',
    displayName: 'Lot G16 - Student Union',
    lotNumber: 'G16',
    type: 'STUDENT',
    capacity: 410,
    currentOccupancy: 356,
    location: 'South Campus - USU Area',
    building_proximity: ['USU', 'Student Organizations', 'Bookstore'],
    coordinates: { lat: 33.7815, lng: -118.1128 },
    geofence: generateGeofence(33.7815, -118.1128, 65),
    permitTypes: ['Gold', 'Green'],
    daily_permit_allowed: true,
    daily_rate: 8.00,
    hours: {
      weekday: { open: '06:00', close: '23:00' },
      saturday: { open: '08:00', close: '22:00' },
      sunday: { open: '10:00', close: '20:00' },
    },
    ev_charging_stations: 4,
    motorcycle_spaces: 7,
    accessible_spaces: 10,
    lighting: true,
    security_cameras: true,
    emergency_phone: true,
    covered: false,
    paved: true,
    penetration_rate: 0.19,
    typical_turnover_minutes: 240,
    confidence: 'HIGH',
  },
  {
    id: 'G17',
    name: 'Lot G17',
    displayName: 'Lot G17 - South Campus',
    lotNumber: 'G17',
    type: 'STUDENT',
    capacity: 195,
    currentOccupancy: 134,
    location: 'South Campus',
    building_proximity: ['South Campus Buildings'],
    coordinates: { lat: 33.7800, lng: -118.1120 },
    geofence: generateGeofence(33.7800, -118.1120, 45),
    permitTypes: ['Gold', 'Green'],
    daily_permit_allowed: false,
    hours: {
      weekday: { open: '06:00', close: '22:00' },
      saturday: { open: '08:00', close: '18:00' },
      sunday: 'CLOSED',
    },
    ev_charging_stations: 2,
    motorcycle_spaces: 3,
    accessible_spaces: 5,
    lighting: true,
    security_cameras: false,
    emergency_phone: false,
    covered: false,
    paved: true,
    penetration_rate: 0.08,
    typical_turnover_minutes: 300,
    confidence: 'LOW',
  },
  {
    id: 'G18',
    name: 'Lot G18',
    displayName: 'Lot G18 - West Campus',
    lotNumber: 'G18',
    type: 'STUDENT',
    capacity: 275,
    currentOccupancy: 212,
    location: 'West Campus',
    building_proximity: ['West Campus Buildings'],
    coordinates: { lat: 33.7808, lng: -118.1172 },
    geofence: generateGeofence(33.7808, -118.1172, 55),
    permitTypes: ['Gold', 'Green'],
    daily_permit_allowed: false,
    hours: {
      weekday: { open: '06:00', close: '22:00' },
      saturday: { open: '08:00', close: '18:00' },
      sunday: 'CLOSED',
    },
    ev_charging_stations: 2,
    motorcycle_spaces: 4,
    accessible_spaces: 6,
    lighting: true,
    security_cameras: true,
    emergency_phone: false,
    covered: false,
    paved: true,
    penetration_rate: 0.10,
    typical_turnover_minutes: 360,
    confidence: 'MEDIUM',
  },
  {
    id: 'G19',
    name: 'Lot G19',
    displayName: 'Lot G19 - North Campus',
    lotNumber: 'G19',
    type: 'STUDENT',
    capacity: 165,
    currentOccupancy: 98,
    location: 'North Campus',
    building_proximity: ['North Campus Buildings'],
    coordinates: { lat: 33.7845, lng: -118.1160 },
    geofence: generateGeofence(33.7845, -118.1160, 45),
    permitTypes: ['Gold', 'Green'],
    daily_permit_allowed: false,
    hours: {
      weekday: { open: '06:00', close: '22:00' },
      saturday: { open: '08:00', close: '18:00' },
      sunday: 'CLOSED',
    },
    ev_charging_stations: 1,
    motorcycle_spaces: 3,
    accessible_spaces: 4,
    lighting: true,
    security_cameras: false,
    emergency_phone: false,
    covered: false,
    paved: true,
    penetration_rate: 0.07,
    typical_turnover_minutes: 300,
    confidence: 'LOW',
  },
  {
    id: 'G20',
    name: 'Lot G20',
    displayName: 'Lot G20 - East Campus',
    lotNumber: 'G20',
    type: 'STUDENT',
    capacity: 230,
    currentOccupancy: 178,
    location: 'East Campus',
    building_proximity: ['East Campus Buildings'],
    coordinates: { lat: 33.7837, lng: -118.1082 },
    geofence: generateGeofence(33.7837, -118.1082, 50),
    permitTypes: ['Gold', 'Green'],
    daily_permit_allowed: false,
    hours: {
      weekday: { open: '06:00', close: '22:00' },
      saturday: { open: '08:00', close: '18:00' },
      sunday: 'CLOSED',
    },
    ev_charging_stations: 2,
    motorcycle_spaces: 4,
    accessible_spaces: 6,
    lighting: true,
    security_cameras: true,
    emergency_phone: false,
    covered: false,
    paved: true,
    penetration_rate: 0.11,
    typical_turnover_minutes: 300,
    confidence: 'MEDIUM',
  },

  // ===== EMPLOYEE LOTS (E LOTS) =====
  {
    id: 'E1',
    name: 'Lot E1',
    displayName: 'Lot E1 - Faculty East',
    lotNumber: 'E1',
    type: 'EMPLOYEE',
    capacity: 185,
    currentOccupancy: 142,
    location: 'East Campus - Faculty/Staff Parking',
    building_proximity: ['Faculty Offices', 'Academic Buildings'],
    coordinates: { lat: 33.7834, lng: -118.1098 },
    geofence: generateGeofence(33.7834, -118.1098, 45),
    permitTypes: ['Blue', 'Red'],
    daily_permit_allowed: false,
    hours: {
      weekday: { open: '06:00', close: '18:00' },
      saturday: 'PERMIT ONLY',
      sunday: 'CLOSED',
    },
    ev_charging_stations: 5,
    motorcycle_spaces: 3,
    accessible_spaces: 15,
    lighting: true,
    security_cameras: true,
    emergency_phone: false,
    covered: false,
    paved: true,
    penetration_rate: 0.08,
    typical_turnover_minutes: 480,
    confidence: 'LOW',
  },
  {
    id: 'E2',
    name: 'Lot E2',
    displayName: 'Lot E2 - Admin',
    lotNumber: 'E2',
    type: 'EMPLOYEE',
    capacity: 142,
    currentOccupancy: 128,
    location: 'Central Campus - Administration',
    building_proximity: ['Admin Building', 'President\'s Office'],
    coordinates: { lat: 33.7822, lng: -118.1140 },
    geofence: generateGeofence(33.7822, -118.1140, 40),
    permitTypes: ['Blue', 'Red'],
    daily_permit_allowed: false,
    hours: {
      weekday: { open: '06:00', close: '18:00' },
      saturday: 'CLOSED',
      sunday: 'CLOSED',
    },
    ev_charging_stations: 4,
    motorcycle_spaces: 2,
    accessible_spaces: 10,
    lighting: true,
    security_cameras: true,
    emergency_phone: true,
    covered: false,
    paved: true,
    penetration_rate: 0.05,
    typical_turnover_minutes: 480,
    confidence: 'LOW',
  },
  {
    id: 'E3',
    name: 'E3 Parking Structure',
    displayName: 'E3 Structure - Faculty',
    lotNumber: 'E3',
    type: 'EMPLOYEE',
    capacity: 980,
    currentOccupancy: 745,
    location: 'East Campus - Faculty Structure',
    building_proximity: ['Faculty Buildings', 'Offices'],
    coordinates: { lat: 33.7828, lng: -118.1105 },
    geofence: generateGeofence(33.7828, -118.1105, 75),
    permitTypes: ['Blue', 'Red', 'Daily'],
    daily_permit_allowed: true,
    daily_rate: 10.00,
    hours: {
      weekday: { open: '00:00', close: '23:59' },
      saturday: { open: '00:00', close: '23:59' },
      sunday: { open: '00:00', close: '23:59' },
    },
    ev_charging_stations: 20,
    motorcycle_spaces: 10,
    accessible_spaces: 30,
    lighting: true,
    security_cameras: true,
    emergency_phone: true,
    covered: true,
    paved: true,
    levels: 4,
    penetration_rate: 0.06,
    typical_turnover_minutes: 480,
    confidence: 'MEDIUM',
  },
  {
    id: 'E4',
    name: 'Lot E4',
    displayName: 'Lot E4 - North Faculty',
    lotNumber: 'E4',
    type: 'EMPLOYEE',
    capacity: 98,
    currentOccupancy: 87,
    location: 'North Campus - Faculty',
    building_proximity: ['Faculty Offices'],
    coordinates: { lat: 33.7843, lng: -118.1162 },
    geofence: generateGeofence(33.7843, -118.1162, 35),
    permitTypes: ['Blue', 'Red'],
    daily_permit_allowed: false,
    hours: {
      weekday: { open: '06:00', close: '18:00' },
      saturday: 'CLOSED',
      sunday: 'CLOSED',
    },
    ev_charging_stations: 2,
    motorcycle_spaces: 2,
    accessible_spaces: 8,
    lighting: true,
    security_cameras: false,
    emergency_phone: false,
    covered: false,
    paved: true,
    penetration_rate: 0.04,
    typical_turnover_minutes: 480,
    confidence: 'LOW',
  },
  {
    id: 'E5',
    name: 'Lot E5',
    displayName: 'Lot E5 - West Faculty',
    lotNumber: 'E5',
    type: 'EMPLOYEE',
    capacity: 125,
    currentOccupancy: 103,
    location: 'West Campus - Faculty',
    building_proximity: ['Faculty Offices'],
    coordinates: { lat: 33.7814, lng: -118.1158 },
    geofence: generateGeofence(33.7814, -118.1158, 40),
    permitTypes: ['Blue', 'Red'],
    daily_permit_allowed: false,
    hours: {
      weekday: { open: '06:00', close: '18:00' },
      saturday: 'CLOSED',
      sunday: 'CLOSED',
    },
    ev_charging_stations: 3,
    motorcycle_spaces: 2,
    accessible_spaces: 9,
    lighting: true,
    security_cameras: true,
    emergency_phone: false,
    covered: false,
    paved: true,
    penetration_rate: 0.05,
    typical_turnover_minutes: 480,
    confidence: 'LOW',
  },
  {
    id: 'E6',
    name: 'Lot E6',
    displayName: 'Lot E6 - South Faculty',
    lotNumber: 'E6',
    type: 'EMPLOYEE',
    capacity: 156,
    currentOccupancy: 134,
    location: 'South Campus - Faculty',
    building_proximity: ['Faculty Offices'],
    coordinates: { lat: 33.7802, lng: -118.1132 },
    geofence: generateGeofence(33.7802, -118.1132, 42),
    permitTypes: ['Blue', 'Red'],
    daily_permit_allowed: false,
    hours: {
      weekday: { open: '06:00', close: '18:00' },
      saturday: 'CLOSED',
      sunday: 'CLOSED',
    },
    ev_charging_stations: 4,
    motorcycle_spaces: 2,
    accessible_spaces: 10,
    lighting: true,
    security_cameras: true,
    emergency_phone: false,
    covered: false,
    paved: true,
    penetration_rate: 0.06,
    typical_turnover_minutes: 480,
    confidence: 'LOW',
  },
  {
    id: 'E7',
    name: 'Lot E7',
    displayName: 'Lot E7 - East Faculty',
    lotNumber: 'E7',
    type: 'EMPLOYEE',
    capacity: 87,
    currentOccupancy: 72,
    location: 'East Campus - Faculty',
    building_proximity: ['Faculty Offices'],
    coordinates: { lat: 33.7839, lng: -118.1092 },
    geofence: generateGeofence(33.7839, -118.1092, 35),
    permitTypes: ['Blue', 'Red'],
    daily_permit_allowed: false,
    hours: {
      weekday: { open: '06:00', close: '18:00' },
      saturday: 'CLOSED',
      sunday: 'CLOSED',
    },
    ev_charging_stations: 2,
    motorcycle_spaces: 1,
    accessible_spaces: 6,
    lighting: true,
    security_cameras: false,
    emergency_phone: false,
    covered: false,
    paved: true,
    penetration_rate: 0.03,
    typical_turnover_minutes: 480,
    confidence: 'LOW',
  },
  {
    id: 'E8',
    name: 'Lot E8',
    displayName: 'Lot E8 - Central Faculty',
    lotNumber: 'E8',
    type: 'EMPLOYEE',
    capacity: 114,
    currentOccupancy: 96,
    location: 'Central Campus - Faculty',
    building_proximity: ['Faculty Offices', 'Academic Buildings'],
    coordinates: { lat: 33.7824, lng: -118.1125 },
    geofence: generateGeofence(33.7824, -118.1125, 38),
    permitTypes: ['Blue', 'Red'],
    daily_permit_allowed: false,
    hours: {
      weekday: { open: '06:00', close: '18:00' },
      saturday: 'CLOSED',
      sunday: 'CLOSED',
    },
    ev_charging_stations: 3,
    motorcycle_spaces: 2,
    accessible_spaces: 8,
    lighting: true,
    security_cameras: true,
    emergency_phone: false,
    covered: false,
    paved: true,
    penetration_rate: 0.04,
    typical_turnover_minutes: 480,
    confidence: 'LOW',
  },
  {
    id: 'E9',
    name: 'Lot E9',
    displayName: 'Lot E9 - North Faculty',
    lotNumber: 'E9',
    type: 'EMPLOYEE',
    capacity: 76,
    currentOccupancy: 63,
    location: 'North Campus - Faculty',
    building_proximity: ['Faculty Offices'],
    coordinates: { lat: 33.7841, lng: -118.1153 },
    geofence: generateGeofence(33.7841, -118.1153, 32),
    permitTypes: ['Blue', 'Red'],
    daily_permit_allowed: false,
    hours: {
      weekday: { open: '06:00', close: '18:00' },
      saturday: 'CLOSED',
      sunday: 'CLOSED',
    },
    ev_charging_stations: 2,
    motorcycle_spaces: 1,
    accessible_spaces: 5,
    lighting: true,
    security_cameras: false,
    emergency_phone: false,
    covered: false,
    paved: true,
    penetration_rate: 0.03,
    typical_turnover_minutes: 480,
    confidence: 'LOW',
  },

  // ===== MISSING LOTS FROM MOBILE APP =====
  {
    id: 'G6',
    name: 'Lot G6',
    displayName: 'Lot G6 - Central Campus',
    lotNumber: 'G6',
    type: 'STUDENT',
    capacity: 275,
    currentOccupancy: 250,
    location: 'Central Campus',
    building_proximity: ['Central Campus Buildings'],
    coordinates: { lat: 33.7830, lng: -118.1120 },
    geofence: generateGeofence(33.7830, -118.1120, 55),
    permitTypes: ['Gold', 'Green'],
    daily_permit_allowed: false,
    hours: {
      weekday: { open: '06:00', close: '22:00' },
      saturday: { open: '08:00', close: '18:00' },
      sunday: 'CLOSED',
    },
    ev_charging_stations: 3,
    motorcycle_spaces: 5,
    accessible_spaces: 7,
    lighting: true,
    security_cameras: true,
    emergency_phone: false,
    covered: false,
    paved: true,
    penetration_rate: 0.12,
    typical_turnover_minutes: 300,
    confidence: 'MEDIUM',
  },
  {
    id: 'G13',
    name: 'Lot G13',
    displayName: 'Lot G13 - North Campus',
    lotNumber: 'G13',
    type: 'STUDENT',
    capacity: 195,
    currentOccupancy: 138,
    location: 'North Campus',
    building_proximity: ['North Campus Buildings'],
    coordinates: { lat: 33.7845, lng: -118.1160 },
    geofence: generateGeofence(33.7845, -118.1160, 50),
    permitTypes: ['Gold', 'Green'],
    daily_permit_allowed: false,
    hours: {
      weekday: { open: '06:00', close: '22:00' },
      saturday: { open: '08:00', close: '18:00' },
      sunday: 'CLOSED',
    },
    ev_charging_stations: 2,
    motorcycle_spaces: 3,
    accessible_spaces: 5,
    lighting: true,
    security_cameras: false,
    emergency_phone: false,
    covered: false,
    paved: true,
    penetration_rate: 0.09,
    typical_turnover_minutes: 360,
    confidence: 'LOW',
  },
  {
    id: 'G14',
    name: 'Lot G14',
    displayName: 'Lot G14 - North Campus',
    lotNumber: 'G14',
    type: 'STUDENT',
    capacity: 165,
    currentOccupancy: 96,
    location: 'North Campus',
    building_proximity: ['North Campus Buildings'],
    coordinates: { lat: 33.7848, lng: -118.1165 },
    geofence: generateGeofence(33.7848, -118.1165, 45),
    permitTypes: ['Gold', 'Green'],
    daily_permit_allowed: false,
    hours: {
      weekday: { open: '06:00', close: '22:00' },
      saturday: { open: '08:00', close: '18:00' },
      sunday: 'CLOSED',
    },
    ev_charging_stations: 1,
    motorcycle_spaces: 3,
    accessible_spaces: 4,
    lighting: true,
    security_cameras: false,
    emergency_phone: false,
    covered: false,
    paved: true,
    penetration_rate: 0.07,
    typical_turnover_minutes: 360,
    confidence: 'LOW',
  },
  {
    id: 'E10',
    name: 'Lot E10',
    displayName: 'Lot E10 - South Faculty',
    lotNumber: 'E10',
    type: 'EMPLOYEE',
    capacity: 95,
    currentOccupancy: 61,
    location: 'South Campus - Faculty',
    building_proximity: ['Faculty Offices'],
    coordinates: { lat: 33.7825, lng: -118.1135 },
    geofence: generateGeofence(33.7825, -118.1135, 35),
    permitTypes: ['Blue', 'Red'],
    daily_permit_allowed: false,
    hours: {
      weekday: { open: '06:00', close: '18:00' },
      saturday: 'CLOSED',
      sunday: 'CLOSED',
    },
    ev_charging_stations: 2,
    motorcycle_spaces: 1,
    accessible_spaces: 6,
    lighting: true,
    security_cameras: false,
    emergency_phone: false,
    covered: false,
    paved: true,
    penetration_rate: 0.04,
    typical_turnover_minutes: 480,
    confidence: 'LOW',
  },
  {
    id: 'E11',
    name: 'Lot E11',
    displayName: 'Lot E11 - Central Faculty',
    lotNumber: 'E11',
    type: 'EMPLOYEE',
    capacity: 120,
    currentOccupancy: 98,
    location: 'Central Campus - Faculty',
    building_proximity: ['Faculty Offices', 'Admin Building'],
    coordinates: { lat: 33.7835, lng: -118.1140 },
    geofence: generateGeofence(33.7835, -118.1140, 40),
    permitTypes: ['Blue', 'Red'],
    daily_permit_allowed: false,
    hours: {
      weekday: { open: '06:00', close: '18:00' },
      saturday: 'CLOSED',
      sunday: 'CLOSED',
    },
    ev_charging_stations: 3,
    motorcycle_spaces: 2,
    accessible_spaces: 8,
    lighting: true,
    security_cameras: true,
    emergency_phone: false,
    covered: false,
    paved: true,
    penetration_rate: 0.05,
    typical_turnover_minutes: 480,
    confidence: 'MEDIUM',
  },
  {
    id: 'PVN',
    name: 'Palo Verde North',
    displayName: 'Palo Verde North - North Campus',
    lotNumber: 'PVN',
    type: 'STUDENT',
    capacity: 180,
    currentOccupancy: 117,
    location: 'North Campus - Palo Verde Structure',
    building_proximity: ['Palo Verde North', 'Recreation Center'],
    coordinates: { lat: 33.7850, lng: -118.1170 },
    geofence: generateGeofence(33.7850, -118.1170, 50),
    permitTypes: ['Gold', 'Green', 'Resident'],
    daily_permit_allowed: false,
    hours: {
      weekday: { open: '00:00', close: '23:59' },
      saturday: { open: '00:00', close: '23:59' },
      sunday: { open: '00:00', close: '23:59' },
    },
    ev_charging_stations: 4,
    motorcycle_spaces: 3,
    accessible_spaces: 6,
    lighting: true,
    security_cameras: true,
    emergency_phone: true,
    covered: false,
    paved: true,
    penetration_rate: 0.10,
    typical_turnover_minutes: 720,
    confidence: 'MEDIUM',
  },
  {
    id: 'PVS',
    name: 'Palo Verde South',
    displayName: 'Palo Verde South - North Campus',
    lotNumber: 'PVS',
    type: 'STUDENT',
    capacity: 165,
    currentOccupancy: 107,
    location: 'South Campus - Palo Verde Structure',
    building_proximity: ['Palo Verde South', 'Recreation Center'],
    coordinates: { lat: 33.7820, lng: -118.1175 },
    geofence: generateGeofence(33.7820, -118.1175, 48),
    permitTypes: ['Gold', 'Green', 'Resident'],
    daily_permit_allowed: false,
    hours: {
      weekday: { open: '00:00', close: '23:59' },
      saturday: { open: '00:00', close: '23:59' },
      sunday: { open: '00:00', close: '23:59' },
    },
    ev_charging_stations: 3,
    motorcycle_spaces: 2,
    accessible_spaces: 5,
    lighting: true,
    security_cameras: true,
    emergency_phone: true,
    covered: false,
    paved: true,
    penetration_rate: 0.09,
    typical_turnover_minutes: 720,
    confidence: 'MEDIUM',
  },
  {
    id: 'PYR',
    name: 'Pyramid Lot',
    displayName: 'Pyramid Lot - Event Parking',
    lotNumber: 'PYR',
    type: 'STUDENT',
    capacity: 320,
    currentOccupancy: 253,
    location: 'East Campus - Near Walter Pyramid',
    building_proximity: ['Walter Pyramid', 'Athletics', 'Sports Facilities'],
    coordinates: { lat: 33.7825, lng: -118.1095 },
    geofence: generateGeofence(33.7825, -118.1095, 65),
    permitTypes: ['Gold', 'Green'],
    daily_permit_allowed: true,
    daily_rate: 10,
    hours: {
      weekday: { open: '06:00', close: '23:00' },
      saturday: { open: '06:00', close: '23:00' },
      sunday: { open: '10:00', close: '22:00' },
    },
    ev_charging_stations: 6,
    motorcycle_spaces: 6,
    accessible_spaces: 10,
    lighting: true,
    security_cameras: true,
    emergency_phone: true,
    covered: false,
    paved: true,
    penetration_rate: 0.16,
    typical_turnover_minutes: 180,
    confidence: 'HIGH',
  },
];

/**
 * Test Users (CSULB Students & Employees)
 * Both user types can view and use all parking lots (STUDENT and EMPLOYEE lots)
 */
const testUsers = [
  {
    email: 'charles.milton@csulb.edu',
    user_type: 'STUDENT',
    first_name: 'Charles',
    last_name: 'Milton',
    phone: '+15625551234',
    created_at: '2025-09-01T00:00:00.000Z',
    notification_preferences: {
      favorites_filling: true,
      favorites_clearing: true,
      surge_alerts: true,
      event_alerts: true,
    },
    favorites: ['G1', 'G7', 'G4'],
  },
  {
    email: 'lawrence.degoma@csulb.edu',
    user_type: 'STUDENT',
    first_name: 'Lawrence',
    last_name: 'Degoma',
    phone: '+15625551235',
    created_at: '2025-09-01T00:00:00.000Z',
    notification_preferences: {
      favorites_filling: true,
      favorites_clearing: false,
      surge_alerts: true,
      event_alerts: true,
    },
    favorites: ['G2', 'G9'],
  },
  {
    email: 'ly.nguyen@csulb.edu',
    user_type: 'EMPLOYEE',
    first_name: 'Ly',
    last_name: 'Nguyen',
    phone: '+15625551236',
    created_at: '2025-09-05T00:00:00.000Z',
    notification_preferences: {
      favorites_filling: true,
      favorites_clearing: true,
      surge_alerts: false,
      event_alerts: true,
    },
    favorites: ['E1', 'E3', 'G4'],
  },
  {
    email: 'zachary.padilla@csulb.edu',
    user_type: 'STUDENT',
    first_name: 'Zachary',
    last_name: 'Padilla',
    phone: '+15625551237',
    created_at: '2025-09-02T00:00:00.000Z',
    notification_preferences: {
      favorites_filling: true,
      favorites_clearing: true,
      surge_alerts: true,
      event_alerts: false,
    },
    favorites: ['G7', 'G8', 'E2'],
  },
  {
    email: 'charles.m2@csulb.edu',
    user_type: 'EMPLOYEE',
    first_name: 'Charles',
    last_name: 'Milton',
    phone: '+15625551238',
    created_at: '2025-09-10T00:00:00.000Z',
    notification_preferences: {
      favorites_filling: false,
      favorites_clearing: false,
      surge_alerts: true,
      event_alerts: true,
    },
    favorites: ['E3', 'E5', 'G16'],
  },
];

/**
 * Campus Events with Location-Based Lot Impacts
 */
const campusEvents = [
  {
    event_id: 'basketball-2025-12-15',
    event_name: "Men's Basketball vs UC Irvine",
    event_type: 'SPORTS',
    location_name: 'Walter Pyramid',
    start_time: '2025-12-15T19:00:00.000Z',
    end_time: '2025-12-15T21:30:00.000Z',
    expected_attendance: 4500,
    affected_lots: [
      { lot_id: 'G2', impact_level: 'HIGH', expected_fill_rate: 0.98, surge_start: '2025-12-15T17:30:00.000Z', surge_end: '2025-12-15T20:00:00.000Z' },
      { lot_id: 'G1', impact_level: 'MEDIUM', expected_fill_rate: 0.85, surge_start: '2025-12-15T17:45:00.000Z', surge_end: '2025-12-15T20:00:00.000Z' },
      { lot_id: 'G7', impact_level: 'LOW', expected_fill_rate: 0.70, surge_start: '2025-12-15T18:00:00.000Z', surge_end: '2025-12-15T20:00:00.000Z' },
      { lot_id: 'G4', impact_level: 'LOW', expected_fill_rate: 0.75, surge_start: '2025-12-15T18:00:00.000Z', surge_end: '2025-12-15T20:00:00.000Z' },
    ],
  },
  {
    event_id: 'graduation-2025-05-17',
    event_name: 'Spring Commencement 2025',
    event_type: 'GRADUATION',
    location_name: 'Walter Pyramid',
    start_time: '2025-05-17T09:00:00.000Z',
    end_time: '2025-05-17T18:00:00.000Z',
    expected_attendance: 12000,
    affected_lots: [
      { lot_id: 'G2', impact_level: 'EXTREME', expected_fill_rate: 1.0, surge_start: '2025-05-17T07:00:00.000Z', surge_end: '2025-05-17T10:00:00.000Z' },
      { lot_id: 'G1', impact_level: 'EXTREME', expected_fill_rate: 1.0, surge_start: '2025-05-17T07:00:00.000Z', surge_end: '2025-05-17T10:00:00.000Z' },
      { lot_id: 'G7', impact_level: 'HIGH', expected_fill_rate: 0.95, surge_start: '2025-05-17T07:30:00.000Z', surge_end: '2025-05-17T10:00:00.000Z' },
      { lot_id: 'G4', impact_level: 'HIGH', expected_fill_rate: 0.98, surge_start: '2025-05-17T07:30:00.000Z', surge_end: '2025-05-17T10:00:00.000Z' },
      { lot_id: 'G3', impact_level: 'HIGH', expected_fill_rate: 0.92, surge_start: '2025-05-17T07:45:00.000Z', surge_end: '2025-05-17T10:00:00.000Z' },
      { lot_id: 'G9', impact_level: 'MEDIUM', expected_fill_rate: 0.80, surge_start: '2025-05-17T08:00:00.000Z', surge_end: '2025-05-17T10:00:00.000Z' },
    ],
  },
  {
    event_id: 'concert-2025-12-20',
    event_name: 'Winter Concert Series',
    event_type: 'CONCERT',
    location_name: 'University Theatre',
    start_time: '2025-12-20T19:30:00.000Z',
    end_time: '2025-12-20T21:30:00.000Z',
    expected_attendance: 800,
    affected_lots: [
      { lot_id: 'G9', impact_level: 'MEDIUM', expected_fill_rate: 0.75, surge_start: '2025-12-20T18:30:00.000Z', surge_end: '2025-12-20T19:45:00.000Z' },
      { lot_id: 'G4', impact_level: 'LOW', expected_fill_rate: 0.60, surge_start: '2025-12-20T18:45:00.000Z', surge_end: '2025-12-20T19:45:00.000Z' },
    ],
  },
  {
    event_id: 'career-fair-2025-01-15',
    event_name: 'Spring Career Fair',
    event_type: 'ACADEMIC',
    location_name: 'USU Ballroom',
    start_time: '2025-01-15T10:00:00.000Z',
    end_time: '2025-01-15T16:00:00.000Z',
    expected_attendance: 2500,
    affected_lots: [
      { lot_id: 'G4', impact_level: 'HIGH', expected_fill_rate: 0.90, surge_start: '2025-01-15T09:00:00.000Z', surge_end: '2025-01-15T11:00:00.000Z' },
      { lot_id: 'G16', impact_level: 'HIGH', expected_fill_rate: 0.88, surge_start: '2025-01-15T09:15:00.000Z', surge_end: '2025-01-15T11:00:00.000Z' },
      { lot_id: 'G9', impact_level: 'MEDIUM', expected_fill_rate: 0.75, surge_start: '2025-01-15T09:30:00.000Z', surge_end: '2025-01-15T11:00:00.000Z' },
      { lot_id: 'G10', impact_level: 'MEDIUM', expected_fill_rate: 0.70, surge_start: '2025-01-15T09:30:00.000Z', surge_end: '2025-01-15T11:00:00.000Z' },
    ],
  },
];

/**
 * Mock Weather Data
 */
const mockWeather = {
  date: new Date().toISOString().split('T')[0], // Today's date dynamically
  condition: 'Partly Cloudy',
  temperature_f: 68,
  precipitation_probability: 0.10,
  wind_mph: 8,
  parking_impact_factor: 1.0,
  forecast_7day: [
    {
      date: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      condition: 'Sunny',
      temp_high_f: 72,
      precipitation_probability: 0.05,
      parking_impact_factor: 0.95,
    },
    {
      date: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      condition: 'Rainy',
      temp_high_f: 62,
      precipitation_probability: 0.80,
      parking_impact_factor: 1.25,
    },
    {
      date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      condition: 'Cloudy',
      temp_high_f: 65,
      precipitation_probability: 0.30,
      parking_impact_factor: 1.05,
    },
    {
      date: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      condition: 'Sunny',
      temp_high_f: 70,
      precipitation_probability: 0.10,
      parking_impact_factor: 0.95,
    },
    {
      date: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      condition: 'Partly Cloudy',
      temp_high_f: 68,
      precipitation_probability: 0.15,
      parking_impact_factor: 1.0,
    },
    {
      date: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      condition: 'Sunny',
      temp_high_f: 74,
      precipitation_probability: 0.05,
      parking_impact_factor: 0.90,
    },
    {
      date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      condition: 'Hot',
      temp_high_f: 88,
      precipitation_probability: 0.00,
      parking_impact_factor: 1.10,
    },
  ],
  api_source: 'mock-dev-data',
};

/**
 * Seed Functions
 */

async function clearExistingData() {
  console.log('[seed] Clearing existing data...');
  
  try {
    const scanResult = await client.send(
      new ScanCommand({
        TableName: MAIN_TABLE,
      })
    );

    if (scanResult.Items && scanResult.Items.length > 0) {
      console.log(`[seed] Found ${scanResult.Items.length} items to delete`);
      
      const deleteRequests = scanResult.Items.map(item => ({
        DeleteRequest: {
          Key: {
            PK: item.PK,
            SK: item.SK,
          },
        },
      }));

      // Batch delete in chunks of 25 (DynamoDB limit)
      for (let i = 0; i < deleteRequests.length; i += 25) {
        const chunk = deleteRequests.slice(i, i + 25);
        await client.send(
          new BatchWriteItemCommand({
            RequestItems: {
              [MAIN_TABLE]: chunk,
            },
          })
        );
        console.log(`[seed] Deleted ${Math.min(i + 25, deleteRequests.length)}/${deleteRequests.length} items`);
      }
    }
    
    console.log('[seed] Existing data cleared\n');
  } catch (error) {
    console.error('[seed] Error clearing data:', error);
    throw error;
  }
}

async function seedParkingLots() {
  console.log('[seed] Seeding parking lots...');
  
  const timestamp = new Date().toISOString();
  
  for (const lot of allParkingLots) {
    const item = marshall({
      PK: `LOT#${lot.id}`,
      SK: 'METADATA',
      EntityType: 'ParkingLot',
      lot_id: lot.id,
      lot_name: lot.name,
      display_name: lot.displayName,
      lot_number: lot.lotNumber,
      lot_type: lot.type,
      capacity: lot.capacity,
      current_occupancy: lot.currentOccupancy,
      location_description: lot.location,
      building_proximity: lot.building_proximity,
      center_lat: lot.coordinates.lat,
      center_lng: lot.coordinates.lng,
      geofence_polygon: lot.geofence.coordinates,
      geofence_radius: lot.geofence.radius_meters,
      permit_types: lot.permitTypes,
      daily_permit_allowed: lot.daily_permit_allowed,
      ...(lot.daily_rate && { daily_rate: lot.daily_rate }),
      hours_weekday: lot.hours.weekday,
      hours_saturday: lot.hours.saturday,
      hours_sunday: lot.hours.sunday,
      ev_charging_stations: lot.ev_charging_stations,
      motorcycle_spaces: lot.motorcycle_spaces,
      accessible_spaces: lot.accessible_spaces,
      has_lighting: lot.lighting,
      has_cameras: lot.security_cameras,
      has_emergency_phone: lot.emergency_phone,
      is_covered: lot.covered,
      is_paved: lot.paved,
      ...(lot.levels && { levels: lot.levels }),
      penetration_rate: lot.penetration_rate,
      avg_turnover_minutes: lot.typical_turnover_minutes,
      confidence: lot.confidence,
      timestamp,
    }, { removeUndefinedValues: true });

    await client.send(
      new PutItemCommand({
        TableName: MAIN_TABLE,
        Item: item,
      })
    );
  }
  
  console.log(`[seed] Seeded ${allParkingLots.length} parking lots\n`);
}

async function seedUsers() {
  console.log('[seed] Seeding users...');
  
  const timestamp = new Date().toISOString();
  const lastLogin = new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000).toISOString();
  
  for (const user of testUsers) {
    // Create user profile
    const userItem = marshall({
      PK: `USER#${user.email}`,
      SK: 'PROFILE',
      EntityType: 'User',
      user_id: user.email,
      email: user.email,
      user_type: user.user_type,
      first_name: user.first_name,
      last_name: user.last_name,
      ...(user.phone && { phone: user.phone }),
      created_at: user.created_at,
      last_login: lastLogin,
      notification_preferences: user.notification_preferences,
      timestamp,
    }, { removeUndefinedValues: true });

    await client.send(
      new PutItemCommand({
        TableName: MAIN_TABLE,
        Item: userItem,
      })
    );

    // Create user favorites
    for (const lotId of user.favorites) {
      const favoriteItem = marshall({
        PK: `USER#${user.email}`,
        SK: `FAV#${lotId}`,
        EntityType: 'UserFavorite',
        user_id: user.email,
        lot_id: lotId,
        added_at: new Date(Date.parse(user.created_at) + Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(),
        timestamp,
      });

      await client.send(
        new PutItemCommand({
          TableName: MAIN_TABLE,
          Item: favoriteItem,
        })
      );
    }
  }
  
  const totalFavorites = testUsers.reduce((sum, u) => sum + u.favorites.length, 0);
  console.log(`[seed] Seeded ${testUsers.length} users with ${totalFavorites} favorites\n`);
}

async function seedEvents() {
  console.log('[seed] Seeding campus events...');
  
  const timestamp = new Date().toISOString();
  
  for (const event of campusEvents) {
    // Create event metadata
    const eventItem = marshall({
      PK: `EVENT#${event.event_id}`,
      SK: 'METADATA',
      EntityType: 'CampusEvent',
      event_id: event.event_id,
      event_name: event.event_name,
      event_type: event.event_type,
      location_name: event.location_name,
      start_time: event.start_time,
      end_time: event.end_time,
      expected_attendance: event.expected_attendance,
      affected_lots: event.affected_lots.map(l => l.lot_id),
      timestamp,
    });

    await client.send(
      new PutItemCommand({
        TableName: MAIN_TABLE,
        Item: eventItem,
      })
    );

    // Create event impacts for each affected lot
    for (const impact of event.affected_lots) {
      const impactItem = marshall({
        PK: `EVENT#${event.event_id}`,
        SK: `IMPACT#${impact.lot_id}`,
        EntityType: 'EventImpact',
        event_id: event.event_id,
        lot_id: impact.lot_id,
        impact_level: impact.impact_level,
        expected_fill_rate: impact.expected_fill_rate,
        surge_start: impact.surge_start,
        surge_end: impact.surge_end,
        timestamp,
      });

      await client.send(
        new PutItemCommand({
          TableName: MAIN_TABLE,
          Item: impactItem,
        })
      );
    }
  }
  
  const totalImpacts = campusEvents.reduce((sum, e) => sum + e.affected_lots.length, 0);
  console.log(`[seed] Seeded ${campusEvents.length} events with ${totalImpacts} lot impacts\n`);
}

async function seedWeather() {
  console.log('[seed] Seeding weather data...');
  
  const timestamp = new Date().toISOString();
  
  const weatherItem = marshall({
    PK: `WEATHER#${mockWeather.date}`,
    SK: 'CURRENT',
    EntityType: 'Weather',
    date: mockWeather.date,
    condition: mockWeather.condition,
    temperature_f: mockWeather.temperature_f,
    precipitation_probability: mockWeather.precipitation_probability,
    wind_mph: mockWeather.wind_mph,
    parking_impact_factor: mockWeather.parking_impact_factor,
    forecast_7day: mockWeather.forecast_7day,
    api_source: mockWeather.api_source,
    timestamp,
  });

  await client.send(
    new PutItemCommand({
      TableName: MAIN_TABLE,
      Item: weatherItem,
    })
  );
  
  console.log('[seed] Seeded weather data\n');
}

async function seedHistoricalOccupancy() {
  console.log('[seed] Seeding historical occupancy snapshots...');
  
  const now = new Date();
  
  // Generate snapshots for last 7 days, every 15 minutes during operating hours
  const sampleLots = ['G1', 'G2', 'G4', 'G7', 'G9'];
  let snapshotCount = 0;
  
  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const date = new Date(now.getTime() - dayOffset * 24 * 60 * 60 * 1000);
    const dateString = date.toISOString().split('T')[0];
    
    // Generate snapshots from 6am to 10pm (16 hours)
    for (let hour = 6; hour < 22; hour++) {
      for (let minute = 0; minute < 60; minute += 15) {
        const timestamp = new Date(date);
        timestamp.setHours(hour, minute, 0, 0);
        const timestampISO = timestamp.toISOString();
        
        // Calculate TTL (90 days from now)
        const ttl = Math.floor((Date.now() + 90 * 24 * 60 * 60 * 1000) / 1000);
        
        for (const lotId of sampleLots) {
          const lot = allParkingLots.find(l => l.id === lotId);
          if (!lot) continue;
          
          // Simulate occupancy patterns (higher during peak hours)
          const isPeakHour = (hour >= 8 && hour <= 10) || (hour >= 12 && hour <= 14);
          const baseOccupancy = isPeakHour ? 0.85 : 0.60;
          const variance = Math.random() * 0.15;
          const occupancyRate = Math.min(0.98, Math.max(0.30, baseOccupancy + variance));
          const occupancy = Math.floor(lot.capacity * occupancyRate);
          const available = lot.capacity - occupancy;
          
          const snapshotItem = marshall({
            PK: `LOT#${lotId}#${dateString}`,
            SK: timestampISO,
            lot_id: lotId,
            occupancy,
            available,
            occupancy_rate: occupancyRate,
            confidence: lot.confidence,
            ttl,
            timestamp: timestampISO,
          });

          await client.send(
            new PutItemCommand({
              TableName: TIMESERIES_TABLE,
              Item: snapshotItem,
            })
          );
          
          snapshotCount++;
        }
      }
    }
  }
  
  console.log(`[seed] Seeded ${snapshotCount} historical occupancy snapshots\n`);
}

async function verifySeededData() {
  console.log('[seed] Verifying seeded data...');
  
  const mainScan = await client.send(
    new ScanCommand({
      TableName: MAIN_TABLE,
    })
  );
  
  const timeseriesScan = await client.send(
    new ScanCommand({
      TableName: TIMESERIES_TABLE,
    })
  );
  
  console.log(`\n[seed] Database Summary:`);
  console.log(`[seed]   ${MAIN_TABLE}: ${mainScan.Items?.length || 0} items`);
  console.log(`[seed]   ${TIMESERIES_TABLE}: ${timeseriesScan.Items?.length || 0} items`);
  
  // Count by entity type
  const entityCounts: Record<string, number> = {};
  mainScan.Items?.forEach(item => {
    const entityType = item.EntityType?.S || 'Unknown';
    entityCounts[entityType] = (entityCounts[entityType] || 0) + 1;
  });
  
  console.log(`\n[seed]   Entity Breakdown:`);
  Object.entries(entityCounts).forEach(([type, count]) => {
    console.log(`[seed]   - ${type}: ${count}`);
  });
  
  console.log('\n[seed] Verification complete!\n');
}

async function main() {
  console.log('[seed] SharkPark Local Database Seeding\n');
  console.log('[seed] Target: DynamoDB Local (http://localhost:8000)\n');
  console.log('[seed] WARNING: This seeds your LOCAL database for development/testing.');
  console.log('[seed] WARNING: In production, DynamoDB is on AWS with real sensor data.\n');
  
  try {
    await clearExistingData();
    await seedParkingLots();
    await seedUsers();
    await seedEvents();
    await seedWeather();
    await seedHistoricalOccupancy();
    await verifySeededData();
    
    console.log('[seed] Local database seeding complete!');
    console.log('\n[seed] Next steps:');
    console.log('[seed]   1. Build NestJS API endpoints (apps/backend/src)');
    console.log('[seed]   2. Start backend: cd apps/backend && pnpm dev');
    console.log('[seed]   3. Test API: curl http://localhost:3000/api/v1/lots');
    console.log('[seed]   4. Connect mobile app to backend APIs\n');
    
  } catch (error) {
    console.error('[seed] Error seeding database:', error);
    process.exit(1);
  }
}

main();
