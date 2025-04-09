// OBS WebSocket service for controlling OBS scenes and sources
import OBSWebSocket from "obs-websocket-js";
import { logger as loggerService } from "../utils/logger.ts";
import { MediaStreamService } from "../types/index.ts";
import { Config } from "../types/index.ts";
import path from "path";
import fs from "fs";

const logger = {
  info: (message: string) => {
    loggerService.info(message, MediaStreamService.OBS);
  },
  warn: (message: string) => {
    loggerService.warn(message, MediaStreamService.OBS);
  },
  error: (message: string) => {
    loggerService.error(message, MediaStreamService.OBS);
  },
};

export class OBSStream {
  private obs: OBSWebSocket;
  private config: Config;
  private connected: boolean = false;
  private currentScene: string;
  private pendingVideoQueue: string[] = [];
  private isTransitioning: boolean = false;
  private singleSceneName: string = "AI_Stream_Scene";
  private baseSourceName: string = "Base_Video";
  private activeGeneratedSource: string | null = null;

  // Vision
  private screenshotInterval: NodeJS.Timeout | null = null;
  private screenshotDirectory: string;
  private isCapturingScreenshots: boolean = false;
  private captureSourceName: string | null = null;
  private screenshotCallbacks: Array<(imagePath: string) => void> = [];
  private captureFrequencyMs: number;

