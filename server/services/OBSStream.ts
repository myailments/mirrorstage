// OBS WebSocket service for controlling OBS scenes and sources
import OBSWebSocket from 'obs-websocket-js';
import { logger } from '../utils/logger.ts';
import { Config } from '../types/index.ts';
import path from 'path';
import fs from 'fs';

export class OBSStream {
  private obs: OBSWebSocket;
  private config: Config;
  private connected: boolean = false;
  private currentScene: string;
  private baseVideoTimePosition: number = 0;
  private baseVideoDuration: number = 0;
  private pendingVideoQueue: string[] = [];
  private isTransitioning: boolean = false;

  constructor(config: Config) {
    this.config = config;
    this.obs = new OBSWebSocket();
    this.currentScene = this.config.obsBaseSceneName;
    
    // Set up event handlers
    this.obs.on('ConnectionOpened', () => {
      logger.info('Connected to OBS WebSocket server');
      this.connected = true;
    });
    
    this.obs.on('ConnectionClosed', () => {
      logger.info('Disconnected from OBS WebSocket server');
      this.connected = false;
    });
    
    this.obs.on('ConnectionError', (err) => {
      logger.error(`OBS WebSocket connection error: ${err.message}`);
      this.connected = false;
      
      // Attempt to reconnect after a delay
      setTimeout(() => this.connect(), 5000);
    });
    
    // Add listener for all events to help with debugging
    this.obs.on('MediaInputPlaybackStarted', (data) => {
      logger.info(`Media playback started: ${JSON.stringify(data)}`);
    });
    
    this.obs.on('MediaInputPlaybackEnded', (data) => {
      logger.info(`Media playback ended: ${JSON.stringify(data)}`);
    });
    
    // Also subscribe to raw OBS WebSocket events for debugging
    this.obs.on('MediaInputActionTriggered', (data) => {
      logger.info(`Media action triggered: ${JSON.stringify(data)}`);
    });
    
    this.obs.on('CurrentProgramSceneChanged', (data) => {
      logger.info(`Scene changed: ${JSON.stringify(data)}`);
      // Update our current scene
      if (data && data.sceneName) {
        this.currentScene = data.sceneName;
      }
    });
    
    // Track base video time position
    this.obs.on('MediaInputPlaybackStarted', async (data) => {
      if (data.inputName === 'Base Video') {
        logger.info('Base video playback started');
      }
    });
    
    // This tracks the most recent video media time to detect loop completion
    let lastMediaTime = 0;
    
    // For base video, the key is to detect when it loops (time goes from high to low)
    // Continuously track the media position to detect loop points
    let consecutiveLoopChecks = 0;  // For more reliable loop detection
    let loopDetectionThreshold = 5; // Time jump must be larger than this to count as a loop
    
    setInterval(async () => {
      if (this.connected && this.currentScene === this.config.obsBaseSceneName) {
        try {
          // First check if the Base Video input actually exists
          const inputList = await this.obs.call('GetInputList');
          const baseVideoExists = inputList.inputs.some((input: any) => input.inputName === 'Base Video');
          
          if (!baseVideoExists) {
            logger.warn('Base Video input not found during loop detection');
            lastMediaTime = 0; // Reset the media time tracking
            return; // Skip this cycle
          }
          
          const mediaInfo = await this.obs.call('GetMediaInputStatus', { inputName: 'Base Video' });

          const currentMediaTime = mediaInfo.mediaCursor || 0;
          const isPlaying = mediaInfo.mediaState === 'OBS_MEDIA_STATE_PLAYING';
          
          // Store video duration if available
          if (mediaInfo.mediaDuration) {
            this.baseVideoDuration = mediaInfo.mediaDuration;
          }
          
          // Store current position
          this.baseVideoTimePosition = currentMediaTime;
          
          // More robust loop detection with additional checks
          if (isPlaying && lastMediaTime > loopDetectionThreshold && 
              currentMediaTime < lastMediaTime - loopDetectionThreshold && 
              this.pendingVideoQueue.length > 0 && !this.isTransitioning) {
            
            // To avoid false positives, count consecutive detections
            consecutiveLoopChecks++;
            
            // Log only on the first detection to avoid log spam
            if (consecutiveLoopChecks === 1) {
              logger.info(`Potential loop detected! Base video time jumped from ${lastMediaTime.toFixed(2)}s to ${currentMediaTime.toFixed(2)}s`);
              await this.playNextPendingVideo();

            }
            
            // Only trigger transition after multiple consecutive detections
            if (consecutiveLoopChecks >= 2) {
              logger.info(`Loop confirmed! Base video restarted from ${lastMediaTime.toFixed(2)}s to ${currentMediaTime.toFixed(2)}s`);
              logger.info('Base video loop completed, transitioning to generated video');
              await this.playNextPendingVideo();
              consecutiveLoopChecks = 0; // Reset counter
            }
          } else {
            consecutiveLoopChecks = 0; // Reset if no jump detected
          }
          
          // Special case: also check if we're near the end of the video and almost looping
          if (isPlaying && this.baseVideoDuration > 0 && 
              lastMediaTime > 0 && 
              this.baseVideoDuration - lastMediaTime < 0.5 && 
              currentMediaTime < 0.5 && 
              this.pendingVideoQueue.length > 0 && !this.isTransitioning) {
            logger.info(`End-of-video detection: Base video transitioning from ${lastMediaTime.toFixed(2)}s to ${currentMediaTime.toFixed(2)}s (duration: ${this.baseVideoDuration.toFixed(2)}s)`);
            logger.info('Base video near loop point, transitioning to generated video');
            await this.playNextPendingVideo();
          }
          
          lastMediaTime = currentMediaTime;
        } catch (error) {
          // Silent fail, but reset media time tracking if errors persist
          if (error instanceof Error && error.message.includes('not found')) {
            lastMediaTime = 0;
          }
        }
      } else {
        // Reset time tracking when we're not on the base scene
        lastMediaTime = 0;
        consecutiveLoopChecks = 0;
      }
    }, 100); // Check more frequently (reduced from 500ms to 200ms)
    
    // Handle playback end events for the base video as backup
    this.obs.on('MediaInputPlaybackEnded', async (data) => {
      if (data.inputName === 'Base Video' && this.pendingVideoQueue.length > 0 && !this.isTransitioning) {
        // Base video just finished, this is a good time to transition
        logger.info('Base video ended event, transitioning to generated video');
        await this.playNextPendingVideo();
      }
    });
  }

