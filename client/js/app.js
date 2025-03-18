// Configuration
let API_BASE_URL;
try {
    API_BASE_URL = process.env.BASE_URL || window.location.origin;
    console.log('API_BASE_URL:', API_BASE_URL);
} catch (error) {
    console.error('Error setting API_BASE_URL:', error);
    API_BASE_URL = window.location.origin; // fallback to current origin
}

const USER_ID = 'user_' + Math.floor(Math.random() * 10000); // Random user ID
const POLL_INTERVAL = 2000; // 2 seconds

// DOM Elements
const videoPlayer = document.getElementById('videoPlayer');
const currentVideo = document.getElementById('current-video');
const originalMessage = document.getElementById('original-message');
const generatedResponse = document.getElementById('generated-response');
const connectionStatus = document.getElementById('connection-status');
const queueStatus = document.getElementById('queue-status');
const messagesContainer = document.getElementById('messages');
const userInput = document.getElementById('userInput');
const sendButton = document.getElementById('sendButton');

// Add this right after the DOM elements to verify they're found
if (!userInput || !sendButton) {
    console.error('Critical UI elements not found:', {
        userInput: !!userInput,
        sendButton: !!sendButton
    });
}


// State
let currentlyPlaying = 'base-video';
let isCheckingVideo = false;
let lastVideoCheck = Date.now();

// Add message tracking state
let messageCounter = 0;
const pendingMessages = new Set();

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    console.log('DOM Content Loaded');
    
    // Re-query elements to be safe
    const userInput = document.getElementById('userInput');
    const sendButton = document.getElementById('sendButton');
    
    if (!userInput || !sendButton) {
        console.error('Critical UI elements not found on DOMContentLoaded');
        return;
    }
    
    // Set up event listeners
    userInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            const now = Date.now();
            if (now - lastMessageTime >= MIN_MESSAGE_INTERVAL) {
                lastMessageTime = now;
                sendMessage();
            }
        }
    });
    
    sendButton.addEventListener('click', () => {
        const now = Date.now();
        if (now - lastMessageTime >= MIN_MESSAGE_INTERVAL) {
            lastMessageTime = now;
            console.log('Send button clicked');
            sendMessage();
        }
    });
    
    // Initialize video player with base video
    try {
        await ensureBaseVideoPlaying();
    } catch (error) {
        console.error('Error initializing base video:', error);
    }
    
    // Start polling
    checkServerHealth();
    setInterval(checkServerHealth, POLL_INTERVAL * 2);
    setInterval(checkForNewVideos, POLL_INTERVAL);
});

// Update the queue status display to show processing information
function updateQueueStatus(data) {
    if (!data.queueMetrics) {
        queueStatus.textContent = 'Queue status unavailable';
        return;
    }
    
    const metrics = data.queueMetrics;
    queueStatus.innerHTML = `
        Videos ready: ${metrics.videosReady || 0} | 
        Waiting in queue: ${metrics.waitingInQueue || 0} | 
        Currently processing: ${metrics.currentlyProcessing || 0}/${metrics.maxConcurrent || 3}
    `;
}

// Update the checkServerHealth function to show more detailed status
async function checkServerHealth() {
    try {
        const response = await fetch(`${API_BASE_URL}/health`);
        
        if (!response.ok) {
            throw new Error('Server not responding');
        }
        
        const data = await response.json();
        
        connectionStatus.textContent = `Connected to server (${new Date().toLocaleTimeString()})`;
        connectionStatus.style.color = 'green';
        
        // Update queue status with new metrics format
        updateQueueStatus(data);
        
        // If we're showing the base video, make sure it's actually playing
        if (currentlyPlaying === 'base-video') {
            ensureBaseVideoPlaying();
        }
    } catch (error) {
        connectionStatus.textContent = 'Disconnected from server';
        connectionStatus.style.color = 'red';
        console.error('Server health check error:', error);
    }
}

// Add input rate limiting (optional, to prevent spam)
let lastMessageTime = 0;
const MIN_MESSAGE_INTERVAL = 500; // Minimum 500ms between messages

// Update the sendMessage function to handle concurrent sends
async function sendMessage() {
    console.log('sendMessage called');
    const message = userInput.value.trim();
    
    if (!message) {
        console.log('No message to send');
        return;
    }
    
    // Generate unique message ID
    const messageId = `msg_${messageCounter++}`;
    
    console.log('Attempting to send message:', message);
    // Don't disable input anymore - allow multiple messages
    // userInput.disabled = true;
    // sendButton.disabled = true;
    
    // Clear input immediately to allow next message
    userInput.value = '';
    
    // Add message to UI
    addMessage(message, 'user', messageId);
    
    // Track this message
    pendingMessages.add(messageId);
    
    try {
        // Send to API
        const response = await fetch(`${API_BASE_URL}/input`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                userId: USER_ID,
                message: message,
                messageId: messageId
            }),
        });
        
        if (!response.ok) {
            throw new Error('Failed to send message');
        }
        
        const data = await response.json();
        
        // Enhanced status message showing processing information
        let statusMessage = `Message received. `;
        if (data.queuePosition > 0) {
            statusMessage += `You are #${data.queuePosition} in queue. `;
        }
        if (data.activeProcessing) {
            statusMessage += `Currently processing ${data.activeProcessing} responses.`;
        }
        
        // Add system confirmation with enhanced status
        addMessage(statusMessage, 'ai', null, messageId);
        
    } catch (error) {
        console.error('Error sending message:', error);
        addMessage('Failed to send message. Please try again.', 'ai', null, messageId);
    } finally {
        pendingMessages.delete(messageId);
        userInput.focus();
    }
}

