import { spawn } from 'child_process';
import { logger } from '../utils/logger';

export class VideoPlayer {
    private currentProcess: ReturnType<typeof spawn> | null = null;
    private isPlaying = false;
    private baseVideoPath: string;
    private baseVideoDuration: number = 0;
    private currentTime: number = 0;
    private timeUpdateInterval: NodeJS.Timer | null = null;

    constructor(baseVideoPath: string) {
        this.baseVideoPath = baseVideoPath;
        this.initializeBaseVideoDuration();
    }

    private async initializeBaseVideoDuration(): Promise<void> {
        return new Promise((resolve, reject) => {
            const probe = spawn('ffprobe', [
                '-v', 'error',
                '-show_entries', 'format=duration',
                '-of', 'default=noprint_wrappers=1:nokey=1',
                this.baseVideoPath
            ]);

            let output = '';
            probe.stdout.on('data', (data) => output += data.toString());

            probe.on('close', (code) => {
                if (code === 0) {
                    this.baseVideoDuration = parseFloat(output.trim());
                    logger.info(`Base video duration: ${this.baseVideoDuration} seconds`);
                    resolve();
                } else {
                    reject(new Error('Failed to get base video duration'));
                }
            });
        });
    }

    private async getVideoDuration(videoPath: string): Promise<number> {
        return new Promise((resolve, reject) => {
            const probe = spawn('ffprobe', [
                '-v', 'error',
                '-show_entries', 'format=duration',
                '-of', 'default=noprint_wrappers=1:nokey=1',
                videoPath
            ]);

            let output = '';
            probe.stdout.on('data', (data) => output += data.toString());

            probe.on('close', (code) => {
                if (code === 0) {
                    resolve(parseFloat(output.trim()));
                } else {
                    reject(new Error('Failed to get video duration'));
                }
            });
        });
    }

    private startTimeTracking(): void {
        if (this.timeUpdateInterval) {
            clearInterval(this.timeUpdateInterval as NodeJS.Timeout);
        }
        this.timeUpdateInterval = setInterval(() => {
            this.currentTime = (this.currentTime + 0.1) % this.baseVideoDuration;
        }, 100);
    }

    public async playVideo(videoPath: string, loop: boolean = false): Promise<void> {
        if (this.isPlaying) {
            await this.stop();
        }

        const args = [
            ...(loop ? ['-stream_loop', '-1'] : []),
            '-i', videoPath,
            '-vf', 'format=yuv420p',
            '-f', 'mpegts',
            'udp://127.0.0.1:1234'
        ];

        logger.info(`Starting video playback: ${videoPath}`);
        this.currentProcess = spawn('ffmpeg', args, {
            detached: true,        // Run in background
            stdio: 'ignore'        // Ignore stdio to prevent blocking
        });
        this.currentProcess.unref(); // Unreference from parent process

        this.isPlaying = true;

        // Return immediately to not block
        return Promise.resolve();
    }

    public async startBaseVideo(): Promise<void> {
        if (this.isPlaying) {
            await this.stop();
        }

        this.isPlaying = true;
        this.currentTime = 0;
        this.startTimeTracking();
        
        return this.playVideo(this.baseVideoPath, true);
    }

    public async playResponseVideo(responseVideoPath: string): Promise<void> {
        try {
            // Wait for base video to complete current loop
            const timeUntilEnd = this.baseVideoDuration - this.currentTime;
            if (timeUntilEnd > 0.1) {
                logger.info(`Waiting ${timeUntilEnd}s for base video loop to complete`);
                await new Promise(resolve => setTimeout(resolve, timeUntilEnd * 1000));
            }

            // Get response video duration
            const responseDuration = await this.getVideoDuration(responseVideoPath);
            logger.info(`Response video duration: ${responseDuration}s`);

            // Stop current playback
            await this.stop();

            // Play response video
            await this.playVideo(responseVideoPath);

            // Resume base video from the response video duration
            this.currentTime = responseDuration;
            await this.playVideo(this.baseVideoPath, true);

        } catch (error) {
            logger.error(`Error during video transition: ${error}`);
            // Ensure we return to base video
            await this.startBaseVideo();
        }
    }

    public async stop(): Promise<void> {
        if (this.currentProcess) {
            logger.info('Stopping current video playback');
            this.currentProcess.kill();
            this.currentProcess = null;
            this.isPlaying = false;

            if (this.timeUpdateInterval) {
                clearInterval(this.timeUpdateInterval as NodeJS.Timeout);
                this.timeUpdateInterval = null;
            }

            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
}
