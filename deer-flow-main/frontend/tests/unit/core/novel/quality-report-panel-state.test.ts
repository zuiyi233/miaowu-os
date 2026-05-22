import { describe, expect, it } from 'vitest';

import {
  applyFinalizeSuccessTransition,
  buildFinalizeFeedbackLines,
  reduceFinalizeGateFeedbackState,
  type FinalizeGateFeedbackState,
} from '@/components/novel/reader/QualityReportPanel';

describe('QualityReportPanel finalize feedback transition', () => {
  it('clears blocked gate state after finalize succeeds', () => {
    const previous: FinalizeGateFeedbackState = {
      gateReport: {
        result: 'block',
        summary: {
          block_checks: 1,
          warn_checks: 0,
          total_issues: 2,
        },
      },
      gateMessage: '门禁检查未通过，存在阻断项。',
      finalizeMessage: '定稿被门禁阻断。',
    };

    const next = applyFinalizeSuccessTransition(previous);

    expect(next.gateReport).toBeNull();
    expect(next.gateMessage).toBe('');
    expect(next.finalizeMessage).toBe('定稿执行成功。');
  });

  it('shows only gate error message after success -> gate error transition', () => {
    const successState = applyFinalizeSuccessTransition({
      gateReport: null,
      gateMessage: '',
      finalizeMessage: '',
    });

    const next = reduceFinalizeGateFeedbackState(successState, {
      type: 'gate_error',
      message: '门禁检查失败，请稍后重试',
    });

    expect(next.gateReport).toBeNull();
    expect(next.gateMessage).toBe('门禁检查失败，请稍后重试');
    expect(next.finalizeMessage).toBe('');
  });

  it('clears old blocked/finalize text after block -> gate error transition', () => {
    const blockedState: FinalizeGateFeedbackState = {
      gateReport: {
        result: 'block',
        summary: {
          block_checks: 1,
          warn_checks: 0,
          total_issues: 2,
        },
      },
      gateMessage: '门禁检查未通过，存在阻断项。',
      finalizeMessage: '定稿被门禁阻断。',
    };

    const next = reduceFinalizeGateFeedbackState(blockedState, {
      type: 'gate_error',
      message: '门禁检查接口异常',
    });

    expect(next.gateReport).toBeNull();
    expect(next.gateMessage).toBe('门禁检查接口异常');
    expect(next.finalizeMessage).toBe('');
  });

  it('treats gate_success with null report as error state', () => {
    const previous: FinalizeGateFeedbackState = {
      gateReport: null,
      gateMessage: '',
      finalizeMessage: '定稿执行成功。',
    };

    const next = reduceFinalizeGateFeedbackState(previous, {
      type: 'gate_success',
      report: null,
    });

    expect(next.gateReport).toBeNull();
    expect(next.gateMessage).toBe('门禁结果为空，请重试');
    expect(next.finalizeMessage).toBe('');
  });

  it('deduplicates repeated feedback lines while preserving order', () => {
    const lines = buildFinalizeFeedbackLines(
      '门禁检查未通过，存在阻断项。',
      '门禁检查未通过，存在阻断项。',
      {
        checks: [
          {
            title: '结构检查',
            result: 'block',
            issues: [{ message: '章节顺序异常' }],
          },
        ],
      },
    );

    expect(lines).toEqual(['门禁检查未通过，存在阻断项。', '结构检查：章节顺序异常']);
  });

  it('ignores empty placeholders and keeps summary fallback lines', () => {
    const lines = buildFinalizeFeedbackLines('   ', '', {
      summary: {
        block_checks: 0,
        warn_checks: 2,
        total_issues: 2,
      },
    });

    expect(lines).toEqual(['阻断检查 0 项', '告警检查 2 项', '总问题 2 项']);
  });
});
