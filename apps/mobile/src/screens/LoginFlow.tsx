import React, { useState } from 'react';
import { LoginScreen } from './LoginScreen';

type LoginStep = 'verification';

interface LoginFlowProps {
  onLoginSuccess: () => void;
}

export function LoginFlow({ onLoginSuccess }: LoginFlowProps) {
    // Flow not yet deprecated; it may be useful for implementing user logout
  const [currentStep/*, setCurrentStep*/] = useState<LoginStep>('verification');

  const handleAuthenticationSuccess = () => {
    onLoginSuccess();
  };

  if (currentStep === 'verification') {
    return (
      <LoginScreen
        onAuthenticationSuccess={handleAuthenticationSuccess}
      />
    );
  }
}
