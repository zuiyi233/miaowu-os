import type { LucideIcon } from "lucide-react";

export interface Translations {
  // Locale meta
  locale: {
    localName: string;
  };

  // Common
  common: {
    home: string;
    settings: string;
    delete: string;
    edit: string;
    rename: string;
    share: string;
    openInNewWindow: string;
    close: string;
    more: string;
    search: string;
    download: string;
    thinking: string;
    artifacts: string;
    public: string;
    custom: string;
    notAvailableInDemoMode: string;
    loading: string;
    version: string;
    lastUpdated: string;
    code: string;
    preview: string;
    cancel: string;
    save: string;
    install: string;
    create: string;
    import: string;
    export: string;
    exportAsMarkdown: string;
    exportAsJSON: string;
    exportSuccess: string;
  };

  home: {
    docs: string;
    blog: string;
  };

  // Welcome
  welcome: {
    greeting: string;
    description: string;
    createYourOwnSkill: string;
    createYourOwnSkillDescription: string;
  };

  // Clipboard
  clipboard: {
    copyToClipboard: string;
    copiedToClipboard: string;
    failedToCopyToClipboard: string;
    linkCopied: string;
  };

  // Input Box
  inputBox: {
    placeholder: string;
    createSkillPrompt: string;
    addAttachments: string;
    mode: string;
    flashMode: string;
    flashModeDescription: string;
    reasoningMode: string;
    reasoningModeDescription: string;
    proMode: string;
    proModeDescription: string;
    ultraMode: string;
    ultraModeDescription: string;
    reasoningEffort: string;
    reasoningEffortMinimal: string;
    reasoningEffortMinimalDescription: string;
    reasoningEffortLow: string;
    reasoningEffortLowDescription: string;
    reasoningEffortMedium: string;
    reasoningEffortMediumDescription: string;
    reasoningEffortHigh: string;
    reasoningEffortHighDescription: string;
    searchModels: string;
    surpriseMe: string;
    surpriseMePrompt: string;
    followupLoading: string;
    followupConfirmTitle: string;
    followupConfirmDescription: string;
    followupConfirmAppend: string;
    followupConfirmReplace: string;
    suggestions: {
      suggestion: string;
      prompt: string;
      icon: LucideIcon;
    }[];
    suggestionsCreate: (
      | {
          suggestion: string;
          prompt: string;
          icon: LucideIcon;
        }
      | {
          type: "separator";
        }
    )[];
  };

  // Sidebar
  sidebar: {
    recentChats: string;
    newChat: string;
    chats: string;
    demoChats: string;
    agents: string;
    novel: string;
  };

