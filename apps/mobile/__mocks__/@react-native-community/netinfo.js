const state = {
  isConnected: true,
  isInternetReachable: true,
  type: 'wifi',
  details: null,
};

const RNCNetInfo = {
  fetch: jest.fn().mockResolvedValue(state),
  refresh: jest.fn().mockResolvedValue(state),
  addEventListener: jest.fn(() => jest.fn()),
  useNetInfo: jest.fn(() => state),
};

export default RNCNetInfo;
