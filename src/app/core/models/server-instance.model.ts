export interface ServerInstance {
  id: string;
  name: string;
  status?: 'online' | 'offline' | 'loading';
  state?: string; // Added for sidebar status icon
  type?: string;

  // Minimal ARK server config fields
  sessionName?: string;
  serverPassword?: string;
  serverAdminPassword?: string;
  maxPlayers?: number;
  mapName?: string;
  gamePort?: number;
  queryPort?: number;
  rconPort?: number;
  rconPassword?: string;
  bPvE?: boolean;
  difficultyOffset?: number;
  allowThirdPersonPlayer?: boolean;
  crossplay?: string[]; // e.g., ['Steam', 'Epic', 'Xbox', 'PlayStation']
  mods?: string[];

  // Whitelist/Exclusive Join configuration
  useExclusiveList?: boolean; // Enable exclusive join mode (UseExclusiveList=true)
  exclusiveJoinPlayerIds?: string[]; // Array of EOS/Player IDs allowed to join
  exclusiveJoinPlayers?: Array<{playerId: string, playerName?: string, dateAdded?: string}>; // Player objects with names
  whitelistKickMessage?: string; // Custom message when non-whitelisted players are kicked

  // Advanced ARK server config fields
  xpMultiplier?: number;
  tamingSpeedMultiplier?: number;
  harvestAmountMultiplier?: number;
  dinoCharacterFoodDrainMultiplier?: number;
  dinoCharacterStaminaDrainMultiplier?: number;
  dinoCharacterHealthRecoveryMultiplier?: number;
  dinoCountMultiplier?: number;
  playerCharacterFoodDrainMultiplier?: number;
  playerCharacterStaminaDrainMultiplier?: number;
  playerCharacterHealthRecoveryMultiplier?: number;
  playerCharacterWaterDrainMultiplier?: number;
  playerCharacterDamageMultiplier?: number;
  playerCharacterResistanceMultiplier?: number;
  dinoCharacterDamageMultiplier?: number;
  dinoCharacterResistanceMultiplier?: number;
  structureResistanceMultiplier?: number;
  structureDamageMultiplier?: number;
  pvpStructureDecay?: boolean;
  allowFlyerCarryPvE?: boolean;
  alwaysNotifyPlayerLeft?: boolean;
  alwaysNotifyPlayerJoined?: boolean;
  enablePvPGamma?: boolean;
  disableStructureDecayPvE?: boolean;
  allowThirdPerson?: boolean;
  showMapPlayerLocation?: boolean;
  serverCrosshair?: boolean;
  serverForceNoHUD?: boolean;
  noTributeDownloads?: boolean;
  enableExtraStructurePreventionVolumes?: boolean;
  preventDownloadDinos?: boolean;
  preventDownloadItems?: boolean;
  preventDownloadSurvivors?: boolean;
  preventUploadDinos?: boolean;
  preventUploadItems?: boolean;
  preventUploadSurvivors?: boolean;
  crossArkAllowForeignDinoDownloads?: boolean;
  overrideOfficialDifficulty?: number;
  dayCycleSpeedScale?: number;
  dayTimeSpeedScale?: number;
  nightTimeSpeedScale?: number;
  dinoHarvestingDamageMultiplier?: number;
  playerHarvestingDamageMultiplier?: number;
  resourcesRespawnPeriodMultiplier?: number;
  structurePreventResourceRadiusMultiplier?: number;
  tribeNameChangeCooldown?: number;
  raidDinoCharacterFoodDrainMultiplier?: number;
  passiveTameIntervalMultiplier?: number;
  globalSpoilingTimeMultiplier?: number;
  globalItemDecompositionTimeMultiplier?: number;
  globalCorpseDecompositionTimeMultiplier?: number;
  cropGrowthSpeedMultiplier?: number;
  cropDecaySpeedMultiplier?: number;
  matingIntervalMultiplier?: number;
  matingSpeedMultiplier?: number;
  eggHatchSpeedMultiplier?: number;
  babyMatureSpeedMultiplier?: number;
  babyFoodConsumptionSpeedMultiplier?: number;
  babyCuddleIntervalMultiplier?: number;
  babyImprintingStatScaleMultiplier?: number;
  babyCuddleGracePeriodMultiplier?: number;
  babyCuddleLoseImprintQualitySpeedMultiplier?: number;
  babyImprintAmountMultiplier?: number;
  babyMaxIntervalMultiplier?: number;
  fuelConsumptionIntervalMultiplier?: number;
  allowAnyoneBabyImprintCuddle?: boolean;
  disableImprintDinoBuff?: boolean;
  allowRaidDinoFeeding?: boolean;
  onlyAllowSpecifiedEngrams?: boolean;
  preventOfflinePvP?: boolean;
  preventOfflinePvPInterval?: number;
  overrideStructurePlatformPrevention?: boolean;
  forceAllStructureLocking?: boolean;
  autoDestroyOldStructuresMultiplier?: number;
  maxTamedDinos?: number;
  enableCryoSicknessPVE?: boolean;
  maxPersonalTamedDinos?: number;
  personalTamedDinosSaddleStructureCost?: number;
  useOptimizedHarvestingHealth?: boolean;
  allowMultipleAttachedC4?: boolean;
  oviraptorEggConsumptionMultiplier?: number;
  structurePickupTimeAfterPlacement?: number;
  structurePickupHoldDuration?: number;
  allowIntegratedSPlusStructures?: boolean;
  allowCrateSpawnsOnTopOfStructures?: boolean;
  bDisableStructurePlacementCollision?: boolean;
  bAllowPlatformSaddleMultiFloors?: boolean;
  bAllowPlatformSaddleStacking?: boolean;
  bDisableFriendlyFire?: boolean;
  bDisableLootCrates?: boolean;
  bDisableStructureDecayPvE?: boolean;
  bDisableWeatherFog?: boolean;
  bEnableExtraStructurePreventionVolumes?: boolean;
  bIncreasePvPRespawnInterval?: boolean;
  bPvEDisableFriendlyFire?: boolean;
  bPvEAllowTribeWar?: boolean;
  bPvEAllowTribeWarCancel?: boolean;
  bServerGameLogEnabled?: boolean;
  bShowCreativeMode?: boolean;
  bUseCorpseLocator?: boolean;
  bUseSingleplayerSettings?: boolean;
  bXPMultiplier?: number;
  customGameIni?: string;
  customGameUserSettingsIni?: string;

  // Cluster functionality
  clusterId?: string; // ID of the cluster this server belongs to
  clusterName?: string; // Name of the cluster (for display purposes)
  clusterOrder?: number; // Order in which this server should start within the cluster (0-based)
  clusterRole?: 'primary' | 'secondary' | 'backup'; // Role of this server within the cluster

  // ARK Cluster Parameters
  clusterDirOverride?: string; // Path to shared cluster directory for character/item transfers
  noTransferFromFiltering?: boolean; // Allow transfers from any server in cluster

  // Stat multipliers (12 stats each, default 1.0)
  perLevelStatsMultiplier_Player?: number[]; // [Health, Stamina, Torpidity, Oxygen, Food, Water, Temperature, Weight, MeleeDamage, MovementSpeed, Fortitude, CraftingSkill]
  perLevelStatsMultiplier_DinoTamed?: number[];
  perLevelStatsMultiplier_DinoWild?: number[];
  perLevelStatsMultiplier_DinoTamed_Add?: number[];
  perLevelStatsMultiplier_DinoTamed_Affinity?: number[];
  perLevelStatsMultiplier_DinoTamed_Torpidity?: number[];
  perLevelStatsMultiplier_DinoTamed_Clamp?: number[];

  // Automation settings
  autoStartOnAppLaunch?: boolean; // Start server when application launches
  autoStartOnBoot?: boolean; // Start server on system boot (requires Windows service)
  crashDetectionEnabled?: boolean; // Monitor and restart on crashes
  crashDetectionInterval?: number; // How often to check process health (seconds)
  maxRestartAttempts?: number; // Max restart attempts before giving up
  scheduledRestartEnabled?: boolean; // Enable scheduled restarts
  restartFrequency?: 'daily' | 'weekly' | 'custom'; // How often to restart
  restartTime?: string; // Time to restart (HH:MM format)
  restartDays?: number[]; // Days of week to restart (0=Sunday, 1=Monday, etc.)
  restartWarningMinutes?: number; // Minutes to warn players before restart

  // Runtime information (not persisted)
  players?: number; // Current player count
  memory?: number; // Memory usage in MB (runtime only)
  message?: string; // Status message (runtime only)

  // Discord Integration
  discordConfig?: {
    enabled: boolean;
    webhookUrl: string;
    notifications?: {
      serverStart?: boolean;
      serverStop?: boolean;
      serverCrash?: boolean;
      serverUpdate?: boolean;
      serverJoin?: boolean;
      serverLeave?: boolean;
    };
  };

  // Broadcasts
  broadcastConfig?: {
    enabled?: boolean;
    messages?: Array<{
      id: string;
      message: string;
      interval: number;
      enabled: boolean;
    }>;
  };
}
