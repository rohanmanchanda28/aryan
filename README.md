# Real-time Speech-to-Speech Interview Platform

This project implements a web-based interview platform using OpenAI's Realtime API for a conversational, speech-to-speech experience.

## Features

*   Real-time, low-latency audio streaming between browser and OpenAI.
*   Uses GPT-4o Realtime API for speech input and output.
*   Server-side session token generation for secure client connection to OpenAI.
*   Minimalistic UI focused on the conversation flow.

## Setup

1.  **Clone the repository:**
    ```bash
    git clone <repository_url>
    cd <repository_directory>
    ```
2.  **Install dependencies:**
    ```bash
    npm install
    ```
3.  **Create Environment File:**
    *   Create a file named `.env` in the project root.
    *   Add your OpenAI API key:
        ```
        OPENAI_API_KEY=your_openai_api_key_here
        ```
    *   *(Optional)* You can change the server port by adding `PORT=your_desired_port`.

## Running the Application

*   **Development (with auto-restart):**
    ```bash
    npm run dev
    ```
*   **Production:**
    ```bash
    npm start
    ```

The server will typically run on `http://localhost:5001` (or the port specified in `.env` or by the `PORT` environment variable).

## How it Works

1.  The frontend (`script.js`) requests a temporary session token from the Node.js backend (`/get-session-token`).
2.  The backend uses its secure OpenAI API key to call the OpenAI REST API (`/v1/realtime/sessions`) and generate this ephemeral client token.
3.  The frontend uses this client token to establish a direct WebSocket connection to the OpenAI Realtime API endpoint.
4.  Microphone audio is streamed from the frontend to OpenAI via the WebSocket.
5.  OpenAI processes the audio, generates a spoken response, and streams the response audio back to the frontend via the WebSocket.
6.  The frontend plays the incoming audio stream.
7.  Turn detection (currently Server VAD) manages when the user stops speaking and the AI should respond. 