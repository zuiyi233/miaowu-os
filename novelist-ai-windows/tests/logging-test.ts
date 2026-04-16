/**
 * 日志系统测试文件
 * 用于验证日志模块的基本功能
 */

import { describe, it, expect } from "vitest";
import { logger } from "../lib/logging";

describe("日志系统测试", () => {
  it("应该能够正确导入logger", () => {
    expect(logger).toBeDefined();
    expect(typeof logger.debug).toBe("function");
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.success).toBe("function");
  });

  it("应该能够调用所有日志级别而不抛出错误", () => {
    const testContext = "TestContext";
    const testMessage = "测试日志消息";
    const testData = { key: "value", number: 123 };

    expect(() => {
      logger.debug(testContext, testMessage, testData);
      logger.info(testContext, testMessage, testData);
      logger.warn(testContext, testMessage, testData);
      logger.error(testContext, testMessage, testData);
      logger.success(testContext, testMessage, testData);
    }).not.toThrow();
  });

  it("应该能够处理没有数据的情况", () => {
    const testContext = "TestContext";
    const testMessage = "测试无数据日志";

    expect(() => {
      logger.debug(testContext, testMessage);
      logger.info(testContext, testMessage);
      logger.warn(testContext, testMessage);
      logger.error(testContext, testMessage);
      logger.success(testContext, testMessage);
    }).not.toThrow();
  });

  it("应该能够处理复杂对象数据", () => {
    const testContext = "TestContext";
    const testMessage = "测试复杂对象";
    const complexData = {
      user: {
        id: "123",
        name: "测试用户",
        settings: {
          theme: "dark",
          notifications: true,
        },
      },
      items: [1, 2, 3, { nested: "value" }],
      timestamp: new Date(),
    };

    expect(() => {
      logger.info(testContext, testMessage, complexData);
    }).not.toThrow();
  });
});
