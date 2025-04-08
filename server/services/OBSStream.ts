// OBS WebSocket service for controlling OBS scenes and sources
import OBSWebSocket from 'obs-websocket-js';
import { logger as loggerService } from '../utils/logger.ts';
import { MediaStreamService } from '../types/index.ts';
import { Config } from '../types/index.ts';
import path from 'path';
import fs from 'fs';

const logger = {
  info: (message: string) => {
    loggerService.info(message, MediaStreamService.OBS);
  },
  warn: (message: string) => {
    loggerService.warn(message, MediaStreamService.OBS);
  },
  error: (message: string) => { 
    loggerService.error(message, MediaStreamService.OBS);
  }
}

export class OBSStream {
  private obs: OBSWebSocket;
  private config: Config;
  private connected: boolean = false;
  private currentScene: string;
  private pendingVideoQueue: string[] = [];
  private isTransitioning: boolean = false;
  
  // New properties for single scene approach
  private singleSceneName: string = 'AI_Stream_Scene';
  private baseSourceName: string = 'Base_Video';
  private activeGeneratedSource: string | null = null;

  constructor(config: Config) {
    this.config = config;
    this.obs = new OBSWebSocket();
    this.currentScene = this.singleSceneName;
    
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
      logger.info(`Setting up single scene with base video: ${this.config.baseVideoPath}`);
      
      // Get list of scenes
      const scenes = await this.getSceneList();
      logger.info(`Found ${scenes.length} existing scenes in OBS`);
      
      // Check if our single scene exists
      const sceneExists = scenes.some(scene => 
        scene.sceneName === this.singleSceneName
      );

      if (!sceneExists) {
        logger.info(`Creating single scene: ${this.singleSceneName}`);
        await this.obs.call('CreateScene', { sceneName: this.singleSceneName });
        
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
      await this.obs.call('SetCurrentProgramScene', { 
        sceneName: this.singleSceneName 
      });
      
      this.currentScene = this.singleSceneName;
      logger.info(`Successfully switched to scene: ${this.singleSceneName}`);
      
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
   * Update the media source with a new video file
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
      
      // Process immediately if not transitioning
      if (!this.isTransitioning && this.pendingVideoQueue.length === 1) {
        await this.playNextVideoInSingleScene();
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
      
      logger.info(`Creating new video source in scene: ${this.singleSceneName}`);
      
      // Create the new source but set it with visible initially
      const response = await this.obs.call('CreateInput', {
        sceneName: this.singleSceneName,
        inputName: uniqueSourceName,
        inputKind: 'ffmpeg_source',
        inputSettings: {
          local_file: absoluteVideoPath,
          looping: false
        }
      });
      
      // Set up audio monitoring
      try {
        await this.obs.call('SetInputAudioMonitorType', {
          inputName: uniqueSourceName,
          monitorType: 'OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT'
        });
        logger.info(`Enabled audio monitoring for: ${uniqueSourceName}`);
      } catch (error) {
        logger.warn(`Failed to set audio monitoring: ${error instanceof Error ? error.message : String(error)}`);
      }
      
      // If we got a valid response with sceneItemId, center the source
      if (response && response.sceneItemId) {
        logger.info(`Centering source in scene with sceneItemId: ${response.sceneItemId}`);
        await this.centerSourceInScene(this.singleSceneName, uniqueSourceName, response.sceneItemId);
        
        // Store the active generated source name
        this.activeGeneratedSource = uniqueSourceName;
        
        // Find the base video source to hide it
        const sourcesList = await this.obs.call('GetSceneItemList', {
          sceneName: this.singleSceneName
        });
        
        const baseSource = sourcesList.sceneItems.find(item => 
          item.sourceName === this.baseSourceName
        );
        
        if (baseSource && baseSource.sceneItemId) {
          // Hide the base video
          await this.obs.call('SetSceneItemEnabled', {
            sceneName: this.singleSceneName,
            sceneItemId: Number(baseSource.sceneItemId),
            sceneItemEnabled: false
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
          logger.info(`Generated video ended: ${uniqueSourceName}, returning to base video`);
          
          // Find the sources again (they might have changed)
          const currentSourcesList = await this.obs.call('GetSceneItemList', {
            sceneName: this.singleSceneName
          });
          
          const baseSource = currentSourcesList.sceneItems.find(item => 
            item.sourceName === this.baseSourceName
          );
          
          // Show base video again
          if (baseSource && baseSource.sceneItemId) {
            await this.obs.call('SetSceneItemEnabled', {
              sceneName: this.singleSceneName,
              sceneItemId: Number(baseSource.sceneItemId),
              sceneItemEnabled: true
            });
            logger.info(`Showing base video again`);
          }
          
          // Clean up the generated source
          try {
            await this.obs.call('RemoveInput', { inputName: uniqueSourceName });
            logger.info(`Removed completed media source: ${uniqueSourceName}`);
          } catch (error) {
            logger.error(`Failed to remove source: ${error instanceof Error ? error.message : String(error)}`);
          }
          
          this.activeGeneratedSource = null;
          
          // Reset the base video if needed
          try {
            // Get current position of base video
            const mediaInfo = await this.obs.call('GetMediaInputStatus', { 
              inputName: this.baseSourceName 
            });
            logger.info(`Current base video state: ${JSON.stringify(mediaInfo)}`);
            
            // Restart base video playback
            await this.obs.call('TriggerMediaInputAction', {
              inputName: this.baseSourceName,
              mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY'
            });
            logger.info(`Resumed base video playback`);
          } catch (error) {
            logger.error(`Error resuming base video: ${error instanceof Error ? error.message : String(error)}`);
          }
          
          // Release transition lock
          this.isTransitioning = false;
          
          // Check for more pending videos
          if (this.pendingVideoQueue.length > 0) {
            logger.info(`${this.pendingVideoQueue.length} videos still pending in queue`);
            // Process next video after a short delay
            setTimeout(() => this.playNextVideoInSingleScene(), 500);
          }
          
          // Remove this specific event listener
          this.obs.off('MediaInputPlaybackEnded', mediaEndHandler);
        }
      };
      
      // Add the event handler
      this.obs.on('MediaInputPlaybackEnded', mediaEndHandler);
      
    } catch (error) {
      logger.error(`Failed to play video in single scene: ${error instanceof Error ? error.message : String(error)}`);
      this.isTransitioning = false;
    }
  }
  
  /**
   * Clean up any old generated sources that might be left over
   */
  private async cleanupOldGeneratedSources(): Promise<void> {
    try {
      // Get all inputs
      const inputList = await this.obs.call('GetInputList');
      
      // Find and remove any sources that start with 'Generated_'
      for (const input of inputList.inputs) {
        const inputName = input.inputName;
        if (typeof inputName === 'string' && inputName.startsWith('Generated_')) {
          try {
            await this.obs.call('RemoveInput', { inputName });
            logger.info(`Cleaned up old generated source: ${inputName}`);
          } catch (error) {
            logger.warn(`Failed to remove old source ${inputName}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
    } catch (error) {
      logger.error(`Failed to clean up old sources: ${error instanceof Error ? error.message : String(error)}`);
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

  /**
   * Set up base video source with proper audio monitoring
   */
  private async setupBaseVideoSource(baseVideoPath: string): Promise<void> {
    try {
      const response = await this.obs.call('CreateInput', {
        sceneName: this.singleSceneName,
        inputName: this.baseSourceName,
        inputKind: 'ffmpeg_source',
        inputSettings: {
          local_file: baseVideoPath,
          looping: true
        }
      });

      // Set up audio monitoring for base video
      await this.obs.call('SetInputAudioMonitorType', {
        inputName: this.baseSourceName,
        monitorType: 'OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT'
      });
      logger.info('Enabled audio monitoring for base video');

      if (response.sceneItemId) {
        await this.centerSourceInScene(this.singleSceneName, this.baseSourceName, response.sceneItemId);
      }
    } catch (error) {
      logger.error(`Failed to setup base video source: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Keeping these methods for backward compatibility, but they're no longer needed
  async switchToBaseScene(): Promise<boolean> {
    logger.info('Using single scene approach - no scene switching needed');
    return true;
  }
  
  async switchToGeneratedScene(): Promise<boolean> {
    logger.info('Using single scene approach - no scene switching needed');
    return true; 
  }
  
  // This is no longer used, but keeping for backward compatibility
  private async playNextPendingVideo(): Promise<void> {
    return this.playNextVideoInSingleScene();
  }
  
  // No longer used, but keeping for backward compatibility
  private async processAndPlayGeneratedVideo(videoPath: string): Promise<void> {
    logger.info('Using single scene approach - redirecting to playNextVideoInSingleScene');
    // Just redirect to the new method
    this.pendingVideoQueue.unshift(videoPath);
    await this.playNextVideoInSingleScene();
  }
}