  // Novel Studio
  novel: {
    title: string;
    description: string;
    newNovel: string;
    noNovelsYet: string;
    noNovelsDescription: string;
    createFirstNovel: string;
    selectNovel: string;
    loading: string;
    editor: string;
    outline: string;
    timeline: string;
    graph: string;
    settings: string;
    entities: string;
    characters: string;
    factions: string;
    settings_entity: string;
    items: string;
    characterSingular: string;
    factionSingular: string;
    settingSingular: string;
    itemSingular: string;
    add: string;
    edit: string;
    delete: string;
    cancel: string;
    create: string;
    creating: string;
    update: string;
    name: string;
    namePlaceholder: (entity: string) => string;
    fieldPlaceholder: (field: string) => string;
    entityDescription: string;
    descriptionPlaceholder: (entity: string) => string;
    type: string;
    selectType: string;
    settingTypeCity: string;
    settingTypeBuilding: string;
    settingTypeNaturalLandscape: string;
    settingTypeRegion: string;
    settingTypeOther: string;
    fieldAge: string;
    fieldGender: string;
    fieldAppearance: string;
    fieldPersonality: string;
    fieldIdeology: string;
    fieldGoals: string;
    fieldStructure: string;
    fieldResources: string;
    fieldAtmosphere: string;
    fieldHistory: string;
    fieldKeyFeatures: string;
    fieldAbilities: string;
    itemTypeKeyItem: string;
    itemTypeWeapon: string;
    itemTypeTechDevice: string;
    itemTypeCommonItem: string;
    itemTypeOther: string;
    noEntities: (label: string) => string;
    noEntitiesClickAdd: string;
    deleteConfirm: (entity: string) => string;
    volumes: string;
    chapters: string;
    words: string;
    noVolumesYet: string;
    noVolumesClickAdd: string;
    addVolume: string;
    addChapter: string;
    volumeTitle: string;
    chapterTitle: string;
    volumePlaceholder: string;
    chapterPlaceholder: string;
    deleteVolumeConfirm: string;
    deleteChapterConfirm: string;
    chapterOutline: string;
    writingTarget: string;
    noNovelSelected: string;
    noNovelData: string;
    promptTemplates: string;
    dataManagement: string;
    exportData: string;
    exportDataDescription: string;
    importData: string;
    importDataDescription: string;
    exportJson: string;
    exportCsv: string;
    fullBackup: string;
    importJsonFile: string;
    clearAllData: string;
    clearAllDataConfirm: string;
    clearAllDataSuccess: string;
    exportSuccess: string;
    exportFailed: string;
    importSuccess: string;
    importFailed: string;
    importProcessing: string;
    importStatusTitle: string;
    importStatusDescription: string;
    newTemplate: string;
    editTemplate: string;
    createTemplate: string;
    createTemplateDescription: string;
    updateTemplateDescription: string;
    templateName: string;
    templateNamePlaceholder: string;
    promptContent: string;
    promptContentPlaceholder: string;
    templateVariableHint: string;
    noTemplatesFound: string;
    noTemplatesClickNew: string;
    builtIn: string;
    outlineGen: string;
    continueWrite: string;
    polish: string;
    expand: string;
    chat: string;
    extraction: string;
    allTypes: string;
    searchTemplates: string;
    filterType: string;
    addRelationship: string;
    addRelationshipDescription: string;
    sourceEntity: string;
    targetEntity: string;
    selectSource: string;
    selectTarget: string;
    relationshipType: string;
    relationshipDescription: string;
    relationshipDescriptionPlaceholder: string;
    friend: string;
    enemy: string;
    family: string;
    lover: string;
    custom: string;
    noTimelineEvents: string;
    noTimelineEventsClickAdd: string;
    addEvent: string;
    addEventTitle: string;
    addEventDescription: string;
    eventTitle: string;
    timeDisplay: string;
    timeDisplayPlaceholder: string;
    sortValue: string;
    sortValueHint: string;
    eventType: string;
    eventDescription: string;
    eventDescriptionPlaceholder: string;
    backstory: string;
    plot: string;
    historical: string;
    aiWriting: string;
    aiThinking: string;
    typeMessage: string;
    selectedText: string;
    noContextEntities: string;
    contextEntities: string;
    continue: string;
    expandScene: string;
    createNewNovelTitle: string;
    createNewNovelDescription: string;
    novelTitle: string;
    novelTitlePlaceholder: string;
    novelOutline: string;
    novelOutlinePlaceholder: string;
    defaultVolumeName: string;
    defaultChapterName: string;
  };

  // Agents
  agents: {
    title: string;
    description: string;
    newAgent: string;
    emptyTitle: string;
    emptyDescription: string;
    chat: string;
    delete: string;
    deleteConfirm: string;
    deleteSuccess: string;
    newChat: string;
    createPageTitle: string;
    createPageSubtitle: string;
    nameStepTitle: string;
    nameStepHint: string;
    nameStepPlaceholder: string;
    nameStepContinue: string;
    nameStepInvalidError: string;
    nameStepAlreadyExistsError: string;
    nameStepNetworkError: string;
    nameStepCheckError: string;
    nameStepBootstrapMessage: string;
    save: string;
    saving: string;
    saveRequested: string;
    saveHint: string;
    saveCommandMessage: string;
    agentCreatedPendingRefresh: string;
    more: string;
    agentCreated: string;
    startChatting: string;
    backToGallery: string;
  };

  // Breadcrumb
  breadcrumb: {
    workspace: string;
    chats: string;
  };

  // Workspace
  workspace: {
    officialWebsite: string;
    githubTooltip: string;
    settingsAndMore: string;
    visitGithub: string;
    reportIssue: string;
    contactUs: string;
    about: string;
  };

  // Conversation
  conversation: {
    noMessages: string;
    startConversation: string;
  };

  // Chats
  chats: {
    searchChats: string;
  };

