/**
 * 数据导出/导入功能验证脚本
 *
 * 这个脚本验证数据导出和导入功能的完整性，确保所有数据类型都能正确导出和导入
 */

// 模拟浏览器环境
global.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {}
};

// 模拟 IndexedDB
import 'fake-indexeddb/auto';

async function testDataExportImport() {
  console.log('🔍 开始验证数据导出/导入功能...\n');

  try {
    // 动态导入模块
    const { DatabaseService } = await import('../lib/storage/db.ts');
    const databaseService = new DatabaseService();

    // 1. 清理数据库
    console.log('🧹 清理数据库...');
    await databaseService.clearAllData();

    // 2. 创建测试数据
    console.log('📝 创建测试数据...');
    const testNovel = {
      title: '测试小说',
      outline: '这是一个测试小说的大纲',
      volumes: [
        {
          id: 'vol1',
          title: '第一卷',
          description: '第一卷描述',
          chapters: [
            {
              id: 'ch1',
              title: '第一章',
              content: '<p>第一章内容</p>'
            }
          ]
        }
      ],
      chapters: [
        {
          id: 'ch1',
          title: '第一章',
          content: '<p>第一章内容</p>'
        }
      ],
      characters: [
        {
          id: 'char1',
          name: '测试角色',
          description: '这是一个测试角色'
        }
      ],
      settings: [
        {
          id: 'setting1',
          name: '测试场景',
          description: '这是一个测试场景',
          type: '城市'
        }
      ],
      factions: [
        {
          id: 'faction1',
          name: '测试势力',
          description: '这是一个测试势力'
        }
      ],
      items: [
        {
          id: 'item1',
          name: '测试物品',
          description: '这是一个测试物品',
          type: '关键物品'
        }
      ],
      relationships: [
        {
          id: 'rel1',
          sourceId: 'char1',
          targetId: 'faction1',
          type: '成员',
          description: '角色是势力的成员'
        }
      ]
    };

    // 3. 保存测试小说
    console.log('💾 保存测试小说...');
    await databaseService.saveNovel(testNovel);

    // 4. 创建时间线事件
    console.log('⏰ 创建时间线事件...');
    const testTimelineEvent = {
      id: 'event1',
      novelId: '测试小说',
      title: '测试事件',
      description: '这是一个测试时间线事件',
      type: 'plot',
      sortValue: 1,
      relatedEntities: ['char1', 'setting1']
    };
    await databaseService.addTimelineEvent(testTimelineEvent, '测试小说');

    // 5. 导出所有数据
    console.log('📤 导出所有数据...');
    const exportedData = await databaseService.exportAllData();

    // 6. 验证导出数据的完整性
    console.log('✅ 验证导出数据完整性...');
    
    const checks = [
      { condition: exportedData.version === 2, message: '版本号正确' },
      { condition: exportedData.novels.length === 1, message: '小说数量正确' },
      { condition: exportedData.novels[0].title === '测试小说', message: '小说标题正确' },
      { condition: exportedData.novels[0].characters.length === 1, message: '角色数量正确' },
      { condition: exportedData.novels[0].settings.length === 1, message: '场景数量正确' },
      { condition: exportedData.novels[0].factions.length === 1, message: '势力数量正确' },
      { condition: exportedData.novels[0].items.length === 1, message: '物品数量正确' },
      { condition: exportedData.novels[0].relationships.length === 1, message: '关系数量正确' },
      { condition: exportedData.timelineEvents.length === 1, message: '时间线事件数量正确' },
      { condition: exportedData.timelineEvents[0].title === '测试事件', message: '时间线事件标题正确' },
      { condition: exportedData.relationships.length === 1, message: '独立关系数量正确' },
      { condition: exportedData.relationships[0].type === '成员', message: '关系类型正确' },
      { condition: exportedData.items.length === 1, message: '独立物品数量正确' },
      { condition: exportedData.items[0].name === '测试物品', message: '物品名称正确' },
      { condition: exportedData.promptTemplates.length > 0, message: '提示词模板存在' }
    ];

    let allChecksPassed = true;
    for (const check of checks) {
      if (check.condition) {
        console.log(`  ✓ ${check.message}`);
      } else {
        console.log(`  ✗ ${check.message}`);
        allChecksPassed = false;
      }
    }

    if (!allChecksPassed) {
      throw new Error('导出数据验证失败');
    }

    // 7. 清理数据库
    console.log('\n🧹 清理数据库...');
    await databaseService.clearAllData();

    // 8. 导入数据
    console.log('📥 导入数据...');
    await databaseService.importData(exportedData);

    // 9. 验证导入的数据完整性
    console.log('✅ 验证导入数据完整性...');
    
    const importedNovel = await databaseService.loadNovel('测试小说');
    const importedTimelineEvents = await databaseService.getTimelineEvents('测试小说');
    const importedPromptTemplates = await databaseService.getAllPromptTemplates();

    const importChecks = [
      { condition: importedNovel !== null, message: '小说导入成功' },
      { condition: importedNovel.title === '测试小说', message: '小说标题正确' },
      { condition: importedNovel.characters.length === 1, message: '角色数量正确' },
      { condition: importedNovel.characters[0].name === '测试角色', message: '角色名称正确' },
      { condition: importedNovel.settings.length === 1, message: '场景数量正确' },
      { condition: importedNovel.settings[0].name === '测试场景', message: '场景名称正确' },
      { condition: importedNovel.factions.length === 1, message: '势力数量正确' },
      { condition: importedNovel.factions[0].name === '测试势力', message: '势力名称正确' },
      { condition: importedNovel.items.length === 1, message: '物品数量正确' },
      { condition: importedNovel.items[0].name === '测试物品', message: '物品名称正确' },
      { condition: importedNovel.relationships.length === 1, message: '关系数量正确' },
      { condition: importedNovel.relationships[0].type === '成员', message: '关系类型正确' },
      { condition: importedTimelineEvents.length === 1, message: '时间线事件数量正确' },
      { condition: importedTimelineEvents[0].title === '测试事件', message: '时间线事件标题正确' },
      { condition: importedPromptTemplates.length > 0, message: '提示词模板导入成功' }
    ];

    let allImportChecksPassed = true;
    for (const check of importChecks) {
      if (check.condition) {
        console.log(`  ✓ ${check.message}`);
      } else {
        console.log(`  ✗ ${check.message}`);
        allImportChecksPassed = false;
      }
    }

    if (!allImportChecksPassed) {
      throw new Error('导入数据验证失败');
    }

    // 10. 测试部分数据导入
    console.log('\n🔧 测试部分数据导入...');
    await databaseService.clearAllData();

    const partialData = {
      version: 2,
      novels: [
        {
          title: '部分导入测试小说',
          outline: '这是一个部分导入测试小说的大纲',
          volumes: [],
          chapters: [],
          characters: [],
          settings: [],
          factions: [],
          items: [],
          relationships: []
        }
      ],
      promptTemplates: [],
      timelineEvents: [],
      relationships: [],
      items: []
    };

    await databaseService.importData(partialData);
    const partialImportedNovel = await databaseService.loadNovel('部分导入测试小说');
    
    if (partialImportedNovel && partialImportedNovel.title === '部分导入测试小说') {
      console.log('  ✓ 部分数据导入成功');
    } else {
      throw new Error('部分数据导入失败');
    }

    // 11. 测试空数据导入
    console.log('\n🔧 测试空数据导入...');
    const emptyData = {
      version: 2,
      novels: [],
      promptTemplates: [],
      timelineEvents: [],
      relationships: [],
      items: []
    };

    await databaseService.importData(emptyData);
    console.log('  ✓ 空数据导入成功');

    // 12. 最终清理
    await databaseService.clearAllData();

    console.log('\n🎉 所有测试通过！数据导出/导入功能验证成功！');
    return true;

  } catch (error) {
    console.error('\n❌ 验证失败:', error.message);
    console.error(error.stack);
    return false;
  }
}

// 运行测试
testDataExportImport().then(success => {
  process.exit(success ? 0 : 1);
}).catch(error => {
  console.error('脚本执行失败:', error);
  process.exit(1);
});