'use client';

import React from 'react';
import { useModalStore } from '@/core/novel/useModalStore';

export const GlobalModalRenderer: React.FC = () => {
  const { isOpen, modal } = useModalStore();

  if (!isOpen || !modal) return null;

  const ModalComponent = modal.component;

  return (
    <ModalComponent {...(modal.props || {})} />
  );
};
