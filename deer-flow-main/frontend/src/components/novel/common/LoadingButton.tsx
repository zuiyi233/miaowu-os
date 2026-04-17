'use client';

import { Loader2 } from 'lucide-react';
import React from 'react';

import { Button } from '@/components/ui/button';
import type { ButtonProps } from '@/components/ui/button';

interface LoadingButtonProps extends ButtonProps {
  isLoading?: boolean;
  loadingText?: string;
}

export const LoadingButton: React.FC<LoadingButtonProps> = ({
  isLoading,
  loadingText,
  children,
  disabled,
  ...props
}) => {
  const isDisabled = Boolean(disabled) || Boolean(isLoading);

  return (
    <Button disabled={isDisabled} {...props}>
      {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      {isLoading && loadingText ? loadingText : children}
    </Button>
  );
};
