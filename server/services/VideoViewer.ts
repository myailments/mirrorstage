import { spawn } from 'child_process';
import { logger } from '../utils/logger';

export enum VideoPlayerType {
    FFPLAY = 'ffplay',
    VLC = 'vlc',
    MPV = 'mpv'
}

export class VideoViewer {
    private process: ReturnType<typeof spawn> | null = null;
    private playerType: VideoPlayerType;

    constructor(playerType: VideoPlayerType = VideoPlayerType.FFPLAY) {
        this.playerType = playerType;
    }

    public start(): void {
        const args = this.getPlayerArgs();
        
        logger.info(`Starting video viewer using ${this.playerType}`);
        this.process = spawn(this.playerType, args, {
            detached: true,        // Run in background
            stdio: 'ignore'        // Ignore stdio to prevent blocking
        });
        this.process.unref();     // Unreference from parent process

        this.process.on('error', (error) => {
            logger.error(`${this.playerType} error: ${error}`);
            if (error.message.includes('ENOENT')) {
                logger.error(`${this.playerType} not found. Please install it first.`);
            }
        });

        // this.process.stderr?.on('data', (data) => {
        //     logger.info(`${this.playerType} output: ${data.toString()}`);
        // });
    }

    private getPlayerArgs(): string[] {
        const streamUrl = 'udp://127.0.0.1:1234';
        
        switch (this.playerType) {
            case VideoPlayerType.FFPLAY:
                return [
                    '-f', 'mpegts',
                    '-i', streamUrl,
                    '-window_title', 'AI Response System',
                    '-noborder',
                    '-alwaysontop',
                    '-x', '800',
                    '-y', '600'
                ];
            
            case VideoPlayerType.VLC:
                return [
                    streamUrl,
                    '--no-video-title-show',
                    '--video-on-top',
                    '--width=800',
                    '--height=600'
                ];
            
            case VideoPlayerType.MPV:
                return [
                    streamUrl,
                    '--title=AI Response System',
                    '--ontop',
                    '--geometry=800x600'
                ];
        }
    }

    public stop(): void {
        if (this.process) {
            this.process.kill();
            this.process = null;
        }
    }
}