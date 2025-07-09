# API Documentation

This document outlines the API endpoints provided by the AI OBS Stream Service. While the service is primarily designed to be used via CLI with OBS integration, these endpoints can be useful for integration with other tools or custom frontends.

## Base URL

All API endpoints are relative to your configured base URL, which defaults to:

```
http://localhost:3000
```

## Authentication

Currently, the API does not require authentication. For production use, it's recommended to implement appropriate authentication mechanisms.

## Endpoints

### User Input

Submit a new user message to be processed by the AI pipeline.

**URL**: `/input`  
**Method**: `POST`  
**Content-Type**: `application/json`

**Request Body**:
```json
{
  "userId": "string",
  "message": "string",
  "messageId": "string" (optional)
}
```

**Response**:
```json
{
  "messageId": "string",
  "status": "received",
  "queuePosition": 0,
  "activeProcessing": 1
}
```

**Status Codes**:
- `200 OK`: Message received and queued
- `400 Bad Request`: Invalid input
- `500 Internal Server Error`: Server error

### Vision Control

Control the vision analysis functionality.

**URL**: `/vision/start`  
**Method**: `POST`  
**Content-Type**: `application/json`

**Request Body**:
```json
{
  "sourceName": "string", // optional, defaults to "Display Capture"
  "intervalSeconds": number, // optional, defaults to config setting
  "customPrompt": "string" // optional, defaults to config setting
}
```

**Response**:
```json
{
  "success": true,
  "message": "Vision processing started"
}
```

**Status Codes**:
- `200 OK`: Vision processing started
- `400 Bad Request`: Invalid parameters
- `500 Internal Server Error`: Server error

**URL**: `/vision/stop`  
**Method**: `POST`

**Response**:
```json
{
  "success": true,
  "message": "Vision processing stopped"
}
```

**Status Codes**:
- `200 OK`: Vision processing stopped
- `500 Internal Server Error`: Server error

### Health Check

Check the health/status of the service.

**URL**: `/health`  
**Method**: `GET`

**Response**:
```json
{
  "status": "ok",
  "version": "0.1.0",
  "queueMetrics": {
    "videosReady": 0,
    "waitingInQueue": 0,
    "currentlyProcessing": 0,
    "maxConcurrent": 4
  },
  "services": {
    "llm": "online",
    "tts": "online",
    "videoSync": "online",
    "mediaStream": "online"
  }
}
```

**Status Codes**:
- `200 OK`: Service is running
- `500 Internal Server Error`: Service is experiencing issues

### Base Video

Get the base loop video.

**URL**: `/base-video`  
**Method**: `GET`

**Response**: Video file (Content-Type: video/mp4)

**Status Codes**:
- `200 OK`: Video returned
- `404 Not Found`: Base video not found
- `500 Internal Server Error`: Server error

## Pipeline Status Codes

The system uses the following status codes for items in the pipeline:

- `received`: Input received but not yet processed
- `evaluating`: Input is being evaluated for processing priority
- `rejected`: Input was rejected (low priority or inappropriate)
- `generating_response`: Generating text response with LLM
- `generating_speech`: Converting text to speech
- `generating_video`: Creating synchronized video
- `completed`: Processing complete, video ready
- `failed`: Processing failed

## Error Handling

All endpoints may return error responses in the following format:

```json
{
  "error": "Error message",
  "status": 400,
  "details": {} // Optional additional details
}
```

## Rate Limiting

The API currently does not implement rate limiting. For production use, it's recommended to add appropriate rate limiting mechanisms.

## Websocket Events (Future)

Future versions may include real-time updates via WebSocket connections.