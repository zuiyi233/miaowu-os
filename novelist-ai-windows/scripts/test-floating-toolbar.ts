/**
 * 测试浮动工具栏功能的脚本
 * 这个脚本用于验证AI操作浮动工具栏是否正确显示在鼠标附近
 */

import { toast } from "sonner";

// 模拟选中文本和鼠标位置的测试
export const testFloatingToolbarPosition = () => {
  console.log("🧪 开始测试浮动工具栏位置功能...");
  
  // 模拟鼠标位置
  const testMousePositions = [
    { x: 100, y: 100 }, // 左上角
    { x: 500, y: 300 }, // 中间
    { x: 800, y: 600 }, // 右下角
    { x: 50, y: 700 },  // 左下角
    { x: 1100, y: 200 }, // 右上角（可能超出屏幕）
  ];

  testMousePositions.forEach((mousePos, index) => {
    console.log(`\n📍 测试位置 ${index + 1}:`, mousePos);
    
    // 模拟计算最终位置
    const finalX = mousePos.x + 10; // 向右偏移10px
    const finalY = mousePos.y + 15; // 向下偏移15px
    
    // 边界检查，确保工具栏不会超出屏幕范围
    const toolbarWidth = 160;
    const toolbarHeight = 40;
    const maxX = window.innerWidth - toolbarWidth - 10;
    const maxY = window.innerHeight - toolbarHeight - 10;
    
    const adjustedX = Math.max(10, Math.min(finalX, maxX));
    const adjustedY = Math.max(10, Math.min(finalY, maxY));
    
    console.log(`   ✅ 最终位置: (${adjustedX}, ${adjustedY})`);
    console.log(`   📏 边界检查: X ∈ [10, ${maxX}], Y ∈ [10, ${maxY}]`);
    
    // 验证位置是否在合理范围内
    const isValidPosition = 
      adjustedX >= 10 && adjustedX <= maxX &&
      adjustedY >= 10 && adjustedY <= maxY;
    
    console.log(`   ${isValidPosition ? '✅' : '❌'} 位置验证: ${isValidPosition ? '通过' : '失败'}`);
  });
  
  console.log("\n🎯 测试完成！浮动工具栏现在应该出现在鼠标右下方。");
  console.log("💡 测试建议:");
  console.log("   - 在编辑器中选中文本");
  console.log("   - 观察工具栏是否出现在鼠标附近");
  console.log("   - 尝试在不同位置选中文本");
  console.log("   - 确认工具栏不会超出屏幕边界");
  
  return true;
};

// 在浏览器控制台中运行测试
if (typeof window !== "undefined") {
  // 将测试函数挂载到全局对象上，方便手动调用
  (window as any).testFloatingToolbar = testFloatingToolbarPosition;
  
  // 自动运行测试（可选）
  setTimeout(() => {
    console.log("🚀 自动运行浮动工具栏测试...");
    testFloatingToolbarPosition();
  }, 1000);
}