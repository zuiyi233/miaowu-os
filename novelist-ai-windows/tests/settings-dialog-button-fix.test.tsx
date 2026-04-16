import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SettingsDialog } from '../components/SettingsDialog';
import { useSettingsStore } from '../stores/useSettingsStore';

// Mock the settings store
vi.mock('../stores/useSettingsStore');

describe('SettingsDialog Button Fix', () => {
  const mockOnClose = vi.fn();
  const mockSetSettings = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock the settings store to return default values
    (useSettingsStore as any).mockImplementation((selector) => {
      const state = {
        autoSaveEnabled: true,
        autoSaveDelay: 300000, // 5 minutes in ms
        autoSnapshotEnabled: true,
        editorFont: 'Lora',
        editorFontSize: 16,
        modelSettings: {
          outline: { model: 'gemini-2.5-flash', temperature: 0.7, maxTokens: 4096 },
          continue: { model: 'gemini-2.5-flash', temperature: 0.7, maxTokens: 4096 },
          polish: { model: 'deepseek-chat', temperature: 0.5, maxTokens: 2048 },
          expand: { model: 'deepseek-chat', temperature: 0.7, maxTokens: 4096 },
          embedding: { model: 'text-embedding-3-small' }
        },
        setSettings: mockSetSettings,
        resetSettings: vi.fn(),
        apiConfigs: [],
        activeApiConfigId: null,
      };
      
      if (typeof selector === 'function') {
        return selector(state);
      }
      return state;
    });
  });

  it('should not trigger form submission when clicking non-submit buttons', () => {
    render(<SettingsDialog onClose={mockOnClose} />);
    
    // Switch to AI & API tab
    const aiTab = screen.getByText('AI & API');
    fireEvent.click(aiTab);
    
    // Find the "添加" button in ApiConfigManager
    const addButton = screen.getByText('添加');
    expect(addButton).toBeInTheDocument();
    
    // Verify the button has type="button"
    expect(addButton).toHaveAttribute('type', 'button');
    
    // Click the button - it should not trigger form submission
    fireEvent.click(addButton);
    
    // The form should not be submitted (setSettings should not be called)
    expect(mockSetSettings).not.toHaveBeenCalled();
    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it('should not trigger form submission when clicking accordion triggers', () => {
    render(<SettingsDialog onClose={mockOnClose} />);
    
    // Switch to AI & API tab
    const aiTab = screen.getByText('AI & API');
    fireEvent.click(aiTab);
    
    // Find an accordion trigger
    const accordionTrigger = screen.getByText('大纲生成');
    expect(accordionTrigger).toBeInTheDocument();
    
    // Verify the accordion trigger has type="button"
    expect(accordionTrigger.closest('button')).toHaveAttribute('type', 'button');
    
    // Click the accordion trigger - it should not trigger form submission
    fireEvent.click(accordionTrigger);
    
    // The form should not be submitted (setSettings should not be called)
    expect(mockSetSettings).not.toHaveBeenCalled();
    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it('should only trigger form submission when clicking the submit button', () => {
    render(<SettingsDialog onClose={mockOnClose} />);
    
    // Find the submit button
    const submitButton = screen.getByText('保存设置');
    expect(submitButton).toBeInTheDocument();
    
    // Verify the submit button has type="submit"
    expect(submitButton).toHaveAttribute('type', 'submit');
    
    // Click the submit button - it should trigger form submission
    fireEvent.click(submitButton);
    
    // The form should be submitted (setSettings should be called)
    expect(mockSetSettings).toHaveBeenCalled();
    expect(mockOnClose).toHaveBeenCalled();
  });
});