  /**
   * Connect to OBS WebSocket server
   */
  async connect(): Promise<boolean> {
    try {
      const { obsWebSocketHost, obsWebSocketPort, obsWebSocketPassword } = this.config;
      
      // Format the connection URL properly
      const url = `ws://${obsWebSocketHost}:${obsWebSocketPort}`;
      logger.info(`Attempting to connect to OBS WebSocket at: ${url}`);
      
      // Connect to OBS WebSocket server with v5 API
      await this.obs.connect(url, obsWebSocketPassword);
      logger.info('Connected to OBS WebSocket server');
      this.connected = true;
      
      // Get OBS version information for debugging
      try {
        const versionInfo = await this.obs.call('GetVersion');
        logger.info(`Connected to OBS Studio version ${versionInfo.obsVersion} with WebSocket version ${versionInfo.obsWebSocketVersion}`);
        
        // Log additional version details for debugging
        logger.info(`OBS platform: ${versionInfo.platform}, RPC version: ${versionInfo.rpcVersion}`);
        
        // Check if WebSocket version is compatible (we need v5)
        const wsVersion = parseInt(versionInfo.obsWebSocketVersion.split('.')[0]);
        if (wsVersion < 5) {
          logger.warn(`WARNING: OBS WebSocket version ${versionInfo.obsWebSocketVersion} detected. This integration requires v5.x or higher.`);
        }
      } catch (versionError) {
        logger.warn(`Could not retrieve OBS version information: ${versionError instanceof Error ? versionError.message : String(versionError)}`);
      }
      
      // Create or switch to a dedicated scene collection
      await this.createSceneCollection();
      
      // Check if scenes and sources exist, create them if not
      await this.setupScenes();
      
      return true;
    } catch (error) {
      logger.error(`Failed to connect to OBS: ${error instanceof Error ? error.message : String(error)}`);
      this.connected = false;
      
      // If error contains specific information about version incompatibility, log it clearly
      if (error instanceof Error && error.message.includes('socket version')) {
        logger.error('ERROR: OBS WebSocket version incompatibility detected. Please ensure OBS Studio has WebSocket v5.x installed.');
        logger.error('You can download the correct plugin from: https://github.com/obsproject/obs-websocket/releases');
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
      const sceneCollectionName = 'AI_Streamer';
      
      // Try to get the current collections
      let collections: string[] = [];
      try {
        const result = await this.obs.call('GetSceneCollectionList');
        collections = result.sceneCollections || [];
        logger.info(`Found ${collections.length} scene collections in OBS`);
      } catch (error) {
        logger.warn(`Could not get scene collections: ${error instanceof Error ? error.message : String(error)}`);
      }
      
      // Check if our collection already exists
      const collectionExists = collections.includes(sceneCollectionName);
      
      if (!collectionExists) {
        // Create a new scene collection
        logger.info(`Creating new scene collection: ${sceneCollectionName}`);
        try {
          await this.obs.call('CreateSceneCollection', { sceneCollectionName });
          logger.info(`New scene collection created: ${sceneCollectionName}`);
        } catch (error) {
          logger.error(`Failed to create scene collection: ${error instanceof Error ? error.message : String(error)}`);
        }
      } else {
        // Switch to existing collection
        logger.info(`Switching to existing scene collection: ${sceneCollectionName}`);
        try {
          await this.obs.call('SetCurrentSceneCollection', { sceneCollectionName });
          logger.info(`Switched to scene collection: ${sceneCollectionName}`);
        } catch (error) {
          logger.error(`Failed to switch scene collection: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      
      // Wait for scene collection change to complete (OBS needs a moment)
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (error) {
      logger.error(`Error setting up scene collection: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Check if the necessary scenes and sources exist in OBS, create them if not
   */
  private async setupScenes(): Promise<void> {
    try {
      // Log to help debug OBS connection details
      logger.info(`Setting up OBS scenes with base video: ${this.config.baseVideoPath}`);
      
      // Get list of scenes
      const scenes = await this.getSceneList();
      logger.info(`Found ${scenes.length} existing scenes in OBS`);
      
      // Check if base scene exists
      const baseSceneExists = scenes.some(scene => 
        scene.sceneName === this.config.obsBaseSceneName
      );
      
      if (!baseSceneExists) {
        logger.info(`Creating base scene: ${this.config.obsBaseSceneName}`);
        await this.obs.call('CreateScene', { sceneName: this.config.obsBaseSceneName });
        
        // Add base video source to base scene
        const baseVideoPath = path.resolve(this.config.baseVideoPath);
        if (fs.existsSync(baseVideoPath)) {
          logger.info(`Adding base video source to base scene: ${baseVideoPath}`);
          
          // Create the media source
          const response = await this.obs.call('CreateInput', {
            sceneName: this.config.obsBaseSceneName,
            inputName: 'Base Video',
            inputKind: 'ffmpeg_source',
            inputSettings: {
              local_file: baseVideoPath,
              looping: true
            }
          });
          
          // Center the source in the canvas
          await this.centerSourceInScene(this.config.obsBaseSceneName, 'Base Video', response.sceneItemId);
        } else {
          logger.error(`Base video file not found: ${baseVideoPath}`);
        }
      }
      
      // Get updated scene list
      const updatedScenes = await this.getSceneList();
      
      // Check if generated scene exists
      const generatedSceneExists = updatedScenes.some(scene => 
        scene.sceneName === this.config.obsGeneratedSceneName
      );
      
      if (!generatedSceneExists) {
        logger.info(`Creating generated scene: ${this.config.obsGeneratedSceneName}`);
        await this.obs.call('CreateScene', { sceneName: this.config.obsGeneratedSceneName });
      }
      
      // Switch to base scene
      await this.switchToBaseScene();
      
    } catch (error) {
      logger.error(`Failed to setup OBS scenes: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Helper method to get scene list
   */
  private async getSceneList(): Promise<any[]> {
    try {
      const result = await this.obs.call('GetSceneList');
      return result.scenes || [];
    } catch (error) {
      logger.error(`Failed to get scene list: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }
  
  /**
   * Update the media source in the generated scene with the new video file
   */
  async updateGeneratedVideoSource(videoPath: string): Promise<boolean> {
    if (!this.connected) {
      logger.warn('OBS WebSocket not connected, cannot update video source');
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
      logger.info(`Added video to queue: ${absoluteVideoPath} (queue size: ${this.pendingVideoQueue.length})`);
      
      // Wait for the base video to complete its loop before transitioning
      if (this.pendingVideoQueue.length === 1) {
        logger.info(`First video in queue - will transition at next loop point`);
        
        // Log current position relative to loop point
        if (this.currentScene === this.config.obsBaseSceneName && this.baseVideoDuration > 0) {
          const timeUntilEnd = Math.max(0, this.baseVideoDuration - this.baseVideoTimePosition);
          logger.info(`Base video at ${this.baseVideoTimePosition.toFixed(2)}s, approximately ${timeUntilEnd.toFixed(2)}s until loop completion`);
        }
      } else {
        // Log queue status
        if (this.isTransitioning) {
          logger.info(`Already transitioning, video queued for later playback`);
        } else if (this.pendingVideoQueue.length > 1) {
          logger.info(`Added to queue, will play after ${this.pendingVideoQueue.length - 1} other videos`);
        }
      }
      
      return true;
    } catch (error) {
      logger.error(`Failed to queue video: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
  
  /**
   * Switch to the base scene
   */
  async switchToBaseScene(): Promise<boolean> {
    if (!this.connected) {
      logger.warn('OBS WebSocket not connected, cannot switch scenes');
      return false;
    }
    
    logger.info(`Attempting to switch to base scene: ${this.config.obsBaseSceneName}`);
    
    try {
      // Check if scene exists first
      const scenes = await this.getSceneList();
      const sceneExists = scenes.some(scene => 
        scene.sceneName === this.config.obsBaseSceneName
      );
      
      if (!sceneExists) {
        logger.error(`Base scene ${this.config.obsBaseSceneName} does not exist in OBS!`);
        
        // Try to recreate the scene as a recovery mechanism
        logger.info(`Attempting to recreate base scene`);
        await this.obs.call('CreateScene', { sceneName: this.config.obsBaseSceneName });
        
        // Add base video source to base scene
        const baseVideoPath = path.resolve(this.config.baseVideoPath);
        if (fs.existsSync(baseVideoPath)) {
          await this.obs.call('CreateInput', {
            sceneName: this.config.obsBaseSceneName,
            inputName: 'Base Video',
            inputKind: 'ffmpeg_source',
            inputSettings: {
              local_file: baseVideoPath,
              looping: true
            }
          });
        }
      }
      
      // Switch to the scene
      await this.obs.call('SetCurrentProgramScene', { 
        sceneName: this.config.obsBaseSceneName 
      });
      
      this.currentScene = this.config.obsBaseSceneName;
      logger.info(`Successfully switched to base scene: ${this.config.obsBaseSceneName}`);
      
      return true;
    } catch (error) {
      logger.error(`Failed to switch to base scene: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
  
  /**
   * Switch to the generated scene
   */
  async switchToGeneratedScene(): Promise<boolean> {
    if (!this.connected) {
      logger.warn('OBS WebSocket not connected, cannot switch scenes');
      return false;
    }
    
    logger.info(`Attempting to switch to generated scene: ${this.config.obsGeneratedSceneName}`);
    
    try {
      // Check if scene exists first
      const scenes = await this.getSceneList();
      const sceneExists = scenes.some(scene => 
        scene.sceneName === this.config.obsGeneratedSceneName
      );
      
      if (!sceneExists) {
        logger.error(`Generated scene ${this.config.obsGeneratedSceneName} does not exist in OBS!`);
        
        // Try to recreate the scene as a recovery mechanism
        logger.info(`Attempting to recreate generated scene`);
        await this.obs.call('CreateScene', { sceneName: this.config.obsGeneratedSceneName });
      }
      
      // Switch to the scene
      await this.obs.call('SetCurrentProgramScene', { 
        sceneName: this.config.obsGeneratedSceneName 
      });
      
      this.currentScene = this.config.obsGeneratedSceneName;
      logger.info(`Successfully switched to generated scene: ${this.config.obsGeneratedSceneName}`);
      
      return true;
    } catch (error) {
      logger.error(`Failed to switch to generated scene: ${error instanceof Error ? error.message : String(error)}`);
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
        this.obs.off('ConnectionOpened');
        this.obs.off('ConnectionClosed');
        this.obs.off('ConnectionError');
        this.obs.off('MediaInputPlaybackEnded');
        
        await this.obs.disconnect();
        this.connected = false;
        logger.info('Disconnected from OBS WebSocket server');
      } catch (error) {
        logger.error(`Error disconnecting from OBS: ${error instanceof Error ? error.message : String(error)}`);
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
   * Play the next pending video from the queue
   */
  private async playNextPendingVideo(): Promise<void> {
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
      // Process and play the video
      await this.processAndPlayGeneratedVideo(nextVideoPath);
    } catch (error) {
      logger.error(`Failed to play next pending video: ${error instanceof Error ? error.message : String(error)}`);
      this.isTransitioning = false;
    }
  }
  
  /**
   * Process and play a generated video, handling all scene transitions
   */
  private async processAndPlayGeneratedVideo(videoPath: string): Promise<void> {
    const absoluteVideoPath = path.resolve(videoPath);
    
    if (!fs.existsSync(absoluteVideoPath)) {
      logger.error(`Video file not found: ${absoluteVideoPath}`);
      this.isTransitioning = false;
      return;
    }
    
    // Generate a unique source name for this video
    const videoFilename = path.basename(videoPath);
    const uniqueSourceName = `Generated_${Date.now()}_${videoFilename}`;
    
    try {
      // Make sure generated scene exists
      const scenes = await this.getSceneList();
      const sceneExists = scenes.some(scene => 
        scene.sceneName === this.config.obsGeneratedSceneName
      );
      
      if (!sceneExists) {
        logger.info(`Recreating generated scene before adding video source`);
        await this.obs.call('CreateScene', { sceneName: this.config.obsGeneratedSceneName });
      }
      
      logger.info(`Creating media source in generated scene: ${this.config.obsGeneratedSceneName}`);
      
      // Create a new media source in the generated scene
      const response = await this.obs.call('CreateInput', {
        sceneName: this.config.obsGeneratedSceneName,
        inputName: uniqueSourceName,
        inputKind: 'ffmpeg_source',
        inputSettings: {
          local_file: absoluteVideoPath,
          looping: false
        }
      });
      
      // If we got a valid response with sceneItemId, center the source
      if (response && response.sceneItemId) {
        logger.info(`Centering source in scene with sceneItemId: ${response.sceneItemId}`);
        await this.centerSourceInScene(this.config.obsGeneratedSceneName, uniqueSourceName, response.sceneItemId);
      } else {
        logger.warn(`Could not get sceneItemId, skipping centering`);
      }
      
      logger.info(`Created new media source: ${uniqueSourceName}`);
      
      // Set up a one-time listener for when the generated video ends
      const mediaEndHandler = async (data: any) => {
        if (data.inputName === uniqueSourceName) {
          logger.info(`Generated video ended: ${uniqueSourceName}, returning to base scene`);
          
          let endTime = 0;
          
          // Get the duration of the generated video
          try {
            const mediaInfo = await this.obs.call('GetMediaInputStatus', { inputName: uniqueSourceName });
            endTime = mediaInfo.mediaDuration || 0;
            logger.info(`Video duration: ${endTime}s`);
          } catch (error) {
            logger.error(`Failed to get generated video duration: ${error instanceof Error ? error.message : String(error)}`);
            // Continue with default time 0
          }
          
          // Switch back to base scene
          const success = await this.switchToBaseScene();
          
          if (success) {
            // Set the base video time to continue from where the generated video ended
            try {
              // Give a moment for scene switch to complete
              setTimeout(async () => {
                // We'll try a more robust approach to seeking
                // First, ensure we're getting the media input properties to verify it exists
                try {
                  const mediaInfo = await this.obs.call('GetMediaInputStatus', { inputName: 'Base Video' });
                  logger.info(`Current base video state: ${JSON.stringify(mediaInfo)}`);
                  
                  
                  await this.obs.call('SetInputSettings', {
                    inputName: 'Base Video',
                    inputSettings: {
                      cursor_position: 10
                    }
                  });
                  logger.info(`Set base video cursor_position to ${endTime}s`);
                  
                  // Allow time for position to be set (increased from 100ms to 500ms)
                  
                  // Step 3: Play the video from the new position
                  await this.obs.call('TriggerMediaInputAction', {
                    inputName: 'Base Video',
                    mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY'
                  });
                  logger.info(`Restarted base video at position ${endTime}s`);
    
                  
                } catch (seekError) {
                  logger.error(`Failed to set video position: ${seekError instanceof Error ? seekError.message : String(seekError)}`);
                  return;
                }
                
                // Release transition lock
                this.isTransitioning = false;
                
                // Check for more pending videos
                if (this.pendingVideoQueue.length > 0) {
                  logger.info(`${this.pendingVideoQueue.length} videos still pending in queue`);
                }
              }, 1000); // Longer delay to ensure scene switch is complete
            } catch (error) {
              logger.error(`Failed during scene transition: ${error instanceof Error ? error.message : String(error)}`);
              this.isTransitioning = false;
            }
          } else {
            logger.error(`Scene switch failed, releasing transition lock`);
            this.isTransitioning = false;
          }
          
          // Clean up by removing this source
          setTimeout(async () => {
            try {
              await this.obs.call('RemoveInput', { inputName: uniqueSourceName });
              logger.info(`Removed completed media source: ${uniqueSourceName}`);
            } catch (error) {
              logger.error(`Failed to remove source: ${error instanceof Error ? error.message : String(error)}`);
            }
          }, 2000); // Longer delay to ensure removal happens after everything else
          
          // Remove this specific event listener
          this.obs.off('MediaInputPlaybackEnded', mediaEndHandler);
        }
      };
      
      // Add the event handler
      this.obs.on('MediaInputPlaybackEnded', mediaEndHandler);
      
      // Switch to the generated scene with a short delay to ensure media is ready
      setTimeout(async () => {
        const success = await this.switchToGeneratedScene();
        if (success) {
          logger.info(`Successfully switched to generated scene and now playing video: ${videoPath}`);
        } else {
          logger.error(`Failed to switch to generated scene, but media source was created`);
          this.isTransitioning = false;
        }
      }, 500);
      
    } catch (error) {
      logger.error(`Failed to process generated video: ${error instanceof Error ? error.message : String(error)}`);
      this.isTransitioning = false;
    }
  }
  
  /**
   * Center a source in the scene and fit it to canvas size
   */
  private async centerSourceInScene(sceneName: string, sourceName: string, sceneItemId: number): Promise<void> {
    try {
      // First, get the canvas size from OBS
      const videoSettings = await this.obs.call('GetVideoSettings');
      const canvasWidth = videoSettings.baseWidth;
      const canvasHeight = videoSettings.baseHeight;
      
      logger.info(`OBS canvas size: ${canvasWidth}x${canvasHeight}`);
      
      // Get source's native size
      const sceneItemTransform = await this.obs.call('GetSceneItemTransform', {
        sceneName: sceneName,
        sceneItemId: sceneItemId
      });
      
      // Create centered transform that fills the canvas while maintaining aspect ratio
      await this.obs.call('SetSceneItemTransform', {
        sceneName: sceneName,
        sceneItemId: sceneItemId,
        sceneItemTransform: {
          // Reset position to center
          positionX: 0,
          positionY: 0,
          // Maintain aspect ratio
          boundsType: 'OBS_BOUNDS_SCALE_INNER',
          boundsWidth: canvasWidth,
          boundsHeight: canvasHeight,
          // Center alignment
          alignment: 5, // 5 is center (0-8, 0 is top-left, 8 is bottom-right)
          // Set bounds to match canvas
          bounds: {
            type: 'OBS_BOUNDS_SCALE_INNER',
            x: canvasWidth,
            y: canvasHeight
          }
        }
      });
      
      logger.info(`Centered source "${sourceName}" in scene "${sceneName}"`);
    } catch (error) {
      logger.warn(`Failed to center source: ${error instanceof Error ? error.message : String(error)}`);
      
      // Try alternative approach if the first one fails
      try {
        // Set alignment to center and scale to fit the canvas
        await this.obs.call('SetSceneItemTransform', {
          sceneName: sceneName,
          sceneItemId: sceneItemId,
          sceneItemTransform: {
            alignment: 5, // Center
            positionX: 0,
            positionY: 0,
            scale: {
              x: 1.0,
              y: 1.0
            }
          }
        });
        
        logger.info(`Used alternative method to center "${sourceName}" in scene "${sceneName}"`);
      } catch (altError) {
        logger.error(`Failed alternative centering: ${altError instanceof Error ? altError.message : String(altError)}`);
      }
    }
  }
}