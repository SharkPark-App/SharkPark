/**
 * NetworkTest Component Tests
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { NetworkTest } from '../src/components/NetworkTest';

// Mock the API service
jest.mock('../src/services/api/base');

// Mock fetch for health check test
const mockFetch = jest.fn();
// @ts-expect-error - global fetch mock for testing
global.fetch = mockFetch;

describe('NetworkTest Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockClear();
  });

  it('should render correctly', () => {
    let testRenderer: ReactTestRenderer.ReactTestRenderer;
    
    ReactTestRenderer.act(() => {
      testRenderer = ReactTestRenderer.create(<NetworkTest />);
    });

    const root = testRenderer!.root;
    
    // Check if the main title is rendered
    expect(() => root.findByProps({ children: 'Network Connection Test' })).not.toThrow();
    
    // Check if buttons are rendered
    expect(() => root.findByProps({ children: 'Test Health Check' })).not.toThrow();
    expect(() => root.findByProps({ children: 'Test Lots API' })).not.toThrow();
  });

  it('should have proper initial state', () => {
    let testRenderer: ReactTestRenderer.ReactTestRenderer;
    
    ReactTestRenderer.act(() => {
      testRenderer = ReactTestRenderer.create(<NetworkTest />);
    });

    const root = testRenderer!.root;

    // Should show initial button text (not loading)
    expect(() => root.findByProps({ children: 'Test Health Check' })).not.toThrow();
    expect(() => root.findByProps({ children: 'Test Lots API' })).not.toThrow();
    
    // Should not show testing state initially
    expect(() => root.findByProps({ children: 'Testing...' })).toThrow();
  });

  it('should display API URL from config', () => {
    let testRenderer: ReactTestRenderer.ReactTestRenderer;
    
    ReactTestRenderer.act(() => {
      testRenderer = ReactTestRenderer.create(<NetworkTest />);
    });

    const tree = testRenderer!.toJSON();
    const treeString = JSON.stringify(tree);
    
    // Should contain API URL text somewhere in the component tree
    expect(treeString).toContain('API URL:');
  });
});
