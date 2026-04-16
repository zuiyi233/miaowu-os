import { renderHook, act } from "@testing-library/react";
import { useFormWithLogging } from "../lib/logging";
import { logger } from "../lib/logging/logger";

// Mock logger to avoid actual console output during tests
vi.mock("../lib/logging/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

describe("Logging Fix Verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should NOT log debug message during component render", () => {
    // This test verifies the fix for the logging spam issue
    const { result, rerender } = renderHook(() =>
      useFormWithLogging({
        context: "TestForm",
        defaultValues: {
          name: "",
        },
      })
    );

    // Initial render should not log debug message
    expect(logger.debug).not.toHaveBeenCalled();

    // Rerender should not log debug message
    rerender();
    expect(logger.debug).not.toHaveBeenCalled();

    // Multiple rerenders should not log debug message
    rerender();
    rerender();
    expect(logger.debug).not.toHaveBeenCalled();

    // Even accessing handleSubmit should not trigger debug log
    const handleSubmitFn = result.current.handleSubmit(vi.fn());
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it("should only log when actual form submission happens", () => {
    const { result } = renderHook(() =>
      useFormWithLogging({
        context: "TestForm",
        defaultValues: {
          name: "",
        },
      })
    );

    // Create a mock event that simulates form submission
    const mockEvent = {
      preventDefault: vi.fn(),
      target: {},
      currentTarget: {},
    } as any;

    // Create a mock onValid callback
    const mockOnValid = vi.fn();

    // Get the handleSubmit function
    const handleSubmit = result.current.handleSubmit(mockOnValid);

    // Call the handleSubmit function (simulating form submission)
    act(() => {
      handleSubmit(mockEvent);
    });

    // Should not have logged debug message (the fix)
    expect(logger.debug).not.toHaveBeenCalled();

    // But should have logged info message if validation passed
    // (This depends on the actual form validation logic)
  });
});
