// Configuration
// const API_BASE_URL = 'http://104.171.202.18:3000'; // Same origin
const API_BASE_URL = process.env.BASE_URL;
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

// State
let currentlyPlaying = 'base-video';
let isCheckingVideo = false;
let lastVideoCheck = Date.now();

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Check server health
    checkServerHealth();
    
    // Set up event listeners
    userInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendMessage();
        }
    });
    
    sendButton.addEventListener('click', sendMessage);
    
    // Start polling for status and videos
    setInterval(checkServerHealth, POLL_INTERVAL * 2);
    setInterval(checkForNewVideos, POLL_INTERVAL);
    
    // Set up video player events
    videoPlayer.addEventListener('ended', onVideoEnded);
});

// Check server health
async function checkServerHealth() {
    try {
        const response = await fetch(`${API_BASE_URL}/health`);
        
        if (!response.ok) {
            throw new Error('Server not responding');
        }
        
        const data = await response.json();
        
        connectionStatus.textContent = `Connected to server (${new Date().toLocaleTimeString()})`;
        connectionStatus.style.color = 'green';
        
        // Update queue status if available
        if (data.queueSizes) {
            queueStatus.textContent = `Videos in queue: ${data.queueSizes.video} | Generation queue: ${data.queueSizes.generation}`;
        }
    } catch (error) {
        connectionStatus.textContent = 'Disconnected from server';
        connectionStatus.style.color = 'red';
        console.error('Server health check error:', error);
    }
}

// Send a message
async function sendMessage() {
    const message = userInput.value.trim();
    
    if (!message) {
        return;
    }
    
    // Disable input while sending
    userInput.disabled = true;
    sendButton.disabled = true;
    
    // Add message to UI
    addMessage(message, 'user');
    
    try {
        // Send to API
        const response = await fetch(`${API_BASE_URL}/input`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                userId: USER_ID,
                message: message
            }),
        });
        
        if (!response.ok) {
            throw new Error('Failed to send message');
        }
        
        const data = await response.json();
        
        // Add system confirmation
        addMessage(`Message received. ${data.queuePosition > 0 ? `You are #${data.queuePosition} in queue.` : 'Processing your request now.'}`, 'ai');
        
        // Clear input
        userInput.value = '';
    } catch (error) {
        console.error('Error sending message:', error);
        addMessage('Failed to send message. Please try again.', 'ai');
    } finally {
        // Re-enable input
        userInput.disabled = false;
        sendButton.disabled = false;
        userInput.focus();
    }
}

// Add a message to the UI
function addMessage(text, type = 'user') {
    const messageElement = document.createElement('div');
    messageElement.className = `message ${type === 'user' ? 'user-message' : 'ai-message'}`;
    messageElement.textContent = text;
    
    const timestampElement = document.createElement('div');
    timestampElement.className = 'message-timestamp';
    timestampElement.textContent = formatTime(new Date());
    
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
    // Don't check if we're already checking or if it's been less than 5 seconds
    if (isCheckingVideo || Date.now() - lastVideoCheck < 5000) {
        return;
    }
    
    isCheckingVideo = true;
    lastVideoCheck = Date.now();
    
    try {
        const response = await fetch(`${API_BASE_URL}/next-video`);
        
        if (!response.ok) {
            // If no videos are available (404), that's okay
            if (response.status === 404) {
                return;
            }
            throw new Error(`Error: ${response.statusText}`);
        }
        
        const videoData = await response.json();
        
        // Don't play the same video again
        if (currentlyPlaying === videoData.videoPath) {
            return;
        }
        
        // We have a new video to play
        playNextVideo(videoData);
    } catch (error) {
        console.error('Error checking for videos:', error);
    } finally {
        isCheckingVideo = false;
    }
}

// Play the next video
async function playNextVideo(videoData) {
    // Update UI first
    currentVideo.textContent = `Response to ${videoData.userId}`;
    originalMessage.textContent = `Question: ${videoData.originalMessage}`;
    generatedResponse.textContent = `Response: ${videoData.generatedText}`;
    
    // Load and play the new video
    videoPlayer.src = `${API_BASE_URL}/video/${videoData.videoPath}`;
    videoPlayer.loop = false;
    videoPlayer.muted = false;
    
    // Keep track of what we're playing
    currentlyPlaying = videoData.videoPath;
    
    try {
        // Play the video
        await videoPlayer.play();
        
        // Mark as streamed on the server
        await fetch(`${API_BASE_URL}/stream/${videoData.videoPath}`, {
            method: 'POST'
        });
        
        // Add AI message
        addMessage(videoData.generatedText, 'ai');
    } catch (error) {
        console.error('Error playing video:', error);
        resetToBaseVideo();
    }
}

// When a video ends, go back to base loop
function onVideoEnded() {
    resetToBaseVideo();
}

// Reset to base video loop
function resetToBaseVideo() {
    videoPlayer.src = `${API_BASE_URL}/base-video`;
    videoPlayer.loop = true;
    videoPlayer.muted = true;
    videoPlayer.play();
    
    currentlyPlaying = 'base-video';
    currentVideo.textContent = 'Base loop video';
    originalMessage.textContent = '';
    generatedResponse.textContent = '';
}