  // Page titles (document title)
  pages: {
    appName: string;
    chats: string;
    newChat: string;
    untitled: string;
  };

  // Tool calls
  toolCalls: {
    moreSteps: (count: number) => string;
    lessSteps: string;
    executeCommand: string;
    presentFiles: string;
    needYourHelp: string;
    useTool: (toolName: string) => string;
    searchForRelatedInfo: string;
    searchForRelatedImages: string;
    searchFor: (query: string) => string;
    searchForRelatedImagesFor: (query: string) => string;
    searchOnWebFor: (query: string) => string;
    viewWebPage: string;
    listFolder: string;
    readFile: string;
    writeFile: string;
    clickToViewContent: string;
    writeTodos: string;
    skillInstallTooltip: string;
  };

  // Uploads
  uploads: {
    uploading: string;
    uploadingFiles: string;
  };

  // Subtasks
  subtasks: {
    subtask: string;
    executing: (count: number) => string;
    in_progress: string;
    completed: string;
    failed: string;
  };

  // Token Usage
  tokenUsage: {
    title: string;
    label: string;
    input: string;
    output: string;
    total: string;
    unavailable: string;
    unavailableShort: string;
  };

  // Shortcuts
  shortcuts: {
    searchActions: string;
    noResults: string;
    actions: string;
    keyboardShortcuts: string;
    keyboardShortcutsDescription: string;
    openCommandPalette: string;
    toggleSidebar: string;
  };

  // Settings
  settings: {
    title: string;
    description: string;
    sections: {
      appearance: string;
      memory: string;
      tools: string;
      skills: string;
      notification: string;
      about: string;
    };
    memory: {
      title: string;
      description: string;
      empty: string;
      rawJson: string;
      exportButton: string;
      exportSuccess: string;
      importButton: string;
      importConfirmTitle: string;
      importConfirmDescription: string;
      importFileLabel: string;
      importInvalidFile: string;
      importSuccess: string;
      manualFactSource: string;
      addFact: string;
      addFactTitle: string;
      editFactTitle: string;
      addFactSuccess: string;
      editFactSuccess: string;
      clearAll: string;
      clearAllConfirmTitle: string;
      clearAllConfirmDescription: string;
      clearAllSuccess: string;
      factDeleteConfirmTitle: string;
      factDeleteConfirmDescription: string;
      factDeleteSuccess: string;
      factContentLabel: string;
      factCategoryLabel: string;
      factConfidenceLabel: string;
      factContentPlaceholder: string;
      factCategoryPlaceholder: string;
      factConfidenceHint: string;
      factSave: string;
      factValidationContent: string;
      factValidationConfidence: string;
      noFacts: string;
      summaryReadOnly: string;
      memoryFullyEmpty: string;
      factPreviewLabel: string;
      searchPlaceholder: string;
      filterAll: string;
      filterFacts: string;
      filterSummaries: string;
      noMatches: string;
      markdown: {
        overview: string;
        userContext: string;
        work: string;
        personal: string;
        topOfMind: string;
        historyBackground: string;
        recentMonths: string;
        earlierContext: string;
        longTermBackground: string;
        updatedAt: string;
        facts: string;
        empty: string;
        table: {
          category: string;
          confidence: string;
          confidenceLevel: {
            veryHigh: string;
            high: string;
            normal: string;
            unknown: string;
          };
          content: string;
          source: string;
          createdAt: string;
          view: string;
        };
      };
    };
    appearance: {
      themeTitle: string;
      themeDescription: string;
      system: string;
      light: string;
      dark: string;
      systemDescription: string;
      lightDescription: string;
      darkDescription: string;
      languageTitle: string;
      languageDescription: string;
    };
    tools: {
      title: string;
      description: string;
      emptyTitle: string;
      emptyDescription: string;
    };
    skills: {
      title: string;
      description: string;
      createSkill: string;
      emptyTitle: string;
      emptyDescription: string;
      emptyButton: string;
    };
    notification: {
      title: string;
      description: string;
      requestPermission: string;
      deniedHint: string;
      testButton: string;
      testTitle: string;
      testBody: string;
      notSupported: string;
      disableNotification: string;
    };
    acknowledge: {
      emptyTitle: string;
      emptyDescription: string;
    };
  };
}