// Update addMessage to handle message tracking
function addMessage(text, type = 'user', messageId = null, replyToId = null) {
    const messageElement = document.createElement('div');
    messageElement.className = `message ${type === 'user' ? 'user-message' : 'ai-message'}`;
    
    if (messageId) {
        messageElement.setAttribute('data-message-id', messageId);
    }
    
    if (replyToId) {
        messageElement.setAttribute('data-reply-to', replyToId);
    }
    
    // Create message content wrapper
    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'message-content';
    contentWrapper.textContent = text;
    
    // Add processing indicator if it's a user message that's pending
    if (type === 'user' && pendingMessages.has(messageId)) {
        messageElement.classList.add('processing');
    }
    
    const timestampElement = document.createElement('div');
    timestampElement.className = 'message-timestamp';
    timestampElement.textContent = formatTime(new Date());
    
    messageElement.appendChild(contentWrapper);
    messageElement.appendChild(timestampElement);
    messagesContainer.appendChild(messageElement);
    
    // Scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Format time
function formatTime(date) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Check for new videos
async function checkForNewVideos() {
    if (isCheckingVideo || Date.now() - lastVideoCheck < 5000) {
        return;
    }
    
    isCheckingVideo = true;
    lastVideoCheck = Date.now();
    
    try {
        const response = await fetch(`${API_BASE_URL}/next-video`);
        
        if (!response.ok) {
            if (response.status !== 404) {
                console.error('Error checking for videos:', response.statusText);
            }
            // If no videos or error, ensure base video is playing
            if (currentlyPlaying === 'base-video') {
                await ensureBaseVideoPlaying();
            }
            return;
        }
        
        const videoData = await response.json();
        
        // Don't play the same video again
        if (currentlyPlaying === videoData.videoPath) {
            return;
        }
        
        // We have a new video to play
        await playNextVideo(videoData);
    } catch (error) {
        console.error('Error checking for videos:', error);
        // On error, ensure base video is playing
        if (currentlyPlaying === 'base-video') {
            await ensureBaseVideoPlaying();
        }
    } finally {
        isCheckingVideo = false;
    }
}

// Play the next video
async function playNextVideo(videoData) {
    console.log('Playing next video:', videoData);
    
    // Update UI first
    currentVideo.textContent = `Response to ${videoData.userId}`;
    originalMessage.textContent = `Question: ${videoData.originalMessage}`;
    generatedResponse.textContent = `Response: ${videoData.generatedText}`;
    
    try {
        // Load and play the new video
        videoPlayer.src = `${API_BASE_URL}/video/${videoData.videoPath}`;
        videoPlayer.loop = false;
        videoPlayer.muted = false;
        
        // Keep track of what we're playing
        currentlyPlaying = videoData.videoPath;
        
        // Play the video
        await videoPlayer.play();
        
        // Mark as streamed on the server
        await fetch(`${API_BASE_URL}/stream/${videoData.videoPath}`, {
            method: 'POST'
        });
        
        // Add AI message to chat
        addMessage(videoData.generatedText, 'ai');
    } catch (error) {
        console.error('Error playing video:', error);
        await resetToBaseVideo();
    }
}

// When a video ends, go back to base loop
function onVideoEnded() {
    resetToBaseVideo();
}

// Reset to base video loop
async function resetToBaseVideo() {
    console.log('Resetting to base video');
    try {
        await ensureBaseVideoPlaying();
        currentVideo.textContent = 'Base loop video';
        originalMessage.textContent = '';
        generatedResponse.textContent = '';
    } catch (error) {
        console.error('Error resetting to base video:', error);
    }
}

// Add some CSS for better message threading
const style = document.createElement('style');
style.textContent = `
    .message {
        position: relative;
        margin: 8px 0;
        padding: 8px;
        border-radius: 8px;
        max-width: 80%;
    }

    .message.processing .message-content::after {
        content: '';
        display: inline-block;
        width: 12px;
        margin-left: 4px;
        animation: ellipsis 1.5s infinite;
    }

    @keyframes ellipsis {
        0% { content: '.'; }
        33% { content: '..'; }
        66% { content: '...'; }
        100% { content: ''; }
    }

    .user-message {
        background-color: #e3f2fd;
        margin-left: auto;
    }

    .ai-message {
        background-color: #f5f5f5;
        margin-right: auto;
    }

    .message-timestamp {
        font-size: 0.8em;
        color: #666;
        margin-top: 4px;
    }

    .message-content {
        word-break: break-word;
    }

    #userInput {
        transition: all 0.2s ease;
    }

    #userInput:disabled {
        opacity: 0.7;
        cursor: not-allowed;
    }
`;

document.head.appendChild(style);

// Add function to ensure base video is playing
async function ensureBaseVideoPlaying() {
    if (!videoPlayer.src || videoPlayer.paused) {
        console.log('Ensuring base video is playing');
        try {
            videoPlayer.src = `${API_BASE_URL}/base-video`;
            videoPlayer.loop = true;
            videoPlayer.muted = true;
            await videoPlayer.play();
            currentlyPlaying = 'base-video';
        } catch (error) {
            console.error('Error playing base video:', error);
        }
    }
}

// Update video player event listeners
videoPlayer.addEventListener('ended', async () => {
    console.log('Video ended, resetting to base video');
    await resetToBaseVideo();
});

videoPlayer.addEventListener('error', async (e) => {
    console.error('Video player error:', e);
    await resetToBaseVideo();
});