  constructor(config: Config) {
    this.config = config;
    this.obs = new OBSWebSocket();
    this.currentScene = this.singleSceneName;
    
    // Set capture frequency from config
    this.captureFrequencyMs = (this.config.visionIntervalSeconds || 30) * 1000;

    // Ensure screenshot directory is absolute
    this.screenshotDirectory = path.resolve(path.join(this.config.outputDir, "screenshots"));

    // Create screenshot directory if it doesn't exist
    if (!fs.existsSync(this.screenshotDirectory)) {
      try {
        fs.mkdirSync(this.screenshotDirectory, { recursive: true });
        logger.info(`Created screenshot directory at: ${this.screenshotDirectory}`);
      } catch (error) {
        logger.error(
          `Failed to create screenshot directory: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
    // Set up event handlers
    this.obs.on("ConnectionOpened", () => {
      logger.info("Connected to OBS WebSocket server");
      this.connected = true;
    });

    this.obs.on("ConnectionClosed", () => {
      logger.info("Disconnected from OBS WebSocket server");
      this.connected = false;
    });

    this.obs.on("ConnectionError", (err) => {
      logger.error(`OBS WebSocket connection error: ${err.message}`);
      this.connected = false;

      // Attempt to reconnect after a delay
      setTimeout(() => this.connect(), 5000);
    });

    // Add listener for all events to help with debugging
    this.obs.on("MediaInputPlaybackStarted", (data) => {
      logger.info(`Media playback started: ${JSON.stringify(data)}`);
    });

    this.obs.on("MediaInputPlaybackEnded", (data) => {
      logger.info(`Media playback ended: ${JSON.stringify(data)}`);
    });

    // Also subscribe to raw OBS WebSocket events for debugging
    this.obs.on("MediaInputActionTriggered", (data) => {
      logger.info(`Media action triggered: ${JSON.stringify(data)}`);
    });

    this.obs.on("CurrentProgramSceneChanged", (data) => {
      logger.info(`Scene changed: ${JSON.stringify(data)}`);
      // Update our current scene
      if (data && data.sceneName) {
        this.currentScene = data.sceneName;
      }
    });
  }

  /**
   * Connect to OBS WebSocket server
   */
  async connect(): Promise<boolean> {
    try {
      const { obsWebSocketHost, obsWebSocketPort, obsWebSocketPassword } =
        this.config;

      // Format the connection URL properly
      const url = `ws://${obsWebSocketHost}:${obsWebSocketPort}`;
      logger.info(`Attempting to connect to OBS WebSocket at: ${url}`);

      // Connect to OBS WebSocket server with v5 API
      await this.obs.connect(url, obsWebSocketPassword);
      logger.info("Connected to OBS WebSocket server");
      this.connected = true;

      // Get OBS version information for debugging
      try {
        const versionInfo = await this.obs.call("GetVersion");
        logger.info(
          `Connected to OBS Studio version ${versionInfo.obsVersion} with WebSocket version ${versionInfo.obsWebSocketVersion}`
        );

        // Log additional version details for debugging
        logger.info(
          `OBS platform: ${versionInfo.platform}, RPC version: ${versionInfo.rpcVersion}`
        );

        // Check if WebSocket version is compatible (we need v5)
        const wsVersion = parseInt(
          versionInfo.obsWebSocketVersion.split(".")[0]
        );
        if (wsVersion < 5) {
          logger.warn(
            `WARNING: OBS WebSocket version ${versionInfo.obsWebSocketVersion} detected. This integration requires v5.x or higher.`
          );
        }
      } catch (versionError) {
        logger.warn(
          `Could not retrieve OBS version information: ${
            versionError instanceof Error
              ? versionError.message
              : String(versionError)
          }`
        );
      }

      // Create or switch to a dedicated scene collection
      await this.createSceneCollection();

      await this.setupScenes();

      return true;
    } catch (error) {
      logger.error(
        `Failed to connect to OBS: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      this.connected = false;

      // If error contains specific information about version incompatibility, log it clearly
      if (error instanceof Error && error.message.includes("socket version")) {
        logger.error(
          "ERROR: OBS WebSocket version incompatibility detected. Please ensure OBS Studio has WebSocket v5.x installed."
        );
        logger.error(
          "You can download the correct plugin from: https://github.com/obsproject/obs-websocket/releases"
        );
      }

      // Attempt to reconnect after a delay
      setTimeout(() => this.connect(), 5000);

      return false;
    }
  }

  /**
   * Create or switch to a dedicated scene collection for our AI streamer
   */
  private async createSceneCollection(): Promise<void> {
    try {
      const sceneCollectionName = "AI_Streamer";

      // Try to get the current collections
      let collections: string[] = [];
      try {
        const result = await this.obs.call("GetSceneCollectionList");
        collections = result.sceneCollections || [];
        logger.info(`Found ${collections.length} scene collections in OBS`);
      } catch (error) {
        logger.warn(
          `Could not get scene collections: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }

      // Check if our collection already exists
      const collectionExists = collections.includes(sceneCollectionName);

      if (!collectionExists) {
        // Create a new scene collection
        logger.info(`Creating new scene collection: ${sceneCollectionName}`);
        try {
          await this.obs.call("CreateSceneCollection", { sceneCollectionName });
          logger.info(`New scene collection created: ${sceneCollectionName}`);
        } catch (error) {
          logger.error(
            `Failed to create scene collection: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      } else {
        // Switch to existing collection
        logger.info(
          `Switching to existing scene collection: ${sceneCollectionName}`
        );
        try {
          await this.obs.call("SetCurrentSceneCollection", {
            sceneCollectionName,
          });
          logger.info(`Switched to scene collection: ${sceneCollectionName}`);
        } catch (error) {
          logger.error(
            `Failed to switch scene collection: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }

      // Wait for scene collection change to complete (OBS needs a moment)
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error) {
      logger.error(
        `Error setting up scene collection: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Check if the necessary scenes and sources exist in OBS, create them if not
   */
  private async setupScenes(): Promise<void> {
    try {
      // Log to help debug OBS connection details
      logger.info(
        `Setting up single scene with base video: ${this.config.baseVideoPath}`
      );

      // Get list of scenes
      const scenes = await this.getSceneList();
      logger.info(`Found ${scenes.length} existing scenes in OBS`);

      // Check if our single scene exists
      const sceneExists = scenes.some(
        (scene) => scene.sceneName === this.singleSceneName
      );

      if (!sceneExists) {
        logger.info(`Creating single scene: ${this.singleSceneName}`);
        await this.obs.call("CreateScene", { sceneName: this.singleSceneName });

        // Add base video source to the scene
        const baseVideoPath = path.resolve(this.config.baseVideoPath);
        if (fs.existsSync(baseVideoPath)) {
          logger.info(`Adding base video source to scene: ${baseVideoPath}`);
          await this.setupBaseVideoSource(baseVideoPath);
        } else {
          logger.error(`Base video file not found: ${baseVideoPath}`);
        }
      }

      // Switch to our single scene
      await this.obs.call("SetCurrentProgramScene", {
        sceneName: this.singleSceneName,
      });

      this.currentScene = this.singleSceneName;
      logger.info(`Successfully switched to scene: ${this.singleSceneName}`);
    } catch (error) {
      logger.error(
        `Failed to setup OBS scenes: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Helper method to get scene list
   */
  private async getSceneList(): Promise<any[]> {
    try {
      const result = await this.obs.call("GetSceneList");
      return result.scenes || [];
    } catch (error) {
      logger.error(
        `Failed to get scene list: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return [];
    }
  }

  /**
   * Update the media source with a new video file
   */
  async updateGeneratedVideoSource(videoPath: string): Promise<boolean> {
    if (!this.connected) {
      logger.warn("OBS WebSocket not connected, cannot update video source");
      return false;
    }

    try {
      const absoluteVideoPath = path.resolve(videoPath);

      // Check if the file exists
      if (!fs.existsSync(absoluteVideoPath)) {
        logger.error(`Video file not found: ${absoluteVideoPath}`);
        return false;
      }

      // Add video to the queue
      this.pendingVideoQueue.push(absoluteVideoPath);
      logger.info(
        `Added video to queue: ${absoluteVideoPath} (queue size: ${this.pendingVideoQueue.length})`
      );

      // Process immediately if not transitioning
      if (!this.isTransitioning && this.pendingVideoQueue.length === 1) {
        await this.playNextVideoInSingleScene();
      } else {
        // Log queue status
        if (this.isTransitioning) {
          logger.info(`Already transitioning, video queued for later playback`);
        } else if (this.pendingVideoQueue.length > 1) {
          logger.info(
            `Added to queue, will play after ${
              this.pendingVideoQueue.length - 1
            } other videos`
          );
        }
      }

      return true;
    } catch (error) {
      logger.error(
        `Failed to queue video: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return false;
    }
  }

  /**
   * Disconnect from OBS WebSocket server
   */
  async disconnect(): Promise<void> {
    if (this.connected) {
      try {
        // Remove all event listeners to prevent memory leaks
        this.obs.off("ConnectionOpened");
        this.obs.off("ConnectionClosed");
        this.obs.off("ConnectionError");
        this.obs.off("MediaInputPlaybackEnded");

        this.stopScreenshotCapture();

        await this.obs.disconnect();
        this.connected = false;
        logger.info("Disconnected from OBS WebSocket server");
      } catch (error) {
        logger.error(
          `Error disconnecting from OBS: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  }

  /**
   * Check if connected to OBS
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Play the next video in a single scene
   */
  private async playNextVideoInSingleScene(): Promise<void> {
    if (this.pendingVideoQueue.length === 0 || this.isTransitioning) {
      return;
    }

    this.isTransitioning = true;
    const nextVideoPath = this.pendingVideoQueue.shift();

    if (!nextVideoPath) {
      this.isTransitioning = false;
      return;
    }

    try {
      const absoluteVideoPath = path.resolve(nextVideoPath);
      const videoFilename = path.basename(nextVideoPath);
      const uniqueSourceName = `Generated_${Date.now()}_${videoFilename}`;

      // Clean up any old generated sources
      await this.cleanupOldGeneratedSources();

      logger.info(
        `Creating new video source in scene: ${this.singleSceneName}`
      );

      // Create the new source but set it with visible initially
      const response = await this.obs.call("CreateInput", {
        sceneName: this.singleSceneName,
        inputName: uniqueSourceName,
        inputKind: "ffmpeg_source",
        inputSettings: {
          local_file: absoluteVideoPath,
          looping: false,
        },
      });

      // Set up audio monitoring
      try {
        await this.obs.call("SetInputAudioMonitorType", {
          inputName: uniqueSourceName,
          monitorType: "OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT",
        });
        logger.info(`Enabled audio monitoring for: ${uniqueSourceName}`);
      } catch (error) {
        logger.warn(
          `Failed to set audio monitoring: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }

      // If we got a valid response with sceneItemId, center the source
      if (response && response.sceneItemId) {
        logger.info(
          `Setting up source in scene with sceneItemId: ${response.sceneItemId}`
        );
        // Copy filters and properties from base source to new source
        await this.copyFiltersAndProperties(
          this.baseSourceName,
          uniqueSourceName
        );

        // Store the active generated source name
        this.activeGeneratedSource = uniqueSourceName;

        // Find the base video source to hide it
        const sourcesList = await this.obs.call("GetSceneItemList", {
          sceneName: this.singleSceneName,
        });

        const baseSource = sourcesList.sceneItems.find(
          (item) => item.sourceName === this.baseSourceName
        );

        if (baseSource && baseSource.sceneItemId) {
          // Hide the base video
          await this.obs.call("SetSceneItemEnabled", {
            sceneName: this.singleSceneName,
            sceneItemId: Number(baseSource.sceneItemId),
            sceneItemEnabled: false,
          });
          logger.info(`Hid base video source to show generated content`);
        }
      } else {
        logger.error(`Could not get sceneItemId for new source, aborting`);
        this.isTransitioning = false;
        return;
      }

      logger.info(`Now playing generated video: ${uniqueSourceName}`);

      // Set up a one-time listener for when the generated video ends
      const mediaEndHandler = async (data: any) => {
        if (data.inputName === uniqueSourceName) {
          logger.info(
            `Generated video ended: ${uniqueSourceName}, returning to base video`
          );

          // Add a delay before switching back to base video
          await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay

          // Find the sources again (they might have changed)
          const currentSourcesList = await this.obs.call("GetSceneItemList", {
            sceneName: this.singleSceneName,
          });

          const baseSource = currentSourcesList.sceneItems.find(
            (item) => item.sourceName === this.baseSourceName
          );

          // Show base video again
          if (baseSource && baseSource.sceneItemId) {
            await this.obs.call("SetSceneItemEnabled", {
              sceneName: this.singleSceneName,
              sceneItemId: Number(baseSource.sceneItemId),
              sceneItemEnabled: true,
            });
            logger.info(`Showing base video again`);
          }

          // Clean up the generated source
          try {
            await this.obs.call("RemoveInput", { inputName: uniqueSourceName });
            logger.info(`Removed completed media source: ${uniqueSourceName}`);
          } catch (error) {
            logger.error(
              `Failed to remove source: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
          }

          this.activeGeneratedSource = null;

          // Reset the base video if needed
          try {
            // Get current position of base video
            const mediaInfo = await this.obs.call("GetMediaInputStatus", {
              inputName: this.baseSourceName,
            });
            logger.info(
              `Current base video state: ${JSON.stringify(mediaInfo)}`
            );

            // Restart base video playback
            await this.obs.call("TriggerMediaInputAction", {
              inputName: this.baseSourceName,
              mediaAction: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY",
            });
            logger.info(`Resumed base video playback`);
          } catch (error) {
            logger.error(
              `Error resuming base video: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
          }

          // Release transition lock
          this.isTransitioning = false;

          // Check for more pending videos
          if (this.pendingVideoQueue.length > 0) {
            logger.info(
              `${this.pendingVideoQueue.length} videos still pending in queue`
            );
            // Process next video after a short delay
            setTimeout(() => this.playNextVideoInSingleScene(), 500);
          }

          // Remove this specific event listener
          this.obs.off("MediaInputPlaybackEnded", mediaEndHandler);
        }
      };

      // Add the event handler
      this.obs.on("MediaInputPlaybackEnded", mediaEndHandler);
    } catch (error) {
      logger.error(
        `Failed to play video in single scene: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      this.isTransitioning = false;
    }
  }

  /**
   * Clean up any old generated sources that might be left over
   */
  private async cleanupOldGeneratedSources(): Promise<void> {
    try {
      // Get all inputs
      const inputList = await this.obs.call("GetInputList");

      // Find and remove any sources that start with 'Generated_'
      for (const input of inputList.inputs) {
        const inputName = input.inputName;
        if (
          typeof inputName === "string" &&
          inputName.startsWith("Generated_")
        ) {
          try {
            await this.obs.call("RemoveInput", { inputName });
            logger.info(`Cleaned up old generated source: ${inputName}`);
          } catch (error) {
            logger.warn(
              `Failed to remove old source ${inputName}: ${
                error instanceof Error ? error.message : String(error)
              }`
            );
          }
        }
      }
    } catch (error) {
      logger.error(
        `Failed to clean up old sources: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Set up base video source with proper audio monitoring
   */
  private async setupBaseVideoSource(baseVideoPath: string): Promise<void> {
    try {
      const response = await this.obs.call("CreateInput", {
        sceneName: this.singleSceneName,
        inputName: this.baseSourceName,
        inputKind: "ffmpeg_source",
        inputSettings: {
          local_file: baseVideoPath,
          looping: true,
        },
      });

      // Set up audio monitoring for base video
      await this.obs.call("SetInputAudioMonitorType", {
        inputName: this.baseSourceName,
        monitorType: "OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT",
      });
      logger.info("Enabled audio monitoring for base video");

      if (response.sceneItemId) {
        // Set up initial transform for base video to center it in the scene
        try {
          // Get the canvas size from OBS
          const videoSettings = await this.obs.call("GetVideoSettings");
          const canvasWidth = videoSettings.baseWidth;
          const canvasHeight = videoSettings.baseHeight;

          logger.info(`OBS canvas size: ${canvasWidth}x${canvasHeight}`);

          // Create centered transform that fills the canvas while maintaining aspect ratio
          await this.obs.call("SetSceneItemTransform", {
            sceneName: this.singleSceneName,
            sceneItemId: response.sceneItemId,
            sceneItemTransform: {
              // Reset position to center
              positionX: 0,
              positionY: 0,
              // Maintain aspect ratio
              boundsType: "OBS_BOUNDS_SCALE_INNER",
              boundsWidth: canvasWidth,
              boundsHeight: canvasHeight,
              // Center alignment
              alignment: 5, // 5 is center (0-8, 0 is top-left, 8 is bottom-right)
              // Set bounds to match canvas
              bounds: {
                type: "OBS_BOUNDS_SCALE_INNER",
                x: canvasWidth,
                y: canvasHeight,
              },
            },
          });
          logger.info(`Set up initial transform for base video source`);
        } catch (error) {
          logger.warn(
            `Failed to set up initial transform: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }
    } catch (error) {
      logger.error(
        `Failed to setup base video source: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Copy filters and transform properties from one source to another
   * This ensures visual consistency between the base video and generated videos
   */
  private async copyFiltersAndProperties(
    fromSourceName: string,
    toSourceName: string
  ): Promise<void> {
    try {
      // Get filters from base source
      const filtersResult = await this.obs.call("GetSourceFilterList", {
        sourceName: fromSourceName,
      });

      // Get scene items for both sources
      const sourcesList = await this.obs.call("GetSceneItemList", {
        sceneName: this.singleSceneName,
      });

      const fromSourceItem = sourcesList.sceneItems.find(
        (item) => item.sourceName === fromSourceName
      );

      const toSourceItem = sourcesList.sceneItems.find(
        (item) => item.sourceName === toSourceName
      );

      if (!fromSourceItem || !toSourceItem) {
        logger.warn(`Could not find source items to copy properties`);
        return;
      }

      // Copy transform properties (position, size, crop, etc.)
      if (fromSourceItem.sceneItemId && toSourceItem.sceneItemId) {
        try {
          // Get the transform of the base source
          const sourceTransform = await this.obs.call("GetSceneItemTransform", {
            sceneName: this.singleSceneName,
            sceneItemId: Number(fromSourceItem.sceneItemId),
          });

          // Apply same transform to the generated source
          await this.obs.call("SetSceneItemTransform", {
            sceneName: this.singleSceneName,
            sceneItemId: Number(toSourceItem.sceneItemId),
            sceneItemTransform: sourceTransform.sceneItemTransform,
          });
          logger.info(
            `Copied transform properties from ${fromSourceName} to ${toSourceName}`
          );
        } catch (transformError) {
          logger.warn(
            `Failed to copy transform: ${
              transformError instanceof Error
                ? transformError.message
                : String(transformError)
            }`
          );

          // Fallback to a basic centered transform if copying fails
          try {
            // Get the canvas size from OBS
            const videoSettings = await this.obs.call("GetVideoSettings");
            const canvasWidth = videoSettings.baseWidth || 1920;
            const canvasHeight = videoSettings.baseHeight || 1080;

            await this.obs.call("SetSceneItemTransform", {
              sceneName: this.singleSceneName,
              sceneItemId: Number(toSourceItem.sceneItemId),
              sceneItemTransform: {
                positionX: 0,
                positionY: 0,
                alignment: 5, // Center
                boundsType: "OBS_BOUNDS_SCALE_INNER",
                boundsWidth: canvasWidth,
                boundsHeight: canvasHeight,
              },
            });
            logger.info(
              `Applied fallback centered transform to ${toSourceName}`
            );
          } catch (fallbackError) {
            logger.error(
              `Failed to apply fallback transform: ${
                fallbackError instanceof Error
                  ? fallbackError.message
                  : String(fallbackError)
              }`
            );
          }
        }
      }

      // Copy filters from base source to generated source
      if (
        filtersResult &&
        filtersResult.filters &&
        Array.isArray(filtersResult.filters)
      ) {
        let copiedFilterCount = 0;

        for (const filter of filtersResult.filters) {
          // Skip if filter properties are not valid
          if (!filter.filterName || !filter.filterKind) {
            continue;
          }

          const filterName = String(filter.filterName);
          const filterKind = String(filter.filterKind);

          try {
            // Get specific filter settings
            const filterSettings = await this.obs.call("GetSourceFilter", {
              sourceName: fromSourceName,
              filterName: filterName,
            });

            // Create the same filter on the generated source
            await this.obs.call("CreateSourceFilter", {
              sourceName: toSourceName,
              filterName: filterName,
              filterKind: filterKind,
              filterSettings: filterSettings.filterSettings || {},
            });

            // Set same filter enabled state (default to true if not specified)
            await this.obs.call("SetSourceFilterEnabled", {
              sourceName: toSourceName,
              filterName: filterName,
              filterEnabled: Boolean(filter.filterEnabled),
            });

            copiedFilterCount++;
          } catch (filterError) {
            logger.warn(
              `Failed to copy filter ${filterName}: ${
                filterError instanceof Error
                  ? filterError.message
                  : String(filterError)
              }`
            );
          }
        }

        logger.info(
          `Copied ${copiedFilterCount} filters from ${fromSourceName} to ${toSourceName}`
        );
      }
    } catch (error) {
      logger.warn(
        `Failed to copy properties: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  // Keeping these methods for backward compatibility, but they're no longer needed
  async switchToBaseScene(): Promise<boolean> {
    logger.info("Using single scene approach - no scene switching needed");
    return true;
  }

  async switchToGeneratedScene(): Promise<boolean> {
    logger.info("Using single scene approach - no scene switching needed");
    return true;
  }

  // Vision
  /**
   * Start capturing screenshots from a specific source
   * @param sourceName Name of the OBS source to capture (e.g. "Display Capture")
   * @param frequencyMs How often to capture screenshots in milliseconds
   * @returns Promise resolving to boolean indicating success
   */
  async startScreenshotCapture(
    sourceName: string,
    frequencyMs?: number
  ): Promise<boolean> {
    try {
      if (!this.connected) {
        throw new Error("Not connected to OBS");
      }

      // Verify the source exists
      const { scenes } = await this.obs.call("GetSceneList");

      const currentScene = scenes.find((scene: any) => scene.sceneName === this.currentScene);
      
      if (!currentScene) {
        throw new Error(`Current scene "${this.currentScene}" not found`);
      }

      const sources = await this.obs.call("GetSceneItemList", {
        sceneName: this.currentScene
      });

      const sourceExists = sources.sceneItems.some((item: any) => 
        item.sourceName === sourceName
      );

      if (!sourceExists) {
        throw new Error(`Source "${sourceName}" not found in current scene`);
      }

      // Stop any existing capture
      this.stopScreenshotCapture();

      this.isCapturingScreenshots = true;
      this.captureSourceName = sourceName;
      
      // Use provided frequency if specified, otherwise use the one from config
      if (frequencyMs !== undefined) {
        this.captureFrequencyMs = frequencyMs;
      }

      // Clear any existing interval
      if (this.screenshotInterval) {
        clearInterval(this.screenshotInterval);
      }
      
      // Create an interval to capture screenshots
      // Add debug logging to track interval creation
      logger.info(`Setting up screenshot interval with frequency ${this.captureFrequencyMs}ms`);
      this.screenshotInterval = setInterval(() => {
        logger.info(`Scheduled screenshot capture triggered at ${new Date().toISOString()}`);
        this.captureScreenshot().catch((error) => {
          logger.error(
            `Error capturing screenshot: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        });
      }, this.captureFrequencyMs);

      logger.info(
        `Started screenshot capture from source "${sourceName}" every ${this.captureFrequencyMs}ms`
      );

      // Only capture one immediately if we're not using the interval system
      // This prevents multiple screenshot sequences from starting
      logger.info(`Initial setup complete. First screenshot will be captured when interval triggers.`);

      return true;
    } catch (error) {
      logger.error(
        `Failed to start screenshot capture: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return false;
    }
  }

  /**
   * Stop capturing screenshots
   */
  stopScreenshotCapture(): void {
    if (this.screenshotInterval) {
      logger.info("Clearing existing screenshot capture interval");
      clearInterval(this.screenshotInterval);
      this.screenshotInterval = null;
    }

    this.isCapturingScreenshots = false;
    this.captureSourceName = null;
    logger.info("Stopped screenshot capture");
  }

  /**
   * Register a callback function that will be called when a new screenshot is captured
   * @param callback Function that will receive the path to the captured screenshot
   */
  onScreenshotCaptured(callback: (imagePath: string) => void): void {
    this.screenshotCallbacks.push(callback);
    logger.info("Registered new screenshot callback");
  }

  /**
   * Remove a previously registered screenshot callback
   * @param callback The callback function to remove
   */
  removeScreenshotCallback(callback: (imagePath: string) => void): void {
    const index = this.screenshotCallbacks.indexOf(callback);
    if (index !== -1) {
      this.screenshotCallbacks.splice(index, 1);
      logger.info("Removed screenshot callback");
    }
  }

  /**
   * Capture a single screenshot from the configured source
   * @returns Promise resolving to the path of the captured screenshot
   */
  private async captureScreenshot(): Promise<string> {
    if (!this.connected || !this.captureSourceName) {
      throw new Error("Not connected to OBS or no capture source configured");
    }

    try {
      // Double-check screenshot directory exists and create if needed
      if (!fs.existsSync(this.screenshotDirectory)) {
        fs.mkdirSync(this.screenshotDirectory, { recursive: true });
        logger.info(`Created screenshot directory at: ${this.screenshotDirectory}`);
      }

      // Generate filename based on timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `${this.captureSourceName}_${timestamp}.png`;
      const outputPath = path.resolve(path.join(this.screenshotDirectory, filename));
      logger.info(`Attempting to save screenshot to: ${outputPath}`);

      // Take the screenshot
      await this.obs.call("SaveSourceScreenshot", {
        sourceName: this.captureSourceName,
        imageFormat: "png",
        imageFilePath: outputPath
      });

      // Verify the screenshot was created
      if (!fs.existsSync(outputPath)) {
        throw new Error(`Screenshot file was not created at ${outputPath}`);
      }

      logger.info(
        `Successfully captured screenshot from "${this.captureSourceName}" to ${outputPath}`
      );

      // Notify callbacks
      this.screenshotCallbacks.forEach((callback) => {
        try {
          callback(outputPath);
        } catch (callbackError) {
          logger.error(
            `Error in screenshot callback: ${
              callbackError instanceof Error
                ? callbackError.message
                : String(callbackError)
            }`
          );
        }
      });

      return outputPath;
    } catch (error) {
      logger.error(
        `Screenshot capture failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      throw error;
    }
  }

  /**
   * Capture a single screenshot immediately (even if not in capture mode)
   * @param sourceName Name of source to capture from
   * @returns Promise resolving to the path of the captured screenshot
   */
  async captureOneScreenshot(sourceName: string): Promise<string> {
    const originalSourceName = this.captureSourceName;
    const wasCapturing = this.isCapturingScreenshots;

    try {
      // Temporarily set the capture source
      this.captureSourceName = sourceName;
      this.isCapturingScreenshots = true;

      // Capture a single screenshot
      const screenshotPath = await this.captureScreenshot();

      // Return to previous state
      this.captureSourceName = originalSourceName;
      this.isCapturingScreenshots = wasCapturing;

      return screenshotPath;
    } catch (error) {
      // Restore previous state in case of error
      this.captureSourceName = originalSourceName;
      this.isCapturingScreenshots = wasCapturing;
      throw error;
    }
  }

  // This is no longer used, but keeping for backward compatibility
  private async playNextPendingVideo(): Promise<void> {
    return this.playNextVideoInSingleScene();
  }

  // No longer used, but keeping for backward compatibility
  private async processAndPlayGeneratedVideo(videoPath: string): Promise<void> {
    logger.info(
      "Using single scene approach - redirecting to playNextVideoInSingleScene"
    );
    // Just redirect to the new method
    this.pendingVideoQueue.unshift(videoPath);
    await this.playNextVideoInSingleScene();
  }
}
