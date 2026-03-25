declare module 'react-native-bluetooth-status' {
  export type BluetoothState = boolean;
  
  interface BluetoothStatusModule {
    state(): Promise<boolean>;
    enable(): Promise<boolean>;
    disable(): Promise<boolean>;
  }
  
  declare const BluetoothStatus: BluetoothStatusModule;
  export default BluetoothStatus;
}
